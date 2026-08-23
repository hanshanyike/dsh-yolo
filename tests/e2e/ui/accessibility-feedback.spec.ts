// These regressions were discovered during the 2026-08-23 full-system review
// and stay as positive real-host gates after their fixes.

import { test, expect } from '@playwright/test'
import { connectApi, createFixtures, openYoloPanel, todayStr, type Api } from '../helpers.ts'

let api: Api

test.beforeAll(async () => {
  api = await connectApi()
})

test.afterAll(async () => {
  await api.close()
})

test('W2: a closed filter menu removes its controls from visibility and keyboard access', async ({ page }) => {
  await openYoloPanel(page)

  await expect(page.getByRole('button', { name: '筛选' })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('checkbox', { name: '仅逾期' })).toBeHidden({ timeout: 1_000 })
})

test('W3: the todo handling panel exposes accessible names for every edit field', async ({ page }) => {
  const fx = createFixtures(api)
  const title = `[E2E] ${Date.now()} 核对客户访谈纪要的发送时间`
  await fx.todo(title, { due: todayStr() })
  try {
    await openYoloPanel(page)
    const row = page.locator('.v2-today-row').filter({ hasText: title })
    await row.getByRole('button', { name: '处理' }).click()

    await expect(page.getByRole('textbox', { name: '标题' })).toBeVisible({ timeout: 1_000 })
    await expect(page.getByRole('textbox', { name: '截止日期与时间' })).toBeVisible({ timeout: 1_000 })
    await expect(page.getByRole('combobox', { name: '优先级' })).toBeVisible({ timeout: 1_000 })
    await expect(page.getByRole('textbox', { name: '里程碑' })).toBeVisible({ timeout: 1_000 })
  } finally {
    await fx.dispose()
  }
})

test('W5: sending remains visibly in progress until an assistant reply arrives', async ({ page }) => {
  await page.route('**/yolo/session/messages**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, messages: [] }) })
  })
  await page.route('**/yolo/session/send', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await openYoloPanel(page)
  await page.getByRole('button', { name: '对话' }).click()
  const input = page.getByRole('textbox', { name: '对 YOLO 说' })
  await input.fill('请提醒我明天下午把客户访谈纪要发给产品组')
  await input.press('Enter')

  const pending = page.getByRole('log', { name: '对话记录' }).getByText(/正在处理/)
  await expect(pending).toBeVisible({ timeout: 1_500 })
  await page.waitForTimeout(800)
  await expect(pending).toBeVisible({ timeout: 1_500 })
})

test('notification cards preserve all user-authored body lines', async ({ page }) => {
  const fx = createFixtures(api)
  const title = `[E2E] ${Date.now()} 客户访谈纪要提醒`
  const secondLine = '请同时抄送负责用户研究的同事'
  await fx.notification(title, { note: `先发送给产品组\\n${secondLine}` })
  try {
    await openYoloPanel(page)
    const card = page.locator('.notif').filter({ hasText: title })
    await expect(card).toBeVisible()
    await expect(card).toContainText(secondLine, { timeout: 1_000 })
  } finally {
    await fx.dispose()
  }
})
