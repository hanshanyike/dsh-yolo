import { afterEach, describe, expect, it, vi } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import type { Milestone, Notification, Todo, TodoEvidence } from '../src/storage/types.ts'
import { aggregateDashboards, buildDashboardData } from '../src/ui/dashboard.ts'

const NOW = new Date(2026, 7, 23, 10, 0, 0)

afterEach(() => vi.useRealTimers())

function yoloFor(scopeKey: string, todo: Todo, notification?: Notification, evidence: TodoEvidence[] = []): Yolo {
  const milestone: Milestone = {
    id: 'm1', title: '季度发布', status: 'active', target_date: '2026-08-30',
    scope_key: scopeKey, created_at: NOW.getTime(), updated_at: NOW.getTime(),
  }
  const notifications = notification ? [notification] : []
  return {
    resolve: () => ({ scopeKey, db: {}, dataDir: '' }),
    listTodos: () => [todo],
    listTodoEvidence: () => evidence,
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
      source_excerpt: '本周把季度材料发给研发', source_turn: 4,
      scope_key: 'quarterly/main', created_at: NOW.getTime() - 10_000, updated_at: NOW.getTime() - 9 * 86_400_000,
    }
    const notification: Notification = {
      id: 'n1', kind: 'reminder', title: '季度材料', todo_id: 't1', scope_cwd: cwd,
      body: '请及时处理', created_at: NOW.getTime() - 2_000, handled_at: null, scope_key: 'quarterly/main',
    }

    const data = buildDashboardData(yoloFor('quarterly/main', todo, notification), cwd, '2026-08-23')

    expect(data.ui_contract_version).toBe(2)
    expect(data.capabilities).toEqual({ preferenceUndo: false, notificationSeen: true, sourceExcerpt: true })
    expect(data.summary).toMatchObject({ open: 1, overdue: 1, completedToday: 0, changesToday: 1, partial: false })
    expect(data.attention).toHaveLength(1)
    expect(data.attention?.[0]).toMatchObject({ todo_id: 't1', scope_cwd: cwd, reason_code: 'reminder_due' })
    expect(data.todos[0]).toMatchObject({
      detail: '先确认最终数字',
      session_id: 's1',
      scope_cwd: cwd,
      postpone_count: 1,
      attention_reason: {
        code: 'reminder_due',
        short_reason: '有一条未处理提醒',
        reason_version: 'attention-v1',
      },
      source: {
        type: 'session', label: '季度发布讨论', session_id: 's1', excerpt: '本周把季度材料发给研发', turn: 4,
        created_at: NOW.getTime() - 10_000,
      },
      ws: { slug: 'quarterly/main', label: 'quarterly', cwd },
      reminder: { id: 'n1', unhandled: true, unhandled_count: 1, body: '请及时处理' },
    })
    for (const rows of [data.todos, data.goals, data.milestones, data.events, data.preferences, data.ledger, data.notifications]) {
      expect(rows[0]?.ws?.cwd).toBe(cwd)
    }
  })

  it('degrades manual, tool and old LLM rows without inventing session evidence', () => {
    vi.useFakeTimers({ now: NOW })
    const make = (source: Todo['source']) => buildDashboardData(yoloFor('source/main', {
      id: `todo-${source}`, title: `来源 ${source}`, status: 'pending', source,
      scope_key: 'source/main', created_at: NOW.getTime(), updated_at: NOW.getTime(),
    }), 'D:\\Code\\source', '2026-08-23').todos[0]?.source

    expect(make('manual')).toMatchObject({ type: 'manual', label: '快速记一条', session_id: null })
    expect(make('tool')).toMatchObject({ type: 'tool', label: '助手操作', session_id: null })
    expect(make('llm')).toMatchObject({ type: 'legacy', label: '会话记录', session_id: null })
  })

  it('projects multiple immutable session sources for one canonical todo', () => {
    vi.useFakeTimers({ now: NOW })
    const todo: Todo = {
      id: 'multi-source', title: '确认发布安排', status: 'pending', source: 'llm', session_id: 'session-a',
      scope_key: 'source/main', created_at: NOW.getTime(), updated_at: NOW.getTime(),
    }
    const evidence: TodoEvidence[] = [
      { id: 'ev-a', todo_id: todo.id, source_scope_key: todo.scope_key, session_id: 'session-a', turn_seq: 2, source_kind: 'human', relation: 'origin', excerpt: '本周确认发布安排', occurred_at: NOW.getTime() - 2_000, source_fingerprint: 'fp-a' },
      { id: 'ev-b', todo_id: todo.id, source_scope_key: todo.scope_key, session_id: 'session-b', turn_seq: 5, source_kind: 'assistant_action', relation: 'update', excerpt: '改到周五确认', occurred_at: NOW.getTime() - 1_000, source_fingerprint: 'fp-b' },
    ]
    const yolo = yoloFor('source/main', todo, undefined, evidence)
    vi.spyOn(yolo, 'listSessionSummaries').mockReturnValue([
      { session_id: 'session-a', summary: '发布讨论', scope_key: todo.scope_key, updated_at: NOW.getTime() },
      { session_id: 'session-b', summary: '排期调整', scope_key: todo.scope_key, updated_at: NOW.getTime() },
    ])

    const row = buildDashboardData(yolo, 'D:\\Code\\source', '2026-08-23').todos[0]

    expect(row).toMatchObject({ source_count: 2, related_session_count: 2 })
    expect(row.sources).toEqual([
      expect.objectContaining({ session_id: 'session-a', label: '发布讨论', origin_kind: 'human', relation: 'origin' }),
      expect.objectContaining({ session_id: 'session-b', label: '排期调整', origin_kind: 'assistant_action', relation: 'update' }),
    ])
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

  it('projects an earlier same-day datetime as overdue across row, attention and summary', () => {
    vi.useFakeTimers({ now: NOW })
    const row: Todo = {
      id: 'same-day', title: '确认上午到期的交付', status: 'pending', due_at: '2026-08-23T09:59:59',
      scope_key: 'same/main', created_at: NOW.getTime(), updated_at: NOW.getTime(),
    }

    const data = buildDashboardData(yoloFor('same/main', row), 'D:\\Code\\same', '2026-08-23')

    expect(data.todos[0]).toMatchObject({ id: 'same-day', overdue: true })
    expect(data.todos[0].attention_reason).toMatchObject({ code: 'overdue' })
    expect(data.attention?.[0]).toMatchObject({ todo_id: 'same-day', reason_code: 'overdue' })
    expect(data.summary).toMatchObject({ overdue: 1, dueToday: 1 })
  })
})
