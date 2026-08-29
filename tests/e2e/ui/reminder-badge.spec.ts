// ui 套件 · 浏览器端到端测试 — reminder / badge closed loop (TB-3..TB-6), against the REAL
// host. The loop proves unread delivery state is independent from Home's
// reminder handling: opening the notification record clears the badge, while
// the deduplicated Home item and its two unhandled reminders remain.
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

test('REM-HOME-01: 同事项两条提醒在首页聚合、通知记录逐条可达，已读不等于已处理', async ({ page }) => {
  const baseline = (await api.notifications()).unseen ?? 0
  const unhandledBaseline = (await api.dashboard()).unhandled ?? 0
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
  await expect(page.locator('.notification-log')).toHaveCount(0)
  await expect(homeItem.getByRole('button', { name: '知道了' })).toBeVisible()

  const bell = page.getByRole('button', { name: `通知，${baseline + 2} 条新通知` })
  await expect(bell).toBeVisible({ timeout: 20_000 })
  await bell.click()
  const log = page.locator('.notification-log')
  await expect(log).toBeVisible()
  const matchingNotifications = log.locator('.notification-log__item').filter({ hasText: title })
  await expect(matchingNotifications).toHaveCount(2)
  await expect(matchingNotifications.getByRole('button', { name: '查看事项' })).toHaveCount(2)
  await expect(log.getByRole('button', { name: /完成|推迟|知道了/u })).toHaveCount(0)
  await expect.poll(async () => (await api.notifications()).unseen, { timeout: 10_000 }).toBe(0)
  await expect(log.locator('.notification-log__item.is-new').filter({ hasText: title })).toHaveCount(0)
  await log.getByRole('button', { name: '关闭通知记录' }).click()

  const stillPending = page.locator('.v2-judgment, .v2-today-row').filter({ hasText: title })
  await expect(stillPending).toHaveCount(1)
  await expect(stillPending).toContainText('有 2 条未处理提醒')

  // Home owns handling: exactly one reminder retires while the already-read badge stays clear.
  await stillPending.getByRole('button', { name: '知道了' }).click()
  await expect
    .poll(async () => (await api.dashboard()).unhandled ?? 0, { timeout: 10_000 })
    .toBe(unhandledBaseline + 1)
  await expect(page.getByRole('button', { name: '通知，无新通知' })).toBeVisible({ timeout: 20_000 })
  const remainingHomeItem = page.locator('.v2-judgment, .v2-today-row').filter({ hasText: title })
  await expect(remainingHomeItem).toHaveCount(1)
  await expect(remainingHomeItem.getByRole('button', { name: '知道了' })).toBeVisible()

  const dashboard = await api.dashboard()
  const reminders = (dashboard.notifications as Array<Record<string, any>>)
    .filter((row) => row.id === first.id || row.id === second.id)
  expect(reminders).toHaveLength(2)
  expect(reminders.filter((row) => row.handled)).toHaveLength(1)
  expect(reminders.filter((row) => !row.handled)).toHaveLength(1)
  expect(reminders.filter((row) => row.seen)).toHaveLength(2)
  expect((dashboard.todos as Array<Record<string, any>>).find((row) => row.id === todo.id)?.status).toBe('pending')
})
