// YOLO FTS5 search — full-text recall across todos/milestones/goals/preferences/events.
//
// Chinese tokenization: schema.sql uses `tokenize = 'trigram'` (verified on
// better-sqlite3 11.10.0 / Win x64 / Node 22), which gives good CJK recall for
// queries >= 3 chars. 2-char CJK queries fall back to a substring scan and may miss.

import type { DB } from './db.ts'
import type { RowType, SearchHit } from './types.ts'

/** FTS5 BM25 search (trigram tokenizer). Returns ranked hits across all row types (or a subset). */
export function ftsSearch(
  db: DB,
  query: string,
  topK = 5,
  kinds?: readonly RowType[],
): SearchHit[] {
  const q = query.trim()
  if (!q) return []

  const placeholders = kinds && kinds.length > 0 ? kinds.map(() => '?').join(',') : null
  const where = placeholders ? `AND row_type IN (${placeholders})` : ''
  const sql = `SELECT row_type, row_id, title, body, rank FROM yolo_fts WHERE yolo_fts MATCH ? ${where} ORDER BY rank LIMIT ?`
  const params: (string | number)[] = [q, ...(kinds ?? []), topK]

  return db.prepare(sql).all(...params) as SearchHit[]
}
