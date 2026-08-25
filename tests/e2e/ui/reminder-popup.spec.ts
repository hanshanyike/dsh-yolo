// ui 套件 · 应用内提醒弹窗：历史未读不重放，新提醒非模态提示，
// 点击回到看板；看板已打开时直接刷新通知区而不叠加弹窗。

import { test, expect } from '@playwright/test'
import { connectApi, createFixtures, uid, type Api } from '../helpers.ts'

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
  await expect(page.locator("button[title^='YOLO 助手看板']").first()).toBeVisible({ timeout: 30_000 })
  await baselineResponse
  await expect(page.locator('[aria-label$="条未处理提醒"]').first()).toBeVisible()
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
  await expect(page.locator('.notif').filter({ hasText: openTitle })).toBeVisible({ timeout: 20_000 })

  const whileOpenTitle = uid('提醒我补充上线说明')
  await fx.notification(whileOpenTitle)
  await refreshBadgeAsForeground(page)
  await expect(page.locator('.notif').filter({ hasText: whileOpenTitle })).toBeVisible({ timeout: 12_000 })
  await expect(popup).toHaveCount(0)
})

test('精确到期事项由真实调度器驱动右下角提示与侧栏角标', async ({ page }) => {
  test.setTimeout(120_000)

  const baselineResponse = page.waitForResponse((response) => response.url().includes('/yolo/badge') && response.ok())
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator("button[title^='YOLO 助手看板']").first()).toBeVisible({ timeout: 30_000 })
  await baselineResponse

  const baseline = (await api.dashboard()).unhandled ?? 0
  const title = uid('提醒我喝水')
  const due = new Date(Date.now() + 5_000).toISOString()
  await fx.todo(title, { due })

  const popup = page.locator('.yolo-reminder-popup')
  await expect(popup).toContainText(title, { timeout: 45_000 })
  await expect.poll(async () => {
    const label = await page.locator('[aria-label$="条未处理提醒"]').first().getAttribute('aria-label')
    return Number(label?.match(/^(\d+)/u)?.[1] ?? 0)
  }).toBeGreaterThan(baseline)
  await expect.poll(async () => {
    const dashboard = await api.dashboard()
    return dashboard.notifications.some((row: Record<string, unknown>) => row.todo_id != null && String(row.title).includes(title))
  }, { timeout: 10_000 }).toBe(true)
})
