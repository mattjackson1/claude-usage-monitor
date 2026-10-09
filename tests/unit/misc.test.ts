import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../../src/settings/settings';
import { Logger } from '../../src/logger';
import { CACHE_VERSION, CacheStore, emptyNotificationState } from '../../src/storage/cache';
import { evaluateNotifications } from '../../src/services/notification-service';
import type { UsageSnapshot } from '../../src/services/usage-service';
import { emptyTotals } from '../../src/claude/models';
import { MemoryFileSystem, rec } from '../helpers';

const noop = () => undefined;

describe('parseSettings', () => {
  it('uses defaults for an empty configuration', () => {
    expect(parseSettings(() => undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps and validates values', () => {
    const cfg: Record<string, unknown> = {
      refreshInterval: 1,
      displayMode: 'nonsense',
      warningThresholds: [95, 75, 75, 0, 500, 'x', 90],
      customCapacity: -5,
      capacityBasis: 'excludeCacheRead',
      historyRetentionDays: 9999,
      'notifications.enabled': 'yes',
      additionalPaths: ['/a', '', 3, '  '],
    };
    const s = parseSettings((k) => cfg[k]);
    expect(s.refreshInterval).toBe(10);
    expect(s.displayMode).toBe('percentage');
    expect(s.warningThresholds).toEqual([75, 90, 95]);
    expect(s.customCapacity).toBe(0);
    expect(s.capacityBasis).toBe('excludeCacheRead');
    expect(s.historyRetentionDays).toBe(365);
    expect(s.notificationsEnabled).toBe(true);
    expect(s.additionalPaths).toEqual(['/a']);
  });

  it('accepts a valid display mode and an empty threshold list', () => {
    const s = parseSettings((k) => ({ displayMode: 'timeRemaining', warningThresholds: [] })[k as 'displayMode']);
    expect(s.displayMode).toBe('timeRemaining');
    expect(s.warningThresholds).toEqual([]);
  });
});

describe('Logger', () => {
  it('writes, gates debug and keeps a bounded ring', () => {
    const lines: string[] = [];
    const log = new Logger({ appendLine: (l) => lines.push(l) }, () => 0, 3);
    log.debug('hidden');
    log.debugEnabled = true;
    log.debug('shown');
    log.info('a');
    log.warn('b');
    log.error('c', new Error('boom'));
    expect(lines[0]).toBe('1970-01-01T00:00:00.000Z [DEBUG] shown');
    expect(lines.some((l) => l.includes('hidden'))).toBe(false);
    expect(log.recent()).toHaveLength(3);
    expect(log.recent()[2]).toContain('boom');
    log.show();
  });
});

describe('CacheStore', () => {
  const state = { files: { '/a.jsonl': { offset: 10, size: 10, mtimeMs: 5 } }, records: [rec({ id: 'r1', timestamp: 1, sidechain: true })], notification: { fired: [75], hadUsage: true } };

  it('round-trips state', async () => {
    const c = new CacheStore(new MemoryFileSystem(), '/c.json');
    await c.save(state, 99);
    expect(await c.load()).toEqual(state);
  });

  it('returns undefined for missing, corrupt or wrong-version caches', async () => {
    const fs = new MemoryFileSystem();
    const c = new CacheStore(fs, '/c.json');
    expect(await c.load()).toBeUndefined();
    await fs.writeText('/c.json', '{not json');
    expect(await c.load()).toBeUndefined();
    await fs.writeText('/c.json', JSON.stringify({ version: CACHE_VERSION + 1, files: {}, records: [] }));
    expect(await c.load()).toBeUndefined();
  });

  it('drops malformed record tuples and clears', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeText('/c.json', JSON.stringify({ version: CACHE_VERSION, files: {}, records: [['x'], [1, 2], ['ok', 1, 's', 'm', 1, 1, 1, 1, 0]] }));
    const c = new CacheStore(fs, '/c.json');
    expect((await c.load())?.records.map((r) => r.id)).toEqual(['ok']);
    await c.clear();
    expect(await c.load()).toBeUndefined();
  });
});

function snap(percentUsed: number | undefined, messageCount = 1): UsageSnapshot {
  return { percentUsed, window: { messageCount, totals: emptyTotals(), counted: 0, sessionCount: 0, byModel: [] } } as unknown as UsageSnapshot;
}
const cfg = { notificationsEnabled: true, notifyOnWindowReset: true, warningThresholds: [75, 90, 95] };

describe('evaluateNotifications', () => {
  it('fires each threshold once and announces only the highest crossed', () => {
    const st = emptyNotificationState();
    expect(evaluateNotifications(snap(50), cfg, st)).toEqual([]);
    expect(evaluateNotifications(snap(76), cfg, st)).toEqual([{ kind: 'threshold', threshold: 75, percent: 76 }]);
    expect(evaluateNotifications(snap(80), cfg, st)).toEqual([]);
    expect(evaluateNotifications(snap(96), cfg, st)).toEqual([{ kind: 'threshold', threshold: 95, percent: 96 }]);
    expect(evaluateNotifications(snap(97), cfg, st)).toEqual([]);
  });

  it('does not repeat 90 after jumping straight past 75 and 90', () => {
    const st = emptyNotificationState();
    expect(evaluateNotifications(snap(92), cfg, st)).toEqual([{ kind: 'threshold', threshold: 90, percent: 92 }]);
    expect(st.fired).toEqual([75, 90]);
  });

  it('re-arms when usage falls back below a threshold', () => {
    const st = emptyNotificationState();
    evaluateNotifications(snap(80), cfg, st);
    evaluateNotifications(snap(60), cfg, st);
    expect(evaluateNotifications(snap(80), cfg, st)).toHaveLength(1);
  });

  it('emits a reset once when the window empties', () => {
    const st = emptyNotificationState();
    evaluateNotifications(snap(80), cfg, st);
    expect(evaluateNotifications(snap(0, 0), cfg, st)).toEqual([{ kind: 'reset' }]);
    expect(evaluateNotifications(snap(0, 0), cfg, st)).toEqual([]);
    expect(st.fired).toEqual([]);
  });

  it('honours suppression but still tracks state', () => {
    const st = emptyNotificationState();
    expect(evaluateNotifications(snap(80), { ...cfg, notificationsEnabled: false }, st)).toEqual([]);
    expect(st.fired).toEqual([75]);
    expect(evaluateNotifications(snap(0, 0), { ...cfg, notifyOnWindowReset: false }, st)).toEqual([]);
  });

  it('supports custom thresholds and unknown capacity', () => {
    const st = emptyNotificationState();
    expect(evaluateNotifications(snap(51), { ...cfg, warningThresholds: [50] }, st)).toHaveLength(1);
    expect(evaluateNotifications(snap(undefined), cfg, emptyNotificationState())).toEqual([]);
  });
});

void noop;
