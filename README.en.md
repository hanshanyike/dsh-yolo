<div align="center">

<img src="docs/logo.svg" width="120" alt="YOLO logo"/>

# YOLO

**Say it once. Keep it on track.**

*A personal assistant for deepseek-harness that watches your conversations, manages your work & life, and reminds you what's due — across every session.*

[中文](README.md) · [Docs index](docs/README.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

Every session you have, you also *lose* — the goals, deadlines, decisions and
preferences you just discussed evaporate when the window closes. **YOLO** is an
assistant that doesn't forget: it catches what you say in a conversation and
sorts it into a plan that's cross-session, reviewable, and proactively reminded.

It remembers for you, but doesn't do the work:

- It **watches every conversation** and understands what's worth keeping —
  todos, milestones, goals, preferences and scheduled events.
- It **manages them across sessions** in a workspace-scoped, searchable store
  that follows you no matter how many windows you open.
- It **keeps the plan alive**: say 「做完了 / 进行中 / 推迟到周五 / 写了一半」
  (or "done / in progress / move it to Friday / half-way done") in any later
  session and task status, goal progress and due dates update themselves —
  every change audited on the timeline.
- It **reminds you when things are due** — proactively, replaying anything missed
  while the host was offline — and the reminder is *reply-able*: answer
  「推迟到明天 / 已完成 / 再提醒一次」 and it just happens.
- It **shows your day at a glance** in a global dashboard right in the dsh
  sidebar: timeline, task board, goal progress, milestones & preferences — and
  lets you complete / postpone / cancel todos without leaving it.

YOLO doesn't just *remember* — it *understands*. At every turn end, an LLM
semantic pass (the same pattern as [Mem0](https://github.com/mem0ai/mem0) or
Claude Code's auto-memory) reads the whole exchange and extracts only the durable
asks, deduplicated against what's already stored — so your plan stays accurate
without spamming your tokens.

## Quick Start

> **Prerequisites**: Node ≥ 22.19, pnpm ≥ 11, and an installed `dsh` CLI (deepseek-harness).
> On Windows, run commands from **PowerShell** (Git Bash breaks pnpm's safe-delete).

```bash
git clone https://github.com/hanshanyike/dsh-yolo.git
cd dsh-yolo

pnpm install          # YOLO's own deps (better-sqlite3 native binding included)
pnpm build            # build the host plugin + browser client into dist/
pnpm dsh plugin add . --profile web   # one-time: register the plugin bundle in the dsh web profile (standard dsh install)
pnpm dsh web --no-open --port 4080    # boots dsh web → http://127.0.0.1:4080
```

`dsh plugin add .` is the standard dsh install path: the plugin mounts as a bundle in
the `web` profile (`dsh.bundle.patch` points at `cordis.patch.yml`, which registers
every host-side plugin row). `dsh web` (`web` implies `--profile web`) runs the
**installed** dsh CLI, matching your host environment (default port **3080**; this
dev machine uses `--port 4080` because 3080 is occupied). After code changes,
re-run `pnpm build` and refresh the browser — no host restart needed.

Open **http://127.0.0.1:4080**, pick your workspace, and start talking. YOLO is
already watching: mention a deadline, set a goal, or say "remember this" — then
open the **YOLO panel** at the bottom of the left sidebar to see your timeline,
task board, and goal progress.

### How it works — a 10-second demo

```
you:  帮我下周完成季度报告，然后记得周二开会前提醒我
yolo: [extract] +todo "季度报告" due=2026-08-27 priority=high
      [extract] +todo "周二会议" due=2026-08-25
      [remind] ⏰ scheduler armed — will wake the agent before the meeting
you:  (next morning, new session)
yolo: ⏰ "周二会议" is due today — reply to postpone or mark it done.
you:  推迟到明天，报告已经写了一半
yolo: [yolo_action] postpone "周二会议" → due 2026-08-26 ✓
      [extract] updates: "季度报告" → in_progress, goal 进度 50%
```

## Where your memory lives

```
data/
├── yolo-<scope>.db            # SQLite (WAL + FTS5) — the fast store
└── snapshots/                 # Markdown — human-readable, versionable
    └── 2026-08-20.md          #   your memory, diffable and committable
```

Memory is **workspace-scoped** (`sha1(cwd)/<git-branch>`), so two projects never
bleed into each other. The DB is a rebuildable cache; the Markdown snapshots are
the durable, reviewable record — you can restore the DB from a snapshot at any
time.

## Roadmap

YOLO's journey is four stages: **remember → organize → anticipate → accompany**.
The first two are live — it remembers what you say and sorts it into a stateful
plan. The third, "anticipate," is simple: every record carries a target time and
fires when due — reply to act, no ceremony; at other times it stays quiet. The
endgame, "accompany," is understanding your rhythm and collaborating with your
agent — that's a later horizon. Full vision in [docs/VISION.md](docs/VISION.md).

## Docs

Start at the [docs index](docs/README.md) — it maps every document to its audience:

- [User guide](docs/usage.md) — install, config, features, data storage (Chinese)
- [Vision](docs/VISION.md) — the project's vision & vision-driven direction (Chinese)
- [Product design](docs/product-design.md) — the 1.0 dashboard blueprint (Chinese)
- [Architecture overview](docs/architecture/overview.md) — data flows, plugin seams, decisions (English)
- [Architecture reference](docs/architecture/modules.md) — per-module files, types, public APIs, gotchas (Chinese)
- [Testing](docs/testing.md) — how to run, what's covered, how to add, live walkthrough (Chinese)
- [Release](docs/release.md) — how to cut a release & publish to npm (English)
- [CHANGELOG](CHANGELOG.md) — release history

## Contributing

We'd love your help — see [CONTRIBUTING.md](CONTRIBUTING.md). Found a bug or have
an idea? Open an issue. Before opening a PR, keep `pnpm check` clean and
`pnpm test` green; UI changes additionally need a live walkthrough (the W1–W8
checklist in [docs/testing.md §七](docs/testing.md#七真机端到端验证)).

## License

[MIT](LICENSE) © dsh-yolo contributors

---

<p align="center"><sub>Made for deepseek-harness — <i>"Say it once. Keep it on track."</i></sub></p>
