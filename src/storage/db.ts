// YOLO SQLite connection — opens a DB, applies the schema, exposes pragma helpers.
// Schema is read from schema.sql next to this file (dev: src/storage/;
// built: dist/src/storage/ — scripts/copy-assets.mjs copies it there).

import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = join(here, 'schema.sql')

/** better-sqlite3 instance type. */
export type DB = Database.Database

let cachedSchema: string | undefined

function loadSchema(): string {
  if (cachedSchema) return cachedSchema
  cachedSchema = readFileSync(SCHEMA_PATH, 'utf8')
  return cachedSchema
}

/** Open (or create) a YOLO database and ensure all tables/indexes/FTS exist. */
export function openDb(dbPath: string): DB {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.exec(loadSchema())
  migrate(db)
  return db
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
  const eventCols = db.prepare('PRAGMA table_info(events)').all() as { name: string }[]
  if (!eventCols.some((c) => c.name === 'source')) {
    db.exec('ALTER TABLE events ADD COLUMN source TEXT')
  }
  if (!todoCols.some((c) => c.name === 'session_id')) {
    db.exec('ALTER TABLE todos ADD COLUMN session_id TEXT')
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
