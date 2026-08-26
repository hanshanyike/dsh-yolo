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
  for (const table of ['milestones', 'todos', 'goals', 'preferences', 'preference_history', 'events', 'session_summaries', 'pending_reminders', 'recall_log']) {
    db.prepare(`UPDATE ${table} SET scope_key = ? WHERE scope_key <> ?`).run(scopeKey, scopeKey)
  }
  db.prepare('UPDATE notifications SET scope_key = ?, scope_cwd = ? WHERE scope_key <> ? OR scope_cwd IS NULL OR scope_cwd <> ?')
    .run(scopeKey, cwd, scopeKey, cwd)
  db.prepare('UPDATE attention_feedback SET scope_key = ? WHERE scope_key <> ?').run(scopeKey, scopeKey)
  db.prepare('UPDATE client_actions SET scope_key = ? WHERE scope_key <> ?').run(scopeKey, scopeKey)
}

function importAttached(db: DB, scopeKey: string, cwd: string, source: string, warnings: string[]): void {
  const milestoneColumns = ['id', 'title', 'description', 'target_date', 'status', 'scope_key', 'source', 'created_at', 'updated_at']
  const milestoneMap = mergeIdTable(db, source, 'milestones', milestoneColumns, milestoneColumns.filter((c) => c !== 'scope_key'), (row) => ({ ...row, scope_key: scopeKey }))
  const todoColumns = ['id', 'title', 'detail', 'status', 'priority', 'due_at', 'milestone_id', 'scope_key', 'dedup_key', 'source', 'session_id', 'source_excerpt', 'source_turn', 'created_at', 'updated_at', 'completed_at', 'last_reminded_at', 'good_count', 'stale_count']
  const todoMap = mergeIdTable(db, source, 'todos', todoColumns, todoColumns.filter((c) => c !== 'scope_key'), (row) => ({
    ...row,
    milestone_id: row.milestone_id == null ? null : milestoneMap.get(String(row.milestone_id)) ?? row.milestone_id,
    scope_key: scopeKey,
  }))
  const goalColumns = ['id', 'title', 'description', 'progress', 'status', 'milestone_id', 'scope_key', 'created_at', 'updated_at']
  mergeIdTable(db, source, 'goals', goalColumns, goalColumns.filter((c) => c !== 'scope_key'), (row) => ({
    ...row,
    milestone_id: row.milestone_id == null ? null : milestoneMap.get(String(row.milestone_id)) ?? row.milestone_id,
    scope_key: scopeKey,
  }))
  const historyColumns = ['id', 'key', 'value', 'scope_key', 'session_id', 'valid_at', 'invalid_at']
  mergeIdTable(db, source, 'preference_history', historyColumns, historyColumns.filter((c) => c !== 'scope_key'), (row) => ({ ...row, scope_key: scopeKey }))
  mergePreferences(db, scopeKey, source)
  const eventColumns = ['id', 'kind', 'summary', 'detail', 'session_id', 'source', 'occurred_at', 'scope_key']
  mergeIdTable(db, source, 'events', eventColumns, eventColumns.filter((c) => c !== 'scope_key'), (row) => ({ ...row, scope_key: scopeKey }))

  db.prepare(
    `INSERT INTO session_summaries(session_id, summary, scope_key, updated_at)
     SELECT session_id, summary, ?, updated_at FROM ${LEGACY_ALIAS}.session_summaries
     WHERE 1
     ON CONFLICT(session_id) DO UPDATE SET summary=excluded.summary, scope_key=excluded.scope_key, updated_at=excluded.updated_at
     WHERE excluded.updated_at > session_summaries.updated_at`,
  ).run(scopeKey)

  const notificationColumns = ['id', 'kind', 'title', 'body', 'todo_id', 'scope_cwd', 'created_at', 'handled_at', 'scope_key']
  mergeIdTable(db, source, 'notifications', notificationColumns, notificationColumns.filter((c) => c !== 'scope_key' && c !== 'scope_cwd'), (row) => ({
    ...row,
    todo_id: row.todo_id == null ? null : todoMap.get(String(row.todo_id)) ?? row.todo_id,
    scope_cwd: cwd,
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
  const reminderColumns = ['id', 'todo_id', 'milestone_id', 'fire_at', 'payload', 'scope_key', 'session_hint']
  mergeIdTable(db, source, 'pending_reminders', reminderColumns, reminderColumns.filter((c) => c !== 'scope_key'), (row) => ({
    ...row,
    todo_id: row.todo_id == null ? null : todoMap.get(String(row.todo_id)) ?? row.todo_id,
    milestone_id: row.milestone_id == null ? null : milestoneMap.get(String(row.milestone_id)) ?? row.milestone_id,
    scope_key: scopeKey,
  }))
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
