# Contributing to YOLO

Thanks for considering contributing! YOLO is a small, opinionated plugin bundle for
[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). We keep it simple:

## Ground rules

- **Small, self-contained PRs.** Each YOLO plugin (storage / extract / memory / reminder / ui)
  is an independent Cordis plugin — touch one at a time unless the change genuinely spans seams.
- **Keep the checks green** before opening a PR:
  ```bash
  pnpm check    # tsc --noEmit
  pnpm test:run # vitest — only tests/ runs; the config excludes the host
  ```
- **UI changes additionally need a live walkthrough**: `pnpm build && npx @deepseek-ai/dsh web --no-open --port 4080`,
  then work through the affected W1–W16 scenarios in
  [`docs/testing.md §八`](docs/testing.md#八真机端到端验证) — unit tests can't
  catch layout, theme or host-integration regressions.
- **Commit at logical checkpoints — never batch everything into one commit.** A
  finished fix/feature with its tests and docs is a commit; unrelated changes
  do not ride along. Batched mega-commits hide history, break `git bisect` and
  make reverts painful. If two streams genuinely interleave at the file level,
  land one first and rebase the other on top.
- **Document platform gotchas** in [`docs/architecture/overview.md`](docs/architecture/overview.md)
  (the "Verified platform behavior" section) and build/troubleshooting notes in
  [`docs/architecture/modules.md`](docs/architecture/modules.md) (the "故障排查" section).
- **Keep the docs in sync with code.** If you change a module's structure, public API,
  config option, or test layout, update the matching section in
  [`docs/architecture/modules.md`](docs/architecture/modules.md), [`docs/usage.md`](docs/usage.md) or
  [`docs/testing.md`](docs/testing.md) — the docs index is [`docs/README.md`](docs/README.md).
- **No secrets.** Never commit API keys, `.env`, or personal data.

## Work worth picking up

See the [product roadmap](docs/roadmap-ux-priorities.md) for current direction and
[CHANGELOG](CHANGELOG.md) for delivery history.

## Development setup

Use Node.js `^22.19.0 || >=24.0.0` with pnpm, then link a repository checkout into
the official dsh web profile:

```bash
git clone https://github.com/hanshanyike/dsh-yolo.git
cd dsh-yolo
pnpm install
pnpm build
npx @deepseek-ai/dsh plugin --profile web add .
npx @deepseek-ai/dsh web
```

After code changes, rebuild before refreshing the browser. Re-run `plugin add`
only when the bundle manifest changes.

Architecture context: [`docs/architecture/overview.md`](docs/architecture/overview.md).
Module reference: [`docs/architecture/modules.md`](docs/architecture/modules.md).
Testing: [`docs/testing.md`](docs/testing.md).
Releasing: [`docs/release.md`](docs/release.md).

## Questions?

Open an issue. Architecture/ADR-style discussions are welcome — this project is young
and decisions are still being made.
