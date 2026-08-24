import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../src/storage/db.ts'
import * as repo from '../src/storage/repository.ts'

const SCOPE = 'trust/main'
let db: DB

beforeEach(() => {
  db = openDb(':memory:')
})

afterEach(() => {
  if (db.isOpen) db.close()
})

describe('attention trust storage', () => {
  it('merges seen, suppression and feedback only for one immutable judgment key', () => {
    const { row: todo } = repo.upsertTodo(db, { title: '确认上线窗口', scope_key: SCOPE })
    const key = {
      scope_key: SCOPE,
      todo_id: todo.id,
      reason_version: 'attention-v1',
      evidence_fingerprint: 'fp-1',
    }
    const seen = repo.recordAttentionFeedback(db, key, { seen_at: 100 })
    expect(seen).toMatchObject({ ...key, seen_at: 100, suppressed_until: null, feedback_reason: null })

    repo.recordAttentionFeedback(db, key, { seen_at: 200, suppressed_until: 500 })
    const merged = repo.recordAttentionFeedback(db, key, { feedback_reason: 'wrong_time' })
    expect(merged).toMatchObject({ seen_at: 100, suppressed_until: 500, feedback_reason: 'wrong_time' })
    expect(repo.listAttentionFeedback(db, SCOPE)).toHaveLength(1)

    repo.recordAttentionFeedback(db, { ...key, evidence_fingerprint: 'fp-2' }, { seen_at: 300 })
    expect(repo.listAttentionFeedback(db, SCOPE)).toHaveLength(2)
  })

  it('creates the new tables idempotently across repeated database opens', () => {
    db.close()
    const dir = mkdtempSync(join(tmpdir(), 'yolo-trust-migration-'))
    const path = join(dir, 'legacy.db')
    closeSync(openSync(path, 'w'))
    try {
      const first = openDb(path)
      const todo = repo.upsertTodo(first, { title: '整理客户回访', scope_key: SCOPE }).row
      repo.recordAttentionFeedback(first, {
        scope_key: SCOPE,
        todo_id: todo.id,
        reason_version: 'attention-v1',
        evidence_fingerprint: 'fp',
      }, { seen_at: 1 })
      first.close()

      const second = openDb(path)
      const tables = second.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
      expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining(['attention_feedback', 'client_actions']))
      expect(repo.listAttentionFeedback(second, SCOPE)).toHaveLength(1)
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    db = openDb(':memory:')
  })
})
