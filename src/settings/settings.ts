import type { TokenBasis } from '../claude/models';

export type DisplayMode = 'percentage' | 'percentageRemaining' | 'tokensUsed' | 'tokensRemaining' | 'timeRemaining';

export interface Settings {
  refreshInterval: number;
  displayMode: DisplayMode;
  warningThresholds: number[];
  customCapacity: number;
  capacityBasis: TokenBasis;
  hideCacheMetrics: boolean;
  historyRetentionDays: number;
  notificationsEnabled: boolean;
  notifyOnWindowReset: boolean;
  debugLogging: boolean;
  dashboardEnabled: boolean;
  treeViewEnabled: boolean;
  additionalPaths: string[];
}

export const DISPLAY_MODES: readonly DisplayMode[] = [
  'percentage',
  'percentageRemaining',
  'tokensUsed',
  'tokensRemaining',
  'timeRemaining',
];

export const DEFAULT_SETTINGS: Settings = {
  refreshInterval: 60,
  displayMode: 'percentage',
  warningThresholds: [75, 90, 95],
  customCapacity: 0,
  capacityBasis: 'all',
  hideCacheMetrics: false,
  historyRetentionDays: 14,
  notificationsEnabled: true,
  notifyOnWindowReset: true,
  debugLogging: false,
  dashboardEnabled: true,
  treeViewEnabled: true,
  additionalPaths: [],
};

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Validates raw configuration values; invalid values fall back to defaults. */
export function parseSettings(get: (key: string) => unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const mode = get('displayMode');
  const basis = get('capacityBasis');
  const thresholdsRaw = get('warningThresholds');
  const thresholds = Array.isArray(thresholdsRaw)
    ? [...new Set(thresholdsRaw.filter((t): t is number => typeof t === 'number' && t >= 1 && t <= 100))].sort((a, b) => a - b)
    : d.warningThresholds;
  const paths = get('additionalPaths');

  return {
    refreshInterval: num(get('refreshInterval'), d.refreshInterval, 10, 3600),
    displayMode: DISPLAY_MODES.includes(mode as DisplayMode) ? (mode as DisplayMode) : d.displayMode,
    warningThresholds: thresholds,
    customCapacity: Math.floor(num(get('customCapacity'), d.customCapacity, 0, Number.MAX_SAFE_INTEGER)),
    capacityBasis: basis === 'excludeCacheRead' ? 'excludeCacheRead' : 'all',
    hideCacheMetrics: bool(get('hideCacheMetrics'), d.hideCacheMetrics),
    historyRetentionDays: Math.floor(num(get('historyRetentionDays'), d.historyRetentionDays, 1, 365)),
    notificationsEnabled: bool(get('notifications.enabled'), d.notificationsEnabled),
    notifyOnWindowReset: bool(get('notifications.windowReset'), d.notifyOnWindowReset),
    debugLogging: bool(get('debugLogging'), d.debugLogging),
    dashboardEnabled: bool(get('dashboard.enabled'), d.dashboardEnabled),
    treeViewEnabled: bool(get('treeView.enabled'), d.treeViewEnabled),
    additionalPaths: Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : [],
  };
}
