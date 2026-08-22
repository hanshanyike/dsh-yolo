// M7 dashboard projection tests — buildDashboardData + the GET /yolo/dashboard
// endpoint, with a mocked Yolo service. The per-session publish path is gone:
// the dashboard is a global sidebar surface served over HTTP.
//
// M8: the projection now joins milestone titles onto todos/goals and computes
// the overdue/stale "stuck" signals.

import { describe, it, expect, vi } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import { buildDashboardData, registerDashboardEndpoint } from '../src/ui/dashboard.ts'
import type { Todo, Goal, Milestone, TimelineEvent, Preference } from '../src/storage/types.ts'
import { localDateStr } from '../src/shared/text.ts'

const DAY_MS = 86_400_000

function dateStr(offsetDays: number): string {
  return localDateStr(new Date(Date.now() + offsetDays * DAY_MS))
}

function mockYolo(): Yolo {
  const now = Date.now()
  const todo: Todo = {
    id: 't1', title: '完成报告', status: 'pending', priority: 'high',
    due_at: dateStr(-2), milestone_id: 'm1', scope_key: 'test/main', session_id: 's1',
    created_at: now, updated_at: now - 8 * DAY_MS,
  }
  const goal: Goal = {
    id: 'g1', title: '发布 yolo 插件', status: 'active', progress: 40,
    milestone_id: 'm1', scope_key: 'test/main', created_at: now, updated_at: now,
  }
  const milestone: Milestone = {
    id: 'm1', title: 'M5 完成', status: 'active', target_date: '2026-08-30',
    scope_key: 'test/main', created_at: now, updated_at: now,
  }
  const event: TimelineEvent = {
    id: 'e1', kind: 'todo_completed', summary: '完成：写设计文档', occurred_at: now,
    session_id: 's1', source: 'llm', scope_key: 'test/main',
  }
  const pref: Preference = {
    id: 'p1', key: '语言', value: '简体中文', confidence: 1, scope_key: 'test/main',
    updated_at: now,
  }
  const notification = {
    id: 'n1', kind: 'reminder', title: '⏰ 完成报告', body: null, todo_id: 't1',
    scope_cwd: '/tmp/proj', created_at: now, handled_at: null, scope_key: 'test/main',
  }
  return {
    resolve: () => ({ scopeKey: 'test/main', db: {}, dataDir: '' }),
    listTodos: () => [todo],
    listGoals: () => [goal],
    listMilestones: () => [milestone],
    listEvents: () => [event],
    listEventsBetween: () => [event],
    listPreferences: () => [pref],
    listSessionSummaries: () => [{ session_id: 's1', summary: '修登录bug', scope_key: 'test/main', updated_at: now }],
    listNotifications: () => [notification],
  } as unknown as Yolo
}

describe('buildDashboardData', () => {
  it('projects all five categories with compact rows', () => {
    const data = buildDashboardData(mockYolo(), '/tmp/proj')
    expect(data.scopeKey).toBe('test/main')
    expect(data.cwd).toBe('/tmp/proj')
    expect(data.at).toBeGreaterThan(0)
    expect(data.todos).toHaveLength(1)
    expect(data.todos[0]).toMatchObject({ id: 't1', title: '完成报告', status: 'pending', due_at: dateStr(-2) })
    expect(data.goals[0]).toMatchObject({ progress: 40 })
    expect(data.milestones[0]).toMatchObject({ target_date: '2026-08-30' })
    expect(data.events[0]).toMatchObject({ kind: 'todo_completed' })
    expect(data.preferences[0]).toMatchObject({ key: '语言', value: '简体中文' })
    // v0.3.0 C/B: ledger badge + notification card + unhandled count
    expect(data.todos[0].session_label).toBe('修登录bug')
    expect(data.ledger[0]).toMatchObject({ kind: 'todo_completed', label: '修登录bug' })
    // v0.3.1 C: ledger rows carry the source session for the jump link
    expect(data.ledger[0].session_id).toBe('s1')
    expect(data.ledgerSessions).toBe(1)
    expect(data.notifications).toHaveLength(1)
    expect(data.unhandled).toBe(1)
  })

  it('ledger counts distinct source sessions; manual rows stay non-jumpable (v0.3.1 C)', () => {
    const now = Date.now()
    const ev = (id: string, over: Partial<TimelineEvent>): TimelineEvent => ({
      id, kind: 'note', summary: id, occurred_at: now,
      session_id: null, source: 'llm', scope_key: 'test/main', ...over,
    })
    const yolo = {
      resolve: () => ({ scopeKey: 'test/main', db: {}, dataDir: '' }),
      listTodos: () => [],
      listGoals: () => [],
      listMilestones: () => [],
      listEvents: () => [],
      listEventsBetween: () => [
        ev('a', { session_id: 's1', kind: 'todo_created' }),
        ev('b', { session_id: 's1', kind: 'todo_completed' }),
        ev('c', { session_id: 's2', kind: 'note' }),
        ev('d', { session_id: null, source: 'manual', kind: 'todo_created' }),
        ev('e', { session_id: null, source: 'tool', kind: 'goal_progress' }),
        ev('f', { session_id: 's9', kind: 'note' }),
      ],
      listPreferences: () => [],
      listSessionSummaries: () => [
        { session_id: 's1', summary: '会话一', scope_key: 'test/main', updated_at: now },
        { session_id: 's2', summary: '会话二', scope_key: 'test/main', updated_at: now },
      ],
      listNotifications: () => [],
    } as unknown as Yolo
    const data = buildDashboardData(yolo, '/tmp/proj')
    // distinct session count ignores manual/tool rows; s9 still counts
    expect(data.ledgerSessions).toBe(3)
    const byId = new Map(data.ledger.map((e) => [e.id, e]))
    expect(byId.get('a')).toMatchObject({ session_id: 's1', label: '会话一' })
    expect(byId.get('b')).toMatchObject({ session_id: 's1', label: '会话一' })
    expect(byId.get('c')).toMatchObject({ session_id: 's2', label: '会话二' })
    expect(byId.get('d')).toMatchObject({ session_id: null, label: '快速记一条' })
    expect(byId.get('e')).toMatchObject({ session_id: null, label: '助手操作' })
    // unsummarized (not deleted) session: neutral badge, jump still possible
    expect(byId.get('f')).toMatchObject({ session_id: 's9', label: '来源会话' })
  })

  it('joins milestone titles and computes overdue/stale (M8)', () => {
    const data = buildDashboardData(mockYolo(), '/tmp/proj')
    expect(data.todos[0].milestone_title).toBe('M5 完成')
    expect(data.todos[0].overdue).toBe(true)
    expect(data.todos[0].stale).toBe(true)
    expect(data.todos[0].updated_at).toBeGreaterThan(0)
    expect(data.goals[0].milestone_title).toBe('M5 完成')
  })

  it('unlinked items project milestone_title null and no stuck signals', () => {
    const now = Date.now()
    const fresh: Todo = {
      id: 't2', title: '新鲜任务', status: 'pending',
      due_at: dateStr(3), scope_key: 'test/main', created_at: now, updated_at: now,
    }
    const yolo = {
      resolve: () => ({ scopeKey: 'test/main', db: {}, dataDir: '' }),
      listTodos: () => [fresh],
      listGoals: () => [],
      listMilestones: () => [],
      listEvents: () => [],
      listEventsBetween: () => [],
      listPreferences: () => [],
      listSessionSummaries: () => [],
      listNotifications: () => [],
    } as unknown as Yolo
    const data = buildDashboardData(yolo, '/tmp/proj')
    expect(data.todos[0].milestone_title).toBeNull()
    expect(data.todos[0].overdue).toBe(false)
    expect(data.todos[0].stale).toBe(false)
  })

  it('serializes cleanly to JSON', () => {
    const json = JSON.stringify(buildDashboardData(mockYolo(), '/tmp/proj'))
    const parsed = JSON.parse(json) as { todos: unknown[] }
    expect(parsed.todos).toHaveLength(1)
  })
})

describe('registerDashboardEndpoint', () => {
  it('serves the dashboard JSON on request', async () => {
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    }
    const server = { register: vi.fn((opts: { handler: (req: unknown, r: typeof res) => Promise<void> | void }) => {
      void opts.handler({}, res)
    }) }
    registerDashboardEndpoint({ webServer: server } as never, mockYolo(), () => '/tmp/proj')
    expect(server.register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'prefix', path: '/yolo/dashboard' }))
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'content-type': 'application/json; charset=utf-8' }))
    const body = JSON.parse(String(res.end.mock.calls[0]?.[0]))
    expect(body.todos[0].title).toBe('完成报告')
    expect(body.todos[0].overdue).toBe(true)
  })

  it('returns 500 JSON on failure', async () => {
    const res = { writeHead: vi.fn(), end: vi.fn() }
    const server = { register: vi.fn((opts: { handler: (req: unknown, r: typeof res) => Promise<void> | void }) => {
      void opts.handler({}, res)
    }) }
    const broken = { resolve: () => { throw new Error('db gone') } } as unknown as Yolo
    registerDashboardEndpoint({ webServer: server } as never, broken, () => '/tmp/proj')
    expect(res.writeHead).toHaveBeenCalledWith(500, expect.objectContaining({ 'content-type': 'application/json; charset=utf-8' }))
  })
})
