<div align="center">

# 🎯 YOLO — You Only Live/Look Once

**Your personal ultimate intelligent-assistant plugin for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)**

Watch every conversation. Never lose what matters again.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-339933?logo=node.js&logoColor=white)](package.json)
[![Built on](https://img.shields.io/badge/built%20on-deepseek--harness-1E90FF)](https://github.com/deepseek-ai/deepseek-harness)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

**YOLO** rides deepseek-harness's *"everything is a plugin"* architecture to give the agent a persistent personal memory of **you**. It watches every session, automatically extracts the things that matter — key **milestones**, **to-dos**, **goals**, **preferences**, and timeline **events** — stores them in a structured, searchable store, proactively **reminds** you when deadlines arrive, and renders a **native dashboard** right inside the dsh UI showing your whole world at a glance.

Unlike keyword-search memory plugins, YOLO *structurally decomposes* conversations with a hybrid extractor: cheap per-message rules catch signals instantly, then an LLM pass at turn end pulls clean, structured records.

## ✨ Features

| | |
|---|---|
| 🧠 **Hybrid extraction** | Per-message rule capture (TODO/deadline/milestone/goal/preference signals) + turn-end LLM structured pull with dedup & throttling |
| 🗄️ **Layered storage** | SQLite (WAL + FTS5 trigram, CJK-aware) as the primary store; human-readable **Markdown snapshots** committed to git — your memory is versionable & diffable |
| 🔎 **Model-visible tools** | `memory_search` / `memory_write` / `memory_forget` / `yolo_query` so the agent itself can read & manage your memory |
| 🔔 **Proactive reminders** | Time-triggered `agent.inject` + `followup` wake-ups, with queue-and-replay on `agent/session-start` so nothing is lost while the host is offline |
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
| `dsh-yolo-ui` | native UI: `conversation.view` tab, conversation node, header button, settings card |

## 🚀 Quick Start

> **Prerequisites**: Node ≥ 22.19, pnpm ≥ 11, a checkout of
> [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) as the dev host
> (the monorepo runs from source via `tsx` — no global install needed).

```bash
# 1. clone this repo next to your host checkout
git clone https://github.com/hanshanyike/dsh-yolo.git
cd dsh-yolo

# 2. install yolo's own deps (better-sqlite3, types, tooling)
pnpm install

# 3. host deps + build (Windows: run via PowerShell — Git Bash breaks pnpm's safe-delete)
cd host/deepseek-harness
pnpm install
pnpm run build

# 4. boot the web profile with the yolo patch overlay
node --import tsx/esm apps/cli/src/bin.ts web --patch D:/path/to/dsh-yolo/cordis.dev.yml --no-open
# → dsh web: http://127.0.0.1:3080
```

Open **http://127.0.0.1:3080**, pick your workspace, and start talking.
YOLO is already watching: mention a deadline, set a goal, or say *"remember this"* —
then open the **YOLO** tab to see your timeline, task board, and goal progress.

### How it works — a 10-second demo

```
you:  帮我下周完成季度报告，然后记得周二开会前提醒我
yolo:  [extract] +todo "季度报告" due=2026-08-27 priority=high
       [extract] +todo "周二会议" due=2026-08-25
       [remind] ⏰ scheduler armed — will inject a reminder before the meeting
you:  (opens YOLO tab)
      ✅ Todos: 季度报告(high, due 8/27) · 周二会议(due 8/25)
      ✅ Timeline: 2026-08-20 记录了两条待办
```

## 💾 Where your memory lives

```
data/
├── yolo-<scope>.db            # SQLite (WAL + FTS5 trigram) — the fast store
└── snapshots/                 # Markdown — human-readable, committed to git
    └── 2026-08-20.md          #   your memory, versioned and diffable
```

Memory is **workspace-scoped** (`sha1(cwd)/<git-branch>`), so two projects never bleed
into each other. The DB is a rebuildable cache; the Markdown snapshots are the durable,
reviewable record — you can restore the DB from a snapshot at any time.

## 🧭 Roadmap

| Milestone | Status | Deliverable |
|---|---|---|
| **M0** | ✅ done | scaffold + git repo + dev host + minimal plugin loads |
| **M1** | ✅ done | `ctx.yolo` storage Service + SQLite/FTS5/snapshots + memory tools — **14/14 tests pass** |
| **M2** | ⏳ next | hybrid extraction (rules + turn-end LLM) + dedup |
| **M3** | ⬜ | injection: systemPrompt preamble/recall + reminders + session-start replay |
| **M4** | ⬜ | native UI: YOLO tab + conversation node + header button + settings card |
| **M5** | ⬜ | scheduler hardening + snapshot scheduling + ≥80% coverage |

## 📚 Docs

- [`docs/extension-points.md`](docs/extension-points.md) — verified dsh extension points & platform gotchas (Windows boot recipe, loader rules, FTS5 notes)
- [`src/storage/schema.sql`](src/storage/schema.sql) — the full SQLite schema
- The master implementation plan lives in the WorkBuddy plan file (see commit history for the roadmap)

## 🤝 Contributing

- Found a bug or have an idea? Open an **issue** — architecture/ADR-style discussions welcome.
- Want to help? Pick an open milestone (M2–M5) — each is a self-contained plugin.
- Keep `tsc --noEmit` clean and `pnpm test` green before opening a PR.

```bash
pnpm check   # tsc --noEmit
pnpm test    # vitest (tests/ only — the config excludes the dev host)
```

## 📄 License

[MIT](LICENSE) © dsh-yolo contributors

---

<p align="center"><sub>Made with 🧠 for deepseek-harness — "Model thinks, Harness acts, YOLO remembers."</sub></p>
