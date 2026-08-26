// ui 套件 · 浏览器端到端测试 — reminder / badge closed loop (TB-3..TB-6), against the REAL
// host. The loop is: an unhandled reminder → exact sidebar badge + one
// deduplicated Home item → 「知道了」handles the notification without completing
// the todo → the badge returns to baseline.
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
  todayStr,
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

test('REM-HOME-01: 同事项两条提醒聚合为一项，处理一条后角标 2→1 且事项仍开放', async ({ page }) => {
  // be robust to reminders left by earlier manual runs in the host
  const baseline = (await api.dashboard()).unhandled ?? 0
  const title = uid('提醒我把演示稿发给研发')
  const note = '上一版还没同步，需要补一段结论'
  const todo = await fx.todo(title, { due: todayStr() })
  const first = await fx.notification(`⏰ ${title}`, { note, todoId: String(todo.id) })
  const second = await fx.notification(`${title} 的补充提醒`, { note: '还需要确认最终收件人', todoId: String(todo.id) })

  await openYoloPanel(page)
  const folded = page.getByRole('button', { name: /查看其余 \d+ 项安排/u })
  if (await folded.isVisible().catch(() => false)) await folded.click()

  const homeItem = page.locator('.v2-judgment, .v2-today-row').filter({ hasText: title })
  await expect(homeItem).toHaveCount(1)
  await expect(homeItem).toContainText('有 2 条未处理提醒')
  await expect(page.locator('.notif').filter({ hasText: title })).toHaveCount(0)
  await expect(homeItem.getByRole('button', { name: '知道了' })).toBeVisible()

  // the sidebar badge picked the card up on mount (badge fetches on load;
  // budget covers one slow dashboard roundtrip on a cold machine)
  await expect(page.locator(`[aria-label="${baseline + 2} 条未处理提醒"]`)).toBeVisible({ timeout: 20_000 })

  // 「知道了」handles exactly one notification: the other reminder and todo stay open.
  await homeItem.getByRole('button', { name: '知道了' }).click()
  await expect
    .poll(async () => (await api.dashboard()).unhandled ?? 0, { timeout: 10_000 })
    .toBe(baseline + 1)
  await expect(page.locator(`[aria-label="${baseline + 1} 条未处理提醒"]`)).toBeVisible({ timeout: 20_000 })
  const remainingHomeItem = page.locator('.v2-judgment, .v2-today-row').filter({ hasText: title })
  await expect(remainingHomeItem).toHaveCount(1)
  await expect(remainingHomeItem.getByRole('button', { name: '知道了' })).toBeVisible()

  const dashboard = await api.dashboard()
  const reminders = (dashboard.notifications as Array<Record<string, any>>)
    .filter((row) => row.id === first.id || row.id === second.id)
  expect(reminders).toHaveLength(2)
  expect(reminders.filter((row) => row.handled)).toHaveLength(1)
  expect(reminders.filter((row) => !row.handled)).toHaveLength(1)
  expect((dashboard.todos as Array<Record<string, any>>).find((row) => row.id === todo.id)?.status).toBe('pending')
})
