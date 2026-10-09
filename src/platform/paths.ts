import * as path from 'node:path';
import type { Environment, OsKind } from './environment';

export type PathApi = typeof path.posix;

export function pathApiFor(os: OsKind): PathApi {
  return os === 'win32' ? path.win32 : path.posix;
}

export interface CandidateDir {
  path: string;
  source: string;
}

/**
 * Candidate Claude config directories in priority order. A candidate is only
 * accepted by discovery if it contains a `projects` directory.
 * `~/.claude` and `CLAUDE_CONFIG_DIR` are the verified/primary locations; the
 * rest are defensive probes for other platforms and layouts.
 */
export function candidateClaudeDirs(env: Environment, extra: readonly string[] = []): CandidateDir[] {
  const p = pathApiFor(env.os);
  const out: CandidateDir[] = [];
  const seen = new Set<string>();
  const add = (dir: string | undefined, source: string): void => {
    if (!dir) return;
    const norm = p.normalize(dir);
    const key = env.os === 'win32' ? norm.toLowerCase() : norm;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ path: norm, source });
  };

  for (const e of extra) add(e.trim(), 'setting: claudeUsage.additionalPaths');
  add(env.env.CLAUDE_CONFIG_DIR, 'env: CLAUDE_CONFIG_DIR');
  add(p.join(env.home, '.claude'), 'home: ~/.claude');

  if (env.os === 'win32') {
    add(env.env.USERPROFILE ? p.join(env.env.USERPROFILE, '.claude') : undefined, 'env: %USERPROFILE%\\.claude');
    add(env.env.APPDATA ? p.join(env.env.APPDATA, 'Claude') : undefined, 'env: %APPDATA%\\Claude');
    add(env.env.APPDATA ? p.join(env.env.APPDATA, 'claude') : undefined, 'env: %APPDATA%\\claude');
    add(env.env.LOCALAPPDATA ? p.join(env.env.LOCALAPPDATA, 'Claude') : undefined, 'env: %LOCALAPPDATA%\\Claude');
    add(env.env.LOCALAPPDATA ? p.join(env.env.LOCALAPPDATA, 'claude') : undefined, 'env: %LOCALAPPDATA%\\claude');
  } else {
    const xdgConfig = env.env.XDG_CONFIG_HOME || p.join(env.home, '.config');
    add(p.join(xdgConfig, 'claude'), 'xdg: config/claude');
    if (env.os === 'linux') {
      const xdgData = env.env.XDG_DATA_HOME || p.join(env.home, '.local', 'share');
      add(p.join(xdgData, 'claude'), 'xdg: data/claude');
    }
    if (env.os === 'darwin') {
      add(p.join(env.home, 'Library', 'Application Support', 'Claude'), 'macOS: Application Support/Claude');
    }
  }
  return out;
}

/** Directories under /mnt/c/Users that are never real user profiles. */
export const WINDOWS_SYSTEM_PROFILES = new Set(['public', 'default', 'default user', 'all users', 'desktop.ini']);
