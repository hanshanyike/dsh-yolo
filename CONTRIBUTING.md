# Contributing to YOLO

Thanks for considering contributing! YOLO is a small, opinionated plugin bundle for
[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). We keep it simple:

## Ground rules

- **Small, self-contained PRs.** Each YOLO plugin (storage / extract / memory / reminder / ui)
  is an independent Cordis plugin — touch one at a time unless the change genuinely spans seams.
- **Keep the checks green** before opening a PR:
  ```bash
  pnpm check    # tsc --noEmit
  pnpm test     # vitest — only tests/ runs; the config excludes the dev host
  ```
- **Document platform gotchas** in [`docs/extension-points.md`](docs/extension-points.md)
  (dsh is v0.1.0-rc — anything you verify at runtime belongs there).
- **No secrets.** Never commit API keys, `.env`, or personal data.

## Milestones worth picking up

| # | area | what's needed |
|---|---|---|
| M2 | extraction | rule capture (`session/event`) + turn-end LLM pull (`agent/turn-stopping`, `ctx.llm.stream`) with dedup/throttle |
| M3 | injection | `systemPrompt.section/context` preamble + reminders (`agent.inject` + `session-start` replay) |
| M4 | UI | `conversation.view` YOLO tab + conversation node + header button + settings card (client bundle) |
| M5 | hardening | scheduler persistence, snapshot scheduling, ≥80% test coverage |

## Development setup

See the **Quick Start** in the [README](README.md#-quick-start) — you'll need a local
deepseek-harness checkout as the dev host (clone it into `host/`, which is gitignored).

## Questions?

Open an issue. Architecture/ADR-style discussions are welcome — this project is young
and decisions are still being made.
