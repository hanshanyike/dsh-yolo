// v0.3.0 cross-workspace aggregation tests — the pure union (aggregateDashboards),
// ws tagging in buildDashboardData, and the GET /yolo/dashboard?scope=all path.

import { describe, it, expect } from 'vitest'
import { buildDashboardData, aggregateDashboards, registerDashboardEndpoint, workspaceLabel } from '../src/ui/dashboard.ts'
import type Yolo from '../src/storage/index.ts'
import type { YoloDashboardData, WorkspaceTag, YoloTodoRow } from '../src/shared/dashboard.ts'
import type { Todo, Goal, Milestone, TimelineEvent, Preference, Notification } from '../src/storage/types.ts'
import { localDateStr } from '../src/shared/text.ts'

const SCOPE_A = 'aaaa/main'
const SCOPE_B = 'bbbb/main'

function wsTag(slug: string, label: string): WorkspaceTag {
  return { slug, label }
}

function row(id: string, title: string, slug: string, status = 'pending'): YoloTodoRow {
  return { id, title, status, ws: wsTag(slug, `${slug}-label`) }
}

function makeDashboard(slug: string, label: string, todos: YoloTodoRow[], unhandled = 0): YoloDashboardData {
  return {
    scopeKey: slug,
    cwd: `C:\\work\\${label}`,
    at: Date.now(),
    todos,
    goals: [],
    milestones: [],
    events: [],
    preferences: [],
    ledger: [],
    ledgerDay: localDateStr(),
    ledgerSessions: 0,
    notifications: Array.from({ length: unhandled }, (_, i) => ({ id: `n-${slug}-${i}`, kind: 'reminder', title: '⏰ 提醒', created_at: 1, handled: false, ws: wsTag(slug, label) })),
    unhandled,
  }
}

describe('aggregateDashboards', () => {
  it('unions rows, dedupes by owner slug + id, and sets the aggregate metadata', () => {
    const a = makeDashboard(SCOPE_A, 'projA', [row('t1', '提醒我周三交周报', SCOPE_A), row('t2', '把演示稿发给研发', SCOPE_A)], 2)
    const b = makeDashboard(SCOPE_B, 'projB', [row('t1', '提醒我周三交周报', SCOPE_B, 'done'), row('t3', '整理季度汇报', SCOPE_B)], 1)
    const out = aggregateDashboards([a, b])
    expect(out.scope).toBe('all')
    expect(out.workspaceCount).toBe(2)
    expect(out.todos.map((t) => t.id)).toEqual(['t1', 't2', 't1', 't3'])
    expect(out.unhandled).toBe(3)
    expect(out.todos[0].ws?.slug).toBe(SCOPE_A)
    expect(out.todos[2].ws?.slug).toBe(SCOPE_B)
    expect(out.workspaces?.map((w) => w.slug).sort()).toEqual([SCOPE_A, SCOPE_B])
  })

  it('dedupes within the same workspace by id', () => {
    const a = makeDashboard(SCOPE_A, 'projA', [row('t1', 'a', SCOPE_A), row('t1', 'a-dup', SCOPE_A)])
    const out = aggregateDashboards([a])
    expect(out.todos).toHaveLength(1)
  })
})

describe('buildDashboardData ws tagging', () => {
  const now = Date.now()
  const todo: Todo = { id: 't1', title: '完成报告', status: 'pending', scope_key: SCOPE_A, created_at: now, updated_at: now }
  const goal: Goal = { id: 'g1', title: '发布插件', status: 'active', progress: 40, scope_key: SCOPE_A, created_at: now, updated_at: now }
  const milestone: Milestone = { id: 'm1', title: 'M5', status: 'active', target_date: '2026-08-30', scope_key: SCOPE_A, created_at: now, updated_at: now }
  const event: TimelineEvent = { id: 'e1', kind: 'note', summary: '记录', occurred_at: now, scope_key: SCOPE_A }
  const pref: Preference = { id: 'p1', key: '语言', value: '简体中文', confidence: 1, scope_key: SCOPE_A, updated_at: now }
  const notif: Notification = { id: 'n1', kind: 'reminder', title: '⏰', todo_id: 't1', created_at: now, handled_at: null, scope_key: SCOPE_A }

  const yolo = {
    resolve: () => ({ scopeKey: SCOPE_A, db: {}, dataDir: '' }),
    listTodos: () => [todo],
    listGoals: () => [goal],
    listMilestones: () => [milestone],
    listPreferences: () => [pref],
    listEvents: () => [event],
    listEventsBetween: () => [event],
    listNotifications: () => [notif],
    listUnhandledNotifications: () => [notif],
    listSessionSummaries: () => [],
  } as unknown as Yolo

  it('attaches the ws tag to every row type', () => {
    const ws = wsTag(SCOPE_A, 'dsh-yolo')
    const d = buildDashboardData(yolo, 'C:\\work\\projA', localDateStr(), ws)
    expect(d.todos[0].ws).toEqual(ws)
    expect(d.goals[0].ws).toEqual(ws)
    expect(d.milestones[0].ws).toEqual(ws)
    expect(d.events[0].ws).toEqual(ws)
    expect(d.preferences[0].ws).toEqual(ws)
    expect(d.notifications[0].ws).toEqual(ws)
  })
})

describe('workspaceLabel', () => {
  it('falls back to the basename of the cwd', () => {
    expect(workspaceLabel('C:\\work\\my-project', 'x/main')).toBe('my-project')
    expect(workspaceLabel('C:\\', 'x/main')).toBe('x/main')
  })
})

describe('registerDashboardEndpoint scope handling', () => {
  function baseYolo(metas: Array<{ cwd: string; scopeKey: string }> = [{ cwd: 'C:\\work\\projA', scopeKey: SCOPE_A }]): Yolo {
    return {
      resolve: (cwd: string) => ({ scopeKey: cwd.includes('projB') ? SCOPE_B : SCOPE_A, db: {}, dataDir: '' }),
      listTodos: () => [],
      listGoals: () => [],
      listMilestones: () => [],
      listPreferences: () => [],
      listEvents: () => [],
      listEventsBetween: () => [],
      listNotifications: () => [],
      listUnhandledNotifications: () => [],
      listSessionSummaries: () => [],
      listWorkspaceMeta: () => metas,
    } as unknown as Yolo
  }

  function run(
    yolo: Yolo,
    allowAggregate: boolean,
    url: string,
  ): YoloDashboardData | undefined {
    const captured: { data?: YoloDashboardData } = {}
    const server = {
      register: (o: { handler: (req: unknown, res: { writeHead: (s: number, h: Record<string, string>) => void; end: (b?: string) => void }) => Promise<void> | void }) => {
        void o.handler({ url }, {
          writeHead: () => {},
          end: (b?: string) => {
            if (b !== undefined) captured.data = JSON.parse(b) as YoloDashboardData
          },
        })
      },
    }
    registerDashboardEndpoint({ webServer: server } as never, yolo, () => 'C:\\work\\projA', { allowAggregate: () => allowAggregate })
    return captured.data
  }

  it('returns the current workspace (no scope flag) when aggregate is off', () => {
    const data = run(baseYolo(), false, '/yolo/dashboard?scope=all')
    expect(data?.scope).toBeUndefined()
  })

  it('aggregates across known workspaces when scope=all and allowed', () => {
    const yolo = baseYolo([
      { cwd: 'C:\\work\\projA', scopeKey: SCOPE_A },
      { cwd: 'C:\\work\\projB', scopeKey: SCOPE_B },
    ])
    const data = run(yolo, true, '/yolo/dashboard?scope=all')
    expect(data?.scope).toBe('all')
    expect(data?.workspaceCount).toBe(2)
  })
})




