// These regressions were discovered during the 2026-08-23 full-system review
// and stay as positive real-host gates after their fixes.

import { test, expect } from '@playwright/test'
import { SPLIT_MIN_WIDTH } from '../../../client/panel/navigation.ts'
import { connectApi, createFixtures, openYoloPanel, revealHomeItems, todayStr, type Api } from '../helpers.ts'

let api: Api

test.beforeAll(async () => {
  api = await connectApi()
})

test.afterAll(async () => {
  await api.close()
})

test('W2: a closed filter menu removes its controls from visibility and keyboard access', async ({ page }) => {
  await openYoloPanel(page)
  await page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^计划/ }).click()

  const filter = page.getByRole('button', { name: '筛选事项，未启用筛选条件', exact: true })
  await expect(filter).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('checkbox', { name: '仅逾期' })).toBeHidden({ timeout: 1_000 })
  await filter.click()
  await expect(page.getByRole('dialog', { name: '筛选事项' })).toBeVisible()
  await expect(filter).toHaveAttribute('aria-expanded', 'true')
})

test('W3: the todo handling panel exposes accessible names for every edit field', async ({ page }) => {
  const fx = createFixtures(api)
  const title = `[E2E] ${Date.now()} 核对客户访谈纪要的发送时间`
  await fx.todo(title, { due: todayStr() })
  try {
    await openYoloPanel(page)
    await revealHomeItems(page)
    const row = page.locator('.v2-judgment, .v2-today-row').filter({ hasText: title })
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
  await page.getByRole('button', { name: '和助手聊聊' }).click()
  await expect(page.locator('.yolo-scope')).toHaveAttribute('data-presentation', /split|focus/u)
  const input = page.getByRole('textbox', { name: '对 YOLO 说' })
  await input.fill('请提醒我明天下午把客户访谈纪要发给产品组')
  await input.press('Enter')

  const pending = page.getByRole('log', { name: '对话记录' }).getByText(/正在提交|已提交，等待助手回复|等待时间较长/)
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
    await expect(card.getByRole('button', { name: '讨论这条提醒' })).toBeVisible()
  } finally {
    await fx.dispose()
  }
})

test('A11Y-02: 一级 Tab 使用 roving tabindex 并支持方向键、Home、End', async ({ page }) => {
  await openYoloPanel(page)
  const tabs = page.getByRole('tablist', { name: '助手页面' })
  const home = tabs.getByRole('tab', { name: /^首页/ })
  const plan = tabs.getByRole('tab', { name: /^计划/ })
  const history = tabs.getByRole('tab', { name: /^历史/ })
  await expect(home).toHaveAttribute('tabindex', '0')
  await expect(plan).toHaveAttribute('tabindex', '-1')
  await expect(history).toHaveAttribute('tabindex', '-1')

  await home.focus()
  await home.press('ArrowRight')
  await expect(plan).toBeFocused()
  await expect(plan).toHaveAttribute('aria-selected', 'true')
  await plan.press('End')
  await expect(history).toBeFocused()
  await history.press('Home')
  await expect(home).toBeFocused()
  await home.press('ArrowLeft')
  await expect(history).toBeFocused()
  await expect(history).toHaveAttribute('tabindex', '0')
  await expect(home).toHaveAttribute('tabindex', '-1')
})

test('A11Y-01: focus 前景约束焦点且隐藏背景，split 上下文非 modal', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 })
  await openYoloPanel(page)
  const panel = page.locator('.yolo-scope')
  await page.getByRole('button', { name: '和助手聊聊' }).click()
  await expect(panel).toHaveAttribute('data-presentation', 'focus')
  const dialog = page.getByRole('dialog', { name: '助手对话' })
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  const background = dialog.locator('xpath=preceding-sibling::div[1]')
  await expect(background).toHaveAttribute('aria-hidden', 'true')
  await expect(background).toHaveCSS('display', 'none')

  await dialog.getByRole('textbox', { name: '对 YOLO 说' }).fill('准备检查焦点循环')
  const focusables = dialog.locator('textarea:not(:disabled):visible, input:not(:disabled):visible, button:not(:disabled):visible, [tabindex]:not([tabindex="-1"]):visible')
  expect(await focusables.count()).toBeGreaterThanOrEqual(1)
  const first = focusables.first()
  const last = focusables.last()
  await last.focus()
  await last.press('Tab')
  await expect(first).toBeFocused()
  await first.press('Shift+Tab')
  await expect(last).toBeFocused()

  const left = (await panel.boundingBox())?.x
  expect(left).not.toBeUndefined()
  await page.setViewportSize({ width: Math.ceil(left! + SPLIT_MIN_WIDTH + 2), height: 800 })
  await expect(panel).toHaveAttribute('data-presentation', 'split')
  const split = page.locator('aside[data-foreground="assistant_chat"]')
  await expect(split).not.toHaveAttribute('role', 'dialog')
  await expect(split).not.toHaveAttribute('aria-modal', 'true')
  await expect(split.locator('xpath=preceding-sibling::div[1]')).not.toHaveAttribute('aria-hidden', 'true')
  const pages = page.getByRole('tablist', { name: '助手页面' })
  await pages.getByRole('tab', { name: /^计划/ }).click()
  await expect(pages.getByRole('tab', { name: /^计划/ })).toHaveAttribute('aria-selected', 'true')
  await expect(split).toBeVisible()
})

test('A11Y-02: dashboard 刷新不在 polite live region 重复挂载同一消息', async ({ page }) => {
  const message = '客户回访安排已经确认。'
  await page.route('**/yolo/session/messages**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, messages: [{ role: 'ai', text: message }], request: null, revision: 1 }),
    })
  })
  await openYoloPanel(page)
  await page.getByRole('button', { name: '和助手聊聊' }).click()
  const log = page.getByRole('log', { name: '对话记录' })
  await expect(log).toHaveAttribute('aria-live', 'polite')
  const rendered = log.locator('.msg.ai').filter({ hasText: message })
  await expect(rendered).toHaveCount(1)

  await page.getByRole('button', { name: '更多看板操作' }).click()
  await page.getByRole('menuitem', { name: '刷新看板' }).click()
  await expect(rendered).toHaveCount(1)
  await expect(page.locator('aside[data-foreground="assistant_chat"]')).toHaveCount(1)
})
