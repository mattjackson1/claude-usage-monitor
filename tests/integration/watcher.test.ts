import { appendFile } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeWatcher } from '../../src/claude/watcher';
import { Logger } from '../../src/logger';
import { NodeFileSystem } from '../../src/platform/filesystem';
import { MemoryFileSystem, makeTmp, writeJsonl } from '../helpers';

const logger = () => new Logger({ appendLine: () => undefined });

describe('ClaudeWatcher', () => {
  it('emits a debounced batch of changed jsonl files from native events', async () => {
    const dir = await makeTmp('cum-watch-');
    const f = path.join(dir, 'proj', 's.jsonl');
    await writeJsonl(f, '');
    const batches: string[][] = [];
    const w = new ClaudeWatcher(new NodeFileSystem(), path.join, (b) => batches.push(b), logger(), { debounceMs: 50 });
    w.start([dir]);
    expect(w.mode).toBe('native');
    await new Promise((r) => setTimeout(r, 100));
    await appendFile(f, 'x\n');
    await appendFile(f, 'y\n');
    await vi.waitFor(() => expect(batches.length).toBeGreaterThan(0), { timeout: 3000 });
    w.stop();
    expect(batches.flat()).toContain(f);
    expect(new Set(batches.flat().filter((p) => p.endsWith('.jsonl'))).size).toBe(1);
    expect(w.mode).toBe('stopped');
  });

  it('ignores non-jsonl files', async () => {
    const dir = await makeTmp('cum-watch-');
    const batches: string[][] = [];
    const w = new ClaudeWatcher(new NodeFileSystem(), path.join, (b) => batches.push(b), logger(), { debounceMs: 30 });
    w.start([dir]);
    await new Promise((r) => setTimeout(r, 100));
    await writeJsonl(path.join(dir, 'notes.txt'), 'hi');
    await new Promise((r) => setTimeout(r, 300));
    w.stop();
    expect(batches).toEqual([]);
  });

  it('falls back to polling when native watching is unavailable', async () => {
    const fs = new MemoryFileSystem();
    fs.watchFails = true;
    let ticks = 0;
    const w = new ClaudeWatcher(fs, path.join, (b) => { expect(b).toEqual([]); ticks++; }, logger(), { pollIntervalMs: 20 });
    w.start(['/anywhere']);
    expect(w.mode).toBe('polling');
    await vi.waitFor(() => expect(ticks).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    w.stop();
  });

  it('falls back to polling when a native watcher errors later', async () => {
    const fs = new MemoryFileSystem();
    const w = new ClaudeWatcher(fs, path.join, () => undefined, logger(), { pollIntervalMs: 1000 });
    w.start(['/x']);
    expect(w.mode).toBe('native');
    fs.lastWatchError?.(new Error('EMFILE'));
    expect(w.mode).toBe('polling');
    w.stop();
  });

  it('does nothing with no directories', () => {
    const w = new ClaudeWatcher(new MemoryFileSystem(), path.join, () => undefined, logger());
    w.start([]);
    expect(w.mode).toBe('stopped');
  });
});
