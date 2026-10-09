import { describe, expect, it } from 'vitest';
import { discoverClaudeRoots, listSessionFiles } from '../../src/claude/discovery';
import { detectEnvironment, describeEnvironment } from '../../src/platform/environment';
import { candidateClaudeDirs } from '../../src/platform/paths';
import { PlatformService } from '../../src/platform/platform-service';
import { remediationGuidance } from '../../src/services/diagnostics-service';
import { MemoryFileSystem } from '../helpers';
import type { UsageService } from '../../src/services/usage-service';

const env = (o: Parameters<typeof detectEnvironment>[0]) => detectEnvironment(o);

describe('detectEnvironment', () => {
  it('detects macOS, Linux and Windows', () => {
    expect(env({ platform: 'darwin', env: {}, homedir: '/Users/a' }).os).toBe('darwin');
    expect(env({ platform: 'linux', env: {}, homedir: '/home/a' })).toMatchObject({ os: 'linux', isWsl: false });
    expect(env({ platform: 'win32', env: {}, homedir: 'C:\\Users\\a' }).os).toBe('win32');
  });

  it('detects WSL by env var or kernel release', () => {
    expect(env({ platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu' }, homedir: '/home/a' })).toMatchObject({ isWsl: true, wslDistro: 'Ubuntu' });
    expect(env({ platform: 'linux', env: {}, homedir: '/home/a', release: '5.15.90.1-microsoft-standard-WSL2' }).isWsl).toBe(true);
    expect(env({ platform: 'win32', env: { WSL_DISTRO_NAME: 'x' }, homedir: 'C:\\' }).isWsl).toBe(false);
  });

  it('describes the environment including remote name', () => {
    expect(describeEnvironment(env({ platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu' }, homedir: '/h', remoteName: 'wsl' }))).toBe('linux, WSL (Ubuntu), remote: wsl');
  });
});

describe('candidateClaudeDirs', () => {
  const paths = (e: ReturnType<typeof env>, extra: string[] = []) => candidateClaudeDirs(e, extra).map((c) => c.path);

  it('macOS: ~/.claude, XDG and Application Support', () => {
    const p = paths(env({ platform: 'darwin', env: {}, homedir: '/Users/a' }));
    expect(p).toEqual(['/Users/a/.claude', '/Users/a/.config/claude', '/Users/a/Library/Application Support/Claude']);
  });

  it('Linux honours XDG variables and CLAUDE_CONFIG_DIR first', () => {
    const p = paths(env({ platform: 'linux', env: { CLAUDE_CONFIG_DIR: '/opt/c', XDG_CONFIG_HOME: '/x/cfg', XDG_DATA_HOME: '/x/data' }, homedir: '/home/a' }));
    expect(p).toEqual(['/opt/c', '/home/a/.claude', '/x/cfg/claude', '/x/data/claude']);
  });

  it('Windows uses backslash paths and APPDATA/LOCALAPPDATA/USERPROFILE', () => {
    const p = paths(
      env({
        platform: 'win32',
        env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local', USERPROFILE: 'C:\\Users\\a' },
        homedir: 'C:\\Users\\a',
      }),
    );
    expect(p).toContain('C:\\Users\\a\\.claude');
    expect(p).toContain('C:\\Users\\a\\AppData\\Roaming\\Claude');
    expect(p).toContain('C:\\Users\\a\\AppData\\Local\\Claude');
    expect(p.every((x) => !x.includes('/'))).toBe(true);
    // USERPROFILE\.claude duplicates homedir\.claude and is de-duplicated
    expect(p.filter((x) => x.toLowerCase() === 'c:\\users\\a\\.claude')).toHaveLength(1);
  });

  it('puts additional paths first and removes duplicates', () => {
    const p = paths(env({ platform: 'linux', env: {}, homedir: '/home/a' }), ['/data/claude', '/home/a/.claude']);
    expect(p[0]).toBe('/data/claude');
    expect(p.filter((x) => x === '/home/a/.claude')).toHaveLength(1);
  });

  it('accepts UNC paths to WSL on Windows', () => {
    const p = paths(env({ platform: 'win32', env: {}, homedir: 'C:\\Users\\a' }), ['\\\\wsl$\\Ubuntu\\home\\a\\.claude']);
    expect(p[0]).toBe('\\\\wsl$\\Ubuntu\\home\\a\\.claude');
  });
});

describe('discoverClaudeRoots', () => {
  it('records found / missing / not-a-claude-dir attempts', async () => {
    const fs = new MemoryFileSystem().addDir('/home/a/.claude/projects').addDir('/home/a/.config/claude').addFile('/home/a/.config/claude/settings.json');
    const platform = new PlatformService(env({ platform: 'linux', env: {}, homedir: '/home/a' }), fs);
    const r = await discoverClaudeRoots(platform);
    expect(r.roots.map((x) => x.dir)).toEqual(['/home/a/.claude']);
    expect(Object.fromEntries(r.attempts.map((a) => [a.path, a.status]))).toEqual({
      '/home/a/.claude': 'found',
      '/home/a/.config/claude': 'not-a-claude-dir',
      '/home/a/.local/share/claude': 'missing',
    });
  });

  it('WSL also probes Windows profiles under /mnt/c/Users', async () => {
    const fs = new MemoryFileSystem()
      .addDir('/mnt/c/Users/Public')
      .addDir('/mnt/c/Users/Alice/.claude/projects')
      .addDir('/mnt/c/Users/Default');
    const platform = new PlatformService(env({ platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu' }, homedir: '/home/a' }), fs);
    const r = await discoverClaudeRoots(platform);
    expect(r.roots.map((x) => x.dir)).toEqual(['/mnt/c/Users/Alice/.claude']);
    expect(r.attempts.some((a) => a.path.includes('Public') || a.path.includes('Default'))).toBe(false);
  });

  it('works with Windows-style separators', async () => {
    const fs = new MemoryFileSystem('\\').addDir('C:\\Users\\a\\.claude\\projects');
    const platform = new PlatformService(env({ platform: 'win32', env: {}, homedir: 'C:\\Users\\a' }), fs);
    const r = await discoverClaudeRoots(platform);
    expect(r.roots[0]?.projectsDir).toBe('C:\\Users\\a\\.claude\\projects');
  });

  it('reports nothing found with every attempt listed', async () => {
    const platform = new PlatformService(env({ platform: 'darwin', env: {}, homedir: '/Users/a' }), new MemoryFileSystem());
    const r = await discoverClaudeRoots(platform);
    expect(r.roots).toEqual([]);
    expect(r.attempts.length).toBeGreaterThanOrEqual(3);
    expect(r.attempts.every((a) => a.status === 'missing')).toBe(true);
  });
});

describe('listSessionFiles', () => {
  it('finds sessions and subagent transcripts only', async () => {
    const base = '/home/a/.claude/projects';
    const fs = new MemoryFileSystem()
      .addFile(`${base}/-proj/s1.jsonl`, 'x')
      .addFile(`${base}/-proj/s1/subagents/agent-1.jsonl`, 'x')
      .addFile(`${base}/-proj/notes.txt`, 'x');
    const platform = new PlatformService(env({ platform: 'linux', env: {}, homedir: '/home/a' }), fs);
    const files = await listSessionFiles(platform, { dir: '/home/a/.claude', projectsDir: base, source: 't' }, 0);
    expect(files.map((f) => f.path).sort()).toEqual([`${base}/-proj/s1.jsonl`, `${base}/-proj/s1/subagents/agent-1.jsonl`]);
  });

  it('skips files older than the cutoff', async () => {
    const base = '/p/projects';
    const fs = new MemoryFileSystem().addFile(`${base}/a/old.jsonl`, 'x');
    const platform = new PlatformService(env({ platform: 'linux', env: {}, homedir: '/p' }), fs);
    expect(await listSessionFiles(platform, { dir: '/p', projectsDir: base, source: 't' }, 5)).toEqual([]); // mtime=1 < 5
  });
});

describe('remediationGuidance', () => {
  const svc = (roots: number) => ({ roots: new Array(roots).fill({}) }) as unknown as UsageService;

  it('is empty when data was found', () => {
    expect(remediationGuidance(new PlatformService(env({ platform: 'linux', env: {}, homedir: '/h' }), new MemoryFileSystem()), svc(1))).toEqual([]);
  });

  it('gives remote, WSL and Windows-specific advice', () => {
    const remote = remediationGuidance(new PlatformService(env({ platform: 'linux', env: {}, homedir: '/h', remoteName: 'ssh-remote' }), new MemoryFileSystem()), svc(0));
    expect(remote.join(' ')).toContain('remote (ssh-remote)');
    const win = remediationGuidance(new PlatformService(env({ platform: 'win32', env: {}, homedir: 'C:\\u' }), new MemoryFileSystem()), svc(0));
    expect(win.join(' ')).toContain('wsl$');
    const wsl = remediationGuidance(new PlatformService(env({ platform: 'linux', env: { WSL_DISTRO_NAME: 'U' }, homedir: '/h' }), new MemoryFileSystem()), svc(0));
    expect(wsl.join(' ')).toContain('/mnt/c');
  });
});
