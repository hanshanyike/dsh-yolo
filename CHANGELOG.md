# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **M7 — LLM-only semantic extraction.** The per-message regex fast path (rules / candidate buffer / merge) was removed entirely: regexes cannot judge semantics, produced noise, and missed anything phrased unusually. Extraction is now a single LLM structured pull at every `agent/turn-stopping`, following the industry pattern (Mem0, Claude Code auto-memory). The extraction prompt was rewritten around durable-knowledge selection, and the model now receives a compact **known-memories digest** so it never re-extracts unchanged facts. Live-session testing exposed a taxonomy gap in the first prompt cut — scheduled commitments (trips, appointments) fell between "task" and "decision" and were silently dropped — the todo/event definitions now explicitly cover them (verified against the real API both ways: extracts the trip, still respects "don't record this").
- **M7 — global sidebar dashboard.** The per-session dashboard tab (conversation view builder, chat node, header button, `/yolo` command, `yolo/snapshot` durable events) was removed — memory is cross-session by nature, so the dashboard now lives in the sidebar footer: a full-height drawer with open-todo badge, five sections, manual refresh and a 30s poll while open. Data comes from a new host endpoint `GET /yolo/dashboard` whose scope follows the most recent session's workspace.

### Fixed

- `Cannot read properties of undefined (reading 'enabled')` on boot when the bundle yml has no config stanza for the ui plugin — config is now normalized with `Config(config ?? {})` before any property access.
- `SetNamedSecurityInfoW failed (Win32 5)` on Windows when the workspace directory is owned by `BUILTIN\Administrators` — `scripts/dev.mjs` now runs an ACL preflight (`icacls`) before the host's sandbox grant, prints exact repair commands, and offers `--fix-acl` for an elevated one-shot repair (`takeown` + `icacls /grant`).
- Recall and reminders read a different memory scope than extraction wrote to — `memory` and `reminder` now track the latest session's `meta.cwd` instead of falling back to `process.cwd()`.
- The memory plugin crashed when a `session/event` payload arrived without a session object — the cwd tracking is now defensive.
- User messages containing FTS5 syntax characters (`<`, quotes, parens, operators) crashed
  the whole turn with `fts5: syntax error near "<"` — search queries are now wrapped as
  quoted FTS5 phrases (every character literal) and capped at 64 chars; recall additionally
  degrades to empty instead of failing system-prompt assembly on storage errors.

### Removed

- `src/extract/rules.ts`, `src/extract/buffer.ts`, `src/extract/merge.ts`, `src/shared/events.ts`, `client/tab/`, `client/node/DashboardNode.ts`, `client/trigger/HeaderButton.ts` and the `extraction.enableRules` setting.

## [0.2.0-alpha.1] — 2026-08-21

Name-claiming pre-release of the M6 line — same content as 0.1.0 plus release
engineering. Published under the `alpha` dist-tag; `npm install dsh-plugin-yolo`
resolves only after the stable `0.2.0`. Use `npm install dsh-plugin-yolo@alpha`
to try it early.

### Added

- GitHub Actions CI (`.github/workflows/ci.yml`): typecheck + tests + build + `npm pack` verification on Linux & Windows, plus a coverage job uploading the report artifact.
- Community files: bug report / feature request issue templates and a pull request template.
- README CI badge; `docs/release.md` (publish checklist, artifact contents, versioning policy).

### Changed

- **Dependencies now come from the npm registry** (`@deepseek-ai/*@0.1.1-rc.2` line) instead of `link:` paths into a local deepseek-harness checkout — `pnpm install` alone is enough for typecheck/tests/build, no host clone required; `pnpm-lock.yaml` is committed and CI installs with `--frozen-lockfile`.
- npm-ready manifest: `files` whitelist, `repository`, `keywords`, `publishConfig` (public access).
- Rewrote README around a clear product identity (slogan + logo) and corrected the Quick Start to the one-command `dev.mjs` flow; roadmap now lists future milestones M6–M9.
- Restructured docs: added `docs/architecture.md` (data flow + design decisions), migrated the session change record to `docs/dev-notes.md`, and introduced this standard CHANGELOG.

### Fixed

- Reminder due-date comparisons drifted across timezones — dates now compare in local time.
- Completed milestones stayed searchable — FTS rows are now soft-deleted when milestones complete.
- Events returned numeric rowids instead of stable ids — event creation now returns the generated UUID.
- LLM extraction accepted invalid priority values — unknown priorities now coerce to `null`.
- Tool outputs didn't match the declared schema — memory tools now return `{ rows: [...] }` shaped results.
- Dead `toPosix`/`posixJoin` helpers removed after the first Linux CI run exposed their platform-dependent behavior.

### Removed

- Stray artifacts and immature leftovers (install logs, sdk-client remnants, generated `dist/` tracking).

## [0.1.0] — 2026-08-21

First working milestone set: the full memory loop (capture → store → recall → remind → visualize).

### Added

- **M0 — scaffold.** Cordis plugin bundle layout, tsdown build, dev-host patch overlay; plugin loads in deepseek-harness.
- **M1 — storage.** `ctx.yolo` service: SQLite (WAL) repository with FTS5 trigram search, Markdown snapshots, workspace+branch scoped data dirs; memory tools (`memory_search` / `memory_write` / `memory_forget` / `yolo_query`).
- **M2 — extraction.** Hybrid extractor: per-message rule capture (todo / deadline / milestone / goal / preference signals) + turn-end LLM structured pull, with candidate buffering, title-normalized dedup and throttling.
- **M3 — injection.** systemPrompt preferences preamble + dynamic FTS recall against the latest user message; proactive reminders via `agent.inject` + `followup`, with queue-and-replay on `agent/session-start`.
- **M4 — UI.** Host settings section + Config; client bundle with dashboard tab, settings card and sidebar button; live data channel via durable `yolo/snapshot` events; `/yolo` command.
- **M5 — hardening.** Snapshot cadence (daily + every 10 turns), scheduler hardening, release build, test coverage push.
- One-command dev setup: `scripts/dev.mjs` (clone → install → build → patch → boot), CJS client-bundle build contract with `__ModuleLoader__` wrapping and browser `process` shim.

[Unreleased]: https://github.com/hanshanyike/dsh-yolo/compare/v0.2.0-alpha.1...HEAD
[0.2.0-alpha.1]: https://github.com/hanshanyike/dsh-yolo/compare/v0.1.0...v0.2.0-alpha.1
[0.1.0]: https://github.com/hanshanyike/dsh-yolo/releases/tag/v0.1.0
