import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CLAUDE_USAGE_PAGE_URL } from '../../src/constants';
import { registerCommands } from '../../src/commands';
import { DashboardPanel, SummaryViewProvider } from '../../src/views/dashboard';
import { renderDashboardHtml } from '../../src/views/webview/render';
import * as mock from '../mocks/vscode';

const opts = { nonce: 'N', cspSource: 'x', hideCache: false, full: true };

beforeEach(() => mock.resetMock());

describe('claude.ai usage page control', () => {
  it('uses the exact settings URL', () => {
    expect(CLAUDE_USAGE_PAGE_URL).toBe('https://claude.ai/new#settings/usage');
  });

  it('appears in every dashboard state, including loading and no-data', () => {
    for (const html of [
      renderDashboardHtml(undefined, opts),
      renderDashboardHtml({ status: 'no-claude-data' } as never, opts),
      renderDashboardHtml({ status: 'ok', window: { totals: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 }, byModel: [] }, sparkline: [], blocks: [], peaks: [], warnings: [], generatedAt: 0 } as never, { ...opts, full: false }),
    ]) {
      expect(html).toContain('id="usage-page"');
      expect(html).toContain('Open claude.ai usage page');
      expect(html).toContain("type:'openUsagePage'");
    }
  });

  it('the command opens the page externally', async () => {
    registerCommands({ service: {}, logger: {}, platform: {}, dashboard: {}, getSettings: () => ({}), getWatchMode: () => 'stopped', version: 'x', onRediscover: async () => undefined } as never);
    await vscode.commands.executeCommand('claudeUsage.openUsagePage');
    expect(mock.opened).toEqual([CLAUDE_USAGE_PAGE_URL]);
  });

  it('webview messages from the panel and the sidebar trigger it', () => {
    const onOpenUsagePage = vi.fn();
    const h = { onRefresh: vi.fn(), onOpenUsagePage, hideCache: () => false };
    new DashboardPanel(h).show();
    mock.panels[0]?.fire({ type: 'openUsagePage' });
    expect(onOpenUsagePage).toHaveBeenCalledTimes(1);

    let handler: (m: unknown) => void = () => undefined;
    const view = { webview: { html: '', options: {}, cspSource: 'x', onDidReceiveMessage: (f: (m: unknown) => void) => { handler = f; } }, onDidDispose: () => undefined };
    new SummaryViewProvider(h).resolveWebviewView(view as never);
    handler({ type: 'openUsagePage' });
    expect(onOpenUsagePage).toHaveBeenCalledTimes(2);
    expect(h.onRefresh).not.toHaveBeenCalled();
  });
});
