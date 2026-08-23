// L2 · ui lane — core panel interaction flow (TA-1..TA-6), driven against the
// REAL running host through its HTTP endpoints + a real browser. Fixtures are
// seeded via POST /yolo/actions with a unique [E2E] prefix and disposed by id
// after each test (createFixtures), so rows created through raw browser UI
// (the capture bar) are registered with trackTodo() once they exist.
//
// The task titles are realistic developer sentences ("核对接口字段",
// "回复设计评审的意见"…); the [E2E] prefix labels them as machine fixture data
// (see helpers.ts note on the realistic-wording sweep).

import { test, expect, type Page } from '@playwright/test'
import {
  connectApi,
  createFixtures,
  uid,
  openYoloPanel,
  todayStr,
  yesterdayStr,
  type Api,
} from '../helpers.ts'

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

/** A kanban row whose title contains `title` (scoped to rendered task sections). */
function rowFor(page: Page, title: string) {
  return page.locator('.sec .row').filter({ hasText: title })
}

test('打开助手看板并按真实任务渲染今日行（TA-1/TA-2）', async ({ page }) => {
  const title = uid('给首页改版核对接口字段')
  await fx.todo(title, { due: todayStr() })

  await openYoloPanel(page)

  const row = rowFor(page, title)
  await expect(row).toBeVisible()
  // the due slot reads「今天」for a same-day task (5.2)
  await expect(row.locator('.due')).toHaveText('今天')
})

test('完成任务弹出撤销，4 秒内撤销后任务恢复原位（TA-3 / 5.4）', async ({ page }) => {
  const title = uid('回复设计评审的修改意见')
  await fx.todo(title, { due: todayStr() })

  await openYoloPanel(page)
  const row = rowFor(page, title)
  await expect(row).toBeVisible()

  // complete via the leading check control
  await row.locator('.ctl').click()
  const toast = page.locator('.toast').filter({ hasText: '已完成' })
  await expect(toast).toBeVisible()
  await expect(toast.locator('button', { hasText: '撤销' })).toBeVisible()
  // the row retires from the open sections
  await expect(row).toHaveCount(0)

  // undo within the 4s window restores it
  await toast.locator('button', { hasText: '撤销' }).click()
  await expect(page.locator('.toast').filter({ hasText: '已撤销' })).toBeVisible()
  await expect(row).toBeVisible()
})

test('逾期聚焦胶囊只保留逾期任务（TA-4）', async ({ page }) => {
  const overdueTitle = uid('把渠道预算缺口补上')
  const todayTitle = uid('给周会整理三点结论')
  await fx.todo(overdueTitle, { due: yesterdayStr() })
  await fx.todo(todayTitle, { due: todayStr() })

  await openYoloPanel(page)
  // both show under their sections by default
  await expect(rowFor(page, overdueTitle)).toBeVisible()
  await expect(rowFor(page, todayTitle)).toBeVisible()

  // focus the 逾期 capsule → only the overdue row remains
  await page.locator('.caps .cap').filter({ hasText: /逾期/ }).click()
  await expect(rowFor(page, overdueTitle)).toBeVisible()
  await expect(rowFor(page, todayTitle)).toHaveCount(0)
})

test('捕获条快速记一条并落入看板（TA-2 快捷入口）', async ({ page }) => {
  const title = uid('给演示准备一台备用显示器')
  await openYoloPanel(page)

  await page.locator('.cap-input').fill(title)
  await page.keyboard.press('Enter')
  await expect(page.locator('.toast').filter({ hasText: '已记下' })).toBeVisible()
  // this row was born in the browser, not through the API — look its id up
  // once so dispose() can remove it by id like every other fixture
  const d = await api.dashboard()
  const row = ((d.todos ?? []) as { id: string; title: string }[]).find((t) => t.title === title)
  if (row) fx.trackTodo(String(row.id))
  await expect(rowFor(page, title)).toBeVisible()
})

test('卡片「聊一聊」打开侧栏对话并锚定该任务（TA-5）', async ({ page }) => {
  const title = uid('定稿本周直播的主题')
  await fx.todo(title, { due: todayStr() })
  await openYoloPanel(page)

  await rowFor(page, title).locator('[aria-label="聊一聊"]').click()
  await expect(page.locator('.dock')).toBeVisible()
  await expect(page.locator('.dock-tag')).toHaveText('锚定')
  await expect(page.locator('.dock-ctx')).toHaveText(title)
})

test('Esc 逐级退出：全屏对话→侧栏→关闭面板（TA-6）', async ({ page }) => {
  await openYoloPanel(page)

  // side chat → expand fullscreen
  await page.locator('.p-head .ctoggle').filter({ hasText: '对话' }).click()
  await expect(page.locator('.dock')).toBeVisible()
  await page.locator('.dact').filter({ hasText: '全屏' }).click()
  await expect(page.locator('.p-head .ctoggle').filter({ hasText: '侧栏' })).toBeVisible()

  // Esc 1: fullscreen → side dock (still open)
  await page.keyboard.press('Escape')
  await expect(page.locator('.dock')).toBeVisible()
  // Esc 2: side dock → closed
  await page.keyboard.press('Escape')
  await expect(page.locator('.dock')).toHaveCount(0)
  // Esc 3: panel closed
  await page.keyboard.press('Escape')
  await expect(page.locator('.yolo-scope')).toHaveCount(0)
})
