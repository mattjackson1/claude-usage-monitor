import { describeEnvironment } from '../platform/environment';
import type { PlatformService } from '../platform/platform-service';
import type { WatchMode } from '../claude/watcher';
import type { UsageService } from './usage-service';

export interface DiagnosticsInput {
  platform: PlatformService;
  service: UsageService;
  watchMode: WatchMode;
  version: string;
  recentLogs: readonly string[];
}

export function remediationGuidance(platform: PlatformService, service: UsageService): string[] {
  const e = platform.environment;
  const tips: string[] = [];
  if (service.roots.length > 0) return tips;
  tips.push('Claude Code has not written any session data this extension can see. Run `claude` once in a terminal, then run "Claude Usage: Refresh".');
  tips.push('If you use a custom location, set the CLAUDE_CONFIG_DIR environment variable or add the folder to `claudeUsage.additionalPaths` (the folder must contain a `projects` directory).');
  if (e.remoteName) {
    tips.push(
      `This window runs in a remote (${e.remoteName}). The extension reads files on the remote machine, so Claude Code must have been used there. If you use Claude Code on your local machine, install this extension locally or add the path manually.`,
    );
  }
  if (e.os === 'win32' && !e.remoteName) {
    tips.push('If you run Claude Code inside WSL, add its folder, e.g. `\\\\wsl$\\Ubuntu\\home\\<user>\\.claude`, to `claudeUsage.additionalPaths`, or open the folder in a WSL remote window.');
  }
  if (e.isWsl) {
    tips.push('Running in WSL: Windows-side Claude data is probed under /mnt/c/Users/<user>/.claude. If /mnt/c is disabled, use `claudeUsage.additionalPaths`.');
  }
  return tips;
}

export function buildDiagnosticsReport(i: DiagnosticsInput): string {
  const { platform, service } = i;
  const snap = service.getSnapshot();
  const lines: string[] = [];
  lines.push('# Claude Usage Diagnostics', '');
  lines.push(`- Extension version: ${i.version}`);
  lines.push(`- Environment: ${describeEnvironment(platform.environment)}`);
  lines.push(`- Home: ${platform.environment.home}`);
  lines.push(`- Watcher mode: ${i.watchMode}`);
  lines.push(`- Cache restored: ${service.cacheRestored ? 'yes' : 'no'}`);
  lines.push(`- Last refresh: ${service.lastRefreshDurationMs} ms`);
  if (service.lastError) lines.push(`- Last error: ${service.lastError}`);
  lines.push('', '## Discovery attempts', '');
  if (service.discovery.attempts.length === 0) lines.push('(none yet)');
  for (const a of service.discovery.attempts) {
    lines.push(`- [${a.status}] ${a.path} — ${a.source}${a.detail ? ` (${a.detail})` : ''}`);
  }
  const s = service.stats;
  lines.push('', '## Parser statistics (this session)', '');
  lines.push(`- Lines read: ${s.lines}`);
  lines.push(`- Usage records parsed: ${s.records}`);
  lines.push(`- Ignored lines: ${s.ignored}`);
  lines.push(`- Malformed lines: ${s.malformed}`);
  lines.push(`- Schema mismatches: ${s.schemaMismatches}`);
  for (const [k, v] of Object.entries(s.warnings)) lines.push(`- Field warning ${k}: ${v}`);
  if (s.samples.length) {
    lines.push('', 'Samples:');
    for (const x of s.samples) lines.push(`- ${x}`);
  }
  if (snap) {
    lines.push('', '## Current state', '');
    lines.push(`- Status: ${snap.status}`);
    lines.push(`- Retained records (de-duplicated): ${snap.recordCount}`);
    lines.push(`- Messages in window: ${snap.window.messageCount}`);
    lines.push(`- Capacity: ${snap.capacity ? `${snap.capacity.tokens} (${snap.capacity.method}, ${snap.capacity.confidence} confidence)` : 'unknown'}`);
    for (const w of snap.warnings) lines.push(`- Warning: ${w}`);
  }
  const tips = remediationGuidance(platform, service);
  if (tips.length) {
    lines.push('', '## Suggested fixes', '');
    for (const t of tips) lines.push(`- ${t}`);
  }
  lines.push('', '## Recent log', '', '```');
  lines.push(...i.recentLogs.slice(-40), '```');
  return lines.join('\n');
}
