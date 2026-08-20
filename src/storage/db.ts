// YOLO SQLite connection — opens a DB, applies the schema, exposes pragma helpers.
// Schema is read from schema.sql next to this file (dev: src/storage/; built: dist/storage/).

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
  return db
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
