<div align="center">

<img src="docs/logo.svg" width="120" alt="YOLO logo"/>

# YOLO

**Turn important conversations into plans you can keep following.**

*A personal assistant for deepseek-harness that organizes commitments from conversations, tracks changes, and reminds you when needed.*

[中文](README.md) · [Docs index](docs/README.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

Todos, deadlines, and milestones are often scattered across multiple conversations.
As sessions accumulate, it becomes difficult to tell what is unfinished and what
has changed. **YOLO** identifies the items that still need attention and turns them
into a plan that can be reviewed, updated, and reminded across sessions.

YOLO organizes information and tracks progress; you still decide what to do and
how to do it. It can:

- **Organize automatically** after each turn, identifying explicit todos,
  goals, milestones, and reminder rules.
- **Preserve items across sessions** in a workspace-scoped, searchable store.
- **Track changes** when you say “done,” “move it to Friday,” or “halfway there,”
  while keeping a record of each update.
- **Remind you when items are due** through YOLO notifications and its resident
  conversation, without injecting messages into an active work conversation.
- **Provide one place to review and act** from the sidebar dashboard, including
  today, upcoming, completed, goals, and the activity ledger.

YOLO uses an LLM for semantic extraction rather than keyword matching. It keeps
items and rules that need continued management while filtering acknowledgements,
generic knowledge, and unrelated personal profiling.

## Quick Start

> **Prerequisites**: Node.js ≥ 22.19 and pnpm ≥ 11 installed on your system.
> On Windows, run commands from **PowerShell** (Git Bash breaks pnpm's safe-delete).

```bash
git clone https://github.com/hanshanyike/dsh-yolo.git
cd dsh-yolo

pnpm install
pnpm build
npx @deepseek-ai/dsh plugin add . --profile web
npx @deepseek-ai/dsh web
```

`dsh web` opens [http://127.0.0.1:3080](http://127.0.0.1:3080) by default and
tries to open the page in your default browser. Pass `--no-open` to suppress the
browser launch. If port 3080 is occupied, append `--port 4080` and open
[http://127.0.0.1:4080](http://127.0.0.1:4080).

After changing code, run `pnpm build` again and refresh the browser. You only need
to rerun `plugin add` when the plugin manifest changes. Development-only commands,
including E2E fixture cleanup, are documented in
[the testing guide](docs/testing-e2e.md).

### A typical flow

```
Mention an item and its timing in any dsh conversation
        ↓
YOLO organizes it as a todo, goal, or milestone
        ↓
Update it later from a conversation or the dashboard
        ↓
YOLO reminds you through notifications and its resident conversation
```

## Where your data lives

```
data/
├── yolo-<scope>.db            # SQLite (WAL + FTS5) — the fast store
└── snapshots/                 # Markdown — human-readable, versionable
    └── 2026-08-20.md          #   a readable, comparable record snapshot
```

Data is isolated by **workspace and Git branch**, so two projects do not mix
records. SQLite supports normal queries and state updates; Markdown snapshots
make the records readable, versionable, and recoverable.

## Roadmap

YOLO develops through four stages: **remember → organize → anticipate →
accompany**. It currently supports cross-session records, plan organization,
due reminders, and dashboard actions. Future work focuses on better priority
judgment, rhythm adaptation, and agent collaboration. See the full direction in
[docs/VISION.md](docs/VISION.md).

## Docs

Start at the [docs index](docs/README.md) — it maps every document to its audience:

- [User guide](docs/usage.md) — install, config, features, data storage (Chinese)
- [Vision](docs/VISION.md) — the project's vision & vision-driven direction (Chinese)
- [Product design](docs/product-design.md) — the 1.0 dashboard blueprint (Chinese)
- [Architecture overview](docs/architecture/overview.md) — data flows, plugin seams, decisions (English)
- [Module index](docs/architecture/modules.md) — implementation docs by module (Chinese)
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

<p align="center"><sub>Made for deepseek-harness — <i>Turn important conversations into plans you can keep following.</i></sub></p>
