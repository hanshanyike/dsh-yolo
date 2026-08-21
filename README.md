<div align="center">

<img src="docs/logo.svg" width="120" alt="YOLO logo"/>

# YOLO — You Only Live/Look Once

**The persistent memory layer for your AI coding agent.**

*Model thinks, Harness acts, YOLO remembers.*

[![CI](https://github.com/hanshanyike/dsh-yolo/actions/workflows/ci.yml/badge.svg)](https://github.com/hanshanyike/dsh-yolo/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-339933?logo=node.js&logoColor=white)](package.json)
[![Tests](https://img.shields.io/badge/tests-112%20passing-brightgreen)](tests/)
[![Coverage](https://img.shields.io/badge/coverage-76%25%20stmts%20%7C%2082%25%20branches-green)](vitest.config.ts)
[![Built on](https://img.shields.io/badge/built%20on-deepseek--harness-1E90FF)](https://github.com/deepseek-ai/deepseek-harness)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

AI agents are brilliant — and forgetful. Close a session and the goals, deadlines,
decisions and preferences you just discussed evaporate. **YOLO** fixes that for
[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) users:

- It **watches every conversation** and structurally extracts what matters —
  **todos**, **milestones**, **goals**, **preferences** and timeline **events**.
- It **remembers across sessions** in a workspace-scoped, searchable store that
  the agent itself can query via tools.
- It **reminds you proactively** when deadlines arrive, even if the host was
  offline when they came due.
- It **shows your world at a glance** in a native dashboard tab inside the dsh UI.

Unlike keyword-note plugins, YOLO *structurally decomposes* conversations with a
hybrid extractor: cheap per-message rules catch signals instantly, then an LLM
pass at turn end pulls clean, deduplicated records — so memory stays accurate
without spamming your tokens.

## ✨ Features

| | |
|---|---|
| 🧠 **Hybrid extraction** | Per-message rule capture (todo / deadline / milestone / goal / preference signals) + turn-end LLM structured pull with dedup & throttling |
| 🗄️ **Layered storage** | SQLite (WAL + FTS5 trigram, CJK-aware) as the fast store; human-readable **Markdown snapshots** — your memory is versionable & diffable |
| 🔎 **Model-visible tools** | `memory_search` / `memory_write` / `memory_forget` / `yolo_query` — the agent reads and manages your memory itself |
| 📝 **Automatic recall** | Preferences ride along in every system prompt; related memories are FTS-recalled against your latest message — no "remember that?" needed |
| 🔔 **Proactive reminders** | Time-triggered `agent.inject` + `followup` wake-ups, with queue-and-replay on session start so nothing is lost while the host is offline |
| 📊 **Native dashboard** | A YOLO tab in the dsh web UI: timeline, task board, goal progress, milestones & preferences — no separate server, no extra setup |
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
        │  dsh-yolo-extract   session/event rules +          │
        │                     agent/turn-stopping LLM pull    │
        │  dsh-yolo-memory    memory_* tools + systemPrompt   │
        │  dsh-yolo-reminder  scheduler + agent.inject        │
        │  dsh-yolo-ui        conversation.view Tab + nodes   │
        └────────────────────────────────────────────────────┘
```

| plugin | role |
|---|---|
| `dsh-yolo-storage` | **Service** (`ctx.yolo`): SQLite + FTS5 + Markdown snapshots, workspace-scoped |
| `dsh-yolo-extract` | hybrid extraction: per-message rules + turn-end LLM structured pull, dedup + throttle |
| `dsh-yolo-memory` | model-visible `memory_search/write/forget` + `yolo_query` tools, persistent preamble + dynamic recall |
| `dsh-yolo-reminder` | time-triggered reminders (`agent.inject` + `followup` + `session-start` replay) |
| `dsh-yolo-ui` | native UI: `conversation.view` tab, conversation node, sidebar button, settings card |

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
then open the **YOLO** tab to see your timeline, task board, and goal progress.

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

| Milestone | Status | Deliverable |
|---|---|---|
| **M0** | ✅ done | scaffold + git repo + dev host + minimal plugin loads |
| **M1** | ✅ done | `ctx.yolo` storage Service + SQLite/FTS5/snapshots + memory tools |
| **M2** | ✅ done | hybrid extraction (rules + turn-end LLM) + dedup |
| **M3** | ✅ done | injection: systemPrompt preamble/recall + reminders + session-start replay |
| **M4** | ✅ done | settings section + client UI shell + **live data channel** (host publishes `yolo/snapshot` durable events → dashboard tab renders real data; `/yolo` command) |
| **M5** | ✅ done | snapshot scheduling (daily + every 10 turns) + scheduler hardening + coverage push |
| **M6** | 🔨 in progress | **release engineering** — ✅ GitHub Actions CI (typecheck + tests + build on Linux & Windows, coverage artifact) · ✅ npm-ready manifest (registry deps, `files`, `publishConfig`) · ✅ community files (issue/PR templates) · ⏳ first `npm publish` + `v0.2.0` tag |
| **M7** | 🗓 planned | **memory portability** — snapshot import/export CLI, DB rebuild-from-snapshot tooling, workspace merge |
| **M8** | 🗓 planned | **recall quality** — hybrid ranking (FTS + semantic embeddings), recall feedback loop measuring whether injected memories actually helped |
| **M9** | 🗓 planned | **multi-workspace aggregation** — cross-project global timeline, auto-generated weekly review digest |

Current quality bar: **112 tests passing**, 76% statements / 82% branches
coverage, `tsc --noEmit` clean.

## 📚 Docs

- [`docs/architecture.md`](docs/architecture.md) — data flow, plugin seams, design decisions
- [`docs/extension-points.md`](docs/extension-points.md) — verified dsh extension points & platform gotchas (Windows boot recipe, loader rules, FTS5 notes)
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

<p align="center"><sub>Made with 🧠 for deepseek-harness — <i>"Model thinks, Harness acts, YOLO remembers."</i></sub></p>
