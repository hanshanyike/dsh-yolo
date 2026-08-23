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
  Notification,
  NotificationKind,
  PendingReminder,
  Preference,
  PreferenceHistory,
  Priority,
  RecallLog,
  SessionSummary,
  Source,
  TimelineEvent,
  Todo,
  TodoAction,
  TodoStatus,
  EventKind,
  DuplicateTodoPair,
  AttentionFeedback,
  ClientActionRecord,
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
  } else {
    const milestone = db.prepare('SELECT title, description FROM milestones WHERE id = ?').get(id) as
      | Pick<Milestone, 'title' | 'description'>
      | undefined
    if (milestone) syncMilestoneFts(db, id, milestone.title, milestone.description)
  }
}

function syncMilestoneFts(db: DB, id: string, title: string, description: string | null | undefined): void {
  db.prepare("DELETE FROM yolo_fts WHERE row_type = 'milestone' AND row_id = ?").run(id)
  db.prepare('INSERT INTO yolo_fts(row_type, row_id, title, body) VALUES(?, ?, ?, ?)').run(
    'milestone',
    id,
    title,
    description ?? '',
  )
}

export function listMilestones(db: DB, scopeKey: string, status?: MilestoneStatus): Milestone[] {
  const where = status ? 'WHERE scope_key = ? AND status = ?' : 'WHERE scope_key = ?'
  const params = status ? [scopeKey, status] : [scopeKey]
  return db.prepare(`SELECT * FROM milestones ${where} ORDER BY created_at DESC`).all(...params) as Milestone[]
}

/** Fuzzy-locate a non-terminal milestone by title (M8 + v0.3.2): prefers an
 * exact match, then active over planned, then most recently updated. */
export function findMilestoneByTitle(db: DB, scopeKey: string, title: string): Milestone | undefined {
  if (!normalize(title)) return undefined
  const rows = db
    .prepare("SELECT * FROM milestones WHERE scope_key = ? AND status IN ('planned','active')")
    .all(scopeKey) as Milestone[]
  return bestByTitle(rows, title, (s) => (s === 'active' ? 2 : s === 'planned' ? 1 : 0))
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
    session_id?: string | null
  },
): { row: Todo; created: boolean } {
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
    syncTodoFts(db, existing.id, existing.title, detail)
    return { row: { ...existing, due_at: due, priority: pri, detail, milestone_id: ms, updated_at: ts }, created: false }
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
    session_id: data.session_id ?? null,
    created_at: ts,
    updated_at: ts,
    completed_at: null,
  }
  db.prepare(
    `INSERT INTO todos(id, title, detail, status, priority, due_at, milestone_id, scope_key, dedup_key, source, session_id, created_at, updated_at, completed_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
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
    row.session_id,
    row.created_at,
    row.updated_at,
  )
  return { row, created: true }
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

/** Fuzzy-locate a non-terminal todo by title (M8 + v0.3.2): an exact normalized
 *  match wins; otherwise bestByTitle ranks loose matches by status/recency. */
export function findTodoByTitle(db: DB, scopeKey: string, title: string): Todo | undefined {
  if (!normalize(title)) return undefined
  const rows = db
    .prepare("SELECT * FROM todos WHERE scope_key = ? AND status IN ('pending','in_progress')")
    .all(scopeKey) as Todo[]
  return bestByTitle(rows, title, RANK_TODO)
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

/** Fuzzy-locate an active goal by title (M8 + v0.3.2): prefers an exact match. */
export function findGoalByTitle(db: DB, scopeKey: string, title: string): Goal | undefined {
  if (!normalize(title)) return undefined
  const rows = db.prepare("SELECT * FROM goals WHERE scope_key = ? AND status = 'active'").all(scopeKey) as Goal[]
  return bestByTitle(rows, title, (s) => (s === 'active' ? 1 : 0))
}

// ---------- preferences ----------

export function upsertPreference(
  db: DB,
  data: { key: string; value: string; scope_key: string; session_id?: string | null },
): Preference {
  const ts = now()
  const existing = db
    .prepare('SELECT * FROM preferences WHERE key = ? AND scope_key = ? AND invalid_at IS NULL')
    .get(data.key, data.scope_key) as Preference | undefined
  if (existing) {
    if (existing.value === data.value) {
      // idempotent repeat — only bump confidence; keep valid_at for stability
      const confidence = Math.min(0.9, (existing.confidence ?? 0.5) + 0.1)
      db.prepare('UPDATE preferences SET confidence = ?, updated_at = ? WHERE id = ?').run(confidence, ts, existing.id)
      return { ...existing, confidence, updated_at: ts }
    }
    // Supersede (R14): a new value for the same key invalidates the old one.
    // Keep single current row (UNIQUE(key, scope_key)); record the superseded
    // value in the append-only history as the traceable evidence trail.
    db.prepare(
      'INSERT INTO preference_history(id, key, value, scope_key, session_id, valid_at, invalid_at) VALUES(?,?,?,?,?,?,?)',
    ).run(genId(), existing.key, existing.value, existing.scope_key, existing.session_id ?? null, existing.valid_at ?? existing.updated_at, ts)
    const confidence = Math.min(0.9, (existing.confidence ?? 0.5) + 0.1)
    db.prepare(
      'UPDATE preferences SET value = ?, confidence = ?, updated_at = ?, valid_at = ?, session_id = ? WHERE id = ?',
    ).run(data.value, confidence, ts, ts, data.session_id ?? null, existing.id)
    // FTS update
    db.prepare("DELETE FROM yolo_fts WHERE row_type = 'preference' AND row_id = ?").run(existing.id)
    db.prepare('INSERT INTO yolo_fts(row_type, row_id, title, body) VALUES(?, ?, ?, ?)').run(
      'preference',
      existing.id,
      data.key,
      data.value,
    )
    return {
      ...existing,
      value: data.value,
      confidence,
      updated_at: ts,
      valid_at: ts,
      invalid_at: null,
      session_id: data.session_id ?? null,
    }
  }
  const id = genId()
  db.prepare(
    'INSERT INTO preferences(id, key, value, confidence, scope_key, updated_at, valid_at, session_id) VALUES(?,?,?,?,?,?,?,?)',
  ).run(id, data.key, data.value, 0.5, data.scope_key, ts, ts, data.session_id ?? null)
  return {
    id,
    key: data.key,
    value: data.value,
    confidence: 0.5,
    scope_key: data.scope_key,
    updated_at: ts,
    valid_at: ts,
    invalid_at: null,
    session_id: data.session_id ?? null,
  }
}

export function listPreferences(db: DB, scopeKey: string): Preference[] {
  return db
    .prepare('SELECT * FROM preferences WHERE scope_key = ? AND invalid_at IS NULL ORDER BY updated_at DESC')
    .all(scopeKey) as Preference[]
}

/** Append-only trail of superseded preference values (R14 evidence/provenance). */
export function listPreferenceHistory(db: DB, scopeKey: string): PreferenceHistory[] {
  return db
    .prepare('SELECT * FROM preference_history WHERE scope_key = ? ORDER BY invalid_at DESC')
    .all(scopeKey) as PreferenceHistory[]
}

// ---------- timeline events ----------

export function addEvent(
  db: DB,
  data: { kind: EventKind; summary: string; detail?: string | null; session_id?: string | null; source?: Source | null; occurred_at?: number; scope_key: string },
): TimelineEvent | null {
  const ts = data.occurred_at ?? now()
  const row: TimelineEvent = {
    id: genId(),
    kind: data.kind,
    summary: data.summary,
    detail: data.detail ?? null,
    session_id: data.session_id ?? null,
    source: data.source ?? null,
    occurred_at: ts,
    scope_key: data.scope_key,
  }
  db.prepare(
    `INSERT INTO events(id, kind, summary, detail, session_id, source, occurred_at, scope_key)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run(row.id, row.kind, row.summary, row.detail, row.session_id, row.source, row.occurred_at, row.scope_key)
  return row
}

export function listEvents(db: DB, scopeKey: string, limit = 50): TimelineEvent[] {
  // rowid DESC breaks same-millisecond ties (occurred_at is ms-precision, so
  // two events created in one tick have equal keys and SQLite does not
  // guarantee their order — this made the timeline flaky across platforms).
  return db
    .prepare('SELECT * FROM events WHERE scope_key = ? ORDER BY occurred_at DESC, rowid DESC LIMIT ?')
    .all(scopeKey, limit) as TimelineEvent[]
}

/** Events within [fromMs, toMs) — the day ledger's data source (local day bounds). */
export function listEventsBetween(db: DB, scopeKey: string, fromMs: number, toMs: number): TimelineEvent[] {
  return db
    .prepare('SELECT * FROM events WHERE scope_key = ? AND occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at DESC, rowid DESC')
    .all(scopeKey, fromMs, toMs) as TimelineEvent[]
}

// ---------- session summaries (v0.3.0 ledger source badges) ----------

export function upsertSessionSummary(
  db: DB,
  data: { session_id: string; summary: string; scope_key: string },
): void {
  db.prepare(
    `INSERT INTO session_summaries(session_id, summary, scope_key, updated_at)
     VALUES(?,?,?,?)
     ON CONFLICT(session_id) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`,
  ).run(data.session_id, data.summary, data.scope_key, now())
}

export function listSessionSummaries(db: DB, scopeKey: string): SessionSummary[] {
  return db.prepare('SELECT * FROM session_summaries WHERE scope_key = ?').all(scopeKey) as SessionSummary[]
}

// ---------- notifications (v0.3.0 cards + badge) ----------

export function addNotification(
  db: DB,
  data: { kind: NotificationKind; title: string; body?: string | null; todo_id?: string | null; scope_cwd?: string | null; scope_key: string },
): Notification {
  const row: Notification = {
    id: genId(),
    kind: data.kind,
    title: data.title,
    body: data.body ?? null,
    todo_id: data.todo_id ?? null,
    scope_cwd: data.scope_cwd ?? null,
    created_at: now(),
    handled_at: null,
    scope_key: data.scope_key,
  }
  db.prepare(
    `INSERT INTO notifications(id, kind, title, body, todo_id, scope_cwd, created_at, handled_at, scope_key)
     VALUES(?,?,?,?,?,?,?,NULL,?)`,
  ).run(row.id, row.kind, row.title, row.body, row.todo_id, row.scope_cwd, row.created_at, row.scope_key)
  return row
}

export function listNotifications(db: DB, scopeKey: string, limit = 20): Notification[] {
  return db
    .prepare('SELECT * FROM notifications WHERE scope_key = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(scopeKey, limit) as Notification[]
}

export function listUnhandledNotifications(db: DB, scopeKey: string): Notification[] {
  return db
    .prepare('SELECT * FROM notifications WHERE scope_key = ? AND handled_at IS NULL ORDER BY created_at ASC')
    .all(scopeKey) as Notification[]
}

/** Count-only badge query; avoids materializing notification rows every poll. */
export function countUnhandledNotifications(db: DB, scopeKey: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM notifications WHERE scope_key = ? AND handled_at IS NULL')
    .get(scopeKey) as { count: number }
  return row.count
}

export function markNotificationHandled(db: DB, id: string): void {
  db.prepare('UPDATE notifications SET handled_at = ? WHERE id = ? AND handled_at IS NULL').run(now(), id)
}

/** Clear every unhandled reminder notification attached to a todo (any handling path). */
export function markTodoNotificationsHandled(db: DB, todoId: string): void {
  db.prepare("UPDATE notifications SET handled_at = ? WHERE todo_id = ? AND handled_at IS NULL AND kind = 'reminder'").run(now(), todoId)
}

// ---------- dashboard-v2 attention trust + action idempotency ----------

export interface AttentionFeedbackKey {
  scope_key: string
  todo_id: string
  reason_version: string
  evidence_fingerprint: string
}

export function getAttentionFeedback(db: DB, key: AttentionFeedbackKey): AttentionFeedback | undefined {
  return db.prepare(
    `SELECT * FROM attention_feedback
     WHERE scope_key = ? AND todo_id = ? AND reason_version = ? AND evidence_fingerprint = ?`,
  ).get(key.scope_key, key.todo_id, key.reason_version, key.evidence_fingerprint) as AttentionFeedback | undefined
}

export function listAttentionFeedback(db: DB, scopeKey: string): AttentionFeedback[] {
  return db.prepare(
    'SELECT * FROM attention_feedback WHERE scope_key = ? ORDER BY updated_at DESC',
  ).all(scopeKey) as AttentionFeedback[]
}

/** Merge one explicit trust signal without clearing the other persisted fields. */
export function recordAttentionFeedback(
  db: DB,
  key: AttentionFeedbackKey,
  patch: { seen_at?: number | null; suppressed_until?: number | null; feedback_reason?: string | null },
): AttentionFeedback {
  const ts = now()
  db.prepare(
    `INSERT INTO attention_feedback(
       scope_key, todo_id, reason_version, evidence_fingerprint,
       seen_at, suppressed_until, feedback_reason, created_at, updated_at
     ) VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(scope_key, todo_id, reason_version, evidence_fingerprint) DO UPDATE SET
       seen_at = COALESCE(attention_feedback.seen_at, excluded.seen_at),
       suppressed_until = COALESCE(excluded.suppressed_until, attention_feedback.suppressed_until),
       feedback_reason = COALESCE(excluded.feedback_reason, attention_feedback.feedback_reason),
       updated_at = excluded.updated_at`,
  ).run(
    key.scope_key,
    key.todo_id,
    key.reason_version,
    key.evidence_fingerprint,
    patch.seen_at ?? null,
    patch.suppressed_until ?? null,
    patch.feedback_reason ?? null,
    ts,
    ts,
  )
  return getAttentionFeedback(db, key)!
}

export function getClientAction(db: DB, scopeKey: string, clientActionId: string): ClientActionRecord | undefined {
  return db.prepare(
    'SELECT * FROM client_actions WHERE scope_key = ? AND client_action_id = ?',
  ).get(scopeKey, clientActionId) as ClientActionRecord | undefined
}

export function saveClientAction(
  db: DB,
  data: { scope_key: string; client_action_id: string; request_hash: string; outcome_json: string },
): ClientActionRecord {
  db.prepare(
    `INSERT INTO client_actions(scope_key, client_action_id, request_hash, outcome_json, created_at)
     VALUES(?,?,?,?,?)`,
  ).run(data.scope_key, data.client_action_id, data.request_hash, data.outcome_json, now())
  return getClientAction(db, data.scope_key, data.client_action_id)!
}

// ---------- fuzzy title matching (M8) ----------
// normalizeTitle collapses separators to spaces, which keeps CJK and ASCII
// comparable but makes "修 登录bug" != "修登录bug". The finders additionally
// compare space-stripped forms so LLM echoes with different spacing still hit.

function looseKey(s: string): string {
  return normalize(s).replace(/\s+/g, '')
}

function looseMatch(stored: string, query: string): boolean {
  const a = looseKey(stored)
  const b = looseKey(query)
  if (!a || !b) return false
  if (a === b) return true
  return Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a))
}

/**
 * Pick the best-located row by title (v0.3.2, refined from the unique-substring
 * idea): an EXACT normalized title wins outright; otherwise rank the loose
 * matches by activity (status priority, then most recently updated) so an
 * action never silently lands on an arbitrary first match. This is the
 * "prefer the right one" half of the ambiguous-ref guard — the full
 * ambiguous-with-candidates error is a documented follow-up.
 */
function bestByTitle<T extends { title: string; status: string; updated_at: number }>(
  rows: readonly T[],
  title: string,
  statusRank: (s: string) => number,
): T | undefined {
  const matches = rows.filter((r) => looseMatch(r.title, title))
  if (matches.length === 0) return undefined
  const target = looseKey(title)
  const exact = matches.filter((r) => looseKey(r.title) === target)
  const pool = exact.length > 0 ? exact : matches
  return [...pool].sort((a, b) => statusRank(b.status) - statusRank(a.status) || b.updated_at - a.updated_at)[0]
}

const TODO_STATUS_RANK: Record<TodoStatus, number> = { in_progress: 2, pending: 1, done: 0, cancelled: 0 }
const RANK_TODO = (s: string): number => TODO_STATUS_RANK[s as TodoStatus] ?? 0

// ---------- domain actions (M8 Organizer) ----------
// State transitions that ALSO write a timeline event, so "where did it go"
// is always auditable. Shared by extraction updates, the yolo_action tool and
// the dashboard POST endpoint — never bypass these with bare setXxxStatus calls.

const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  planned: '计划中',
  active: '进行中',
  done: '已完成',
  abandoned: '已放弃',
}

/** Apply a domain action to a todo. Terminal todos and unknown ids no-op
 * (return the row as-is / null) — callers decide whether that is an error.
 * Any transition also clears the todo's unhandled reminder notifications. */
export function applyTodoAction(
  db: DB,
  id: string,
  action: TodoAction,
  args?: { due_at?: string | null; session_id?: string | null },
): Todo | null {
  const t = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo | undefined
  if (!t) return null
  if (action !== 'reopen' && (t.status === 'done' || t.status === 'cancelled')) return t
  const ts = now()
  const session_id = args?.session_id ?? null
  // no session ⇒ the panel/UI entrance; the badge reads 看板操作 instead of 早期记录
  const source = session_id ? null : ('manual' as const)
  switch (action) {
    case 'start':
      if (t.status === 'in_progress') return t
      db.prepare('UPDATE todos SET status = ?, updated_at = ? WHERE id = ?').run('in_progress', ts, id)
      addEvent(db, { kind: 'todo_started', summary: `开始：${t.title}`, scope_key: t.scope_key, occurred_at: ts, session_id, source })
      break
    case 'complete':
      setTodoStatus(db, id, 'done')
      // v0.3.2 feedback: a completed commitment is a "good" signal (P/B1)
      db.prepare('UPDATE todos SET good_count = COALESCE(good_count,0) + 1, updated_at = ?, completed_at = ? WHERE id = ?').run(ts, ts, id)
      addEvent(db, { kind: 'todo_completed', summary: `完成：${t.title}`, scope_key: t.scope_key, occurred_at: ts, session_id, source })
      break
    case 'reopen':
      if (t.status !== 'done') return t
      db.prepare("UPDATE todos SET status = 'pending', completed_at = NULL, last_reminded_at = NULL, updated_at = ? WHERE id = ?").run(ts, id)
      syncTodoFts(db, id, t.title, t.detail ?? null)
      addEvent(db, { kind: 'todo_reopened', summary: `撤销完成：${t.title}`, scope_key: t.scope_key, occurred_at: ts, session_id, source })
      break
    case 'cancel':
      setTodoStatus(db, id, 'cancelled')
      // v0.3.2 feedback: a cancelled commitment is a "stale" signal — it was
      // tracked but did not materialize (P/B1)
      db.prepare('UPDATE todos SET stale_count = COALESCE(stale_count,0) + 1, updated_at = ? WHERE id = ?').run(ts, id)
      addEvent(db, { kind: 'todo_cancelled', summary: `取消：${t.title}`, scope_key: t.scope_key, occurred_at: ts, session_id, source })
      break
    case 'postpone': {
      if (!args?.due_at) return t
      db.prepare('UPDATE todos SET due_at = ?, last_reminded_at = NULL, updated_at = ? WHERE id = ?').run(
        args.due_at,
        ts,
        id,
      )
      addEvent(db, {
        kind: 'todo_postponed',
        summary: `推迟：「${t.title}」→ ${args.due_at}`,
        scope_key: t.scope_key,
        occurred_at: ts,
        session_id,
        source,
      })
      break
    }
    case 'remind_again':
      db.prepare('UPDATE todos SET last_reminded_at = NULL, updated_at = ? WHERE id = ?').run(ts, id)
      addEvent(db, { kind: 'todo_remind_again', summary: `再次提醒：「${t.title}」`, scope_key: t.scope_key, occurred_at: ts, session_id, source })
      break
  }
  markTodoNotificationsHandled(db, id)
  return db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo
}

const PRIORITY_RANK: Record<Priority, number> = { low: 0, medium: 1, high: 2, urgent: 3 }

/** Consolidate outcome: the surviving target row, or why the merge was refused. */
export type TodoConsolidateResult =
  | { ok: true; target: Todo }
  | { ok: false; kind: 'not-found' | 'same-item' | 'terminal'; error: string }

/**
 * Merge a duplicate todo (source) into its keeper (target) — M9 P35, one
 * audited atomic action instead of implicit dedup magic. Deterministic rules:
 * target absorbs source's due_at (only when its own is empty) and the higher
 * priority, its detail records the merge; source is soft-cancelled (FTS drop)
 * and its unhandled reminder cards are settled. One todo_consolidated event
 * covers the whole merge. `scopeKey` pins the fuzzy-title fallback; id refs
 * resolve without it (and a resolved source pins the scope for the target).
 */
export function applyTodoConsolidate(
  db: DB,
  sourceRef: { id?: string; title?: string },
  intoRef: { id?: string; title?: string },
  sessionId?: string | null,
  scopeKey?: string,
): TodoConsolidateResult {
  const byId = (id?: string): Todo | undefined =>
    id ? (db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo | undefined) : undefined
  const source = byId(sourceRef.id) ?? (sourceRef.title && scopeKey ? findTodoByTitle(db, scopeKey, sourceRef.title) : undefined)
  if (!source) return { ok: false, kind: 'not-found', error: 'source todo not found' }
  const target = byId(intoRef.id) ?? (intoRef.title ? findTodoByTitle(db, scopeKey ?? source.scope_key, intoRef.title) : undefined)
  if (!target) return { ok: false, kind: 'not-found', error: 'target todo not found' }
  if (source.id === target.id) return { ok: false, kind: 'same-item', error: 'source and target are the same todo' }
  if (source.status === 'done' || source.status === 'cancelled' || target.status === 'done' || target.status === 'cancelled') {
    return { ok: false, kind: 'terminal', error: 'consolidate requires both todos to be open (pending/in_progress)' }
  }
  const ts = now()
  const mergeNote = `（已并入「${source.title}」${source.due_at ? `，原截止 ${source.due_at}` : ''}）`
  const mergedDetail = target.detail ? target.detail + mergeNote : mergeNote
  const due = target.due_at || source.due_at || null
  const pri =
    target.priority && source.priority
      ? PRIORITY_RANK[target.priority] >= PRIORITY_RANK[source.priority]
        ? target.priority
        : source.priority
      : (target.priority ?? source.priority ?? null)
  db.prepare('UPDATE todos SET detail = ?, due_at = ?, priority = ?, updated_at = ? WHERE id = ?').run(
    mergedDetail,
    due,
    pri,
    ts,
    target.id,
  )
  syncTodoFts(db, target.id, target.title, mergedDetail)
  setTodoStatus(db, source.id, 'cancelled')
  markTodoNotificationsHandled(db, source.id)
  const inherited: string[] = []
  if (due && due !== target.due_at) inherited.push(`继承截止 ${due}`)
  if (pri !== target.priority) inherited.push(`优先级升为 ${pri}`)
  addEvent(db, {
    kind: 'todo_consolidated',
    summary: `合并：「${source.title}」→「${target.title}」`,
    detail: inherited.length ? inherited.join('；') : null,
    scope_key: target.scope_key,
    occurred_at: ts,
    session_id: sessionId ?? null,
    source: sessionId ? null : 'manual',
  })
  return { ok: true, target: db.prepare('SELECT * FROM todos WHERE id = ?').get(target.id) as Todo }
}

/** Inline-edit a todo's plan fields (v0.3.0 E). Only provided fields change;
 * title edits resync FTS; every change writes a todo_updated audit event.
 * Goal progress is deliberately NOT editable here (D14: no fake progress). */
export function applyTodoUpdate(
  db: DB,
  id: string,
  patch: { title?: string; due_at?: string | null; priority?: Priority | null; milestone_id?: string | null },
  sessionId?: string | null,
): Todo | null {
  const t = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo | undefined
  if (!t) return null
  const title = patch.title?.trim() ? patch.title.trim() : t.title
  const due = patch.due_at !== undefined ? patch.due_at : t.due_at
  const pri = patch.priority !== undefined ? patch.priority : t.priority
  const ms = patch.milestone_id !== undefined ? patch.milestone_id : t.milestone_id
  const ts = now()
  db.prepare('UPDATE todos SET title = ?, due_at = ?, priority = ?, milestone_id = ?, updated_at = ? WHERE id = ?').run(title, due, pri, ms, ts, id)
  syncTodoFts(db, id, title, t.detail ?? null)
  const changes: string[] = []
  if (title !== t.title) changes.push(`标题「${t.title}」→「${title}」`)
  if (due !== t.due_at) changes.push(`截止 ${t.due_at ?? '无'} → ${due ?? '无'}`)
  if (pri !== t.priority) changes.push(`优先级 ${t.priority ?? '无'} → ${pri ?? '无'}`)
  addEvent(db, {
    kind: 'todo_updated',
    summary: `更新「${title}」${changes.length ? `（${changes.join('；')}）` : ''}`,
    scope_key: t.scope_key,
    occurred_at: ts,
    session_id: sessionId ?? null,
    source: 'manual',
  })
  return db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo
}

/** Set goal progress with a timeline event; >= 100 flips status to achieved. */
export function applyGoalProgress(db: DB, id: string, progress: number, note?: string | null, sessionId?: string | null): Goal | null {
  const g = db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as Goal | undefined
  if (!g) return null
  const clamped = Math.max(0, Math.min(100, Math.round(progress)))
  setGoalProgress(db, id, clamped)
  addEvent(db, {
    kind: 'goal_progress',
    summary: `目标「${g.title}」进度 ${clamped}%`,
    detail: note ?? null,
    scope_key: g.scope_key,
    session_id: sessionId ?? null,
    source: sessionId ? null : 'manual',
  })
  return db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as Goal
}

/** Transition a milestone status with a timeline event. */
export function applyMilestoneStatus(db: DB, id: string, status: MilestoneStatus, sessionId?: string | null): Milestone | null {
  const m = db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as Milestone | undefined
  if (!m) return null
  if (m.status === status) return m
  setMilestoneStatus(db, id, status)
  addEvent(db, {
    kind: 'milestone_status',
    summary: `里程碑「${m.title}」${MILESTONE_STATUS_LABEL[status]}`,
    scope_key: m.scope_key,
    session_id: sessionId ?? null,
    source: sessionId ? null : 'manual',
  })
  return db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as Milestone
}

/** Rename a milestone with a timeline event (v0.3.0 E inline edit). */
export function applyMilestoneRename(db: DB, id: string, title: string, sessionId?: string | null): Milestone | null {
  const t = title.trim()
  const m = db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as Milestone | undefined
  if (!m || !t || t === m.title) return m ?? null
  const ts = now()
  db.prepare('UPDATE milestones SET title = ?, updated_at = ? WHERE id = ?').run(t, ts, id)
  syncMilestoneFts(db, id, t, m.description)
  addEvent(db, {
    kind: 'milestone_status',
    summary: `里程碑改名「${m.title}」→「${t}」`,
    scope_key: m.scope_key,
    session_id: sessionId ?? null,
    source: 'manual',
  })
  return db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as Milestone
}

/** Rename a goal with a timeline event (v0.3.0 E inline edit). */
export function applyGoalRename(db: DB, id: string, title: string, sessionId?: string | null): Goal | null {
  const t = title.trim()
  const g = db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as Goal | undefined
  if (!g || !t || t === g.title) return g ?? null
  const ts = now()
  db.prepare('UPDATE goals SET title = ?, updated_at = ? WHERE id = ?').run(t, ts, id)
  db.prepare("DELETE FROM yolo_fts WHERE row_type = 'goal' AND row_id = ?").run(id)
  db.prepare('INSERT INTO yolo_fts(row_type, row_id, title, body) VALUES(?, ?, ?, ?)').run('goal', id, t, g.description ?? '')
  addEvent(db, {
    kind: 'goal_progress',
    summary: `目标改名「${g.title}」→「${t}」`,
    scope_key: g.scope_key,
    session_id: sessionId ?? null,
    source: 'manual',
  })
  return db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as Goal
}

/** Abandon (soft-delete) a goal with a timeline event (v0.3.0 E). */
export function applyGoalAbandon(db: DB, id: string, sessionId?: string | null): Goal | null {
  const g = db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as Goal | undefined
  if (!g) return null
  if (g.status === 'abandoned') return g
  const ts = now()
  db.prepare('UPDATE goals SET status = ?, updated_at = ? WHERE id = ?').run('abandoned', ts, id)
  db.prepare("DELETE FROM yolo_fts WHERE row_type = 'goal' AND row_id = ?").run(id)
  addEvent(db, {
    kind: 'goal_status',
    summary: `目标「${g.title}」已放弃`,
    scope_key: g.scope_key,
    session_id: sessionId ?? null,
    source: 'manual',
  })
  return db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as Goal
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

/** LLM extraction runs since a timestamp — the daily-cap gate input (M9 P44). */
export function countExtractionsSince(db: DB, sinceMs: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM extraction_log WHERE strategy = 'llm' AND created_at >= ?")
    .get(sinceMs) as { n: number } | undefined
  return row?.n ?? 0
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


// ---------- recall log (v0.3.0 semantic-recall observability) ----------

export function logRecall(
  db: DB,
  data: {
    scope_key: string
    session_id?: string | null
    query: string
    expansions?: string | null
    kept_keys?: string | null
    drop_reasons?: string | null
    rerank_outcome?: string | null
    latency_ms?: number | null
    source: 'user' | 'system'
    status: 'ok' | 'empty' | 'error'
    error?: string | null
  },
): void {
  db.prepare(
    `INSERT INTO recall_log(scope_key, session_id, query, expansions, kept_keys, drop_reasons, rerank_outcome, latency_ms, source, status, error, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    data.scope_key,
    data.session_id ?? null,
    data.query,
    data.expansions ?? null,
    data.kept_keys ?? null,
    data.drop_reasons ?? null,
    data.rerank_outcome ?? null,
    data.latency_ms ?? null,
    data.source,
    data.status,
    data.error ?? null,
    now(),
  )
}

/** Semantic-recall rows since a timestamp — budget + health inputs (v0.3.0). */
export function countRecallSince(db: DB, sinceMs: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM recall_log WHERE created_at >= ?').get(sinceMs) as { n: number } | undefined
  return row?.n ?? 0
}

/** Most recent semantic-recall observations — the health/visibility feed. */
export function listRecentRecall(db: DB, scopeKey: string, limit = 50): RecallLog[] {
  return db
    .prepare('SELECT * FROM recall_log WHERE scope_key = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(scopeKey, limit) as RecallLog[]
}

/** Drop recall_log rows older than retentionDays (called on a light cadence). */
export function pruneRecallLog(db: DB, retentionDays: number): number {
  const cutoff = now() - retentionDays * 24 * 60 * 60 * 1000
  const info = db.prepare('DELETE FROM recall_log WHERE created_at < ?').run(cutoff)
  return info.changes
}

// ---------- memory health (v0.3.0) ----------

/** LLM extraction runs that errored since a timestamp — the health feed. */
export function countExtractionErrorsSince(db: DB, sinceMs: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM extraction_log WHERE strategy = 'llm' AND status = 'error' AND created_at >= ?")
    .get(sinceMs) as { n: number } | undefined
  return row?.n ?? 0
}

/** Timeline events of a kind since a timestamp (e.g. action_denied). */
export function countEventKindSince(db: DB, kind: string, sinceMs: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM events WHERE kind = ? AND occurred_at >= ?').get(kind, sinceMs) as { n: number } | undefined
  return row?.n ?? 0
}

/** Open-todo near-duplicate candidate pairs within a scope, by normalized title. */
export function listDuplicateTodos(db: DB, scopeKey: string): DuplicateTodoPair[] {
  const rows = db
    .prepare("SELECT id, title FROM todos WHERE scope_key = ? AND status IN ('pending','in_progress') ORDER BY created_at ASC")
    .all(scopeKey) as Array<{ id: string; title: string }>
  const byNorm = new Map<string, Array<{ id: string; title: string }>>()
  for (const r of rows) {
    const n = normalize(r.title)
    if (!n) continue
    const arr = byNorm.get(n) ?? []
    arr.push(r)
    byNorm.set(n, arr)
  }
  const pairs: DuplicateTodoPair[] = []
  for (const group of byNorm.values()) {
    if (group.length < 2) continue
    const keeper = group[0]
    for (let i = 1; i < group.length; i++) {
      const dup = group[i]
      pairs.push({ a: keeper.id, b: dup.id, aTitle: keeper.title, bTitle: dup.title })
    }
  }
  return pairs
}
/** Semantic-recall rows of a status since a timestamp (health hit-rate feed). */
export function countRecallStatusSince(db: DB, status: string, sinceMs: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM recall_log WHERE status = ? AND created_at >= ?').get(status, sinceMs) as { n: number } | undefined
  return row?.n ?? 0
}
export type { ExtractionLog }
