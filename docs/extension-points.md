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

## M1 — storage Service + memory tools (verified 2026-08-20)

- **A plugin module must DEFAULT-export its plugin** (function, or object/class with an `apply` method). A bare named export (`export class Yolo`) makes the loader pass the whole module namespace to `ctx.plugin` → `invalid plugin, expect function or object with an "apply" method, received object`. Fix: `export default class Yolo extends Service`.
- **`@deepseek-ai/cordis` (vendor/cordis) + `@deepseek-ai/dsh-tools` (packages/core/tools) are linked into yolo as `link:` devDeps** so `tsc` sees real types; at runtime the host provides them. `dsh-tools` already augments `Context.tools` via `declare module '@deepseek-ai/cordis'`.
- **`defineTool` output.schema needs `additionalProperties: true` for object schemas** (`ObjectValueSchemaSpec` requires the field).
- **Vitest MUST exclude `host/**`** — default include sweeps the dev host's 200+ spec files and hangs (killed task, empty output). `vitest.config.ts` sets `include: ['tests/**/*.test.ts']`, `exclude: ['host/**', ...]`, `pool: 'forks'`.
- **FTS5 trigram verified** in better-sqlite3 11.10.0 (Win/x64 + Node 22): good CJK recall for queries ≥ 3 chars; 2-char queries fall back to substring scan (may miss). Schema uses `tokenize='trigram'`.
- **better-sqlite3 native binding**: pnpm ignores build scripts by default → `pnpm install` alone leaves no `build/Release/better_sqlite3.node`. Fix: `pnpm-workspace.yaml` `onlyBuiltDependencies: [better-sqlite3, esbuild]` + run `prebuild-install` manually once (or rebuild). 
- **`ctx.logger.info` does NOT print to the host terminal** — dsh logger routes elsewhere. M0's visible `[yolo] plugin loaded` came from the `console.log` fallback. For terminal-visible markers use `console.log`.
- **EADDRINUSE 3080**: a killed-but-leftover dsh web process holds the port; clear with PowerShell `Get-NetTCPConnection -LocalPort 3080 ... | Stop-Process`.
- M1 host boot result: `dsh web: http://127.0.0.1:3080` (HTTP 200), no loader errors → `ctx.yolo` Service + 4 memory tools registered without failure. `pnpm test`: 14/14.

## Open questions to resolve at the right milestone

| # | question | milestone |
|---|---|---|
| 1 | `cordis.dev.yml` row: does loader read inline `inject`/`client` fields, or only `id`+`name`? | M0 |
| 2 | `ctx.slots.inject(slotName, ...)` exact signature | M4 |
| 3 | `ConversationNodeDefinition` registered via `registerConversationNodes` or `slots.inject`? | M4 |
| 4 | custom durable event `yolo/snapshot` emit API (`session.append`? `agent.emit`?) | M4 |
| 5 | is `dsh-client-ui-input-trigger` loaded by default (can we inject composer button)? | M4 |
| ~~6~~ | ~~ctx.llm purpose~~ → **answered M2**: host only accepts `'compaction' | 'session-title'`; no custom tag | M2 |
| 7 | does better-sqlite3 ship with trigram FTS5 tokenizer on Windows x64 + Node 22? | M1 |

## M2 — hybrid extraction (verified 2026-08-20)

- **`GenerateOptions.purpose` is a closed union** `'compaction' | 'session-title'` — the planned custom `'yolo-extract'` tag does NOT exist in host v0.1.0-rc.8. **Decision: use `'session-title'`** to segregate auxiliary traffic; revisit if the host adds an open purpose.
- **`agent/turn-stopping` payload**: `{ agent, turn, signal }` (serial). `agent.session` is the live `Session`; `session.deriveMessages(): Message[]` gives model-visible history. Scope cwd: prefer `session.meta?.cwd`, fall back to `process.cwd()`.
- **`session/event`** (emit): `(session, event)` — `event.type: 'user/message' | 'assistant/message'` carry `event.data.content: ContentBlock[]`; text via text-block extraction.
- **`ctx.llm.stream(GenerateOptions)`**: `AsyncIterable<StreamChunk>` → fold with `BlockAssembler` (`push(chunk)` then `blocks()`). `StreamChunk` variants: `block-start/text-delta/block-end/usage/finish` (verified shape).
- **pnpm `link:` to dsh-llm / dsh-session created EMPTY DIRECTORIES** (not symlinks) in `node_modules/@deepseek-ai/` — tsc then can't resolve them. Fix: delete the empty dirs, `New-Item -ItemType Junction` to the host package. (cordis & dsh-tools link fine — likely they were installed in an earlier pass.) Watch for this after every `pnpm install`.
- Rule regexes must allow **zero-space Chinese phrases** (`我决定采用SQLite`, `我喜欢用中文回复`) — use `\s*` not `\s+` after trigger words; dates like `8/20 前` need `\s*` around the separator.
- M2 host boot result: 3 plugins (storage + memory + extract) load cleanly, `dsh web` 200 OK. End-to-end rule→DB and LLM pull need a configured model key (user-side, M2 host run).

## M3 — injection & reminders (verified 2026-08-20)

- **`AssembleContext` is only `{ scope?, signal? }`** — NO `userMessage` (plan assumed one). **Decision: memory plugin caches the latest `user/message` text via `session/event`; the recall context reads that cache.** Same caveat as M2's `purpose` — plan deviation due to rc.8 API surface.
- **`ctx.systemPrompt.section({name, order, text: string | ((ctx: AssembleContext) => string), complete?})`** and **`ctx.systemPrompt.context({name, order, text})`** confirmed (duplicate name throws). Orders: 120 prefs / 220 recall.
- **`agent/session-start`** payload `{ agent, source }` — used to (a) track the latest active agent for reminder injection, (b) replay queued `pending_reminders`.
- **`Agent.inject(message)` / `Agent.followup(message)` / `Agent.steer(message)`** take a `UserMessage`. **`createUserMessage` REQUIRES `source`** (`{ kind: 'user' }`) — missing it fails typecheck.
- **`AgentRegistry`** (`ctx.agents`): `get(id)` + `currentInitiator()` — no "list active agents" API. Reminder keeps its own `latestAgent` from `agent/session-start`.
- **Schema migration pattern**: SQLite has no `ADD COLUMN IF NOT EXISTS` — `openDb()` checks `PRAGMA table_info(todos)` and `ALTER TABLE ... ADD COLUMN last_reminded_at` for pre-M3 DBs.
- **`ctx.effect(() => start())`** returns cleanup (`clearInterval`) — cordis effect cleanup contract confirmed.
- **pnpm `link:` again produced empty dirs for dsh-system-prompt** (only when declared via package.json) — manual junction instead; keep this pattern for any further host type packages.
- M3 host boot result: **4 plugins** (storage/memory/extract/reminder) load cleanly, `dsh web` 200 OK. `pnpm test`: 38/38.

