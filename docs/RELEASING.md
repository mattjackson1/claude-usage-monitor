# Releasing, publishing and maintenance

## One-time setup

1. Create the Marketplace publisher with ID `mattjackson`.
2. The Marketplace icon is `media/icon.png` (256×256, rendered from `media/icon.svg`); re-render it if the SVG changes.
3. Marketplace: create a publisher at <https://marketplace.visualstudio.com/manage>, create an Azure DevOps PAT with *Marketplace → Manage*, store it as the repo secret `VSCE_PAT`.
4. Open VSX (Cursor, Windsurf, VSCodium use it): create a token at <https://open-vsx.org>, store as `OVSX_PAT`, and claim the namespace (`npx ovsx create-namespace <publisher> -p $OVSX_PAT`).

## Versioning

Semantic Versioning, Conventional Commits (`feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE` → major).
Odd/even pre-release convention is not used; pre-releases publish with `--pre-release` from tags like `v0.2.0-beta.1`.

## Release steps

```bash
npm version minor          # bumps package.json, commits, tags vX.Y.Z
# update CHANGELOG.md (see below), amend
git push --follow-tags     # the "Release" workflow builds, tests, packages, creates a GitHub release and publishes
```

Manual: `npm run package` → `usage-monitor-for-claude-code-X.Y.Z.vsix`; `npx vsce publish --no-dependencies`; `npx ovsx publish *.vsix -p $OVSX_PAT`.
Local install test: `code --install-extension usage-monitor-for-claude-code-X.Y.Z.vsix`.

## Changelog

Generate from Conventional Commits: `npx conventional-changelog-cli -p conventionalcommits -i CHANGELOG.md -s` (or edit by hand
following *Keep a Changelog*). The release workflow uses the matching CHANGELOG section as the GitHub release notes.

## Maintenance strategy

* **Schema drift** is the main risk. Diagnostics report malformed / mismatched line counts and field warnings; a spike after a Claude Code update means update `src/claude/schema.ts` and add a fixture to `tests/fixtures`.
* Re-run `npm run smoke` against a fresh Claude Code version before each release.
* Bump the cache `CACHE_VERSION` whenever the persisted shape changes (old caches are discarded safely).
* Dependabot/Renovate for dev dependencies; the extension has **no runtime dependencies**.
* Keep `engines.vscode` and `@types/vscode` in lockstep.

## Future enhancements

* Real capacity source behind `FutureApiCapacityProvider` if Anthropic exposes plan/limit data.
* Weighted token cost per model; per-project and per-model breakdown views.
* Weekly-limit tracking; multi-machine aggregation via an opt-in export/import.
* `@vscode/test-electron` suite in CI on Windows/Linux/macOS runners; verify WSL/remote paths end-to-end.
