// M8 domain-action tests — state transitions with event audit + fuzzy title
// lookup, exercised against an in-memory SQLite DB.
// M9 additions: applyTodoConsolidate (P35) and the action_denied audit trail
// (P34) driven through the shared applyYoloAction dispatch over a temp dir.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

function lastEvent(): { kind: string; summary: string; session_id?: string | null } | undefined {
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

  it('reopen on an open todo no-ops — no state change, no event', () => {
    const { row: t } = repo.upsertTodo(db, { title: '未完成任务', scope_key: SCOPE })
    const same = repo.applyTodoAction(db, t.id, 'reopen')
    expect(same?.status).toBe('pending')
    expect(repo.listEvents(db, SCOPE)).toHaveLength(0)
  })

  it('cancel writes a todo_cancelled event', () => {
    const { row: t } = repo.upsertTodo(db, { title: '不再需要的任务', scope_key: SCOPE })
    const cancelled = repo.applyTodoAction(db, t.id, 'cancel')
    expect(cancelled?.status).toBe('cancelled')
    expect(lastEvent()?.kind).toBe('todo_cancelled')
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
    // cleared stamp => due scan picks it up again
    expect(repo.listDueTodos(db, SCOPE, '2026-08-26')).toHaveLength(1)
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
  it('merges a duplicate into its keeper: detail note, due inherited, priority raised, source cancelled + out of FTS, one event, source cards settled', () => {
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
    expect(repo.listTodos(db, SCOPE, 'cancelled').some((t) => t.id === source.id)).toBe(true)
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
    // the source's unhandled reminder card is settled with the merge
    expect(repo.listUnhandledNotifications(db, SCOPE)).toHaveLength(0)
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
    expect(repo.listTodos(db, SCOPE, 'cancelled').some((t) => t.id === source.id)).toBe(true)
  })

  it('refuses when source and target are the same row', () => {
    const { row: t } = repo.upsertTodo(db, { title: '把演示稿发给研发', scope_key: SCOPE })
    const res = repo.applyTodoConsolidate(db, { id: t.id }, { id: t.id })
    expect(res).toEqual({ ok: false, kind: 'same-item', error: 'source and target are the same todo' })
    expect(repo.listEvents(db, SCOPE)).toHaveLength(0)
  })

  it('refuses when either side is in a terminal state', () => {
    const { row: doneSrc } = repo.upsertTodo(db, { title: '已完成的旧任务', scope_key: SCOPE })
    const { row: openA } = repo.upsertTodo(db, { title: '把演示稿发给研发', scope_key: SCOPE })
    repo.applyTodoAction(db, doneSrc.id, 'complete')

    const res = repo.applyTodoConsolidate(db, { id: doneSrc.id }, { id: openA.id })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.kind).toBe('terminal')

    const { row: openB } = repo.upsertTodo(db, { title: '跟运营对齐双周排期', scope_key: SCOPE })
    repo.setTodoStatus(db, openA.id, 'cancelled')
    const res2 = repo.applyTodoConsolidate(db, { id: openB.id }, { id: openA.id })
    expect(res2.ok).toBe(false)
    if (res2.ok) return
    expect(res2.kind).toBe('terminal')
    expect(repo.listEvents(db, SCOPE).every((e) => e.kind !== 'todo_consolidated')).toBe(true)
  })

  it('refuses with not-found for unknown ids or unmatched titles', () => {
    const { row: target } = repo.upsertTodo(db, { title: '把演示稿发给研发', scope_key: SCOPE })
    const unknownSource = repo.applyTodoConsolidate(db, { id: 'nope' }, { id: target.id })
    expect(unknownSource).toEqual({ ok: false, kind: 'not-found', error: 'source todo not found' })
    const unknownTarget = repo.applyTodoConsolidate(db, { id: target.id }, { title: '不存在的任务' }, null, SCOPE)
    expect(unknownTarget).toEqual({ ok: false, kind: 'not-found', error: 'target todo not found' })
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

  it('handled on an already-handled notification stays a silent idempotent no-op', () => {
    const n = yolo.addNotification(cwd, { kind: 'reminder', title: '提醒：把演示稿发给研发' })
    const first = applyYoloAction(yolo, cwd, { action: 'handled', kind: 'notification', id: n.id })
    expect(first.ok).toBe(true)
    expect(yolo.listEvents(cwd)).toHaveLength(0) // handling writes no event

    const second = applyYoloAction(yolo, cwd, { action: 'handled', kind: 'notification', id: n.id })
    if (second.ok) throw new Error('expected the second handled to be a no-op')
    expect(second.httpStatus).toBe(404)
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
    })
    expect(res.ok).toBe(true)
    expect(yolo.listEvents(cwd).some((e) => e.kind === 'todo_consolidated')).toBe(true)
    expect(yolo.listTodos(cwd, 'cancelled').some((t) => t.id === source.id)).toBe(true)
    expect(yolo.listTodos(cwd, 'pending').some((t) => t.id === target.id)).toBe(true)

    const denied = applyYoloAction(yolo, cwd, { action: 'consolidate', kind: 'todo', id: target.id })
    if (denied.ok) throw new Error('expected denial')
    expect(denied.httpStatus).toBe(400)
    const ev = yolo.listEvents(cwd).find((e) => e.kind === 'action_denied')
    expect(ev!.summary).toContain('consolidate requires source (id|title) and target (into_id|into_title)')
  })

  it('consolidate on a non-todo kind is denied', () => {
    const denied = applyYoloAction(yolo, cwd, { action: 'consolidate', kind: 'goal', id: 'g1', into_id: 'g2' })
    expect(denied.ok).toBe(false)
    const ev = yolo.listEvents(cwd).find((e) => e.kind === 'action_denied')
    expect(ev!.summary).toContain('consolidate requires kind=todo')
  })
})
