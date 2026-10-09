export type OsKind = 'darwin' | 'linux' | 'win32';

export interface Environment {
  os: OsKind;
  isWsl: boolean;
  wslDistro?: string;
  /** vscode.env.remoteName: 'wsl' | 'ssh-remote' | 'dev-container' | 'codespaces' | ... */
  remoteName?: string;
  home: string;
  env: Record<string, string | undefined>;
}

export interface EnvironmentInput {
  platform: string;
  env: Record<string, string | undefined>;
  homedir: string;
  /** os.release(); WSL kernels contain "microsoft". */
  release?: string;
  remoteName?: string;
}

export function detectEnvironment(input: EnvironmentInput): Environment {
  const os: OsKind = input.platform === 'win32' ? 'win32' : input.platform === 'darwin' ? 'darwin' : 'linux';
  const release = (input.release ?? '').toLowerCase();
  const wslDistro = input.env.WSL_DISTRO_NAME || undefined;
  const isWsl = os === 'linux' && (Boolean(wslDistro) || Boolean(input.env.WSL_INTEROP) || release.includes('microsoft'));
  return {
    os,
    isWsl,
    wslDistro,
    remoteName: input.remoteName || undefined,
    home: input.homedir,
    env: input.env,
  };
}

export function describeEnvironment(e: Environment): string {
  const parts: string[] = [e.os];
  if (e.isWsl) parts.push(`WSL${e.wslDistro ? ` (${e.wslDistro})` : ''}`);
  if (e.remoteName) parts.push(`remote: ${e.remoteName}`);
  return parts.join(', ');
}
