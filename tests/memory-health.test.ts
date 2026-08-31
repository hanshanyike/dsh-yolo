// v0.3.0 memory-health tests — buildMemoryHealth aggregates recall/extraction
// quality + duplicate-todo candidates. R3 combines semantic resolver evidence,
// protected fuzzy matching and explicit user suppression within one scope.

import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type DB } from '../src/storage/db.ts'
import * as repo from '../src/storage/repository.ts'
import { buildMemoryHealth } from '../src/ui/dashboard.ts'
import type Yolo from '../src/storage/index.ts'
import type { YoloMemoryHealth } from '../src/shared/dashboard.ts'

const SCOPE = 'test/main'

function healthYolo(overrides: Partial<Record<keyof YoloMemoryHealth, unknown>>): Yolo {

  return {
    countRecallSince: () => (overrides.recallRunsToday as number) ?? 0,
    countRecallStatusSince: (cwd: string, status: string) => {
      void cwd
      if (status === 'ok') return (overrides.recallHitRate as number ?? 0) > 0 ? 3 : 0
      if (status === 'error') return (overrides.recallErrorsToday as number) ?? 0
      return 0
    },
    countExtractionErrorsSince: () => (overrides.extractionErrorsToday as number) ?? 0,
    countEventKindSince: () => (overrides.deniedToday as number) ?? 0,
    listDuplicateTodos: () => (overrides.duplicateTodos as import('../src/storage/types.ts').DuplicateTodoPair[]) ?? [],
  } as unknown as Yolo
}

describe('buildMemoryHealth', () => {
  it('computes recall hit rate and aggregates error/denied counts', () => {
    const yolo = healthYolo({ recallRunsToday: 10, recallHitRate: 1, recallErrorsToday: 2, extractionErrorsToday: 1, deniedToday: 3, duplicateTodos: [{ a: 't1', b: 't2', aTitle: '写周报', bTitle: '写 周报' }] })
    const h = buildMemoryHealth(yolo, 'C:\\work\\proj')
    expect(h.recallRunsToday).toBe(10)
    expect(h.recallHitRate).toBe(0.3) // 3 ok / 10
    expect(h.recallErrorsToday).toBe(2)
    expect(h.extractionErrorsToday).toBe(1)
    expect(h.deniedToday).toBe(3)
    expect(h.duplicateTodos).toHaveLength(1)
  })

  it('reports a zero hit rate when there were no runs', () => {
    const yolo = healthYolo({ recallRunsToday: 0 })
    expect(buildMemoryHealth(yolo, 'C:\\work\\proj').recallHitRate).toBe(0)
  })
})

describe('listDuplicateTodos (repo)', () => {
  let db: DB
  beforeEach(() => {
    db = openDb(':memory:')
  })

  it('returns a pair for two open todos that normalize to the same title', () => {
    const now = Date.now()
    // Direct inserts so the dedup_key merge in upsertTodo doesn't collapse them:
    // '-' and a space both normalize to a single space, so both collide on normalize().
    db.prepare("INSERT INTO todos(id, title, status, scope_key, created_at, updated_at) VALUES(?,?,?,?,?,?)").run('a', '提醒我-周三交周报', 'pending', SCOPE, now, now)
    db.prepare("INSERT INTO todos(id, title, status, scope_key, created_at, updated_at) VALUES(?,?,?,?,?,?)").run('b', '提醒我 周三交周报', 'pending', SCOPE, now, now)
    const pairs = repo.listDuplicateTodos(db, SCOPE)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].a).toBe('a')
    expect(pairs[0].b).toBe('b')
    expect(pairs[0].aTitle).toBe('提醒我-周三交周报')
    expect(pairs[0].bTitle).toBe('提醒我 周三交周报')
    expect(pairs[0]).toMatchObject({ source: 'exact', confidence: 1 })
  })

  it('includes terminal/open conflicts for confirmation and ignores different titles', () => {
    const now = Date.now()
    db.prepare("INSERT INTO todos(id,title,status,scope_key,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run('open', '只做-一次', 'pending', SCOPE, now, now)
    db.prepare("INSERT INTO todos(id,title,status,scope_key,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run('done', '只做 一次', 'done', SCOPE, now + 1, now + 1)
    repo.upsertTodo(db, { title: '另一个任务', scope_key: SCOPE, source: 'manual' })
    expect(repo.listDuplicateTodos(db, SCOPE)).toEqual([
      expect.objectContaining({ scopeKey: SCOPE, a: 'open', b: 'done', source: 'exact', confidence: 1 }),
    ])
  })

  it('projects model semantic evidence with its confidence/reason and permanently suppresses rejected pairs', () => {
    const candidate = repo.upsertTodo(db, { title: '把演示稿发给研发', scope_key: SCOPE, source: 'manual' }).row
    const created = repo.upsertTodo(db, { title: '将最终版 PPT 同步到开发团队', scope_key: SCOPE, source: 'llm' }).row
    repo.addTodoEvidence(db, {
      todo_id: created.id, source_scope_key: SCOPE, session_id: 'semantic-session', turn_seq: 2,
      source_kind: 'human', relation: 'origin', excerpt: '最终版 PPT 也要同步给开发团队',
      occurred_at: Date.now(), source_fingerprint: 'semantic-origin',
    })
    repo.logTodoResolution(db, {
      scope_key: SCOPE, session_id: 'semantic-session', turn_seq: 2, operation_id: 'semantic-operation',
      input_fingerprint: 'semantic-input', input_excerpt: '最终版 PPT 也要同步给开发团队', resolver_version: 'shadow-v2',
      model_provider: 'provider', model_name: 'model', status: 'ok',
      candidates_json: JSON.stringify([{ id: candidate.id, title: candidate.title, status: candidate.status }]),
      resolutions_json: JSON.stringify([{
        decision: 'LINK', candidate_ids: [candidate.id], confidence: 0.84,
        reason: '交付物和接收团队一致，只是换了说法。',
      }]),
    })

    expect(repo.listDuplicateTodos(db, SCOPE)).toEqual([
      expect.objectContaining({
        a: candidate.id, b: created.id, source: 'resolver', confidence: 0.84,
        reason: expect.stringContaining('交付物和接收团队一致'),
      }),
    ])
    const feedback = repo.dismissTodoMergeSuggestion(db, SCOPE, candidate.id, created.id, '这是两个不同版本')
    expect(feedback).toMatchObject({ verdict: 'not_duplicate', reason: '这是两个不同版本' })
    expect(repo.listDuplicateTodos(db, SCOPE)).toEqual([])
    expect(repo.listEvents(db, SCOPE)[0]).toMatchObject({ kind: 'todo_merge_suggestion_dismissed' })
    expect(repo.dismissTodoMergeSuggestion(db, SCOPE, created.id, candidate.id)).toEqual(feedback)
    expect(repo.listEvents(db, SCOPE)).toHaveLength(1)
  })
})



