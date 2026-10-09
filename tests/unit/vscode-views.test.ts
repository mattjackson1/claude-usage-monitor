import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPanel, SummaryViewProvider } from '../../src/views/dashboard';
import { StatusBarController } from '../../src/views/status-bar';
import { UsageTreeProvider } from '../../src/views/tree-provider';
import type { UsageSnapshot } from '../../src/services/usage-service';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import * as mock from '../mocks/vscode';
import { emptyTotals } from '../../src/claude/models';

const snap = {
  generatedAt: Date.now(),
  status: 'ok',
  basis: 'all',
  window: { totals: { ...emptyTotals(), input: 5, total: 5 }, counted: 5, messageCount: 1, sessionCount: 1, byModel: [], currentModel: 'claude-opus-5-5' },
  capacity: { tokens: 100, provider: 'user-configured', method: 'm', confidence: 'high', note: 'n' },
  burnRatePerMinute: 0,
  sparkline: [0, 1],
  hourly: [],
  peaks: [],
  blocks: [],
  recordCount: 1,
  warnings: ['careful'],
} as unknown as UsageSnapshot;

beforeEach(() => mock.resetMock());

describe('UsageTreeProvider', () => {
  it('maps nodes to tree items and fires change events', () => {
    const p = new UsageTreeProvider(() => false);
    const changed = vi.fn();
    p.onDidChangeTreeData(changed);
    expect(p.getChildren()[0]?.label).toBe('Loading…');
    p.update(snap);
    expect(changed).toHaveBeenCalled();
    const roots = p.getChildren();
    const cache = roots.find((n) => n.id === 'cache');
    const item = p.getTreeItem(cache!);
    expect(item.collapsibleState).toBe(mock.TreeItemCollapsibleState.Collapsed);
    expect((item.iconPath as { id: string }).id).toBe('database');
    expect(p.getChildren(cache)).toHaveLength(2);
    expect(p.getTreeItem(roots[0]!).collapsibleState).toBe(mock.TreeItemCollapsibleState.None);
  });

  it('respects hideCache', () => {
    const p = new UsageTreeProvider(() => true);
    p.update(snap);
    expect(p.getChildren().some((n) => n.id === 'cache')).toBe(false);
  });
});

describe('StatusBarController', () => {
  it('updates text, tooltip and severity colour', () => {
    const c = new StatusBarController();
    const item = mock.statusBarItems[0]!;
    expect(item.text).toBe('🧠 …');
    c.update({ ...snap, percentUsed: 99 } as UsageSnapshot, DEFAULT_SETTINGS);
    expect(item.text).toBe('🧠 99%');
    expect((item.backgroundColor as { id: string }).id).toBe('statusBarItem.errorBackground');
    c.update({ ...snap, percentUsed: 80 } as UsageSnapshot, DEFAULT_SETTINGS);
    expect((item.backgroundColor as { id: string }).id).toBe('statusBarItem.warningBackground');
    c.update({ ...snap, percentUsed: 10 } as UsageSnapshot, DEFAULT_SETTINGS);
    expect(item.backgroundColor).toBeUndefined();
    c.dispose();
    expect(item.shown).toBe(false);
  });
});

describe('DashboardPanel', () => {
  it('creates one panel, renders snapshots, handles refresh messages and disposal', () => {
    const onRefresh = vi.fn();
    const d = new DashboardPanel({ onRefresh, hideCache: () => false });
    d.update(snap); // no panel yet: no-op
    d.show();
    d.show();
    expect(mock.panels).toHaveLength(1);
    expect(mock.panels[0]?.revealed).toBe(1);
    expect(mock.panels[0]?.webview.html).toContain('Claude Code Usage');
    d.update(snap);
    expect(mock.panels[0]?.webview.html).toContain('careful');
    mock.panels[0]?.fire({ type: 'refresh' });
    mock.panels[0]?.fire({ type: 'other' });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    d.dispose();
    d.show();
    expect(mock.panels).toHaveLength(2);
  });
});

describe('SummaryViewProvider', () => {
  it('renders into the resolved view and ignores updates before resolve', () => {
    const onRefresh = vi.fn();
    const p = new SummaryViewProvider({ onRefresh, hideCache: () => true });
    p.update(snap);
    let handler: (m: unknown) => void = () => undefined;
    const view = {
      webview: { html: '', options: {}, cspSource: 'x', onDidReceiveMessage: (h: (m: unknown) => void) => { handler = h; } },
      onDidDispose: (h: () => void) => { disposed = h; },
    };
    let disposed: () => void = () => undefined;
    p.resolveWebviewView(view as never);
    expect(view.webview.html).toContain('Claude Code Usage');
    expect(view.webview.html).not.toContain('Cache Read');
    handler({ type: 'refresh' });
    expect(onRefresh).toHaveBeenCalled();
    disposed();
    p.update(snap); // disposed view: no throw
  });
});
