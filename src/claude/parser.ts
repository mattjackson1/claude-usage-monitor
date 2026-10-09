import type { FileSystem } from '../platform/filesystem';
import type { UsageRecord } from './models';
import { parseUsageLine } from './schema';

export interface FileCursor {
  /** Byte offset just past the last fully consumed newline. */
  offset: number;
  size: number;
  mtimeMs: number;
}

export interface ParseStats {
  lines: number;
  records: number;
  ignored: number;
  malformed: number;
  schemaMismatches: number;
  /** Warning code -> count (e.g. "missing:cache_read_input_tokens"). */
  warnings: Record<string, number>;
  /** Up to MAX_SAMPLES human-readable problem samples. */
  samples: string[];
}

const MAX_SAMPLES = 10;
const INITIAL_CHUNK = 16 * 1024 * 1024;

export function emptyStats(): ParseStats {
  return { lines: 0, records: 0, ignored: 0, malformed: 0, schemaMismatches: 0, warnings: {}, samples: [] };
}

export function mergeStats(into: ParseStats, from: ParseStats): void {
  into.lines += from.lines;
  into.records += from.records;
  into.ignored += from.ignored;
  into.malformed += from.malformed;
  into.schemaMismatches += from.schemaMismatches;
  for (const [k, v] of Object.entries(from.warnings)) into.warnings[k] = (into.warnings[k] ?? 0) + v;
  for (const s of from.samples) if (into.samples.length < MAX_SAMPLES) into.samples.push(s);
}

export interface ReadResult {
  records: UsageRecord[];
  cursor: FileCursor;
  stats: ParseStats;
  /** True when the file shrank and was re-read from the start. */
  reset: boolean;
  changed: boolean;
}

/**
 * Reads only the bytes appended since `cursor`. A trailing partial line (a
 * write in progress) is left for the next call. Returns undefined when the
 * file no longer exists.
 */
export async function readNewRecords(
  fs: FileSystem,
  file: string,
  cursor: FileCursor | undefined,
): Promise<ReadResult | undefined> {
  const stat = await fs.stat(file);
  if (!stat || !stat.isFile) return undefined;

  const stats = emptyStats();
  let offset = cursor?.offset ?? 0;
  let reset = false;
  if (cursor && stat.size < cursor.offset) {
    offset = 0;
    reset = true;
  } else if (cursor && stat.size === cursor.size && stat.mtimeMs === cursor.mtimeMs) {
    return { records: [], cursor, stats, reset: false, changed: false };
  }

  const records: UsageRecord[] = [];
  let chunk = INITIAL_CHUNK;
  while (offset < stat.size) {
    const end = Math.min(offset + chunk, stat.size);
    const buf = await fs.readRange(file, offset, end);
    const lastNewline = buf.lastIndexOf(0x0a);
    if (lastNewline === -1) {
      if (end < stat.size) {
        chunk *= 2; // a single line longer than the chunk
        continue;
      }
      break; // partial final line: wait for the writer to finish it
    }
    const text = buf.subarray(0, lastNewline).toString('utf8');
    for (const line of text.split('\n')) {
      stats.lines++;
      const r = parseUsageLine(line);
      switch (r.kind) {
        case 'record':
          stats.records++;
          records.push(r.record);
          for (const w of r.warnings) stats.warnings[w] = (stats.warnings[w] ?? 0) + 1;
          break;
        case 'ignored':
          stats.ignored++;
          break;
        case 'malformed':
          stats.malformed++;
          if (stats.samples.length < MAX_SAMPLES) stats.samples.push(`${file}: malformed JSON (${r.reason})`);
          break;
        case 'schema-mismatch':
          stats.schemaMismatches++;
          if (stats.samples.length < MAX_SAMPLES) stats.samples.push(`${file}: schema mismatch (${r.reason})`);
          break;
      }
    }
    offset += lastNewline + 1;
  }

  return {
    records,
    cursor: { offset, size: stat.size, mtimeMs: stat.mtimeMs },
    stats,
    reset,
    changed: true,
  };
}
