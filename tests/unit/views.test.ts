import { describe, expect, it } from 'vitest';
import { HOUR_MS, WINDOW_MS, emptyTotals } from '../../src/claude/models';
import { buildExportRows, toCsvReport, toJsonReport } from '../../src/services/export-service';
import type { UsageSnapshot } from '../../src/services/usage-service';
import { formatClock, formatDuration, formatNumber, formatTokens, friendlyModel, severityFor, statusBarModel } from '../../src/views/format';
import { buildTreeModel } from '../../src/views/tree-provider';
import { escapeHtml, renderDashboardHtml, sparklineSvg } from '../../src/views/webview/render';

const NOW = Date.parse('2026-10-06T15:42:13Z');

function makeSnap(over: Partial<UsageSnapshot> = {}): UsageSnapshot {
  const totals = { input: 1_245_000, output: 318_000, cacheRead: 2_340_000, cacheCreate: 74_000, total: 3_977_000 };
  return {
    generatedAt: NOW,
    status: 'ok',
    basis: 'all',
    window: {
      totals,
      counted: 3_977_000,
      messageCount: 10,
      sessionCount: 2,
      byModel: [{ model: 'claude-opus-5-5', messages: 10, totals }],
      currentModel: 'claude-opus-5-5',
      oldest: NOW - HOUR_MS,
      resetAt: NOW - HOUR_MS + WINDOW_MS,
      newest: NOW,
    },
    capacity: { tokens: 9_469_000, provider: 'user-configured', method: 'setting', confidence: 'high', note: 'n' },
    percentUsed: 42,
    percentRemaining: 58,
    remainingTokens: 5_492_000,
    burnRatePerMinute: 1000,
    depletionAt: NOW + 102 * 60_000,
    sparkline: [1, 2, 3, 0, 5],
    hourly: [{ start: NOW - 2 * HOUR_MS, totals: { ...emptyTotals(), input: 1, total: 1 }, counted: 1, messages: 1, models: ['m'] }],
    peaks: [{ start: NOW - 2 * HOUR_MS, totals: emptyTotals(), counted: 1, messages: 1, models: ['m'] }],
    blocks: [{ start: NOW - HOUR_MS, end: NOW + 4 * HOUR_MS, totals, counted: 3_977_000, messages: 10, active: true }],
    recordCount: 10,
    warnings: [],
    ...over,
  };
}

describe('formatters', () => {
  it('formats tokens compactly', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(3_800_000)).toBe('3.8M');
    expect(formatTokens(4_000_000)).toBe('4M');
    expect(formatTokens(12_345)).toBe('12.3K');
    expect(formatTokens(2_500_000_000)).toBe('2.5B');
    expect(formatNumber(1245000)).toBe('1,245,000');
  });

  it('formats durations, clocks and models', () => {
    expect(formatDuration(102 * 60_000)).toBe('1h 42m');
    expect(formatDuration(5 * 60_000)).toBe('5m');
    expect(formatDuration(10_000)).toBe('<1m');
    expect(formatClock(Date.parse('2026-10-06T17:24:00Z'))).toBe('17:24');
    expect(friendlyModel('claude-opus-5-5')).toBe('Opus');
    expect(friendlyModel('claude-fable-5-1')).toBe('Fable');
    expect(friendlyModel('weird')).toBe('weird');
    expect(friendlyModel(undefined)).toBe('n/a');
  });

  it('maps percentage to severity using thresholds', () => {
    expect(severityFor(10, [75, 90])).toBe('normal');
    expect(severityFor(80, [75, 90])).toBe('warning');
    expect(severityFor(95, [75, 90])).toBe('error');
    expect(severityFor(undefined, [75])).toBe('normal');
    expect(severityFor(99, [])).toBe('normal');
  });
});

describe('statusBarModel', () => {
  const t = [75, 90, 95];
  it('renders every display mode', () => {
    const s = makeSnap();
    expect(statusBarModel(s, 'percentage', t).text).toBe('🧠 42%');
    expect(statusBarModel(s, 'percentageRemaining', t).text).toBe('🧠 58% Left');
    expect(statusBarModel(s, 'tokensUsed', t).text).toBe('🧠 4M');
    expect(statusBarModel(s, 'tokensRemaining', t).text).toBe('🧠 5.5M Left');
    expect(statusBarModel(s, 'timeRemaining', t).text).toBe('🧠 1h 42m Left');
  });

  it('falls back to tokens when capacity is unknown', () => {
    const s = makeSnap({ capacity: undefined, percentUsed: undefined, percentRemaining: undefined, remainingTokens: undefined, depletionAt: undefined });
    for (const m of ['percentage', 'percentageRemaining', 'tokensRemaining', 'timeRemaining'] as const) {
      expect(statusBarModel(s, m, t).text).toBe('🧠 4M');
    }
    expect(statusBarModel(s, 'percentage', t).tooltip).toContain('Capacity unknown');
  });

  it('handles no depletion, exhausted capacity, loading and missing data', () => {
    expect(statusBarModel(makeSnap({ depletionAt: undefined }), 'timeRemaining', t).text).toBe('🧠 5h+ Left');
    expect(statusBarModel(makeSnap({ depletionAt: NOW }), 'timeRemaining', t).text).toBe('🧠 0m Left');
    expect(statusBarModel(undefined, 'percentage', t).text).toBe('🧠 …');
    expect(statusBarModel(makeSnap({ status: 'no-claude-data' }), 'percentage', t).text).toBe('🧠 N/A');
  });

  it('shows tokens and an estimate tooltip when capacity is only estimated', () => {
    const est = makeSnap({ capacity: { tokens: 1000, provider: 'historical-peak', method: 'peak of 5 blocks', confidence: 'low', note: 'n' }, percentUsed: 147 });
    for (const m of ['percentage', 'percentageRemaining', 'tokensRemaining', 'timeRemaining'] as const) {
      const r = statusBarModel(est, m, t);
      expect(r.text).toBe('🧠 4M');
      expect(r.severity).toBe('normal');
    }
    expect(statusBarModel(est, 'percentage', t).tooltip).toContain('~147% of an estimated');
    expect(buildTreeModel(est, false)[0]?.description).toMatch(/^~147%/);
  });

  it('flags severity', () => {
    expect(statusBarModel(makeSnap({ percentUsed: 80 }), 'percentage', t).severity).toBe('warning');
    expect(statusBarModel(makeSnap({ percentUsed: 99 }), 'percentage', t).severity).toBe('error');
  });
});

describe('buildTreeModel', () => {
  it('lists every spec node', () => {
    const nodes = buildTreeModel(makeSnap(), false);
    expect(nodes.map((n) => n.label)).toEqual(['Current Usage', 'Remaining Capacity', 'Window Reset', 'Current Model', 'Input Tokens', 'Output Tokens', 'Cache Tokens', 'Warnings']);
    expect(nodes[0]?.description).toBe('42% (3,977,000 tokens)');
    expect(nodes[6]?.children?.map((c) => c.label)).toEqual(['Cache Read', 'Cache Create']);
    expect(nodes[7]?.description).toBe('None');
  });

  it('hides cache rows and lists warnings', () => {
    const nodes = buildTreeModel(makeSnap({ warnings: ['w1', 'w2'] }), true);
    expect(nodes.some((n) => n.id === 'cache')).toBe(false);
    expect(nodes.at(-1)?.children?.map((c) => c.label)).toEqual(['w1', 'w2']);
  });

  it('covers loading, missing data and unknown capacity', () => {
    expect(buildTreeModel(undefined, false)[0]?.label).toBe('Loading…');
    expect(buildTreeModel(makeSnap({ status: 'no-claude-data' }), false)[0]?.label).toBe('Claude data not found');
    const unk = buildTreeModel(makeSnap({ capacity: undefined, percentUsed: undefined, remainingTokens: undefined }), false);
    expect(unk[0]?.description).toBe('3,977,000 tokens');
    expect(unk[1]?.description).toBe('unknown');
  });
});

describe('dashboard rendering', () => {
  const opts = { nonce: 'N0NCE', cspSource: 'vscode-resource:', hideCache: false, full: true };

  it('renders the spec fields and a strict CSP', () => {
    const html = renderDashboardHtml(makeSnap(), opts);
    for (const text of ['Claude Code Usage', 'Current 5-Hour Window', '1,245,000', '318,000', '2,340,000', '74,000', '3,977,000', 'Opus', '17:24', '15:42:13']) {
      expect(html).toContain(text);
    }
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-N0NCE'");
    expect(html).toContain('<svg');
    expect(html).toContain('Five-hour window history');
  });

  it('hides cache rows and is compact when not full', () => {
    const html = renderDashboardHtml(makeSnap(), { ...opts, hideCache: true, full: false });
    expect(html).not.toContain('Cache Read');
    expect(html).not.toContain('Five-hour window history');
  });

  it('escapes untrusted strings', () => {
    const html = renderDashboardHtml(makeSnap({ warnings: ['<img src=x onerror=alert(1)>'] }), opts);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('renders loading and no-data states', () => {
    expect(renderDashboardHtml(undefined, opts)).toContain('Loading');
    expect(renderDashboardHtml(makeSnap({ status: 'no-claude-data' }), opts)).toContain('Diagnostics');
    expect(renderDashboardHtml(makeSnap({ capacity: undefined, percentUsed: undefined, percentRemaining: undefined, depletionAt: undefined }), opts)).toContain('unknown');
  });

  it('draws a sparkline even for flat or single-point data', () => {
    expect(sparklineSvg([0, 0, 0])).toContain('polyline');
    expect(sparklineSvg([5])).toContain('polyline');
  });
});

describe('export', () => {
  it('builds rows with rolling windows and percentages', () => {
    const rows = buildExportRows(makeSnap());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ input: 1, rolling5hCounted: 1, models: ['m'] });
    expect(rows[0]?.rolling5hPercent).toBeCloseTo(0, 1);
  });

  it('writes valid JSON with every required section', () => {
    const j = JSON.parse(toJsonReport(makeSnap()));
    expect(Object.keys(j)).toEqual(expect.arrayContaining(['generatedAt', 'capacity', 'currentWindow', 'modelUsage', 'windowBlocks', 'hourly']));
    expect(j.currentWindow.percentUsed).toBe(42);
    expect(j.windowBlocks[0].percentOfCapacity).toBeCloseTo(42, 0);
  });

  it('writes CSV with header, escaping and nullable percent', () => {
    const snap = makeSnap({ capacity: undefined, hourly: [{ start: NOW, totals: emptyTotals(), counted: 0, messages: 1, models: ['a,b', 'c"d'] }] });
    const lines = toCsvReport(snap).trim().split('\n');
    expect(lines[0]).toContain('rolling_5h_percent_of_capacity');
    expect(lines[1]).toContain('"a,b;c""d"');
    expect(lines[1]?.endsWith(',0,')).toBe(true);
  });
});
