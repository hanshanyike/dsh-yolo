// v0.3.0 memory-health tests — buildMemoryHealth aggregates recall/extraction
// quality + duplicate-todo candidates, and listDuplicateTodos finds open-todo
// near-duplicates (normalized-title collision) within a scope.

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
    listDuplicateTodos: () => (overrides.duplicateTodos as Array<{ a: string; b: string }>) ?? [],
  } as unknown as Yolo
}

describe('buildMemoryHealth', () => {
  it('computes recall hit rate and aggregates error/denied counts', () => {
    const yolo = healthYolo({ recallRunsToday: 10, recallHitRate: 1, recallErrorsToday: 2, extractionErrorsToday: 1, deniedToday: 3, duplicateTodos: [{ a: 't1', b: 't2' }] })
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
  })

  it('ignores terminal todos and different-titled todos', () => {
    repo.upsertTodo(db, { title: '只做一次', scope_key: SCOPE, source: 'manual' })
    repo.upsertTodo(db, { title: '另一个任务', scope_key: SCOPE, source: 'manual' })
    const done = repo.upsertTodo(db, { title: '只做一次', scope_key: SCOPE, source: 'manual' }).row
    repo.setTodoStatus(db, done.id, 'done')
    expect(repo.listDuplicateTodos(db, SCOPE)).toEqual([])
  })
})



