// YOLO FTS5 search — full-text recall across todos/milestones/goals/preferences/events.
//
// Chinese tokenization: schema.sql uses `tokenize = 'trigram'`, verified with
// Node's built-in SQLite on the supported Node 22/24 runtimes. It gives good
// CJK recall for queries >= 3 chars; 2-char queries use the LIKE fallback.

import type { DB } from './db.ts'
import type { RowType, SearchHit } from './types.ts'

/** Recall queries come from raw user messages; cap them so a pasted blob
 *  doesn't become a pointless multi-trigram phrase scan. */
const MAX_QUERY_CHARS = 64

/** Token budgets for the multi-path recall query (P6 hybrid recall). */
const MAX_PHRASE_TOKENS = 8
const MAX_LIKE_TERMS = 2

/** Worst possible rank for LIKE-fallback hits so they always sort after both
 *  BM25 paths. Kept as a JS-side constant, not an SQL alias — FTS5's `rank`
 *  is a special column and aliasing it outside a MATCH query misbehaves. */
const LIKE_FALLBACK_RANK = 1000

/** Wrap a raw string as an FTS5 quoted phrase. Inside quotes every character
 *  (angle brackets, operators, parens, CJK, …) is a literal — only `"` needs
 *  doubling. Without this, MATCH parses the user's text as FTS5 query syntax
 *  and throws `fts5: syntax error near "<"`. */
export function toFtsPhrase(q: string): string {
  return `"${q.replace(/"/g, '""')}"`
}

/** Shared BM25 MATCH query behind both the exact single-phrase search and the
 *  token OR recall path. */
function ftsMatch(db: DB, matchExpr: string, limit: number, kinds?: readonly RowType[]): SearchHit[] {
  const placeholders = kinds && kinds.length > 0 ? kinds.map(() => '?').join(',') : null
  const where = placeholders ? `AND row_type IN (${placeholders})` : ''
  const sql = `SELECT row_type, row_id, title, body, rank FROM yolo_fts WHERE yolo_fts MATCH ? ${where} ORDER BY rank LIMIT ?`
  const params: (string | number)[] = [matchExpr, ...(kinds ?? []), limit]
  return db.prepare(sql).all(...params) as SearchHit[]
}

/** FTS5 BM25 search (trigram tokenizer). Returns ranked hits across all row types (or a subset). */
export function ftsSearch(
  db: DB,
  query: string,
  topK = 5,
  kinds?: readonly RowType[],
): SearchHit[] {
  const q = query.trim().slice(0, MAX_QUERY_CHARS)
  if (!q) return []
  return ftsMatch(db, toFtsPhrase(q), topK, kinds)
}

/** Split a raw user message into recall tokens. Latin/digit words and CJK
 *  trigrams feed the FTS OR path; 2-char CJK runs cannot match a trigram
 *  index and fall back to LIKE substrings. */
export function extractQueryTokens(q: string): { phrases: string[]; likeTerms: string[] } {
  const phrases: string[] = []
  const likeTerms: string[] = []
  const seenPhrase = new Set<string>()
  const seenLike = new Set<string>()

  for (const word of q.match(/[A-Za-z0-9]+/g) ?? []) {
    if (word.length < 3 || seenPhrase.has(word)) continue
    seenPhrase.add(word)
    phrases.push(word)
  }
  for (const run of q.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length >= 3) {
      for (let i = 0; i + 3 <= run.length; i++) {
        const gram = run.slice(i, i + 3)
        if (seenPhrase.has(gram)) continue
        seenPhrase.add(gram)
        phrases.push(gram)
      }
    } else if (run.length === 2 && !seenLike.has(run)) {
      seenLike.add(run)
      likeTerms.push(run)
    }
  }
  return { phrases: phrases.slice(0, MAX_PHRASE_TOKENS), likeTerms: likeTerms.slice(0, MAX_LIKE_TERMS) }
}

/** Escape LIKE wildcards and the escape character itself inside a pattern. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** Substring fallback for tokens below the trigram minimum. */
function likeSearch(db: DB, term: string, limit: number, kinds?: readonly RowType[]): SearchHit[] {
  const placeholders = kinds && kinds.length > 0 ? kinds.map(() => '?').join(',') : null
  const where = placeholders ? `AND row_type IN (${placeholders})` : ''
  const sql = `SELECT row_type, row_id, title, body FROM yolo_fts WHERE title LIKE ? ESCAPE '\\' ${where} LIMIT ?`
  const params: (string | number)[] = [likePattern(term), ...(kinds ?? []), limit]
  const rows = db.prepare(sql).all(...params) as Array<Omit<SearchHit, 'rank'>>
  return rows.map((r) => ({ ...r, rank: LIKE_FALLBACK_RANK }))
}

/** Hybrid multi-path recall for a raw user message: whole-phrase exact matches
 *  first, then a token OR query (BM25), then LIKE fallback — merged and deduped
 *  by (row_type, row_id). A single wrapped phrase requires every trigram to
 *  appear contiguously, so natural-language queries almost never hit; the token
 *  paths are what let "演示稿进展如何" recall 「把演示稿发给研发」. */
export function ftsRecallSearch(
  db: DB,
  query: string,
  topK = 5,
  kinds?: readonly RowType[],
): SearchHit[] {
  const q = query.trim().slice(0, MAX_QUERY_CHARS)
  if (!q) return []

  const tokens = extractQueryTokens(q)
  const seen = new Set<string>()
  const merged: SearchHit[] = []
  const push = (hits: readonly SearchHit[]): void => {
    for (const h of hits) {
      const key = `${h.row_type}:${h.row_id}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(h)
    }
  }

  push(ftsSearch(db, q, topK, kinds))
  if (tokens.phrases.length > 0) {
    const orExpr = tokens.phrases.map((p) => toFtsPhrase(p)).join(' OR ')
    push(ftsMatch(db, orExpr, topK * 2, kinds))
  }
  for (const term of tokens.likeTerms) {
    push(likeSearch(db, term, topK, kinds))
  }
  return merged.slice(0, topK)
}
