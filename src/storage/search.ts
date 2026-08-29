// YOLO FTS5 search — full-text recall across todos/milestones/goals/preferences/events.
//
// Chinese tokenization: schema.sql uses `tokenize = 'trigram'`, verified with
// Node's built-in SQLite on the supported Node 22/24 runtimes. It gives good
// CJK recall for queries >= 3 chars; 2-char queries use the LIKE fallback.

import type { DB } from './db.ts'
import type { RowType, SearchHit, Todo, TodoIdentityCandidate } from './types.ts'

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

interface TodoIdentityHit {
  record_id: string
  title: string
  rank: number
}

function todoIdentityMatch(db: DB, matchExpr: string, limit: number): TodoIdentityHit[] {
  return db.prepare(
    'SELECT record_id, title, rank FROM todo_identity_fts WHERE todo_identity_fts MATCH ? ORDER BY rank, record_id LIMIT ?',
  ).all(matchExpr, limit) as TodoIdentityHit[]
}

function todoIdentityLike(db: DB, term: string, limit: number): TodoIdentityHit[] {
  const rows = db.prepare(
    `SELECT record_id, title FROM todo_identity_fts
     WHERE title LIKE ? ESCAPE '\\' ORDER BY record_id LIMIT ?`,
  ).all(likePattern(term), limit) as Array<Omit<TodoIdentityHit, 'rank'>>
  return rows.map((row) => ({ ...row, rank: LIKE_FALLBACK_RANK }))
}

function todoRecord(db: DB, id: string): Todo | undefined {
  return db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo | undefined
}

function canonicalTodo(db: DB, record: Todo): Todo | undefined {
  let current = record
  const seen = new Set<string>()
  while (current.record_status === 'merged' && current.merged_into_id) {
    if (seen.has(current.id)) return undefined
    seen.add(current.id)
    const next = todoRecord(db, current.merged_into_id)
    if (!next) return undefined
    current = next
  }
  return current.record_status === 'canonical' ? current : undefined
}

function canonicalAliases(db: DB, canonicalId: string): string[] {
  const rows = db.prepare(
    `WITH RECURSIVE aliases(id, title) AS (
       SELECT id, title FROM todos WHERE merged_into_id = ?
       UNION
       SELECT child.id, child.title FROM todos child JOIN aliases parent ON child.merged_into_id = parent.id
     )
     SELECT title FROM aliases ORDER BY title ASC`,
  ).all(canonicalId) as Array<{ title: string }>
  return [...new Set(rows.map((row) => row.title))]
}

/**
 * Resolver-only candidate recall. It searches canonical, terminal and merged
 * todo records without changing the ordinary memory-recall index. Historical
 * aliases are folded onto their canonical stable id before the model sees them.
 */
export function recallTodoIdentityCandidates(db: DB, query: string, topK = 12): TodoIdentityCandidate[] {
  // The extractor folds late steering into the same turn; the newest text is
  // the authoritative correction. Search the newest message lines first,
  // then the bounded whole tail so multi-intent turns still recall earlier
  // mentions without letting old text consume the token budget.
  const raw = query.trim()
  if (!raw) return []
  const queryParts = [...new Set([
    ...raw.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).slice(-4).reverse()
      .map((line) => line.slice(-MAX_QUERY_CHARS)),
    raw.slice(-MAX_QUERY_CHARS),
  ])]
  const hits: TodoIdentityHit[] = []
  const seenRecords = new Set<string>()
  const push = (rows: readonly TodoIdentityHit[]): void => {
    for (const row of rows) {
      if (seenRecords.has(row.record_id)) continue
      seenRecords.add(row.record_id)
      hits.push(row)
    }
  }
  for (const part of queryParts) {
    const tokens = extractQueryTokens(part)
    push(todoIdentityMatch(db, toFtsPhrase(part), topK))
    if (tokens.phrases.length > 0) {
      push(todoIdentityMatch(db, tokens.phrases.map((token) => toFtsPhrase(token)).join(' OR '), topK * 2))
    }
    for (const term of tokens.likeTerms) push(todoIdentityLike(db, term, topK))
  }

  const grouped = new Map<string, TodoIdentityCandidate>()
  for (const hit of hits) {
    const record = todoRecord(db, hit.record_id)
    if (!record) continue
    const canonical = canonicalTodo(db, record)
    if (!canonical) continue
    const existing = grouped.get(canonical.id)
    if (existing) {
      existing.rank = Math.min(existing.rank, hit.rank)
      continue
    }
    grouped.set(canonical.id, {
      id: canonical.id,
      title: canonical.title,
      status: canonical.status,
      due_at: canonical.due_at,
      aliases: canonicalAliases(db, canonical.id).filter((title) => title !== canonical.title),
      rank: hit.rank,
    })
  }
  return [...grouped.values()]
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .slice(0, topK)
}
