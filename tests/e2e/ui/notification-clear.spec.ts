// ui 套件 · 浏览器端到端测试 — clearing the notification record, against the REAL
// host. Read state alone never shrinks the log: a delivery that was already read
// still occupies a row, so the record grows forever. This spec proves the two
// removal paths the user asked for behave identically in the browser and in
// storage: the per-row × deletes exactly that delivery, and 一键清除 (behind an
// inline confirm) empties the whole record in every known workspace.
//
// The record is seeded through the actions API (author_notification) — the exact
// same storage path the scheduler uses — so the assertions do not wait out the
// scheduler's cadence.

import { test, expect } from '@playwright/test'
import {
  connectApi,
  createFixtures,
  openYoloPanel,
  uid,
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

test('REM-CLEAR-01: 通知记录可逐条删除，并用一键清除清空堆积', async ({ page }) => {
  const keepTitle = uid('提醒我把演示稿发给研发')
  const dropTitle = uid('提醒我确认下周的评审时间')
  await fx.notification(`⏰ ${dropTitle}`, { note: '评审时间还没最终定' })
  await fx.notification(`⏰ ${keepTitle}`, { note: '上一版还没同步，需要补一段结论' })

  await openYoloPanel(page)
  await page.getByRole('button', { name: /^通知，/u }).click()
  const log = page.locator('.notification-log')
  await expect(log).toBeVisible()

  // Seeding marks the baseline read on open; the rows must still be there.
  const dropRow = log.locator('.notification-log__item').filter({ hasText: dropTitle })
  const keepRow = log.locator('.notification-log__item').filter({ hasText: keepTitle })
  await expect(dropRow).toHaveCount(1)
  await expect(keepRow).toHaveCount(1)

  await dropRow.getByRole('button', { name: `删除通知：${dropTitle}` }).click()
  await expect(log.locator('.notification-log__item').filter({ hasText: dropTitle })).toHaveCount(0)
  await expect(keepRow).toHaveCount(1)

  const afterOne = await api.notifications()
  const afterOneTitles = afterOne.items.map((row: Record<string, unknown>) => String(row.title))
  expect(afterOneTitles).not.toContain(`⏰ ${dropTitle}`)
  expect(afterOneTitles).toContain(`⏰ ${keepTitle}`)

  // 一键清除 asks for confirmation first and can be backed out of.
  await log.getByRole('button', { name: '一键清除' }).click()
  const confirm = log.getByRole('alertdialog', { name: '确认清除全部通知' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '取消' }).click()
  await expect(confirm).toHaveCount(0)
  await expect(keepRow).toHaveCount(1)

  await log.getByRole('button', { name: '一键清除' }).click()
  await confirm.getByRole('button', { name: '确认清除' }).click()
  await expect(log.locator('.notification-log__item')).toHaveCount(0)
  await expect(log.locator('.notification-log__empty')).toBeVisible()
  await expect(log.getByRole('button', { name: '一键清除' })).toHaveCount(0)

  await expect.poll(async () => (await api.notifications()).items.length, { timeout: 10_000 }).toBe(0)
  await expect(page.getByRole('button', { name: /^通知，无新通知/u })).toBeVisible({ timeout: 20_000 })
})
