# Architecture

Clean layering: only `extension.ts`, `commands/`, and `views/{status-bar,dashboard,tree-provider}.ts` import `vscode`.
Everything else is plain TypeScript, unit-testable without an editor.

```
src/
├── extension.ts            wiring: settings, timers, watcher, notifications
├── commands/               the 8 commands
├── platform/               OS/env detection, path candidates, FileSystem abstraction, PlatformService
├── claude/                 schema (line → record), parser (incremental), discovery, watcher, models
├── services/               aggregation (window, burn rate, depletion, blocks), capacity providers,
│                           usage-service (orchestrator), notifications, diagnostics, export
├── storage/cache.ts        versioned JSON cache (records + file cursors + notification state)
├── settings/               validated settings
└── views/                  format.ts (pure), tree model, webview/render.ts (pure HTML), vscode wrappers
```

Data flow: `discover → list *.jsonl → readNewRecords (cursor, complete lines) → parseUsageLine →
RecordStore (dedupe by message.id) → summarizeWindow / blocks / hourly → capacity providers → UsageSnapshot →
status bar, tree, dashboard, notifications`.

Rules enforced by structure: Claude parsers touch disk only through `FileSystem`; platform differences live in
`platform/`; views consume an immutable `UsageSnapshot`.
