# YOLO dsh Extension Points — Verification Log

This file records the **verified** behavior of deepseek-harness extension points
as YOLO encounters them at runtime. Entries are added in the milestone where
they are first exercised (M0 loader behavior, M1 storage/service, M4 UI slots,
etc.). Where the docs were silent, the fallback actually used is recorded.

Findings here override assumptions in the plan when they conflict.

---

## M0 — Plugin loading via `--patch` overlay

### Host facts confirmed (clone + package.json inspection)

- **Host identity**: `@deepseek-ai/dsh-root` v0.1.0-rc.8 (shallow clone, 2026-08-19).
- **`packageManager`**: `pnpm@11.7.0`. We run `pnpm@11.22.0` (same major, accepted).
- **`engines.node`**: `^22.19.0 || >=24.0.0` — our Node 22.22.2 satisfies it.
- **`dsh` script** = `node --import tsx/esm apps/cli/src/bin.ts` — the CLI runs from source via tsx, BUT `pnpm dsh web` still needs `pnpm run build` first: the `dsh-web-app` bundle resolves a prebuilt frontend `dist` (`resolveDistIndex`) and throws `frontend dist not built; run pnpm run build from the repository root first` if missing. So: **build is mandatory for `web`, tsx only saves you for non-web commands.** (Build script = `tsx scripts/build.ts`.)
- **`dev:web`** = `tsx scripts/dev-web.ts --poll` (watch mode alternative).
- Workspace: `vendor/*`, `packages/*/*`, plus `native/landlock-run` (Linux sandbox — irrelevant on Windows).

### Verified at runtime (first `pnpm dsh web --patch ...` attempt — failed, root-caused)

The host failed to load the plugin tree with three independent loader-entry errors.
All three must be resolved for `dsh web` to start.

1. **YOLO entry — Windows path must be a `file://` URL.** `cordis.dev.yml`'s `name: 'D:/Code/.../src/index.ts'` threw `ERR_UNSUPPORTED_ESM_URL_SCHEME: ... Received protocol 'd:'`. Node's ESM loader treats a bare `D:/...` as scheme `d:`. **Fix**: use `file:///D:/Code/.../src/index.ts` (three slashes after `file:`). Applied to `cordis.dev.yml`.
2. **`dsh-web-app` needs a built frontend dist.** `resolveDistIndex` threw `frontend dist not built; run pnpm run build from the repository root first`. Fix: `pnpm run build` (running).
3. **profile `web` missing `dsh-client-ui-directory-picker-native`.** `Cannot find module 'C:\Users\91813\.dsh\profiles\web\node_modules\@deepseek-ai\dsh-client-ui-directory-picker-native\lib\index.js'`. dsh keeps profiles in `~/.dsh/profiles/<name>/` with their own `cordis.patch.yml` + `node_modules`. The `web` profile is missing workspace deps — to be resolved after build (likely needs a profile setup/install step).

### Environment gotcha — pnpm `safe-delete` trash fails in Git Bash

`pnpm install` and `pnpm dsh web` both throw `[ERROR] [safe-delete] ... trash operation ... Some operations were aborted` in **Git Bash** and abort immediately (the real error is masked; full output is only ~2 lines). Root cause: `@pnpm/safe-delete` uses the OS trash/recycle API, which fails under Git Bash on this machine. **Workaround: run pnpm via PowerShell** (`PowerShell` tool) — trash works there and install/boot proceed normally. This applies to `pnpm install` AND any dsh boot that touches temp dirs.

### ✅ M0 VERIFIED (2026-08-20) — plugin loads

After `pnpm run build` + the `file://` URL fix, `dsh web` boots cleanly via **`node --import tsx/esm apps/cli/src/bin.ts web --patch <dev.yml> --no-open`** (run directly with `node`, NOT `pnpm dsh`, to bypass the Git Bash safe-delete failure):

```
[yolo] plugin loaded
dsh web: http://127.0.0.1:3080
```

- ✅ `cordis.dev.yml` `name: 'file:///D:/.../src/index.ts'` loads the TS source directly (no yolo build needed). **Bare `D:/...` fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME` on Windows — must be `file:///`.**
- ✅ `pnpm run build` is mandatory for `web` (builds `apps/web/dist` = the `@deepseek-ai/dsh-web-frontend` package, consumed by `dsh-web-app`'s `resolveDistIndex` via `require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')`). `build.ts` calls `runScript('build:web')` internally; the earlier "dist not built" was because build hadn't run yet.
- ✅ profile `web` deps self-resolve after build — no manual `dsh plugin add` was needed. The earlier missing `dsh-client-ui-directory-picker-native` was a downstream symptom of the failed boot, not a separate setup step.
- ✅ `ctx.logger.info('[yolo] plugin loaded')` works (visible in host stdout). `console.log` fallback also present.
- `inject` declared via `export const inject: string[] = []` in `src/index.ts`; the patch row only carries `id`+`name` (confirmed sufficient).

**Reliable M0 boot recipe (Windows):**
```bash
# 1. install host deps (PowerShell, not Git Bash — safe-delete trash fails in Git Bash)
cd host/deepseek-harness; pnpm install
# 2. build (PowerShell) — produces apps/web/dist
pnpm run build
# 3. boot with yolo patch (run dsh via node directly to bypass pnpm-script safe-delete)
node --import tsx/esm apps/cli/src/bin.ts web --patch D:/Code/WorkBuddy/dsh-yolo/cordis.dev.yml --no-open
# → [yolo] plugin loaded  ;  http://127.0.0.1:3080
```

## Open questions to resolve at the right milestone

| # | question | milestone |
|---|---|---|
| 1 | `cordis.dev.yml` row: does loader read inline `inject`/`client` fields, or only `id`+`name`? | M0 |
| 2 | `ctx.slots.inject(slotName, ...)` exact signature | M4 |
| 3 | `ConversationNodeDefinition` registered via `registerConversationNodes` or `slots.inject`? | M4 |
| 4 | custom durable event `yolo/snapshot` emit API (`session.append`? `agent.emit`?) | M4 |
| 5 | is `dsh-client-ui-input-trigger` loaded by default (can we inject composer button)? | M4 |
| 6 | does `ctx.llm` accept `purpose` for traffic segregation? | M2 |
| 7 | does better-sqlite3 ship with trigram FTS5 tokenizer on Windows x64 + Node 22? | M1 |
