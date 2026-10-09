import type { PlatformService } from '../platform/platform-service';
import { WINDOWS_SYSTEM_PROFILES, candidateClaudeDirs } from '../platform/paths';

export interface DiscoveryAttempt {
  path: string;
  source: string;
  status: 'found' | 'missing' | 'not-a-claude-dir' | 'error';
  detail?: string;
}

export interface ClaudeRoot {
  dir: string;
  projectsDir: string;
  source: string;
}

export interface DiscoveryResult {
  roots: ClaudeRoot[];
  attempts: DiscoveryAttempt[];
}

export interface SessionFile {
  path: string;
  size: number;
  mtimeMs: number;
}

async function wslWindowsCandidates(platform: PlatformService): Promise<{ path: string; source: string }[]> {
  const { environment, fs } = platform;
  if (!environment.isWsl) return [];
  const out: { path: string; source: string }[] = [];
  try {
    const users = await fs.readdir('/mnt/c/Users');
    for (const u of users) {
      if (!u.isDirectory || WINDOWS_SYSTEM_PROFILES.has(u.name.toLowerCase())) continue;
      out.push({ path: `/mnt/c/Users/${u.name}/.claude`, source: 'WSL: Windows profile via /mnt/c' });
    }
  } catch {
    // /mnt/c may be disabled in wsl.conf; nothing to probe.
  }
  return out;
}

export async function discoverClaudeRoots(
  platform: PlatformService,
  extraPaths: readonly string[] = [],
): Promise<DiscoveryResult> {
  const { fs, path: p, environment } = platform;
  const candidates = [...candidateClaudeDirs(environment, extraPaths)];
  for (const w of await wslWindowsCandidates(platform)) {
    if (!candidates.some((c) => c.path === w.path)) candidates.push(w);
  }

  const roots: ClaudeRoot[] = [];
  const attempts: DiscoveryAttempt[] = [];
  for (const c of candidates) {
    try {
      const dirStat = await fs.stat(c.path);
      if (!dirStat) {
        attempts.push({ ...c, status: 'missing' });
        continue;
      }
      const projectsDir = p.join(c.path, 'projects');
      const projStat = await fs.stat(projectsDir);
      if (!projStat?.isDirectory) {
        attempts.push({ ...c, status: 'not-a-claude-dir', detail: 'no "projects" subdirectory' });
        continue;
      }
      roots.push({ dir: c.path, projectsDir, source: c.source });
      attempts.push({ ...c, status: 'found' });
    } catch (err) {
      attempts.push({ ...c, status: 'error', detail: (err as Error).message });
    }
  }
  return { roots, attempts };
}

const MAX_DEPTH = 5;

/**
 * Lists *.jsonl transcripts under projects/, including subagent transcripts
 * (projects/<cwd>/<session>/subagents/agent-*.jsonl). Files whose mtime is
 * older than `minMtimeMs` are skipped.
 */
export async function listSessionFiles(
  platform: PlatformService,
  root: ClaudeRoot,
  minMtimeMs: number,
): Promise<SessionFile[]> {
  const { fs, path: p } = platform;
  const out: SessionFile[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    const files: string[] = [];
    const dirs: string[] = [];
    for (const e of entries) {
      if (e.isDirectory) dirs.push(p.join(dir, e.name));
      else if (e.isFile && e.name.endsWith('.jsonl')) files.push(p.join(dir, e.name));
    }
    await Promise.all(
      files.map(async (f) => {
        const s = await fs.stat(f).catch(() => undefined);
        if (s?.isFile && s.mtimeMs >= minMtimeMs) out.push({ path: f, size: s.size, mtimeMs: s.mtimeMs });
      }),
    );
    for (const d of dirs) await walk(d, depth + 1);
  }

  await walk(root.projectsDir, 0);
  return out;
}
