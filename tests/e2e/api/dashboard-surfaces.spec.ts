import { test, expect } from '@playwright/test'
import { buildDashboardSurfaces } from '../../../src/shared/dashboard-surfaces.ts'
import type { YoloDashboardData, YoloTodoRow } from '../../../src/shared/dashboard.ts'
import {
  connectApi,
  createFixtures,
  todayStr,
  uid,
  waitForDashboard,
  withWorkspaceDatabase,
  yesterdayStr,
  type Api,
} from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(() => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

function localDateOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const part = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`
}

function surfaceTodoIds(surface: ReturnType<typeof buildDashboardSurfaces>['home']): string[] {
  return [
    ...(surface.primary ? [surface.primary.todo.id] : []),
    ...surface.needsAction.flatMap((row) => row.kind === 'todo' ? [row.todo.id] : []),
    ...surface.today.map((row) => row.id),
    ...surface.upcoming.map((row) => row.id),
  ]
}

test('HOME-01/HOME-02: 首页按 owner 去重、最多一个首要事项，普通无日期积压不填充且无 Agent 任务', async () => {
  const pressure = await Promise.all([
    fx.todo(uid('确认客户演示材料已经发出'), { due: yesterdayStr() }),
    fx.todo(uid('回复产品评审提出的三个问题'), { due: yesterdayStr() }),
    fx.todo(uid('补齐发布说明中的升级步骤'), { due: yesterdayStr() }),
    fx.todo(uid('确认供应商已经收到采购信息'), { due: yesterdayStr() }),
    fx.todo(uid('给旅行安排补充酒店确认号'), { due: yesterdayStr() }),
  ])
  const backlog = await fx.todo(uid('整理以后可能采用的访谈方法'))
  await api.action({ action: 'update', kind: 'todo', id: backlog.id, due_at: null })

  const ids = new Set(pressure.map((row) => String(row.id)))
  const dashboard = await waitForDashboard(api, (data) => {
    const rows = (data.todos ?? []).filter((row: Record<string, any>) => ids.has(String(row.id)))
    return rows.length === pressure.length && rows.every((row: Record<string, any>) => row.attention_reason != null)
  }, { label: 'five real overdue fixtures to receive server attention facts' })
  const surfaces = buildDashboardSurfaces(dashboard as YoloDashboardData, { homeUpcomingLimit: 20 })
  const homeIds = surfaceTodoIds(surfaces.home)

  expect(surfaces.home.primary === null ? 0 : 1).toBeLessThanOrEqual(1)
  expect(homeIds.filter((id) => ids.has(id))).toHaveLength(5)
  expect(new Set(homeIds.filter((id) => ids.has(id))).size).toBe(5)
  expect(homeIds).not.toContain(String(backlog.id))
  expect(surfaces.plan.all.map((row) => row.id)).toContain(String(backlog.id))
  expect(surfaces).not.toHaveProperty('agentTasks')
  expect(surfaces.home).not.toHaveProperty('agentTasks')
  expect(surfaces.home.coverage.partial).toBe(dashboard.summary?.partial === true || (dashboard.workspaceErrors?.length ?? 0) > 0)
})

test('W2/W11: 计划严格区分今天、接下来和全部；终态只进入历史', async () => {
  const today = await fx.todo(uid('今天把访谈纪要发给产品组'), { due: todayStr() })
  const upcoming = await fx.todo(uid('下周确认客户回访时间'), { due: localDateOffset(5) })
  const undated = await fx.todo(uid('整理适合下季度采用的研究方法'))
  await api.action({ action: 'update', kind: 'todo', id: undated.id, due_at: null })
  const completed = await fx.todo(uid('完成采购申请的最终确认'), { due: todayStr() })
  const cancelled = await fx.todo(uid('取消不再需要的供应商回访'), { due: todayStr() })
  await api.action({ action: 'complete', kind: 'todo', id: completed.id })
  await api.action({ action: 'cancel', kind: 'todo', id: cancelled.id })

  const fixtureIds = new Set([today, upcoming, undated, completed, cancelled].map((row) => String(row.id)))
  const dashboard = await waitForDashboard(api, (data) => (
    (data.todos ?? []).filter((row: Record<string, any>) => fixtureIds.has(String(row.id))).length === fixtureIds.size
  ), { label: 'plan and terminal fixtures to persist through HTTP actions' })
  const surfaces = buildDashboardSurfaces(dashboard as YoloDashboardData)
  const fixtureRows = (rows: readonly YoloTodoRow[]): string[] => rows.map((row) => row.id).filter((id) => fixtureIds.has(id))

  expect(fixtureRows(surfaces.plan.today)).toEqual([String(today.id)])
  expect(fixtureRows(surfaces.plan.upcoming)).toEqual([String(upcoming.id)])
  expect(new Set(fixtureRows(surfaces.plan.all))).toEqual(new Set([String(today.id), String(upcoming.id), String(undated.id)]))
  expect(fixtureRows(surfaces.history.completed)).toEqual([String(completed.id)])
  expect(fixtureRows(surfaces.history.cancelled)).toEqual([String(cancelled.id)])
})

test('HIST-01: 最近变化采用用户可见白名单，非法动作仍有真实审计但不伪装成进展', async () => {
  const title = uid('确认新版发布清单的负责人')
  const item = await fx.todo(title, { due: localDateOffset(2) })
  await api.action({ action: 'postpone', kind: 'todo', id: item.id, due_at: localDateOffset(3) })

  const unknownAction = `fly-${Date.now()}`
  const denied = await api.req.post('/yolo/actions', {
    data: { action: unknownAction, kind: 'todo', title: uid('请求一个不存在的事项动作') },
  })
  expect(denied.status()).toBe(400)

  const dashboard = await waitForDashboard(api, (data) => {
    const ledger = data.ledger ?? []
    return ledger.some((row: Record<string, any>) => row.kind === 'todo_postponed' && String(row.summary).includes(title))
  }, { label: 'postpone to appear in the real dashboard history projection' })
  const owner = dashboard.todos.find((row: Record<string, any>) => String(row.id) === String(item.id))
  const audit = withWorkspaceDatabase(owner, (db) => db.prepare(
    `SELECT kind, summary FROM events
     WHERE kind = 'action_denied' AND summary LIKE ? ORDER BY occurred_at DESC LIMIT 1`,
  ).get(`%${unknownAction}%`) as Record<string, unknown> | undefined)
  expect(audit).toMatchObject({ kind: 'action_denied' })
  expect(String(audit?.summary)).toContain(unknownAction)
  expect((dashboard.ledger ?? []).some((row: Record<string, any>) => row.kind === 'action_denied')).toBe(false)
  const surfaces = buildDashboardSurfaces(dashboard as YoloDashboardData)

  expect(surfaces.history.recentChanges.some((row) => row.kind === 'todo_postponed' && row.summary.includes(title))).toBe(true)
  expect(surfaces.history.recentChanges.some((row) => row.kind === 'action_denied')).toBe(false)
  expect(surfaces.home.recentChanges.every((row) => row.kind !== 'action_denied')).toBe(true)
})
