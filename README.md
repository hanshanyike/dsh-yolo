<div align="center">

<img src="docs/logo.svg" width="120" alt="YOLO logo"/>

# YOLO

**Say it once. Keep it on track.**

*A personal assistant for deepseek-harness that watches your conversations, manages your work & life, and reminds you what's due — across every session.*

[![CI](https://github.com/hanshanyike/dsh-yolo/actions/workflows/ci.yml/badge.svg)](https://github.com/hanshanyike/dsh-yolo/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-339933?logo=node.js&logoColor=white)](package.json)
[![Tests](https://img.shields.io/badge/tests-114%20passing-brightgreen)](tests/)
[![Coverage](https://img.shields.io/badge/coverage-76%25%20stmts%20%7C%2082%25%20branches-green)](vitest.config.ts)
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
- It **reminds you when things are due** — proactively, even if the host was
  offline when the deadline passed.
- It **shows your day at a glance** in a global dashboard right in the dsh sidebar
  — timeline, task board, goal progress, milestones & preferences.

YOLO doesn't just *remember* — it *understands*. At every turn end, an LLM
semantic pass (the same pattern as [Mem0](https://github.com/mem0ai/mem0) or
Claude Code's auto-memory) reads the whole exchange, extracts only the durable
asks, and deduplicates them against what's already stored — so your plan stays
accurate without spamming your tokens.

## ✨ Features

| | |
|---|---|
| 🧠 **LLM semantic extraction** | One structured pull at every turn end: the model reads the whole exchange and returns todos / milestones / goals / preferences / events — deduplicated against known memories, throttled per session |
| 🗄️ **Layered storage** | SQLite (WAL + FTS5 trigram, CJK-aware) as the fast store; human-readable **Markdown snapshots** — your memory is versionable & diffable |
| 🔎 **Model-visible tools** | `memory_search` / `memory_write` / `memory_forget` / `yolo_query` — the agent reads and manages your memory itself |
| 📝 **Automatic recall** | Preferences ride along in every system prompt; related memories are FTS-recalled against your latest message — no "remember that?" needed |
| 🔔 **Proactive reminders** | Time-triggered `agent.inject` + `followup` wake-ups, with queue-and-replay on session start so nothing is lost while the host is offline |
| 📊 **Sidebar dashboard** | A global YOLO panel in the dsh sidebar footer: timeline, task board, goal progress, milestones & preferences — session-independent, live-polled, no separate server |
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
        │  dsh-yolo-extract   turn-end LLM semantic pull     │
        │  dsh-yolo-memory    memory_* tools + systemPrompt   │
        │  dsh-yolo-reminder  scheduler + agent.inject        │
        │  dsh-yolo-ui        settings + /yolo/dashboard API  │
        └────────────────────────────────────────────────────┘
```

| plugin | role |
|---|---|
| `dsh-yolo-storage` | **Service** (`ctx.yolo`): SQLite + FTS5 + Markdown snapshots, workspace-scoped |
| `dsh-yolo-extract` | LLM semantic extraction at turn end (todos / milestones / goals / preferences / events), dedup + throttle |
| `dsh-yolo-memory` | model-visible `memory_search/write/forget` + `yolo_query` tools, persistent preamble + dynamic recall |
| `dsh-yolo-reminder` | time-triggered reminders (`agent.inject` + `followup` + `session-start` replay) |
| `dsh-yolo-ui` | settings section + `GET /yolo/dashboard` JSON API feeding the global sidebar dashboard |

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
       [remind] ⏰ scheduler armed — will inject a reminder before the meeting
you:  (next morning, new session)
yolo:  ⏰ "周二会议" is due today — prep before the standup.
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

The roadmap isn't a list of chores — it's a path toward [docs/VISION.md](docs/VISION.md): from *remember* to
*manage → anticipate → accompany*, growing into a Jarvis-style work & life assistant — always **managing, never
doing your work**, and always staying zero-external-service.

| Phase | Goal | Status |
|---|---|---|
| **0 · Keeper** (anchor) | remembers well, stable `0.2.0` | 🔨 in progress (M6 release engineering) |
| **1 · Organizer** | tasks get state, goals get progress, preferences take effect; YOLO as its own reply-able conversation (postpone / complete / reshape) | 🗓 planned (absorbs M8) |
| **2 · Manager** | a YOLO conversation that reminds you — right-time, right-tone, reply-to-act; cross-workspace aggregation | 🗓 planned (absorbs M9, M10) |
| **3 · Companion** | pairs with your coding agent, plans your day, deeply personal | 🌱 future (the Jarvis endgame) |

> **North star:** YOLO delivers through *its own conversation* — it speaks to you when the time is
> right, and you can reply to act (postpone / mark done / reschedule). It does **not** shovel memory
> into every session; per-session injection is optional and off by default — agents ask via
> `memory_search` / `yolo_query` when they need context. Full rationale in [docs/VISION.md](docs/VISION.md).

**Already shipped** — the Keeper foundation (mapped to phases, full detail in VISION.md):

| Milestone | Phase | Status |
|---|---|---|
| **M0–M3** | 0 | skeleton · storage service · LLM extraction · prompt/recall injection + reminders |
| **M4–M5** | 0 | settings + dashboard shell · snapshot scheduling + scheduler hardening |
| **M7** | 0 | semantic-first extraction (no regex) · global sidebar dashboard · crash & scope fixes |
| **M6** | 0 | **release engineering** — CI · npm manifest · name claimed ([`0.2.0-alpha.1`](https://www.npmjs.com/package/dsh-plugin-yolo)) · ⏳ stable `v0.2.0` |

Current quality bar: **114 tests passing**, `tsc --noEmit` clean.

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
- Want to help? Pick a roadmap milestone (M6 next) — each is a self-contained deliverable.
- Keep `pnpm check` clean and `pnpm test` green before opening a PR.

```bash
pnpm check   # tsc --noEmit
pnpm test    # vitest (tests/ only — the config excludes the dev host)
```

## 📄 License

[MIT](LICENSE) © dsh-yolo contributors

---

<p align="center"><sub>Made with 🧠 for deepseek-harness — <i>"Say it once. Keep it on track."</i></sub></p>
