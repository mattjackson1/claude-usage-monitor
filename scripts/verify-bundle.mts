// Loads the built dist/extension.js against the vscode mock and activates it. Run after `npm run build`.
import Module from 'node:module';
import { createRequire } from 'node:module';
import * as mock from '../tests/mocks/vscode';

const orig = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...a: unknown[]) => unknown })._load = function (request: unknown, ...rest: unknown[]) {
  return request === 'vscode' ? mock : orig.call(this, request, ...rest);
};
const ext = createRequire(import.meta.url)('../dist/extension.js') as typeof import('../src/extension');
const ctx = { subscriptions: [], globalStorageUri: { fsPath: `${process.env.TMPDIR ?? '/tmp'}/cum-verify` }, extension: { packageJSON: { version: 'bundle' } } };
const api = await ext.activate(ctx as never);
console.log('bundle activated; commands:', mock.registeredCommands.size, '| status bar:', mock.statusBarItems[0]?.text);
await ext.deactivate();
void api;
process.exit(mock.registeredCommands.size === 9 ? 0 : 1);
