import * as vscode from 'vscode';
import type { Logger } from '../logger';
import type { PlatformService } from '../platform/platform-service';
import type { WatchMode } from '../claude/watcher';
import { buildDiagnosticsReport } from '../services/diagnostics-service';
import { toCsvReport, toJsonReport } from '../services/export-service';
import type { UsageService } from '../services/usage-service';
import type { Settings } from '../settings/settings';
import type { DashboardPanel } from '../views/dashboard';

export interface CommandDeps {
  service: UsageService;
  logger: Logger;
  platform: PlatformService;
  dashboard: DashboardPanel;
  getSettings: () => Settings;
  getWatchMode: () => WatchMode;
  version: string;
  /** Called after a cache reset so the host can rediscover and re-watch. */
  onRediscover: () => Promise<void>;
}

export const COMMAND_IDS = [
  'claudeUsage.refresh',
  'claudeUsage.openDashboard',
  'claudeUsage.openDataLocation',
  'claudeUsage.exportReport',
  'claudeUsage.resetCache',
  'claudeUsage.openLogs',
  'claudeUsage.diagnostics',
  'claudeUsage.showRawData',
] as const;

async function openDocument(content: string, language: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content, language });
  await vscode.window.showTextDocument(doc, { preview: true });
}

export function registerCommands(d: CommandDeps): vscode.Disposable[] {
  const reg = (id: (typeof COMMAND_IDS)[number], fn: () => Promise<void> | void): vscode.Disposable =>
    vscode.commands.registerCommand(id, async () => {
      try {
        await fn();
      } catch (err) {
        d.logger.error(`Command ${id} failed`, err);
        void vscode.window.showErrorMessage(`Claude Usage: ${(err as Error).message}`);
      }
    });

  return [
    reg('claudeUsage.refresh', async () => {
      await d.service.rediscover();
      await d.onRediscover();
      await d.service.refresh();
    }),

    reg('claudeUsage.openDashboard', async () => {
      if (!d.getSettings().dashboardEnabled) {
        void vscode.window.showInformationMessage('The Claude Usage dashboard is disabled (claudeUsage.dashboard.enabled).');
        return;
      }
      d.dashboard.show();
    }),

    reg('claudeUsage.openDataLocation', async () => {
      const roots = d.service.roots;
      if (roots.length === 0) {
        const pick = await vscode.window.showWarningMessage(
          'No Claude data directory was found.',
          'Run Diagnostics',
        );
        if (pick) await vscode.commands.executeCommand('claudeUsage.diagnostics');
        return;
      }
      let dir = roots[0]?.dir as string;
      if (roots.length > 1) {
        const picked = await vscode.window.showQuickPick(
          roots.map((r) => ({ label: r.dir, description: r.source })),
          { placeHolder: 'Choose a Claude data location' },
        );
        if (!picked) return;
        dir = picked.label;
      }
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
    }),

    reg('claudeUsage.exportReport', async () => {
      const snap = d.service.getSnapshot();
      if (!snap) {
        void vscode.window.showInformationMessage('No usage data yet.');
        return;
      }
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(d.platform.path.join(d.platform.environment.home, 'claude-usage-report.json')),
        filters: { JSON: ['json'], CSV: ['csv'] },
        saveLabel: 'Export',
      });
      if (!target) return;
      const body = target.path.toLowerCase().endsWith('.csv') ? toCsvReport(snap) : toJsonReport(snap);
      await vscode.workspace.fs.writeFile(target, Buffer.from(body, 'utf8'));
      void vscode.window.showInformationMessage(`Usage report saved to ${target.fsPath}`);
    }),

    reg('claudeUsage.resetCache', async () => {
      await d.service.resetCache();
      await d.service.rediscover();
      await d.onRediscover();
      await d.service.refresh();
      void vscode.window.showInformationMessage('Claude Usage cache reset and data re-scanned.');
    }),

    reg('claudeUsage.openLogs', () => d.logger.show()),

    reg('claudeUsage.diagnostics', async () => {
      const report = buildDiagnosticsReport({
        platform: d.platform,
        service: d.service,
        watchMode: d.getWatchMode(),
        version: d.version,
        recentLogs: d.logger.recent(),
      });
      await openDocument(report, 'markdown');
    }),

    reg('claudeUsage.showRawData', async () => {
      const snap = d.service.getSnapshot();
      const records = d.service.getRecords();
      const recent = records.slice(-100).map((r) => ({ ...r, time: new Date(r.timestamp).toISOString() }));
      await openDocument(
        JSON.stringify({ snapshot: snap ?? null, lastRecords: recent, totalRecords: records.length }, null, 2),
        'json',
      );
    }),
  ];
}
