// E2E — consolidate + denied audit (M9 / P34+P35), against the REAL host.
// Loop 1: two seeded todos → POST consolidate → target keeps merged fields,
// source is cancelled (gone from the open board), one todo_consolidated event
// lands in the day ledger and renders in the panel.
// Loop 2: an invalid action is rejected with 400 and leaves an action_denied
// audit row in the ledger — a denial must never be silent (P34).

import { test, expect } from '@playwright/test'
import {
  connectApi,
  createTodo,
  cleanupPrefixedTodos,
  cleanupPrefixedNotifications,
  uid,
  openYoloPanel,
  type Api,
} from './helpers.ts'

let api: Api

test.beforeAll(async () => {
  api = await connectApi()
})
test.afterAll(async () => {
  await cleanupPrefixedTodos(api)
  await cleanupPrefixedNotifications(api)
  await api.close()
})
test.beforeEach(async () => {
  await cleanupPrefixedTodos(api)
  await cleanupPrefixedNotifications(api)
})

test('合并两条待办：保留方继承字段、被并方退场、台账留痕（P35）', async () => {
  const source = await createTodo(api, uid('把演示稿发给研发'), { due: '2099-01-01' })
  const target = await createTodo(api, uid('跟研发同步演示稿反馈'))
  // quick_add 默认今日到期；继承规则只在 target 无截止时触发，先清空它
  await api.action({ action: 'update', kind: 'todo', id: target.id, due_at: null })

  const res = await api.action({ action: 'consolidate', kind: 'todo', id: source.id, into_id: target.id })
  expect(res.ok).toBe(true)
  const item = res.item as Record<string, any>
  expect(item).toMatchObject({ id: target.id, status: 'pending' })
  expect(String(item.due_at)).toBe('2099-01-01') // inherited: target had no due
  expect(String(item.detail)).toContain('已并入')

  const d = await api.dashboard()
  const rows = (d.todos ?? []) as { id: string; title: string; status: string }[]
  const src = rows.find((t) => t.id === source.id)
  const dst = rows.find((t) => t.id === target.id)
  expect(src?.status).toBe('cancelled')
  expect(dst?.status).toBe('pending')

  const ledger = (d.ledger ?? []) as { kind: string; summary: string }[]
  const ev = ledger.find((e) => e.kind === 'todo_consolidated')
  expect(ev).toBeTruthy()
  expect(ev?.summary).toContain('合并')
})

test('非法动作被拒绝且落 action_denied 审计（P34）', async () => {
  const r = await api.req.post('/yolo/actions', {
    data: { action: 'fly', kind: 'todo', title: uid('不存在的动作') },
  })
  expect(r.status()).toBe(400)
  const j = (await r.json()) as { ok: boolean }
  expect(j.ok).toBe(false)

  const d = await api.dashboard()
  const ledger = (d.ledger ?? []) as { kind: string; summary: string }[]
  const ev = ledger.find((e) => e.kind === 'action_denied')
  expect(ev).toBeTruthy()
  expect(ev?.summary).toContain('fly')
})

test('面板渲染：合并事件进入今日台账（真机表面）', async ({ page }) => {
  const source = await createTodo(api, uid('整理客户访谈记录'))
  const target = await createTodo(api, uid('写客户访谈纪要'))

  await api.action({ action: 'consolidate', kind: 'todo', id: source.id, into_id: target.id })

  await openYoloPanel(page)
  // v5: the day ledger is its own face (台账 tab), not a bottom fold.
  await page.locator('.y-tabs .ytab[title="今日台账"]').click()
  await expect(page.locator('.yolo-scope')).toContainText('合并：')
})
