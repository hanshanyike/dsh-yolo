# Architecture

YOLO is not a single plugin — it is a **bundle of five cooperating Cordis plugins
plus a browser client**, riding deepseek-harness's *"everything is a plugin"*
microkernel. This document explains the layout, the data flows, and the design
decisions behind them.

> **Docs map** — this is the *why* (design decisions, data flows, verified
> platform behavior). For the *what* (per-module files, types, public APIs) see
> [modules.md](modules.md); for *how to use* see [usage.md](usage.md); for *how
> to test* see [testing.md](testing.md).

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
├── src/reminder/         # dsh-yolo-reminder — scheduler + agent.inject
├── src/ui/               # dsh-yolo-ui       — settings + dashboard API
├── src/shared/           # constants, dashboard projection, text utils
└── client/               # browser bundle — sidebar dashboard, settings card
```

`cordis.bundle.yml` wires each entry; `tsdown` builds the host plugins (ESM,
`@deepseek-ai/*` kept external — the host provides them at runtime) and
`tsdown.client.config.ts` builds the browser bundle (CJS, wrapped by
`scripts/wrap-client.mjs` into `__ModuleLoader__.load`). See
[modules.md](modules.md#九client--浏览器端-bundle) for the client build contract.

## The five plugins

| plugin | provides | consumes |
|---|---|---|
| **storage** | `ctx.yolo` service: SQLite (WAL + FTS5 trigram) repository, Markdown snapshots, scope resolution | nothing (leaf service) |
| **extract** | conversation → structured records | `ctx.yolo`, `agent/turn-stopping`, `ctx.llm`, settings |
| **memory** | `memory_search/write/forget` + `yolo_query` tools, systemPrompt sections/context | `ctx.yolo`, `ctx.tools`, `ctx.systemPrompt`, `session/event` |
| **reminder** | time-triggered reminders | `ctx.yolo`, `agent.inject`, `agent/followup`, `agent/session-start` |
| **ui** | `GET /yolo/dashboard` JSON API, settings section | `ctx.yolo`, `ctx.webServer`, `agent/turn-stopping` |

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
LLM semantic pull (throttled per session, temperature 0, JSON-only output)
   │   ▲ known-memories digest (todos/goals/milestones/prefs/events already stored)
   ▼
validate + coerce JSON ──► ctx.yolo.upsert*  ──►  SQLite + FTS5 index
                                              │
                                              └──►  Markdown snapshot (daily / every 10 turns)
```

Extraction is **LLM-only by design**. The early per-message regex fast path was
removed in M7: regexes cannot judge semantics, so they produced noise (every
greeting that happened to match a pattern) and missed everything phrased
unusually. The industry converged on the opposite shape — [Mem0](https://github.com/mem0ai/mem0)
and Claude Code's auto-memory both run one LLM pass *after* a useful
interaction, not per message. YOLO follows that: one structured pull per turn,
deduplicated by feeding the model a compact digest of what is already stored
("do not re-extract unchanged facts"), so repeat turns cost tokens only when
something actually changed.

### Read path — memory reaches the model

```
┌── static:   systemPrompt section "yolo-prefs"     (preferences, always on)
├── dynamic:  systemPrompt context "yolo-recall"    (FTS vs latest user text)
├── on demand: yolo_query / memory_search tools     (agent pulls views)
└── push:     reminder scheduler → agent.inject     (due todos wake the agent)
```

Dynamic recall FTS-searches the latest user message against the trigram index
and renders up to `recallTopK` hits under a `Related memory` heading. Reminders
queue while the host is offline and replay on `agent/session-start`.

### UI path — memory reaches the human

```
ctx.yolo ──► ui plugin serves GET /yolo/dashboard (JSON projection)
          ──► client bundle: global sidebar dashboard (fetch + 30s poll while open)
```

The dashboard is a **global surface, not a per-session one**: memory outlives any
single conversation, so the panel lives in the sidebar footer (session-independent)
and its scope follows the workspace of the most recent session. The earlier
per-session dashboard tab (and the `yolo/snapshot` durable events that fed it)
was removed in M7 — publishing a full memory snapshot into every session log was
pure bloat.

## Storage design

```
data/
├── yolo-<scope>.db     # SQLite: todos, milestones, goals, preferences, events
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

Key design decisions and their rationale:

| decision | rationale |
|---|---|
| SQLite + FTS5, not a vector store | zero external services, deterministic, CJK-friendly substring recall; semantic recall is roadmap (M9), deliberately deferred |
| LLM-only extraction, no regex fast path | regex cannot judge semantics — noise in, misses out; one model pass per turn with known-memory dedup matches the industry pattern (Mem0, Claude Code auto-memory) |
| global sidebar dashboard, not a per-session tab | memory is cross-session by nature; per-session snapshots duplicated data into every session log |
| Markdown as durable record | git-diffable, human-reviewable, survives DB schema changes |
| workspace+branch scoping | projects and experiments stay isolated; branch scope keys make long-running branches their own memory context |
| shared constants module | dsh is v0.1.0-rc; API drift should be a one-place change |

## Extension points used

| dsh extension point | used by | purpose |
|---|---|---|
| `ctx.effect` / service provide | storage | the `ctx.yolo` service |
| `session/event` (`user/message`, …) | memory | latest-user-text tracking for dynamic recall |
| `agent/turn-stopping` | extract, ui | turn-end LLM pull; latest-session-workspace tracking |
| `ctx.llm.stream` | extract | structured extraction prompt (`purpose: 'session-title'` segregates auxiliary traffic) |
| `ctx.tools.register` | memory | `memory_*` + `yolo_query` |
| `ctx.systemPrompt.section/context` | memory | prefs preamble + dynamic recall |
| `agent/inject`, `agent/followup` | reminder | proactive wake-ups |
| `agent/session-start` | reminder | queue replay |
| `ctx.webServer` (prefix route) | ui | `GET /yolo/dashboard` JSON API |
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
| `agent/turn-stopping` payload is `{ agent, turn, signal }` (serial) | `agent.session` is the live `Session`; `session.deriveMessages()` gives model-visible history; scope cwd: prefer `session.meta?.cwd`, fall back to `process.cwd()` |
| `session/event` emits `(session, event)` | `event.type: 'user/message' \| 'assistant/message'` carry `event.data.content: ContentBlock[]` |
| `AssembleContext` is **only** `{ scope?, signal? }` — no `userMessage` | the memory plugin caches the latest user text via `session/event`; the recall context reads that cache |
| `agent/session-start` payload is `{ agent, source }` | used to track the latest active agent and replay queued reminders |
| `Agent.inject/followup/steer` take a `UserMessage` | `createUserMessage` **requires** `source` (`{ kind: 'user' }`) or typecheck fails |
| `AgentRegistry` has no "list active agents" API | the reminder plugin keeps its own `latestAgent` from `agent/session-start` |
| `ctx.systemPrompt.section({name, order, text, complete?})` / `.context({name, order, text})` | duplicate `name` throws; YOLO orders: 120 prefs / 220 recall |
| `ctx.effect(() => start())` returns the cleanup function | cordis effect cleanup contract confirmed |

### Settings & client bundle

| fact | consequence |
|---|---|
| Settings host half: `installSettingsSection(ctx, ns, Config, config, { setSource?, onChange?, validate? })` from `@deepseek-ai/dsh-settings` | `settingsNamespace('yolo')` is the join key with the client half; no `inject: ['settings']` needed |
| schemastery `z<Config>` pattern | `z.literal` / `z.union` / `z.infer` are **unavailable** in this build — use `z.string()` + min/max/default |
| Client bundle discovery: `ClientModuleRegistry` scans loader entries and `require.resolve('<entry>/package.json')` | three conditions must hold — (1) entry names resolve to the package (`dsh-plugin-yolo/dist/src/...` subpaths + a bare `dsh-plugin-yolo` entry, with a `~/.dsh/profiles/node_modules/dsh-plugin-yolo` junction), (2) `dsh.client` is an **object** `{ platform: 'web' }` (a string is rejected by `parseDshClient`), (3) the bundle is CJS wrapped in `window.__ModuleLoader__.load({id, factory})` + a `process` shim (React CJS entry) |
| Client bundle is served as a classic `<script>` | must be CJS (`module.exports`); ESM `export {}` leaves an empty factory → `loaded without registering`; no bare Node globals (`process is not defined`) |

### Storage & native deps

| fact | consequence |
|---|---|
| FTS5 trigram (better-sqlite3 11.10.0, Win/x64 + Node 22) | good CJK recall for queries ≥ 3 chars; 2-char queries fall back to substring scan (may miss) |
| pnpm ignores native build scripts by default | `pnpm-workspace.yaml` needs `allowBuilds: { better-sqlite3: true, esbuild: true }` + `nodeLinker: hoisted` (hoisted also avoids the empty-dir virtual-store bug that broke tsdown) |
| SQLite has no `ADD COLUMN IF NOT EXISTS` | `openDb()` checks `PRAGMA table_info(...)` and `ALTER TABLE` for pre-M3 DBs |

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
| extraction prompt / taxonomy | `src/extract/prompt.ts` |
| extraction trigger / throttle / merge | `src/extract/index.ts` + `llm-extract.ts` |
| model-visible tools | `src/memory/tools.ts` |
| system-prompt injection / dynamic recall | `src/memory/recall.ts` |
| reminder scheduling / snapshot cadence | `src/reminder/scheduler.ts` + `index.ts` |
| config schema / defaults | `src/ui/config.ts` + `src/shared/constants.ts` |
| dashboard JSON shape | `src/shared/dashboard.ts` + `src/ui/dashboard.ts` |
| sidebar dashboard UI | `client/sidebar/YoloSidebarDashboard.tsx` |
| build / run / ACL | `scripts/dev.mjs`, `wrap-client.mjs`, `copy-assets.mjs` |
| adding a test | [testing.md](testing.md) |

The full per-module reference (files, types, public APIs, gotchas) is
[modules.md](modules.md).
