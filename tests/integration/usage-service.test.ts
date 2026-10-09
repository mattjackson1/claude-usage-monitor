import { appendFile, rm, utimes } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOUR_MS, MINUTE_MS } from '../../src/claude/models';
import { Logger } from '../../src/logger';
import { detectEnvironment } from '../../src/platform/environment';
import { NodeFileSystem } from '../../src/platform/filesystem';
import { PlatformService } from '../../src/platform/platform-service';
import { UsageService } from '../../src/services/usage-service';
import { DEFAULT_SETTINGS, type Settings } from '../../src/settings/settings';
import { CacheStore } from '../../src/storage/cache';
import { assistantLines, makeTmp, writeJsonl } from '../helpers';

const NOW = Date.parse('2026-10-06T18:00:00.000Z');

async function setup(over: Partial<Settings> = {}, now = () => NOW) {
  const home = await makeTmp('cum-home-');
  const fs = new NodeFileSystem();
  const platform = new PlatformService(detectEnvironment({ platform: process.platform === 'win32' ? 'linux' : process.platform, env: {}, homedir: home }), fs);
  const cacheFile = path.join(home, 'cache.json');
  const cache = new CacheStore(fs, cacheFile);
  const lines: string[] = [];
  const logger = new Logger({ appendLine: (l) => lines.push(l) });
  const settings: Settings = { ...DEFAULT_SETTINGS, customCapacity: 1000, ...over };
  const make = () => new UsageService({ platform, cache, logger, getSettings: () => settings, now });
  const session = (name: string, project = '-proj') => path.join(home, '.claude', 'projects', project, name);
  return { home, make, session, cacheFile, lines, settings, cache };
}

const at = (msAgo: number) => NOW - msAgo;

describe('UsageService end-to-end', () => {
  it('aggregates a window from real files, de-duplicating blocks and subagents', async () => {
    const t = await setup();
    await writeJsonl(
      t.session('s1.jsonl'),
      assistantLines({ id: 'a', ts: at(2 * HOUR_MS), blocks: 3 }) + assistantLines({ id: 'b', ts: at(MINUTE_MS), model: 'claude-sonnet-5-5' }),
    );
    await writeJsonl(t.session('s1/subagents/agent-x.jsonl'), assistantLines({ id: 'c', ts: at(10 * MINUTE_MS), sidechain: true }));
    // same message re-logged in another file (resumed session) must not double count
    await writeJsonl(t.session('s2.jsonl', '-other'), assistantLines({ id: 'a', ts: at(2 * HOUR_MS) }));

    const svc = t.make();
    const snap = await svc.initialize();
    expect(snap.status).toBe('ok');
    expect(snap.recordCount).toBe(3);
    expect(snap.window.messageCount).toBe(3);
    expect(snap.window.totals.total).toBe(300); // 3 × (10+20+30+40)
    expect(snap.percentUsed).toBeCloseTo(30);
    expect(snap.remainingTokens).toBe(700);
    expect(snap.window.currentModel).toBe('claude-sonnet-5-5');
    expect(svc.roots).toHaveLength(1);
  });

  it('picks up appended records incrementally and notifies listeners', async () => {
    const t = await setup();
    const f = t.session('s.jsonl');
    await writeJsonl(f, assistantLines({ id: 'a', ts: at(HOUR_MS) }));
    const svc = t.make();
    await svc.initialize();
    const seen: number[] = [];
    svc.onDidUpdate((s) => seen.push(s.recordCount));

    await appendFile(f, assistantLines({ id: 'b', ts: at(MINUTE_MS) }));
    await svc.refresh({ paths: [f] });
    expect(seen).toEqual([2]);
    expect(svc.stats.records).toBe(2); // 'a' was not re-read
  });

  it('discovers files that appear after startup on a full refresh', async () => {
    const t = await setup();
    await writeJsonl(t.session('first.jsonl'), assistantLines({ id: 'a', ts: at(HOUR_MS) }));
    const svc = t.make();
    await svc.initialize();
    await writeJsonl(t.session('late.jsonl'), assistantLines({ id: 'late', ts: at(MINUTE_MS) }));
    expect((await svc.refresh()).recordCount).toBe(2);
  });

  it('survives corrupt files and reports them', async () => {
    const t = await setup();
    await writeJsonl(t.session('bad.jsonl'), 'garbage "usage"\n{"type":"assistant","message":{"usage":{"input_tokens":1,\n' + assistantLines({ id: 'ok', ts: at(MINUTE_MS) }));
    const svc = t.make();
    const snap = await svc.initialize();
    expect(snap.recordCount).toBe(1);
    expect(svc.stats.malformed).toBe(2);
    expect(snap.warnings.join(' ')).toContain('malformed');
  });

  it('removes expired records as time advances (rolling window)', async () => {
    let now = NOW;
    const t = await setup({}, () => now);
    await writeJsonl(t.session('s.jsonl'), assistantLines({ id: 'a', ts: at(4.5 * HOUR_MS) }) + assistantLines({ id: 'b', ts: at(MINUTE_MS) }));
    const svc = t.make();
    expect((await svc.initialize()).window.messageCount).toBe(2);
    now = NOW + HOUR_MS;
    const snap = await svc.refresh();
    expect(snap.window.messageCount).toBe(1);
    expect(snap.window.resetAt).toBe(at(MINUTE_MS) + 5 * HOUR_MS);
  });

  it('prunes history beyond the retention period', async () => {
    const t = await setup({ historyRetentionDays: 1 });
    await writeJsonl(t.session('s.jsonl'), assistantLines({ id: 'old', ts: at(3 * 24 * HOUR_MS) }) + assistantLines({ id: 'new', ts: at(MINUTE_MS) }));
    const snap = await t.make().initialize();
    expect(snap.recordCount).toBe(1);
  });

  it('persists aggregates and resumes without re-reading files', async () => {
    const t = await setup();
    const f = t.session('s.jsonl');
    await writeJsonl(f, assistantLines({ id: 'a', ts: at(HOUR_MS) }) + assistantLines({ id: 'b', ts: at(MINUTE_MS) }));
    const first = t.make();
    await first.initialize();
    await first.flush();

    const second = t.make();
    const snap = await second.initialize();
    expect(second.cacheRestored).toBe(true);
    expect(snap.recordCount).toBe(2);
    expect(second.stats.lines).toBe(0); // nothing re-parsed

    await appendFile(f, assistantLines({ id: 'c', ts: at(1000) }));
    expect((await second.refresh()).recordCount).toBe(3);
    expect(second.stats.lines).toBe(1);
  });

  it('persists notification state across sessions', async () => {
    const t = await setup();
    await writeJsonl(t.session('s.jsonl'), assistantLines({ id: 'a', ts: at(MINUTE_MS) }));
    const first = t.make();
    await first.initialize();
    first.notificationState = { fired: [75, 90], hadUsage: true };
    await first.flush();
    const second = t.make();
    await second.initialize();
    expect(second.notificationState).toEqual({ fired: [75, 90], hadUsage: true });
  });

  it('resetCache clears records, cursors and the persisted file', async () => {
    const t = await setup();
    await writeJsonl(t.session('s.jsonl'), assistantLines({ id: 'a', ts: at(MINUTE_MS) }));
    const svc = t.make();
    await svc.initialize();
    await svc.flush();
    await svc.resetCache();
    expect(await t.cache.load()).toBeUndefined();
    expect((await svc.refresh()).recordCount).toBe(1); // re-read from disk
    expect(svc.stats.lines).toBe(1);
  });

  it('reports no-claude-data with diagnostics when nothing exists', async () => {
    const t = await setup();
    const svc = t.make();
    const snap = await svc.initialize();
    expect(snap.status).toBe('no-claude-data');
    expect(snap.warnings[0]).toContain('No Claude data directory');
    expect(svc.discovery.attempts.length).toBeGreaterThan(0);
    // data appearing later is found on the next refresh
    await writeJsonl(t.session('s.jsonl'), assistantLines({ id: 'a', ts: at(MINUTE_MS) }));
    expect((await svc.refresh()).status).toBe('ok');
  });

  it('reports no-data for a Claude dir without usage, and ignores deleted files', async () => {
    const t = await setup();
    const f = t.session('s.jsonl');
    await writeJsonl(f, '{"type":"user"}\n');
    const svc = t.make();
    expect((await svc.initialize()).status).toBe('no-data');
    await rm(f);
    expect((await svc.refresh()).status).toBe('no-data');
  });

  it('skips files older than retention without reading them', async () => {
    const t = await setup({ historyRetentionDays: 1 });
    const f = t.session('stale.jsonl');
    await writeJsonl(f, assistantLines({ id: 'a', ts: at(MINUTE_MS) }));
    await utimes(f, new Date(NOW - 10 * 24 * HOUR_MS), new Date(NOW - 10 * 24 * HOUR_MS));
    const svc = t.make();
    await svc.initialize();
    expect(svc.stats.lines).toBe(0);
  });

  it('keeps refreshes serialised and returns consistent snapshots', async () => {
    const t = await setup();
    await writeJsonl(t.session('s.jsonl'), assistantLines({ id: 'a', ts: at(MINUTE_MS) }));
    const svc = t.make();
    await svc.initialize();
    const results = await Promise.all([svc.refresh(), svc.refresh(), svc.refresh()]);
    expect(new Set(results.map((r) => r.recordCount))).toEqual(new Set([1]));
  });

  it('handles a large history quickly', async () => {
    const t = await setup({ customCapacity: 0 });
    let body = '';
    for (let i = 0; i < 20_000; i++) body += assistantLines({ id: `m${i}`, ts: at((i % 4000) * MINUTE_MS + 1), blocks: 2 });
    await writeJsonl(t.session('big.jsonl'), body);
    const started = Date.now();
    const svc = t.make();
    const snap = await svc.initialize();
    const elapsed = Date.now() - started;
    expect(snap.recordCount).toBe(20_000);
    expect(snap.capacity?.provider).toBe('historical-peak');
    expect(elapsed).toBeLessThan(2000);
  });
});
