import { test, expect } from '@playwright/test'
import { buildDashboardSurfaces } from '../../../src/shared/dashboard-surfaces.ts'
import type { YoloDashboardData } from '../../../src/shared/dashboard.ts'
import { connectApi, createFixtures, todayStr, uid, waitForDashboard, type Api } from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => {
  api = await connectApi()
})

test.afterAll(async () => {
  await api.close()
})

test.beforeEach(() => {
  fx = createFixtures(api)
})

test.afterEach(async () => {
  await fx.dispose()
})

function localDateTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

test('mixed due_at semantics stay consistent across todo, attention, summary and terminal state', async () => {
  const now = Date.now()
  const quick = await fx.todo(uid('记录今天要确认的客户反馈'), { due: todayStr() })
  const exactPast = await fx.todo(uid('确认刚到期的发布审批'), { due: localDateTime(new Date(now - 60_000)) })
  const terminal = await fx.todo(uid('完成已经到期的归档检查'), { due: new Date(now - 120_000).toISOString() })
  await api.action({ action: 'complete', kind: 'todo', id: String(terminal.id) })

  const dashboard = await waitForDashboard(api, (data) => {
    const quickRow = data.todos?.find((todo: Record<string, any>) => todo.id === String(quick.id))
    const pastRow = data.todos?.find((todo: Record<string, any>) => todo.id === String(exactPast.id))
    const terminalRow = data.todos?.find((todo: Record<string, any>) => todo.id === String(terminal.id))
    return quickRow?.overdue === false && pastRow?.overdue === true && terminalRow?.overdue === false
  }, { label: 'mixed due semantics to reach one dashboard projection' })

  const quickRow = dashboard.todos.find((todo: Record<string, any>) => todo.id === String(quick.id))
  const pastRow = dashboard.todos.find((todo: Record<string, any>) => todo.id === String(exactPast.id))
  const terminalRow = dashboard.todos.find((todo: Record<string, any>) => todo.id === String(terminal.id))
  expect(quickRow).toMatchObject({ due_at: todayStr(), overdue: false })
  expect(pastRow).toMatchObject({ overdue: true, attention_reason: { code: 'overdue' } })
  expect(terminalRow).toMatchObject({ status: 'done', overdue: false })
  expect(dashboard.summary.overdue).toBe(dashboard.todos.filter(
    (todo: Record<string, any>) => todo.overdue === true && todo.status !== 'done' && todo.status !== 'completed' && todo.status !== 'cancelled',
  ).length)
  expect(dashboard.notifications.filter((notification: Record<string, any>) => notification.todo_id === String(quick.id))).toHaveLength(0)

  const surfaces = buildDashboardSurfaces(dashboard as YoloDashboardData)
  expect(surfaces.plan.today.map((todo) => todo.id)).toEqual(expect.arrayContaining([String(quick.id), String(exactPast.id)]))
  expect(surfaces.plan.all.map((todo) => todo.id)).not.toContain(String(terminal.id))
  expect(surfaces.history.completed.map((todo) => todo.id)).toContain(String(terminal.id))
  expect(surfaces.home.today.concat(
    surfaces.home.needsAction.flatMap((row) => row.kind === 'todo' ? [row.todo] : []),
    surfaces.home.primary ? [surfaces.home.primary.todo] : [],
  ).map((todo) => todo.id)).toEqual(expect.arrayContaining([String(quick.id), String(exactPast.id)]))
})
