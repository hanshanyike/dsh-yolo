// ui 套件 · 浏览器端到端测试 — reminder / badge closed loop (TB-3..TB-6), against the REAL
// host. The loop is: an unhandled reminder → sidebar dot badge + kanban
// notification card → 「知道了」handles it → card leaves the surface and the
// badge returns to baseline.
//
// The scheduler fires cards on its own cadence (too slow for a deterministic
// run), so the seeded card is authored through the actions API
// (author_notification) — the exact same storage path the scheduler uses.
//
// Determinism note: the card is seeded BEFORE the first page load, and the
// sidebar badge fetches once on mount — so the badge count is asserted right
// after the panel opens instead of waiting out the badge's 30s poll tick.

import { test, expect } from '@playwright/test'
import {
  connectApi,
  createFixtures,
  uid,
  openYoloPanel,
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

test('未处理提醒驱动角标与通知卡，处理后归零（TB-3~TB-6）', async ({ page }) => {
  // be robust to reminders left by earlier manual runs in the host
  const baseline = (await api.dashboard()).unhandled ?? 0
  const title = uid('提醒我把演示稿发给研发')
  const note = '上一版还没同步，需要补一段结论'
  await fx.notification(`⏰ ${title}`, { note })

  await openYoloPanel(page)

  // the notification card renders at the panel top with kind + body
  const card = page.locator('.notif').filter({ hasText: title })
  await expect(card).toBeVisible()
  await expect(card).toContainText('到期提醒')
  await expect(card).toContainText(note)

  // the sidebar badge picked the card up on mount (badge fetches on load;
  // budget covers one slow dashboard roundtrip on a cold machine)
  await expect(page.locator(`[aria-label="${baseline + 1} 条未处理提醒"]`)).toBeVisible({ timeout: 20_000 })

  // 「知道了」dismisses the card and zeroes the badge back to baseline
  await card.locator('button', { hasText: '知道了' }).click()
  await expect(page.locator('.notif').filter({ hasText: title })).toHaveCount(0)
  await expect
    .poll(async () => (await api.dashboard()).unhandled ?? 0, { timeout: 10_000 })
    .toBe(baseline)
})
