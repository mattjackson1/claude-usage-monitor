import * as vscode from 'vscode';
import type { UsageSnapshot } from '../services/usage-service';
import { formatClock, formatDuration, formatNumber, friendlyModel, percentText } from './format';

export interface TreeNode {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  children?: TreeNode[];
}

export function buildTreeModel(snap: UsageSnapshot | undefined, hideCache: boolean): TreeNode[] {
  if (!snap) return [{ id: 'loading', label: 'Loading…', icon: 'sync' }];
  if (snap.status === 'no-claude-data') {
    return [{ id: 'nodata', label: 'Claude data not found', description: 'Run Diagnostics', icon: 'warning' }];
  }
  const w = snap.window;
  const nodes: TreeNode[] = [
    {
      id: 'current',
      label: 'Current Usage',
      description:
        snap.percentUsed === undefined
          ? `${formatNumber(w.counted)} tokens`
          : `${snap.capacity?.confidence === 'high' ? '' : '~'}${percentText(snap.percentUsed)} (${formatNumber(w.counted)} tokens)`,
      icon: 'pulse',
    },
    {
      id: 'remaining',
      label: 'Remaining Capacity',
      description:
        snap.remainingTokens === undefined
          ? 'unknown'
          : `${percentText(snap.percentRemaining ?? 0)} (${formatNumber(snap.remainingTokens)} tokens)`,
      tooltip: snap.capacity ? `${snap.capacity.method}\n${snap.capacity.note}` : 'Set claudeUsage.customCapacity',
      icon: 'dashboard',
    },
    {
      id: 'reset',
      label: 'Window Reset',
      description: w.resetAt ? `${formatClock(w.resetAt)} (in ${formatDuration(w.resetAt - snap.generatedAt)})` : 'no usage in window',
      tooltip: 'When the oldest usage in the rolling 5-hour window ages out',
      icon: 'history',
    },
    { id: 'model', label: 'Current Model', description: friendlyModel(w.currentModel), tooltip: w.currentModel, icon: 'hubot' },
    { id: 'input', label: 'Input Tokens', description: formatNumber(w.totals.input), icon: 'arrow-down' },
    { id: 'output', label: 'Output Tokens', description: formatNumber(w.totals.output), icon: 'arrow-up' },
  ];
  if (!hideCache) {
    nodes.push({
      id: 'cache',
      label: 'Cache Tokens',
      description: formatNumber(w.totals.cacheRead + w.totals.cacheCreate),
      icon: 'database',
      children: [
        { id: 'cache-read', label: 'Cache Read', description: formatNumber(w.totals.cacheRead) },
        { id: 'cache-create', label: 'Cache Create', description: formatNumber(w.totals.cacheCreate) },
      ],
    });
  }
  nodes.push({
    id: 'warnings',
    label: 'Warnings',
    description: snap.warnings.length === 0 ? 'None' : String(snap.warnings.length),
    icon: snap.warnings.length ? 'warning' : 'check',
    children: snap.warnings.map((m, i) => ({ id: `warning-${i}`, label: m })),
  });
  return nodes;
}

export class UsageTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private snap: UsageSnapshot | undefined;

  constructor(private readonly hideCache: () => boolean) {}

  update(snap: UsageSnapshot | undefined): void {
    this.snap = snap;
    this.emitter.fire(undefined);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children?.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip ?? node.label;
    if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon);
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    return node ? (node.children ?? []) : buildTreeModel(this.snap, this.hideCache());
  }
}
