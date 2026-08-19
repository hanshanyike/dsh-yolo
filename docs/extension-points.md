# YOLO dsh Extension Points — Verification Log

This file records the **verified** behavior of deepseek-harness extension points
as YOLO encounters them at runtime. Entries are added in the milestone where
they are first exercised (M0 loader behavior, M1 storage/service, M4 UI slots,
etc.). Where the docs were silent, the fallback actually used is recorded.

Findings here override assumptions in the plan when they conflict.

---

## M0 — Plugin loading via `--patch` overlay

**Verified:** _(to be filled after M0-5 runs `pnpm dsh web --patch ...`)_

- Did `cordis.dev.yml` with `name: <absolute path to src/index.ts>` load the TS source directly (no build)?
- Is `inject` read from the module's `export const inject` (not from the patch row)?
- Does `ctx.logger.info` work, or did we rely on `console.log`?
- Exact host commit / version pinned:

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
