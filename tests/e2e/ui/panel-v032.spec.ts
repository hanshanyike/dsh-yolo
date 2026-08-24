// ui 套件 · 浏览器端到端测试 — the two真机-exposed interaction fixes (R18 sidebar switch,
// R19 聊一聊 fresh thread), driven against the real host in a real browser.
//
// W10: the anchored chat must open FRESH — no resident-thread history leaks in.
//   (The model reply itself is a host/LLM concern; here we only assert the pane
//    starts empty and is anchored. A separate HTTP check exercises the reply.)
// W9: the panel overlay must stay within the area right of the sidebar, so a
//   click in the sidebar region reaches the app (and dismisses the panel) —
//   previously an inset:0 pointer layer swallowed it.

import { test, expect, type Page } from '@playwright/test'
import { connectApi, createFixtures, openYoloPanel, todayStr, type Api } from '../helpers.ts'

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

function rowFor(page: Page, title: string) {
  return page.locator('.v2-today-row').filter({ hasText: title })
}

test('W10:「聊一聊」打开的全新锚定对话不含常驻会话历史', async ({ page }) => {
  const title = `[E2E] ${Date.now()} 定稿本周直播排期`
  await fx.todo(title, { due: todayStr() })
  await openYoloPanel(page)

  const row = rowFor(page, title)
  if (await row.count()) {
    await row.getByRole('button', { name: '处理' }).click()
    await page.getByRole('dialog', { name: title }).getByRole('button', { name: '和助手讨论' }).click()
  } else {
    const judgment = page.locator('.v2-judgment').filter({ hasText: title })
    const discuss = judgment.getByRole('button', { name: '讨论', exact: true })
    if (await discuss.count()) await discuss.click()
    else {
      await judgment.getByRole('button', { name: '处理' }).click()
      await page.getByRole('dialog', { name: title }).getByRole('button', { name: '和助手讨论' }).click()
    }
  }
  await expect(page.locator('.dock')).toBeVisible()
  await expect(page.locator('.dock-tag')).toHaveText('锚定')
  await expect(page.locator('.dock-ctx')).toHaveText(title)

  // fresh: no user bubbles (no old history), and the YOLO welcome line is shown
  await expect(page.locator('.dock-msgs .msg.me')).toHaveCount(0)
  await expect(page.locator('.dock-msgs .msg.ai').first()).toContainText(`我们来讨论「${title}」。现在进展怎么样，接下来需要调整什么？`)
})

test('W9:看板描边从侧栏开始，侧栏区点击可让面板让位', async ({ page }) => {
  await openYoloPanel(page)

  // the panel's left edge must sit at/beyond the sidebar's right edge, not 0
  const box = await page.locator('.yolo-scope.panel').boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThan(20) // starts right of the rail, sidebar is clickable

  // a click in the sidebar region (left of the panel) dismisses it
  await page.mouse.click(4, 120)
  await expect(page.locator('.yolo-scope')).toHaveCount(0)
})
