import { rollingHourly } from './aggregation-service';
import type { UsageSnapshot } from './usage-service';

export interface ExportRow {
  hourStart: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  total: number;
  counted: number;
  messages: number;
  models: string[];
  rolling5hCounted: number;
  rolling5hPercent: number | null;
}

export function buildExportRows(snapshot: UsageSnapshot): ExportRow[] {
  const rolling = rollingHourly(snapshot.hourly);
  const cap = snapshot.capacity?.tokens;
  return snapshot.hourly.map((h, i) => ({
    hourStart: new Date(h.start).toISOString(),
    input: h.totals.input,
    output: h.totals.output,
    cacheCreate: h.totals.cacheCreate,
    cacheRead: h.totals.cacheRead,
    total: h.totals.total,
    counted: h.counted,
    messages: h.messages,
    models: h.models,
    rolling5hCounted: rolling[i] as number,
    rolling5hPercent: cap ? Math.round(((rolling[i] as number) / cap) * 1000) / 10 : null,
  }));
}

export function toJsonReport(snapshot: UsageSnapshot): string {
  return JSON.stringify(
    {
      generatedAt: new Date(snapshot.generatedAt).toISOString(),
      basis: snapshot.basis,
      capacity: snapshot.capacity ?? null,
      currentWindow: {
        ...snapshot.window,
        oldest: snapshot.window.oldest ? new Date(snapshot.window.oldest).toISOString() : null,
        resetAt: snapshot.window.resetAt ? new Date(snapshot.window.resetAt).toISOString() : null,
        newest: snapshot.window.newest ? new Date(snapshot.window.newest).toISOString() : null,
        percentUsed: snapshot.percentUsed ?? null,
      },
      modelUsage: snapshot.window.byModel,
      windowBlocks: snapshot.blocks.map((b) => ({
        ...b,
        start: new Date(b.start).toISOString(),
        end: new Date(b.end).toISOString(),
        percentOfCapacity: snapshot.capacity ? Math.round((b.counted / snapshot.capacity.tokens) * 1000) / 10 : null,
      })),
      hourly: buildExportRows(snapshot),
    },
    null,
    2,
  );
}

function csvCell(v: string | number | null): string {
  if (v === null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsvReport(snapshot: UsageSnapshot): string {
  const header = [
    'hour_start_utc',
    'input_tokens',
    'output_tokens',
    'cache_creation_tokens',
    'cache_read_tokens',
    'total_tokens',
    'counted_tokens',
    'messages',
    'models',
    'rolling_5h_counted_tokens',
    'rolling_5h_percent_of_capacity',
  ];
  const rows = buildExportRows(snapshot).map((r) =>
    [
      r.hourStart,
      r.input,
      r.output,
      r.cacheCreate,
      r.cacheRead,
      r.total,
      r.counted,
      r.messages,
      r.models.join(';'),
      r.rolling5hCounted,
      r.rolling5hPercent,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n') + '\n';
}
