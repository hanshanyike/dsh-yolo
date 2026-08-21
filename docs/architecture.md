# Architecture

YOLO is not a single plugin — it is a **bundle of five cooperating Cordis plugins
plus a browser client**, riding deepseek-harness's *"everything is a plugin"*
microkernel. This document explains the layout, the data flows, and the design
decisions behind them.

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
[dev-notes.md](dev-notes.md) for the full build contract.

## The five plugins

| plugin | provides | consumes |
|---|---|---|
| **storage** | `ctx.yolo` service: SQLite (WAL + FTS5 trigram) repository, Markdown snapshots, scope resolution | nothing (leaf service) |
| **extract** | conversation → structured records | `ctx.yolo`, `agent/turn-stopping`, `ctx.llm`, settings |
| **memory** | `memory_search/write/forget` + `yolo_query` tools, systemPrompt sections/context | `ctx.yolo`, `ctx.tools`, `ctx.systemPrompt`, `session/event` |
| **reminder** | time-triggered reminders | `ctx.yolo`, `agent.inject`, `agent/followup`, `agent/session-start` |
| **ui** | `GET /yolo/dashboard` JSON API, settings section | `ctx.yolo`, `ctx.webServer`, `agent/turn-stopping` |

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

Runtime-verified details and platform gotchas live in
[extension-points.md](extension-points.md); the build contract and
troubleshooting live in [dev-notes.md](dev-notes.md).
