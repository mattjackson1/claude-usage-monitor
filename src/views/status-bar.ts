import * as vscode from 'vscode';
import type { Settings } from '../settings/settings';
import type { UsageSnapshot } from '../services/usage-service';
import { statusBarModel } from './format';

export const OPEN_DASHBOARD = 'claudeUsage.openDashboard';

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = OPEN_DASHBOARD;
    this.item.name = 'Claude Usage';
    this.update(undefined, undefined);
    this.item.show();
  }

  update(snap: UsageSnapshot | undefined, settings: Settings | undefined): void {
    const m = statusBarModel(snap, settings?.displayMode ?? 'percentage', settings?.warningThresholds ?? []);
    this.item.text = m.text;
    this.item.tooltip = m.tooltip;
    this.item.backgroundColor =
      m.severity === 'error'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : m.severity === 'warning'
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
