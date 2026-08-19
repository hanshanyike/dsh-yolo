# dsh-plugin-yolo

**YOLO (You Only Live/Look Once)** — a personal ultimate intelligent-assistant plugin for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).

YOLO watches every conversation, automatically extracts what matters to you — key milestones, to-dos, goals, preferences, timeline events — stores it structured, proactively reminds you when things come due, and renders a native dashboard inside the dsh UI so you can see your whole world at a glance: timeline, task board, goal progress.

It is designed as a multi-plugin bundle riding dsh's "everything is a plugin" architecture:

| plugin | role |
|---|---|
| `dsh-yolo-storage` | Service (`ctx.yolo`): SQLite + FTS5 + Markdown snapshot, workspace-scoped |
| `dsh-yolo-extract` | hybrid extraction: per-message rules + turn-end LLM structured pull, dedup |
| `dsh-yolo-memory` | model-visible `memory_search/write/forget` tools + persistent preamble + dynamic recall |
| `dsh-yolo-reminder` | time-triggered reminders (`agent.inject` + `followup` + `session-start` replay) |
| `dsh-yolo-ui` | native UI: `conversation.view` Tab, conversation node, header button, settings card |

## Status

M0 — scaffold + minimal loadable plugin. See `C:\Users\91813\.workbuddy\plans\blazing-aurora-tesla.md` for the full plan and milestone roadmap (M0–M5).

## Develop

```bash
# from a checked-out deepseek-harness host (sibling dir ./host/deepseek-harness)
cd host/deepseek-harness
pnpm dsh web --patch D:/Code/WorkBuddy/dsh-yolo/cordis.dev.yml
# watch the host terminal for: [yolo] plugin loaded
# open http://127.0.0.1:3080
```

## License

MIT
