// M8 domain-action tests — state transitions with event audit + fuzzy title
// lookup, exercised against an in-memory SQLite DB.

import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type DB } from '../src/storage/db.ts'
import * as repo from '../src/storage/repository.ts'
import { ftsSearch } from '../src/storage/search.ts'

const SCOPE = 'testscope/main'

let db: DB

beforeEach(() => {
  db = openDb(':memory:')
})

function lastEvent(): { kind: string; summary: string } | undefined {
  const events = repo.listEvents(db, SCOPE)
  return events[0]
}

describe('applyTodoAction', () => {
  it('complete marks done, stamps completed_at, removes from FTS, writes event', () => {
    const t = repo.upsertTodo(db, { title: '写季度报告初稿', scope_key: SCOPE })
    const done = repo.applyTodoAction(db, t.id, 'complete')
    expect(done?.status).toBe('done')
    expect(done?.completed_at).toBeTruthy()
    expect(repo.listTodos(db, SCOPE, 'done')).toHaveLength(1)
    // the todo row itself left the index (the completion *event* still matches)
    expect(ftsSearch(db, '季度报告', 5, ['todo'])).toHaveLength(0)
    expect(lastEvent()?.kind).toBe('todo_completed')
    expect(lastEvent()?.summary).toContain('写季度报告初稿')
  })

  it('complete is idempotent — no duplicate event on a done todo', () => {
    const t = repo.upsertTodo(db, { title: '任务A', scope_key: SCOPE })
    repo.applyTodoAction(db, t.id, 'complete')
    repo.applyTodoAction(db, t.id, 'complete')
    expect(repo.listEvents(db, SCOPE).filter((e) => e.kind === 'todo_completed')).toHaveLength(1)
  })

  it('cancel writes a todo_cancelled event', () => {
    const t = repo.upsertTodo(db, { title: '不再需要的任务', scope_key: SCOPE })
    const cancelled = repo.applyTodoAction(db, t.id, 'cancel')
    expect(cancelled?.status).toBe('cancelled')
    expect(lastEvent()?.kind).toBe('todo_cancelled')
  })

  it('postpone moves due_at, clears the reminder stamp, writes an event', () => {
    const t = repo.upsertTodo(db, { title: '交材料', due_at: '2026-08-22', scope_key: SCOPE })
    repo.setTodoReminded(db, t.id)
    const moved = repo.applyTodoAction(db, t.id, 'postpone', { due_at: '2026-08-25' })
    expect(moved?.due_at).toBe('2026-08-25')
    expect(moved?.last_reminded_at).toBeNull()
    expect(lastEvent()?.kind).toBe('todo_postponed')
    expect(lastEvent()?.summary).toContain('2026-08-25')
    // cleared stamp => due scan picks it up again
    expect(repo.listDueTodos(db, SCOPE, '2026-08-26')).toHaveLength(1)
  })

  it('postpone without a due_at no-ops', () => {
    const t = repo.upsertTodo(db, { title: '无日期任务', due_at: '2026-08-22', scope_key: SCOPE })
    const moved = repo.applyTodoAction(db, t.id, 'postpone')
    expect(moved?.due_at).toBe('2026-08-22')
    expect(repo.listEvents(db, SCOPE)).toHaveLength(0)
  })

  it('remind_again clears the stamp so the scheduler re-fires', () => {
    const t = repo.upsertTodo(db, { title: '循环任务', due_at: '2026-08-01', scope_key: SCOPE })
    repo.setTodoReminded(db, t.id, 1000)
    expect(repo.listDueTodos(db, SCOPE, '2026-08-22')).toHaveLength(0)
    repo.applyTodoAction(db, t.id, 'remind_again')
    expect(repo.listDueTodos(db, SCOPE, '2026-08-22')).toHaveLength(1)
    expect(lastEvent()?.kind).toBe('todo_remind_again')
  })

  it('returns null for an unknown id', () => {
    expect(repo.applyTodoAction(db, 'nope', 'complete')).toBeNull()
  })
})

describe('applyGoalProgress', () => {
  it('sets progress, writes a goal_progress event, 100 flips to achieved', () => {
    const g = repo.upsertGoal(db, { title: '学会 Rust', scope_key: SCOPE })
    const mid = repo.applyGoalProgress(db, g.id, 40, '所有权过半')
    expect(mid?.progress).toBe(40)
    expect(mid?.status).toBe('active')
    expect(lastEvent()?.kind).toBe('goal_progress')
    expect(lastEvent()?.summary).toContain('40%')
    const end = repo.applyGoalProgress(db, g.id, 100)
    expect(end?.status).toBe('achieved')
    expect(end?.progress).toBe(100)
  })

  it('clamps out-of-range progress', () => {
    const g = repo.upsertGoal(db, { title: '边界目标', scope_key: SCOPE })
    expect(repo.applyGoalProgress(db, g.id, 250)?.progress).toBe(100)
    expect(repo.applyGoalProgress(db, g.id, -10)?.progress).toBe(0)
  })

  it('rounds fractional progress', () => {
    const g = repo.upsertGoal(db, { title: '小数目标', scope_key: SCOPE })
    expect(repo.applyGoalProgress(db, g.id, 45.6)?.progress).toBe(46)
  })
})

describe('applyMilestoneStatus', () => {
  it('transitions and writes a milestone_status event; same status no-ops', () => {
    const m = repo.upsertMilestone(db, { title: 'v0.3 发布', scope_key: SCOPE })
    const done = repo.applyMilestoneStatus(db, m.id, 'done')
    expect(done?.status).toBe('done')
    expect(lastEvent()?.kind).toBe('milestone_status')
    expect(lastEvent()?.summary).toContain('v0.3 发布')
    repo.applyMilestoneStatus(db, m.id, 'done') // idempotent
    expect(repo.listEvents(db, SCOPE).filter((e) => e.kind === 'milestone_status')).toHaveLength(1)
  })
})

describe('fuzzy title finders', () => {
  it('findTodoByTitle: exact, containment, skips terminal and foreign scope', () => {
    const a = repo.upsertTodo(db, { title: '写季度报告初稿', scope_key: SCOPE })
    const b = repo.upsertTodo(db, { title: '修 登录bug', scope_key: SCOPE })
    repo.upsertTodo(db, { title: '已完成的旧任务', scope_key: SCOPE })
    repo.setTodoStatus(db, repo.listTodos(db, SCOPE).find((t) => t.title === '已完成的旧任务')!.id, 'done')
    repo.upsertTodo(db, { title: '另一个工作区的事', scope_key: 'other/scope' })

    expect(repo.findTodoByTitle(db, SCOPE, '写季度报告初稿')?.id).toBe(a.id)
    expect(repo.findTodoByTitle(db, SCOPE, '季度报告')?.id).toBe(a.id) // containment, 4 chars
    expect(repo.findTodoByTitle(db, SCOPE, '修登录bug')?.id).toBe(b.id) // whitespace collapsed
    expect(repo.findTodoByTitle(db, SCOPE, '旧任务')).toBeUndefined() // done todos not matched
    expect(repo.findTodoByTitle(db, SCOPE, '另一个工作区的事')).toBeUndefined() // other scope
    expect(repo.findTodoByTitle(db, SCOPE, '')).toBeUndefined()
  })

  it('short queries below the containment floor do not fuzzy-match', () => {
    repo.upsertTodo(db, { title: '完成年度总结报告', scope_key: SCOPE })
    expect(repo.findTodoByTitle(db, SCOPE, '报告')).toBeUndefined() // 2 chars < 3
  })

  it('findGoalByTitle only matches active goals', () => {
    const g = repo.upsertGoal(db, { title: '完成论文', scope_key: SCOPE })
    repo.setGoalProgress(db, g.id, 100) // -> achieved
    expect(repo.findGoalByTitle(db, SCOPE, '完成论文')).toBeUndefined()
  })

  it('findMilestoneByTitle only matches non-terminal milestones', () => {
    const m = repo.upsertMilestone(db, { title: '上线里程碑', scope_key: SCOPE })
    expect(repo.findMilestoneByTitle(db, SCOPE, '上线里程碑')?.id).toBe(m.id)
    repo.setMilestoneStatus(db, m.id, 'abandoned')
    expect(repo.findMilestoneByTitle(db, SCOPE, '上线里程碑')).toBeUndefined()
  })
})
