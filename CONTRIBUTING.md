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
  and build-contract/troubleshooting notes in [`docs/dev-notes.md`](docs/dev-notes.md)
  (dsh is v0.1.0-rc — anything you verify at runtime belongs there).
- **No secrets.** Never commit API keys, `.env`, or personal data.

## Milestones worth picking up

M0–M5 and M7 are done (see the [roadmap](README.md#-roadmap) and
[CHANGELOG](CHANGELOG.md)). The next self-contained deliverables:

| # | area | what's needed |
|---|---|---|
| M6 | release engineering | npm-publishable plugin (install without a host checkout), GitHub Actions CI, coverage badge, `v0.2.0` |
| M8 | memory portability | snapshot import/export CLI, DB rebuild-from-snapshot, workspace merge |
| M9 | recall quality | hybrid ranking (FTS + embeddings), recall feedback loop |
| M10 | aggregation | cross-workspace timeline, weekly review digest |

## Development setup

See the **Quick Start** in the [README](README.md#-quick-start) —
`pnpm dev:web:setup` clones the host checkout into `host/` (gitignored) and
builds everything; `pnpm dev:web` boots it with the YOLO patch applied.

Architecture context: [`docs/architecture.md`](docs/architecture.md).
Releasing: [`docs/release.md`](docs/release.md).

## Questions?

Open an issue. Architecture/ADR-style discussions are welcome — this project is young
and decisions are still being made.
