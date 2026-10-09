import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { COMMAND_IDS } from '../../src/commands';
import { activate, deactivate } from '../../src/extension';
import * as mock from '../mocks/vscode';
import { assistantLines, makeTmp, writeJsonl } from '../helpers';

type Ctx = Parameters<typeof activate>[0];

async function boot(withData: boolean) {
  const home = await makeTmp('cum-ext-');
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(home, '.claude'));
  if (withData) {
    const now = Date.now();
    await writeJsonl(
      path.join(home, '.claude', 'projects', '-p', 's.jsonl'),
      assistantLines({ id: 'a', ts: now - 60_000 }) + assistantLines({ id: 'b', ts: now - 30_000, model: 'claude-sonnet-5-5' }),
    );
  }
  const ctx = { subscriptions: [] as { dispose(): void }[], globalStorageUri: { fsPath: path.join(home, 'storage') }, extension: { packageJSON: { version: '9.9.9' } } } as unknown as Ctx;
  const api = await activate(ctx);
  return { home, ctx, api };
}

const run = (id: string) => vscode.commands.executeCommand(id);

describe('extension activation', () => {
  beforeEach(() => mock.resetMock());
  afterEach(async () => {
    await deactivate();
    vi.unstubAllEnvs();
  });

  it('registers every command and a status bar item', async () => {
    const { ctx, api } = await boot(true);
    for (const id of COMMAND_IDS) expect(mock.registeredCommands.has(id), id).toBe(true);
    expect(api.commandIds).toEqual(COMMAND_IDS);
    expect(mock.statusBarItems).toHaveLength(1);
    const item = mock.statusBarItems[0];
    expect(item?.command).toBe('claudeUsage.openDashboard');
    expect(item?.shown).toBe(true);
    expect(item?.text).toMatch(/^🧠 /);
    expect(item?.text).not.toBe('🧠 …');
    ctx.subscriptions.forEach((d) => d.dispose());
  });

  it('shows N/A and diagnostics advice when no Claude data exists', async () => {
    const { ctx } = await boot(false);
    expect(mock.statusBarItems[0]?.text).toBe('🧠 N/A');
    await run('claudeUsage.diagnostics');
    const doc = mock.openedDocs.at(-1);
    expect(doc?.language).toBe('markdown');
    expect(doc?.content).toContain('[missing]');
    expect(doc?.content).toContain('Suggested fixes');
    await run('claudeUsage.openDataLocation');
    expect(mock.shown.at(-1)?.message).toContain('No Claude data directory');
    ctx.subscriptions.forEach((d) => d.dispose());
  });

  it('runs commands end to end with real data', async () => {
    const { ctx, home, api } = await boot(true);

    await run('claudeUsage.refresh');
    expect(api.service.getSnapshot()?.recordCount).toBe(2);

    await run('claudeUsage.showRawData');
    const raw = JSON.parse(mock.openedDocs.at(-1)?.content ?? '{}');
    expect(raw.totalRecords).toBe(2);
    expect(raw.lastRecords).toHaveLength(2);

    await run('claudeUsage.diagnostics');
    expect(mock.openedDocs.at(-1)?.content).toContain('[found]');

    await run('claudeUsage.openDataLocation');
    expect(mock.state.executed.at(-1)).toMatchObject({ id: 'revealFileInOS' });

    mock.state.saveTarget = { path: path.join(home, 'out.csv'), fsPath: path.join(home, 'out.csv') };
    await run('claudeUsage.exportReport');
    expect(mock.written.get(mock.state.saveTarget.fsPath)).toContain('hour_start_utc');
    mock.state.saveTarget = { path: path.join(home, 'out.json'), fsPath: path.join(home, 'out.json') };
    await run('claudeUsage.exportReport');
    expect(JSON.parse(mock.written.get(mock.state.saveTarget.fsPath) ?? '{}').hourly).toHaveLength(1);

    mock.state.saveTarget = undefined; // user cancels the dialog
    const writesBefore = mock.written.size;
    await run('claudeUsage.exportReport');
    expect(mock.written.size).toBe(writesBefore);

    await run('claudeUsage.resetCache');
    expect(mock.shown.at(-1)?.message).toContain('cache reset');
    expect(api.service.getSnapshot()?.recordCount).toBe(2);

    await run('claudeUsage.openLogs');
    await run('claudeUsage.openDashboard');
    ctx.subscriptions.forEach((d) => d.dispose());
  });

  it('respects the dashboard-disabled setting', async () => {
    mock.state.configuration = { 'dashboard.enabled': false };
    const { ctx } = await boot(true);
    await run('claudeUsage.openDashboard');
    expect(mock.shown.at(-1)?.message).toContain('disabled');
    ctx.subscriptions.forEach((d) => d.dispose());
  });

  it('wraps command failures in an error message instead of throwing', async () => {
    const { ctx, api } = await boot(true);
    vi.spyOn(api.service, 'rediscover').mockRejectedValueOnce(new Error('disk on fire'));
    await run('claudeUsage.refresh');
    expect(mock.shown.at(-1)).toEqual({ kind: 'error', message: 'Claude Usage: disk on fire' });
    ctx.subscriptions.forEach((d) => d.dispose());
  });

  it('applies the display mode setting to the status bar', async () => {
    mock.state.configuration = { displayMode: 'tokensUsed' };
    const { ctx } = await boot(true);
    expect(mock.statusBarItems[0]?.text).toMatch(/^🧠 \d/);
    ctx.subscriptions.forEach((d) => d.dispose());
  });
});
