import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { SQLInputValue } from 'node:sqlite'
import { openDb, setMeta, withTransaction, type DB } from './db.ts'

const LEGACY_ALIAS = 'legacy_scope'
const MIGRATION_VERSION = 'cwd-v1'

export interface ScopeMigrationResult {
  imported: string[]
  warnings: string[]
}

function sqlPath(path: string): string {
  return `'${path.replaceAll("'", "''")}'`
}

function legacyHasTable(db: DB, table: string): boolean {
  return Boolean(db.prepare(
    `SELECT 1 FROM ${LEGACY_ALIAS}.sqlite_master WHERE type = 'table' AND name = ?`,
  ).get(table))
}

function markerFor(file: string): string {
  const digest = createHash('sha1').update(file).digest('hex').slice(0, 16)
  return `scope_migration_${MIGRATION_VERSION}_${digest}`
}

function remappedId(source: string, table: string, oldId: unknown): string {
  return `m-${createHash('sha1').update(`${source}\0${table}\0${String(oldId)}`).digest('hex').slice(0, 24)}`
}

function comparable(value: unknown): unknown {
  return value === undefined ? null : value
}

function remapJsonTodoIds(value: unknown, todoMap: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return todoMap.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => remapJsonTodoIds(item, todoMap))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapJsonTodoIds(item, todoMap)]))
  }
  return value
}

function remapJsonText(text: unknown, todoMap: ReadonlyMap<string, string>): string {
  if (typeof text !== 'string') return '[]'
  try {
    return JSON.stringify(remapJsonTodoIds(JSON.parse(text), todoMap))
  } catch {
    return text
  }
}

function sameRow(a: Record<string, unknown>, b: Record<string, unknown>, columns: readonly string[]): boolean {
  return columns.every((column) => comparable(a[column]) === comparable(b[column]))
}

function insertRow(db: DB, table: string, columns: readonly string[], row: Record<string, unknown>): void {
  db.prepare(`INSERT INTO ${table}(${columns.join(', ')}) VALUES(${columns.map(() => '?').join(',')})`)
    .run(...columns.map((column) => row[column] as SQLInputValue))
}

/** Copy an id-owned table, remapping only true same-id/different-content conflicts. */
function mergeIdTable(
  db: DB,
  source: string,
  table: string,
  columns: readonly string[],
  compareColumns: readonly string[],
  transform: (row: Record<string, unknown>) => Record<string, unknown>,
): Map<string, string> {
  const idMap = new Map<string, string>()
  const rows = db.prepare(`SELECT * FROM ${LEGACY_ALIAS}.${table}`).all() as Array<Record<string, unknown>>
  for (const sourceRow of rows) {
    const oldId = String(sourceRow.id)
    const incoming = transform({ ...sourceRow })
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(oldId) as Record<string, unknown> | undefined
    if (!existing) {
      insertRow(db, table, columns, incoming)
      idMap.set(oldId, oldId)
      continue
    }
    if (sameRow(existing, incoming, compareColumns)) {
      idMap.set(oldId, oldId)
      continue
    }
    const nextId = remappedId(source, table, oldId)
    incoming.id = nextId
    const remapped = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(nextId) as Record<string, unknown> | undefined
    if (!remapped) insertRow(db, table, columns, incoming)
    else if (!sameRow(remapped, incoming, compareColumns)) throw new Error(`${table} deterministic id collision: ${oldId}`)
    idMap.set(oldId, nextId)
  }
  return idMap
}

function archivePreference(db: DB, row: Record<string, unknown>, scopeKey: string, source: string, invalidAt: number): void {
  const id = `migrated-${createHash('sha1').update(`${source}\0${String(row.id)}`).digest('hex').slice(0, 24)}`
  db.prepare(
    `INSERT OR IGNORE INTO preference_history(id, key, value, scope_key, session_id, valid_at, invalid_at)
     VALUES(?,?,?,?,?,?,?)`,
  ).run(
    id,
    row.key as SQLInputValue,
    row.value as SQLInputValue,
    scopeKey,
    (row.session_id ?? null) as SQLInputValue,
    (row.valid_at ?? row.updated_at) as SQLInputValue,
    invalidAt,
  )
}

function mergePreferences(db: DB, scopeKey: string, source: string): void {
  const rows = db.prepare(`SELECT * FROM ${LEGACY_ALIAS}.preferences`).all() as Array<Record<string, unknown>>
  for (const row of rows) {
    const current = db.prepare('SELECT * FROM preferences WHERE key = ? AND scope_key = ?').get(row.key as SQLInputValue, scopeKey) as Record<string, unknown> | undefined
    if (!current) {
      const idOwner = db.prepare('SELECT key, value FROM preferences WHERE id = ?').get(row.id as SQLInputValue) as Record<string, unknown> | undefined
      if (idOwner && (idOwner.key !== row.key || idOwner.value !== row.value)) row.id = remappedId(source, 'preferences', row.id)
      db.prepare(
        `INSERT INTO preferences(id, key, value, confidence, scope_key, updated_at, valid_at, invalid_at, session_id)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      ).run(...[row.id, row.key, row.value, row.confidence, scopeKey, row.updated_at, row.valid_at, row.invalid_at, row.session_id] as SQLInputValue[])
      continue
    }
    if (sameRow(current, row, ['id', 'key', 'value', 'confidence', 'updated_at', 'valid_at', 'invalid_at', 'session_id'])) continue
    const sourceUpdated = Number(row.updated_at ?? 0)
    const currentUpdated = Number(current.updated_at ?? 0)
    if (sourceUpdated > currentUpdated) {
      archivePreference(db, current, scopeKey, 'canonical', sourceUpdated)
      db.prepare('DELETE FROM preferences WHERE id = ?').run(current.id as SQLInputValue)
      const idOwner = db.prepare('SELECT key, value FROM preferences WHERE id = ?').get(row.id as SQLInputValue) as Record<string, unknown> | undefined
      if (idOwner && (idOwner.key !== row.key || idOwner.value !== row.value)) row.id = remappedId(source, 'preferences', row.id)
      db.prepare(
        `INSERT INTO preferences(id, key, value, confidence, scope_key, updated_at, valid_at, invalid_at, session_id)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      ).run(...[row.id, row.key, row.value, row.confidence, scopeKey, row.updated_at, row.valid_at, row.invalid_at, row.session_id] as SQLInputValue[])
    } else {
      archivePreference(db, row, scopeKey, source, currentUpdated)
    }
  }
}

function mergeMeta(db: DB): void {
  const rows = db.prepare(`SELECT key, value FROM ${LEGACY_ALIAS}.meta`).all() as Array<{ key: string; value: string }>
  for (const row of rows) {
    if (!/^last_snapshot_date$|^brief_(morning|evening)_day$/.test(row.key)) continue
    const current = db.prepare('SELECT value FROM meta WHERE key = ?').get(row.key) as { value: string } | undefined
    if (!current || row.value > current.value) setMeta(db, row.key, row.value)
  }
}

function normalizeCanonicalRows(db: DB, scopeKey: string, cwd: string): void {
  for (const table of ['milestones', 'todos', 'goals', 'preferences', 'preference_history', 'events', 'session_summaries', 'pending_reminders', 'recall_log', 'todo_merge_log', 'todo_merge_suggestion_feedback']) {
    db.prepare(`UPDATE ${table} SET scope_key = ? WHERE scope_key <> ?`).run(scopeKey, scopeKey)
  }
  db.prepare('UPDATE notifications SET scope_key = ?, scope_cwd = ? WHERE scope_key <> ? OR scope_cwd IS NULL OR scope_cwd <> ?')
    .run(scopeKey, cwd, scopeKey, cwd)
  db.prepare('UPDATE attention_feedback SET scope_key = ? WHERE scope_key <> ?').run(scopeKey, scopeKey)
  db.prepare('UPDATE client_actions SET scope_key = ? WHERE scope_key <> ?').run(scopeKey, scopeKey)
  db.prepare('UPDATE todo_evidence SET source_scope_key = ? WHERE source_scope_key <> ?').run(scopeKey, scopeKey)
  db.prepare('UPDATE todo_identity_feedback SET scope_key = ? WHERE scope_key <> ?').run(scopeKey, scopeKey)
}

function importAttached(db: DB, scopeKey: string, cwd: string, source: string, warnings: string[]): void {
  const milestoneColumns = ['id', 'title', 'description', 'target_date', 'status', 'scope_key', 'source', 'created_at', 'updated_at']
  const milestoneMap = mergeIdTable(db, source, 'milestones', milestoneColumns, milestoneColumns.filter((c) => c !== 'scope_key'), (row) => ({ ...row, scope_key: scopeKey }))
  const todoColumns = ['id', 'title', 'detail', 'status', 'priority', 'due_at', 'milestone_id', 'scope_key', 'dedup_key', 'source', 'session_id', 'source_excerpt', 'source_turn', 'created_at', 'updated_at', 'completed_at', 'last_reminded_at', 'good_count', 'stale_count', 'record_status', 'merged_into_id']
  const todoMap = mergeIdTable(db, source, 'todos', todoColumns, todoColumns.filter((c) => c !== 'scope_key' && c !== 'merged_into_id'), (row) => ({
    ...row,
    milestone_id: row.milestone_id == null ? null : milestoneMap.get(String(row.milestone_id)) ?? row.milestone_id,
    // Remap self-references only after every todo id has been allocated.
    merged_into_id: null,
    scope_key: scopeKey,
  }))
  const mergedRows = db.prepare(`SELECT id, merged_into_id FROM ${LEGACY_ALIAS}.todos WHERE merged_into_id IS NOT NULL`).all() as
    Array<{ id: string; merged_into_id: string }>
  for (const row of mergedRows) {
    const id = todoMap.get(String(row.id))
    const intoId = todoMap.get(String(row.merged_into_id))
    if (id && intoId) {
      db.prepare('UPDATE todos SET merged_into_id = ? WHERE id = ?').run(intoId, id)
      db.prepare("DELETE FROM yolo_fts WHERE row_type = 'todo' AND row_id = ?").run(id)
    }
  }
  const evidenceRows = db.prepare(`SELECT * FROM ${LEGACY_ALIAS}.todo_evidence ORDER BY occurred_at ASC, rowid ASC`).all() as
    Array<Record<string, unknown>>
  for (const sourceEvidence of evidenceRows) {
    const fingerprint = String(sourceEvidence.source_fingerprint)
    const incomingTodoId = todoMap.get(String(sourceEvidence.todo_id)) ?? String(sourceEvidence.todo_id)
    const fingerprintOwner = db.prepare('SELECT id,todo_id FROM todo_evidence WHERE source_fingerprint = ?').get(fingerprint) as
      | { id: string; todo_id: string }
      | undefined
    if (fingerprintOwner) {
      if (fingerprintOwner.todo_id !== incomingTodoId) {
        warnings.push(`${source}: todo evidence fingerprint conflict ${fingerprint}; kept canonical evidence`)
      }
      continue
    }
    const oldId = String(sourceEvidence.id)
    const idOwner = db.prepare('SELECT source_fingerprint FROM todo_evidence WHERE id = ?').get(oldId) as
      | { source_fingerprint: string }
      | undefined
    const id = idOwner && idOwner.source_fingerprint !== fingerprint
      ? remappedId(source, 'todo_evidence', oldId)
      : oldId
    db.prepare(
      `INSERT INTO todo_evidence(
         id, todo_id, source_scope_key, session_id, turn_seq,
         source_kind, relation, excerpt, occurred_at, source_fingerprint
       ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      incomingTodoId,
      scopeKey,
      sourceEvidence.session_id as SQLInputValue,
      sourceEvidence.turn_seq as SQLInputValue,
      sourceEvidence.source_kind as SQLInputValue,
      sourceEvidence.relation as SQLInputValue,
      sourceEvidence.excerpt as SQLInputValue,
      sourceEvidence.occurred_at as SQLInputValue,
      fingerprint,
    )
  }
  const goalColumns = ['id', 'title', 'description', 'progress', 'status', 'milestone_id', 'scope_key', 'created_at', 'updated_at']
  mergeIdTable(db, source, 'goals', goalColumns, goalColumns.filter((c) => c !== 'scope_key'), (row) => ({
    ...row,
    milestone_id: row.milestone_id == null ? null : milestoneMap.get(String(row.milestone_id)) ?? row.milestone_id,
    scope_key: scopeKey,
  }))
  const historyColumns = ['id', 'key', 'value', 'scope_key', 'session_id', 'valid_at', 'invalid_at']
  mergeIdTable(db, source, 'preference_history', historyColumns, historyColumns.filter((c) => c !== 'scope_key'), (row) => ({ ...row, scope_key: scopeKey }))
  mergePreferences(db, scopeKey, source)
  const eventColumns = [
    'id', 'kind', 'summary', 'detail', 'session_id', 'source', 'occurred_at', 'scope_key',
    'subject_type', 'subject_id', 'subject_title',
    'related_subject_type', 'related_subject_id', 'related_subject_title', 'change_json',
  ]
  mergeIdTable(db, source, 'events', eventColumns, eventColumns.filter((c) => c !== 'scope_key'), (row) => ({ ...row, scope_key: scopeKey }))

  db.prepare(
    `INSERT INTO session_summaries(session_id, summary, scope_key, updated_at)
     SELECT session_id, summary, ?, updated_at FROM ${LEGACY_ALIAS}.session_summaries
     WHERE 1
     ON CONFLICT(session_id) DO UPDATE SET summary=excluded.summary, scope_key=excluded.scope_key, updated_at=excluded.updated_at
     WHERE excluded.updated_at > session_summaries.updated_at`,
  ).run(scopeKey)

  const notificationColumns = ['id', 'kind', 'title', 'body', 'todo_id', 'scope_cwd', 'created_at', 'seen_at', 'handled_at', 'scope_key']
  const notificationMap = mergeIdTable(db, source, 'notifications', notificationColumns, notificationColumns.filter((c) => c !== 'scope_key' && c !== 'scope_cwd'), (row) => ({
    ...row,
    todo_id: row.todo_id == null ? null : todoMap.get(String(row.todo_id)) ?? row.todo_id,
    scope_cwd: cwd,
    // A legacy branch import is historical by definition. Never replay it as new.
    seen_at: row.seen_at ?? row.handled_at ?? Date.now(),
    scope_key: scopeKey,
  }))

  const feedbackRows = db.prepare(`SELECT * FROM ${LEGACY_ALIAS}.attention_feedback`).all() as Array<Record<string, unknown>>
  const feedbackUpsert = db.prepare(
    `INSERT INTO attention_feedback(scope_key, todo_id, reason_version, evidence_fingerprint, seen_at, suppressed_until, feedback_reason, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(scope_key, todo_id, reason_version, evidence_fingerprint) DO UPDATE SET
       seen_at=NULLIF(MAX(COALESCE(attention_feedback.seen_at,0),COALESCE(excluded.seen_at,0)),0),
       suppressed_until=NULLIF(MAX(COALESCE(attention_feedback.suppressed_until,0),COALESCE(excluded.suppressed_until,0)),0),
       feedback_reason=CASE WHEN excluded.updated_at >= attention_feedback.updated_at THEN COALESCE(excluded.feedback_reason,attention_feedback.feedback_reason) ELSE attention_feedback.feedback_reason END,
       created_at=MIN(attention_feedback.created_at,excluded.created_at),
       updated_at=MAX(attention_feedback.updated_at,excluded.updated_at)`,
  )
  for (const row of feedbackRows) {
    feedbackUpsert.run(...[
      scopeKey,
      todoMap.get(String(row.todo_id)) ?? row.todo_id,
      row.reason_version,
      row.evidence_fingerprint,
      row.seen_at,
      row.suppressed_until,
      row.feedback_reason,
      row.created_at,
      row.updated_at,
    ] as SQLInputValue[])
  }

  const actionConflicts = db.prepare(
    `SELECT s.client_action_id AS id FROM ${LEGACY_ALIAS}.client_actions s
     JOIN client_actions t ON t.scope_key = ? AND t.client_action_id = s.client_action_id
     WHERE t.request_hash <> s.request_hash`,
  ).all(scopeKey) as Array<{ id: string }>
  for (const conflict of actionConflicts) warnings.push(`${source}: client_action_id conflict ${conflict.id}; kept canonical outcome`)
  db.prepare(
    `INSERT OR IGNORE INTO client_actions(scope_key, client_action_id, request_hash, outcome_json, created_at)
     SELECT ?, client_action_id, request_hash, outcome_json, created_at FROM ${LEGACY_ALIAS}.client_actions`,
  ).run(scopeKey)

  db.prepare(
    `INSERT INTO extraction_log(session_id, turn_seq, strategy, status, error, extracted_json, token_in, token_out, duration_ms, created_at)
     SELECT session_id, turn_seq, strategy, status, error, extracted_json, token_in, token_out, duration_ms, created_at
     FROM ${LEGACY_ALIAS}.extraction_log
     WHERE 1
     ON CONFLICT(session_id, turn_seq, strategy) DO UPDATE SET
       status=excluded.status,error=excluded.error,extracted_json=excluded.extracted_json,
       token_in=excluded.token_in,token_out=excluded.token_out,duration_ms=excluded.duration_ms,created_at=excluded.created_at
     WHERE excluded.created_at > extraction_log.created_at`,
  ).run()
  const resolverRows = db.prepare(
    `SELECT * FROM ${LEGACY_ALIAS}.todo_resolution_log ORDER BY created_at ASC, id ASC`,
  ).all() as Array<Record<string, unknown>>
  for (const row of resolverRows) {
    db.prepare(
      `INSERT INTO todo_resolution_log(
         scope_key, session_id, turn_seq, operation_id, input_fingerprint, input_excerpt,
         resolver_version, model_provider, model_name, status, error,
         candidates_json, resolutions_json, application_json, token_in, token_out, duration_ms, created_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(session_id, turn_seq, resolver_version) DO UPDATE SET
         scope_key=excluded.scope_key,operation_id=excluded.operation_id,input_fingerprint=excluded.input_fingerprint,input_excerpt=excluded.input_excerpt,
         model_provider=excluded.model_provider,model_name=excluded.model_name,status=excluded.status,error=excluded.error,
         candidates_json=excluded.candidates_json,resolutions_json=excluded.resolutions_json,application_json=excluded.application_json,
         token_in=excluded.token_in,token_out=excluded.token_out,duration_ms=excluded.duration_ms,created_at=excluded.created_at
       WHERE excluded.created_at > todo_resolution_log.created_at`,
    ).run(
      scopeKey,
      row.session_id as SQLInputValue,
      row.turn_seq as SQLInputValue,
      row.operation_id as SQLInputValue,
      row.input_fingerprint as SQLInputValue,
      row.input_excerpt as SQLInputValue,
      row.resolver_version as SQLInputValue,
      row.model_provider as SQLInputValue,
      row.model_name as SQLInputValue,
      row.status as SQLInputValue,
      row.error as SQLInputValue,
      remapJsonText(row.candidates_json, todoMap),
      remapJsonText(row.resolutions_json, todoMap),
      (row.application_json == null ? null : remapJsonText(row.application_json, todoMap)) as SQLInputValue,
      row.token_in as SQLInputValue,
      row.token_out as SQLInputValue,
      row.duration_ms as SQLInputValue,
      row.created_at as SQLInputValue,
    )
  }
  if (legacyHasTable(db, 'todo_identity_feedback')) {
    const feedbackRows = db.prepare(
      `SELECT feedback.*, evidence.source_fingerprint
       FROM ${LEGACY_ALIAS}.todo_identity_feedback feedback
       JOIN ${LEGACY_ALIAS}.todo_evidence evidence ON evidence.id = feedback.evidence_id
       ORDER BY feedback.created_at ASC, feedback.id ASC`,
    ).all() as Array<Record<string, unknown>>
    for (const row of feedbackRows) {
      const todoId = todoMap.get(String(row.todo_id)) ?? String(row.todo_id)
      const evidence = db.prepare('SELECT id FROM todo_evidence WHERE source_fingerprint = ?').get(row.source_fingerprint as SQLInputValue) as
        | { id: string }
        | undefined
      if (!evidence) {
        warnings.push(`${source}: identity feedback evidence missing ${String(row.evidence_id)}`)
        continue
      }
      const existing = db.prepare('SELECT id FROM todo_identity_feedback WHERE resolution_operation_id = ?').get(row.resolution_operation_id as SQLInputValue) as
        | { id: string }
        | undefined
      if (existing) continue
      const idOwner = db.prepare('SELECT resolution_operation_id FROM todo_identity_feedback WHERE id = ?').get(row.id as SQLInputValue) as
        | { resolution_operation_id: string }
        | undefined
      const id = idOwner && idOwner.resolution_operation_id !== row.resolution_operation_id
        ? remappedId(source, 'todo_identity_feedback', row.id)
        : String(row.id)
      db.prepare(
        `INSERT INTO todo_identity_feedback(
           id,resolution_operation_id,scope_key,todo_id,evidence_id,verdict,reason,undo_status,due_before,due_after,created_at
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        row.resolution_operation_id as SQLInputValue,
        scopeKey,
        todoId,
        evidence.id,
        row.verdict as SQLInputValue,
        row.reason as SQLInputValue,
        row.undo_status as SQLInputValue,
        row.due_before as SQLInputValue,
        row.due_after as SQLInputValue,
        row.created_at as SQLInputValue,
      )
    }
  }
  const reminderColumns = ['id', 'todo_id', 'milestone_id', 'fire_at', 'payload', 'scope_key', 'session_hint']
  const reminderMap = mergeIdTable(db, source, 'pending_reminders', reminderColumns, reminderColumns.filter((c) => c !== 'scope_key'), (row) => ({
    ...row,
    todo_id: row.todo_id == null ? null : todoMap.get(String(row.todo_id)) ?? row.todo_id,
    milestone_id: row.milestone_id == null ? null : milestoneMap.get(String(row.milestone_id)) ?? row.milestone_id,
    scope_key: scopeKey,
  }))
  if (legacyHasTable(db, 'todo_merge_log')) {
    const mergeRows = db.prepare(`SELECT * FROM ${LEGACY_ALIAS}.todo_merge_log ORDER BY created_at ASC, id ASC`).all() as
      Array<Record<string, unknown>>
    for (const row of mergeRows) {
      const sourceId = todoMap.get(String(row.source_id))
      const targetId = todoMap.get(String(row.target_id))
      if (!sourceId || !targetId) {
        warnings.push(`${source}: todo merge relation missing ${String(row.id)}`)
        continue
      }
      const id = db.prepare('SELECT 1 FROM todo_merge_log WHERE id = ?').get(row.id as SQLInputValue)
        ? remappedId(source, 'todo_merge_log', row.id)
        : String(row.id)
      try {
        db.prepare(
          `INSERT INTO todo_merge_log(
             id,scope_key,source_id,target_id,source_snapshot_json,target_before_json,target_after_json,
             notification_ids_json,reminder_ids_json,status,created_at,undone_at
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          id, scopeKey, sourceId, targetId,
          remapJsonText(row.source_snapshot_json, todoMap),
          remapJsonText(row.target_before_json, todoMap),
          remapJsonText(row.target_after_json, todoMap),
          remapJsonText(row.notification_ids_json, notificationMap),
          remapJsonText(row.reminder_ids_json, reminderMap),
          row.status as SQLInputValue, row.created_at as SQLInputValue, row.undone_at as SQLInputValue,
        )
      } catch {
        warnings.push(`${source}: active todo merge conflict ${String(row.id)}; kept canonical relation`)
      }
    }
  }
  if (legacyHasTable(db, 'todo_merge_suggestion_feedback')) {
    const feedbackRows = db.prepare(`SELECT * FROM ${LEGACY_ALIAS}.todo_merge_suggestion_feedback ORDER BY created_at ASC`).all() as
      Array<Record<string, unknown>>
    for (const row of feedbackRows) {
      const left = todoMap.get(String(row.a_id))
      const right = todoMap.get(String(row.b_id))
      if (!left || !right || left === right) continue
      const [a, b] = left < right ? [left, right] : [right, left]
      db.prepare(
        `INSERT OR IGNORE INTO todo_merge_suggestion_feedback(pair_key,scope_key,a_id,b_id,verdict,reason,created_at)
         VALUES(?,?,?,?,?,?,?)`,
      ).run(`${a}:${b}`, scopeKey, a, b, 'not_duplicate', row.reason as SQLInputValue, row.created_at as SQLInputValue)
    }
  }
  db.prepare(
    `INSERT INTO recall_log(scope_key, session_id, query, expansions, kept_keys, drop_reasons, rerank_outcome, latency_ms, source, status, error, created_at)
     SELECT ?, session_id, query, expansions, kept_keys, drop_reasons, rerank_outcome, latency_ms, source, status, error, created_at
     FROM ${LEGACY_ALIAS}.recall_log`,
  ).run(scopeKey)
  db.prepare(
    `INSERT INTO user_profile(id, display_name, timezone, working_hours, traits, updated_at)
     SELECT id, display_name, timezone, working_hours, traits, updated_at FROM ${LEGACY_ALIAS}.user_profile
     WHERE 1
     ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,timezone=excluded.timezone,
       working_hours=excluded.working_hours,traits=excluded.traits,updated_at=excluded.updated_at
     WHERE excluded.updated_at > user_profile.updated_at`,
  ).run()
  mergeMeta(db)
}

/** Merge every legacy branch DB in a workspace directory into the cwd-only DB. */
export function migrateLegacyScopeDatabases(
  db: DB,
  dataDir: string,
  canonicalDbPath: string,
  scopeKey: string,
  cwd: string,
): ScopeMigrationResult {
  const result: ScopeMigrationResult = { imported: [], warnings: [] }
  withTransaction(db, () => {
    normalizeCanonicalRows(db, scopeKey, cwd)
    setMeta(db, 'workspace_scope_identity', MIGRATION_VERSION)
  })
  if (!existsSync(dataDir)) return result
  const canonicalName = basename(canonicalDbPath).toLowerCase()
  const sources = readdirSync(dataDir)
    .filter((file) => file.startsWith('yolo-') && file.endsWith('.db') && file.toLowerCase() !== canonicalName)
    .sort()

  for (const file of sources) {
    const marker = markerFor(file)
    if (db.prepare('SELECT value FROM meta WHERE key = ?').get(marker)) continue
    const sourcePath = join(dataDir, file)
    try {
      // Bring old schemas forward and checkpoint their WAL before attaching.
      const sourceDb = openDb(sourcePath)
      sourceDb.close()
      db.exec(`ATTACH DATABASE ${sqlPath(sourcePath)} AS ${LEGACY_ALIAS}`)
      try {
        withTransaction(db, () => {
          importAttached(db, scopeKey, cwd, file, result.warnings)
          setMeta(db, marker, file)
        })
      } finally {
        db.exec(`DETACH DATABASE ${LEGACY_ALIAS}`)
      }
      result.imported.push(file)
    } catch (error) {
      throw new Error(`legacy scope migration failed (${file}): ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }
  return result
}
