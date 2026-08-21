// YOLO repository — typed CRUD over the SQLite tables.
// All writes that touch searchable text also update yolo_fts (via triggers on INSERT;
// UPDATE/DELETE to FTS handled here explicitly so edits/deletes stay searchable).

import { randomUUID } from 'node:crypto'
import { normalizeTitle as normalize } from '../shared/text.ts'
import type { DB } from './db.ts'
import type {
  ExtractionLog,
  ExtractionStatus,
  ExtractionStrategy,
  Goal,
  GoalStatus,
  Milestone,
  MilestoneStatus,
  PendingReminder,
  Preference,
  Priority,
  Source,
  TimelineEvent,
  Todo,
  TodoStatus,
  EventKind,
} from './types.ts'

const now = () => Date.now()

function genId(): string {
  return randomUUID()
}

export { normalize }

// ---------- milestones ----------

export function upsertMilestone(
  db: DB,
  data: { title: string; target_date?: string | null; description?: string | null; scope_key: string; source?: Source },
): Milestone {
  const existing = db
    .prepare('SELECT * FROM milestones WHERE title = ? AND scope_key = ?')
    .get(data.title, data.scope_key) as Milestone | undefined
  const ts = now()
  if (existing) {
    if (data.target_date !== undefined && data.target_date !== null) {
      db.prepare('UPDATE milestones SET target_date = ?, updated_at = ? WHERE id = ?').run(
        data.target_date,
        ts,
        existing.id,
      )
    }
    return { ...existing, target_date: data.target_date ?? existing.target_date, updated_at: ts }
  }
  const row: Milestone = {
    id: genId(),
    title: data.title,
    description: data.description ?? null,
    target_date: data.target_date ?? null,
    status: 'planned',
    scope_key: data.scope_key,
    source: data.source ?? null,
    created_at: ts,
    updated_at: ts,
  }
  db.prepare(
    'INSERT INTO milestones(id, title, description, target_date, status, scope_key, source, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
  ).run(row.id, row.title, row.description, row.target_date, row.status, row.scope_key, row.source, row.created_at, row.updated_at)
  return row
}

export function setMilestoneStatus(db: DB, id: string, status: MilestoneStatus): void {
  db.prepare('UPDATE milestones SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id)
  if (status === 'done' || status === 'abandoned') {
    // soft-delete from FTS so it stops matching searches
    db.prepare("DELETE FROM yolo_fts WHERE row_type = 'milestone' AND row_id = ?").run(id)
  }
}

export function listMilestones(db: DB, scopeKey: string, status?: MilestoneStatus): Milestone[] {
  const where = status ? 'WHERE scope_key = ? AND status = ?' : 'WHERE scope_key = ?'
  const params = status ? [scopeKey, status] : [scopeKey]
  return db.prepare(`SELECT * FROM milestones ${where} ORDER BY created_at DESC`).all(...params) as Milestone[]
}

// ---------- todos ----------

export function upsertTodo(
  db: DB,
  data: {
    title: string
    detail?: string | null
    priority?: Priority | null
    due_at?: string | null
    milestone_id?: string | null
    scope_key: string
    source?: Source
  },
): Todo {
  const dedupKey = `todo:${normalize(data.title)}`
  const existing = db
    .prepare('SELECT * FROM todos WHERE dedup_key = ? AND scope_key = ?')
    .get(dedupKey, data.scope_key) as Todo | undefined
  const ts = now()
  if (existing && existing.status !== 'done' && existing.status !== 'cancelled') {
    // update mutable fields (take non-null incoming)
    const due = data.due_at ?? existing.due_at
    const pri = data.priority ?? existing.priority ?? null
    const detail = data.detail ?? existing.detail ?? null
    const ms = data.milestone_id ?? existing.milestone_id ?? null
    db.prepare(
      'UPDATE todos SET due_at = ?, priority = ?, detail = ?, milestone_id = ?, updated_at = ? WHERE id = ?',
    ).run(due, pri, detail, ms, ts, existing.id)
    syncTodoFts(db, existing.id, data.title, detail)
    return { ...existing, due_at: due, priority: pri, detail, milestone_id: ms, updated_at: ts }
  }
  const row: Todo = {
    id: genId(),
    title: data.title,
    detail: data.detail ?? null,
    status: 'pending',
    priority: data.priority ?? null,
    due_at: data.due_at ?? null,
    milestone_id: data.milestone_id ?? null,
    scope_key: data.scope_key,
    dedup_key: dedupKey,
    source: data.source ?? null,
    created_at: ts,
    updated_at: ts,
    completed_at: null,
  }
  db.prepare(
    `INSERT INTO todos(id, title, detail, status, priority, due_at, milestone_id, scope_key, dedup_key, source, created_at, updated_at, completed_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
  ).run(
    row.id,
    row.title,
    row.detail,
    row.status,
    row.priority,
    row.due_at,
    row.milestone_id,
    row.scope_key,
    row.dedup_key,
    row.source,
    row.created_at,
    row.updated_at,
  )
  return row
}

export function setTodoStatus(db: DB, id: string, status: TodoStatus): void {
  const ts = now()
  const completed = status === 'done' ? ts : null
  db.prepare('UPDATE todos SET status = ?, completed_at = COALESCE(?, completed_at), updated_at = ? WHERE id = ?').run(
    status,
    completed,
    ts,
    id,
  )
  if (status === 'cancelled' || status === 'done') {
    // soft-delete from FTS so it stops matching searches
    db.prepare("DELETE FROM yolo_fts WHERE row_type = 'todo' AND row_id = ?").run(id)
  }
}

export function listTodos(db: DB, scopeKey: string, status?: TodoStatus): Todo[] {
  const where = status ? 'WHERE scope_key = ? AND status = ?' : 'WHERE scope_key = ?'
  const params = status ? [scopeKey, status] : [scopeKey]
  return db.prepare(`SELECT * FROM todos ${where} ORDER BY due_at IS NULL, due_at ASC, created_at DESC`).all(...params) as Todo[]
}

export function listDueTodos(db: DB, scopeKey: string, beforeIso: string): Todo[] {
  return db
    .prepare(
      `SELECT * FROM todos WHERE scope_key = ? AND due_at IS NOT NULL AND due_at <= ? AND status IN ('pending','in_progress') AND last_reminded_at IS NULL ORDER BY due_at ASC`,
    )
    .all(scopeKey, beforeIso) as Todo[]
}

/** Stamp a todo as reminded so the scheduler does not re-fire it. */
export function setTodoReminded(db: DB, id: string, ts = now()): void {
  db.prepare('UPDATE todos SET last_reminded_at = ? WHERE id = ?').run(ts, id)
}

function syncTodoFts(db: DB, id: string, title: string, detail: string | null): void {
  db.prepare("DELETE FROM yolo_fts WHERE row_type = 'todo' AND row_id = ?").run(id)
  db.prepare('INSERT INTO yolo_fts(row_type, row_id, title, body) VALUES(?, ?, ?, ?)').run('todo', id, title, detail ?? '')
}

// ---------- goals ----------

export function upsertGoal(
  db: DB,
  data: { title: string; description?: string | null; scope_key: string; milestone_id?: string | null },
): Goal {
  const existing = db
    .prepare('SELECT * FROM goals WHERE title = ? AND scope_key = ?')
    .get(data.title, data.scope_key) as Goal | undefined
  if (existing) return existing // goals are not lightly changed
  const ts = now()
  const row: Goal = {
    id: genId(),
    title: data.title,
    description: data.description ?? null,
    progress: 0,
    status: 'active',
    milestone_id: data.milestone_id ?? null,
    scope_key: data.scope_key,
    created_at: ts,
    updated_at: ts,
  }
  db.prepare(
    `INSERT INTO goals(id, title, description, progress, status, milestone_id, scope_key, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run(row.id, row.title, row.description, row.progress, row.status, row.milestone_id, row.scope_key, row.created_at, row.updated_at)
  return row
}

export function setGoalProgress(db: DB, id: string, progress: number): void {
  const clamped = Math.max(0, Math.min(100, progress))
  const status: GoalStatus = clamped >= 100 ? 'achieved' : 'active'
  db.prepare('UPDATE goals SET progress = ?, status = ?, updated_at = ? WHERE id = ?').run(
    clamped,
    status,
    now(),
    id,
  )
}

export function listGoals(db: DB, scopeKey: string, status?: GoalStatus): Goal[] {
  const where = status ? 'WHERE scope_key = ? AND status = ?' : 'WHERE scope_key = ?'
  const params = status ? [scopeKey, status] : [scopeKey]
  return db.prepare(`SELECT * FROM goals ${where} ORDER BY created_at DESC`).all(...params) as Goal[]
}

// ---------- preferences ----------

export function upsertPreference(
  db: DB,
  data: { key: string; value: string; scope_key: string },
): Preference {
  const ts = now()
  const existing = db
    .prepare('SELECT * FROM preferences WHERE key = ? AND scope_key = ?')
    .get(data.key, data.scope_key) as Preference | undefined
  if (existing) {
    const confidence = Math.min(0.9, (existing.confidence ?? 0.5) + 0.1)
    db.prepare('UPDATE preferences SET value = ?, confidence = ?, updated_at = ? WHERE id = ?').run(
      data.value,
      confidence,
      ts,
      existing.id,
    )
    // FTS update
    db.prepare("DELETE FROM yolo_fts WHERE row_type = 'preference' AND row_id = ?").run(existing.id)
    db.prepare('INSERT INTO yolo_fts(row_type, row_id, title, body) VALUES(?, ?, ?, ?)').run(
      'preference',
      existing.id,
      data.key,
      data.value,
    )
    return { ...existing, value: data.value, confidence, updated_at: ts }
  }
  const id = genId()
  db.prepare(
    'INSERT INTO preferences(id, key, value, confidence, scope_key, updated_at) VALUES(?,?,?,?,?,?)',
  ).run(id, data.key, data.value, 0.5, data.scope_key, ts)
  return { id, key: data.key, value: data.value, confidence: 0.5, scope_key: data.scope_key, updated_at: ts }
}

export function listPreferences(db: DB, scopeKey: string): Preference[] {
  return db
    .prepare('SELECT * FROM preferences WHERE scope_key = ? ORDER BY updated_at DESC')
    .all(scopeKey) as Preference[]
}

// ---------- timeline events ----------

export function addEvent(
  db: DB,
  data: { kind: EventKind; summary: string; detail?: string | null; session_id?: string | null; occurred_at?: number; scope_key: string },
): TimelineEvent | null {
  const ts = data.occurred_at ?? now()
  const row: TimelineEvent = {
    id: genId(),
    kind: data.kind,
    summary: data.summary,
    detail: data.detail ?? null,
    session_id: data.session_id ?? null,
    occurred_at: ts,
    scope_key: data.scope_key,
  }
  db.prepare(
    `INSERT INTO events(id, kind, summary, detail, session_id, occurred_at, scope_key)
     VALUES(?,?,?,?,?,?,?)`,
  ).run(row.id, row.kind, row.summary, row.detail, row.session_id, row.occurred_at, row.scope_key)
  return row
}

export function listEvents(db: DB, scopeKey: string, limit = 50): TimelineEvent[] {
  return db
    .prepare('SELECT * FROM events WHERE scope_key = ? ORDER BY occurred_at DESC LIMIT ?')
    .all(scopeKey, limit) as TimelineEvent[]
}

// ---------- extraction log ----------

export function logExtraction(
  db: DB,
  data: { session_id: string; turn_seq: number; strategy: ExtractionStrategy; status: ExtractionStatus; error?: string | null; extracted_json?: string | null; token_in?: number | null; token_out?: number | null; duration_ms?: number | null },
): void {
  db.prepare(
    `INSERT OR REPLACE INTO extraction_log(session_id, turn_seq, strategy, status, error, extracted_json, token_in, token_out, duration_ms, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    data.session_id,
    data.turn_seq,
    data.strategy,
    data.status,
    data.error ?? null,
    data.extracted_json ?? null,
    data.token_in ?? null,
    data.token_out ?? null,
    data.duration_ms ?? null,
    now(),
  )
}

export function lastExtractionAt(db: DB, sessionId: string, strategy: ExtractionStrategy): number | undefined {
  const row = db
    .prepare('SELECT created_at FROM extraction_log WHERE session_id = ? AND strategy = ? ORDER BY created_at DESC LIMIT 1')
    .get(sessionId, strategy) as { created_at: number } | undefined
  return row?.created_at
}

// ---------- pending reminders ----------

export function queuePendingReminder(
  db: DB,
  data: { todo_id?: string | null; milestone_id?: string | null; fire_at: number; payload: string; scope_key: string; session_hint?: string | null },
): void {
  db.prepare(
    `INSERT INTO pending_reminders(id, todo_id, milestone_id, fire_at, payload, scope_key, session_hint)
     VALUES(?,?,?,?,?,?,?)`,
  ).run(genId(), data.todo_id ?? null, data.milestone_id ?? null, data.fire_at, data.payload, data.scope_key, data.session_hint ?? null)
}

export function listPendingReminders(db: DB, scopeKey: string, beforeMs: number): PendingReminder[] {
  return db
    .prepare('SELECT * FROM pending_reminders WHERE scope_key = ? AND fire_at <= ? ORDER BY fire_at ASC')
    .all(scopeKey, beforeMs) as PendingReminder[]
}

export function deletePendingReminder(db: DB, id: string): void {
  db.prepare('DELETE FROM pending_reminders WHERE id = ?').run(id)
}

export type { ExtractionLog }
