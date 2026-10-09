import { promises as fsp, watch as nodeWatch } from 'node:fs';
import * as path from 'node:path';

export interface FileStat {
  size: number;
  mtimeMs: number;
  isDirectory: boolean;
  isFile: boolean;
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface WatchHandle {
  close(): void;
}

/** All Claude data access goes through this interface. */
export interface FileSystem {
  /** Resolves undefined when the path does not exist. */
  stat(p: string): Promise<FileStat | undefined>;
  /** Resolves [] when the directory does not exist; rejects on other errors. */
  readdir(p: string): Promise<DirEntry[]>;
  readRange(p: string, start: number, end: number): Promise<Buffer>;
  readText(p: string): Promise<string | undefined>;
  writeText(p: string, text: string): Promise<void>;
  remove(p: string): Promise<void>;
  /** Throws when native recursive watching is unavailable. */
  watch(dir: string, listener: (relativePath: string | undefined) => void, onError: (err: Error) => void): WatchHandle;
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export class NodeFileSystem implements FileSystem {
  async stat(p: string): Promise<FileStat | undefined> {
    try {
      const s = await fsp.stat(p);
      return { size: s.size, mtimeMs: s.mtimeMs, isDirectory: s.isDirectory(), isFile: s.isFile() };
    } catch (err) {
      if (isMissing(err)) return undefined;
      throw err;
    }
  }

  async readdir(p: string): Promise<DirEntry[]> {
    try {
      const entries = await fsp.readdir(p, { withFileTypes: true });
      const out: DirEntry[] = [];
      for (const e of entries) {
        if (e.isSymbolicLink()) {
          const s = await this.stat(path.join(p, e.name)).catch(() => undefined);
          if (s) out.push({ name: e.name, isDirectory: s.isDirectory, isFile: s.isFile });
        } else {
          out.push({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() });
        }
      }
      return out;
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
  }

  async readRange(p: string, start: number, end: number): Promise<Buffer> {
    const handle = await fsp.open(p, 'r');
    try {
      const length = Math.max(0, end - start);
      const buf = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buf, 0, length, start);
      return bytesRead === length ? buf : buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async readText(p: string): Promise<string | undefined> {
    try {
      return await fsp.readFile(p, 'utf8');
    } catch (err) {
      if (isMissing(err)) return undefined;
      throw err;
    }
  }

  async writeText(p: string, text: string): Promise<void> {
    await fsp.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, p);
  }

  async remove(p: string): Promise<void> {
    await fsp.rm(p, { force: true });
  }

  watch(dir: string, listener: (relativePath: string | undefined) => void, onError: (err: Error) => void): WatchHandle {
    const w = nodeWatch(dir, { recursive: true, persistent: false }, (_event, filename) => {
      listener(filename ? filename.toString() : undefined);
    });
    w.on('error', onError);
    return { close: () => w.close() };
  }
}
