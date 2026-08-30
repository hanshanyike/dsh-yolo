// YOLO SQLite connection — opens a DB, applies the schema, exposes pragma helpers.
// Schema is read from schema.sql next to this file (dev: src/storage/;
// built: dist/src/storage/ — scripts/copy-assets.mjs copies it there).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementResultingChanges,
} from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = join(here, 'schema.sql')

type BindValue = SQLInputValue | undefined

/** The small statement surface used by YOLO's repository layer. */
export interface DBStatement {
  all(...params: BindValue[]): unknown[]
  get(...params: BindValue[]): unknown
  run(...params: BindValue[]): StatementResultingChanges
}

/** Synchronous SQLite surface used by the storage and repository modules. */
export interface DB {
  readonly isOpen: boolean
  readonly isTransaction: boolean
  close(): void
  exec(sql: string): void
  prepare(sql: string): DBStatement
}

function normalizeParams(params: readonly BindValue[]): SQLInputValue[] {
  // Preserve the previous driver's contract: optional fields bind as SQL NULL.
  // node:sqlite deliberately rejects JavaScript undefined values.
  return params.map((value) => value ?? null)
}

class YoloDatabase implements DB {
  readonly #database: DatabaseSync

  constructor(path: string) {
    this.#database = new DatabaseSync(path)
  }

  get isOpen(): boolean {
    return this.#database.isOpen
  }

  get isTransaction(): boolean {
    return this.#database.isTransaction
  }

  close(): void {
    this.#database.close()
  }

  exec(sql: string): void {
    this.#database.exec(sql)
  }

  prepare(sql: string): DBStatement {
    const statement = this.#database.prepare(sql)
    return {
      all: (...params) => statement.all(...normalizeParams(params)),
      get: (...params) => statement.get(...normalizeParams(params)),
      run: (...params) => statement.run(...normalizeParams(params)),
    }
  }
}

let cachedSchema: string | undefined

function loadSchema(): string {
  if (cachedSchema) return cachedSchema
  cachedSchema = readFileSync(SCHEMA_PATH, 'utf8')
  return cachedSchema
}

/** Open (or create) a YOLO database and ensure all tables/indexes/FTS exist. */
export function openDb(dbPath: string): DB {
  const db = new YoloDatabase(dbPath)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec(loadSchema())
    migrate(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

let savepointSequence = 0

/**
 * Execute a synchronous callback atomically.
 *
 * Node's built-in SQLite API intentionally exposes SQL transaction primitives
 * instead of a callback helper. Use a savepoint when the caller is already in
 * a transaction so repository operations remain safely composable.
 */
export function withTransaction<T>(db: DB, callback: () => T): T {
  if (db.isTransaction) {
    const savepoint = `yolo_nested_${++savepointSequence}`
    db.exec(`SAVEPOINT ${savepoint}`)
    try {
      const result = callback()
      db.exec(`RELEASE SAVEPOINT ${savepoint}`)
      return result
    } catch (error) {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
      db.exec(`RELEASE SAVEPOINT ${savepoint}`)
      throw error
    }
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    const result = callback()
    db.exec('COMMIT')
    return result
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Lightweight forward migrations for DBs created before a schema change.
 * SQLite has no "ADD COLUMN IF NOT EXISTS" — check PRAGMA table_info instead.
 */
function migrate(db: DB): void {
  const todoCols = db.prepare('PRAGMA table_info(todos)').all() as { name: string }[]
  if (!todoCols.some((c) => c.name === 'last_reminded_at')) {
    db.exec('ALTER TABLE todos ADD COLUMN last_reminded_at INTEGER')
  }
  if (!todoCols.some((c) => c.name === 'good_count')) {
    db.exec('ALTER TABLE todos ADD COLUMN good_count INTEGER NOT NULL DEFAULT 0')
  }
  if (!todoCols.some((c) => c.name === 'stale_count')) {
    db.exec('ALTER TABLE todos ADD COLUMN stale_count INTEGER NOT NULL DEFAULT 0')
  }
  const prefCols = db.prepare('PRAGMA table_info(preferences)').all() as { name: string }[]
  if (!prefCols.some((c) => c.name === 'valid_at')) {
    db.exec('ALTER TABLE preferences ADD COLUMN valid_at INTEGER')
  }
  if (!prefCols.some((c) => c.name === 'invalid_at')) {
    db.exec('ALTER TABLE preferences ADD COLUMN invalid_at INTEGER')
  }
  if (!prefCols.some((c) => c.name === 'session_id')) {
    db.exec('ALTER TABLE preferences ADD COLUMN session_id TEXT')
  }
  const eventCols = db.prepare('PRAGMA table_info(events)').all() as { name: string }[]
  if (!eventCols.some((c) => c.name === 'source')) {
    db.exec('ALTER TABLE events ADD COLUMN source TEXT')
  }
  for (const [name, type] of [
    ['subject_type', 'TEXT'],
    ['subject_id', 'TEXT'],
    ['subject_title', 'TEXT'],
    ['related_subject_type', 'TEXT'],
    ['related_subject_id', 'TEXT'],
    ['related_subject_title', 'TEXT'],
    ['change_json', 'TEXT'],
  ] as const) {
    if (!eventCols.some((c) => c.name === name)) db.exec(`ALTER TABLE events ADD COLUMN ${name} ${type}`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_subject
    ON events(scope_key, subject_type, subject_id, occurred_at DESC)
    WHERE subject_id IS NOT NULL`)
  if (!todoCols.some((c) => c.name === 'session_id')) {
    db.exec('ALTER TABLE todos ADD COLUMN session_id TEXT')
  }
  if (!todoCols.some((c) => c.name === 'source_excerpt')) {
    db.exec('ALTER TABLE todos ADD COLUMN source_excerpt TEXT')
  }
  if (!todoCols.some((c) => c.name === 'source_turn')) {
    db.exec('ALTER TABLE todos ADD COLUMN source_turn INTEGER')
  }
  if (!todoCols.some((c) => c.name === 'record_status')) {
    db.exec("ALTER TABLE todos ADD COLUMN record_status TEXT NOT NULL DEFAULT 'canonical'")
  }
  if (!todoCols.some((c) => c.name === 'merged_into_id')) {
    db.exec('ALTER TABLE todos ADD COLUMN merged_into_id TEXT')
  }
  const notificationCols = db.prepare('PRAGMA table_info(notifications)').all() as { name: string }[]
  if (!notificationCols.some((c) => c.name === 'seen_at')) {
    db.exec('ALTER TABLE notifications ADD COLUMN seen_at INTEGER')
    // Existing installations already exposed these rows through the old badge.
    // Establish one baseline so upgrading does not replay the whole history as new.
    db.prepare('UPDATE notifications SET seen_at = COALESCE(handled_at, ?) WHERE seen_at IS NULL').run(Date.now())
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_unseen ON notifications(scope_key, seen_at, created_at)')
  const resolutionCols = db.prepare('PRAGMA table_info(todo_resolution_log)').all() as { name: string }[]
  if (!resolutionCols.some((c) => c.name === 'application_json')) {
    db.exec('ALTER TABLE todo_resolution_log ADD COLUMN application_json TEXT')
  }
  // Trigger definitions use IF NOT EXISTS in schema.sql, so replace the two
  // pre-R2c versions on existing databases. Rejected evidence remains in the
  // append-only ledger but no longer participates in active identity recall.
  db.exec('DROP TRIGGER IF EXISTS trg_todo_identity_au')
  db.exec('DROP TRIGGER IF EXISTS trg_todo_evidence_identity_ai')
  db.exec(`CREATE TRIGGER trg_todo_identity_au AFTER UPDATE OF title, detail, record_status, merged_into_id ON todos BEGIN
    DELETE FROM todo_identity_fts WHERE record_id = old.id;
    INSERT INTO todo_identity_fts(record_id, title, body)
    SELECT new.id, new.title,
      trim(COALESCE(new.detail, '') || ' ' || COALESCE((
        SELECT group_concat(excerpt, ' ') FROM todo_evidence
        WHERE todo_id = new.id AND excerpt IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM todo_identity_feedback feedback
            WHERE feedback.evidence_id = todo_evidence.id AND feedback.verdict = 'incorrect'
          )
      ), ''));
  END`)
  db.exec(`CREATE TRIGGER trg_todo_evidence_identity_ai AFTER INSERT ON todo_evidence BEGIN
    DELETE FROM todo_identity_fts WHERE record_id = new.todo_id;
    INSERT INTO todo_identity_fts(record_id, title, body)
    SELECT todos.id, todos.title,
      trim(COALESCE(todos.detail, '') || ' ' || COALESCE((
        SELECT group_concat(excerpt, ' ') FROM todo_evidence
        WHERE todo_id = todos.id AND excerpt IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM todo_identity_feedback feedback
            WHERE feedback.evidence_id = todo_evidence.id AND feedback.verdict = 'incorrect'
          )
      ), ''))
    FROM todos WHERE todos.id = new.todo_id;
  END`)
  db.exec("UPDATE todos SET record_status = 'canonical' WHERE record_status IS NULL")
  db.exec('CREATE INDEX IF NOT EXISTS idx_todos_record_status ON todos(scope_key, record_status, status)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_todos_merged_into ON todos(merged_into_id) WHERE merged_into_id IS NOT NULL')
  // Rebuild the two hot partial indexes now that record identity is available;
  // merged historical rows must not participate in reminders or upsert lookup.
  const dueIndex = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_todos_due'").get() as
    | { sql: string | null }
    | undefined
  if (!dueIndex?.sql?.includes('record_status')) {
    db.exec('DROP INDEX IF EXISTS idx_todos_due')
    db.exec("CREATE INDEX idx_todos_due ON todos(due_at) WHERE due_at IS NOT NULL AND record_status = 'canonical' AND status IN ('pending','in_progress')")
  }
  const dedupIndex = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_todos_dedup'").get() as
    | { sql: string | null }
    | undefined
  if (!dedupIndex?.sql?.includes('record_status')) {
    db.exec('DROP INDEX IF EXISTS idx_todos_dedup')
    db.exec("CREATE INDEX idx_todos_dedup ON todos(scope_key, dedup_key, created_at, id) WHERE dedup_key IS NOT NULL AND record_status = 'canonical' AND status IN ('pending','in_progress')")
  }
  // Older rows exposed only one source on todos. Preserve that compatibility
  // projection and seed it once into the new immutable multi-source ledger.
  db.exec(`
    INSERT OR IGNORE INTO todo_evidence(
      id, todo_id, source_scope_key, session_id, turn_seq,
      source_kind, relation, excerpt, occurred_at, source_fingerprint
    )
    SELECT
      'legacy-' || id, id, scope_key, session_id, source_turn,
      CASE
        WHEN source = 'tool' THEN 'assistant_action'
        WHEN source = 'manual' THEN 'panel_action'
        ELSE 'extraction'
      END,
      'origin', source_excerpt, created_at, 'legacy:todo:' || id || ':origin'
    FROM todos
    WHERE NOT EXISTS (
      SELECT 1 FROM todo_evidence e
      WHERE e.todo_id = todos.id AND e.relation = 'origin'
    )
  `)
  // Existing databases predate the resolver-only identity index. Seed any
  // missing todo records once; subsequent writes stay synchronized by schema
  // triggers, including evidence excerpts and merged historical aliases.
  db.exec(`
    INSERT INTO todo_identity_fts(record_id, title, body)
    SELECT todos.id, todos.title,
      trim(COALESCE(todos.detail, '') || ' ' || COALESCE((
        SELECT group_concat(excerpt, ' ') FROM todo_evidence
        WHERE todo_id = todos.id AND excerpt IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM todo_identity_feedback feedback
            WHERE feedback.evidence_id = todo_evidence.id AND feedback.verdict = 'incorrect'
          )
      ), ''))
    FROM todos
    WHERE NOT EXISTS (
      SELECT 1 FROM todo_identity_fts WHERE record_id = todos.id
    )
  `)
}

export function setMeta(db: DB, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

export function getMeta(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value
}
