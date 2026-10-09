# Claude Usage Monitor

See your **Claude Code 5-hour usage** without leaving the editor. Everything is computed locally from
Claude Code's own session files (`~/.claude/projects/**/*.jsonl`) — nothing is sent anywhere and it works offline.

* **Status bar** — `🧠 42%`, `🧠 3.8M`, `🧠 58% Left`, `🧠 1h 42m Left` (click to open the dashboard)
* **Activity Bar → Claude Usage** — summary dashboard + a lightweight tree (usage, remaining, reset, model, tokens, warnings)
* **Dashboard** — rolling 5-hour window, token breakdown, burn rate, estimated depletion, sparkline, peak hours, window history
* **Notifications** at 75 / 90 / 95 % (configurable, once per crossing) and when the window empties
* **Export** to JSON or CSV, **diagnostics** that explain exactly where it looked and why

Works in VS Code, VS Code Insiders, Cursor, Windsurf and VSCodium, on macOS, Linux, Windows, WSL and
remote windows (SSH, Dev Containers, Codespaces) — see *Remote* below.

## Important: percentages are estimates

Claude Code does not store your plan's limit locally, so the extension cannot know your true capacity.
By default it estimates capacity as the heaviest completed 5-hour block in your own history (shown with
low/medium confidence). For a stable figure set **`claudeUsage.customCapacity`** (tokens per 5-hour window).
Token counts, burn rate and the window itself are exact for what is on this machine.

## Commands

`Claude Usage: Refresh · Open Dashboard · Open Data Location · Export Usage Report · Reset Cache · Open Logs · Diagnostics · Show Raw Usage Data`

## Settings

| Setting | Default | |
| --- | --- | --- |
| `claudeUsage.displayMode` | `percentage` | `percentage`, `percentageRemaining`, `tokensUsed`, `tokensRemaining`, `timeRemaining` |
| `claudeUsage.refreshInterval` | `60` | seconds between full recalculations (file changes refresh immediately) |
| `claudeUsage.warningThresholds` | `[75, 90, 95]` | notification thresholds (%) |
| `claudeUsage.customCapacity` | `0` | tokens per window; `0` = estimate from history |
| `claudeUsage.capacityBasis` | `all` | `excludeCacheRead` to ignore cache-read tokens |
| `claudeUsage.hideCacheMetrics` | `false` | hide cache rows |
| `claudeUsage.historyRetentionDays` | `14` | history kept for trends / capacity estimate |
| `claudeUsage.notifications.enabled` / `.windowReset` | `true` | notification switches |
| `claudeUsage.dashboard.enabled` / `treeView.enabled` | `true` | toggle views |
| `claudeUsage.additionalPaths` | `[]` | extra Claude data folders (each containing `projects/`) |
| `claudeUsage.debugLogging` | `false` | verbose output channel |

## Remote and WSL

The extension runs on the side that holds your files (`extensionKind: workspace`), so in a remote window it reads the
*remote* `~/.claude`. If Claude Code runs elsewhere, add that folder to `claudeUsage.additionalPaths`
(e.g. `\\wsl$\Ubuntu\home\you\.claude` from Windows). Inside WSL, `/mnt/c/Users/*/.claude` is probed automatically.
If nothing is found, **Claude Usage: Diagnostics** lists every location tried and suggests fixes.

## How it works

See [docs/FINDINGS.md](docs/FINDINGS.md) for the verified data format and token maths, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the code layout. Development: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
Publishing and maintenance: [docs/RELEASING.md](docs/RELEASING.md).
