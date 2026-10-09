// Runs the core pipeline against your real Claude data and prints a summary.
import { createNodePlatformService } from '../src/platform/platform-service';
import { Logger } from '../src/logger';
import { UsageService } from '../src/services/usage-service';
import { CacheStore } from '../src/storage/cache';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import { statusBarModel, formatNumber } from '../src/views/format';
import { buildDiagnosticsReport } from '../src/services/diagnostics-service';
import { NodeFileSystem } from '../src/platform/filesystem';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const platform = createNodePlatformService();
const logger = new Logger({ appendLine: () => undefined });
const cache = new CacheStore(new NodeFileSystem(), join(tmpdir(), `claude-usage-smoke-${process.pid}.json`));
const service = new UsageService({ platform, cache, logger, getSettings: () => DEFAULT_SETTINGS });

const t0 = Date.now();
const snap = await service.initialize();
const ms = Date.now() - t0;
console.log(`initial load: ${ms} ms, roots: ${service.roots.map((r) => r.dir).join(', ') || 'none'}`);
console.log(`files parsed lines=${service.stats.lines} records(raw)=${service.stats.records} deduped=${snap.recordCount} malformed=${service.stats.malformed} mismatches=${service.stats.schemaMismatches}`);
console.log(`window: ${formatNumber(snap.window.counted)} tokens in ${snap.window.messageCount} msgs; model=${snap.window.currentModel}`);
console.log(`capacity: ${snap.capacity ? `${formatNumber(snap.capacity.tokens)} (${snap.capacity.method})` : 'unknown'}; used=${snap.percentUsed?.toFixed(1)}%`);
for (const mode of ['percentage', 'percentageRemaining', 'tokensUsed', 'tokensRemaining', 'timeRemaining'] as const) {
  console.log(`  ${mode}: ${statusBarModel(snap, mode, [75, 90, 95]).text}`);
}
const t1 = Date.now();
await service.refresh();
console.log(`incremental refresh: ${Date.now() - t1} ms`);
if (process.argv.includes('--diagnostics')) console.log(buildDiagnosticsReport({ platform, service, watchMode: 'stopped', version: 'smoke', recentLogs: logger.recent() }));
await service.flush();
await cache.clear();
