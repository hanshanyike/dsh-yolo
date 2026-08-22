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
- **Document platform gotchas** in [`docs/architecture.md`](docs/architecture.md)
  (the "Verified platform behavior" section) and build/troubleshooting notes in
  [`docs/modules.md`](docs/modules.md) (the "故障排查" section)
  (dsh is v0.1.0-rc — anything you verify at runtime belongs there).
- **Keep the docs in sync with code.** If you change a module's structure, public API,
  config option, or test layout, update the matching section in
  [`docs/modules.md`](docs/modules.md), [`docs/usage.md`](docs/usage.md) or
  [`docs/testing.md`](docs/testing.md) — the docs index is [`docs/README.md`](docs/README.md).
- **No secrets.** Never commit API keys, `.env`, or personal data.

## Work worth picking up

See the [roadmap](README.md#-roadmap) for what's shipped and what's next — each "Next"
item is a self-contained deliverable. Semantic recall is the current front;
[CHANGELOG](CHANGELOG.md) has the delivery history.

## Development setup

See the **Quick Start** in the [README](README.md#-quick-start) —
`pnpm dev:web:setup` clones the host checkout into `host/` (gitignored) and
builds everything; `pnpm dev:web` boots it with the YOLO patch applied.

Architecture context: [`docs/architecture.md`](docs/architecture.md).
Module reference: [`docs/modules.md`](docs/modules.md).
Testing: [`docs/testing.md`](docs/testing.md).
Releasing: [`docs/release.md`](docs/release.md).

## Questions?

Open an issue. Architecture/ADR-style discussions are welcome — this project is young
and decisions are still being made.
