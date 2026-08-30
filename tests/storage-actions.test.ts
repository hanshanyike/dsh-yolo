// M8 domain-action tests — state transitions with event audit + fuzzy title
// lookup, exercised against an in-memory SQLite DB.
// M9 additions: applyTodoConsolidate (P35) and the action_denied audit trail
// (P34) driven through the shared applyYoloAction dispatch over a temp dir.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { openDb, type DB } from '../src/storage/db.ts'
import * as repo from '../src/storage/repository.ts'
import Yolo from '../src/storage/index.ts'
import { applyYoloAction } from '../src/shared/actions.ts'
import { ftsSearch } from '../src/storage/search.ts'

const SCOPE = 'testscope/main'

let db: DB

beforeEach(() => {
  db = openDb(':memory:')
})

function lastEvent() {
  const events = repo.listEvents(db, SCOPE)
  return events[0]
}

describe('applyTodoAction', () => {
  it('complete marks done, stamps completed_at, removes from FTS, writes event', () => {
    const { row: t } = repo.upsertTodo(db, { title: '写季度报告初稿', scope_key: SCOPE })
    const done = repo.applyTodoAction(db, t.id, 'complete')
    expect(done?.status).toBe('done')
    expect(done?.completed_at).toBeTruthy()
    expect(repo.listTodos(db, SCOPE, 'done')).toHaveLength(1)
    // the todo row itself left the index (the completion *event* still matches)
    expect(ftsSearch(db, '季度报告', 5, ['todo'])).toHaveLength(0)
    expect(lastEvent()?.kind).toBe('todo_completed')
    expect(lastEvent()?.summary).toContain('写季度报告初稿')
    expect(lastEvent()).toMatchObject({
      subject_type: 'todo', subject_id: t.id, subject_title: '写季度报告初稿',
      change: { status: { before: 'pending', after: 'done' } },
    })
  })

  it('complete is idempotent — no duplicate event on a done todo', () => {
    const { row: t } = repo.upsertTodo(db, { title: '任务A', scope_key: SCOPE })
    repo.applyTodoAction(db, t.id, 'complete')
    repo.applyTodoAction(db, t.id, 'complete')
    expect(repo.listEvents(db, SCOPE).filter((e) => e.kind === 'todo_completed')).toHaveLength(1)
  })

  it('reopen undoes a completion — status back, completed_at cleared, FTS restored, event written', () => {
    const { row: t } = repo.upsertTodo(db, { title: '给下周产品评审做演示预演', scope_key: SCOPE })
    repo.applyTodoAction(db, t.id, 'complete')
    expect(ftsSearch(db, '演示预演', 5, ['todo'])).toHaveLength(0)

    const back = repo.applyTodoAction(db, t.id, 'reopen')
    expect(back?.status).toBe('pending')
    expect(back?.completed_at).toBeNull()
    expect(repo.listTodos(db, SCOPE, 'done')).toHaveLength(0)
    expect(repo.listTodos(db, SCOPE, 'pending')).toHaveLength(1)
    expect(ftsSearch(db, '演示预演', 5, ['todo'])).toHaveLength(1)
    expect(lastEvent()?.kind).toBe('todo_reopened')
    expect(lastEvent()?.summary).toContain('给下周产品评审做演示预演')
  })

  it('reopen clears the old reminder stamp so an unfinished due todo can fire again', () => {
    const { row: t } = repo.upsertTodo(db, {
      title: '撤销完成后继续提醒我提交报销单',
      due_at: '2026-08-22',
      scope_key: SCOPE,
    })
    repo.setTodoReminded(db, t.id, 1_000)
    repo.applyTodoAction(db, t.id, 'complete')

    const reopened = repo.applyTodoAction(db, t.id, 'reopen')
    expect(reopened?.last_reminded_at).toBeNull()
    expect(repo.listDueTodos(db, SCOPE, '2026-08-23')).toHaveLength(1)
  })

  it('reopen on an open todo no-ops — no state change, no event', () => {
    const { row: t } = repo.upsertTodo(db, { title: '未完成任务', scope_key: SCOPE })
    const same = repo.applyTodoAction(db, t.id, 'reopen')
    expect(same?.status).toBe('pending')
    expect(repo.listEvents(db, SCOPE)).toHaveLength(0)
  })

  it('reopen restores a cancelled todo and its search projection', () => {
    const { row: t } = repo.upsertTodo(db, { title: '重新确认客户访谈时间', scope_key: SCOPE })
    repo.applyTodoAction(db, t.id, 'cancel')

    const reopened = repo.applyTodoAction(db, t.id, 'reopen')

    expect(reopened?.status).toBe('pending')
    expect(ftsSearch(db, '客户访谈', 5, ['todo']).map((row) => row.row_id)).toContain(t.id)
    expect(lastEvent()).toMatchObject({ kind: 'todo_reopened', summary: '重新打开：重新确认客户访谈时间' })
  })

  it('cancel writes a todo_cancelled event', () => {
    const { row: t } = repo.upsertTodo(db, { title: '不再需要的任务', scope_key: SCOPE })
    const cancelled = repo.applyTodoAction(db, t.id, 'cancel')
    expect(cancelled?.status).toBe('cancelled')
    expect(lastEvent()?.kind).toBe('todo_cancelled')
  })

  it('feedback counters: complete bumps good, cancel bumps stale (P/B1)', () => {
    const { row: t } = repo.upsertTodo(db, { title: '跟进收款', scope_key: SCOPE })
    repo.applyTodoAction(db, t.id, 'complete')
    repo.applyTodoAction(db, t.id, 'reopen')
    repo.applyTodoAction(db, t.id, 'complete')
    expect(repo.applyTodoAction(db, t.id, 'complete')?.good_count).toBe(2)

    const { row: c } = repo.upsertTodo(db, { title: '过期的需求', scope_key: SCOPE })
    repo.applyTodoAction(db, c.id, 'cancel')
    expect(repo.applyTodoAction(db, c.id, 'cancel')?.stale_count).toBe(1)
  })

  it('title locate prefers an exact match over a loose containment match (B6)', () => {
    repo.upsertTodo(db, { title: '并发评审', scope_key: SCOPE })
    repo.upsertTodo(db, { title: '并发评审后的复盘会', scope_key: SCOPE })
    // exact normalized title must win, not the first containment hit
    expect(repo.findTodoByTitle(db, SCOPE, '并发评审')?.title).toBe('并发评审')
  })

  it('stamps the originating session on the audit event', () => {
    const { row: t } = repo.upsertTodo(db, { title: '会话内完成的任务', scope_key: SCOPE })
    repo.applyTodoAction(db, t.id, 'complete', { session_id: 'session-abc' })
    expect(lastEvent()?.session_id).toBe('session-abc')
    // without a session (dashboard click), the event stays unattributed
    const { row: t2 } = repo.upsertTodo(db, { title: '看板点击完成的任务', scope_key: SCOPE })
    repo.applyTodoAction(db, t2.id, 'complete')
    expect(lastEvent()?.session_id).toBeNull()
  })

  it('postpone moves due_at, clears the reminder stamp, writes an event', () => {
    const { row: t } = repo.upsertTodo(db, { title: '交材料', due_at: '2026-08-22', scope_key: SCOPE })
    repo.setTodoReminded(db, t.id)
    const moved = repo.applyTodoAction(db, t.id, 'postpone', { due_at: '2026-08-25' })
    expect(moved?.due_at).toBe('2026-08-25')
    expect(moved?.last_reminded_at).toBeNull()
    expect(lastEvent()?.kind).toBe('todo_postponed')
    expect(lastEvent()?.summary).toContain('2026-08-25')
    expect(lastEvent()?.change).toEqual({ due_at: { before: '2026-08-22', after: '2026-08-25' } })
    // cleared stamp => due scan picks it up again
    expect(repo.listDueTodos(db, SCOPE, '2026-08-26')).toHaveLength(1)
  })

  it('postpone to the already persisted instant is a domain no-op', () => {
    const due = '2026-08-28T16:00:00+08:00'
    const { row: todo } = repo.upsertTodo(db, { title: '发送客户访谈纪要', due_at: due, scope_key: SCOPE })
    repo.applyTodoAction(db, todo.id, 'postpone', { due_at: due, session_id: 'session-background' })
    expect(repo.listEvents(db, SCOPE).filter((event) => event.kind === 'todo_postponed')).toHaveLength(0)
    expect(repo.listTodos(db, SCOPE).find((row) => row.id === todo.id)?.due_at).toBe(due)
  })

  it('postpone without a due_at no-ops', () => {
    const { row: t } = repo.upsertTodo(db, { title: '无日期任务', due_at: '2026-08-22', scope_key: SCOPE })
    const moved = repo.applyTodoAction(db, t.id, 'postpone')
    expect(moved?.due_at).toBe('2026-08-22')
    expect(repo.listEvents(db, SCOPE)).toHaveLength(0)
  })

  it('remind_again clears the stamp so the scheduler re-fires', () => {
    const { row: t } = repo.upsertTodo(db, { title: '循环任务', due_at: '2026-08-01', scope_key: SCOPE })
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
    const { row: a } = repo.upsertTodo(db, { title: '写季度报告初稿', scope_key: SCOPE })
    const { row: b } = repo.upsertTodo(db, { title: '修 登录bug', scope_key: SCOPE })
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

describe('applyTodoConsolidate', () => {
  it('merges a duplicate into its keeper: source status preserved, target enriched, audit and live reminders migrated', () => {
    const { row: source } = repo.upsertTodo(db, {
      title: '把演示稿发给研发',
      detail: '含附录数据',
      due_at: '2026-08-30',
      priority: 'high',
      scope_key: SCOPE,
    })
    const { row: target } = repo.upsertTodo(db, { title: '把演示稿发给研发组', detail: '评审版定稿后再发', priority: 'low', scope_key: SCOPE })
    repo.addNotification(db, { kind: 'reminder', title: '提醒：把演示稿发给研发', todo_id: source.id, scope_key: SCOPE })

    const res = repo.applyTodoConsolidate(db, { id: source.id }, { id: target.id }, 'session-merge')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const merged = res.target
    expect(merged.detail).toContain('评审版定稿后再发')
    expect(merged.detail).toContain('（已并入「把演示稿发给研发」，原截止 2026-08-30）')
    expect(merged.due_at).toBe('2026-08-30') // keeper had none -> inherits the source's
    expect(merged.priority).toBe('high') // higher of low/high wins
    expect(repo.listTodos(db, SCOPE).some((t) => t.id === source.id)).toBe(false)
    expect(repo.listTodoRecords(db, SCOPE).find((t) => t.id === source.id)).toMatchObject({
      status: 'pending', record_status: 'merged', merged_into_id: target.id,
    })
    expect(merged.id).toBe(target.id)

    // source left the index; only the keeper still matches
    const hits = ftsSearch(db, '演示稿', 5, ['todo'])
    expect(hits).toHaveLength(1)
    expect(hits[0].row_id).toBe(target.id)

    // exactly one audit event for the whole atomic merge
    const events = repo.listEvents(db, SCOPE)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('todo_consolidated')
    expect(events[0].summary).toBe('合并：「把演示稿发给研发」→「把演示稿发给研发组」')
    expect(events[0].detail).toContain('继承截止 2026-08-30')
    expect(events[0].detail).toContain('优先级升为 high')
    expect(events[0].session_id).toBe('session-merge')
    expect(events[0]).toMatchObject({
      subject_type: 'todo', subject_id: source.id, subject_title: source.title,
      related_subject_type: 'todo', related_subject_id: target.id, related_subject_title: target.title,
      change: { record_status: { before: 'canonical', after: 'merged' } },
    })
    // the source's unhandled reminder remains live and follows the keeper
    expect(repo.listUnhandledNotifications(db, SCOPE)).toEqual([
      expect.objectContaining({ todo_id: target.id, handled_at: null }),
    ])
  })

  it('keeps the keeper\'s own due date and priority when they are already the stronger ones', () => {
    const { row: source } = repo.upsertTodo(db, { title: '跟运营对齐双周排期', due_at: '2026-09-10', priority: 'medium', scope_key: SCOPE })
    const { row: target } = repo.upsertTodo(db, { title: '和运营对齐双周排期表', due_at: '2026-08-28', priority: 'urgent', scope_key: SCOPE })
    const res = repo.applyTodoConsolidate(db, { id: source.id }, { id: target.id })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.target.due_at).toBe('2026-08-28')
    expect(res.target.priority).toBe('urgent')
    // nothing was inherited -> the event records no inheritance
    expect(repo.listEvents(db, SCOPE)[0].detail).toBeNull()
  })

  it('resolves both sides by fuzzy title within the scope', () => {
    const { row: source } = repo.upsertTodo(db, { title: '把演示稿发给研发', due_at: '2026-08-30', scope_key: SCOPE })
    const { row: target } = repo.upsertTodo(db, { title: '跟运营对齐双周排期', scope_key: SCOPE })
    const res = repo.applyTodoConsolidate(db, { title: '演示稿' }, { title: '双周排期' }, null, SCOPE)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.target.id).toBe(target.id)
    expect(repo.listTodoRecords(db, SCOPE).find((t) => t.id === source.id)).toMatchObject({
      status: 'pending', record_status: 'merged', merged_into_id: target.id,
    })
  })

  it('refuses when source and target are the same row', () => {
    const { row: t } = repo.upsertTodo(db, { title: '把演示稿发给研发', scope_key: SCOPE })
    const res = repo.applyTodoConsolidate(db, { id: t.id }, { id: t.id })
    expect(res).toEqual({ ok: false, kind: 'same-item', error: 'source and target are the same todo' })
    expect(repo.listEvents(db, SCOPE)).toHaveLength(0)
  })

  it('allows terminal/open consolidation while keeping the target business status authoritative', () => {
    const { row: doneSrc } = repo.upsertTodo(db, { title: '已完成的旧任务', scope_key: SCOPE })
    const { row: openA } = repo.upsertTodo(db, { title: '把演示稿发给研发', scope_key: SCOPE })
    repo.applyTodoAction(db, doneSrc.id, 'complete')

    const res = repo.applyTodoConsolidate(db, { id: doneSrc.id }, { id: openA.id })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.target.status).toBe('pending')
    expect(repo.listTodoRecords(db, SCOPE).find((row) => row.id === doneSrc.id)).toMatchObject({
      status: 'done', record_status: 'merged', merged_into_id: openA.id,
    })

    const { row: openB } = repo.upsertTodo(db, { title: '跟运营对齐双周排期', scope_key: SCOPE })
    repo.setTodoStatus(db, openA.id, 'cancelled')
    const res2 = repo.applyTodoConsolidate(db, { id: openB.id }, { id: openA.id })
    expect(res2.ok).toBe(true)
    if (!res2.ok) return
    expect(res2.target.status).toBe('cancelled')
    expect(repo.listTodoRecords(db, SCOPE).find((row) => row.id === openB.id)).toMatchObject({
      status: 'pending', record_status: 'merged', merged_into_id: openA.id,
    })
    expect(repo.listEvents(db, SCOPE).filter((e) => e.kind === 'todo_consolidated')).toHaveLength(2)
  })

  it('does not reopen a merged historical record and resolves its evidence through the keeper', () => {
    const source = repo.upsertTodo(db, {
      title: '准备季度复盘材料', scope_key: SCOPE, source: 'llm', session_id: 'session-source',
      source_excerpt: '准备季度复盘材料', source_turn: 2, source_fingerprint: 'source-origin',
    }).row
    const target = repo.upsertTodo(db, {
      title: '整理季度复盘材料', scope_key: SCOPE, source: 'llm', session_id: 'session-target',
      source_excerpt: '整理季度复盘材料', source_turn: 4, source_fingerprint: 'target-origin',
    }).row
    expect(repo.applyTodoConsolidate(db, { id: source.id }, { id: target.id }).ok).toBe(true)

    const unchanged = repo.applyTodoAction(db, source.id, 'reopen')
    expect(unchanged).toMatchObject({ id: source.id, status: 'pending', record_status: 'merged', merged_into_id: target.id })
    expect(repo.resolveCanonicalTodo(db, source.id)?.id).toBe(target.id)
    expect(repo.listTodoEvidence(db, target.id).map((row) => row.session_id)).toEqual(['session-source', 'session-target'])
  })

  it('R3 migrates live reminder relations and can undo the merge without rewriting audit history', () => {
    const source = repo.upsertTodo(db, {
      title: '把客户访谈纪要发给产品组', due_at: '2026-09-05', priority: 'high', scope_key: SCOPE,
      source: 'llm', session_id: 'source-session', source_excerpt: '访谈纪要要发产品组', source_turn: 2,
      source_fingerprint: 'r3-source-evidence',
    }).row
    const target = repo.upsertTodo(db, {
      title: '发送客户访谈纪要给产品组', scope_key: SCOPE,
      source: 'llm', session_id: 'target-session', source_excerpt: '发送纪要', source_turn: 4,
      source_fingerprint: 'r3-target-evidence',
    }).row
    const notification = repo.addNotification(db, { kind: 'reminder', title: '记得发送纪要', todo_id: source.id, scope_key: SCOPE })
    repo.queuePendingReminder(db, { todo_id: source.id, fire_at: Date.now() + 60_000, payload: '发送纪要', scope_key: SCOPE })

    const merged = repo.applyTodoConsolidate(db, { id: source.id }, { id: target.id })
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.merge).toMatchObject({ source_id: source.id, target_id: target.id, status: 'active' })
    expect(db.prepare('SELECT todo_id,handled_at FROM notifications WHERE id=?').get(notification.id))
      .toEqual({ todo_id: target.id, handled_at: null })
    expect(db.prepare('SELECT todo_id FROM pending_reminders').get()).toEqual({ todo_id: target.id })
    expect(repo.listTodoEvidence(db, target.id).map((row) => row.session_id)).toEqual(['source-session', 'target-session'])

    const undone = repo.undoTodoConsolidation(db, merged.merge.id)
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.target_restore_status).toBe('applied')
    expect(undone.source).toMatchObject({ id: source.id, status: 'pending', record_status: 'canonical', merged_into_id: null })
    expect(undone.target).toMatchObject({ id: target.id, due_at: null, priority: null })
    expect(db.prepare('SELECT todo_id,handled_at FROM notifications WHERE id=?').get(notification.id))
      .toEqual({ todo_id: source.id, handled_at: null })
    expect(db.prepare('SELECT todo_id FROM pending_reminders').get()).toEqual({ todo_id: source.id })
    expect(repo.listTodoEvidence(db, target.id).map((row) => row.session_id)).toEqual(['target-session'])
    expect(repo.listEvents(db, SCOPE).map((event) => event.kind)).toEqual([
      'todo_consolidation_undone', 'todo_consolidated',
    ])
  })

  it('R3 undo restores the relation but preserves target fields edited after the merge', () => {
    const source = repo.upsertTodo(db, { title: '确认北辰合同', due_at: '2026-09-05', scope_key: SCOPE }).row
    const target = repo.upsertTodo(db, { title: '跟进北辰合同确认', scope_key: SCOPE }).row
    const merged = repo.applyTodoConsolidate(db, { id: source.id }, { id: target.id })
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    repo.applyTodoUpdate(db, target.id, { due_at: '2026-09-12' })

    const undone = repo.undoTodoConsolidation(db, merged.merge.id)
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.target_restore_status).toBe('conflict')
    expect(undone.target.due_at).toBe('2026-09-12')
    expect(undone.source.record_status).toBe('canonical')
    expect(repo.listEvents(db, SCOPE)[0]).toMatchObject({
      kind: 'todo_consolidation_undone', detail: '已恢复事项关系；保留合并后的用户编辑。',
    })
  })

  it('refuses with not-found for unknown ids or unmatched titles', () => {
    const { row: target } = repo.upsertTodo(db, { title: '把演示稿发给研发', scope_key: SCOPE })
    const unknownSource = repo.applyTodoConsolidate(db, { id: 'nope' }, { id: target.id })
    expect(unknownSource).toEqual({ ok: false, kind: 'not-found', error: 'source todo not found' })
    const unknownTarget = repo.applyTodoConsolidate(db, { id: target.id }, { title: '不存在的任务' }, null, SCOPE)
    expect(unknownTarget).toEqual({ ok: false, kind: 'not-found', error: 'target todo not found' })
  })
})

describe('permanent todo deletion', () => {
  it('removes the canonical identity, merged aliases and directly-linked projections', () => {
    const { row: target } = repo.upsertTodo(db, { title: '整理客户回访安排', due_at: '2026-08-29', scope_key: SCOPE })
    const { row: alias } = repo.upsertTodo(db, { title: '整理客户回访的安排', scope_key: SCOPE })
    expect(repo.applyTodoConsolidate(db, { id: alias.id }, { id: target.id }, null, SCOPE).ok).toBe(true)
    repo.addTodoEvidence(db, {
      todo_id: target.id,
      source_scope_key: SCOPE,
      source_kind: 'human',
      relation: 'origin',
      occurred_at: Date.now(),
      source_fingerprint: `delete:${target.id}`,
    })
    repo.addNotification(db, { kind: 'reminder', title: '回访提醒', todo_id: target.id, scope_key: SCOPE })
    repo.queuePendingReminder(db, { todo_id: target.id, fire_at: Date.now(), payload: '回访提醒', scope_key: SCOPE })
    repo.recordAttentionFeedback(db, {
      scope_key: SCOPE,
      todo_id: target.id,
      reason_version: 'v1',
      evidence_fingerprint: 'e1',
    }, { seen_at: Date.now() })
    repo.saveClientAction(db, {
      scope_key: SCOPE,
      client_action_id: 'old-action',
      request_hash: 'hash',
      outcome_json: JSON.stringify({ ok: true, item: { ids: [target.id] } }),
    })
    db.prepare(
      `INSERT INTO recall_log(scope_key, query, kept_keys, source, status, created_at)
       VALUES(?,?,?,?,?,?)`,
    ).run(SCOPE, '客户回访', JSON.stringify([`todo:${target.id}`]), 'user', 'ok', Date.now())

    expect(repo.deleteTodoPermanently(db, target.id)).toEqual({ id: target.id, deleted_record_count: 2 })
    expect(repo.listTodoRecords(db, SCOPE)).toHaveLength(0)
    expect(repo.listTodoEvidence(db, target.id)).toHaveLength(0)
    expect(repo.listNotifications(db, SCOPE)).toHaveLength(0)
    expect(repo.listPendingReminders(db, SCOPE, Number.MAX_SAFE_INTEGER)).toHaveLength(0)
    expect(repo.listAttentionFeedback(db, SCOPE)).toHaveLength(0)
    expect(repo.getClientAction(db, SCOPE, 'old-action')).toBeUndefined()
    expect((db.prepare('SELECT COUNT(*) AS n FROM recall_log').get() as { n: number }).n).toBe(0)
    expect(ftsSearch(db, '客户回访', 5, ['todo'])).toHaveLength(0)
  })
})

describe('applyYoloAction (M9 P34/P35: denied audit + consolidate dispatch)', () => {
  let cwd: string
  let yolo: Yolo

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'yolo-action-path-'))
    const ctx = {
      logger: { info: () => {}, warn: () => {} },
      reflect: { provide: () => {} },
      effect: () => () => {},
    } as never
    yolo = new Yolo(ctx)
  })

  afterEach(() => {
    yolo.close()
    rmSync(cwd, { recursive: true, force: true })
  })

  it('exposes evidence append/list and canonical-id resolution through the Yolo service', () => {
    const { todo: source } = yolo.addTodo(cwd, { title: '准备客户回访', source: 'manual' })
    const { todo: target } = yolo.addTodo(cwd, { title: '整理客户回访安排', source: 'manual' })
    const appended = yolo.addTodoEvidence(cwd, source.id, {
      session_id: 'session-followup', turn_seq: 3, source_kind: 'human', relation: 'mention',
      excerpt: '继续准备客户回访', source_fingerprint: 'human/session-followup/3/todo-0',
    })
    expect(appended.created).toBe(true)
    expect(yolo.addTodoEvidence(cwd, source.id, {
      session_id: 'session-followup', turn_seq: 3, source_kind: 'human', relation: 'mention',
      excerpt: '继续准备客户回访', source_fingerprint: 'human/session-followup/3/todo-0',
    }).created).toBe(false)

    expect(yolo.applyTodoConsolidate(cwd, { id: source.id }, { id: target.id }).ok).toBe(true)
    expect(yolo.resolveCanonicalTodo(cwd, source.id)?.id).toBe(target.id)
    expect(yolo.listTodoEvidence(cwd, target.id).some((row) => row.id === appended.evidence.id)).toBe(true)
  })

  it('rolls back action state, audit, evidence and idempotency receipt when a mid-action write fails', () => {
    const { todo } = yolo.addTodo(cwd, { title: '把演示稿发给研发', source: 'manual' })
    const baselineEvents = yolo.listEvents(cwd).length
    const baselineEvidence = yolo.listTodoEvidence(cwd, todo.id).length
    vi.spyOn(yolo, 'addTodoEvidence').mockImplementationOnce(() => {
      throw new Error('evidence write failed')
    })

    expect(() => applyYoloAction(yolo, cwd, {
      action: 'complete',
      kind: 'todo',
      id: todo.id,
      client_action_id: 'atomic-action-failure',
      session_id: 'session-atomic',
      session_turn: 3,
    })).toThrow('evidence write failed')

    expect(yolo.findTodo(cwd, { id: todo.id })).toMatchObject({ status: 'pending', completed_at: null })
    expect(yolo.listEvents(cwd)).toHaveLength(baselineEvents)
    expect(yolo.listTodoEvidence(cwd, todo.id)).toHaveLength(baselineEvidence)
    expect(yolo.getClientAction(cwd, 'atomic-action-failure')).toBeUndefined()
  })

  it('rolls back extraction-like domain, evidence, log and receipt writes as one workspace unit', () => {
    const handle = yolo.resolve(cwd)

    expect(() => yolo.runIdempotentAction(cwd, 'atomic-extraction-failure', 'request-hash', () => {
      const { todo } = yolo.addTodo(cwd, { title: '整理客户访谈纪要', source: 'llm' })
      yolo.addEvent(cwd, {
        kind: 'todo_created',
        summary: `新增待办：${todo.title}`,
        detail: null,
        session_id: 'session-extract',
        source: null,
        subject_type: 'todo',
        subject_id: todo.id,
        subject_title: todo.title,
        related_subject_type: null,
        related_subject_id: null,
        related_subject_title: null,
        change: null,
      })
      yolo.addTodoEvidence(cwd, todo.id, {
        session_id: 'session-extract',
        turn_seq: 5,
        source_kind: 'extraction',
        relation: 'origin',
        excerpt: '整理客户访谈纪要',
        source_fingerprint: 'atomic-extraction-failure/todo-0',
      })
      yolo.logExtraction(cwd, {
        session_id: 'session-extract',
        turn_seq: 5,
        strategy: 'llm',
        status: 'ok',
      })
      throw new Error('extraction persistence failed')
    })).toThrow('extraction persistence failed')

    expect(yolo.listTodoRecords(cwd)).toHaveLength(0)
    expect(yolo.listEvents(cwd)).toHaveLength(0)
    expect(handle.db.prepare('SELECT COUNT(*) AS n FROM todo_evidence').get()).toEqual({ n: 0 })
    expect(handle.db.prepare('SELECT COUNT(*) AS n FROM extraction_log').get()).toEqual({ n: 0 })
    expect(yolo.getClientAction(cwd, 'atomic-extraction-failure')).toBeUndefined()
  })

  it('audits an unsupported action as action_denied', () => {
    const res = applyYoloAction(yolo, cwd, { action: 'fly', kind: 'todo', id: 'whatever', title: '把演示稿发给研发' })
    expect(res.ok).toBe(false)
    const ev = yolo.listEvents(cwd).find((e) => e.kind === 'action_denied')
    expect(ev).toBeTruthy()
    expect(ev!.summary).toContain('⚠ 拒绝 fly/todo')
    expect(ev!.detail).toContain('"action":"fly"')
  })

  it('stamps the session (or manual source) on the denied event like other events', () => {
    applyYoloAction(yolo, cwd, { action: 'fly', kind: 'todo', id: 'x', session_id: 'session-denied' })
    const withSession = yolo.listEvents(cwd).find((e) => e.kind === 'action_denied')
    expect(withSession!.session_id).toBe('session-denied')
    expect(withSession!.source).toBeNull()

    applyYoloAction(yolo, cwd, { action: 'fly', kind: 'todo', id: 'x' })
    const manual = yolo.listEvents(cwd).filter((e) => e.kind === 'action_denied')[0]
    expect(manual.session_id).toBeNull()
    expect(manual.source).toBe('manual')
  })

  it('audits a validation failure with the offending request payload (truncated)', () => {
    const res = applyYoloAction(yolo, cwd, { action: 'postpone', kind: 'todo', id: 'abc', title: '跟运营对齐双周排期' })
    expect(res.ok).toBe(false)
    const ev = yolo.listEvents(cwd).find((e) => e.kind === 'action_denied')
    expect(ev!.summary).toContain('postpone requires due_at')
    expect(ev!.detail).toContain('"action":"postpone"')
    expect(ev!.detail).toContain('"id":"abc"')
    expect(ev!.detail!.length).toBeLessThanOrEqual(300)
  })

  it('audits a 404 miss (unknown item) as action_denied', () => {
    const res = applyYoloAction(yolo, cwd, { action: 'complete', kind: 'todo', id: 'missing' })
    if (res.ok) throw new Error('expected denial')
    expect(res.httpStatus).toBe(404)
    const ev = yolo.listEvents(cwd).find((e) => e.kind === 'action_denied')
    expect(ev!.summary).toContain('todo not found')
  })

  it('handled on an already-handled notification stays a silent idempotent SUCCESS', () => {
    const n = yolo.addNotification(cwd, { kind: 'reminder', title: '提醒：把演示稿发给研发' })
    const first = applyYoloAction(yolo, cwd, { action: 'handled', kind: 'notification', id: n.id })
    expect(first.ok).toBe(true)
    expect(yolo.listEvents(cwd)).toHaveLength(0) // handling writes no event

    // v0.3.3 review fix: the second click used to return 404, which the panel
    // surfaced as 「操作失败」 for a benign double-click. It is now ok:true.
    const second = applyYoloAction(yolo, cwd, { action: 'handled', kind: 'notification', id: n.id })
    expect(second.ok).toBe(true)
    // double-clicking「知道了」must not flood the ledger
    expect(yolo.listEvents(cwd)).toHaveLength(0)
  })

  it('consolidates through the shared dispatch and audits a request missing the target', () => {
    const { todo: source } = yolo.addTodo(cwd, { title: '跟运营对齐双周排期', due_at: '2026-09-02', priority: 'urgent', source: 'llm' })
    const { todo: target } = yolo.addTodo(cwd, { title: '和运营对齐双周排期表', priority: 'low', source: 'llm' })

    const res = applyYoloAction(yolo, cwd, {
      action: 'consolidate',
      kind: 'todo',
      id: source.id,
      into_id: target.id,
      session_id: 'session-merge',
      confirmation: 'CONFIRM_CONSOLIDATE',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.undo).toMatchObject({ action: 'undo_consolidate', id: source.id })
    expect(yolo.listEvents(cwd).some((e) => e.kind === 'todo_consolidated')).toBe(true)
    expect(yolo.listTodos(cwd).some((t) => t.id === source.id)).toBe(false)
    expect(yolo.listTodoRecords(cwd).find((t) => t.id === source.id)).toMatchObject({
      status: 'pending', record_status: 'merged', merged_into_id: target.id,
    })
    expect(yolo.listTodos(cwd, 'pending').some((t) => t.id === target.id)).toBe(true)

    const undone = applyYoloAction(yolo, cwd, { ...res.undo!, scope_cwd: cwd })
    expect(undone).toMatchObject({ ok: true, learning_receipt: { summary: '已撤销事项合并' } })
    expect(yolo.listTodoRecords(cwd).find((t) => t.id === source.id)).toMatchObject({ record_status: 'canonical', merged_into_id: null })

    const denied = applyYoloAction(yolo, cwd, { action: 'consolidate', kind: 'todo', id: target.id })
    if (denied.ok) throw new Error('expected denial')
    expect(denied.httpStatus).toBe(400)
    const ev = yolo.listEvents(cwd).find((e) => e.kind === 'action_denied')
    expect(ev!.summary).toContain('consolidate requires source (id|title) and target (into_id|into_title)')
  })

  it('requires explicit confirmation before the shared dispatcher merges records', () => {
    const { todo: source } = yolo.addTodo(cwd, { title: '准备季度复盘材料', source: 'llm' })
    const { todo: target } = yolo.addTodo(cwd, { title: '整理季度复盘材料', source: 'llm' })
    const denied = applyYoloAction(yolo, cwd, {
      action: 'consolidate', kind: 'todo', id: source.id, into_id: target.id,
    })
    expect(denied).toMatchObject({ ok: false, code: 'consolidation_confirmation_required', httpStatus: 409 })
    expect(yolo.listTodoRecords(cwd).find((todo) => todo.id === source.id)?.record_status).toBe('canonical')
  })

  it('consolidate on a non-todo kind is denied', () => {
    const denied = applyYoloAction(yolo, cwd, { action: 'consolidate', kind: 'goal', id: 'g1', into_id: 'g2' })
    expect(denied.ok).toBe(false)
    const ev = yolo.listEvents(cwd).find((e) => e.kind === 'action_denied')
    expect(ev!.summary).toContain('consolidate requires kind=todo')
  })

  it('rejects an invalid priority instead of silently clearing the stored priority', () => {
    const { todo } = yolo.addTodo(cwd, { title: '确认客户访谈排期', priority: 'high', source: 'llm' })

    const res = applyYoloAction(yolo, cwd, {
      action: 'update',
      kind: 'todo',
      id: todo.id,
      priority: 'critical',
    })

    expect(res.ok).toBe(false)
    expect(yolo.listTodos(cwd, 'pending').find((row) => row.id === todo.id)?.priority).toBe('high')
  })

  it('updates and indexes the todo detail from the handling panel', () => {
    const { todo } = yolo.addTodo(cwd, { title: '确认客户访谈排期', detail: '旧备注', source: 'llm' })

    const res = applyYoloAction(yolo, cwd, {
      action: 'update', kind: 'todo', id: todo.id, detail: '周二前向客户确认新的时间窗口',
    })

    expect(res).toMatchObject({ ok: true, item: { detail: '周二前向客户确认新的时间窗口' } })
    expect(yolo.search(cwd, '新的时间窗口').map((row) => row.row_id)).toContain(todo.id)
  })

  it('rejects an unknown milestone title instead of silently unlinking the todo', () => {
    const milestone = yolo.addMilestone(cwd, { title: '产品组验收', source: 'llm' })
    const { todo } = yolo.addTodo(cwd, {
      title: '发送客户访谈纪要',
      milestone_id: milestone.id,
      source: 'llm',
    })

    const res = applyYoloAction(yolo, cwd, {
      action: 'update',
      kind: 'todo',
      id: todo.id,
      milestone_title: '不存在的里程碑',
    })

    expect(res.ok).toBe(false)
    expect(yolo.listTodos(cwd, 'pending').find((row) => row.id === todo.id)?.milestone_id).toBe(milestone.id)
  })
})
