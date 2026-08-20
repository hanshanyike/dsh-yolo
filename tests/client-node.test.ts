// M4b client-side logic tests — dashboard node definition, view builder,
// and the shared projection helpers. Pure logic; no React rendering.

import { describe, expect, it } from 'vitest'
import { yoloDashboardDefinition, asYoloDashboardNode } from '../client/node/DashboardNode.ts'
import { yoloViewDefinition, EMPTY_YOLO_SNAPSHOT } from '../client/tab/ViewBuilder.ts'
import { todoSummary, type YoloDashboardData, type YoloSnapshot } from '../src/shared/dashboard.ts'

function snapshotEvent(over: Partial<YoloDashboardData> = {}) {
  return {
    type: 'yolo/snapshot',
    seq: 42,
    data: {
      createdAt: 123,
      scopeKey: 'test/main',
      data: {
        scopeKey: 'test/main',
        cwd: '/ws',
        at: 456,
        todos: [{ id: 't1', title: '完成报告', status: 'pending', due_at: '2026-08-25', priority: 'high' }],
        goals: [{ id: 'g1', title: '发布', status: 'active', progress: 40 }],
        milestones: [{ id: 'm1', title: 'M5', status: 'active', target_date: '2026-09-01' }],
        events: [{ id: 'e1', kind: 'decision', summary: '定了', occurred_at: 456 }],
        preferences: [{ id: 'p1', key: '语言', value: '中文' }],
        ...over,
      },
    },
  } as never
}

describe('yoloDashboardDefinition', () => {
  it('matches only yolo/snapshot events', () => {
    expect(yoloDashboardDefinition.match({ type: 'user/message' } as never)).toBeNull()
    const m = yoloDashboardDefinition.match(snapshotEvent())
    expect(m).toEqual({ id: 'dashboard', role: 'start' })
  })

  it('start extracts the projection as node state', () => {
    const state = yoloDashboardDefinition.start({} as never, { event: snapshotEvent() } as never, undefined as never)
    expect(state).toMatchObject({ scopeKey: 'test/main', at: 456 })
    expect(state.todos[0].title).toBe('完成报告')
  })

  it('update keeps state; buildViewNode yields a yolo-dashboard node', () => {
    const state = { scopeKey: 'test/main', at: 456, todos: [] }
    const ctx = {
      key: '1:yolo-dashboarddashboard',
      state,
      start: { event: { seq: 42 } },
    }
    expect(yoloDashboardDefinition.update(ctx as never, {} as never)).toBe(state)
    const node = yoloDashboardDefinition.buildViewNode?.(ctx as never)
    expect(node).toBeTruthy()
    const dash = asYoloDashboardNode(node)
    expect(dash?.target).toBe('yolo')
    expect(dash?.data.at).toBe(456)
  })
})

describe('yolo view snapshot builder', () => {
  // the builder's own structural signature is narrower than the dsh contract;
  // tests drive it through the loose node shape it actually consumes
  type LooseBuilder = {
    replace(input: { nodes: unknown[] }): YoloSnapshot
    apply(input: { upserts: unknown[] }): YoloSnapshot
  }
  const loose = (): LooseBuilder => yoloViewDefinition.create() as unknown as LooseBuilder

  it('empty snapshot is stable and empty', () => {
    expect(EMPTY_YOLO_SNAPSHOT.todos).toHaveLength(0)
    expect(EMPTY_YOLO_SNAPSHOT.at).toBe(0)
  })

  it('replace folds dashboard nodes into a snapshot', () => {
    const builder = loose()
    const snap = builder.replace({
      nodes: [{
        key: 'k1', kind: 'yolo-dashboard', id: 'dashboard', target: 'yolo',
        data: { scopeKey: 's', cwd: '/w', at: 9, todos: [{ id: 'a', title: 'x', status: 'pending' }], goals: [], milestones: [], events: [], preferences: [] },
      }],
    })
    expect(snap.at).toBe(9)
    expect(snap.todos[0].title).toBe('x')
  })

  it('apply upserts keep the latest dashboard data', () => {
    const builder = loose()
    builder.apply({
      upserts: [{
        key: 'k1', kind: 'yolo-dashboard', id: 'dashboard', target: 'yolo',
        data: { scopeKey: 's', cwd: '/w', at: 1, todos: [], goals: [], milestones: [], events: [], preferences: [] },
      }],
    })
    builder.apply({
      upserts: [{
        key: 'k2', kind: 'yolo-dashboard', id: 'dashboard', target: 'yolo',
        data: { scopeKey: 's', cwd: '/w', at: 2, todos: [{ id: 'b', title: 'y', status: 'done' }], goals: [], milestones: [], events: [], preferences: [] },
      }],
    })
    const snap = builder.apply({ upserts: [] })
    expect(snap.at).toBe(2)
    expect(snap.todos[0].status).toBe('done')
  })

  it('ignores unrelated node kinds', () => {
    const builder = loose()
    const snap = builder.replace({
      nodes: [{ key: 'x', kind: 'trajectory-input-message', id: 'm', target: 'trajectory', data: {} }],
    })
    expect(snap.at).toBe(0)
    expect(snap).toBe(EMPTY_YOLO_SNAPSHOT)
  })
})

describe('todoSummary', () => {
  it('renders title, due date and priority', () => {
    expect(todoSummary({ id: '1', title: '完成报告', status: 'pending', due_at: '2026-08-25', priority: 'high' }))
      .toBe('完成报告 截止 2026-08-25 [high]')
  })
  it('omits empty fields', () => {
    expect(todoSummary({ id: '2', title: '普通任务', status: 'pending' })).toBe('普通任务')
  })
})
