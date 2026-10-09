import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { UsageSnapshot } from '../services/usage-service';
import { renderDashboardHtml } from './webview/render';

function nonce(): string {
  return randomBytes(16).toString('hex');
}

type Handlers = { onRefresh: () => void; onOpenUsagePage: () => void; hideCache: () => boolean };

function handleMessage(m: { type?: string } | undefined, h: Handlers): void {
  if (m?.type === 'refresh') h.onRefresh();
  else if (m?.type === 'openUsagePage') h.onOpenUsagePage();
}

/** Full dashboard in an editor tab. */
export class DashboardPanel {
  private panel: vscode.WebviewPanel | undefined;
  private snap: UsageSnapshot | undefined;

  constructor(private readonly h: Handlers) {}

  update(snap: UsageSnapshot | undefined): void {
    this.snap = snap;
    this.render();
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = vscode.window.createWebviewPanel('claudeUsage.dashboard', 'Claude Usage', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: false,
    });
    this.panel.onDidDispose(() => (this.panel = undefined));
    this.panel.webview.onDidReceiveMessage((m: { type?: string }) => handleMessage(m, this.h));
    this.render();
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private render(): void {
    if (!this.panel) return;
    this.panel.webview.html = renderDashboardHtml(this.snap, {
      nonce: nonce(),
      cspSource: this.panel.webview.cspSource,
      hideCache: this.h.hideCache(),
      full: true,
    });
  }
}

/** Compact summary in the Activity Bar. */
export class SummaryViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'claudeUsage.summary';
  private view: vscode.WebviewView | undefined;
  private snap: UsageSnapshot | undefined;

  constructor(private readonly h: Handlers) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.onDidDispose(() => (this.view = undefined));
    view.webview.onDidReceiveMessage((m: { type?: string }) => handleMessage(m, this.h));
    this.render();
  }

  update(snap: UsageSnapshot | undefined): void {
    this.snap = snap;
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    this.view.webview.html = renderDashboardHtml(this.snap, {
      nonce: nonce(),
      cspSource: this.view.webview.cspSource,
      hideCache: this.h.hideCache(),
      full: false,
    });
  }
}
