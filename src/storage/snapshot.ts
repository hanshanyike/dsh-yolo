// YOLO Markdown snapshot — human-readable, versionable projection of the DB.
// Written to data/snapshots/YYYY-MM-DD.md and committed to git (per user decision).
// The DB is a performance cache; snapshots are the durable, reviewable memory.

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { localDateStr } from '../shared/text.ts'
import type { DB } from './db.ts'
import { listEvents, listGoals, listMilestones, listPreferences, listTodos } from './repository.ts'
import type { Goal } from './types.ts'

const iso = (ms: number | null | undefined): string =>
  ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '—'

/** Render the current scope's memory as a Markdown string. */
export function renderSnapshot(db: DB, scopeKey: string, cwdHint?: string): string {
  const now = new Date()
  const date = localDateStr(now)
  const goals = listGoals(db, scopeKey)
  const milestones = listMilestones(db, scopeKey)
  const todos = listTodos(db, scopeKey)
  const prefs = listPreferences(db, scopeKey)
  const events = listEvents(db, scopeKey, 50)

  const lines: string[] = []
  lines.push(`# YOLO Snapshot — ${date}`)
  lines.push('')
  lines.push(`> scope: ${scopeKey}${cwdHint ? ` (${cwdHint})` : ''}`)
  lines.push(`> generated: ${now.toISOString()}`)
  lines.push(`> schema_version: 1`)
  lines.push('')

  lines.push('## Active Goals')
  for (const g of goals.filter(activeGoal)) lines.push(`- [${g.id.slice(0, 6)}] ${g.title} — ${g.progress}%`)
  if (!goals.some(activeGoal)) lines.push('- _(none)_')
  lines.push('')

  lines.push('## Milestones')
  for (const m of milestones) lines.push(`- [${m.id.slice(0, 6)}] ${m.title} — target ${m.target_date ?? '—'} — ${m.status}`)
  if (milestones.length === 0) lines.push('- _(none)_')
  lines.push('')

  lines.push('## Todos')
  const pending = todos.filter((t) => t.status === 'pending' || t.status === 'in_progress')
  const done = todos.filter((t) => t.status === 'done')
  lines.push('### pending')
  for (const t of pending) lines.push(`- [ ] ${t.title}${t.due_at ? ` (due ${t.due_at}${t.priority ? `, ${t.priority}` : ''})` : ''}`)
  if (pending.length === 0) lines.push('- _(none)_')
  lines.push('### done (recent)')
  for (const t of done.slice(0, 10)) lines.push(`- [x] ${t.title}`)
  if (done.length === 0) lines.push('- _(none)_')
  lines.push('')

  lines.push('## Preferences')
  for (const p of prefs) lines.push(`- ${p.key}: ${p.value}`)
  if (prefs.length === 0) lines.push('- _(none)_')
  lines.push('')

  lines.push('## Timeline (last 50)')
  for (const e of events) lines.push(`- ${iso(e.occurred_at)} [${e.kind}] ${e.summary}`)
  if (events.length === 0) lines.push('- _(none)_')
  lines.push('')

  return lines.join('\n')
}

/** Write a snapshot file for today under <dataDir>/snapshots/<date>.md. Returns the path. */
export function writeSnapshot(db: DB, scopeKey: string, dataDir: string, cwdHint?: string, dateStr?: string): string {
  const dir = join(dataDir, 'snapshots')
  mkdirSync(dir, { recursive: true })
  const date = dateStr ?? localDateStr()
  const path = join(dir, `${date}.md`)
  writeFileSync(path, renderSnapshot(db, scopeKey, cwdHint), 'utf8')
  return path
}

function activeGoal(g: Goal): boolean {
  return g.status === 'active'
}
