# Architecture

YOLO is not a single plugin — it is a **bundle of five cooperating Cordis plugins
plus a browser client**, riding deepseek-harness's *"everything is a plugin"*
microkernel. This document explains the layout, the data flows, and the design
decisions behind them.

> **Docs map** — this is the *why* (design decisions, data flows, verified
> platform behavior). For the *what* (per-module files, types, public APIs) see
> [modules.md](modules.md); for *how to use* see [usage.md](../usage.md); for *how
> to test* see [testing.md](../testing.md).

## Design goals

1. **Zero external services.** Memory must work with no server, no embedding
   API, no account — SQLite ships as the only native dependency.
2. **The agent owns its memory.** Memory is exposed as model-visible tools and
   prompt context, not just a background log.
3. **Human-reviewable durability.** Whatever the fast store contains, a
   human-readable Markdown snapshot exists as the durable record.
4. **Workspace isolation.** Two projects (or two branches of the same project)
   never bleed memories into each other.
5. **Each piece swappable.** Every concern is its own Cordis plugin over a
   capability seam; the storage service is the only shared state.

## Bundle layout

```
dsh-plugin-yolo
├── src/index.ts          # package identity entry (load marker only)
├── src/storage/          # dsh-yolo-storage  — Service ctx.yolo
├── src/extract/          # dsh-yolo-extract  — conversation → records
├── src/memory/           # dsh-yolo-memory   — tools + prompt injection
├── src/reminder/         # dsh-yolo-reminder — scheduler + reply-able wake-ups
├── src/ui/               # dsh-yolo-ui       — settings + dashboard API
├── src/shared/           # constants, dashboard projection, text utils
└── client/               # browser bundle — sidebar dashboard, settings card
```

`cordis.patch.yml` wires each entry; `tsdown` builds the host plugins (ESM,
`@deepseek-ai/*` kept external — the host provides them at runtime) and
`tsdown.client.config.ts` builds the browser bundle (CJS, wrapped by
`scripts/wrap-client.mjs` into `__ModuleLoader__.load`). See
[modules.md](modules.md#九client--浏览器端-bundle) for the client build contract.

## The five plugins

| plugin | provides | consumes |
|---|---|---|
| **storage** | `ctx.yolo` service: SQLite (WAL + FTS5 trigram) repository, Markdown snapshots, scope resolution; **domain actions** (`applyTodoAction` / `applyTodoConsolidate` / `applyGoalProgress` / `applyMilestoneStatus`) with event audit + fuzzy title finders | nothing (leaf service) |
| **extract** | conversation → structured records (new items **+ state-change `updates[]`**) | `ctx.yolo`, `agent/turn-stopping`, `ctx.llm`, settings |
| **memory** | `memory_search/write/forget` + `yolo_query` / `yolo_action` tools, systemPrompt sections/context | `ctx.yolo`, `ctx.tools`, `ctx.systemPrompt`, `session/event` |
| **reminder** | time-triggered **reply-able** reminders (todo id + `yolo_action` routing in the message) | `ctx.yolo`, `agent/followup`, `agent/session-start` |
| **ui** | `GET /yolo/dashboard` + `POST /yolo/actions` JSON APIs, settings section | `ctx.yolo`, `ctx.webServer`, `agent/turn-stopping` |

## Module dependency graph

```
┌────────────────────────────── deepseek-harness host ──────────────────────────────┐
│                                                                                    │
│   src/index.ts   package identity (load marker only)                               │
│                                                                                    │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │
│   │ src/storage  │◄──│ src/extract  │   │ src/memory   │   │ src/reminder │        │
│   │ ctx.yolo     │   │ 语义提取      │   │ 工具+上下文   │   │ 调度器+提醒   │        │
│   │ (Service)    │   └──────────────┘   └──────────────┘   └──────────────┘        │
│   └──────┬───────┘                            ▲                    ▲               │
│          │ inject ctx.yolo                    │                    │               │
│   ┌──────▼───────┐   ┌──────────────┐   ┌─────┴──────────┐        │               │
│   │ src/ui       │   │ src/shared   │   │ client/        │        │               │
│   │ 设置+看板API  │   │ 常量/投影/文本 │   │ 侧边栏看板+设置卡 │        │               │
│   └──────────────┘   └──────────────┘   └────────────────┘        │               │
│                                                                                    │
│   scripts/dev.mjs / wrap-client.mjs / copy-assets.mjs   build & run                │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- `storage` is the leaf service — no YOLO-internal dependencies (only `shared/text`).
- `extract` / `memory` / `reminder` / `ui` all `inject: ['yolo']`.
- `shared` is used by every module — **prefer additive changes** (it has the widest blast radius).
- `client/` talks to the host `ui` plugin over `GET /yolo/dashboard` (HTTP JSON), never touches SQLite directly.

Per-module file maps, key types and public APIs: [modules.md](modules.md).

## Data flows

### Write path — conversation becomes memory

```
finished turn (agent/turn-stopping)
   │
   ▼
extract: fold turn messages into one bounded text blob (tail-keeping, 8k chars)
   │
   ▼
LLM semantic pull (gated: per-session cooldown + minTurnChars small-talk gate
   │            + maxRunsPerDay daily cap, all read live from settings)
   │   ▲ known-memories digest (items already stored, WITH status/progress/due)
   ▼
validate + coerce JSON
   │
   ├─► ctx.yolo.upsert*            (new items; milestone_title → milestone_id link)
   ├─► applyYoloAction / apply*    (updates[]: state changes via domain actions)
   ▼
SQLite + FTS5 index ──► each state change also writes a timeline event
   │                     (failures write an extraction_log row with status='error')
   └──►  Markdown snapshot (daily / every 10 turns)
```

Extraction is **LLM-only by design**. The early per-message regex fast path was
removed: regexes cannot judge semantics, so they produced noise (every
greeting that happened to match a pattern) and missed everything phrased
unusually. The industry converged on the opposite shape — [Mem0](https://github.com/mem0ai/mem0)
and Claude Code's auto-memory both run one LLM pass *after* a useful
interaction, not per message. YOLO follows that: one structured pull per turn,
deduplicated by feeding the model a compact digest of what is already stored
("do not re-extract unchanged facts"), so repeat turns cost tokens only when
something actually changed.

The same pull is extended with an `updates[]` output: changes to *already-known*
items (completed / started / postponed / progress statements) are returned as
state changes, not as duplicate items. The digest carries each item's status,
progress and due date so the model can tell what moved. `mergeExtraction`
upserts new items first and applies updates after — so "created and finished in
the same turn" works — resolving each update by fuzzy title match; unmatched
updates are dropped silently (hallucinated titles are the norm, not an error).

### Read path — memory reaches the model

```
┌── static:   systemPrompt section "yolo-prefs"     (preferences, always on)
├── dynamic:  systemPrompt context "yolo-recall"    (FTS vs latest user text)
├── on demand: yolo_query / memory_search tools     (agent pulls views)
└── push:     reminder scheduler → agent.followup(msg)   (due todos wake the agent)
```

Dynamic recall runs the latest user message through **hybrid multi-query FTS**
(`ftsRecallSearch`): the whole-phrase match (precise re-asks) is merged with an
OR expression of extracted tokens (latin words ≥3 chars + CJK sliding trigrams,
capped at 8) plus a `title LIKE` fallback for standalone 2-char CJK terms, then
deduped by `(row_type, row_id)` and capped at `recallTopK`. The hits pass a
deterministic **recall policy** (`applyRecallPolicy`): already-injected items
are filtered, each row type is capped at `recallKindQuota`, and the remaining
lines are greedily packed into a `recallMaxTokens`-scaled byte budget (overlong
singles are skipped, not truncating the rest). Every injected line is
`{{`-escaped (the host interpolates prompt templates strictly) and the
preference preamble is capped at the `recallPrefsMax` newest entries. Within a
session, `RecallDedupTracker` commits the previous turn's kept keys only when
the next user message arrives — one memory is injected once per conversation,
and repeated assemblies inside a turn stay byte-stable (prefix-cache friendly).
Reminders queue while the host is offline and replay on `agent/session-start`.

The push is *reply-able*: the reminder message carries the todo id and
explicit routing instructions, so the agent can answer a natural-language reply
(「已完成 / 推迟到明天 / 再提醒一次」) by calling the `yolo_action` tool in place.

### UI path — memory reaches the human

```
ctx.yolo ──► ui plugin serves GET /yolo/dashboard (JSON projection: todos/goals/
              milestones/events/preferences + ledger + notifications + unhandled)
            ──► ui plugin accepts POST /yolo/actions (domain actions)
            ──► ui plugin serves GET /yolo/session/messages + POST /yolo/session/send
              (the YOLO resident thread — 对话 Tab and 侧栏对话 are two views of it)
            ──► client bundle: sidebar button (badge = unhandled count) opens the
                full-width panel — 看板 Tab (default) + 对话 Tab + collapsible
                侧栏对话 (fetch + 30s poll while open)
```

The panel is a **global surface, not a per-session one**: memory outlives any
single conversation, so the entry lives in the sidebar footer (session-independent)
and its scope follows the workspace of the most recent session. The earlier
per-session dashboard tab (and the `yolo/snapshot` durable events that fed it)
was removed — publishing a full memory snapshot into every session log was
pure bloat. v0.3.0 replaced the narrow 440px drawer with a session-width panel
(`client/panel/`): `YoloPanel` (shell + tabs + Esc handling), `KanbanView`
(filter bar, notification cards, focus pills, task rows, goals, day ledger,
quick capture), `ChatPane` (one component for both chat views) and `state.ts`
(module-scope UI state so close/reopen keeps tab, filter and side-chat).
Filtering rules live in `src/shared/filters.ts` — pure functions pinned by
tests, the UI owns none of the semantics.

The kanban is *actionable*: rows carry ✓ / +1d / ⋯(inline edit) / 💬 buttons
that POST `/yolo/actions`, which dispatches through the same `applyYoloAction`
path as the `yolo_action` model tool — so a click and a chat reply produce
identical state changes and audit events. 快速记一条 also bypasses the LLM
entirely: it writes a today-due todo straight through the actions API.

`applyYoloAction` is also the **denial gate** (M9 / P34): every validation
failure writes an `action_denied` timeline event before returning
`{ok:false}` — the only silent rejection is the idempotent "already handled"
no-op. The one explicit merge path is `consolidate` (M9 / P35): the source
todo's provenance lands in the target's detail, deterministic fields are
inherited (missing due, higher priority), the source is cancelled with its
notifications resolved, and a single `todo_consolidated` event records the
merge. `memory_forget` routes through the same action path (cancel /
set_status abandoned / abandon), so no mutation can bypass the audit trail.

### v0.3.2 — managing-assistant refinement

- **Chat threads (R19).** `registerSessionEndpoints` gained an optional `thread`
  on both `GET /yolo/session/messages` and `POST /yolo/session/send`. The
  unanchored 对话 tab still targets the per-workspace **resident** thread
  (`yolo-w-*`, `YoloSessions`). A card's 聊一聊 passes a fresh ephemeral
  `thread` key resolved by `YoloChatThreads` to a disposable agent session
  (`yolo-a-*`), created lazily on first send, LRU-capped per workspace (oldest
  evicted + disposed). The pane therefore starts empty — a focused conversation
  that never inherits the resident thread's history. Both `yolo-w-*` and
  `yolo-a-*` count as YOLO-internal (`isYoloSessionId`), so extraction and the
  workspace tracker skip them.
- **Model selection on agent creation (v0.3.3).** Both `YoloSessions` and
  `YoloChatThreads` now pass `agentOptions: { provider, model }` from
  `agentDefaultModel.currentSelection()` and run `installModelSelection` in
  `setup` (the headless-runner pattern). Without this, a programmatically
  created agent errored with `prompt variable "{{model}}" has no value` and never
  replied; with it, both the resident and the anchored threads actually run a
  model turn.
- **Memory scope (R20).** The extraction prompt is now framed for a *managing*
  assistant: only commitments (todos), plans (goals/milestones) and tracking
  rules (preferences) are kept; persona, taste, general knowledge and
  life-detail memory are explicitly out of scope. `memory_write` and the
  `yolo-instructions` system section mirror that.
- **Write-quality gate (B3).** `src/shared/quality.ts` `shouldDropExtracted`
  rejects acknowledgements ("好的/收到/ok"), bare meta commands ("记住这个"),
  empty/single-char titles and empty rule values before `mergeExtraction` lands
  them — a wrong memory can trigger a wrong reminder.
- **Reminder quiet-hours (B5).** `inQuietWindow` + `reminder.quiet*` config:
  inside the window the reminder is held (not `mark reminded`) and fires on the
  first tick after — the "绝不打扰" line, engineered in.
- **Activity-aware title locate (B6).** `bestByTitle` prefers an exact
  normalized match, then ranks loose matches by status-recency, so a title ref
  never lands on an arbitrary first containment hit.
- **Feedback counters (B1 data layer).** `todos.good_count`/`stale_count`
  (complete→good, cancel→stale) surfaced on the dashboard row as `belief`; a
  stale-dominated row shows a `常忘` chip. Recall-side demotion is a follow-up.
- **Atomic snapshot (B8).** `writeSnapshot` uses tmp+rename.

### Reminder & brief path — proactive, YOLO-side only

```
scheduler tick ──► due todos ──► notifications table (card + badge)
                            └──► followup into the workspace's YOLO resident thread
brief tick (1/min) ──► morning/evening once per local day ──► notification card
                  └──► facts from storage queries; optional LLM polish; markdown fallback
```

Work sessions are **100% silent**: reminders and briefs reach the human only
through the YOLO panel (cards + badge) and the YOLO resident thread
(`yolo-w-<sha1(cwd)/12>`, created lazily, resumed across restarts). The old
session-start replay into whatever work session started next was removed;
`pending_reminders` stays in the schema for compatibility but nothing feeds it.

## Storage design

```
data/
├── yolo-<scope>.db     # SQLite: todos, milestones, goals, preferences, events,
│                       #   session_summaries, notifications
│                       #   + FTS5 virtual table (trigram tokenizer)
└── snapshots/*.md      # Markdown: the durable, reviewable record
```

- **Scope key** = `sha1(cwd)/<git-branch>` — one DB per workspace+branch.
- **FTS5 trigram** gives substring matching that works for CJK *and* ASCII
  without a language-specific tokenizer; queries go through a `bigramize`
  helper on the search path.
- **Snapshots are the source of truth**: the DB is a rebuildable cache. The
  snapshot cadence is daily plus every 10 turns (`DEFAULTS.snapshotKeepDays`
  bounds retention on disk).
- **Session attribution (v0.3.0)** — `events.session_id` (originating dsh
  session) + `events.source` (`llm|tool|manual`) feed the day ledger's source
  badges; `session_summaries` holds each session's one-line summary, written
  during extraction. `notifications` holds reminder/brief cards; the sidebar
  badge is the count of unhandled rows.
- **Domain actions with event audit** — state never changes by direct
  column writes anymore. Todos flow through `applyTodoAction` (`complete` /
  `cancel` / `postpone` / `remind_again` / `start`), goals through
  `applyGoalProgress` (0–100, ≥100 auto-achieves), milestones through
  `applyMilestoneStatus` — and every transition writes a timeline event
  (`todo_completed/cancelled/postponed/started`, `todo_remind_again`,
  `goal_progress`, `milestone_status`). The `events.kind` column is free-form
  (no CHECK constraint), so the new kinds needed no schema migration. When an
  item is referenced by title instead of id, `findTodoByTitle` /
  `findGoalByTitle` / `findMilestoneByTitle` locate it by normalized
  containment match (only among non-terminal items).

Key design decisions and their rationale:

| decision | rationale |
|---|---|
| SQLite + FTS5, not a vector store | zero external services, deterministic, CJK-friendly substring recall; semantic recall is the next roadmap item, deliberately deferred |
| LLM-only extraction, no regex fast path | regex cannot judge semantics — noise in, misses out; one model pass per turn with known-memory dedup matches the industry pattern (Mem0, Claude Code auto-memory) |
| global sidebar dashboard, not a per-session tab | memory is cross-session by nature; per-session snapshots duplicated data into every session log |
| Markdown as durable record | git-diffable, human-reviewable, survives DB schema changes |
| workspace+branch scoping | projects and experiments stay isolated; branch scope keys make long-running branches their own memory context |
| shared constants module | dsh is v0.1.0-rc; API drift should be a one-place change |
| domain actions with event audit | one state-transition path shared by extraction, chat replies and the dashboard — behavior and audit stay identical, and the timeline becomes the auditable answer to "到哪了" |
| reply-able reminders | the reminder message carries the todo id + routing instructions, so the agent can act on natural-language replies instead of just echoing them |
| fuzzy title matching for updates | LLM output rarely reproduces stored titles exactly; normalized containment lookup locates items without ids, and unmatched updates drop silently — hallucinated titles are the norm, not an error |
| YOLO resident thread, work sessions silent | proactive delivery into whatever session happened to start next startled users mid-coding (the M8 lesson); a dedicated `yolo-w-*` thread gives reminders a home, keeps panel chat stateful, and leaves work sessions untouched |
| pure filter module shared with tests | 看板筛选语义 (今日=逾期+今日到期 etc.) is product behavior — pinning it in `shared/filters.ts` keeps the UI dumb and the rules verifiable |

## Extension points used

| dsh extension point | used by | purpose |
|---|---|---|
| `ctx.effect` / service provide | storage | the `ctx.yolo` service |
| `session/event` (`user/message`, …) | memory | latest-user-text tracking for dynamic recall |
| `agent/turn-stopping` | extract, ui | turn-end LLM pull; latest-session-workspace tracking |
| `ctx.llm.stream` | extract | structured extraction prompt (`purpose: 'session-title'` segregates auxiliary traffic) |
| `ctx.tools.register` | memory | `memory_*` + `yolo_query` + `yolo_action` |
| `ctx.systemPrompt.section/context` | memory | prefs preamble + dynamic recall |
| `agent/followup` | reminder | reply-able wake-ups (single `followup(msg)` — see verified behavior) |
| `agent/session-start` | reminder | queue replay |
| `ctx.webServer` (prefix route) | ui | `GET /yolo/dashboard` + `POST /yolo/actions` JSON APIs |
| `sidebar.footer.action`, `settings.plugin.item` slots | client | global dashboard button + settings card |

## Verified platform behavior (dsh v0.1.0-rc.8)

Everything below was **verified at runtime** against the deepseek-harness host,
not taken from docs. When the official docs were silent, the fallback actually
used is recorded. These override assumptions whenever they conflict.

### Loader & boot

| fact | consequence |
|---|---|
| A plugin module must **default-export** its plugin (function, or object/class with `apply`) | a bare named export (`export class Yolo`) makes the loader pass the whole module namespace → `invalid plugin, expect function or object with an "apply" method` |
| On Windows the entry `name` must be a `file:///` URL | a bare `D:/...` throws `ERR_UNSUPPORTED_ESM_URL_SCHEME` (Node treats `d:` as a scheme) |
| `export const inject: string[] = [...]` on the plugin module is honored | patch rows only need `id` + `name` |
| `ctx.logger.info` does **not** reach the host terminal | dsh routes logger output elsewhere; use `console.log` for terminal-visible markers |
| `pnpm dsh web` requires `pnpm run build` first | `dsh-web-app` resolves a prebuilt frontend `dist` and throws `frontend dist not built` otherwise |
| pnpm's `safe-delete` trash fails under Git Bash | run pnpm via **PowerShell** (install and any boot touching temp dirs) |
| `EADDRINUSE` on the web port | a killed-but-leftover dsh process holds it; clear with `Get-NetTCPConnection -LocalPort <port> ... \| Stop-Process` |

### LLM

| fact | consequence |
|---|---|
| `GenerateOptions.purpose` is a **closed union** `'compaction' \| 'session-title'` | no custom tag exists; YOLO borrows `'session-title'` to segregate auxiliary traffic |
| `ctx.llm.stream()` returns `AsyncIterable<StreamChunk>` | fold with `BlockAssembler` (`push(chunk)` then `blocks()`); variants: `block-start/text-delta/block-end/usage/finish` |

### Session & agent events

| fact | consequence |
|---|---|
| `agent/turn-stopping` payload is `{ agent, turn, signal }` (serial) | `agent.session` is the live `Session`; `session.deriveMessages()` gives model-visible history; scope cwd: read `session.header.cwd` via `sessionCwd()` — the old `session.meta?.cwd` read never existed on the class and silently fell back to `process.cwd()` (fixed) |
| `session/event` emits `(session, event)` | `event.type: 'user/message' \| 'assistant/message'` carry `event.data.content: ContentBlock[]` |
| `AssembleContext` is **only** `{ scope?, signal? }` — no `userMessage` | the memory plugin caches the latest user text via `session/event`; the recall context reads that cache |
| `agent/session-start` payload is `{ agent, source }` | used to track the latest active agent and replay queued reminders |
| `Agent.inject/followup/steer` take a `UserMessage` | `createUserMessage` **requires** `source` (`{ kind: 'user' }`) or typecheck fails. **Verified finding:** `inject()` parks context without waking the driver, and a bare `followup()` throws — the reminder path uses a single `followup(msg)` |
| `AgentRegistry` has no "list active agents" API | the reminder plugin keeps its own `latestAgent` from `agent/session-start` |
| `ctx.systemPrompt.section({name, order, text, complete?})` / `.context({name, order, text})` | duplicate `name` throws; YOLO orders: 120 prefs / 220 recall |
| `ctx.effect(() => start())` returns the cleanup function | cordis effect cleanup contract confirmed |

### Settings & client bundle

| fact | consequence |
|---|---|
| Settings host half: `installSettingsSection(ctx, ns, Config, config, { setSource?, onChange?, validate? })` from `@deepseek-ai/dsh-settings` | `settingsNamespace('yolo')` is the join key with the client half; no `inject: ['settings']` needed |
| schemastery `z<Config>` pattern | `z.literal` / `z.union` / `z.infer` are **unavailable** in this build — use `z.string()` + min/max/default |
| Client bundle discovery: `ClientModuleRegistry` scans loader entries and `require.resolve('<entry>/package.json')` | three conditions must hold — (1) entry names resolve to the package (`dsh-plugin-yolo/dist/src/...` subpaths + a bare `dsh-plugin-yolo` entry, with a `~/.dsh/profiles/node_modules/dsh-plugin-yolo` junction), (2) `dsh.client` is an **object** `{ platform: 'web' }` (a string is rejected by `parseDshClient`), (3) the bundle is CJS wrapped in `window.__ModuleLoader__.load({id, factory})` + a `process` shim (React CJS entry) |
| **The bundle patch MUST carry a bare package entry.** `cordis.patch.yml` needs a `{ id, name: 'dsh-plugin-yolo' }` row in addition to the subpath rows. The registry resolves each entry *name* to `<name>/package.json`; a subpath entry (`dsh-plugin-yolo/dist/src/storage`) resolves to a subpath (no package.json) and is **not** a client row. Only the bare package name resolves to the package root, whose `dsh.client` declares the web bundle — so a patch with only subpath rows mounts the host plugins but never the sidebar button/panel on a plain `dsh web`. `cordis.dev.yml` has the bare row (which is why the patch-local host rendered it); `cordis.patch.yml` originally lacked it, so `dsh plugin add`'d bundles showed `/yolo/dashboard` but no panel. |
| Client bundle is served as a classic `<script>` | must be CJS (`module.exports`); ESM `export {}` leaves an empty factory → `loaded without registering`; no bare Node globals (`process is not defined`) |

### Storage & native deps

| fact | consequence |
|---|---|
| FTS5 trigram (better-sqlite3 11.10.0, Win/x64 + Node 22) | good CJK recall for queries ≥ 3 chars; M9's `ftsRecallSearch` adds token-OR multi-query + a `title LIKE` fallback so 2-char CJK terms still hit |
| pnpm ignores native build scripts by default | `pnpm-workspace.yaml` needs `allowBuilds: { better-sqlite3: true, esbuild: true }` + `nodeLinker: hoisted` (hoisted also avoids the empty-dir virtual-store bug that broke tsdown) |
| SQLite has no `ADD COLUMN IF NOT EXISTS` | `openDb()` checks `PRAGMA table_info(...)` and `ALTER TABLE` for older DBs |

### Windows environment

| symptom | cause & fix |
|---|---|
| `SetNamedSecurityInfoW failed (Win32 5): grantWrite(<workspace>)` | the dsh sandbox needs `WRITE_DAC` on the workspace to add a standing ACE; if the directory is owned by `BUILTIN\Administrators` the grant fails. Fix: run dsh as Administrator once, or take ownership, or move the workspace under `%USERPROFILE%`. `scripts/dev.mjs` runs an ACL preflight and offers `--fix-acl` (elevated `takeown` + `icacls /grant`). If it appears with `Rc55: syntax error near '<'`, the latter is a downstream shell-parse failure |
| pnpm `[safe-delete] trash operation ... aborted` | Git Bash trash API failure — run pnpm via PowerShell |

### Design decision: why not dynamic Cordis plugins

YOLO deliberately does **not** use the dynamic plugin mechanism
(`cordis_define` + `cordis_run`): a dynamic plugin's `code.host` is a pure JS
function body — no module resolution, no `fs`, no `better-sqlite3` native
binding. That cannot host a TypeScript + SQLite project. `scripts/dev.mjs` is
the correct local run path.

## Where to look when changing X

| you want to change | start here |
|---|---|
| schema / indexes / FTS | `src/storage/schema.sql` + `repository.ts` |
| domain actions / event audit / title finders | `src/storage/repository.ts` + `src/storage/index.ts` |
| shared action contract (tool + HTTP + extract) | `src/shared/actions.ts` |
| session scope / id helpers | `src/shared/session.ts` |
| extraction prompt / taxonomy / updates[] | `src/extract/prompt.ts` |
| extraction trigger / throttle / merge | `src/extract/index.ts` + `llm-extract.ts` |
| model-visible tools | `src/memory/tools.ts` |
| system-prompt injection / dynamic recall | `src/memory/recall.ts` |
| reminder scheduling / reply-able text / snapshot cadence | `src/reminder/scheduler.ts` + `index.ts` |
| config schema / defaults | `src/ui/config.ts` + `src/shared/constants.ts` |
| dashboard JSON shape | `src/shared/dashboard.ts` + `src/ui/dashboard.ts` |
| dashboard action API | `src/ui/actions.ts` |
| sidebar dashboard UI | `client/sidebar/YoloSidebarDashboard.tsx` |
| build / run / ACL | `scripts/dev.mjs`, `wrap-client.mjs`, `copy-assets.mjs` |
| adding a test | [testing.md](../testing.md) |

The full per-module reference (files, types, public APIs, gotchas) is
[modules.md](modules.md).
