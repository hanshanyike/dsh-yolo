// M7 dashboard projection tests — buildDashboardData + the GET /yolo/dashboard
// endpoint, with a mocked Yolo service. The per-session publish path is gone:
// the dashboard is a global sidebar surface served over HTTP.

import { describe, it, expect, vi } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import { buildDashboardData, registerDashboardEndpoint } from '../src/ui/dashboard.ts'
import type { Todo, Goal, Milestone, TimelineEvent, Preference } from '../src/storage/types.ts'

function mockYolo(): Yolo {
  const now = Date.now()
  const todo: Todo = {
    id: 't1', title: '完成报告', status: 'pending', priority: 'high',
    due_at: '2026-08-25', scope_key: 'test/main', created_at: now, updated_at: now,
  }
  const goal: Goal = {
    id: 'g1', title: '发布 yolo 插件', status: 'active', progress: 40,
    scope_key: 'test/main', created_at: now, updated_at: now,
  }
  const milestone: Milestone = {
    id: 'm1', title: 'M5 完成', status: 'active', target_date: '2026-08-30',
    scope_key: 'test/main', created_at: now, updated_at: now,
  }
  const event: TimelineEvent = {
    id: 'e1', kind: 'decision', summary: '确定 SQLite 为主存储', occurred_at: now,
    scope_key: 'test/main',
  }
  const pref: Preference = {
    id: 'p1', key: '语言', value: '简体中文', confidence: 1, scope_key: 'test/main',
    updated_at: now,
  }
  return {
    resolve: () => ({ scopeKey: 'test/main', db: {}, dataDir: '' }),
    listTodos: () => [todo],
    listGoals: () => [goal],
    listMilestones: () => [milestone],
    listEvents: () => [event],
    listPreferences: () => [pref],
  } as unknown as Yolo
}

describe('buildDashboardData', () => {
  it('projects all five categories with compact rows', () => {
    const data = buildDashboardData(mockYolo(), '/tmp/proj')
    expect(data.scopeKey).toBe('test/main')
    expect(data.cwd).toBe('/tmp/proj')
    expect(data.at).toBeGreaterThan(0)
    expect(data.todos).toHaveLength(1)
    expect(data.todos[0]).toMatchObject({ id: 't1', title: '完成报告', status: 'pending', due_at: '2026-08-25' })
    expect(data.goals[0]).toMatchObject({ progress: 40 })
    expect(data.milestones[0]).toMatchObject({ target_date: '2026-08-30' })
    expect(data.events[0]).toMatchObject({ kind: 'decision' })
    expect(data.preferences[0]).toMatchObject({ key: '语言', value: '简体中文' })
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
