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
├── src/ui/               # dsh-yolo-ui       — host UI + data channel
├── src/shared/           # constants, dashboard projection, event types, text utils
└── client/               # browser bundle — dashboard tab, sidebar, settings card
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
| **extract** | conversation → structured records | `ctx.yolo`, `session/event`, `agent/turn-stopping`, `ctx.llm` |
| **memory** | `memory_search/write/forget` + `yolo_query` tools, systemPrompt sections/context | `ctx.yolo`, `ctx.tools`, `ctx.systemPrompt`, `session/event` |
| **reminder** | time-triggered reminders | `ctx.yolo`, `agent.inject`, `agent/followup`, `agent/session-start` |
| **ui** | dashboard data channel, settings section, client slots | `ctx.yolo`, durable events, `conversation.view`, `settings.plugin.item` |

## Data flows

### Write path — conversation becomes memory

```
user message
   │  session/event (per message)
   ▼
extract: rule engine ──hit──► candidate buffer (dedup by normalized title)
   │  no hit / turn end
   ▼
agent/turn-stopping ──► LLM structured pull (throttled + token-budgeted)
   │                        │
   │  rules ◄── merge + dedup ──► LLM (later same-key candidates win)
   ▼
ctx.yolo.upsert*  ──►  SQLite (tables) + FTS5 index (trigram, CJK-aware)
                        │
                        └──►  Markdown snapshot (daily / every 10 turns)
```

The rule engine is deliberately cheap — regex over a single message, no LLM
call — so signals like *“8/30 之前完成 X”* are captured instantly. The turn-end
LLM pass then produces cleaner, structured records; both paths converge on the
same dedup key (lowercased, punctuation-stripped title), and the latest
candidate for a key wins at flush time.

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
ctx.yolo ──► ui plugin builds dashboard projection
          ──► durable event yolo/snapshot (SessionEventMap merge)
          ──► client bundle: conversation.view tab + chat node + sidebar button
```

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
| SQLite + FTS5, not a vector store | zero external services, deterministic, CJK-friendly substring recall; semantic recall is roadmap (M8), deliberately deferred |
| hybrid rules + LLM extraction | rules are instant and free; LLM cleans structure; dedup-by-title keeps both from duplicating |
| Markdown as durable record | git-diffable, human-reviewable, survives DB schema changes |
| workspace+branch scoping | projects and experiments stay isolated; branch scope keys make long-running branches their own memory context |
| shared constants module | dsh is v0.1.0-rc; API drift should be a one-place change |

## Extension points used

| dsh extension point | used by | purpose |
|---|---|---|
| `ctx.effect` / service provide | storage | the `ctx.yolo` service |
| `session/event` (`user/message`, …) | extract, memory | per-message rules + latest-user-text tracking |
| `agent/turn-stopping` | extract | turn-end LLM pull |
| `ctx.llm.stream` | extract | structured extraction prompt |
| `ctx.tools.register` | memory | `memory_*` + `yolo_query` |
| `ctx.systemPrompt.section/context` | memory | prefs preamble + dynamic recall |
| `agent/inject`, `agent/followup` | reminder | proactive wake-ups |
| `agent/session-start` | reminder | queue replay |
| durable session events (`yolo/snapshot`) | ui ⇄ client | dashboard data channel |
| `conversation.view`, `conversation.chat.node`, sidebar/settings slots | ui/client | native dashboard UI |

Runtime-verified details and platform gotchas live in
[extension-points.md](extension-points.md); the build contract and
troubleshooting live in [dev-notes.md](dev-notes.md).
