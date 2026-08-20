// YOLO FTS5 search — full-text recall across todos/milestones/goals/preferences/events.
//
// Chinese tokenization: schema.sql uses `tokenize = 'unicode61'`, which does not split
// CJK well. To recover recall we pre-process the query with bigram sliding over CJK runs.
// (If M1 verifies better-sqlite3 ships a trigram tokenizer, switch schema to
// `tokenize='trigram'` and this bigramize becomes a no-op-ish pass-through.)

import type { DB } from './db.ts'
import type { RowType, SearchHit } from './types.ts'

/** Sliding bigram over CJK runs; ASCII tokens pass through. (Reserved for an M5
 * index-side bigram tokenizer fallback if trigram 2-char recall proves inadequate.) */
export function bigramize(query: string): string {
  return query
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]+/g, (run) => {
      if (run.length <= 2) return run
      const grams: string[] = []
      for (let i = 0; i + 1 < run.length; i++) grams.push(run.slice(i, i + 2))
      grams.push(run.slice(-1))
      return grams.join(' ')
    })
    .trim()
}

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
