// ui 套件 · 浏览器端到端测试 — 宿主侧栏让位与全新事项讨论，
// driven against the real host in a real browser.
//
// W10: item discussion must open FRESH — no resident-thread history leaks in.
//   (The model reply itself is a host/LLM concern; here we only assert the pane
//    starts empty and is anchored. A separate HTTP check exercises the reply.)
// W9: the panel overlay must stay within the area right of the sidebar, so a
//   click in the sidebar region reaches the app (and dismisses the panel) —
//   previously an inset:0 pointer layer swallowed it.

import { test, expect } from '@playwright/test'
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

test('W10: “讨论这项安排”打开全新 item discussion，不含 assistant chat 历史', async ({ page }) => {
  const title = `[E2E] ${Date.now()} 定稿本周直播排期`
  await fx.todo(title, { due: todayStr() })
  await openYoloPanel(page)

  await page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^计划/ }).click()
  await page.getByRole('tablist', { name: '计划范围' }).getByRole('tab', { name: '今天', exact: true }).click()
  const row = page.getByRole('listitem', { name: `任务：${title}` })
  await row.getByRole('button', { name: '快速记一条', exact: true }).click()
  const source = page.locator(`section[aria-label="来源：${title}"]`)
  await source.getByRole('button', { name: '讨论这项安排' }).click()

  await expect(page.locator('.dock')).toBeVisible()
  await expect(page.locator('aside[data-foreground="item_discussion"]')).toHaveCount(1)
  await expect(page.locator('.dock-tag')).toHaveText('上下文')
  await expect(page.locator('.dock-ctx')).toHaveText(title)

  // Fresh item discussion: no assistant-chat user bubbles, only item context.
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
