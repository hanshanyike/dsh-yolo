// YOLO repository — typed CRUD over the SQLite tables.
// All writes that touch searchable text also update yolo_fts (via triggers on INSERT;
// UPDATE/DELETE to FTS handled here explicitly so edits/deletes stay searchable).

import { randomUUID } from 'node:crypto'
import { normalizeTitle as normalize } from '../shared/text.ts'
import { compareDueAt, isDueAtReached, parseDueAt } from '../shared/due.ts'
import { todoEvidenceFingerprint } from '../shared/todo-identity.ts'
import { canonicalTodoTitle, compareTodoTitles } from '../shared/todo-similarity.ts'
import { selectTodosInRange, type TodoRangeAction, type TodoRangeSelector } from '../shared/todo-range.ts'
import type { DB } from './db.ts'
import type {
  ExtractionLog,
  ExtractionStatus,
  ExtractionStrategy,
  Goal,
  GoalEvidence,
  GoalEvidenceRelation,
  GoalEvidenceSourceKind,
  GoalMilestoneLink,
  GoalProgressSource,
  GoalTodoLink,
  GoalTodoRelation,
  GoalStatus,
  HistorySubjectStats,
  HistorySubjectType,
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
  TodoEvidence,
  TodoEvidenceRelation,
  TodoEvidenceSourceKind,
  TodoStatus,
  EventKind,
  DuplicateTodoPair,
  AttentionFeedback,
  ClientActionRecord,
  TodoResolutionLog,
  TodoIdentityFeedback,
  TodoIdentityFeedbackReason,
  TodoIdentityReceipt, TodoMergeRecord, TodoMergeSuggestionFeedback, TodoResolutionPrediction,
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

const SOURCE_EXCERPT_LIMIT = 400

function normalizeEvidenceExcerpt(value?: string | null): string | null {
  const text = value?.replace(/\s+/gu, ' ').trim() ?? ''
  return text ? Array.from(text).slice(0, SOURCE_EXCERPT_LIMIT).join('') : null
}

function normalizeSourceEvidence(data: {
  source?: Source
  session_id?: string | null
  source_excerpt?: string | null
  source_turn?: number | null
}): { excerpt: string | null; turn: number | null } {
  // A durable tool call may carry its owning host turn, but never a direct-user
  // quotation. Manual callers carry neither. Only extraction may persist the
  // bounded excerpt used as direct-human evidence.
  if (data.source === 'tool' && data.session_id && Number.isInteger(data.source_turn)) {
    return { excerpt: null, turn: data.source_turn as number }
  }
  if (data.source !== 'llm' || !data.session_id || !Number.isInteger(data.source_turn)) {
    return { excerpt: null, turn: null }
  }
  const excerpt = normalizeEvidenceExcerpt(data.source_excerpt)
  if (!excerpt) return { excerpt: null, turn: null }
  return {
    excerpt,
    turn: data.source_turn as number,
  }
}

export interface AddTodoEvidenceInput {
  todo_id: string
  source_scope_key: string
  session_id?: string | null
  turn_seq?: number | null
  source_kind: TodoEvidenceSourceKind
  relation: TodoEvidenceRelation
  excerpt?: string | null
  occurred_at?: number
  source_fingerprint: string
}

/** Append immutable provenance. A repeated fingerprint returns the first row
 * without moving or rewriting it, making host/tool retries safe. */
export function addTodoEvidence(
  db: DB,
  data: AddTodoEvidenceInput,
): { row: TodoEvidence; created: boolean } {
  const fingerprint = data.source_fingerprint.trim()
  if (!fingerprint) throw new Error('todo evidence requires source_fingerprint')
  const existing = db.prepare('SELECT * FROM todo_evidence WHERE source_fingerprint = ?').get(fingerprint) as TodoEvidence | undefined
  if (existing) {
    const existingTodo = resolveCanonicalTodo(db, existing.todo_id)
    const requestedTodo = resolveCanonicalTodo(db, data.todo_id)
    if (!existingTodo || !requestedTodo || existingTodo.id !== requestedTodo.id) {
      throw new Error(`todo evidence fingerprint conflict: ${fingerprint}`)
    }
    return { row: existing, created: false }
  }
  const row: TodoEvidence = {
    id: genId(),
    todo_id: data.todo_id,
    source_scope_key: data.source_scope_key,
    session_id: data.session_id ?? null,
    turn_seq: Number.isInteger(data.turn_seq) ? data.turn_seq as number : null,
    source_kind: data.source_kind,
    relation: data.relation,
    excerpt: normalizeEvidenceExcerpt(data.excerpt),
    occurred_at: data.occurred_at ?? now(),
    source_fingerprint: fingerprint,
  }
  const inserted = db.prepare(
    `INSERT OR IGNORE INTO todo_evidence(
       id, todo_id, source_scope_key, session_id, turn_seq,
       source_kind, relation, excerpt, occurred_at, source_fingerprint
     ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    row.id,
    row.todo_id,
    row.source_scope_key,
    row.session_id,
    row.turn_seq,
    row.source_kind,
    row.relation,
    row.excerpt,
    row.occurred_at,
    row.source_fingerprint,
  )
  if (Number(inserted.changes) > 0) return { row, created: true }
  const concurrent = db.prepare('SELECT * FROM todo_evidence WHERE source_fingerprint = ?').get(fingerprint) as TodoEvidence
  const concurrentTodo = resolveCanonicalTodo(db, concurrent.todo_id)
  const requestedTodo = resolveCanonicalTodo(db, data.todo_id)
  if (!concurrentTodo || !requestedTodo || concurrentTodo.id !== requestedTodo.id) {
    throw new Error(`todo evidence fingerprint conflict: ${fingerprint}`)
  }
  return {
    row: concurrent,
    created: false,
  }
}

/** Resolve a historical merged id to its canonical row. Corrupt cycles fail
 * closed instead of looping forever. Rejected rows remain self-resolving. */
export function resolveCanonicalTodo(db: DB, id: string): Todo | undefined {
  const seen = new Set<string>()
  let currentId: string | null = id
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(currentId) as Todo | undefined
    if (!row) return undefined
    if (row.record_status !== 'merged' || !row.merged_into_id) return row
    currentId = row.merged_into_id
  }
  return undefined
}

/** Evidence for the canonical todo plus every historical record merged into
 * it. Rows themselves remain immutable; the recursive projection supplies the
 * multi-session view without rewriting provenance. */
export function listTodoEvidence(db: DB, todoId: string): TodoEvidence[] {
  const canonical = resolveCanonicalTodo(db, todoId)
  if (!canonical) return []
  return db.prepare(
    `WITH RECURSIVE related(id) AS (
       SELECT ?
       UNION ALL
       SELECT todos.id FROM todos JOIN related ON todos.merged_into_id = related.id
     )
     SELECT e.* FROM todo_evidence e
     JOIN related ON related.id = e.todo_id
     LEFT JOIN todo_identity_feedback feedback ON feedback.evidence_id = e.id AND feedback.verdict = 'incorrect'
     WHERE feedback.id IS NULL
     ORDER BY e.occurred_at ASC, e.rowid ASC`,
  ).all(canonical.id) as TodoEvidence[]
}

function defaultEvidenceSourceKind(source?: Source): TodoEvidenceSourceKind {
  if (source === 'tool') return 'assistant_action'
  if (source === 'manual') return 'panel_action'
  return 'extraction'
}

function fallbackEvidenceFingerprint(
  data: { scope_key: string; session_id?: string | null; source_turn?: number | null; source?: Source; title: string },
): string | null {
  if (!data.session_id || !Number.isInteger(data.source_turn)) return null
  return `todo:${data.scope_key}:${data.session_id}:${data.source_turn}:${data.source ?? 'unknown'}:${normalize(data.title)}`
}

export function upsertTodo(
  db: DB,
  data: {
    title: string
    detail?: string | null
    priority?: Priority | null
    due_at?: string | null
    milestone_id?: string | null
    status?: GoalStatus
    scope_key: string
    source?: Source
    session_id?: string | null
    source_excerpt?: string | null
    source_turn?: number | null
    /** Stable host/tool operation identity. Replays resolve to the first todo. */
    source_fingerprint?: string | null
    /** Stable enclosing operation; evidence is bound to the resolved canonical id. */
    evidence_operation_key?: string
    evidence_source_kind?: TodoEvidenceSourceKind
    evidence_relation?: TodoEvidenceRelation
    evidence_occurred_at?: number
  },
): { row: Todo; created: boolean } {
  const dedupKey = `todo:${normalize(data.title)}`
  const ts = now()
  const replayFingerprint = data.source_fingerprint?.trim()
    || (data.evidence_operation_key ? null : fallbackEvidenceFingerprint(data))
  if (replayFingerprint) {
    const evidence = db.prepare('SELECT todo_id FROM todo_evidence WHERE source_fingerprint = ?').get(replayFingerprint) as
      | { todo_id: string }
      | undefined
    if (evidence) {
      const replay = resolveCanonicalTodo(db, evidence.todo_id)
      if (replay) return { row: replay, created: false }
    }
  }
  let existing = db
    .prepare(
      `SELECT * FROM todos
       WHERE dedup_key = ? AND scope_key = ? AND record_status = 'canonical'
         AND status IN ('pending','in_progress')
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
    .get(dedupKey, data.scope_key) as Todo | undefined
  if (!existing && data.source === 'llm' && data.session_id) {
    const incomingTitle = normalize(data.title)
    const provisional = db.prepare(
      `SELECT * FROM todos
       WHERE scope_key = ? AND source = 'tool' AND session_id = ?
         AND record_status = 'canonical'
         AND status IN ('pending','in_progress') AND source_excerpt IS NULL AND created_at >= ?
       ORDER BY created_at DESC, id ASC`,
    ).all(data.scope_key, data.session_id, ts - 5 * 60_000) as Todo[]
    const sameTurn = Number.isInteger(data.source_turn)
      ? [
          ...provisional.filter((candidate) => candidate.source_turn === data.source_turn),
          ...provisional.filter((candidate) => candidate.source_turn == null),
        ]
      : provisional.filter((candidate) => candidate.source_turn == null)
    existing = sameTurn.find((candidate) => {
      const candidateTitle = normalize(candidate.title)
      return Math.min(candidateTitle.length, incomingTitle.length) >= 6
        && (candidateTitle.includes(incomingTitle) || incomingTitle.includes(candidateTitle))
    })
  }
  const sourceEvidence = normalizeSourceEvidence(data)
  if (existing) {
    const fingerprint = replayFingerprint
      ?? (data.evidence_operation_key ? todoEvidenceFingerprint(data.evidence_operation_key, existing.id) : null)
    // update mutable fields (take non-null incoming)
    const due = data.due_at ?? existing.due_at
    const pri = data.priority ?? existing.priority ?? null
    const detail = data.detail ?? existing.detail ?? null
    const ms = data.milestone_id ?? existing.milestone_id ?? null
    // The host agent may call memory_write before the independent post-turn
    // extractor sees the same accepted input. Promote that same-session tool
    // origin once to stronger direct-user evidence; unrelated later turns
    // never replace the original source.
    const promoteToolOrigin = existing.source === 'tool'
      && !!existing.session_id
      && existing.session_id === data.session_id
      && data.source === 'llm'
      && sourceEvidence.excerpt !== null
      && existing.source_excerpt == null
    const source = promoteToolOrigin ? 'llm' : existing.source
    const sourceExcerpt = promoteToolOrigin ? sourceEvidence.excerpt : existing.source_excerpt ?? null
    const sourceTurn = promoteToolOrigin ? sourceEvidence.turn : existing.source_turn ?? null
    db.prepare(
      'UPDATE todos SET due_at = ?, priority = ?, detail = ?, milestone_id = ?, source = ?, source_excerpt = ?, source_turn = ?, updated_at = ? WHERE id = ?',
    ).run(due, pri, detail, ms, source, sourceExcerpt, sourceTurn, ts, existing.id)
    syncTodoFts(db, existing.id, existing.title, detail)
    if (fingerprint) {
      addTodoEvidence(db, {
        todo_id: existing.id,
        source_scope_key: data.scope_key,
        session_id: data.session_id,
        turn_seq: data.source_turn,
        source_kind: data.evidence_source_kind ?? defaultEvidenceSourceKind(data.source),
        relation: data.evidence_relation ?? 'mention',
        excerpt: sourceEvidence.excerpt ?? data.source_excerpt,
        occurred_at: data.evidence_occurred_at ?? ts,
        source_fingerprint: fingerprint,
      })
    }
    return {
      row: { ...existing, due_at: due, priority: pri, detail, milestone_id: ms, source, source_excerpt: sourceExcerpt, source_turn: sourceTurn, updated_at: ts },
      created: false,
    }
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
    source_excerpt: sourceEvidence.excerpt,
    source_turn: sourceEvidence.turn,
    created_at: ts,
    updated_at: ts,
    completed_at: null,
    record_status: 'canonical',
    merged_into_id: null,
  }
  db.prepare(
    `INSERT INTO todos(id, title, detail, status, priority, due_at, milestone_id, scope_key, dedup_key, source, session_id, source_excerpt, source_turn, created_at, updated_at, completed_at, record_status, merged_into_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,NULL)`,
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
    row.source_excerpt,
    row.source_turn,
    row.created_at,
    row.updated_at,
    row.record_status,
  )
  const fingerprint = replayFingerprint
    ?? (data.evidence_operation_key ? todoEvidenceFingerprint(data.evidence_operation_key, row.id) : null)
  addTodoEvidence(db, {
    todo_id: row.id,
    source_scope_key: data.scope_key,
    session_id: data.session_id,
    turn_seq: data.source_turn,
    source_kind: data.evidence_source_kind ?? defaultEvidenceSourceKind(data.source),
    relation: data.evidence_relation ?? 'origin',
    excerpt: sourceEvidence.excerpt ?? data.source_excerpt,
    occurred_at: data.evidence_occurred_at ?? ts,
    source_fingerprint: fingerprint ?? `todo:${row.id}:origin`,
  })
  return { row, created: true }
}

/** Bind direct-user evidence to synchronous memory_write rows from the same
 * accepted turn. The caller supplies a closed creation-time window so later
 * turns in the same session cannot be captured accidentally. */
export function promoteToolTodoOrigins(
  db: DB,
  scopeKey: string,
  data: {
    session_id: string
    source_excerpt: string
    source_turn: number
    created_from: number
    created_to: number
    /** Stable identity of the accepted human turn; one evidence id is derived per todo. */
    evidence_operation_key?: string
    evidence_occurred_at?: number
  },
): number {
  const evidence = normalizeSourceEvidence({
    source: 'llm',
    session_id: data.session_id,
    source_excerpt: data.source_excerpt,
    source_turn: data.source_turn,
  })
  if (evidence.excerpt === null || evidence.turn === null) return 0
  const rows = db.prepare(
    `SELECT id FROM todos
     WHERE scope_key = ? AND record_status = 'canonical' AND source = 'tool' AND session_id = ?
       AND source_excerpt IS NULL
       AND (source_turn = ? OR (source_turn IS NULL AND created_at >= ? AND created_at <= ?))
     ORDER BY created_at ASC, id ASC`,
  ).all(scopeKey, data.session_id, data.source_turn, data.created_from, data.created_to) as Array<{ id: string }>
  const operationKey = data.evidence_operation_key
    ?? `extract/v1/${scopeKey}/${data.session_id}/${data.source_turn}`
  for (const row of rows) {
    db.prepare(
      "UPDATE todos SET source = 'llm', source_excerpt = ?, source_turn = ? WHERE id = ? AND record_status = 'canonical'",
    ).run(evidence.excerpt, evidence.turn, row.id)
    const fingerprint = todoEvidenceFingerprint(operationKey, row.id)
    addTodoEvidence(db, {
      todo_id: row.id,
      source_scope_key: scopeKey,
      session_id: data.session_id,
      turn_seq: evidence.turn,
      source_kind: 'human',
      relation: 'origin',
      excerpt: evidence.excerpt,
      occurred_at: data.evidence_occurred_at ?? data.created_to,
      source_fingerprint: fingerprint,
    })
  }
  return rows.length
}

export function setTodoStatus(db: DB, id: string, status: TodoStatus): void {
  const ts = now()
  const completed = status === 'done' ? ts : null
  db.prepare("UPDATE todos SET status = ?, completed_at = COALESCE(?, completed_at), updated_at = ? WHERE id = ? AND record_status = 'canonical'").run(
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
  const where = status
    ? "WHERE scope_key = ? AND record_status = 'canonical' AND status = ?"
    : "WHERE scope_key = ? AND record_status = 'canonical'"
  const params = status ? [scopeKey, status] : [scopeKey]
  return db.prepare(`SELECT * FROM todos ${where} ORDER BY due_at IS NULL, due_at ASC, created_at DESC`).all(...params) as Todo[]
}

/** Administrative/history projection including merged and rejected records. */
export function listTodoRecords(db: DB, scopeKey: string): Todo[] {
  return db.prepare(
    'SELECT * FROM todos WHERE scope_key = ? ORDER BY created_at DESC, id ASC',
  ).all(scopeKey) as Todo[]
}

/** Canonical todo candidates for an inclusive local-calendar range. */
export function listTodosInRange(
  db: DB,
  scopeKey: string,
  selector: TodoRangeSelector,
  action: TodoRangeAction,
): Todo[] {
  return selectTodosInRange(listTodos(db, scopeKey), selector, action)
}

export interface PermanentTodoDeleteResult {
  id: string
  deleted_record_count: number
}

function todoIdentityIds(db: DB, canonicalId: string): string[] {
  const rows = db.prepare(
    `WITH RECURSIVE identity(id) AS (
       SELECT id FROM todos WHERE id = ?
       UNION
       SELECT child.id FROM todos child JOIN identity parent ON child.merged_into_id = parent.id
     )
     SELECT id FROM identity`,
  ).all(canonicalId) as Array<{ id: string }>
  return rows.map((row) => row.id)
}

/**
 * Permanently remove one canonical todo identity and its directly-linked
 * projections. Timeline/session text is deliberately outside this boundary:
 * it is an audit/source record, not an FK-owned todo projection.
 */
export function deleteTodoPermanently(db: DB, id: string): PermanentTodoDeleteResult | null {
  const target = resolveCanonicalTodo(db, id)
  if (!target || target.record_status !== 'canonical') return null
  const ids = todoIdentityIds(db, target.id)
  for (const recordId of ids) {
    db.prepare("DELETE FROM yolo_fts WHERE row_type = 'todo' AND row_id = ?").run(recordId)
    db.prepare('DELETE FROM notifications WHERE todo_id = ?').run(recordId)
    db.prepare('DELETE FROM pending_reminders WHERE todo_id = ?').run(recordId)
    db.prepare('DELETE FROM attention_feedback WHERE todo_id = ?').run(recordId)
    db.prepare('DELETE FROM todo_evidence WHERE todo_id = ?').run(recordId)
    // Durable action/recall projections can otherwise retain the deleted id.
    // IDs are generated opaque identifiers, so matching the id itself also
    // covers bulk outcomes whose JSON stores it inside an ids array.
    db.prepare('DELETE FROM client_actions WHERE outcome_json LIKE ?').run(`%${recordId}%`)
    db.prepare(
      `DELETE FROM recall_log
       WHERE kept_keys LIKE ? OR drop_reasons LIKE ? OR rerank_outcome LIKE ?`,
    ).run(`%todo:${recordId}%`, `%todo:${recordId}%`, `%todo:${recordId}%`)
  }
  for (const recordId of [...ids].reverse()) db.prepare('DELETE FROM todos WHERE id = ?').run(recordId)
  return { id: target.id, deleted_record_count: ids.length }
}

export function listDueTodos(db: DB, scopeKey: string, before: string | number | Date): Todo[] {
  const cutoff = before instanceof Date
    ? before
    : typeof before === 'number'
      ? new Date(before)
      : new Date(parseDueAt(before)?.timestamp ?? Number.NaN)
  if (!Number.isFinite(cutoff.getTime())) return []
  // Mixed date-only/local/offset values cannot be ordered correctly by SQLite
  // TEXT comparison, so SQL only narrows status/stamp and shared due semantics
  // own the actual instant cutoff below.
  const candidates = db
    .prepare(
      `SELECT * FROM todos WHERE scope_key = ? AND record_status = 'canonical'
         AND due_at IS NOT NULL AND status IN ('pending','in_progress') AND last_reminded_at IS NULL`,
    )
    .all(scopeKey) as Todo[]
  return candidates
    .filter((todo) => isDueAtReached(todo.due_at, cutoff))
    .sort((a, b) => compareDueAt(a.due_at, b.due_at))
}

/** Stamp a todo as reminded so the scheduler does not re-fire it. */
export function setTodoReminded(db: DB, id: string, ts = now()): void {
  db.prepare("UPDATE todos SET last_reminded_at = ? WHERE id = ? AND record_status = 'canonical'").run(ts, id)
}

/** Fuzzy-locate a non-terminal todo by title (M8 + v0.3.2): an exact normalized
 *  match wins; otherwise bestByTitle ranks loose matches by status/recency. */
export function findTodoByTitle(db: DB, scopeKey: string, title: string): Todo | undefined {
  if (!normalize(title)) return undefined
  const rows = db
    .prepare("SELECT * FROM todos WHERE scope_key = ? AND record_status = 'canonical' AND status IN ('pending','in_progress')")
    .all(scopeKey) as Todo[]
  return bestByTitle(rows, title, RANK_TODO)
}

function syncTodoFts(db: DB, id: string, title: string, detail: string | null): void {
  db.prepare("DELETE FROM yolo_fts WHERE row_type = 'todo' AND row_id = ?").run(id)
  db.prepare('INSERT INTO yolo_fts(row_type, row_id, title, body) VALUES(?, ?, ?, ?)').run('todo', id, title, detail ?? '')
}

function clearGoalNextForTodo(db: DB, todoId: string, occurredAt: number, sessionId: string | null, source: Source | null): void {
  const goals = db.prepare(
    'SELECT g.id, g.title, g.scope_key FROM goals g WHERE g.next_todo_id = ?',
  ).all(todoId) as Array<{ id: string; title: string; scope_key: string }>
  if (goals.length === 0) return
  db.prepare("UPDATE goal_todos SET relation = 'support' WHERE todo_id = ? AND relation = 'next'").run(todoId)
  db.prepare('UPDATE goals SET next_todo_id = NULL, updated_at = ? WHERE next_todo_id = ?').run(occurredAt, todoId)
  for (const goal of goals) {
    addEvent(db, {
      kind: 'goal_next_step_cleared',
      summary: `目标「${goal.title}」的下一步已结束`,
      detail: `事项 ${todoId} 已完成或取消`,
      scope_key: goal.scope_key,
      occurred_at: occurredAt,
      session_id: sessionId,
      source,
      subject_type: 'goal', subject_id: goal.id, subject_title: goal.title,
      related_subject_type: 'todo', related_subject_id: todoId,
      change: { next_todo_id: { before: todoId, after: null } },
    })
  }
}

// ---------- goals ----------

export function upsertGoal(
  db: DB,
  data: {
    title: string
    description?: string | null
    scope_key: string
    milestone_id?: string | null
    status?: GoalStatus
    completion_criteria?: string | null
    target_date?: string | null
    next_review_at?: string | null
    next_todo_id?: string | null
    progress_note?: string | null
    progress_source?: GoalProgressSource
    source?: Source | null
    session_id?: string | null
    source_excerpt?: string | null
    source_turn?: number | null
  },
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
    status: data.status ?? 'active',
    milestone_id: data.milestone_id ?? null,
    completion_criteria: data.completion_criteria ?? null,
    target_date: data.target_date ?? null,
    next_review_at: data.next_review_at ?? null,
    next_todo_id: data.next_todo_id ?? null,
    progress_note: data.progress_note ?? null,
    progress_source: data.progress_source ?? 'none',
    scope_key: data.scope_key,
    source: data.source ?? null,
    session_id: data.session_id ?? null,
    source_excerpt: data.source_excerpt ?? null,
    source_turn: data.source_turn ?? null,
    created_at: ts,
    updated_at: ts,
  }
  db.prepare(
    `INSERT INTO goals(
       id, title, description, progress, status, milestone_id,
       completion_criteria, target_date, next_review_at, next_todo_id,
       progress_note, progress_source, scope_key, source, session_id,
       source_excerpt, source_turn, created_at, updated_at
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    row.id, row.title, row.description, row.progress, row.status, row.milestone_id,
    row.completion_criteria, row.target_date, row.next_review_at, row.next_todo_id,
    row.progress_note, row.progress_source, row.scope_key, row.source, row.session_id,
    row.source_excerpt, row.source_turn, row.created_at, row.updated_at,
  )
  if (row.milestone_id) linkGoalMilestone(db, row.id, row.milestone_id)
  if (row.next_todo_id) setGoalNextTodo(db, row.id, row.next_todo_id)
  return row
}

export function getGoal(db: DB, id: string, scopeKey?: string): Goal | undefined {
  return (scopeKey
    ? db.prepare('SELECT * FROM goals WHERE id = ? AND scope_key = ?').get(id, scopeKey)
    : db.prepare('SELECT * FROM goals WHERE id = ?').get(id)) as Goal | undefined
}

/** Update progress without inferring goal completion. Only an explicit goal
 * status action may move a goal to achieved. */
export function setGoalProgress(
  db: DB,
  id: string,
  progress: number,
  note?: string | null,
  progressSource: GoalProgressSource = 'user_claimed',
): Goal | null {
  const clamped = Math.max(0, Math.min(100, progress))
  const fields = note === undefined
    ? 'progress = ?, progress_source = ?, updated_at = ?'
    : 'progress = ?, progress_note = ?, progress_source = ?, updated_at = ?'
  const params = note === undefined
    ? [clamped, progressSource, now(), id]
    : [clamped, note, progressSource, now(), id]
  db.prepare(`UPDATE goals SET ${fields} WHERE id = ?`).run(...params)
  return getGoal(db, id) ?? null
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

export interface UpdateGoalInput {
  title?: string
  description?: string | null
  completion_criteria?: string | null
  target_date?: string | null
  next_review_at?: string | null
  progress_note?: string | null
  progress_source?: GoalProgressSource
  source?: Source | null
  session_id?: string | null
  source_excerpt?: string | null
  source_turn?: number | null
}

/** Atomic current-state patch primitive. It deliberately does not emit events
 * or choose a product state transition; application commands own that policy. */
export function updateGoal(db: DB, id: string, patch: UpdateGoalInput): Goal | null {
  const current = getGoal(db, id)
  if (!current) return null
  const allowed: Array<keyof UpdateGoalInput> = [
    'title', 'description', 'completion_criteria', 'target_date', 'next_review_at',
    'progress_note', 'progress_source', 'source', 'session_id', 'source_excerpt', 'source_turn',
  ]
  const entries = allowed.filter((key) => patch[key] !== undefined)
  if (entries.length === 0) return current
  const assignments = entries.map((key) => `${key} = ?`).join(', ')
  const values = entries.map((key) => key === 'title' ? String(patch[key]).trim() : patch[key])
  if (entries.includes('title') && !values[entries.indexOf('title')]) return current
  db.prepare(`UPDATE goals SET ${assignments}, updated_at = ? WHERE id = ?`).run(...values, now(), id)
  if (entries.includes('title')) {
    const updated = getGoal(db, id)!
    db.prepare("DELETE FROM yolo_fts WHERE row_type = 'goal' AND row_id = ?").run(id)
    db.prepare('INSERT INTO yolo_fts(row_type, row_id, title, body) VALUES(?, ?, ?, ?)').run('goal', id, updated.title, updated.description ?? '')
  }
  return getGoal(db, id)!
}

/** Change only the explicit goal lifecycle status; callers own event policy. */
export function setGoalStatus(db: DB, id: string, status: GoalStatus): Goal | null {
  const current = getGoal(db, id)
  if (!current || current.status === status) return current ?? null
  db.prepare('UPDATE goals SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id)
  if (status === 'active' || status === 'candidate' || status === 'paused') {
    db.prepare("DELETE FROM yolo_fts WHERE row_type = 'goal' AND row_id = ?").run(id)
    db.prepare('INSERT INTO yolo_fts(row_type, row_id, title, body) VALUES(?, ?, ?, ?)').run('goal', id, current.title, current.description ?? '')
  } else {
    db.prepare("DELETE FROM yolo_fts WHERE row_type = 'goal' AND row_id = ?").run(id)
  }
  return getGoal(db, id) ?? null
}

function goalAndTodo(db: DB, goalId: string, todoId: string): { goal: Goal; todo: Todo } | null {
  const row = db.prepare(
    `SELECT g.id AS goal_id, g.scope_key AS goal_scope, t.*
     FROM goals g JOIN todos t ON t.id = ? WHERE g.id = ?`,
  ).get(todoId, goalId) as (Todo & { goal_id: string; goal_scope: string }) | undefined
  if (!row || row.goal_scope !== row.scope_key) return null
  return { goal: getGoal(db, goalId)!, todo: row }
}

export function listGoalTodoLinks(db: DB, goalId: string): GoalTodoLink[] {
  return db.prepare('SELECT * FROM goal_todos WHERE goal_id = ? ORDER BY created_at ASC, todo_id ASC').all(goalId) as GoalTodoLink[]
}

/** List direct supporting todos; the join keeps the relation table separate
 * from the todo lifecycle and never infers a goal from milestone_id. */
export function listGoalTodos(db: DB, goalId: string): Todo[] {
  return db.prepare(
    `SELECT t.* FROM todos t JOIN goal_todos gt ON gt.todo_id = t.id
     WHERE gt.goal_id = ? ORDER BY gt.created_at ASC, t.created_at ASC, t.id ASC`,
  ).all(goalId) as Todo[]
}

export function linkGoalTodo(
  db: DB,
  goalId: string,
  todoId: string,
  options: { relation?: GoalTodoRelation; is_primary?: boolean } = {},
): GoalTodoLink {
  const pair = goalAndTodo(db, goalId, todoId)
  if (!pair) throw new Error('goal and todo must exist in the same scope')
  const existingPrimary = options.is_primary
    ? db.prepare('SELECT goal_id FROM goal_todos WHERE todo_id = ? AND is_primary = 1 AND goal_id <> ?').get(todoId, goalId) as { goal_id: string } | undefined
    : undefined
  if (existingPrimary) throw new Error(`todo already has a primary goal: ${todoId}`)
  const existing = db.prepare('SELECT * FROM goal_todos WHERE goal_id = ? AND todo_id = ?').get(goalId, todoId) as GoalTodoLink | undefined
  if (existing) {
    if (existing.relation !== (options.relation ?? existing.relation) || existing.is_primary !== (options.is_primary ? 1 : existing.is_primary)) {
      db.prepare('UPDATE goal_todos SET relation = ?, is_primary = ? WHERE goal_id = ? AND todo_id = ?').run(options.relation ?? existing.relation, options.is_primary ? 1 : existing.is_primary, goalId, todoId)
    }
    return db.prepare('SELECT * FROM goal_todos WHERE goal_id = ? AND todo_id = ?').get(goalId, todoId) as GoalTodoLink
  }
  const row: GoalTodoLink = { goal_id: goalId, todo_id: todoId, relation: options.relation ?? 'support', is_primary: options.is_primary ? 1 : 0, created_at: now() }
  db.prepare('INSERT INTO goal_todos(goal_id, todo_id, relation, is_primary, created_at) VALUES(?,?,?,?,?)').run(row.goal_id, row.todo_id, row.relation, row.is_primary, row.created_at)
  return row
}

export function unlinkGoalTodo(db: DB, goalId: string, todoId: string): boolean {
  const changed = db.prepare('DELETE FROM goal_todos WHERE goal_id = ? AND todo_id = ?').run(goalId, todoId)
  if (Number(changed.changes) > 0) {
    db.prepare('UPDATE goals SET next_todo_id = NULL, updated_at = ? WHERE id = ? AND next_todo_id = ?').run(now(), goalId, todoId)
  }
  return Number(changed.changes) > 0
}

export function setGoalNextTodo(db: DB, goalId: string, todoId: string): Goal | null {
  const pair = goalAndTodo(db, goalId, todoId)
  if (!pair || !['pending', 'in_progress'].includes(pair.todo.status)) throw new Error('next todo must be an open todo in the same scope')
  linkGoalTodo(db, goalId, todoId)
  db.prepare("UPDATE goal_todos SET relation = CASE WHEN todo_id = ? THEN 'next' ELSE 'support' END WHERE goal_id = ?").run(todoId, goalId)
  db.prepare('UPDATE goals SET next_todo_id = ?, updated_at = ? WHERE id = ?').run(todoId, now(), goalId)
  return getGoal(db, goalId) ?? null
}

export function clearGoalNextTodo(db: DB, goalId: string): Goal | null {
  db.prepare("UPDATE goal_todos SET relation = 'support' WHERE goal_id = ? AND relation = 'next'").run(goalId)
  db.prepare('UPDATE goals SET next_todo_id = NULL, updated_at = ? WHERE id = ?').run(now(), goalId)
  return getGoal(db, goalId) ?? null
}

export function listGoalMilestoneLinks(db: DB, goalId: string): GoalMilestoneLink[] {
  return db.prepare('SELECT * FROM goal_milestones WHERE goal_id = ? ORDER BY position ASC, created_at ASC, milestone_id ASC').all(goalId) as GoalMilestoneLink[]
}

export function listGoalMilestones(db: DB, goalId: string): Milestone[] {
  return db.prepare(
    `SELECT m.* FROM milestones m JOIN goal_milestones gm ON gm.milestone_id = m.id
     WHERE gm.goal_id = ? ORDER BY gm.position ASC, gm.created_at ASC, m.id ASC`,
  ).all(goalId) as Milestone[]
}

export function linkGoalMilestone(db: DB, goalId: string, milestoneId: string, position = 0): GoalMilestoneLink {
  const pair = db.prepare(
    `SELECT g.scope_key AS goal_scope, m.scope_key AS milestone_scope
     FROM goals g JOIN milestones m ON m.id = ? WHERE g.id = ?`,
  ).get(milestoneId, goalId) as { goal_scope: string; milestone_scope: string } | undefined
  if (!pair || pair.goal_scope !== pair.milestone_scope) throw new Error('goal and milestone must exist in the same scope')
  const existing = db.prepare('SELECT * FROM goal_milestones WHERE goal_id = ? AND milestone_id = ?').get(goalId, milestoneId) as GoalMilestoneLink | undefined
  if (existing) return existing
  const row: GoalMilestoneLink = { goal_id: goalId, milestone_id: milestoneId, position: Math.max(0, Math.round(position)), created_at: now() }
  db.prepare('INSERT INTO goal_milestones(goal_id, milestone_id, position, created_at) VALUES(?,?,?,?)').run(row.goal_id, row.milestone_id, row.position, row.created_at)
  return row
}

export function unlinkGoalMilestone(db: DB, goalId: string, milestoneId: string): boolean {
  const changed = db.prepare('DELETE FROM goal_milestones WHERE goal_id = ? AND milestone_id = ?').run(goalId, milestoneId)
  return Number(changed.changes) > 0
}

export interface AddGoalEvidenceInput {
  goal_id: string
  source_scope_key: string
  session_id?: string | null
  turn_seq?: number | null
  source_kind: GoalEvidenceSourceKind
  relation: GoalEvidenceRelation
  excerpt?: string | null
  occurred_at?: number
  source_fingerprint: string
}

export function addGoalEvidence(db: DB, data: AddGoalEvidenceInput): { row: GoalEvidence; created: boolean } {
  const fingerprint = data.source_fingerprint.trim()
  if (!fingerprint) throw new Error('goal evidence requires source_fingerprint')
  const existing = db.prepare('SELECT * FROM goal_evidence WHERE source_fingerprint = ?').get(fingerprint) as GoalEvidence | undefined
  if (existing) {
    if (existing.goal_id !== data.goal_id) throw new Error(`goal evidence fingerprint conflict: ${fingerprint}`)
    return { row: existing, created: false }
  }
  const row: GoalEvidence = {
    id: genId(), goal_id: data.goal_id, source_scope_key: data.source_scope_key,
    session_id: data.session_id ?? null, turn_seq: Number.isInteger(data.turn_seq) ? data.turn_seq as number : null,
    source_kind: data.source_kind, relation: data.relation, excerpt: normalizeEvidenceExcerpt(data.excerpt),
    occurred_at: data.occurred_at ?? now(), source_fingerprint: fingerprint,
  }
  const inserted = db.prepare(
    `INSERT OR IGNORE INTO goal_evidence(
       id, goal_id, source_scope_key, session_id, turn_seq, source_kind,
       relation, excerpt, occurred_at, source_fingerprint
     ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(row.id, row.goal_id, row.source_scope_key, row.session_id, row.turn_seq, row.source_kind, row.relation, row.excerpt, row.occurred_at, row.source_fingerprint)
  if (Number(inserted.changes) > 0) return { row, created: true }
  const concurrent = db.prepare('SELECT * FROM goal_evidence WHERE source_fingerprint = ?').get(fingerprint) as GoalEvidence
  if (concurrent.goal_id !== data.goal_id) throw new Error(`goal evidence fingerprint conflict: ${fingerprint}`)
  return { row: concurrent, created: false }
}

export function listGoalEvidence(db: DB, goalId: string): GoalEvidence[] {
  return db.prepare('SELECT * FROM goal_evidence WHERE goal_id = ? ORDER BY occurred_at ASC, rowid ASC').all(goalId) as GoalEvidence[]
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
  data: {
    kind: EventKind
    summary: string
    detail?: string | null
    session_id?: string | null
    source?: Source | null
    occurred_at?: number
    scope_key: string
    subject_type?: HistorySubjectType | null
    subject_id?: string | null
    subject_title?: string | null
    related_subject_type?: HistorySubjectType | null
    related_subject_id?: string | null
    related_subject_title?: string | null
    change?: TimelineEvent['change']
  },
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
    subject_type: data.subject_type ?? null,
    subject_id: data.subject_id ?? null,
    subject_title: data.subject_title ?? null,
    related_subject_type: data.related_subject_type ?? null,
    related_subject_id: data.related_subject_id ?? null,
    related_subject_title: data.related_subject_title ?? null,
    change: data.change ?? null,
  }
  db.prepare(
    `INSERT INTO events(
       id, kind, summary, detail, session_id, source, occurred_at, scope_key,
       subject_type, subject_id, subject_title,
       related_subject_type, related_subject_id, related_subject_title, change_json
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    row.id, row.kind, row.summary, row.detail, row.session_id, row.source, row.occurred_at, row.scope_key,
    row.subject_type, row.subject_id, row.subject_title,
    row.related_subject_type, row.related_subject_id, row.related_subject_title,
    row.change ? JSON.stringify(row.change) : null,
  )
  return row
}

type StoredTimelineEvent = Omit<TimelineEvent, 'change'> & { change_json?: string | null }

function timelineEvent(row: StoredTimelineEvent): TimelineEvent {
  let change: TimelineEvent['change'] = null
  if (row.change_json) {
    try { change = JSON.parse(row.change_json) as NonNullable<TimelineEvent['change']> } catch { change = null }
  }
  const { change_json: _changeJson, ...event } = row
  return { ...event, change }
}

export function listEvents(db: DB, scopeKey: string, limit = 50): TimelineEvent[] {
  // rowid DESC breaks same-millisecond ties (occurred_at is ms-precision, so
  // two events created in one tick have equal keys and SQLite does not
  // guarantee their order — this made the timeline flaky across platforms).
  return (db
    .prepare('SELECT * FROM events WHERE scope_key = ? ORDER BY occurred_at DESC, rowid DESC LIMIT ?')
    .all(scopeKey, limit) as StoredTimelineEvent[]).map(timelineEvent)
}

/** Events within [fromMs, toMs) — the day ledger's data source (local day bounds). */
export function listEventsBetween(db: DB, scopeKey: string, fromMs: number, toMs: number): TimelineEvent[] {
  return (db
    .prepare('SELECT * FROM events WHERE scope_key = ? AND occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at DESC, rowid DESC')
    .all(scopeKey, fromMs, toMs) as StoredTimelineEvent[]).map(timelineEvent)
}

function eventKindClause(kinds: readonly string[]): { sql: string; params: string[] } {
  if (kinds.length === 0) return { sql: '1 = 0', params: [] }
  return { sql: `kind IN (${kinds.map(() => '?').join(',')})`, params: [...kinds] }
}

/** Stable history snapshot query; openedAt prevents newly arriving rows from shifting pagination. */
export function listEventsUntil(
  db: DB,
  scopeKey: string,
  openedAt: number,
  limit: number,
  kinds: readonly string[],
  fromAt?: number,
  toAt?: number,
): TimelineEvent[] {
  const clause = eventKindClause(kinds)
  const bounds = ['scope_key = ?', 'occurred_at <= ?']
  const params: Array<string | number> = [scopeKey, openedAt]
  if (fromAt !== undefined) {
    bounds.push('occurred_at >= ?')
    params.push(fromAt)
  }
  if (toAt !== undefined) {
    bounds.push('occurred_at < ?')
    params.push(toAt)
  }
  return (db.prepare(
    `SELECT * FROM events
     WHERE ${bounds.join(' AND ')} AND ${clause.sql}
     ORDER BY occurred_at DESC, rowid DESC LIMIT ?`,
  ).all(...params, ...clause.params, limit) as StoredTimelineEvent[]).map(timelineEvent)
}

export function listEventsForSubject(
  db: DB,
  scopeKey: string,
  subjectType: HistorySubjectType,
  subjectId: string,
  openedAt: number,
  limit: number,
  kinds: readonly string[],
  fromAt?: number,
  toAt?: number,
): TimelineEvent[] {
  const clause = eventKindClause(kinds)
  const bounds = ['scope_key = ?', 'subject_type = ?', 'subject_id = ?', 'occurred_at <= ?']
  const params: Array<string | number> = [scopeKey, subjectType, subjectId, openedAt]
  if (fromAt !== undefined) {
    bounds.push('occurred_at >= ?')
    params.push(fromAt)
  }
  if (toAt !== undefined) {
    bounds.push('occurred_at < ?')
    params.push(toAt)
  }
  return (db.prepare(
    `SELECT * FROM events
     WHERE ${bounds.join(' AND ')} AND ${clause.sql}
     ORDER BY occurred_at DESC, rowid DESC LIMIT ?`,
  ).all(...params, ...clause.params, limit) as StoredTimelineEvent[]).map(timelineEvent)
}

export function listEventSubjectStats(
  db: DB,
  scopeKey: string,
  openedAt: number,
  kinds: readonly string[],
  fromAt?: number,
  toAt?: number,
): HistorySubjectStats[] {
  const clause = eventKindClause(kinds)
  const bounds = ['scope_key = ?', 'subject_type IS NOT NULL', 'subject_id IS NOT NULL', 'occurred_at <= ?']
  const params: Array<string | number> = [scopeKey, openedAt]
  if (fromAt !== undefined) {
    bounds.push('occurred_at >= ?')
    params.push(fromAt)
  }
  if (toAt !== undefined) {
    bounds.push('occurred_at < ?')
    params.push(toAt)
  }
  return db.prepare(
    `SELECT subject_type, subject_id, COUNT(*) AS change_count, MAX(occurred_at) AS last_changed_at
     FROM events
     WHERE ${bounds.join(' AND ')} AND ${clause.sql}
     GROUP BY subject_type, subject_id`,
  ).all(...params, ...clause.params) as HistorySubjectStats[]
}

export function listLatestEventsBySubject(
  db: DB,
  scopeKey: string,
  openedAt: number,
  kinds: readonly string[],
  fromAt?: number,
  toAt?: number,
): TimelineEvent[] {
  const clause = eventKindClause(kinds)
  const bounds = ['scope_key = ?', 'subject_type IS NOT NULL', 'subject_id IS NOT NULL', 'occurred_at <= ?']
  const params: Array<string | number> = [scopeKey, openedAt]
  if (fromAt !== undefined) {
    bounds.push('occurred_at >= ?')
    params.push(fromAt)
  }
  if (toAt !== undefined) {
    bounds.push('occurred_at < ?')
    params.push(toAt)
  }
  return (db.prepare(
    `WITH ranked AS (
       SELECT events.*,
         ROW_NUMBER() OVER (
           PARTITION BY subject_type, subject_id
           ORDER BY occurred_at DESC, rowid DESC
         ) AS subject_rank
        FROM events
        WHERE ${bounds.join(' AND ')} AND ${clause.sql}
      )
      SELECT * FROM ranked WHERE subject_rank = 1`,
   ).all(...params, ...clause.params) as Array<StoredTimelineEvent & { subject_rank: number }>).map((row) => {
    const { subject_rank: _rank, ...event } = row
    return timelineEvent(event)
  })
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
    seen_at: null,
    handled_at: null,
    scope_key: data.scope_key,
  }
  db.prepare(
    `INSERT INTO notifications(id, kind, title, body, todo_id, scope_cwd, created_at, seen_at, handled_at, scope_key)
     VALUES(?,?,?,?,?,?,?,NULL,NULL,?)`,
  ).run(row.id, row.kind, row.title, row.body, row.todo_id, row.scope_cwd, row.created_at, row.scope_key)
  return row
}

export function listNotifications(db: DB, scopeKey: string, limit = 20): Notification[] {
  return db
    .prepare('SELECT * FROM notifications WHERE scope_key = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(scopeKey, limit) as Notification[]
}

/** Stable snapshot page source. The UI aggregates workspaces and applies its opaque offset cursor. */
export function listNotificationsUntil(db: DB, scopeKey: string, openedAt: number, limit: number): Notification[] {
  return db
    .prepare('SELECT * FROM notifications WHERE scope_key = ? AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(scopeKey, openedAt, limit) as Notification[]
}

export function listUnhandledNotifications(db: DB, scopeKey: string): Notification[] {
  return db
    .prepare('SELECT * FROM notifications WHERE scope_key = ? AND handled_at IS NULL ORDER BY created_at ASC')
    .all(scopeKey) as Notification[]
}

/** Bounded newest open reminders for the lightweight badge/popup feed. */
export function listRecentUnhandledReminders(db: DB, scopeKey: string, limit = 5): Notification[] {
  return db
    .prepare("SELECT * FROM notifications WHERE scope_key = ? AND kind = 'reminder' AND handled_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(scopeKey, limit) as Notification[]
}

/** Count-only badge query; avoids materializing notification rows every poll. */
export function countUnhandledNotifications(db: DB, scopeKey: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM notifications WHERE scope_key = ? AND handled_at IS NULL')
    .get(scopeKey) as { count: number }
  return row.count
}

/** Count notification deliveries the user has not viewed yet. */
export function countUnseenNotifications(db: DB, scopeKey: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM notifications WHERE scope_key = ? AND seen_at IS NULL')
    .get(scopeKey) as { count: number }
  return row.count
}

/** Bounded newest unseen deliveries for the lightweight popup feed. */
export function listRecentUnseenNotifications(db: DB, scopeKey: string, limit = 5): Notification[] {
  return db
    .prepare('SELECT * FROM notifications WHERE scope_key = ? AND seen_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(scopeKey, limit) as Notification[]
}

/** Mark one delivery as viewed; returns whether this call changed the row. */
export function markNotificationSeen(db: DB, scopeKey: string, id: string, seenAt = now()): boolean {
  const result = db.prepare(
    'UPDATE notifications SET seen_at = ? WHERE scope_key = ? AND id = ? AND seen_at IS NULL',
  ).run(seenAt, scopeKey, id)
  return Number(result.changes) > 0
}

/** Mark the stable notification-log baseline as viewed. Newer arrivals remain unseen. */
export function markNotificationsSeenThrough(db: DB, scopeKey: string, openedAt: number): number {
  const result = db.prepare(
    'UPDATE notifications SET seen_at = ? WHERE scope_key = ? AND seen_at IS NULL AND created_at <= ?',
  ).run(now(), scopeKey, openedAt)
  return Number(result.changes)
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
  let t = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo | undefined
  if (!t) return null
  if (t.record_status === 'merged') {
    // A merged row is immutable historical identity. In particular, reopening
    // it would recreate the duplicate. Other actions may safely follow the old
    // id to the canonical item.
    if (action === 'reopen') return t
    t = resolveCanonicalTodo(db, t.id)
    if (!t || t.record_status !== 'canonical') return null
    id = t.id
  } else if (t.record_status !== 'canonical') {
    return t
  }
  if (action !== 'reopen' && (t.status === 'done' || t.status === 'cancelled')) return t
  const ts = now()
  const session_id = args?.session_id ?? null
  // no session ⇒ the panel/UI entrance; the badge reads 看板操作 instead of 早期记录
  const source = session_id ? null : ('manual' as const)
  switch (action) {
    case 'start':
      if (t.status === 'in_progress') return t
      db.prepare('UPDATE todos SET status = ?, updated_at = ? WHERE id = ?').run('in_progress', ts, id)
      addEvent(db, {
        kind: 'todo_started', summary: `开始：${t.title}`, scope_key: t.scope_key, occurred_at: ts, session_id, source,
        subject_type: 'todo', subject_id: id, subject_title: t.title,
        change: { status: { before: t.status, after: 'in_progress' } },
      })
      break
    case 'complete':
      setTodoStatus(db, id, 'done')
      clearGoalNextForTodo(db, id, ts, session_id, source)
      // v0.3.2 feedback: a completed commitment is a "good" signal (P/B1)
      db.prepare('UPDATE todos SET good_count = COALESCE(good_count,0) + 1, updated_at = ?, completed_at = ? WHERE id = ?').run(ts, ts, id)
      addEvent(db, {
        kind: 'todo_completed', summary: `完成：${t.title}`, scope_key: t.scope_key, occurred_at: ts, session_id, source,
        subject_type: 'todo', subject_id: id, subject_title: t.title,
        change: { status: { before: t.status, after: 'done' } },
      })
      break
    case 'reopen':
      if (t.status !== 'done' && t.status !== 'cancelled') return t
      db.prepare("UPDATE todos SET status = 'pending', completed_at = NULL, last_reminded_at = NULL, updated_at = ? WHERE id = ?").run(ts, id)
      syncTodoFts(db, id, t.title, t.detail ?? null)
      addEvent(db, {
        kind: 'todo_reopened',
        summary: t.status === 'cancelled' ? `重新打开：${t.title}` : `撤销完成：${t.title}`,
        scope_key: t.scope_key,
        occurred_at: ts,
        session_id,
        source,
        subject_type: 'todo',
        subject_id: id,
        subject_title: t.title,
        change: { status: { before: t.status, after: 'pending' } },
      })
      break
    case 'cancel':
      setTodoStatus(db, id, 'cancelled')
      clearGoalNextForTodo(db, id, ts, session_id, source)
      // v0.3.2 feedback: a cancelled commitment is a "stale" signal — it was
      // tracked but did not materialize (P/B1)
      db.prepare('UPDATE todos SET stale_count = COALESCE(stale_count,0) + 1, updated_at = ? WHERE id = ?').run(ts, id)
      addEvent(db, {
        kind: 'todo_cancelled', summary: `取消：${t.title}`, scope_key: t.scope_key, occurred_at: ts, session_id, source,
        subject_type: 'todo', subject_id: id, subject_title: t.title,
        change: { status: { before: t.status, after: 'cancelled' } },
      })
      break
    case 'postpone': {
      if (!args?.due_at) return t
      if (t.due_at === args.due_at) return t
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
        subject_type: 'todo',
        subject_id: id,
        subject_title: t.title,
        change: { due_at: { before: t.due_at ?? null, after: args.due_at } },
      })
      break
    }
    case 'remind_again':
      db.prepare('UPDATE todos SET last_reminded_at = NULL, updated_at = ? WHERE id = ?').run(ts, id)
      addEvent(db, {
        kind: 'todo_remind_again', summary: `再次提醒：「${t.title}」`, scope_key: t.scope_key, occurred_at: ts, session_id, source,
        subject_type: 'todo', subject_id: id, subject_title: t.title,
      })
      break
  }
  markTodoNotificationsHandled(db, id)
  return db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo
}

const PRIORITY_RANK: Record<Priority, number> = { low: 0, medium: 1, high: 2, urgent: 3 }

/** Consolidate outcome: the surviving target row, or why the merge was refused. */
export type TodoConsolidateResult =
  | { ok: true; target: Todo; merge: TodoMergeRecord }
  | { ok: false; kind: 'not-found' | 'same-item' | 'terminal'; error: string }

export type TodoConsolidationUndoResult =
  | { ok: true; source: Todo; target: Todo; merge: TodoMergeRecord; target_restore_status: 'applied' | 'conflict' }
  | { ok: false; kind: 'not-found' | 'conflict'; error: string }

type MergeTodoSnapshot = Pick<Todo, 'id' | 'title' | 'detail' | 'status' | 'priority' | 'due_at' | 'milestone_id' | 'record_status' | 'merged_into_id'>

function mergeSnapshot(todo: Todo): MergeTodoSnapshot {
  return {
    id: todo.id,
    title: todo.title,
    detail: todo.detail ?? null,
    status: todo.status,
    priority: todo.priority ?? null,
    due_at: todo.due_at ?? null,
    milestone_id: todo.milestone_id ?? null,
    record_status: todo.record_status ?? 'canonical',
    merged_into_id: todo.merged_into_id ?? null,
  }
}

function readStringIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/**
 * Merge a duplicate todo (source) into its keeper (target) — M9 P35, one
 * audited atomic action instead of implicit dedup magic. Deterministic rules:
 * target absorbs source's due_at (only when its own is empty) and the higher
 * priority, its detail records the merge; source keeps its business status but
 * becomes a merged historical record (FTS drop), and its unhandled reminder
 * cards are settled. One todo_consolidated event
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
  if (source.record_status !== 'canonical' || target.record_status !== 'canonical') {
    return { ok: false, kind: 'terminal', error: 'consolidate requires both todos to be canonical records' }
  }
  if (db.prepare("SELECT 1 FROM todo_merge_log WHERE target_id = ? AND status = 'active' LIMIT 1").get(source.id)) {
    return { ok: false, kind: 'terminal', error: 'undo active child merges before merging this keeper' }
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
  const notificationIds = (db.prepare(
    "SELECT id FROM notifications WHERE todo_id = ? AND handled_at IS NULL ORDER BY created_at ASC, id ASC",
  ).all(source.id) as Array<{ id: string }>).map((row) => row.id)
  const reminderIds = (db.prepare(
    'SELECT id FROM pending_reminders WHERE todo_id = ? ORDER BY fire_at ASC, id ASC',
  ).all(source.id) as Array<{ id: string }>).map((row) => row.id)
  const mergeId = genId()
  const sourceSnapshot = mergeSnapshot(source)
  const targetBefore = mergeSnapshot(target)
  db.prepare('UPDATE todos SET detail = ?, due_at = ?, priority = ?, updated_at = ? WHERE id = ?').run(
    mergedDetail,
    due,
    pri,
    ts,
    target.id,
  )
  if (target.status === 'pending' || target.status === 'in_progress') syncTodoFts(db, target.id, target.title, mergedDetail)
  else db.prepare("DELETE FROM yolo_fts WHERE row_type = 'todo' AND row_id = ?").run(target.id)
  db.prepare(
    "UPDATE todos SET record_status = 'merged', merged_into_id = ?, updated_at = ? WHERE id = ? AND record_status = 'canonical'",
  ).run(target.id, ts, source.id)
  db.prepare("DELETE FROM yolo_fts WHERE row_type = 'todo' AND row_id = ?").run(source.id)
  if (notificationIds.length > 0) {
    db.prepare("UPDATE notifications SET todo_id = ? WHERE todo_id = ? AND handled_at IS NULL").run(target.id, source.id)
  }
  if (reminderIds.length > 0) db.prepare('UPDATE pending_reminders SET todo_id = ? WHERE todo_id = ?').run(target.id, source.id)
  const mergedTarget = db.prepare('SELECT * FROM todos WHERE id = ?').get(target.id) as Todo
  db.prepare(
    `INSERT INTO todo_merge_log(
       id,scope_key,source_id,target_id,source_snapshot_json,target_before_json,target_after_json,
       notification_ids_json,reminder_ids_json,status,created_at,undone_at
     ) VALUES(?,?,?,?,?,?,?,?,?,'active',?,NULL)`,
  ).run(
    mergeId, target.scope_key, source.id, target.id,
    JSON.stringify(sourceSnapshot), JSON.stringify(targetBefore), JSON.stringify(mergeSnapshot(mergedTarget)),
    JSON.stringify(notificationIds), JSON.stringify(reminderIds), ts,
  )
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
    subject_type: 'todo',
    subject_id: source.id,
    subject_title: source.title,
    related_subject_type: 'todo',
    related_subject_id: target.id,
    related_subject_title: target.title,
    change: { record_status: { before: 'canonical', after: 'merged' } },
  })
  return {
    ok: true,
    target: mergedTarget,
    merge: db.prepare('SELECT * FROM todo_merge_log WHERE id = ?').get(mergeId) as TodoMergeRecord,
  }
}

/** Undo one active R3 merge. Relation rows created before the merge return to
 * the source. Target fields are restored only when they still equal the merge
 * result, so a later user edit is never overwritten. Old audit events remain. */
export function undoTodoConsolidation(
  db: DB,
  mergeId: string,
  sessionId?: string | null,
  scopeKey?: string,
): TodoConsolidationUndoResult {
  const merge = db.prepare(
    "SELECT * FROM todo_merge_log WHERE id = ? AND status = 'active'",
  ).get(mergeId) as TodoMergeRecord | undefined
  if (!merge || (scopeKey && merge.scope_key !== scopeKey)) {
    return { ok: false, kind: 'not-found', error: 'active todo merge not found' }
  }
  const source = db.prepare('SELECT * FROM todos WHERE id = ?').get(merge.source_id) as Todo | undefined
  const target = db.prepare('SELECT * FROM todos WHERE id = ?').get(merge.target_id) as Todo | undefined
  if (!source || !target) return { ok: false, kind: 'not-found', error: 'merged todo record not found' }
  if (source.record_status !== 'merged' || source.merged_into_id !== target.id) {
    return { ok: false, kind: 'conflict', error: 'todo merge relation has changed' }
  }
  const sourceBefore = JSON.parse(merge.source_snapshot_json) as MergeTodoSnapshot
  const targetBefore = JSON.parse(merge.target_before_json) as MergeTodoSnapshot
  const targetAfter = JSON.parse(merge.target_after_json) as MergeTodoSnapshot
  const targetUnchanged = target.detail === targetAfter.detail
    && target.due_at === targetAfter.due_at
    && target.priority === targetAfter.priority
    && target.milestone_id === targetAfter.milestone_id
    && target.status === targetAfter.status
    && target.title === targetAfter.title
  const ts = now()
  db.prepare(
    `UPDATE todos SET record_status = ?, merged_into_id = ?, updated_at = ? WHERE id = ?`,
  ).run(sourceBefore.record_status ?? 'canonical', sourceBefore.merged_into_id ?? null, ts, source.id)
  if (targetUnchanged) {
    db.prepare(
      `UPDATE todos SET title=?,detail=?,status=?,priority=?,due_at=?,milestone_id=?,updated_at=? WHERE id=?`,
    ).run(
      targetBefore.title, targetBefore.detail ?? null, targetBefore.status, targetBefore.priority ?? null,
      targetBefore.due_at ?? null, targetBefore.milestone_id ?? null, ts, target.id,
    )
  }
  for (const id of readStringIds(merge.notification_ids_json)) {
    db.prepare('UPDATE notifications SET todo_id = ? WHERE id = ? AND todo_id = ?').run(source.id, id, target.id)
  }
  for (const id of readStringIds(merge.reminder_ids_json)) {
    db.prepare('UPDATE pending_reminders SET todo_id = ? WHERE id = ? AND todo_id = ?').run(source.id, id, target.id)
  }
  const restoredSource = db.prepare('SELECT * FROM todos WHERE id = ?').get(source.id) as Todo
  const restoredTarget = db.prepare('SELECT * FROM todos WHERE id = ?').get(target.id) as Todo
  if (restoredSource.status === 'pending' || restoredSource.status === 'in_progress') {
    syncTodoFts(db, restoredSource.id, restoredSource.title, restoredSource.detail ?? null)
  } else db.prepare("DELETE FROM yolo_fts WHERE row_type='todo' AND row_id=?").run(restoredSource.id)
  if (restoredTarget.status === 'pending' || restoredTarget.status === 'in_progress') {
    syncTodoFts(db, restoredTarget.id, restoredTarget.title, restoredTarget.detail ?? null)
  } else db.prepare("DELETE FROM yolo_fts WHERE row_type='todo' AND row_id=?").run(restoredTarget.id)
  db.prepare("UPDATE todo_merge_log SET status='undone', undone_at=? WHERE id=? AND status='active'").run(ts, merge.id)
  addEvent(db, {
    kind: 'todo_consolidation_undone',
    summary: `撤销合并：「${source.title}」←「${target.title}」`,
    detail: targetUnchanged ? '已恢复合并前字段与关联。' : '已恢复事项关系；保留合并后的用户编辑。',
    scope_key: merge.scope_key,
    occurred_at: ts,
    session_id: sessionId ?? null,
    source: sessionId ? null : 'manual',
    subject_type: 'todo',
    subject_id: source.id,
    subject_title: source.title,
    related_subject_type: 'todo',
    related_subject_id: target.id,
    related_subject_title: target.title,
    change: { record_status: { before: 'merged', after: sourceBefore.record_status ?? 'canonical' } },
  })
  return {
    ok: true,
    source: restoredSource,
    target: restoredTarget,
    merge: db.prepare('SELECT * FROM todo_merge_log WHERE id = ?').get(merge.id) as TodoMergeRecord,
    target_restore_status: targetUnchanged ? 'applied' : 'conflict',
  }
}

export function findActiveTodoMerge(db: DB, sourceId: string): TodoMergeRecord | undefined {
  return db.prepare(
    "SELECT * FROM todo_merge_log WHERE source_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
  ).get(sourceId) as TodoMergeRecord | undefined
}

/** Inline-edit a todo's plan fields (v0.3.0 E). Only provided fields change;
 * title edits resync FTS; every change writes a todo_updated audit event.
 * Goal progress is deliberately NOT editable here (D14: no fake progress). */
export function applyTodoUpdate(
  db: DB,
  id: string,
  patch: { title?: string; detail?: string | null; due_at?: string | null; priority?: Priority | null; milestone_id?: string | null },
  sessionId?: string | null,
): Todo | null {
  let t = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo | undefined
  if (!t) return null
  if (t.record_status === 'merged') t = resolveCanonicalTodo(db, t.id)
  if (!t || t.record_status !== 'canonical') return null
  id = t.id
  const title = patch.title?.trim() ? patch.title.trim() : t.title
  const detail = patch.detail !== undefined ? patch.detail : t.detail
  const due = patch.due_at !== undefined ? patch.due_at : t.due_at
  const pri = patch.priority !== undefined ? patch.priority : t.priority
  const ms = patch.milestone_id !== undefined ? patch.milestone_id : t.milestone_id
  const ts = now()
  db.prepare('UPDATE todos SET title = ?, detail = ?, due_at = ?, priority = ?, milestone_id = ?, updated_at = ? WHERE id = ?').run(title, detail, due, pri, ms, ts, id)
  syncTodoFts(db, id, title, detail ?? null)
  const changes: string[] = []
  const change: NonNullable<TimelineEvent['change']> = {}
  if (title !== t.title) { changes.push(`标题「${t.title}」→「${title}」`); change.title = { before: t.title, after: title } }
  if (detail !== t.detail) { changes.push('备注已更新'); change.detail = { before: t.detail ?? null, after: detail ?? null } }
  if (due !== t.due_at) { changes.push(`截止 ${t.due_at ?? '无'} → ${due ?? '无'}`); change.due_at = { before: t.due_at ?? null, after: due ?? null } }
  if (pri !== t.priority) { changes.push(`优先级 ${t.priority ?? '无'} → ${pri ?? '无'}`); change.priority = { before: t.priority ?? null, after: pri ?? null } }
  if (ms !== t.milestone_id) change.milestone_id = { before: t.milestone_id ?? null, after: ms ?? null }
  addEvent(db, {
    kind: 'todo_updated',
    summary: `更新「${title}」${changes.length ? `（${changes.join('；')}）` : ''}`,
    scope_key: t.scope_key,
    occurred_at: ts,
    session_id: sessionId ?? null,
    source: 'manual',
    subject_type: 'todo',
    subject_id: id,
    subject_title: t.title,
    change,
  })
  return db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo
}

/** Set goal progress with a timeline event; 100% never infers achievement. */
export function applyGoalProgress(db: DB, id: string, progress: number, note?: string | null, sessionId?: string | null): Goal | null {
  const g = db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as Goal | undefined
  if (!g) return null
  const clamped = Math.max(0, Math.min(100, Math.round(progress)))
  setGoalProgress(db, id, clamped, note, 'user_claimed')
  addEvent(db, {
    kind: 'goal_progress',
    summary: `目标「${g.title}」进度 ${clamped}%`,
    detail: note ?? null,
    scope_key: g.scope_key,
    session_id: sessionId ?? null,
    source: sessionId ? null : 'manual',
    subject_type: 'goal',
    subject_id: id,
    subject_title: g.title,
    change: {
      progress: { before: g.progress, after: clamped },
      ...(note !== undefined ? { progress_note: { before: g.progress_note ?? null, after: note } } : {}),
      progress_source: { before: g.progress_source ?? 'none', after: 'user_claimed' },
    },
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
    subject_type: 'milestone',
    subject_id: id,
    subject_title: m.title,
    change: { status: { before: m.status, after: status } },
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
    kind: 'milestone_updated',
    summary: `里程碑改名「${m.title}」→「${t}」`,
    scope_key: m.scope_key,
    session_id: sessionId ?? null,
    source: 'manual',
    subject_type: 'milestone',
    subject_id: id,
    subject_title: m.title,
    change: { title: { before: m.title, after: t } },
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
    kind: 'goal_updated',
    summary: `目标改名「${g.title}」→「${t}」`,
    scope_key: g.scope_key,
    session_id: sessionId ?? null,
    source: 'manual',
    subject_type: 'goal',
    subject_id: id,
    subject_title: g.title,
    change: { title: { before: g.title, after: t } },
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
    subject_type: 'goal',
    subject_id: id,
    subject_title: g.title,
    change: { status: { before: g.status, after: 'abandoned' } },
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

// ---------- todo identity shadow resolver ----------

export function logTodoResolution(
  db: DB,
  data: Omit<TodoResolutionLog, 'id' | 'created_at'>,
): void {
  db.prepare(
    `INSERT INTO todo_resolution_log(
       scope_key, session_id, turn_seq, operation_id, input_fingerprint, input_excerpt,
       resolver_version, model_provider, model_name, status, error,
       candidates_json, resolutions_json, application_json, token_in, token_out, duration_ms, created_at
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(session_id, turn_seq, resolver_version) DO NOTHING`,
  ).run(
    data.scope_key,
    data.session_id,
    data.turn_seq,
    data.operation_id,
    data.input_fingerprint,
    data.input_excerpt,
    data.resolver_version,
    data.model_provider,
    data.model_name,
    data.status,
    data.error ?? null,
    data.candidates_json,
    data.resolutions_json,
    data.application_json ?? null,
    data.token_in ?? null,
    data.token_out ?? null,
    data.duration_ms ?? null,
    now(),
  )
}

export function listTodoResolutions(db: DB, scopeKey: string, limit = 100): TodoResolutionLog[] {
  return db.prepare(
    `SELECT * FROM todo_resolution_log
     WHERE scope_key = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).all(scopeKey, limit) as TodoResolutionLog[]
}

interface AppliedTodoIdentityJson {
  plan?: {
    decision?: unknown
    confidence?: unknown
    reason?: unknown
  }
  status?: unknown
  todo_id?: unknown
  evidence_id?: unknown
  due_before?: unknown
  due_after?: unknown
}

function parseAppliedTodoIdentity(text: string | null | undefined): AppliedTodoIdentityJson | null {
  if (!text) return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value as AppliedTodoIdentityJson : null
  } catch {
    return null
  }
}

function identityFeedbackFor(db: DB, operationId: string): TodoIdentityFeedback | null {
  return db.prepare(
    'SELECT * FROM todo_identity_feedback WHERE resolution_operation_id = ?',
  ).get(operationId) as TodoIdentityFeedback | undefined ?? null
}

/** Bounded product projection of applied R2 decisions for one canonical todo. */
export function listTodoIdentityReceipts(
  db: DB,
  scopeKey: string,
  todoId: string,
  limit = 20,
): TodoIdentityReceipt[] {
  const canonical = resolveCanonicalTodo(db, todoId)
  if (!canonical || canonical.scope_key !== scopeKey) return []
  const rows = db.prepare(
    `SELECT * FROM todo_resolution_log
     WHERE scope_key = ? AND status = 'ok' AND application_json IS NOT NULL
     ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).all(scopeKey, Math.max(1, Math.min(100, limit * 4))) as TodoResolutionLog[]
  const receipts: TodoIdentityReceipt[] = []
  for (const row of rows) {
    const application = parseAppliedTodoIdentity(row.application_json)
    if (!application || application.todo_id !== canonical.id) continue
    if (application.status !== 'linked' && application.status !== 'updated' && application.status !== 'no_change') continue
    if (application.plan?.decision !== 'LINK' && application.plan?.decision !== 'UPDATE') continue
    if (typeof application.evidence_id !== 'string' || !application.evidence_id) continue
    receipts.push({
      resolution_id: row.id!,
      operation_id: row.operation_id,
      todo_id: canonical.id,
      decision: application.plan.decision,
      application_status: application.status,
      confidence: typeof application.plan.confidence === 'number' ? application.plan.confidence : null,
      reason: typeof application.plan.reason === 'string' ? application.plan.reason : null,
      input_excerpt: row.input_excerpt,
      evidence_id: application.evidence_id,
      due_before: typeof application.due_before === 'string' ? application.due_before : application.due_before === null ? null : undefined,
      due_after: typeof application.due_after === 'string' ? application.due_after : application.due_after === null ? null : undefined,
      created_at: row.created_at,
      feedback: identityFeedbackFor(db, row.operation_id),
    })
    if (receipts.length >= limit) break
  }
  return receipts
}

export type TodoIdentityRejectResult =
  | { ok: true; todo: Todo; feedback: TodoIdentityFeedback; audit_event_id?: string }
  | { ok: false; kind: 'not-found' | 'mismatch' | 'unsupported'; error: string }

/** Reject one applied R2 decision without rewriting its immutable resolver or
 * evidence rows. The feedback trigger removes that evidence from active
 * identity recall. An automatic due change is reverted only when the todo
 * still holds the exact value written by this receipt, so later user edits win. */
export function rejectTodoIdentityResolution(
  db: DB,
  scopeKey: string,
  resolutionId: number,
  todoId: string,
  reason: TodoIdentityFeedbackReason,
): TodoIdentityRejectResult {
  const resolution = db.prepare(
    'SELECT * FROM todo_resolution_log WHERE id = ? AND scope_key = ?',
  ).get(resolutionId, scopeKey) as TodoResolutionLog | undefined
  if (!resolution) return { ok: false, kind: 'not-found', error: 'identity resolution not found' }
  const application = parseAppliedTodoIdentity(resolution.application_json)
  if (!application || application.todo_id !== todoId) {
    return { ok: false, kind: 'mismatch', error: 'identity resolution does not belong to this todo' }
  }
  if (typeof application.evidence_id !== 'string' || !application.evidence_id) {
    return { ok: false, kind: 'unsupported', error: 'identity resolution has no correctable evidence receipt' }
  }
  const existing = identityFeedbackFor(db, resolution.operation_id)
  const todo = db.prepare('SELECT * FROM todos WHERE id = ? AND scope_key = ?').get(todoId, scopeKey) as Todo | undefined
  if (!todo) return { ok: false, kind: 'not-found', error: 'todo not found' }
  if (existing) return { ok: true, todo, feedback: existing }
  const evidence = db.prepare('SELECT id FROM todo_evidence WHERE id = ? AND todo_id = ?').get(application.evidence_id, todoId) as
    | { id: string }
    | undefined
  if (!evidence) return { ok: false, kind: 'mismatch', error: 'identity evidence does not belong to this todo' }

  const dueBefore = typeof application.due_before === 'string' ? application.due_before : application.due_before === null ? null : undefined
  const dueAfter = typeof application.due_after === 'string' ? application.due_after : application.due_after === null ? null : undefined
  let undoStatus: TodoIdentityFeedback['undo_status'] = 'not_needed'
  let changedTodo = todo
  if (application.status === 'updated' && dueAfter !== undefined) {
    if ((todo.due_at ?? null) === dueAfter) {
      const ts = now()
      db.prepare('UPDATE todos SET due_at = ?, last_reminded_at = NULL, updated_at = ? WHERE id = ?').run(dueBefore ?? null, ts, todo.id)
      changedTodo = db.prepare('SELECT * FROM todos WHERE id = ?').get(todo.id) as Todo
      undoStatus = 'applied'
    } else {
      undoStatus = 'conflict'
    }
  }

  const feedback: TodoIdentityFeedback = {
    id: genId(),
    resolution_operation_id: resolution.operation_id,
    scope_key: scopeKey,
    todo_id: todo.id,
    evidence_id: evidence.id,
    verdict: 'incorrect',
    reason,
    undo_status: undoStatus,
    due_before: dueBefore,
    due_after: dueAfter,
    created_at: now(),
  }
  db.prepare(
    `INSERT INTO todo_identity_feedback(
       id,resolution_operation_id,scope_key,todo_id,evidence_id,verdict,reason,undo_status,due_before,due_after,created_at
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    feedback.id, feedback.resolution_operation_id, feedback.scope_key, feedback.todo_id, feedback.evidence_id,
    feedback.verdict, feedback.reason, feedback.undo_status, feedback.due_before ?? null, feedback.due_after ?? null, feedback.created_at,
  )
  const audit = addEvent(db, {
    kind: 'todo_identity_corrected',
    summary: `纠正自动关联：「${todo.title}」`,
    detail: undoStatus === 'applied'
      ? `已撤销自动截止时间修改：${dueAfter ?? '无'} → ${dueBefore ?? '无'}`
      : undoStatus === 'conflict'
        ? '事项后来已被再次修改；保留当前截止时间，仅排除错误关联证据。'
        : '已排除本次错误关联证据。',
    scope_key: scopeKey,
    source: 'manual',
    subject_type: 'todo',
    subject_id: todo.id,
    subject_title: todo.title,
    change: undoStatus === 'applied' ? { due_at: { before: dueAfter ?? null, after: dueBefore ?? null } } : undefined,
  })
  return { ok: true, todo: changedTodo, feedback, ...(audit?.id ? { audit_event_id: audit.id } : {}) }
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
  return Number(info.changes)
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

export function todoMergeSuggestionPairKey(leftId: string, rightId: string): string {
  return leftId < rightId ? `${leftId}:${rightId}` : `${rightId}:${leftId}`
}

function parseResolverPredictions(value: string): TodoResolutionPrediction[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is TodoResolutionPrediction => Boolean(item && typeof item === 'object')) : []
  } catch {
    return []
  }
}

/** R3 combines three candidate sources without performing a write:
 * 1) model semantic LINK/UPDATE observations whose turn later produced a
 *    distinct origin todo; 2) canonical-title equality; 3) protected fuzzy
 *    title similarity for manual rows. User-dismissed pairs stay suppressed. */
export function listDuplicateTodos(db: DB, scopeKey: string): DuplicateTodoPair[] {
  const rows = db.prepare(
    `SELECT id,title,created_at FROM (
       SELECT id,title,created_at,updated_at FROM todos
       WHERE scope_key=? AND record_status='canonical'
       ORDER BY updated_at DESC,id DESC LIMIT 200
     ) recent ORDER BY created_at ASC,id ASC`,
  ).all(scopeKey) as Array<{ id: string; title: string; created_at: number }>
  const byId = new Map(rows.map((row) => [row.id, row]))
  const dismissed = new Set((db.prepare(
    "SELECT pair_key FROM todo_merge_suggestion_feedback WHERE scope_key=? AND verdict='not_duplicate'",
  ).all(scopeKey) as Array<{ pair_key: string }>).map((row) => row.pair_key))
  const candidates = new Map<string, DuplicateTodoPair>()
  const sourceRank = { exact: 3, resolver: 2, similarity: 1 } as const
  const add = (left: typeof rows[number], right: typeof rows[number], suggestion: Pick<DuplicateTodoPair, 'confidence' | 'reason' | 'source'>): void => {
    if (left.id === right.id) return
    const key = todoMergeSuggestionPairKey(left.id, right.id)
    if (dismissed.has(key)) return
    const existing = candidates.get(key)
    const incomingRank = suggestion.source ? sourceRank[suggestion.source] : 0
    const existingRank = existing?.source ? sourceRank[existing.source] : 0
    if (existing && (existing.confidence ?? 0) > (suggestion.confidence ?? 0) && existingRank >= incomingRank) return
    candidates.set(key, {
      scopeKey,
      a: left.id,
      b: right.id,
      aTitle: left.title,
      bTitle: right.title,
      ...suggestion,
    })
  }

  const byCanonical = new Map<string, typeof rows>()
  for (const row of rows) {
    const canonical = canonicalTodoTitle(row.title)
    if (!canonical) continue
    const group = byCanonical.get(canonical) ?? []
    group.push(row)
    byCanonical.set(canonical, group)
  }
  for (const group of byCanonical.values()) {
    const keeper = group[0]
    for (const duplicate of group.slice(1)) {
      add(keeper, duplicate, {
        source: 'exact', confidence: 1,
        reason: '两个标题只有大小写、标点、空格或常见同义表达的差异。',
      })
    }
  }

  for (let leftIndex = 0; leftIndex < rows.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex++) {
      const left = rows[leftIndex]!
      const right = rows[rightIndex]!
      if (canonicalTodoTitle(left.title) === canonicalTodoTitle(right.title)) continue
      const similarity = compareTodoTitles(left.title, right.title)
      if (similarity) add(left, right, { source: 'similarity', confidence: similarity.score, reason: similarity.reason })
    }
  }

  const resolverRows = db.prepare(
    `SELECT session_id,turn_seq,resolutions_json FROM todo_resolution_log
     WHERE scope_key=? AND status='ok' ORDER BY created_at DESC,id DESC LIMIT 200`,
  ).all(scopeKey) as Array<{ session_id: string; turn_seq: number; resolutions_json: string }>
  const origins = db.prepare(
    `SELECT DISTINCT evidence.todo_id FROM todo_evidence evidence
     JOIN todos ON todos.id=evidence.todo_id
     WHERE evidence.session_id=? AND evidence.turn_seq=? AND evidence.relation='origin'
       AND todos.scope_key=? AND todos.record_status='canonical'`,
  )
  for (const observation of resolverRows) {
    const predictions = parseResolverPredictions(observation.resolutions_json)
      .filter((prediction) => (prediction.decision === 'LINK' || prediction.decision === 'UPDATE')
        && (prediction.confidence ?? 0) >= 0.6 && prediction.candidate_ids.length > 0)
    if (predictions.length !== 1) continue
    const createdIds = (origins.all(observation.session_id, observation.turn_seq, scopeKey) as Array<{ todo_id: string }>)
      .map((row) => row.todo_id)
    if (createdIds.length !== 1) continue
    const created = byId.get(createdIds[0]!)
    if (!created) continue
    for (const candidateId of predictions[0]!.candidate_ids.slice(0, 3)) {
      const candidate = byId.get(candidateId)
      if (!candidate) continue
      add(candidate, created, {
        source: 'resolver',
        confidence: predictions[0]!.confidence ?? undefined,
        reason: predictions[0]!.reason
          ? `模型判断两条记录可能指向同一事项：${predictions[0]!.reason}`
          : '模型判断两条记录可能指向同一事项。',
      })
    }
  }

  return [...candidates.values()]
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0)
      || sourceRank[right.source ?? 'similarity'] - sourceRank[left.source ?? 'similarity']
      || left.a.localeCompare(right.a) || left.b.localeCompare(right.b))
    .slice(0, 30)
}

export function dismissTodoMergeSuggestion(
  db: DB,
  scopeKey: string,
  leftId: string,
  rightId: string,
  reason?: string | null,
): TodoMergeSuggestionFeedback | null {
  const left = db.prepare("SELECT id,title FROM todos WHERE id=? AND scope_key=? AND record_status='canonical'").get(leftId, scopeKey) as
    | { id: string; title: string }
    | undefined
  const right = db.prepare("SELECT id,title FROM todos WHERE id=? AND scope_key=? AND record_status='canonical'").get(rightId, scopeKey) as
    | { id: string; title: string }
    | undefined
  if (!left || !right || left.id === right.id) return null
  const [a, b] = left.id < right.id ? [left, right] : [right, left]
  const pairKey = todoMergeSuggestionPairKey(a.id, b.id)
  const existing = db.prepare('SELECT * FROM todo_merge_suggestion_feedback WHERE pair_key=?').get(pairKey) as
    | TodoMergeSuggestionFeedback
    | undefined
  if (existing) return existing
  const feedback: TodoMergeSuggestionFeedback = {
    pair_key: pairKey,
    scope_key: scopeKey,
    a_id: a.id,
    b_id: b.id,
    verdict: 'not_duplicate',
    reason: reason?.trim().slice(0, 300) || null,
    created_at: now(),
  }
  db.prepare(
    `INSERT INTO todo_merge_suggestion_feedback(pair_key,scope_key,a_id,b_id,verdict,reason,created_at)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(pair_key) DO NOTHING`,
  ).run(feedback.pair_key, feedback.scope_key, feedback.a_id, feedback.b_id, feedback.verdict, feedback.reason, feedback.created_at)
  addEvent(db, {
    kind: 'todo_merge_suggestion_dismissed',
    summary: `不是重复事项：「${left.title}」与「${right.title}」`,
    detail: feedback.reason,
    scope_key: scopeKey,
    source: 'manual',
    subject_type: 'todo', subject_id: left.id, subject_title: left.title,
    related_subject_type: 'todo', related_subject_id: right.id, related_subject_title: right.title,
  })
  return db.prepare('SELECT * FROM todo_merge_suggestion_feedback WHERE pair_key=?').get(feedback.pair_key) as TodoMergeSuggestionFeedback
}
/** Semantic-recall rows of a status since a timestamp (health hit-rate feed). */
export function countRecallStatusSince(db: DB, status: string, sinceMs: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM recall_log WHERE status = ? AND created_at >= ?').get(status, sinceMs) as { n: number } | undefined
  return row?.n ?? 0
}
export type { ExtractionLog }
