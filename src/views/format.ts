import type { Settings, DisplayMode } from '../settings/settings';
import type { UsageSnapshot } from '../services/usage-service';

export function formatTokens(n: number): string {
  const abs = Math.abs(n);
  const trim = (x: number): string => x.toFixed(1).replace(/\.0$/, '');
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `${trim(n / 1e3)}K`;
  return String(Math.round(n));
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  if (totalMin < 1) return '<1m';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatClockSeconds(ts: number): string {
  const d = new Date(ts);
  return `${formatClock(ts)}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function friendlyModel(model: string | undefined): string {
  if (!model) return 'n/a';
  const m = /(opus|sonnet|haiku|fable)/i.exec(model);
  return m ? `${(m[1] as string).charAt(0).toUpperCase()}${(m[1] as string).slice(1).toLowerCase()}` : model;
}

export function percentText(p: number): string {
  return `${Math.round(p)}%`;
}

export type Severity = 'normal' | 'warning' | 'error';

export interface StatusBarModel {
  text: string;
  tooltip: string;
  severity: Severity;
}

export function severityFor(pct: number | undefined, thresholds: readonly number[]): Severity {
  if (pct === undefined || thresholds.length === 0) return 'normal';
  const sorted = [...thresholds].sort((a, b) => a - b);
  if (pct >= (sorted[sorted.length - 1] as number)) return 'error';
  if (pct >= (sorted[0] as number)) return 'warning';
  return 'normal';
}

export function statusBarModel(
  snap: UsageSnapshot | undefined,
  mode: DisplayMode,
  thresholds: readonly number[],
): StatusBarModel {
  if (!snap) return { text: '🧠 …', tooltip: 'Claude Usage: loading', severity: 'normal' };
  if (snap.status === 'no-claude-data') {
    return { text: '🧠 N/A', tooltip: 'Claude data not found. Click, then run "Claude Usage: Diagnostics".', severity: 'normal' };
  }

  const used = formatTokens(snap.window.counted);
  const tokensUsed = `🧠 ${used}`;
  // Percent/remaining/time modes only make sense against a capacity the user set.
  const reliable = snap.capacity?.confidence === 'high';
  let text: string;
  switch (reliable ? mode : 'tokensUsed') {
    case 'percentage':
      text = snap.percentUsed === undefined ? tokensUsed : `🧠 ${percentText(snap.percentUsed)}`;
      break;
    case 'percentageRemaining':
      text = snap.percentRemaining === undefined ? tokensUsed : `🧠 ${percentText(snap.percentRemaining)} Left`;
      break;
    case 'tokensUsed':
      text = tokensUsed;
      break;
    case 'tokensRemaining':
      text = snap.remainingTokens === undefined ? tokensUsed : `🧠 ${formatTokens(snap.remainingTokens)} Left`;
      break;
    case 'timeRemaining':
      if (!snap.capacity) text = tokensUsed;
      else if (snap.depletionAt === undefined) text = '🧠 5h+ Left';
      else if (snap.depletionAt <= snap.generatedAt) text = '🧠 0m Left';
      else text = `🧠 ${formatDuration(snap.depletionAt - snap.generatedAt)} Left`;
      break;
  }

  const tip: string[] = [`5-hour window: ${formatNumber(snap.window.counted)} tokens`];
  if (snap.capacity && reliable) {
    tip.push(`${percentText(snap.percentUsed ?? 0)} of ${formatNumber(snap.capacity.tokens)} (${snap.capacity.method})`);
  } else if (snap.capacity) {
    tip.push(`~${percentText(snap.percentUsed ?? 0)} of an estimated ${formatNumber(snap.capacity.tokens)} (${snap.capacity.method})`);
    tip.push('Set claudeUsage.customCapacity to show percentages in the status bar');
  } else tip.push('Capacity unknown — set claudeUsage.customCapacity');
  if (snap.window.resetAt) tip.push(`Oldest usage ages out at ${formatClock(snap.window.resetAt)}`);
  tip.push('Click to open the dashboard');
  return { text, tooltip: tip.join('\n'), severity: severityFor(reliable ? snap.percentUsed : undefined, thresholds) };
}
