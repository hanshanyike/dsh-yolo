// L2 · ui lane — the day ledger renders on its real machine surface (v5):
// a consolidated merge lands in today's ledger and shows on the 台账 tab.

import { test, expect } from '@playwright/test'
import { connectApi, createFixtures, uid, openYoloPanel, type Api } from '../helpers.ts'

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

test('面板渲染：合并事件进入今日台账（真机表面）', async ({ page }) => {
  const source = await fx.todo(uid('整理客户访谈记录'))
  const target = await fx.todo(uid('写客户访谈纪要'))

  await api.action({ action: 'consolidate', kind: 'todo', id: source.id, into_id: target.id })

  await openYoloPanel(page)
  // v5: the day ledger is its own face (台账 tab), not a bottom fold.
  await page.locator('.y-tabs .ytab[title="今日台账"]').click()
  await expect(page.locator('.yolo-scope')).toContainText('合并：')
})
