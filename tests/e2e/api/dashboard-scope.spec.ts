// API E2E · aggregate workspace ownership over the real host and SQLite.
// Fault injection for partial/all-fail is intentionally not faked here: the
// production host exposes no test-control endpoint that can register a second
// workspace or fail/recover one store without risking user data.

import { test, expect } from '@playwright/test'
import {
  connectApi,
  createFixtures,
  uid,
  waitForDashboard,
  type Api,
} from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(() => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

async function dashboard(path: string): Promise<Record<string, any>> {
  const response = await api.req.get(path)
  expect(response.status()).toBe(200)
  const body = await response.json() as Record<string, any>
  expect(body.error).toBeUndefined()
  return body
}

function assertAggregateShape(data: Record<string, any>): void {
  expect(data.scope).toBe('all')
  expect(data.ui_contract_version).toBe(2)
  expect(Number.isInteger(data.workspaceCount)).toBe(true)
  expect(data.workspaceCount).toBeGreaterThanOrEqual(1)
  expect(Array.isArray(data.workspaces)).toBe(true)
  expect(data.workspaces).toHaveLength(data.workspaceCount)
  expect(Array.isArray(data.todos)).toBe(true)
  expect(Array.isArray(data.notifications)).toBe(true)
  expect(data.summary).toMatchObject({ partial: expect.any(Boolean) })
}

test('WS-03 single/all: dashboard 始终返回所有已知工作区，旧 scope 查询不能缩回当前工作区', async () => {
  const [plain, all, legacyCurrent] = await Promise.all([
    dashboard('/yolo/dashboard'),
    dashboard('/yolo/dashboard?scope=all'),
    dashboard('/yolo/dashboard?scope=current'),
  ])

  for (const snapshot of [plain, all, legacyCurrent]) assertAggregateShape(snapshot)
  expect(all.workspaceCount).toBe(plain.workspaceCount)
  expect(legacyCurrent.workspaceCount).toBe(plain.workspaceCount)
  expect(new Set(all.workspaces.map((row: Record<string, any>) => row.slug)))
    .toEqual(new Set(plain.workspaces.map((row: Record<string, any>) => row.slug)))
})

test('WS-01: 真实事项携带稳定 owner，带 scope_cwd 的动作只更新该 owner', async () => {
  const title = uid('确认客户演示的最终发送时间')
  const created = await fx.todo(title)
  const before = await waitForDashboard(api, (data) => (
    (data.todos ?? []).some((row: Record<string, any>) => String(row.id) === String(created.id))
  ), { label: 'owned todo to appear in aggregate dashboard' })
  const row = before.todos.find((candidate: Record<string, any>) => String(candidate.id) === String(created.id))

  expect(row.scope_cwd).toEqual(expect.any(String))
  expect(row.ws).toMatchObject({ slug: expect.any(String), label: expect.any(String), cwd: row.scope_cwd })
  expect(row.source?.workspace).toEqual(row.ws)

  const changedTitle = `${title}，并同步给产品负责人`
  await api.action({
    action: 'update', kind: 'todo', id: created.id, title: changedTitle, scope_cwd: row.scope_cwd,
  })
  const after = await waitForDashboard(api, (data) => (
    (data.todos ?? []).find((candidate: Record<string, any>) => String(candidate.id) === String(created.id))?.title === changedTitle
  ), { label: 'scoped update to persist in the same owner' })
  const changed = after.todos.find((candidate: Record<string, any>) => String(candidate.id) === String(created.id))
  expect(changed).toMatchObject({ id: created.id, title: changedTitle, scope_cwd: row.scope_cwd, ws: row.ws })
})

test('WS-01/recovery: 未知 scope 被硬拒绝且不创建 ghost workspace，随后合法读取和动作恢复正常', async () => {
  const title = uid('把发布确认结果同步给研发')
  const created = await fx.todo(title)
  const before = await api.dashboard()
  const workspaceCount = before.workspaceCount
  const ghost = 'D:\\not-a-registered-workspace\\e2e'

  const denied = await api.req.post('/yolo/actions', {
    data: { action: 'update', kind: 'todo', id: created.id, title: `${title}（错误路由）`, scope_cwd: ghost },
  })
  expect(denied.status()).toBe(400)
  expect(await denied.json()).toMatchObject({ ok: false, code: 'unknown_workspace_scope' })

  const recovered = await dashboard('/yolo/dashboard')
  expect(recovered.workspaceCount).toBe(workspaceCount)
  expect(recovered.workspaces.some((row: Record<string, any>) => row.cwd === ghost)).toBe(false)
  expect(recovered.todos.find((row: Record<string, any>) => String(row.id) === String(created.id))?.title).toBe(title)

  const owner = recovered.todos.find((row: Record<string, any>) => String(row.id) === String(created.id))?.scope_cwd
  await api.action({ action: 'complete', kind: 'todo', id: created.id, scope_cwd: owner })
  const completed = await waitForDashboard(api, (data) => (
    (data.todos ?? []).find((row: Record<string, any>) => String(row.id) === String(created.id))?.status === 'done'
  ), { label: 'valid scoped action to recover after a denied route' })
  expect(completed.workspaceCount).toBe(workspaceCount)
})
