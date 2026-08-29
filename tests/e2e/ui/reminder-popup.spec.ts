// ui 套件 · 应用内提醒弹窗：历史未读不重放，新提醒非模态提示，
// 点击回到看板；看板已打开时直接刷新通知区而不叠加弹窗。

import { test, expect } from '@playwright/test'
import { connectApi, createFixtures, dismissHostSetupDialogs, openYoloPanel, todayStr, uid, type Api } from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(async () => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

async function refreshBadgeAsForeground(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')) })
}

test('新提醒弹出十秒、可暂停关闭并点击回到看板', async ({ page }) => {
  test.setTimeout(120_000)

  const historical = uid('提醒我提交差旅报销')
  await fx.notification(historical)

  const baselineResponse = page.waitForResponse((response) => response.url().includes('/yolo/badge') && response.ok())
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await dismissHostSetupDialogs(page)
  await expect(page.locator("button[title^='YOLO ·']").first()).toBeVisible({ timeout: 30_000 })
  await baselineResponse
  await expect(page.locator('[aria-label$="条新通知"]').first()).toBeVisible()
  const popup = page.locator('.yolo-reminder-popup')
  await expect(popup).toHaveCount(0)

  const autoTitle = uid('提醒我确认评审时间')
  await fx.notification(autoTitle, { note: '先和产品负责人确认' })
  await refreshBadgeAsForeground(page)
  await expect(popup).toContainText(autoTitle, { timeout: 8_000 })
  await expect(popup).toHaveAttribute('role', 'status')
  await expect(popup).toHaveCount(0, { timeout: 12_000 })

  const pauseTitle = uid('提醒我把会议纪要发给团队')
  await fx.notification(pauseTitle)
  await refreshBadgeAsForeground(page)
  await expect(popup).toContainText(pauseTitle, { timeout: 8_000 })
  await popup.hover()
  await page.waitForTimeout(11_000)
  await expect(popup).toContainText(pauseTitle)
  await popup.getByRole('button', { name: '关闭提醒弹窗' }).click()
  await expect(popup).toHaveCount(0)

  const openTitle = uid('提醒我核对新版发布清单')
  await fx.notification(openTitle)
  await refreshBadgeAsForeground(page)
  await expect(popup).toContainText(openTitle, { timeout: 8_000 })
  await popup.locator('.yolo-reminder-popup__body').click()
  await expect(page.locator('.yolo-scope .brand-name')).toHaveText('YOLO')
  await expect(page.locator('.notification-log__item').filter({ hasText: openTitle })).toBeVisible({ timeout: 20_000 })

  const whileOpenTitle = uid('提醒我补充上线说明')
  await fx.notification(whileOpenTitle)
  await refreshBadgeAsForeground(page)
  await expect(page.locator('.notification-log__item').filter({ hasText: whileOpenTitle })).toBeVisible({ timeout: 12_000 })
  await expect(popup).toHaveCount(0)
})

test('精确到期事项由真实调度器驱动右下角提示与侧栏角标', async ({ page }) => {
  test.setTimeout(120_000)

  const baselineResponse = page.waitForResponse((response) => response.url().includes('/yolo/badge') && response.ok())
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await dismissHostSetupDialogs(page)
  await expect(page.locator("button[title^='YOLO ·']").first()).toBeVisible({ timeout: 30_000 })
  await baselineResponse

  const baseline = (await api.notifications()).unseen ?? 0
  const title = uid('提醒我喝水')
  const due = new Date(Date.now() + 5_000).toISOString()
  await fx.todo(title, { due })

  const popup = page.locator('.yolo-reminder-popup')
  await expect(popup).toContainText(title, { timeout: 45_000 })
  await expect.poll(async () => {
    const label = await page.locator('[aria-label$="条新通知"]').first().getAttribute('aria-label')
    return Number(label?.match(/^(\d+)/u)?.[1] ?? 0)
  }).toBeGreaterThan(baseline)
  await expect.poll(async () => {
    const dashboard = await api.dashboard()
    return dashboard.notifications.some((row: Record<string, unknown>) => row.todo_id != null && String(row.title).includes(title))
  }, { timeout: 10_000 }).toBe(true)
})

for (const foreground of ['item_detail', 'source_preview', 'item_discussion'] as const) {
  test(`REM-HOME-02: ${foreground} 前景打开时新提醒只刷新首页且不抢占`, async ({ page }) => {
    const title = uid(`确认${foreground}中的客户回访安排`)
    const todo = await fx.todo(title, { due: todayStr() })
    await openYoloPanel(page)
    const folded = page.getByRole('button', { name: /查看其余 \d+ 项安排/u })
    if (await folded.isVisible().catch(() => false)) await folded.click()

    const homeItem = page.locator('.v2-judgment, .v2-today-row').filter({ hasText: title })
    const openDetail = homeItem.getByRole('button', { name: /^(处理|更多处理)$/u })
    await expect(openDetail).toHaveCount(1)
    await openDetail.click()
    const detail = page.getByRole('dialog', { name: title })
    await expect(detail).toBeVisible()

    if (foreground !== 'item_detail') {
      await detail.getByRole('button', { name: /^快速记一条/u }).click()
      const source = page.locator(`section[aria-label="来源：${title}"]`)
      await expect(source).toBeVisible()
      if (foreground === 'item_discussion') {
        await source.getByRole('button', { name: '讨论这项安排' }).click()
        await expect(page.getByRole('textbox', { name: '对 YOLO 说' })).toBeVisible()
      }
    }
    await expect(page.locator(`aside[data-foreground="${foreground}"]`)).toHaveCount(1)

    const notification = await fx.notification(uid(`提醒我继续处理 ${foreground}`), { todoId: String(todo.id) })
    await refreshBadgeAsForeground(page)
    await expect.poll(async () => {
      const dashboard = await api.dashboard()
      return dashboard.notifications.some((row: Record<string, any>) => row.id === notification.id && !row.handled)
    }, { timeout: 12_000 }).toBe(true)
    await expect(page.locator(`aside[data-foreground="${foreground}"]`)).toHaveCount(1)
    await expect(page.locator('.yolo-reminder-popup')).toHaveCount(0)
    await expect(page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^首页/ })).toHaveAttribute('aria-selected', 'true')
  })
}
