// api 套件 · HTTP 接口测试（无浏览器）— domain-action contracts over plain HTTP, no browser.
//
// P35: two seeded todos → POST consolidate → target keeps merged fields,
// source becomes a merged historical record (gone from the business board), one todo_consolidated event
// lands in the day ledger.
// P34: an invalid action is rejected with 400 and leaves an action_denied
// audit row in the ledger — a denial must never be silent.

import { test, expect } from '@playwright/test'
import { buildDashboardSurfaces } from '../../../src/shared/dashboard-surfaces.ts'
import type { YoloDashboardData } from '../../../src/shared/dashboard.ts'
import { connectApi, createFixtures, uid, waitForDashboard, withWorkspaceDatabase, type Api } from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => {
  api = await connectApi()
})
test.afterAll(async () => {
  await api.close()
})
test.beforeEach(async () => {
  fx = createFixtures(api)
})
test.afterEach(async () => {
  await fx.dispose()
})

test('合并两条待办：保留方继承字段、被并方退场、审计保留且最近变化按白名单展示（P35）', async () => {
  const source = await fx.todo(uid('把演示稿发给研发'), { due: '2099-01-01' })
  const target = await fx.todo(uid('跟研发同步演示稿反馈'))
  // quick_add 默认今日到期；继承规则只在 target 无截止时触发，先清空它
  await api.action({ action: 'update', kind: 'todo', id: target.id, due_at: null })

  const unconfirmed = await api.req.post('/yolo/actions', {
    data: { action: 'consolidate', kind: 'todo', id: source.id, into_id: target.id },
  })
  expect(unconfirmed.status()).toBe(409)
  expect(await unconfirmed.json()).toMatchObject({ code: 'consolidation_confirmation_required' })

  const res = await api.action({
    action: 'consolidate', kind: 'todo', id: source.id, into_id: target.id,
    confirmation: 'CONFIRM_CONSOLIDATE',
  })
  expect(res.ok).toBe(true)
  const item = res.item as Record<string, any>
  expect(item).toMatchObject({ id: target.id, status: 'pending' })
  expect(String(item.due_at)).toBe('2099-01-01') // inherited: target had no due
  expect(String(item.detail)).toContain('已并入')

  const d = await api.dashboard()
  const rows = (d.todos ?? []) as { id: string; title: string; status: string; scope_cwd?: string }[]
  const src = rows.find((t) => t.id === source.id)
  const dst = rows.find((t) => t.id === target.id)
  expect(src).toBeUndefined()
  expect(dst?.status).toBe('pending')
  const merged = withWorkspaceDatabase(dst!, (db) => db.prepare(
    'SELECT status, record_status, merged_into_id FROM todos WHERE id = ?',
  ).get(source.id) as Record<string, unknown> | undefined)
  expect(merged).toMatchObject({ status: 'pending', record_status: 'merged', merged_into_id: target.id })

  const ledger = (d.ledger ?? []) as { kind: string; summary: string }[]
  const ev = ledger.find((e) => e.kind === 'todo_consolidated')
  expect(ev).toBeTruthy()
  expect(ev?.summary).toContain('合并')
  const surfaces = buildDashboardSurfaces(d as YoloDashboardData)
  expect(surfaces.history.recentChanges.some((row) => row.kind === 'todo_consolidated' && row.summary.includes('合并'))).toBe(true)

  const undo = res.undo as Record<string, unknown>
  const undone = await api.action({ ...undo, scope_cwd: dst!.scope_cwd })
  expect(undone).toMatchObject({ ok: true, item: { id: source.id, record_status: 'canonical' } })
  const restored = await api.dashboard()
  expect(restored.todos.find((todo: Record<string, unknown>) => todo.id === source.id)).toBeTruthy()
  expect(restored.todos.find((todo: Record<string, unknown>) => todo.id === target.id)).toMatchObject({ due_at: null })
  expect(restored.ledger.some((event: Record<string, unknown>) => event.kind === 'todo_consolidation_undone')).toBe(true)
})

test('非法动作被拒绝且落 action_denied 审计（P34）', async () => {
  const anchor = await fx.todo(uid('确认异常动作不会改变发布安排'))
  const dashboard = await waitForDashboard(api, (data) => (
    (data.todos ?? []).some((row: Record<string, any>) => String(row.id) === String(anchor.id))
  ), { label: 'audit fixture owner to appear' })
  const owner = dashboard.todos.find((row: Record<string, any>) => String(row.id) === String(anchor.id))
  const unknownAction = `fly-${Date.now()}`
  const r = await api.req.post('/yolo/actions', {
    data: { action: unknownAction, kind: 'todo', title: uid('请求一个不存在的事项动作') },
  })
  expect(r.status()).toBe(400)
  const j = (await r.json()) as { ok: boolean }
  expect(j.ok).toBe(false)

  const audit = withWorkspaceDatabase(owner, (db) => db.prepare(
    `SELECT kind, summary, detail FROM events
     WHERE kind = 'action_denied' AND summary LIKE ? ORDER BY occurred_at DESC LIMIT 1`,
  ).get(`%${unknownAction}%`) as Record<string, unknown> | undefined)
  expect(audit).toMatchObject({ kind: 'action_denied' })
  expect(String(audit?.summary)).toContain(unknownAction)

  const d = await api.dashboard()
  expect((d.ledger ?? []).some((row: Record<string, any>) => row.kind === 'action_denied')).toBe(false)
  const surfaces = buildDashboardSurfaces(d as YoloDashboardData)
  expect(surfaces.history.recentChanges.some((row) => row.kind === 'action_denied')).toBe(false)
  expect(surfaces.home.recentChanges.some((row) => row.kind === 'action_denied')).toBe(false)
})
