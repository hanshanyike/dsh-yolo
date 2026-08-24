// YOLO storage layer unit tests — exercises the pure repository/db/search/snapshot
// functions against an in-memory SQLite DB (no Cordis host needed).

import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type DB } from '../src/storage/db.ts'
import * as repo from '../src/storage/repository.ts'
import { ftsSearch, toFtsPhrase } from '../src/storage/search.ts'
import { renderSnapshot } from '../src/storage/snapshot.ts'

const SCOPE = 'testscope/main'

let db: DB

beforeEach(() => {
  db = openDb(':memory:')
})

describe('db + schema', () => {
  it('opens and creates all tables', () => {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const tableNames = names.map((t) => t.name)
    for (const t of ['meta', 'user_profile', 'milestones', 'todos', 'goals', 'preferences', 'preference_history', 'events', 'extraction_log', 'pending_reminders', 'yolo_fts']) {
      expect(tableNames).toContain(t)
    }
  })
})

describe('notification popup feed', () => {
  it('returns only the bounded newest open reminders', () => {
    const older = repo.addNotification(db, { kind: 'reminder', title: '把演示稿发给研发', scope_key: SCOPE })
    repo.addNotification(db, { kind: 'brief', title: '今日简报', scope_key: SCOPE })
    const newer = repo.addNotification(db, { kind: 'reminder', title: '核对发布清单', scope_key: SCOPE })

    expect(repo.listRecentUnhandledReminders(db, SCOPE, 1).map((row) => row.id)).toEqual([newer.id])
    repo.markNotificationHandled(db, newer.id)
    expect(repo.listRecentUnhandledReminders(db, SCOPE, 5).map((row) => row.id)).toEqual([older.id])
  })
})

describe('todos', () => {
  it('dedupes by normalized title and merges due_at', () => {
    repo.upsertTodo(db, { title: '完成报告', scope_key: SCOPE })
    repo.upsertTodo(db, { title: '完成报告', due_at: '2026-08-21', priority: 'high', scope_key: SCOPE })
    const todos = repo.listTodos(db, SCOPE)
    expect(todos).toHaveLength(1)
    expect(todos[0].due_at).toBe('2026-08-21')
    expect(todos[0].priority).toBe('high')
  })

  it('keeps the persisted todo title and its FTS projection identical after a normalized-title upsert', () => {
    const first = repo.upsertTodo(db, { title: 'Prepare Q3 Report', scope_key: SCOPE })
    const second = repo.upsertTodo(db, { title: 'Prepare Q3 Report!!!', scope_key: SCOPE })
    expect(second.row.id).toBe(first.row.id)

    const indexed = db
      .prepare("SELECT title FROM yolo_fts WHERE row_type = 'todo' AND row_id = ?")
      .get(first.row.id) as { title: string }
    expect(indexed.title).toBe(second.row.title)
  })

  it('setTodoStatus(done) sets completed_at and stops matching search', () => {
    const { row: t } = repo.upsertTodo(db, { title: 'ship the feature', scope_key: SCOPE })
    repo.setTodoStatus(db, t.id, 'done')
    expect(repo.listTodos(db, SCOPE, 'done')).toHaveLength(1)
    // FTS row removed for done todos
    expect(ftsSearch(db, 'ship')).toHaveLength(0)
  })

  it('lists due todos before a cutoff', () => {
    repo.upsertTodo(db, { title: 'past', due_at: '2026-01-01', scope_key: SCOPE })
    repo.upsertTodo(db, { title: 'future', due_at: '2099-01-01', scope_key: SCOPE })
    expect(repo.listDueTodos(db, SCOPE, '2026-08-20')).toHaveLength(1)
  })
})

describe('milestones & goals', () => {
  it('upserts milestone and updates target_date on re-insert', () => {
    repo.upsertMilestone(db, { title: 'M1', scope_key: SCOPE })
    repo.upsertMilestone(db, { title: 'M1', target_date: '2026-09-01', scope_key: SCOPE })
    const ms = repo.listMilestones(db, SCOPE)
    expect(ms).toHaveLength(1)
    expect(ms[0].target_date).toBe('2026-09-01')
  })

  it('goal is idempotent (re-insert does not duplicate) and progress clamps', () => {
    repo.upsertGoal(db, { title: '掌握 dsh', scope_key: SCOPE })
    repo.upsertGoal(db, { title: '掌握 dsh', scope_key: SCOPE })
    expect(repo.listGoals(db, SCOPE)).toHaveLength(1)
    const g = repo.listGoals(db, SCOPE)[0]
    repo.setGoalProgress(db, g.id, 150)
    expect(repo.listGoals(db, SCOPE, 'achieved')[0].progress).toBe(100)
  })

  it('setMilestoneStatus(done) stops matching search (FTS soft-delete)', () => {
    const m = repo.upsertMilestone(db, { title: 'finish milestone tests', scope_key: SCOPE })
    expect(ftsSearch(db, 'milestone tests')).toHaveLength(1)
    repo.setMilestoneStatus(db, m.id, 'done')
    expect(ftsSearch(db, 'milestone tests')).toHaveLength(0)
  })

  it('restores milestone searchability when a terminal milestone is reopened', () => {
    const m = repo.upsertMilestone(db, { title: '恢复发布里程碑', scope_key: SCOPE })
    repo.setMilestoneStatus(db, m.id, 'done')
    expect(ftsSearch(db, '发布里程碑', 5, ['milestone'])).toHaveLength(0)

    repo.setMilestoneStatus(db, m.id, 'active')
    expect(ftsSearch(db, '发布里程碑', 5, ['milestone'])).toHaveLength(1)
  })
})

describe('preferences', () => {
  it('upserts and bumps confidence on repeat', () => {
    repo.upsertPreference(db, { key: 'lang', value: 'zh', scope_key: SCOPE })
    repo.upsertPreference(db, { key: 'lang', value: 'zh', scope_key: SCOPE })
    const p = repo.listPreferences(db, SCOPE)
    expect(p).toHaveLength(1)
    expect(p[0].confidence).toBeGreaterThan(0.5)
    expect(p[0].value).toBe('zh')
    expect(repo.listPreferenceHistory(db, SCOPE)).toHaveLength(0)
  })

  it('supersedes a changed value, keeping one current row and a history trail (R14)', () => {
    repo.upsertPreference(db, { key: 'port', value: '8080', scope_key: SCOPE, session_id: 's1' })
    repo.upsertPreference(db, { key: 'port', value: '9090', scope_key: SCOPE, session_id: 's2' })
    const p = repo.listPreferences(db, SCOPE)
    expect(p).toHaveLength(1)
    expect(p[0].value).toBe('9090')
    expect(p[0].session_id).toBe('s2')
    expect(p[0].valid_at).not.toBeNull()
    expect(p[0].invalid_at ?? null).toBeNull()
    // the superseded fact is preserved (证据溯源), with the old source
    const h = repo.listPreferenceHistory(db, SCOPE)
    expect(h).toHaveLength(1)
    expect(h[0].value).toBe('8080')
    expect(h[0].session_id).toBe('s1')
    expect(h[0].invalid_at).not.toBeNull()
  })

  it('does not recall a superseded preference from FTS (R14 auto-expire)', () => {
    repo.upsertPreference(db, { key: 'port', value: '8080', scope_key: SCOPE })
    repo.upsertPreference(db, { key: 'port', value: '9090', scope_key: SCOPE })
    const hits = ftsSearch(db, '8080')
    expect(hits.filter((h) => h.row_type === 'preference')).toHaveLength(0)
  })
})

describe('events', () => {
  it('addEvent returns the generated UUID row (not a rowid) and persists it', () => {
    const e = repo.addEvent(db, { kind: 'decision', summary: 'chose trigram', scope_key: SCOPE })
    expect(e).not.toBeNull()
    // UUID shape, not a numeric rowid string
    expect(e!.id).toMatch(/^[0-9a-f-]{36}$/)
    const stored = repo.listEvents(db, SCOPE)
    expect(stored.some((x) => x.id === e!.id)).toBe(true)
  })
})

describe('search (trigram, CJK)', () => {
  it('matches a 4-char CJK substring of an inserted todo', () => {
    repo.upsertTodo(db, { title: '完成季度报告', scope_key: SCOPE })
    const hits = ftsSearch(db, '季度报告')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].row_type).toBe('todo')
  })

  it('matches English tokens', () => {
    repo.upsertMilestone(db, { title: 'release yolo v1', scope_key: SCOPE })
    const hits = ftsSearch(db, 'release')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].row_type).toBe('milestone')
  })

  it('filters by row kind', () => {
    repo.upsertTodo(db, { title: 'review pr', scope_key: SCOPE })
    repo.upsertMilestone(db, { title: 'review milestone', scope_key: SCOPE })
    const onlyTodos = ftsSearch(db, 'review', 5, ['todo'])
    expect(onlyTodos.every((h) => h.row_type === 'todo')).toBe(true)
  })

  // regression: raw user text is FTS5 query syntax — special characters used
  // to throw "fts5: syntax error near ..." and kill the whole turn
  it.each([
    '<div>',
    'a<b 和 a>b',
    'he said "done" AND THEN (not OR)',
    'C:\\Users\\x*y',
    'NOT NEAR ^col:token',
  ])('treats FTS5 syntax characters as literals: %s', (q) => {
    repo.upsertTodo(db, { title: 'stable row', scope_key: SCOPE })
    expect(() => ftsSearch(db, q)).not.toThrow()
  })

  it('caps query length instead of scanning a pasted blob', () => {
    repo.upsertTodo(db, { title: 'stable row', scope_key: SCOPE })
    expect(() => ftsSearch(db, '头'.repeat(10_000))).not.toThrow()
  })

  it('toFtsPhrase doubles embedded quotes and wraps in phrase quotes', () => {
    expect(toFtsPhrase('he said "hi"')).toBe('"he said ""hi"""')
    expect(toFtsPhrase('plain')).toBe('"plain"')
  })

  it('a quoted phrase still hits rows containing that literal substring', () => {
    repo.upsertTodo(db, { title: '修复 <div> 渲染问题', scope_key: SCOPE })
    const hits = ftsSearch(db, '<div> 渲染')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })
})

describe('snapshot', () => {
  it('renders a non-empty markdown with expected sections', () => {
    repo.upsertTodo(db, { title: '写文档', scope_key: SCOPE })
    repo.upsertGoal(db, { title: '上线 yolo', scope_key: SCOPE })
    repo.addEvent(db, { kind: 'note', summary: 'M1 推进', scope_key: SCOPE })
    const md = renderSnapshot(db, SCOPE, '/tmp/test')
    expect(md).toContain('# YOLO Snapshot')
    expect(md).toContain('## Active Goals')
    expect(md).toContain('上线 yolo')
    expect(md).toContain('写文档')
    expect(md).toContain('M1 推进')
  })
})

describe('reminders + extraction log', () => {
  it('queues, lists, and deletes pending reminders', () => {
    const { row: t } = repo.upsertTodo(db, { title: 'call mom', due_at: '2026-08-20', scope_key: SCOPE })
    repo.queuePendingReminder(db, { todo_id: t.id, fire_at: 1000, payload: 'remind: call mom', scope_key: SCOPE })
    expect(repo.listPendingReminders(db, SCOPE, 2000)).toHaveLength(1)
    const [r] = repo.listPendingReminders(db, SCOPE, 2000)
    repo.deletePendingReminder(db, r.id)
    expect(repo.listPendingReminders(db, SCOPE, 2000)).toHaveLength(0)
  })

  it('logs extraction runs and reports last timestamp', () => {
    repo.logExtraction(db, { session_id: 's1', turn_seq: 1, strategy: 'llm', status: 'ok' })
    repo.logExtraction(db, { session_id: 's1', turn_seq: 2, strategy: 'llm', status: 'error', error: 'boom' })
    const last = repo.lastExtractionAt(db, 's1', 'llm')
    expect(last).toBeDefined()
    expect(repo.lastExtractionAt(db, 'other', 'llm')).toBeUndefined()
  })
})
