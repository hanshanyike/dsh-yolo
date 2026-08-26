// v0.3.0 cross-workspace aggregation tests — the pure union (aggregateDashboards),
// ws tagging in buildDashboardData, and the GET /yolo/dashboard?scope=all path.

import { describe, it, expect } from 'vitest'
import { buildDashboardData, aggregateDashboards, disambiguateWorkspaceLabels, registerDashboardEndpoint, workspaceLabel } from '../src/ui/dashboard.ts'
import type Yolo from '../src/storage/index.ts'
import type { YoloDashboardData, WorkspaceTag, YoloTodoRow, YoloLedgerEntry, YoloNotificationRow } from '../src/shared/dashboard.ts'
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

  // v0.3.3 review fix: per-workspace slices used to be concatenated, so the
  // ledger read as workspace-blocks instead of one timeline.
  it('re-sorts ledger and notifications into one global time order', () => {
    const led = (id: string, at: number, slug: string): YoloLedgerEntry => ({
      id, kind: 'note', summary: id, occurred_at: at, label: '', ws: wsTag(slug, slug),
    })
    const notif = (id: string, at: number, slug: string): YoloNotificationRow => ({
      id, kind: 'reminder', title: '⏰ 提醒', created_at: at, handled: false, ws: wsTag(slug, slug),
    })
    const a = makeDashboard(SCOPE_A, 'projA', [])
    a.ledger = [led('a1', 1000, SCOPE_A), led('a2', 3000, SCOPE_A)]
    a.notifications = [notif('na', 500, SCOPE_A)]
    const b = makeDashboard(SCOPE_B, 'projB', [])
    b.ledger = [led('b1', 2000, SCOPE_B)]
    b.notifications = [notif('nb', 4000, SCOPE_B)]

    const out = aggregateDashboards([a, b])
    expect(out.ledger.map((e) => e.id)).toEqual(['a2', 'b1', 'a1'])
    expect(out.notifications.map((n) => n.id)).toEqual(['nb', 'na'])
  })

  // v0.3.3 review fix: the aggregate used to inherit base.health (first
  // workspace only) — counters now sum and the hit-rate is run-weighted.
  it('merges memory-health counters across workspaces', () => {
    const a = makeDashboard(SCOPE_A, 'projA', [])
    a.health = { recallRunsToday: 10, recallHitRate: 0.8, recallErrorsToday: 1, extractionErrorsToday: 2, deniedToday: 0, duplicateTodos: [] }
    const b = makeDashboard(SCOPE_B, 'projB', [])
    b.health = {
      recallRunsToday: 30, recallHitRate: 1, recallErrorsToday: 0, extractionErrorsToday: 1, deniedToday: 2,
      duplicateTodos: [{ a: 't1', b: 't2', aTitle: 'A', bTitle: 'B' }],
    }

    const out = aggregateDashboards([a, b])
    expect(out.health).toMatchObject({
      recallRunsToday: 40,
      recallHitRate: 0.95, // (0.8*10 + 1*30) / 40
      recallErrorsToday: 1,
      extractionErrorsToday: 3,
      deniedToday: 2,
    })
    expect(out.health?.duplicateTodos).toHaveLength(1)
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
    const owner = { ...ws, cwd: 'C:\\work\\projA' }
    expect(d.todos[0].ws).toEqual(owner)
    expect(d.goals[0].ws).toEqual(owner)
    expect(d.milestones[0].ws).toEqual(owner)
    expect(d.events[0].ws).toEqual(owner)
    expect(d.preferences[0].ws).toEqual(owner)
    expect(d.notifications[0].ws).toEqual(owner)
  })
})

describe('workspaceLabel', () => {
  it('extracts a basename independently of the runner platform', () => {
    expect(workspaceLabel('C:\\work\\my-project', 'x/main')).toBe('my-project')
    expect(workspaceLabel('C:\\work\\my-project\\', 'x/main')).toBe('my-project')
    expect(workspaceLabel('/work/my-project', 'x/main')).toBe('my-project')
    expect(workspaceLabel('C:\\', 'x/main')).toBe('x/main')
    expect(workspaceLabel('/', 'x/main')).toBe('x/main')
  })

  it('uses the shortest stable parent suffix only when basenames collide', () => {
    const workspaces = [
      { cwd: 'C:\\teams\\alpha\\app', scopeKey: 'a/default' },
      { cwd: 'C:\\teams\\beta\\app', scopeKey: 'b/default' },
      { cwd: 'C:\\teams\\beta\\service', scopeKey: 'c/default' },
    ]
    const labels = disambiguateWorkspaceLabels(workspaces)
    expect([...labels.values()]).toEqual(['alpha/app', 'beta/app', 'service'])

    const a = makeDashboard('a/default', 'app', [row('a', '准备甲方案', 'a/default')])
    const b = makeDashboard('b/default', 'app', [row('b', '准备乙方案', 'b/default')])
    a.cwd = workspaces[0]!.cwd
    b.cwd = workspaces[1]!.cwd
    const out = aggregateDashboards([a, b])
    expect(out.workspaces?.map((ws) => ws.label)).toEqual(['alpha/app', 'beta/app'])
    expect(out.todos.map((todo) => todo.ws?.label)).toEqual(['alpha/app', 'beta/app'])
  })
})

describe('registerDashboardEndpoint scope handling', () => {
  function baseYolo(metas: Array<{ cwd: string; scopeKey: string }> = [{ cwd: 'C:\\work\\projA', scopeKey: SCOPE_A }]): Yolo {
    return {
      resolve: (cwd: string) => ({ scopeKey: cwd.includes('projB') ? SCOPE_B : SCOPE_A, db: {}, dataDir: '' }),
      runInScope: (_cwd: string, _scopeKey: string, fn: () => unknown) => fn(),
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
    const result = invoke(yolo, allowAggregate, url)
    return result.status === 200 ? result.data as YoloDashboardData : undefined
  }

  function invoke(
    yolo: Yolo,
    allowAggregate: boolean,
    url: string,
  ): { status: number; data?: Record<string, any> } {
    const captured: { status: number; data?: Record<string, any> } = { status: 0 }
    const server = {
      register: (o: { handler: (req: unknown, res: { writeHead: (s: number, h: Record<string, string>) => void; end: (b?: string) => void }) => Promise<void> | void }) => {
        void o.handler({ url }, {
          writeHead: (status) => { captured.status = status },
          end: (b?: string) => {
            if (b !== undefined) captured.data = JSON.parse(b) as Record<string, any>
          },
        })
      },
    }
    registerDashboardEndpoint({ webServer: server } as never, yolo, () => 'C:\\work\\projA', { allowAggregate: () => allowAggregate })
    return captured
  }

  it('normalizes even one known workspace to the all-workspaces v2 projection', () => {
    const data = run(baseYolo(), false, '/yolo/dashboard?scope=all')
    expect(data?.scope).toBe('all')
    expect(data?.workspaceCount).toBe(1)
    expect(data?.ui_contract_version).toBe(2)
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

  // v0.3.3 review fix: one corrupt/locked workspace DB used to 500 the whole
  // board (including every healthy workspace). It is now skipped and reported.
  it('skips an unreadable workspace and still serves the rest with workspaceErrors', () => {
    const yolo = {
      resolve: (cwd: string) => ({ scopeKey: cwd.includes('projB') ? SCOPE_B : SCOPE_A, db: {}, dataDir: '' }),
      runInScope: (_cwd: string, _scopeKey: string, fn: () => unknown) => fn(),
      listTodos: (cwd: string) => {
        if (cwd.includes('projB')) throw new Error('database locked')
        return []
      },
      listGoals: () => [],
      listMilestones: () => [],
      listPreferences: () => [],
      listEvents: () => [],
      listEventsBetween: () => [],
      listNotifications: () => [],
      listUnhandledNotifications: () => [],
      listSessionSummaries: () => [],
      listWorkspaceMeta: () => [
        { cwd: 'C:\\work\\projA', scopeKey: SCOPE_A },
        { cwd: 'C:\\work\\projB', scopeKey: SCOPE_B },
      ],
    } as unknown as Yolo
    const data = run(yolo, true, '/yolo/dashboard?scope=all')
    expect(data?.scope).toBe('all')
    expect(data?.workspaceCount).toBe(1)
    expect(data?.workspaceErrors).toHaveLength(1)
    expect(data?.workspaceErrors?.[0]).toContain('database locked')
    expect(data?.summary?.partial).toBe(true)
  })

  it('WS-03 returns 500 only when all workspaces fail, then recovers cleanly on the next read', () => {
    let failAll = true
    const metas = [
      { cwd: 'C:\\work\\projA', scopeKey: SCOPE_A },
      { cwd: 'C:\\work\\projB', scopeKey: SCOPE_B },
    ]
    const yolo = {
      resolve: (cwd: string) => ({ scopeKey: cwd.includes('projB') ? SCOPE_B : SCOPE_A, db: {}, dataDir: '' }),
      runInScope: (_cwd: string, _scopeKey: string, fn: () => unknown) => fn(),
      listTodos: (cwd: string) => {
        if (failAll) throw new Error(`database unavailable: ${cwd}`)
        return [{
          id: 'same-id', title: cwd.includes('projB') ? '确认体检预约' : '把演示稿发给研发',
          status: 'pending', scope_key: cwd.includes('projB') ? SCOPE_B : SCOPE_A,
          created_at: 1, updated_at: 1,
        }]
      },
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

    const failed = invoke(yolo, true, '/yolo/dashboard?scope=all')
    expect(failed.status).toBe(500)
    expect(failed.data?.error).toContain('database unavailable')

    failAll = false
    const recovered = invoke(yolo, true, '/yolo/dashboard?scope=all')
    expect(recovered.status).toBe(200)
    expect(recovered.data).toMatchObject({ scope: 'all', workspaceCount: 2 })
    expect(recovered.data?.workspaceErrors).toBeUndefined()
    expect(recovered.data?.summary).toMatchObject({ partial: false, open: 2 })
    const rows = recovered.data?.todos as YoloTodoRow[]
    expect(rows).toHaveLength(2)
    expect(rows.map((item) => item.id)).toEqual(['same-id', 'same-id'])
    expect(rows.map((item) => item.ws?.slug)).toEqual([SCOPE_A, SCOPE_B])
    expect(rows.map((item) => item.scope_cwd)).toEqual(['C:\\work\\projA', 'C:\\work\\projB'])
  })
})
