import { DAY_MS, MINUTE_MS, WINDOW_MS, type TokenBasis, type UsageRecord } from '../claude/models';
import { discoverClaudeRoots, listSessionFiles, type ClaudeRoot, type DiscoveryResult } from '../claude/discovery';
import { emptyStats, mergeStats, readNewRecords, type FileCursor, type ParseStats } from '../claude/parser';
import type { Logger } from '../logger';
import type { PlatformService } from '../platform/platform-service';
import type { Settings } from '../settings/settings';
import { emptyNotificationState, type CacheStore, type NotificationState } from '../storage/cache';
import {
  RecordStore,
  burnRatePerMinute,
  estimateDepletion,
  hourlyBuckets,
  peakPeriods,
  sparkline,
  summarizeWindow,
  windowBlocks,
  type HourBucket,
  type WindowBlock,
  type WindowSummary,
} from './aggregation-service';
import { defaultCapacityProviders, resolveCapacity, type CapacityResult, type UsageCapacityProvider } from './capacity';

export type SnapshotStatus = 'ok' | 'no-data' | 'no-claude-data';

export interface UsageSnapshot {
  generatedAt: number;
  status: SnapshotStatus;
  basis: TokenBasis;
  window: WindowSummary;
  capacity?: CapacityResult;
  /** Counted tokens / capacity * 100; may exceed 100. */
  percentUsed?: number;
  percentRemaining?: number;
  remainingTokens?: number;
  burnRatePerMinute: number;
  depletionAt?: number;
  sparkline: number[];
  hourly: HourBucket[];
  peaks: HourBucket[];
  blocks: WindowBlock[];
  recordCount: number;
  warnings: string[];
}

export interface UsageServiceDeps {
  platform: PlatformService;
  cache: CacheStore;
  logger: Logger;
  getSettings: () => Settings;
  now?: () => number;
  providers?: UsageCapacityProvider[];
}

const SAVE_INTERVAL_MS = 30_000;
const CONCURRENCY = 8;

async function pool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++] as T);
  });
  await Promise.all(workers);
}

export class UsageService {
  private readonly store = new RecordStore();
  private readonly cursors = new Map<string, FileCursor>();
  private readonly listeners = new Set<(s: UsageSnapshot) => void>();
  private readonly providers: UsageCapacityProvider[];
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  private snapshot: UsageSnapshot | undefined;
  private dirty = false;
  private lastSave = 0;

  discovery: DiscoveryResult = { roots: [], attempts: [] };
  readonly stats: ParseStats = emptyStats();
  notificationState: NotificationState = emptyNotificationState();
  lastError: string | undefined;
  lastRefreshDurationMs = 0;
  cacheRestored = false;

  constructor(private readonly deps: UsageServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.providers = deps.providers ?? defaultCapacityProviders();
  }

  get roots(): readonly ClaudeRoot[] {
    return this.discovery.roots;
  }

  getSnapshot(): UsageSnapshot | undefined {
    return this.snapshot;
  }

  /** All retained records, ascending. */
  getRecords(): readonly UsageRecord[] {
    return this.store.toSortedArray();
  }

  onDidUpdate(cb: (s: UsageSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async initialize(): Promise<UsageSnapshot> {
    const persisted = await this.deps.cache.load();
    if (persisted) {
      for (const r of persisted.records) this.store.add(r);
      for (const [f, c] of Object.entries(persisted.files)) this.cursors.set(f, c);
      this.notificationState = persisted.notification;
      this.cacheRestored = true;
      this.deps.logger.info(`Restored ${persisted.records.length} records from cache`);
    }
    await this.rediscover();
    return this.refresh();
  }

  async rediscover(): Promise<DiscoveryResult> {
    this.discovery = await discoverClaudeRoots(this.deps.platform, this.deps.getSettings().additionalPaths);
    this.deps.logger.info(
      `Discovery: ${this.discovery.roots.length} root(s) of ${this.discovery.attempts.length} candidate(s)`,
    );
    for (const a of this.discovery.attempts) this.deps.logger.debug(`  ${a.status}: ${a.path} [${a.source}] ${a.detail ?? ''}`);
    return this.discovery;
  }

  /** Serialised; `paths` limits work to specific changed files. */
  refresh(opts: { paths?: string[] } = {}): Promise<UsageSnapshot> {
    const run = this.queue.then(() => this.doRefresh(opts));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async resetCache(): Promise<void> {
    await this.queue;
    this.store.clear();
    this.cursors.clear();
    this.notificationState = emptyNotificationState();
    Object.assign(this.stats, emptyStats());
    this.cacheRestored = false;
    await this.deps.cache.clear();
    this.deps.logger.info('Cache cleared');
  }

  async flush(): Promise<void> {
    await this.queue;
    await this.save();
  }

  private async save(): Promise<void> {
    try {
      await this.deps.cache.save(
        {
          files: Object.fromEntries(this.cursors),
          records: [...this.store.toSortedArray()],
          notification: this.notificationState,
        },
        this.now(),
      );
      this.dirty = false;
      this.lastSave = this.now();
    } catch (err) {
      this.deps.logger.warn(`Could not save cache: ${(err as Error).message}`);
    }
  }

  private async doRefresh(opts: { paths?: string[] }): Promise<UsageSnapshot> {
    const t0 = this.now();
    const settings = this.deps.getSettings();
    const cutoff = t0 - settings.historyRetentionDays * DAY_MS;
    this.lastError = undefined;

    try {
      const fullScan = !opts.paths || opts.paths.length === 0;
      if (fullScan && this.discovery.roots.length === 0) await this.rediscover();

      let files: { path: string }[];
      if (fullScan) {
        files = [];
        for (const root of this.discovery.roots) files.push(...(await listSessionFiles(this.deps.platform, root, cutoff)));
        const live = new Set(files.map((f) => f.path));
        for (const known of [...this.cursors.keys()]) {
          if (!live.has(known)) {
            this.cursors.delete(known);
            this.dirty = true;
          }
        }
      } else {
        files = (opts.paths ?? []).map((path) => ({ path }));
      }

      await pool(files, CONCURRENCY, async (f) => {
        try {
          const result = await readNewRecords(this.deps.platform.fs, f.path, this.cursors.get(f.path));
          if (!result) {
            if (this.cursors.delete(f.path)) this.dirty = true;
            return;
          }
          if (!result.changed) return;
          this.cursors.set(f.path, result.cursor);
          this.dirty = true;
          mergeStats(this.stats, result.stats);
          for (const r of result.records) if (r.timestamp >= cutoff) this.store.add(r);
        } catch (err) {
          this.deps.logger.warn(`Failed to read ${f.path}: ${(err as Error).message}`);
        }
      });

      if (this.store.prune(cutoff) > 0) this.dirty = true;
    } catch (err) {
      this.lastError = (err as Error).message;
      this.deps.logger.error('Refresh failed', err);
    }

    const snap = await this.buildSnapshot(settings);
    this.snapshot = snap;
    this.lastRefreshDurationMs = this.now() - t0;
    this.deps.logger.debug(`Refresh done in ${this.lastRefreshDurationMs}ms, ${this.store.size} records`);

    for (const cb of this.listeners) {
      try {
        cb(snap);
      } catch (err) {
        this.deps.logger.error('Listener failed', err);
      }
    }
    if (this.dirty && this.now() - this.lastSave >= SAVE_INTERVAL_MS) await this.save();
    return snap;
  }

  private async buildSnapshot(settings: Settings): Promise<UsageSnapshot> {
    const now = this.now();
    const basis = settings.capacityBasis;
    const records = this.store.toSortedArray();
    const window = summarizeWindow(records, now, basis);
    const blocks = windowBlocks(records, now, basis);
    const hourly = hourlyBuckets(records, basis);
    const capacity = await resolveCapacity(this.providers, {
      blocks,
      now,
      basis,
      userCapacity: settings.customCapacity,
    });
    const burn = burnRatePerMinute(records, now, basis);
    const percentUsed = capacity ? (window.counted / capacity.tokens) * 100 : undefined;
    const warnings: string[] = [];
    if (this.discovery.roots.length === 0) warnings.push('No Claude data directory found. Run "Claude Usage: Diagnostics".');
    if (this.lastError) warnings.push(`Last refresh error: ${this.lastError}`);
    if (this.stats.malformed > 0) warnings.push(`${this.stats.malformed} malformed line(s) skipped`);
    if (this.stats.schemaMismatches > 0) warnings.push(`${this.stats.schemaMismatches} record(s) did not match the expected schema`);
    if (!capacity) warnings.push('No capacity known: set claudeUsage.customCapacity for percentages.');
    else if (capacity.confidence !== 'high') warnings.push(`Capacity is an estimate (${capacity.method}).`);

    return {
      generatedAt: now,
      status: this.discovery.roots.length === 0 ? 'no-claude-data' : records.length === 0 ? 'no-data' : 'ok',
      basis,
      window,
      capacity,
      percentUsed,
      percentRemaining: percentUsed === undefined ? undefined : Math.max(0, 100 - percentUsed),
      remainingTokens: capacity ? Math.max(0, capacity.tokens - window.counted) : undefined,
      burnRatePerMinute: burn,
      depletionAt: capacity ? estimateDepletion(records, now, basis, capacity.tokens, burn) : undefined,
      sparkline: sparkline(records, now, basis),
      hourly,
      peaks: peakPeriods(hourly),
      blocks,
      recordCount: records.length,
      warnings,
    };
  }
}

export { MINUTE_MS, WINDOW_MS };
