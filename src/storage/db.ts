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
  if (!todoCols.some((c) => c.name === 'session_id')) {
    db.exec('ALTER TABLE todos ADD COLUMN session_id TEXT')
  }
  if (!todoCols.some((c) => c.name === 'source_excerpt')) {
    db.exec('ALTER TABLE todos ADD COLUMN source_excerpt TEXT')
  }
  if (!todoCols.some((c) => c.name === 'source_turn')) {
    db.exec('ALTER TABLE todos ADD COLUMN source_turn INTEGER')
  }
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
