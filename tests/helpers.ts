import { mkdtemp, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { DirEntry, FileStat, FileSystem, WatchHandle } from '../src/platform/filesystem';
import type { UsageRecord } from '../src/claude/models';

export interface LineOpts {
  id?: string;
  ts?: string | number;
  model?: string;
  input?: number;
  output?: number;
  cc?: number;
  cr?: number;
  sidechain?: boolean;
  sessionId?: string;
  requestId?: string;
  blocks?: number;
}

/** Builds the JSONL line(s) Claude Code writes: one line per content block. */
export function assistantLines(o: LineOpts = {}): string {
  const id = o.id ?? 'msg_1';
  const ts = typeof o.ts === 'number' ? new Date(o.ts).toISOString() : (o.ts ?? '2026-10-06T15:00:00.000Z');
  const kinds = ['thinking', 'text', 'tool_use'];
  const n = o.blocks ?? 1;
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    lines.push(
      JSON.stringify({
        parentUuid: null,
        isSidechain: o.sidechain ?? false,
        type: 'assistant',
        uuid: `${id}-u${i}`,
        timestamp: ts,
        sessionId: o.sessionId ?? 's1',
        requestId: o.requestId ?? `req_${id}`,
        apiBlockIndex: i,
        message: {
          id,
          model: o.model ?? 'claude-opus-5-5',
          role: 'assistant',
          content: [{ type: kinds[i % 3] }],
          usage: {
            input_tokens: o.input ?? 10,
            output_tokens: o.output ?? 20,
            cache_creation_input_tokens: o.cc ?? 30,
            cache_read_input_tokens: o.cr ?? 40,
          },
        },
      }),
    );
  }
  return lines.join('\n') + '\n';
}

export function rec(o: Partial<UsageRecord> & { id: string; timestamp: number }): UsageRecord {
  return {
    sessionId: 's1',
    model: 'claude-opus-5-5',
    input: 10,
    output: 20,
    cacheCreate: 30,
    cacheRead: 40,
    sidechain: false,
    ...o,
  };
}

export async function makeTmp(prefix = 'cum-'): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function writeJsonl(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

export async function appendJsonl(file: string, content: string): Promise<void> {
  await appendFile(file, content);
}

/** In-memory FileSystem for discovery/platform tests. */
export class MemoryFileSystem implements FileSystem {
  private readonly files = new Map<string, Buffer>();
  private readonly dirs = new Set<string>();
  watchFails = false;

  constructor(private readonly sep: '/' | '\\' = '/') {}

  addDir(p: string): this {
    this.dirs.add(p);
    return this;
  }

  addFile(p: string, content = ''): this {
    this.files.set(p, Buffer.from(content));
    return this;
  }

  private isDir(p: string): boolean {
    if (this.dirs.has(p)) return true;
    const prefix = p.endsWith(this.sep) ? p : p + this.sep;
    for (const k of [...this.files.keys(), ...this.dirs]) if (k.startsWith(prefix)) return true;
    return false;
  }

  async stat(p: string): Promise<FileStat | undefined> {
    const f = this.files.get(p);
    if (f) return { size: f.length, mtimeMs: 1, isDirectory: false, isFile: true };
    if (this.isDir(p)) return { size: 0, mtimeMs: 1, isDirectory: true, isFile: false };
    return undefined;
  }

  async readdir(p: string): Promise<DirEntry[]> {
    const prefix = p.endsWith(this.sep) ? p : p + this.sep;
    const out = new Map<string, DirEntry>();
    for (const k of [...this.files.keys(), ...this.dirs]) {
      if (!k.startsWith(prefix) || k === p) continue;
      const rest = k.slice(prefix.length);
      const [name, ...more] = rest.split(this.sep);
      if (!name) continue;
      const isFile = more.length === 0 && this.files.has(k);
      out.set(name, { name, isFile, isDirectory: !isFile });
    }
    return [...out.values()];
  }

  async readRange(p: string, start: number, end: number): Promise<Buffer> {
    return (this.files.get(p) ?? Buffer.alloc(0)).subarray(start, end);
  }
  async readText(p: string): Promise<string | undefined> {
    return this.files.get(p)?.toString('utf8');
  }
  async writeText(p: string, text: string): Promise<void> {
    this.files.set(p, Buffer.from(text));
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  lastWatchError: ((err: Error) => void) | undefined;
  watch(_dir: string, _listener: (rel: string | undefined) => void, onError: (err: Error) => void): WatchHandle {
    if (this.watchFails) throw new Error('ERR_FEATURE_UNAVAILABLE_ON_PLATFORM');
    this.lastWatchError = onError;
    return { close: () => undefined };
  }
}
