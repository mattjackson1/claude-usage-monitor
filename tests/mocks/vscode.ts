// Minimal in-memory stand-in for the `vscode` module, enough to activate the extension.
type Fn = (...args: unknown[]) => unknown;

export const registeredCommands = new Map<string, Fn>();
export const shown: { kind: string; message: string }[] = [];
export const openedDocs: { content: string; language: string }[] = [];
export const written = new Map<string, string>();
export const state = {
  saveTarget: undefined as { path: string; fsPath: string } | undefined,
  configuration: {} as Record<string, unknown>,
  remoteName: undefined as string | undefined,
  executed: [] as { id: string; args: unknown[] }[],
};

export class Disposable {
  constructor(private readonly fn: () => void = () => undefined) {}
  dispose(): void {
    this.fn();
  }
}

export class EventEmitter<T> {
  private readonly ls = new Set<(e: T) => void>();
  event = (l: (e: T) => void): Disposable => {
    this.ls.add(l);
    return new Disposable(() => this.ls.delete(l));
  };
  fire(e: T): void {
    for (const l of this.ls) l(e);
  }
}

export class ThemeIcon {
  constructor(readonly id: string) {}
}
export class ThemeColor {
  constructor(readonly id: string) {}
}
export class TreeItem {
  id?: string;
  description?: string;
  tooltip?: string;
  iconPath?: unknown;
  constructor(
    public label: string,
    public collapsibleState: number,
  ) {}
}
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const StatusBarAlignment = { Left: 1, Right: 2 };
export const ViewColumn = { Active: -1 };

export const Uri = {
  file: (p: string) => ({ path: p, fsPath: p }),
  parse: (s: string) => ({ toString: () => s }),
};
export const opened: string[] = [];

export const panels: { webview: { html: string }; fire(m: unknown): void; revealed: number; dispose(): void }[] = [];
export const statusBarItems: { text: string; tooltip: unknown; command?: string; backgroundColor?: unknown; shown: boolean }[] = [];

export const window = {
  createOutputChannel: () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined }),
  createStatusBarItem: () => {
    const item = { text: '', tooltip: undefined as unknown, command: undefined as string | undefined, backgroundColor: undefined as unknown, name: '', shown: false, show() { this.shown = true; }, dispose() { this.shown = false; } };
    statusBarItems.push(item);
    return item;
  },
  registerTreeDataProvider: () => new Disposable(),
  registerWebviewViewProvider: () => new Disposable(),
  createWebviewPanel: () => {
    const emitter = new EventEmitter<unknown>();
    const panel = {
      webview: { html: '', cspSource: 'vscode-resource:', onDidReceiveMessage: emitter.event },
      fire: (m: unknown) => emitter.fire(m),
      revealed: 0,
      disposeHandlers: [] as (() => void)[],
      reveal() { panel.revealed++; },
      onDidDispose(h: () => void) { panel.disposeHandlers.push(h); return new Disposable(); },
      dispose() { panel.disposeHandlers.forEach((h) => h()); },
    };
    panels.push(panel);
    return panel;
  },
  showInformationMessage: async (m: string) => void shown.push({ kind: 'info', message: m }),
  showWarningMessage: async (m: string) => void shown.push({ kind: 'warn', message: m }),
  showErrorMessage: async (m: string) => void shown.push({ kind: 'error', message: m }),
  showQuickPick: async (items: { label: string }[]) => items[0],
  showSaveDialog: async () => state.saveTarget,
  showTextDocument: async () => undefined,
};

export const commands = {
  registerCommand: (id: string, fn: Fn) => {
    registeredCommands.set(id, fn);
    return new Disposable(() => registeredCommands.delete(id));
  },
  executeCommand: async (id: string, ...args: unknown[]) => {
    state.executed.push({ id, args });
    const fn = registeredCommands.get(id);
    return fn ? fn(...args) : undefined;
  },
};

export const workspace = {
  getConfiguration: () => ({ get: (key: string) => state.configuration[key] }),
  onDidChangeConfiguration: () => new Disposable(),
  openTextDocument: async (o: { content: string; language: string }) => {
    openedDocs.push(o);
    return o;
  },
  fs: {
    writeFile: async (uri: { fsPath: string }, data: Uint8Array) => {
      written.set(uri.fsPath, Buffer.from(data).toString('utf8'));
    },
  },
};

export const env = {
  openExternal: async (u: { toString(): string }) => {
    opened.push(u.toString());
    return true;
  },
  get remoteName() {
    return state.remoteName;
  },
};

export function resetMock(): void {
  registeredCommands.clear();
  shown.length = 0;
  openedDocs.length = 0;
  written.clear();
  statusBarItems.length = 0;
  opened.length = 0;
  panels.length = 0;
  state.saveTarget = undefined;
  state.configuration = {};
  state.remoteName = undefined;
  state.executed = [];
}
