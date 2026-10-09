import type { FileCursor } from '../claude/parser';
import type { UsageRecord } from '../claude/models';
import type { FileSystem } from '../platform/filesystem';

export const CACHE_VERSION = 1;

export interface NotificationState {
  /** Thresholds already announced and not yet re-armed. */
  fired: number[];
  /** Whether the window held any usage at the last evaluation. */
  hadUsage: boolean;
}

export interface PersistedState {
  files: Record<string, FileCursor>;
  records: UsageRecord[];
  notification: NotificationState;
}

type RecordTuple = [string, number, string, string, number, number, number, number, 0 | 1];

interface CacheFile {
  version: number;
  savedAt: number;
  files: Record<string, FileCursor>;
  records: RecordTuple[];
  notification: NotificationState;
}

export function emptyNotificationState(): NotificationState {
  return { fired: [], hadUsage: false };
}

export class CacheStore {
  constructor(
    private readonly fs: FileSystem,
    private readonly filePath: string,
  ) {}

  /** Returns undefined for a missing, corrupt or version-mismatched cache. */
  async load(): Promise<PersistedState | undefined> {
    let text: string | undefined;
    try {
      text = await this.fs.readText(this.filePath);
    } catch {
      return undefined;
    }
    if (!text) return undefined;
    try {
      const parsed = JSON.parse(text) as Partial<CacheFile>;
      if (parsed.version !== CACHE_VERSION || !parsed.files || !Array.isArray(parsed.records)) return undefined;
      const records: UsageRecord[] = [];
      for (const t of parsed.records) {
        if (!Array.isArray(t) || t.length !== 9) continue;
        const [id, timestamp, sessionId, model, input, output, cacheCreate, cacheRead, side] = t;
        if (typeof id !== 'string' || typeof timestamp !== 'number') continue;
        records.push({ id, timestamp, sessionId, model, input, output, cacheCreate, cacheRead, sidechain: side === 1 });
      }
      const n = parsed.notification;
      return {
        files: parsed.files,
        records,
        notification: {
          fired: Array.isArray(n?.fired) ? n.fired.filter((x): x is number => typeof x === 'number') : [],
          hadUsage: n?.hadUsage === true,
        },
      };
    } catch {
      return undefined;
    }
  }

  async save(state: PersistedState, now: number): Promise<void> {
    const file: CacheFile = {
      version: CACHE_VERSION,
      savedAt: now,
      files: state.files,
      records: state.records.map((r) => [
        r.id,
        r.timestamp,
        r.sessionId,
        r.model,
        r.input,
        r.output,
        r.cacheCreate,
        r.cacheRead,
        r.sidechain ? 1 : 0,
      ]),
      notification: state.notification,
    };
    await this.fs.writeText(this.filePath, JSON.stringify(file));
  }

  async clear(): Promise<void> {
    await this.fs.remove(this.filePath);
  }
}
