import { describe, expect, it } from 'vitest';
import { HOUR_MS, MINUTE_MS, WINDOW_MS } from '../../src/claude/models';
import {
  RecordStore,
  burnRatePerMinute,
  estimateDepletion,
  firstIndexAfter,
  hourlyBuckets,
  peakPeriods,
  rollingHourly,
  sparkline,
  summarizeWindow,
  windowBlocks,
} from '../../src/services/aggregation-service';
import { rec } from '../helpers';

const NOW = Date.parse('2026-10-06T18:00:00.000Z');
const ago = (ms: number) => NOW - ms;

describe('RecordStore', () => {
  it('de-duplicates by id and sorts by timestamp', () => {
    const s = new RecordStore();
    expect(s.add(rec({ id: 'b', timestamp: 2 }))).toBe(true);
    expect(s.add(rec({ id: 'a', timestamp: 1 }))).toBe(true);
    expect(s.add(rec({ id: 'a', timestamp: 1 }))).toBe(false);
    expect(s.size).toBe(2);
    expect(s.toSortedArray().map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('prunes old records and invalidates the sorted cache', () => {
    const s = new RecordStore();
    s.add(rec({ id: 'a', timestamp: 1 }));
    s.add(rec({ id: 'b', timestamp: 10 }));
    expect(s.toSortedArray()).toHaveLength(2);
    expect(s.prune(5)).toBe(1);
    expect(s.toSortedArray().map((r) => r.id)).toEqual(['b']);
    s.clear();
    expect(s.size).toBe(0);
  });
});

describe('summarizeWindow', () => {
  it('aggregates only records within the last five hours', () => {
    const records = [
      rec({ id: 'old', timestamp: ago(WINDOW_MS + MINUTE_MS) }),
      rec({ id: 'edge', timestamp: ago(WINDOW_MS) }), // exactly 5h old is excluded
      rec({ id: 'in1', timestamp: ago(4 * HOUR_MS), model: 'claude-opus-5-5', input: 1, output: 2, cacheCreate: 3, cacheRead: 4, sessionId: 'x' }),
      rec({ id: 'in2', timestamp: ago(MINUTE_MS), model: 'claude-sonnet-5-5', input: 10, output: 20, cacheCreate: 30, cacheRead: 40, sessionId: 'y' }),
      rec({ id: 'future', timestamp: NOW + HOUR_MS }),
    ];
    const w = summarizeWindow(records, NOW, 'all');
    expect(w.messageCount).toBe(2);
    expect(w.totals).toEqual({ input: 11, output: 22, cacheCreate: 33, cacheRead: 44, total: 110 });
    expect(w.counted).toBe(110);
    expect(w.sessionCount).toBe(2);
    expect(w.currentModel).toBe('claude-sonnet-5-5');
    expect(w.oldest).toBe(ago(4 * HOUR_MS));
    expect(w.resetAt).toBe(ago(4 * HOUR_MS) + WINDOW_MS);
    expect(w.byModel.map((m) => m.model)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5']);
  });

  it('honours the excludeCacheRead basis', () => {
    const w = summarizeWindow([rec({ id: 'a', timestamp: ago(MINUTE_MS) })], NOW, 'excludeCacheRead');
    expect(w.counted).toBe(60);
    expect(w.totals.total).toBe(100);
  });

  it('is empty when nothing is in the window', () => {
    const w = summarizeWindow([], NOW, 'all');
    expect(w.messageCount).toBe(0);
    expect(w.resetAt).toBeUndefined();
    expect(w.currentModel).toBeUndefined();
  });

  it('expires records as time advances', () => {
    const records = [rec({ id: 'a', timestamp: ago(4.5 * HOUR_MS) })];
    expect(summarizeWindow(records, NOW, 'all').messageCount).toBe(1);
    expect(summarizeWindow(records, NOW + HOUR_MS, 'all').messageCount).toBe(0);
  });
});

describe('firstIndexAfter', () => {
  it('binary searches strictly-after', () => {
    const r = [1, 2, 2, 5].map((t, i) => rec({ id: String(i), timestamp: t }));
    expect(firstIndexAfter(r, 0)).toBe(0);
    expect(firstIndexAfter(r, 2)).toBe(3);
    expect(firstIndexAfter(r, 5)).toBe(4);
  });
});

describe('burn rate and depletion', () => {
  const heavy = (id: string, t: number) => rec({ id, timestamp: t, input: 0, output: 0, cacheCreate: 0, cacheRead: 1000 });

  it('is zero without recent usage', () => {
    expect(burnRatePerMinute([], NOW, 'all')).toBe(0);
    expect(burnRatePerMinute([heavy('a', ago(2 * HOUR_MS))], NOW, 'all')).toBe(0);
  });

  it('divides by the observed span, never less than five minutes', () => {
    expect(burnRatePerMinute([heavy('a', ago(MINUTE_MS))], NOW, 'all')).toBe(1000 / 5);
    const spread = [heavy('a', ago(20 * MINUTE_MS)), heavy('b', ago(MINUTE_MS))];
    expect(burnRatePerMinute(spread, NOW, 'all')).toBe(2000 / 20);
  });

  it('projects depletion with the current burn rate', () => {
    const records = [heavy('a', ago(MINUTE_MS))];
    const at = estimateDepletion(records, NOW, 'all', 2000, 100);
    expect(at).toBe(NOW + 10 * MINUTE_MS); // 1000 used + 100/min → 2000 after 10 min
  });

  it('accounts for old records aging out of the window', () => {
    const records = [heavy('old', ago(WINDOW_MS - 5 * MINUTE_MS)), heavy('new', ago(MINUTE_MS))];
    // used 2000; 'old' expires in 5 min, leaving 1000. capacity 1500 @100/min:
    // minute 5: 1000 + 500 = 1500 → depleted at +5 min (not earlier at +? 2000>=1500 handled at start)
    expect(estimateDepletion(records, NOW, 'all', 3000, 100)).toBe(NOW + 20 * MINUTE_MS);
  });

  it('returns now when already over capacity and undefined when never reached', () => {
    const records = [heavy('a', ago(MINUTE_MS))];
    expect(estimateDepletion(records, NOW, 'all', 500, 10)).toBe(NOW);
    expect(estimateDepletion(records, NOW, 'all', 1_000_000, 1)).toBeUndefined();
    expect(estimateDepletion(records, NOW, 'all', 5000, 0)).toBeUndefined();
    expect(estimateDepletion(records, NOW, 'all', 0, 10)).toBeUndefined();
  });
});

describe('sparkline, hourly and peaks', () => {
  it('buckets the window into equal slices', () => {
    const r = [rec({ id: 'a', timestamp: ago(WINDOW_MS - 1) }), rec({ id: 'b', timestamp: ago(1) })];
    const s = sparkline(r, NOW, 'all', 20);
    expect(s).toHaveLength(20);
    expect(s[0]).toBe(100);
    expect(s[19]).toBe(100);
    expect(s.reduce((a, b) => a + b, 0)).toBe(200);
  });

  it('groups by UTC hour with models', () => {
    const t0 = Date.parse('2026-10-06T10:00:00Z');
    const h = hourlyBuckets(
      [rec({ id: 'a', timestamp: t0 + 5 }), rec({ id: 'b', timestamp: t0 + 10, model: 'm2' }), rec({ id: 'c', timestamp: t0 + HOUR_MS })],
      'all',
    );
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ start: t0, messages: 2, counted: 200, models: ['claude-opus-5-5', 'm2'] });
    expect(peakPeriods(h, 1)[0]?.start).toBe(t0);
  });

  it('computes rolling 5h sums across contiguous hours', () => {
    const t0 = Date.parse('2026-10-06T00:00:00Z');
    const h = hourlyBuckets([0, 1, 2, 6].map((k) => rec({ id: `r${k}`, timestamp: t0 + k * HOUR_MS })), 'all');
    expect(rollingHourly(h)).toEqual([100, 200, 300, 200]);
  });
});

describe('windowBlocks', () => {
  it('starts blocks at the hour floor and splits after five hours', () => {
    const t0 = Date.parse('2026-10-06T10:20:00Z');
    const blocks = windowBlocks(
      [rec({ id: 'a', timestamp: t0 }), rec({ id: 'b', timestamp: t0 + 4 * HOUR_MS }), rec({ id: 'c', timestamp: t0 + 5 * HOUR_MS }), rec({ id: 'd', timestamp: t0 + 12 * HOUR_MS })],
      t0 + 12.5 * HOUR_MS,
      'all',
    );
    expect(blocks.map((b) => [b.messages, b.counted, b.active])).toEqual([
      [2, 200, false],
      [1, 100, false],
      [1, 100, true],
    ]);
    expect(blocks[0]?.start).toBe(Date.parse('2026-10-06T10:00:00Z'));
    expect(blocks[1]?.start).toBe(Date.parse('2026-10-06T15:00:00Z'));
  });
});
