// M4b dashboard publisher tests — build + publish with a mocked Yolo service.

import { describe, it, expect, vi } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import { buildDashboardData, publishDashboard, type SessionLike } from '../src/ui/dashboard.ts'
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
})

describe('publishDashboard', () => {
  it('appends the yolo/snapshot durable event with envelope', () => {
    const append = vi.fn()
    const session: SessionLike = { append, meta: { cwd: '/ws/alpha' } }
    publishDashboard(mockYolo(), session, '/ws/alpha')
    expect(append).toHaveBeenCalledTimes(1)
    const [type, payload] = append.mock.calls[0] as [string, { createdAt: number; scopeKey: string; data: unknown }]
    expect(type).toBe('yolo/snapshot')
    expect(payload.createdAt).toBeGreaterThan(0)
    expect(payload.scopeKey).toBe('test/main')
    expect(payload.data).toBeDefined()
  })

  it('never throws when append fails', () => {
    const session: SessionLike = {
      append: () => { throw new Error('durable store down') },
    }
    expect(() => publishDashboard(mockYolo(), session, '/ws/alpha')).not.toThrow()
  })
})
