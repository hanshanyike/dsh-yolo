# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- GitHub Actions CI (`.github/workflows/ci.yml`): typecheck + tests + build + `npm pack` verification on Linux & Windows, plus a coverage job uploading the report artifact.
- Community files: bug report / feature request issue templates and a pull request template.
- README CI badge.

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

[Unreleased]: https://github.com/hanshanyike/dsh-yolo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/hanshanyike/dsh-yolo/releases/tag/v0.1.0
