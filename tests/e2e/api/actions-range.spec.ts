import { test, expect } from '@playwright/test'
import { buildDashboardSurfaces } from '../../../src/shared/dashboard-surfaces.ts'
import type { YoloDashboardData } from '../../../src/shared/dashboard.ts'
import { connectApi, createFixtures, uid, waitForDashboard, withWorkspaceDatabase, type Api } from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(() => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

test('按截止日期批量取消只处理开放事项，并保持终态与区间边界', async () => {
  const rangeDay = '2098-07-17'
  const open = await fx.todo(uid('向客户发送本周确认邮件'), { due: rangeDay })
  const completed = await fx.todo(uid('归档已签署的采购合同'), { due: rangeDay })
  const outside = await fx.todo(uid('明天确认下一轮客户名单'), { due: '2098-07-18' })
  await api.action({ action: 'complete', kind: 'todo', id: completed.id })
  await fx.notification(uid('今天发送客户确认邮件'), { todoId: String(open.id) })

  const result = await api.action({
    action: 'bulk_cancel', kind: 'todo', range_field: 'due_at', range_from: rangeDay, range_to: rangeDay,
  })
  expect(result).toMatchObject({ ok: true, item: { affected: 1, ids: [open.id] } })

  const dashboard = await waitForDashboard(api, (data) => (
    data.todos?.find((row: Record<string, any>) => row.id === open.id)?.status === 'cancelled'
  ), { label: 'bulk cancellation to persist' })
  expect(dashboard.todos.find((row: Record<string, any>) => row.id === completed.id)?.status).toBe('done')
  expect(dashboard.todos.find((row: Record<string, any>) => row.id === outside.id)?.status).toBe('pending')
  expect(dashboard.notifications.find((row: Record<string, any>) => row.todo_id === open.id)?.handled).toBe(true)
})

test('永久删除需要强确认，并移除范围内所有状态及直接关联数据', async () => {
  const rangeDay = '2098-07-19'
  const open = await fx.todo(uid('清理重复导入的供应商回访'), { due: rangeDay })
  const completed = await fx.todo(uid('清理已结束的供应商核对'), { due: rangeDay })
  await api.action({ action: 'complete', kind: 'todo', id: completed.id })
  const notification = await fx.notification(uid('供应商回访提醒'), { todoId: String(open.id) })
  const before = await waitForDashboard(api, (data) => data.todos?.some((row: Record<string, any>) => row.id === open.id), {
    label: 'permanent delete owner row',
  })
  const owner = before.todos.find((row: Record<string, any>) => row.id === open.id)

  const refused = await api.req.post('/yolo/actions', { data: {
    action: 'bulk_delete', kind: 'todo', range_field: 'due_at', range_from: rangeDay, range_to: rangeDay,
  } })
  expect(refused.status()).toBe(400)
  expect(await refused.json()).toMatchObject({ ok: false, code: 'permanent_delete_confirmation_required' })

  const result = await api.action({
    action: 'bulk_delete', kind: 'todo', range_field: 'due_at', range_from: rangeDay, range_to: rangeDay,
    confirmation: 'PERMANENT_DELETE',
  })
  expect(result).toMatchObject({ ok: true, item: { affected: 2 } })
  fx.untrackTodo(String(open.id))
  fx.untrackTodo(String(completed.id))
  fx.untrackNotification(String(notification.id))

  const after = await api.dashboard()
  expect(after.todos.some((row: Record<string, any>) => row.id === open.id || row.id === completed.id)).toBe(false)
  expect(after.notifications.some((row: Record<string, any>) => row.todo_id === open.id)).toBe(false)
  const counts = withWorkspaceDatabase(owner, (db) => ({
    todos: Number((db.prepare('SELECT COUNT(*) AS n FROM todos WHERE id IN (?, ?)').get(open.id, completed.id) as { n: number }).n),
    evidence: Number((db.prepare('SELECT COUNT(*) AS n FROM todo_evidence WHERE todo_id IN (?, ?)').get(open.id, completed.id) as { n: number }).n),
    notifications: Number((db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE todo_id IN (?, ?)').get(open.id, completed.id) as { n: number }).n),
  }))
  expect(counts).toEqual({ todos: 0, evidence: 0, notifications: 0 })
  const surfaces = buildDashboardSurfaces(after as YoloDashboardData)
  expect(surfaces.history.recentChanges.some((row) => row.kind === 'todo_deleted' && row.summary === '永久删除 2 项')).toBe(true)
})
