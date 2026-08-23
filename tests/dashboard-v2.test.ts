import { afterEach, describe, expect, it, vi } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import type { Milestone, Notification, Todo } from '../src/storage/types.ts'
import { aggregateDashboards, buildDashboardData } from '../src/ui/dashboard.ts'

const NOW = new Date(2026, 7, 23, 10, 0, 0)

afterEach(() => vi.useRealTimers())

function yoloFor(scopeKey: string, todo: Todo, notification?: Notification): Yolo {
  const milestone: Milestone = {
    id: 'm1', title: '季度发布', status: 'active', target_date: '2026-08-30',
    scope_key: scopeKey, created_at: NOW.getTime(), updated_at: NOW.getTime(),
  }
  const notifications = notification ? [notification] : []
  return {
    resolve: () => ({ scopeKey, db: {}, dataDir: '' }),
    listTodos: () => [todo],
    listGoals: () => [{
      id: 'g1', title: '完成发布', status: 'active', progress: 50, milestone_id: 'm1',
      scope_key: scopeKey, created_at: NOW.getTime(), updated_at: NOW.getTime(),
    }],
    listMilestones: () => [milestone],
    listPreferences: () => [{
      id: 'p1', key: '提醒', value: '工作日上午', confidence: 1,
      scope_key: scopeKey, updated_at: NOW.getTime(),
    }],
    listEvents: () => [{
      id: 'e1', kind: 'todo_postponed', summary: `推迟：「${todo.title}」→ 2026-08-23`,
      occurred_at: NOW.getTime() - 1_000, scope_key: scopeKey,
    }],
    listEventsBetween: () => [{
      id: 'e1', kind: 'todo_postponed', summary: `推迟：「${todo.title}」→ 2026-08-23`,
      occurred_at: NOW.getTime() - 1_000, scope_key: scopeKey,
    }],
    listSessionSummaries: () => todo.session_id
      ? [{ session_id: todo.session_id, summary: '季度发布讨论', scope_key: scopeKey, updated_at: NOW.getTime() }]
      : [],
    listNotifications: () => notifications,
    listUnhandledNotifications: () => notifications,
  } as unknown as Yolo
}

describe('dashboard v2 projection', () => {
  it('adds an additive v2 contract, structured source, and owner tags for one workspace', () => {
    vi.useFakeTimers({ now: NOW })
    const cwd = 'D:\\Code\\quarterly'
    const todo: Todo = {
      id: 't1', title: '把季度材料发给研发', detail: '先确认最终数字', status: 'pending',
      priority: 'high', due_at: '2026-08-22', milestone_id: 'm1', session_id: 's1', source: 'llm',
      scope_key: 'quarterly/main', created_at: NOW.getTime() - 10_000, updated_at: NOW.getTime() - 9 * 86_400_000,
    }
    const notification: Notification = {
      id: 'n1', kind: 'reminder', title: '季度材料', todo_id: 't1', scope_cwd: cwd,
      created_at: NOW.getTime() - 2_000, handled_at: null, scope_key: 'quarterly/main',
    }

    const data = buildDashboardData(yoloFor('quarterly/main', todo, notification), cwd, '2026-08-23')

    expect(data.ui_contract_version).toBe(2)
    expect(data.capabilities).toEqual({ preferenceUndo: false, notificationSeen: false, sourceExcerpt: false })
    expect(data.summary).toMatchObject({ open: 1, overdue: 1, completedToday: 0, changesToday: 1, partial: false })
    expect(data.attention).toHaveLength(1)
    expect(data.attention?.[0]).toMatchObject({ todo_id: 't1', scope_cwd: cwd, reason_code: 'reminder_due' })
    expect(data.todos[0]).toMatchObject({
      detail: '先确认最终数字',
      session_id: 's1',
      scope_cwd: cwd,
      postpone_count: 1,
      reminder: { id: 'n1', unhandled: true, unhandled_count: 1 },
      source: { type: 'session', label: '季度发布讨论', session_id: 's1' },
      ws: { slug: 'quarterly/main', label: 'quarterly', cwd },
    })
    for (const rows of [data.todos, data.goals, data.milestones, data.events, data.preferences, data.ledger, data.notifications]) {
      expect(rows[0]?.ws?.cwd).toBe(cwd)
    }
  })

  it('re-ranks one global judgment and propagates partial summary state', () => {
    vi.useFakeTimers({ now: NOW })
    const aTodo: Todo = {
      id: 'shared', title: '回复供应商', status: 'pending', due_at: '2026-08-22',
      scope_key: 'a/main', created_at: NOW.getTime(), updated_at: NOW.getTime(),
    }
    const bTodo: Todo = {
      id: 'shared', title: '提交发布审批', status: 'pending', due_at: '2026-08-23T11:00:00',
      scope_key: 'b/main', created_at: NOW.getTime(), updated_at: NOW.getTime(),
    }
    const a = buildDashboardData(yoloFor('a/main', aTodo), 'D:\\Code\\a', '2026-08-23')
    const b = buildDashboardData(yoloFor('b/main', bTodo), 'D:\\Code\\b', '2026-08-23')
    b.summary!.partial = true

    const data = aggregateDashboards([a, b])
    expect(data.scope).toBe('all')
    expect(data.ui_contract_version).toBe(2)
    expect(data.todos).toHaveLength(2)
    expect(data.attention).toHaveLength(1)
    expect(data.attention?.[0].ws.slug).toBe('a/main')
    expect(data.summary).toMatchObject({ open: 2, partial: true })
  })
})
