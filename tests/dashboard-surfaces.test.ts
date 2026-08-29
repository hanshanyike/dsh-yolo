import { describe, expect, it } from 'vitest'
import type {
  WorkspaceTag,
  YoloAttentionRow,
  YoloDashboardData,
  YoloLedgerEntry,
  YoloNotificationRow,
  YoloTodoRow,
} from '../src/shared/dashboard.ts'
import {
  buildDashboardSurfaces,
  dashboardTodoKey,
  isUserVisibleChange,
} from '../src/shared/dashboard-surfaces.ts'

const DAY = '2026-08-26'
const WS_A: WorkspaceTag = { slug: 'a/default', label: '客户项目', cwd: 'D:/work/a' }
const WS_B: WorkspaceTag = { slug: 'b/default', label: '个人安排', cwd: 'D:/work/b' }

function todo(id: string, over: Partial<YoloTodoRow> = {}): YoloTodoRow {
  return {
    id,
    title: `事项 ${id}`,
    status: 'pending',
    scope_cwd: WS_A.cwd,
    ws: WS_A,
    ...over,
  }
}

function attention(todoId: string, over: Partial<YoloAttentionRow> = {}): YoloAttentionRow {
  return {
    id: `attention-${todoId}`,
    todo_id: todoId,
    scope_cwd: WS_A.cwd!,
    ws: WS_A,
    score: 80,
    level: 'attention',
    reason_code: 'overdue',
    short_reason: '已经逾期',
    explanation: '原定昨天完成，目前仍未处理。',
    evidence: [{ code: 'due_at', label: '截止时间', value: '2026-08-25' }],
    reason_version: 'v1',
    evidence_fingerprint: `fp-${todoId}`,
    ...over,
  }
}

function notification(id: string, over: Partial<YoloNotificationRow> = {}): YoloNotificationRow {
  return {
    id,
    kind: 'reminder',
    title: `提醒 ${id}`,
    created_at: 100,
    handled: false,
    scope_cwd: WS_A.cwd,
    ws: WS_A,
    ...over,
  }
}

function change(id: string, kind: string, occurredAt: number, over: Partial<YoloLedgerEntry> = {}): YoloLedgerEntry {
  return {
    id,
    kind,
    summary: `${kind}：${id}`,
    occurred_at: occurredAt,
    label: '客户项目讨论',
    ws: WS_A,
    ...over,
  }
}

function dashboard(over: Partial<YoloDashboardData> = {}): YoloDashboardData {
  return {
    scopeKey: 'aggregate',
    cwd: WS_A.cwd!,
    at: new Date('2026-08-26T10:00:00+08:00').getTime(),
    scope: 'all',
    workspaceCount: 2,
    workspaces: [
      { slug: WS_A.slug, label: WS_A.label, count: 0 },
      { slug: WS_B.slug, label: WS_B.label, count: 0 },
    ],
    summary: { open: 0, overdue: 0, dueToday: 0, completedToday: 0, changesToday: 0, partial: false },
    todos: [],
    goals: [],
    milestones: [],
    events: [],
    preferences: [],
    ledger: [],
    ledgerDay: DAY,
    ledgerSessions: 0,
    notifications: [],
    unhandled: 0,
    ...over,
  }
}

describe('buildDashboardSurfaces home', () => {
  it('uses at most the first usable server judgment and never fills Home with ordinary backlog', () => {
    const primary = todo('primary', { overdue: true, due_at: '2026-08-25' })
    const second = todo('second', {
      overdue: true,
      due_at: '2026-08-24',
      attention_reason: {
        code: 'overdue', short_reason: '已经逾期', explanation: '仍未处理。', evidence: [],
        reason_version: 'v1', evidence_fingerprint: 'second-fp',
      },
    })
    const today = todo('today', { due_at: DAY })
    const future = todo('future', { due_at: '2026-08-28' })
    const farFuture = todo('far-future', { due_at: '2026-09-30' })
    const undatedBacklog = todo('undated')

    const surfaces = buildDashboardSurfaces(dashboard({
      todos: [primary, second, today, future, farFuture, undatedBacklog],
      attention: [attention('primary'), attention('second', { score: 70 })],
    }))

    expect(surfaces.home.primary?.todo.id).toBe('primary')
    expect(surfaces.home.needsAction.map((row) => row.kind === 'todo' ? row.todo.id : row.notification.id)).toEqual(['second'])
    expect(surfaces.home.today.map((row) => row.id)).toEqual(['today'])
    expect(surfaces.home.upcoming.map((row) => row.id)).toEqual(['future', 'far-future'])
    expect([
      surfaces.home.primary?.todo,
      ...surfaces.home.needsAction.flatMap((row) => row.kind === 'todo' ? [row.todo] : []),
      ...surfaces.home.today,
      ...surfaces.home.upcoming,
    ].filter(Boolean).map((row) => row!.id)).not.toContain('undated')
  })

  it('deduplicates todos by (scope,id), keeps equal ids from different scopes, and presents each Home todo once', () => {
    const sameA = todo('shared', { reminder: { unhandled: true } })
    const duplicateA = { ...sameA, title: '不应重复' }
    const sameB = todo('shared', {
      title: '预约体检', scope_cwd: WS_B.cwd, ws: WS_B, due_at: DAY,
    })
    const surfaces = buildDashboardSurfaces(dashboard({ todos: [sameA, duplicateA, sameB] }))

    expect(surfaces.home.needsAction).toHaveLength(1)
    expect(surfaces.home.today).toHaveLength(1)
    expect(surfaces.plan.all).toHaveLength(2)
    expect(dashboardTodoKey(sameA, WS_A.cwd!)).not.toBe(dashboardTodoKey(sameB, WS_A.cwd!))
  })

  it('folds reminder state into its todo and keeps notification records out of Home', () => {
    const linked = todo('send-notes', { reminder: { unhandled: true } })
    const surfaces = buildDashboardSurfaces(dashboard({
      todos: [linked],
      notifications: [
        notification('linked-card', { todo_id: linked.id }),
        notification('standalone', { kind: 'brief', title: '今天的安排有一处冲突' }),
        notification('handled', { handled: true }),
      ],
    }))

    expect(surfaces.home.needsAction.map((row) => row.kind)).toEqual(['todo'])
  })

  it('obeys explicit compact-preview limits without changing Plan or History', () => {
    const surfaces = buildDashboardSurfaces(dashboard({
      todos: [todo('a', { due_at: '2026-08-27' }), todo('b', { due_at: '2026-08-28' })],
      ledger: [change('one', 'todo_created', 1), change('two', 'todo_completed', 2)],
    }), { homeUpcomingLimit: 1, homeRecentChangesLimit: 0 })

    expect(surfaces.home.upcoming.map((row) => row.id)).toEqual(['a'])
    expect(surfaces.home.recentChanges).toEqual([])
    expect(surfaces.plan.upcoming).toHaveLength(2)
    expect(surfaces.history.recentChanges).toHaveLength(2)
  })
})

describe('buildDashboardSurfaces plan', () => {
  it('projects today/upcoming/goals/all conservatively from server facts', () => {
    const explicitOverdue = todo('overdue', { due_at: '2026-08-25', overdue: true })
    const unconfirmedPast = todo('past-without-server-fact', { due_at: '2026-08-24', overdue: false })
    const today = todo('today', { due_at: '2026-08-26T16:00:00+08:00' })
    const future = todo('future', { due_at: '2026-08-29' })
    const undated = todo('undated')
    const done = todo('done', { status: 'done', due_at: DAY })

    const surfaces = buildDashboardSurfaces(dashboard({
      todos: [future, undated, today, explicitOverdue, unconfirmedPast, done],
      goals: [
        { id: 'active', title: '完成发布准备', status: 'active', progress: 60, ws: WS_A },
        { id: 'achieved', title: '完成内测', status: 'achieved', progress: 100, ws: WS_A },
      ],
      milestones: [
        { id: 'planned', title: '发布候选版', status: 'planned', target_date: '2026-09-01', ws: WS_A },
        { id: 'done-ms', title: '完成设计评审', status: 'done', target_date: DAY, ws: WS_A },
      ],
    }))

    expect(surfaces.plan.today.map((row) => row.id)).toEqual(['overdue', 'today'])
    expect(surfaces.plan.upcoming.map((row) => row.id)).toEqual(['future'])
    expect(surfaces.plan.all.map((row) => row.id)).toEqual(['past-without-server-fact', 'overdue', 'today', 'future', 'undated'])
    expect(surfaces.plan.goals.map((row) => row.id)).toEqual(['active'])
    expect(surfaces.plan.milestones.map((row) => row.id)).toEqual(['planned'])
  })
})

describe('buildDashboardSurfaces history', () => {
  it('separates completed and cancelled rows and sorts terminal history by its persisted timestamps', () => {
    const surfaces = buildDashboardSurfaces(dashboard({ todos: [
      todo('older-done', { status: 'done', completed_at: 100 }),
      todo('newer-completed', { status: 'completed', completed_at: 300 }),
      todo('cancelled', { status: 'cancelled', updated_at: 200 }),
      todo('open'),
    ] }))

    expect(surfaces.history.completed.map((row) => row.id)).toEqual(['newer-completed', 'older-done'])
    expect(surfaces.history.cancelled.map((row) => row.id)).toEqual(['cancelled'])
  })

  it('uses an explicit recent-change allow-list and excludes audit, scheduler and unknown kinds', () => {
    const rows = [
      change('created', 'todo_created', 10),
      change('updated', 'todo_updated', 20),
      change('decision', 'decision', 30),
      change('denied', 'action_denied', 40),
      change('reminder', 'reminder_fired', 50),
      change('seen', 'attention_seen', 60),
      change('future-audit', 'agent_internal_retry', 70),
    ]
    const surfaces = buildDashboardSurfaces(dashboard({ ledger: rows }))

    expect(surfaces.history.recentChanges.map((row) => row.id)).toEqual(['decision', 'updated', 'created'])
    expect(isUserVisibleChange({ kind: 'todo_postponed' })).toBe(true)
    expect(isUserVisibleChange({ kind: 'action_denied' })).toBe(false)
    expect(isUserVisibleChange({ kind: 'unknown_future_kind' })).toBe(false)
  })

  it('deduplicates recent changes by workspace owner and id without collapsing another workspace', () => {
    const first = change('same', 'todo_completed', 10)
    const duplicate = { ...first, summary: '重复载荷' }
    const otherWorkspace = change('same', 'todo_completed', 20, { ws: WS_B })
    const surfaces = buildDashboardSurfaces(dashboard({ ledger: [first, duplicate, otherWorkspace] }))

    expect(surfaces.history.recentChanges).toHaveLength(2)
    expect(surfaces.history.recentChanges.map((row) => row.ws?.slug)).toEqual([WS_B.slug, WS_A.slug])
  })
})

describe('dashboard surface coverage contract', () => {
  it('propagates one explicit partial-coverage object to every page and exposes no Agent Tasks surface', () => {
    const surfaces = buildDashboardSurfaces(dashboard({
      workspaceCount: 1,
      workspaceErrors: ['个人安排: database locked'],
      summary: { open: 1, overdue: 0, dueToday: 1, completedToday: 0, changesToday: 0, partial: false },
    }))

    expect(surfaces.home.coverage).toEqual({
      partial: true,
      workspaceErrors: ['个人安排: database locked'],
      loadedWorkspaceCount: 1,
    })
    expect(surfaces.plan.coverage).toEqual(surfaces.home.coverage)
    expect(surfaces.history.coverage).toEqual(surfaces.home.coverage)
    expect(surfaces).not.toHaveProperty('agentTasks')
  })

  it('also respects the server summary partial fact when no error detail is available', () => {
    const surfaces = buildDashboardSurfaces(dashboard({
      summary: { open: 0, overdue: 0, dueToday: 0, completedToday: 0, changesToday: 0, partial: true },
    }))
    expect(surfaces.home.coverage).toMatchObject({ partial: true, workspaceErrors: [] })
  })
})
