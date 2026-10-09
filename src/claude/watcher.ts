import type { FileSystem, WatchHandle } from '../platform/filesystem';
import type { Logger } from '../logger';

export type WatchMode = 'native' | 'polling' | 'stopped';

export interface ClaudeWatcherOptions {
  debounceMs?: number;
  pollIntervalMs?: number;
}

/**
 * Watches Claude `projects` directories. Prefers native recursive fs events and
 * falls back to polling when they are unavailable or fail. Emits batched
 * changed jsonl paths (absolute); polling emits an empty batch meaning "rescan".
 */
export class ClaudeWatcher {
  private handles: WatchHandle[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private pending = new Set<string>();
  private _mode: WatchMode = 'stopped';
  private readonly debounceMs: number;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly fs: FileSystem,
    private readonly join: (...p: string[]) => string,
    private readonly onChange: (paths: string[]) => void,
    private readonly logger: Logger,
    opts: ClaudeWatcherOptions = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 300;
    this.pollIntervalMs = opts.pollIntervalMs ?? 15_000;
  }

  get mode(): WatchMode {
    return this._mode;
  }

  start(dirs: readonly string[]): void {
    this.stop();
    if (dirs.length === 0) return;
    try {
      for (const dir of dirs) {
        this.handles.push(
          this.fs.watch(
            dir,
            (rel) => this.queue(rel ? this.join(dir, rel) : undefined),
            (err) => {
              this.logger.warn(`Native watcher failed (${err.message}); falling back to polling`);
              this.fallbackToPolling();
            },
          ),
        );
      }
      this._mode = 'native';
      this.logger.info(`Watching ${dirs.length} director${dirs.length === 1 ? 'y' : 'ies'} natively`);
    } catch (err) {
      this.logger.warn(`Native watching unavailable (${(err as Error).message}); using polling`);
      this.closeHandles();
      this.startPolling();
    }
  }

  stop(): void {
    this.closeHandles();
    if (this.timer) clearTimeout(this.timer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.timer = undefined;
    this.pollTimer = undefined;
    this.pending.clear();
    this._mode = 'stopped';
  }

  private fallbackToPolling(): void {
    this.closeHandles();
    this.startPolling();
  }

  private startPolling(): void {
    this._mode = 'polling';
    this.pollTimer = setInterval(() => this.onChange([]), this.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  private closeHandles(): void {
    for (const h of this.handles) {
      try {
        h.close();
      } catch {
        // already closed
      }
    }
    this.handles = [];
  }

  private queue(file: string | undefined): void {
    if (file === undefined) this.pending.add('');
    else if (file.endsWith('.jsonl')) this.pending.add(file);
    else return;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const batch = [...this.pending];
      this.pending.clear();
      this.onChange(batch.includes('') ? [] : batch);
    }, this.debounceMs);
    this.timer.unref?.();
  }
}
