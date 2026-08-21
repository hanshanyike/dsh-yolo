# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

> Versioning note: M8 is the Phase 1 Organizer drop and maps to the `0.3.0` line
> per `docs/release.md` ("M8 → 0.3.0"); the section below closes when that
> release is actually cut.

### Added

- **M8 — Phase 1 Organizer: the plan is now stateful.** Three entrances —
  automatic extraction, in-chat replies, dashboard clicks — converge on one set
  of storage-layer domain actions, and every action writes a timeline event.
  Todos flow `pending → in_progress → done/cancelled` (plus `start` /
  `postpone` / `remind_again`), goals track 0–100 progress (≥100 auto-achieves),
  milestones carry status. New event kinds: `todo_completed/cancelled/postponed/
  started`, `todo_remind_again`, `goal_progress`, `milestone_status` — the
  timeline is now the auditable answer to "到哪了".
- **State-change extraction.** The extraction prompt outputs an `updates[]`
  array (status / progress / due-date changes for already-known items) and the
  known-memories digest now carries each item's status, progress and due date,
  so the model can spot what changed instead of re-extracting. `mergeExtraction`
  applies updates *after* upserting new items (so "created and finished in the
  same turn" works), resolving each by fuzzy title match — unmatched updates
  drop silently, because hallucinated titles are the norm, not the exception.
  `milestone_title` on new todos/goals now links to the milestone, so the plan
  hierarchy actually forms.
- **`yolo_action` model tool + reply-able reminders.** Reminder messages carry
  the todo id and explicit routing instructions, so a natural-language reply —
  「已完成 / 推迟到明天 / 再提醒一次」— makes the agent call `yolo_action` in
  place. The same request shape (`applyYoloAction`, `src/shared/actions.ts`)
  serves the model tool and the HTTP API, keeping behavior and audit identical.
- **Actionable dashboard.** The sidebar dashboard is no longer read-only: open
  todos carry ✓ 完成 / +1d / ✕ buttons that POST the new `/yolo/actions`
  endpoint; rows show state badges (进行中 / 逾期 / 滞留), milestone labels and
  goal progress bars; the timeline labels the new state-flow event kinds.
  `YoloTodoRow` gained `milestone_title` / `updated_at` / `overdue` / `stale`.
- **Documentation suite.** New `docs/README.md` index plus three new guides so
  contributors stop having to read the source to find things: `docs/modules.md`
  (per-module reference — files, key types, public APIs, gotchas), `docs/usage.md`
  (user guide — install, config, features, data storage) and `docs/testing.md`
  (test suite — how to run, what each file covers, how to add tests).
  `docs/architecture.md` gained a module dependency graph and a "where to look
  when changing X" table; README/CONTRIBUTING now link the new docs.

### Changed

- **Docs consolidated — the two "working log" docs are gone.** `docs/extension-points.md`
  and `docs/dev-notes.md` were milestone/session scrapbooks full of stale entries
  (hybrid extraction, the per-session dashboard, the retired `link:` dependency
  scheme). Their still-valid knowledge was folded into the maintained docs:
  verified platform behavior now lives in `docs/architecture.md` ("Verified
  platform behavior" section), the client-bundle build contract and a
  troubleshooting table now live in `docs/modules.md`, and Windows environment
  fixes moved into `docs/usage.md` FAQ. All cross-references (README, docs index,
  CONTRIBUTING, release, `scripts/dev.mjs`) were updated to point at the new homes.
- **M7 — LLM-only semantic extraction.** The per-message regex fast path (rules / candidate buffer / merge) was removed entirely: regexes cannot judge semantics, produced noise, and missed anything phrased unusually. Extraction is now a single LLM structured pull at every `agent/turn-stopping`, following the industry pattern (Mem0, Claude Code auto-memory). The extraction prompt was rewritten around durable-knowledge selection, and the model now receives a compact **known-memories digest** so it never re-extracts unchanged facts. Live-session testing exposed a taxonomy gap in the first prompt cut — scheduled commitments (trips, appointments) fell between "task" and "decision" and were silently dropped — the todo/event definitions now explicitly cover them (verified against the real API both ways: extracts the trip, still respects "don't record this").
- **M7 — global sidebar dashboard.** The per-session dashboard tab (conversation view builder, chat node, header button, `/yolo` command, `yolo/snapshot` durable events) was removed — memory is cross-session by nature, so the dashboard now lives in the sidebar footer: a full-height drawer with open-todo badge, five sections, manual refresh and a 30s poll while open. Data comes from a new host endpoint `GET /yolo/dashboard` whose scope follows the most recent session's workspace.

### Fixed

- **Workspace scoping was broken end-to-end** (found during M8 live testing):
  every plugin read `session.meta?.cwd`, a property that never existed on the
  host's `Session` class, so all memory silently landed in the harness-root
  scope via the `process.cwd()` fallback. Scope resolution now goes through
  `sessionCwd()` / `sessionId()` (`src/shared/session.ts`), which read
  `session.header.cwd` / `session.header.id`.
- **Reminders never actually woke the agent**: `agent.inject()` parks context
  without waking the driver, and a bare `followup()` throws — silently swallowed
  by the try/catch, so `last_reminded_at` was never stamped. The scheduler and
  the session-start replay now send a single `followup(msg)`.
- Chat-triggered actions left no trace of *which session* did them —
  `yolo_action` now stamps the originating session id on the audit event.
- The dashboard "+1d" button always meant "tomorrow", so a todo due next Friday
  would jump *backwards*. It now postpones to one day after the later of today
  and the current due date.
- `Cannot read properties of undefined (reading 'enabled')` on boot when the bundle yml has no config stanza for the ui plugin — config is now normalized with `Config(config ?? {})` before any property access.
- `SetNamedSecurityInfoW failed (Win32 5)` on Windows when the workspace directory is owned by `BUILTIN\Administrators` — `scripts/dev.mjs` now runs an ACL preflight (`icacls`) before the host's sandbox grant, prints exact repair commands, and offers `--fix-acl` for an elevated one-shot repair (`takeown` + `icacls /grant`).
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
