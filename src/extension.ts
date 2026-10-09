import * as vscode from 'vscode';
import * as path from 'node:path';
import { ClaudeWatcher } from './claude/watcher';
import { COMMAND_IDS, registerCommands } from './commands';
import { Logger } from './logger';
import { createNodePlatformService } from './platform/platform-service';
import { evaluateNotifications, type NotificationEvent } from './services/notification-service';
import { UsageService, type UsageSnapshot } from './services/usage-service';
import { parseSettings, type Settings } from './settings/settings';
import { CacheStore } from './storage/cache';
import { DashboardPanel, SummaryViewProvider } from './views/dashboard';
import { StatusBarController } from './views/status-bar';
import { UsageTreeProvider } from './views/tree-provider';

export interface ExtensionApi {
  service: UsageService;
  commandIds: readonly string[];
}

let activeService: UsageService | undefined;

function readSettings(): Settings {
  const cfg = vscode.workspace.getConfiguration('claudeUsage');
  return parseSettings((key) => cfg.get(key));
}

function showNotification(e: NotificationEvent): void {
  if (e.kind === 'reset') {
    void vscode.window.showInformationMessage('Claude Usage: your 5-hour window has reset.');
  } else {
    const msg = `Claude Usage: ${Math.round(e.percent)}% of your 5-hour window used (threshold ${e.threshold}%).`;
    const show = e.threshold >= 90 ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    void show(msg);
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi> {
  const channel = vscode.window.createOutputChannel('Claude Usage');
  const logger = new Logger(channel);
  let settings = readSettings();
  logger.debugEnabled = settings.debugLogging;

  const platform = createNodePlatformService(vscode.env.remoteName);
  const version = (context.extension?.packageJSON as { version?: string } | undefined)?.version ?? 'dev';
  const cache = new CacheStore(platform.fs, path.join(context.globalStorageUri.fsPath, 'usage-cache-v1.json'));
  const service = new UsageService({ platform, cache, logger, getSettings: () => settings });

  activeService = service;
  const statusBar = new StatusBarController();
  const tree = new UsageTreeProvider(() => settings.hideCacheMetrics);
  const handlers = { onRefresh: () => void service.refresh(), hideCache: () => settings.hideCacheMetrics };
  const dashboard = new DashboardPanel(handlers);
  const summary = new SummaryViewProvider(handlers);

  const watcher = new ClaudeWatcher(
    platform.fs,
    platform.path.join,
    (paths) => void service.refresh({ paths }),
    logger,
  );
  const restartWatcher = async (): Promise<void> => {
    watcher.start(service.roots.map((r) => r.projectsDir));
  };

  const render = (snap: UsageSnapshot): void => {
    statusBar.update(snap, settings);
    tree.update(snap);
    summary.update(snap);
    dashboard.update(snap);
    for (const e of evaluateNotifications(snap, settings, service.notificationState)) showNotification(e);
  };
  const unsubscribe = service.onDidUpdate(render);

  let timer: ReturnType<typeof setInterval> | undefined;
  const startTimer = (): void => {
    if (timer) clearInterval(timer);
    timer = setInterval(() => void service.refresh(), settings.refreshInterval * 1000);
  };

  context.subscriptions.push(
    channel,
    statusBar,
    { dispose: unsubscribe },
    { dispose: () => timer && clearInterval(timer) },
    { dispose: () => watcher.stop() },
    { dispose: () => dashboard.dispose() },
    vscode.window.registerTreeDataProvider('claudeUsage.tree', tree),
    vscode.window.registerWebviewViewProvider(SummaryViewProvider.viewType, summary),
    ...registerCommands({
      service,
      logger,
      platform,
      dashboard,
      getSettings: () => settings,
      getWatchMode: () => watcher.mode,
      version,
      onRediscover: restartWatcher,
    }),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration('claudeUsage')) return;
      settings = readSettings();
      logger.debugEnabled = settings.debugLogging;
      startTimer();
      if (e.affectsConfiguration('claudeUsage.additionalPaths')) {
        await service.rediscover();
        await restartWatcher();
      }
      await service.refresh();
    }),
  );

  try {
    await service.initialize();
    await restartWatcher();
  } catch (err) {
    logger.error('Initialisation failed', err);
  }
  startTimer();

  return { service, commandIds: COMMAND_IDS };
}

export async function deactivate(): Promise<void> {
  await activeService?.flush();
  activeService = undefined;
}
