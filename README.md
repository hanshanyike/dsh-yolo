<div align="center">

<img src="docs/logo.svg" width="120" alt="YOLO logo"/>

# YOLO

**Say it once. Keep it on track.**

*A personal assistant for deepseek-harness that watches your conversations, manages your work & life, and reminds you what's due — across every session.*

[![CI](https://github.com/hanshanyike/dsh-yolo/actions/workflows/ci.yml/badge.svg)](https://github.com/hanshanyike/dsh-yolo/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-339933?logo=node.js&logoColor=white)](package.json)
[![Tests](https://img.shields.io/badge/tests-207%20passing-brightgreen)](tests/)
[![Coverage](https://img.shields.io/badge/coverage-74%25%20stmts%20%7C%2086%25%20branches-green)](vitest.config.ts)
[![Built on](https://img.shields.io/badge/built%20on-deepseek--harness-1E90FF)](https://github.com/deepseek-ai/deepseek-harness)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

Every session you have, you also *lose* — the goals, deadlines, decisions and
preferences you just discussed evaporate when the window closes. **YOLO** is the
assistant that keeps your work and life on track, for
[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) users:

- It **watches every conversation** and figures out what matters — your
  **todos**, **milestones**, **goals**, **preferences** and timeline **events**.
- It **manages them across sessions** in a workspace-scoped, searchable store that
  stays with you no matter how many windows you open.
- It **keeps the plan alive**: say "做完了 / 进行中 / 推迟到周五 / 写了一半" in any
  later session and task status, goal progress and due dates update themselves —
  every change audited on the timeline.
- It **reminds you when things are due** — proactively, even if the host was
  offline when the deadline passed — and the reminder is *reply-able*: answer
  「推迟到明天 / 已完成 / 再提醒一次」 and it just happens.
- It **shows your day at a glance** in a global dashboard right in the dsh sidebar
  — timeline, task board, goal progress, milestones & preferences — and lets you
  complete / postpone / cancel todos without leaving it.

YOLO doesn't just *remember* — it *understands*. At every turn end, an LLM
semantic pass (the same pattern as [Mem0](https://github.com/mem0ai/mem0) or
Claude Code's auto-memory) reads the whole exchange, extracts only the durable
asks, and deduplicates them against what's already stored — so your plan stays
accurate without spamming your tokens.

## ✨ Features

| | |
|---|---|
| 🧠 **LLM semantic extraction** | One structured pull at every turn end: the model reads the whole exchange and returns todos / milestones / goals / preferences / events **plus state-change `updates[]`** — deduplicated against a known-memories digest that carries status, progress and due dates |
| 🗄️ **Layered storage** | SQLite (WAL + FTS5 trigram, CJK-aware) as the fast store; human-readable **Markdown snapshots** — your memory is versionable & diffable |
| 📈 **Stateful plan with event audit** | Todos flow `pending → in_progress → done/cancelled` (+ postpone / start / remind-again), goals track 0–100 progress, milestones carry status — one set of domain actions serves extraction, chat replies and the dashboard, and every transition lands on the timeline |
| 🔎 **Model-visible tools** | `memory_search` / `memory_write` / `memory_forget` / `yolo_query` / `yolo_action` — the agent reads, manages *and advances* your plan itself |
| 📝 **Automatic recall** | Preferences ride along in every system prompt; related memories are FTS-recalled against your latest message — no "remember that?" needed |
| 🔔 **Reply-able reminders** | Time-triggered `agent.followup` wake-ups carrying the todo id + routing instructions — answer「已完成 / 推迟到明天 / 再提醒一次」and the agent applies it via `yolo_action`; queue-and-replay on session start so nothing is lost while the host is offline |
| 📊 **Actionable sidebar dashboard** | A global YOLO panel in the dsh sidebar footer: timeline, task board, goal progress, milestones & preferences — session-independent, live-polled, and open todos carry ✓ 完成 / +1d / ✕ buttons that act in place |
| 🧩 **Everything is a plugin** | 5 cooperating plugins over Cordis capability seams; each piece swappable, HMR-friendly |

## 🏗️ Architecture

```
        ┌──────────────────────────────────────────────────────────┐
        │                   deepseek-harness host                   │
        │   (Cordis microkernel · "everything is a plugin")         │
        └──────────────────────────────────────────────────────────┘
                                  ▲
        ┌─────────────────────────┴─────────────────────────┐
        │                    yolo bundle                     │
        │                                                    │
        │  dsh-yolo-storage   Service `ctx.yolo`             │
        │    └─ SQLite + FTS5 + Markdown snapshot + scopes   │
        │       + domain actions w/ event audit            │
        │  dsh-yolo-extract   turn-end LLM semantic pull     │
        │    └─ new items + state-change updates[]           │
        │  dsh-yolo-memory    memory_* + yolo_action tools   │
        │  dsh-yolo-reminder  scheduler + reply-able wake-ups│
        │  dsh-yolo-ui        settings + dashboard/actions   │
        └────────────────────────────────────────────────────┘
```

| plugin | role |
|---|---|
| `dsh-yolo-storage` | **Service** (`ctx.yolo`): SQLite + FTS5 + Markdown snapshots, workspace-scoped; domain actions (`applyTodoAction` / `applyGoalProgress` / `applyMilestoneStatus`) with event audit + fuzzy title finders |
| `dsh-yolo-extract` | LLM semantic extraction at turn end (todos / milestones / goals / preferences / events + state-change `updates[]`), dedup + throttle + milestone linking |
| `dsh-yolo-memory` | model-visible `memory_search/write/forget` + `yolo_query` / `yolo_action` tools, persistent preamble + dynamic recall |
| `dsh-yolo-reminder` | time-triggered reply-able reminders (`agent.followup(msg)` + `session-start` replay) |
| `dsh-yolo-ui` | settings section + `GET /yolo/dashboard` / `POST /yolo/actions` JSON APIs feeding the global sidebar dashboard |

## 🚀 Quick Start

> **Prerequisites**: Node ≥ 22.19, pnpm ≥ 11.
> On Windows, run commands from **PowerShell** (Git Bash breaks pnpm's safe-delete).

```bash
git clone https://github.com/hanshanyike/dsh-yolo.git
cd dsh-yolo

pnpm install          # YOLO's own deps (better-sqlite3 native binding included)
pnpm dev:web:setup    # one-time: clones & builds the host, links the profile,
                      #          generates the runtime patch overlay
pnpm dev:web          # boots dsh web → http://127.0.0.1:4080
```

`dev.mjs` is idempotent — re-run `pnpm dev:web` any time; use
`pnpm dev:web:update` to pull the latest host first. It also clones
[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) into
`host/deepseek-harness` on first setup, so nothing is installed globally.

Open **http://127.0.0.1:4080**, pick your workspace, and start talking.
YOLO is already watching: mention a deadline, set a goal, or say *"remember this"* —
then open the **YOLO panel** at the bottom of the left sidebar to see your
timeline, task board, and goal progress.

### How it works — a 10-second demo

```
you:  帮我下周完成季度报告，然后记得周二开会前提醒我
yolo:  [extract] +todo "季度报告" due=2026-08-27 priority=high
       [extract] +todo "周二会议" due=2026-08-25
       [remind] ⏰ scheduler armed — will wake the agent before the meeting
you:  (next morning, new session)
yolo:  ⏰ "周二会议" is due today — reply to postpone or mark it done.
you:  推迟到明天，报告已经写了一半
yolo:  [yolo_action] postpone "周二会议" → due 2026-08-26 ✓
       [extract] updates: "季度报告" → in_progress, goal 进度 50%
      (recalled automatically: prefs say you prefer Chinese summaries)
```

## 💾 Where your memory lives

```
data/
├── yolo-<scope>.db            # SQLite (WAL + FTS5 trigram) — the fast store
└── snapshots/                 # Markdown — human-readable, committed to git
    └── 2026-08-20.md          #   your memory, versioned and diffable
```

Memory is **workspace-scoped** (`sha1(cwd)/<git-branch>`), so two projects never
bleed into each other. The DB is a rebuildable cache; the Markdown snapshots are
the durable, reviewable record — you can restore the DB from a snapshot at any
time.

## 🧭 Roadmap

One idea, delivered step by step — [docs/VISION.md](docs/VISION.md): *remember what you say,
keep it on track*. The core mechanic is deliberately simple: **every record carries a target
time, and YOLO fires when it's due** — you reply to act, no ceremony.

**✅ Shipped**

- Memory foundation — LLM semantic extraction (todos / milestones / goals / preferences /
  events), SQLite + FTS5 storage, Markdown snapshots, automatic recall
- Proactive reminders — due records wake the agent; queued & replayed while offline
- Global sidebar dashboard — timeline, task board, goals, milestones, preferences
- Stateful plan — task status, goal progress, milestone transitions, every change audited
- Reply-to-act — answer 「已完成 / 推迟到明天 / 再提醒一次」 and it just happens; the
  dashboard carries the same in-place actions
- Release engineering — CI, npm package claimed ([`0.2.0-alpha.1`](https://www.npmjs.com/package/dsh-plugin-yolo))

**🔜 Next**

- Semantic recall — FTS keyword search upgraded to meaning-based matching (search
  「季度总结」 and hit “Q3 report”)
- Cross-workspace aggregation — one view over all workspaces' due items (isolated by
  default, aggregation opt-in)
- Stable `v0.3.0` release

**🌱 Future**

- Pair with your coding agent, plan your day, grow deeply personal — the Jarvis endgame

> **North star:** YOLO delivers through *its own conversation* — a record fires when due, and
> you reply to act (postpone / mark done / reschedule). It does **not** shovel memory into
> every session; per-session injection is optional and off by default — agents ask via
> `memory_search` / `yolo_query` when they need context. Full rationale in
> [docs/VISION.md](docs/VISION.md).

Current quality bar: **207 tests passing**, `tsc --noEmit` clean, and a live
E2E walkthrough of the panel (see [docs/testing.md §七](docs/testing.md)) for
every change touching the UI.

## 📚 Docs

Start at the [docs index](docs/README.md) — it maps every document to its audience:

- [`docs/VISION.md`](docs/VISION.md) — the project's vision & the vision-driven roadmap (start here)
- [`docs/architecture.md`](docs/architecture.md) — data flow, plugin seams, design decisions
- [`docs/modules.md`](docs/modules.md) — per-module reference: files, key types, public APIs, gotchas (改代码前先查这里)
- [`docs/usage.md`](docs/usage.md) — user guide: install, config, features, data storage
- [`docs/testing.md`](docs/testing.md) — test suite: how to run, what's covered, how to add tests
- [`docs/release.md`](docs/release.md) — how to cut a release & publish to npm
- [`CHANGELOG.md`](CHANGELOG.md) — release history
- [`src/storage/schema.sql`](src/storage/schema.sql) — the full SQLite schema

## 🤝 Contributing

- Found a bug or have an idea? Open an **issue** — architecture/ADR-style discussions welcome.
- Want to help? Pick a "Next" item from the roadmap — semantic recall is the current front.
- Keep `pnpm check` clean and `pnpm test` green before opening a PR.
- **UI changes additionally require a live E2E walkthrough** (`pnpm build && pnpm dev:web`,
  then work through the W1–W8 checklist in [docs/testing.md §七](docs/testing.md#七真机端到端验证)).

```bash
pnpm check   # tsc --noEmit
pnpm test    # vitest (tests/ only — the config excludes the dev host)
```

## 📄 License

[MIT](LICENSE) © dsh-yolo contributors

---

<p align="center"><sub>Made with 🧠 for deepseek-harness — <i>"Say it once. Keep it on track."</i></sub></p>
