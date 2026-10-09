import * as os from 'node:os';
import { detectEnvironment, type Environment } from './environment';
import { NodeFileSystem, type FileSystem } from './filesystem';
import { pathApiFor, type PathApi } from './paths';

/** Single entry point for OS, environment, path and filesystem access. */
export class PlatformService {
  readonly path: PathApi;

  constructor(
    readonly environment: Environment,
    readonly fs: FileSystem,
  ) {
    this.path = pathApiFor(environment.os);
  }
}

export function createNodePlatformService(remoteName?: string): PlatformService {
  const environment = detectEnvironment({
    platform: process.platform,
    env: process.env,
    homedir: os.homedir(),
    release: os.release(),
    remoteName,
  });
  return new PlatformService(environment, new NodeFileSystem());
}
