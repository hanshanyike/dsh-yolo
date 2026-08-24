import { createRequire } from 'node:module'
import type * as NodeSqlite from 'node:sqlite'

const sqlite = createRequire(import.meta.url)('node:sqlite') as typeof NodeSqlite

export const DatabaseSync = sqlite.DatabaseSync
