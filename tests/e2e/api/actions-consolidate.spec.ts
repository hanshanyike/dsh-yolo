// api 套件 · HTTP 接口测试（无浏览器）— domain-action contracts over plain HTTP, no browser.
//
// P35: two seeded todos → POST consolidate → target keeps merged fields,
// source is cancelled (gone from the open board), one todo_consolidated event
// lands in the day ledger.
// P34: an invalid action is rejected with 400 and leaves an action_denied
// audit row in the ledger — a denial must never be silent.

import { test, expect } from '@playwright/test'
import { connectApi, createFixtures, uid, type Api } from '../helpers.ts'

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

test('合并两条待办：保留方继承字段、被并方退场、台账留痕（P35）', async () => {
  const source = await fx.todo(uid('把演示稿发给研发'), { due: '2099-01-01' })
  const target = await fx.todo(uid('跟研发同步演示稿反馈'))
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
