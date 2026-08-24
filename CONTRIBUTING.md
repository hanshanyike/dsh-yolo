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
- **UI changes additionally need a live walkthrough**: `pnpm build && pnpm dsh web --no-open --port 4080`,
  then work through the W1–W10 checklist in
  [`docs/testing.md §八`](docs/testing.md#八真机端到端验证) — unit tests can't
  catch layout, theme or host-integration regressions.
- **Commit at logical checkpoints — never batch everything into one commit.** A
  finished fix/feature with its tests and docs is a commit; unrelated changes
  do not ride along. Batched mega-commits hide history, break `git bisect` and
  make reverts painful. If two streams genuinely interleave at the file level,
  land one first, rebase the other on top — the exception (v0.3.1+v0.3.2) is
  documented in the CHANGELOG, not a pattern to repeat.
- **Document platform gotchas** in [`docs/architecture/overview.md`](docs/architecture/overview.md)
  (the "Verified platform behavior" section) and build/troubleshooting notes in
  [`docs/architecture/modules.md`](docs/architecture/modules.md) (the "故障排查" section)
  (dsh is v0.1.0-rc — anything you verify at runtime belongs there).
- **Keep the docs in sync with code.** If you change a module's structure, public API,
  config option, or test layout, update the matching section in
  [`docs/architecture/modules.md`](docs/architecture/modules.md), [`docs/usage.md`](docs/usage.md) or
  [`docs/testing.md`](docs/testing.md) — the docs index is [`docs/README.md`](docs/README.md).
- **No secrets.** Never commit API keys, `.env`, or personal data.

## Work worth picking up

See the [roadmap](README.md#路线图) for the product direction — each step
item is a self-contained deliverable. Semantic recall is the current front;
[CHANGELOG](CHANGELOG.md) has the delivery history.

## Development setup

See the **Quick Start** in the [README](README.md#快速开始) —
`npx @deepseek-ai/dsh plugin --profile web add .` registers this plugin as a bundle in the
dsh web profile (one-time), and `pnpm dsh web` boots it with the **installed**
dsh CLI.

Architecture context: [`docs/architecture/overview.md`](docs/architecture/overview.md).
Module reference: [`docs/architecture/modules.md`](docs/architecture/modules.md).
Testing: [`docs/testing.md`](docs/testing.md).
Releasing: [`docs/release.md`](docs/release.md).

## Questions?

Open an issue. Architecture/ADR-style discussions are welcome — this project is young
and decisions are still being made.
