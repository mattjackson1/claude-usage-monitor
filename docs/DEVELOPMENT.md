# Development

```bash
npm install
npm run lint            # tsc --noEmit
npm test                # vitest (unit + integration, vscode mocked)
npm run test:coverage
npm run build           # esbuild → dist/extension.js
npm run smoke           # run the core against YOUR real ~/.claude and print a summary (add -- --diagnostics)
npx tsx scripts/make-fixtures.mts   # regenerate tests/fixtures
```

Press **F5** in VS Code ("Run Extension") to launch an Extension Development Host.

## Tests

* `tests/unit` — schema, parser, aggregation, capacity, platform paths/discovery (macOS, Linux, Windows, WSL, remote, UNC), settings, cache, notifications, formatting, rendering, export, view wrappers.
* `tests/integration` — end-to-end aggregation over real temp files (incremental append, partial writes, truncation, retention, expiry, persistence, 20k-record history), real `fs.watch` + polling fallback, and extension activation + command execution against a `vscode` mock (`tests/mocks/vscode.ts`).
* `tests/fixtures` — valid, malformed, schema-variant, empty transcripts.

A true Extension Host smoke test (`@vscode/test-electron`) is not included; do a manual F5 pass before releases.
