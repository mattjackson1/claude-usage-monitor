# Technical findings: Claude Code local usage data

Investigated 2026-10-09 on macOS (Darwin 25.6) against Claude Code 2.1.289 transcripts
(1,021 session files, 582 MB, 167,504 lines, 55,805 assistant lines). Every claim below was
checked against that data unless marked **unverified**.

## 1. Where usage lives

| Item | Finding |
| --- | --- |
| Root | `~/.claude` (no `CLAUDE_CONFIG_DIR`, no `~/.config/claude` on the test machine) |
| Sessions | `~/.claude/projects/<cwd with "/" → "-">/<sessionId>.jsonl` |
| Subagents | `~/.claude/projects/<cwd>/<sessionId>/subagents/agent-*.jsonl` (46% of assistant lines have `isSidechain: true`) |
| Not usage | `stats-cache.json` (daily message/session/tool counts only), `history.jsonl` (prompts), `sessions/`, `file-history/` |
| Format | JSON Lines, UTF-8, append-only, one object per line, `\n` terminated |

## 2. Record schema (assistant lines)

```jsonc
{
  "type": "assistant",
  "timestamp": "2026-10-06T15:00:38.189Z",   // ISO-8601 UTC, always this shape (55,805/55,805)
  "sessionId": "…", "requestId": "req_…",     // requestId absent on 14 lines
  "isSidechain": false, "cwd": "…", "entrypoint": "cli|claude-vscode", "version": "2.1.289",
  "message": {
    "id": "msg_…", "model": "claude-opus-5-5",
    "usage": {
      "input_tokens": 2,
      "output_tokens": 261,
      "cache_creation_input_tokens": 58085,
      "cache_read_input_tokens": 0,
      "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 58085 },
      "iterations": [ … ], "service_tier": "standard", "server_tool_use": { … }
    }
  }
}
```

Present on every assistant line: the four token fields, `message.id`, `message.model`, `timestamp`.
Other line types (`user`, `system`, `attachment`, `queue-operation`, `ai-title`, …) carry no usage.

Model identifiers seen: `claude-opus-5-5`, `claude-opus-4-8`, `claude-opus-5`, `claude-sonnet-5-5`,
`claude-sonnet-5`, `claude-haiku-4-5-20251001`, `claude-haiku-5-5`, `claude-fable-5`,
`claude-fable-5-1`, and `<synthetic>` (all-zero usage, client-generated errors; skipped).

### Schema variants handled

The parser reads only the fields above. Tolerated variants (defensive, covered by fixtures):

* missing cache fields → treated as 0, counted in diagnostics as `missing:<field>`
* missing `message.id` → falls back to `requestId`, then `uuid`
* unknown extra fields anywhere → ignored
* non-numeric / negative token values, unparseable timestamp, no id → counted as *schema mismatch*, skipped, sampled in diagnostics
* malformed / truncated JSON → counted as *malformed*, skipped

Only one real-world variant (the one above) was observed; older/newer variants are **unverified**.

## 3. Token calculation

Per message: `total = input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
Window usage is the sum over de-duplicated messages with `now − 5h < timestamp ≤ now`.
`claudeUsage.capacityBasis = excludeCacheRead` drops cache reads from both usage and capacity.

**De-duplication is mandatory.** Claude Code writes one line *per content block*
(`thinking`, `text`, `tool_use`; field `apiBlockIndex`) and repeats the identical `usage` on each.
In the sampled session 108 of 157 message ids occur on several lines with byte-identical usage.
Over the last 14 days of real data: 20,265 usage lines → 9,824 unique messages (2.06× over-count if
summed naively). Records are keyed by `message.id` across all files (resumed sessions can re-log a message).

## 4. Incremental processing

Files are append-only, so the extension keeps `{offset, size, mtimeMs}` per file, reads only the new
bytes, and consumes only complete (`\n`-terminated) lines — a partial final line is retried later.
A file that shrinks is re-read from byte 0 (ids dedupe the overlap). Parsed records and cursors
persist in the extension's global storage, so restarts do not re-read history.
Measured on this machine: 14 days / 73k lines cold start ≈ 0.7 s, incremental refresh ≈ 25 ms.

## 5. What is *not* available locally

* **No plan limit or capacity.** Nothing in the transcripts records the 5-hour limit or remaining quota.
  Percentages therefore need a user-supplied capacity or an estimate from history
  (`UserConfiguredCapacityProvider`, `HistoricalCapacityProvider`; `FutureApiCapacityProvider` is a stub).
* **No server window boundaries.** The true reset time is not recorded. The extension uses a rolling
  window; "Window Reset" is when the oldest in-window usage ages out. "Window history" uses fixed
  5-hour blocks starting at the hour-floor of the first message — an approximation.
* Local usage covers only this machine/config dir; usage from other devices or claude.ai is invisible.

## 6. Platform differences

| Platform | Status |
| --- | --- |
| macOS | `~/.claude` **verified**. `~/.config/claude`, `~/Library/Application Support/Claude` are probed; the latter belongs to the desktop app and held no `projects/` here |
| Linux | `~/.claude`, `CLAUDE_CONFIG_DIR`, `$XDG_CONFIG_HOME/claude`, `$XDG_DATA_HOME/claude` probed — **unverified** (no Linux machine tested) |
| Windows | `%USERPROFILE%\.claude`, `%APPDATA%\Claude`, `%LOCALAPPDATA%\Claude` probed — **unverified**; path logic is unit-tested with `path.win32` |
| WSL | Linux paths plus `/mnt/c/Users/<user>/.claude` — **unverified**; unit-tested with an in-memory filesystem |
| Remote SSH / Dev Containers / Codespaces / Remote-WSL | The extension declares `extensionKind: ["workspace","ui"]` so it runs where the files are. It reads the *remote* home. Claude Code used on a different machine needs `claudeUsage.additionalPaths`. **Unverified** end-to-end |

A candidate directory is accepted only if it contains a `projects` subdirectory. Every attempt (found,
missing, not-a-claude-dir, error) is listed by *Claude Usage: Diagnostics*.

## 7. Assumptions and limitations

1. The transcript format is an undocumented implementation detail of Claude Code and may change; the parser degrades visibly (mismatch counts) rather than silently.
2. Percentages are estimates unless the user sets `claudeUsage.customCapacity`.
3. Cache-read tokens dominate raw totals (≈95% on the test data) and are probably not weighted equally by Anthropic's limits. Hence the capacity-basis setting.
4. Clock skew: records stamped in the future (> now) are excluded from the window.
5. Native recursive `fs.watch` can be unreliable on network drives / some Linux setups; the extension falls back to polling and the periodic refresh is a safety net.
