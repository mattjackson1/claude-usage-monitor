import {
  HOUR_MS,
  MINUTE_MS,
  WINDOW_MS,
  addRecord,
  countedTokens,
  emptyTotals,
  recordCounted,
  type TokenBasis,
  type TokenTotals,
  type UsageRecord,
} from '../claude/models';

/** Records de-duplicated by id, kept sorted by timestamp on demand. */
export class RecordStore {
  private readonly byId = new Map<string, UsageRecord>();
  private sorted: UsageRecord[] | undefined;

  get size(): number {
    return this.byId.size;
  }

  /** Returns true when the record was new. */
  add(r: UsageRecord): boolean {
    if (this.byId.has(r.id)) return false;
    this.byId.set(r.id, r);
    this.sorted = undefined;
    return true;
  }

  /** Drops records older than `cutoff`; returns how many were removed. */
  prune(cutoff: number): number {
    let removed = 0;
    for (const [id, r] of this.byId) {
      if (r.timestamp < cutoff) {
        this.byId.delete(id);
        removed++;
      }
    }
    if (removed) this.sorted = undefined;
    return removed;
  }

  clear(): void {
    this.byId.clear();
    this.sorted = undefined;
  }

  /** Ascending by timestamp. Do not mutate. */
  toSortedArray(): readonly UsageRecord[] {
    this.sorted ??= [...this.byId.values()].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    return this.sorted;
  }
}

export interface ModelUsage {
  model: string;
  messages: number;
  totals: TokenTotals;
}

export interface WindowSummary {
  totals: TokenTotals;
  counted: number;
  messageCount: number;
  sessionCount: number;
  byModel: ModelUsage[];
  /** Model of the most recent record in the window. */
  currentModel?: string;
  /** Timestamp of the oldest record still inside the window. */
  oldest?: number;
  /** When the oldest record ages out (oldest + 5h). */
  resetAt?: number;
  newest?: number;
}

/** Index of the first record with timestamp > t (records sorted ascending). */
export function firstIndexAfter(records: readonly UsageRecord[], t: number): number {
  let lo = 0;
  let hi = records.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((records[mid] as UsageRecord).timestamp > t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function summarizeWindow(records: readonly UsageRecord[], now: number, basis: TokenBasis): WindowSummary {
  const start = firstIndexAfter(records, now - WINDOW_MS);
  const totals = emptyTotals();
  const models = new Map<string, ModelUsage>();
  const sessions = new Set<string>();
  let messageCount = 0;
  let oldest: number | undefined;
  let newest: number | undefined;
  let currentModel: string | undefined;

  for (let i = start; i < records.length; i++) {
    const r = records[i] as UsageRecord;
    if (r.timestamp > now) break;
    addRecord(totals, r);
    messageCount++;
    sessions.add(r.sessionId);
    oldest ??= r.timestamp;
    newest = r.timestamp;
    currentModel = r.model;
    let m = models.get(r.model);
    if (!m) {
      m = { model: r.model, messages: 0, totals: emptyTotals() };
      models.set(r.model, m);
    }
    m.messages++;
    addRecord(m.totals, r);
  }

  return {
    totals,
    counted: countedTokens(totals, basis),
    messageCount,
    sessionCount: sessions.size,
    byModel: [...models.values()].sort((a, b) => b.totals.total - a.totals.total),
    currentModel,
    oldest,
    resetAt: oldest === undefined ? undefined : oldest + WINDOW_MS,
    newest,
  };
}

/** Tokens per minute over the recent lookback (min span 5 min to damp spikes). */
export function burnRatePerMinute(
  records: readonly UsageRecord[],
  now: number,
  basis: TokenBasis,
  lookbackMs = 30 * MINUTE_MS,
): number {
  const start = firstIndexAfter(records, now - lookbackMs);
  let sum = 0;
  let first: number | undefined;
  for (let i = start; i < records.length; i++) {
    const r = records[i] as UsageRecord;
    if (r.timestamp > now) break;
    first ??= r.timestamp;
    sum += recordCounted(r, basis);
  }
  if (first === undefined || sum === 0) return 0;
  const span = Math.min(lookbackMs, Math.max(5 * MINUTE_MS, now - first));
  return sum / (span / MINUTE_MS);
}

/**
 * Projects when the window reaches `capacity`, assuming the current burn rate
 * continues and old records age out of the rolling window. Returns undefined
 * when it will not happen within the next 5 hours (or burn is zero).
 */
export function estimateDepletion(
  records: readonly UsageRecord[],
  now: number,
  basis: TokenBasis,
  capacity: number,
  burnPerMin: number,
): number | undefined {
  if (capacity <= 0 || burnPerMin <= 0) return undefined;
  const start = firstIndexAfter(records, now - WINDOW_MS);
  const live: { ts: number; tokens: number }[] = [];
  let used = 0;
  for (let i = start; i < records.length; i++) {
    const r = records[i] as UsageRecord;
    if (r.timestamp > now) break;
    const tokens = recordCounted(r, basis);
    live.push({ ts: r.timestamp, tokens });
    used += tokens;
  }
  if (used >= capacity) return now;
  let expireIdx = 0;
  for (let minute = 1; minute <= WINDOW_MS / MINUTE_MS; minute++) {
    const t = now + minute * MINUTE_MS;
    while (expireIdx < live.length && (live[expireIdx] as { ts: number }).ts <= t - WINDOW_MS) {
      used -= (live[expireIdx] as { tokens: number }).tokens;
      expireIdx++;
    }
    if (used + burnPerMin * minute >= capacity) return t;
  }
  return undefined;
}

/** Counted tokens per bucket across the last window, oldest first. */
export function sparkline(records: readonly UsageRecord[], now: number, basis: TokenBasis, buckets = 20): number[] {
  const out = new Array<number>(buckets).fill(0);
  const size = WINDOW_MS / buckets;
  const windowStart = now - WINDOW_MS;
  const start = firstIndexAfter(records, windowStart);
  for (let i = start; i < records.length; i++) {
    const r = records[i] as UsageRecord;
    if (r.timestamp > now) break;
    const idx = Math.min(buckets - 1, Math.floor((r.timestamp - windowStart) / size));
    out[idx] = (out[idx] as number) + recordCounted(r, basis);
  }
  return out;
}

export interface HourBucket {
  start: number;
  totals: TokenTotals;
  counted: number;
  messages: number;
  models: string[];
}

export function hourlyBuckets(records: readonly UsageRecord[], basis: TokenBasis): HourBucket[] {
  const map = new Map<number, { totals: TokenTotals; messages: number; models: Set<string> }>();
  for (const r of records) {
    const start = Math.floor(r.timestamp / HOUR_MS) * HOUR_MS;
    let b = map.get(start);
    if (!b) {
      b = { totals: emptyTotals(), messages: 0, models: new Set() };
      map.set(start, b);
    }
    addRecord(b.totals, r);
    b.messages++;
    b.models.add(r.model);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, b]) => ({
      start,
      totals: b.totals,
      counted: countedTokens(b.totals, basis),
      messages: b.messages,
      models: [...b.models].sort(),
    }));
}

export function peakPeriods(hourly: readonly HourBucket[], n = 3): HourBucket[] {
  return [...hourly].sort((a, b) => b.counted - a.counted).slice(0, n).filter((b) => b.counted > 0);
}

export interface WindowBlock {
  start: number;
  end: number;
  totals: TokenTotals;
  counted: number;
  messages: number;
  active: boolean;
}

/**
 * Fixed 5-hour blocks: a block starts at the hour-floor of the first record
 * after the previous block ends. This approximates, but is not verified to
 * equal, the server-side windows.
 */
export function windowBlocks(records: readonly UsageRecord[], now: number, basis: TokenBasis): WindowBlock[] {
  const blocks: WindowBlock[] = [];
  let current: WindowBlock | undefined;
  for (const r of records) {
    if (!current || r.timestamp >= current.end) {
      const start = Math.floor(r.timestamp / HOUR_MS) * HOUR_MS;
      current = { start, end: start + WINDOW_MS, totals: emptyTotals(), counted: 0, messages: 0, active: false };
      blocks.push(current);
    }
    addRecord(current.totals, r);
    current.messages++;
  }
  for (const b of blocks) {
    b.counted = countedTokens(b.totals, basis);
    b.active = now >= b.start && now < b.end;
  }
  return blocks;
}

/** Sum of counted tokens over the 5 hourly buckets ending at each bucket. */
export function rollingHourly(hourly: readonly HourBucket[]): number[] {
  const byStart = new Map(hourly.map((h) => [h.start, h.counted]));
  return hourly.map((h) => {
    let sum = 0;
    for (let k = 0; k < 5; k++) sum += byStart.get(h.start - k * HOUR_MS) ?? 0;
    return sum;
  });
}
