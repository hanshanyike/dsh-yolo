#!/usr/bin/env node
// Clean accumulated [E2E] test fixtures before a dev session — E2E runs leave
// `[E2E]-prefixed todos/events in the store, which bloat the dashboard payload
// and slow the suite. Run this before developing (the AGENTS.md habit).
//
//   node scripts/clean-test-data.mjs
//
// It deletes [E2E]-prefixed rows from every `yolo-*.db` under the repo's
// `.dsh/yolo/` and `~/.dsh/yolo/`. Only test fixtures are touched; real rows
// with other titles are left alone. Run the host first so its DB handle is not
// open; close the host (or run with it stopped) to avoid a locked DB.

import Database from 'better-sqlite3'
import { readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DIRS = [
  join(ROOT, '.dsh', 'yolo'),
  join(homedir(), '.dsh', 'yolo'),
]

let total = { todos: 0, notifications: 0, events: 0, summaries: 0 }
for (const dir of DIRS) {
  if (!existsSync(dir)) continue
  for (const file of readdirSync(dir).filter((f) => f.startsWith('yolo-') && f.endsWith('.db'))) {
    const path = join(dir, file)
    let db
    try {
      db = new Database(path, { readonly: false })
    } catch {
      console.log(`[clean-test-data] skip (locked) ${path}`)
      continue
    }
    const c = (sql) => { try { return db.prepare(sql).run().changes } catch { return 0 } }
    const t = c("DELETE FROM todos WHERE title LIKE '[E2E]%'")
    const n = c("DELETE FROM notifications WHERE title LIKE '[E2E]%'")
    const e = c("DELETE FROM events WHERE summary LIKE '%[E2E]%' OR detail LIKE '%[E2E]%'")
    const s = c("DELETE FROM session_summaries WHERE summary LIKE '%[E2E]%'")
    total.todos += t; total.notifications += n; total.events += e; total.summaries += s
    if (t + n + e + s > 0) console.log(`[clean-test-data] ${file}: todos=${t} notif=${n} events=${e} summaries=${s}`)
    db.close()
  }
}
console.log(`[clean-test-data] done. removed todos=${total.todos} notifications=${total.notifications} events=${total.events} summaries=${total.summaries}`)
