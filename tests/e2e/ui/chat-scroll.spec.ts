import { test, expect, type Locator } from '@playwright/test'
import { openYoloPanel } from '../helpers.ts'
import type { ChatRequestSnapshot } from '../../../src/shared/chat.ts'

interface ChatMessage {
  role: 'user' | 'ai'
  text: string
}

async function expectAtBottom(owner: Locator): Promise<void> {
  await expect.poll(() => owner.evaluate((element) => (
    element.scrollHeight - element.clientHeight - element.scrollTop
  ))).toBeLessThanOrEqual(2)
}

async function scrollToTop(owner: Locator): Promise<void> {
  await owner.evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await expect.poll(() => owner.evaluate((element) => element.scrollTop)).toBe(0)
}

test('W5/W7/W10: 长历史在 side/full 各自 owner 跟随最新且不抢用户上翻位置', async ({ page }) => {
  const messages: ChatMessage[] = Array.from({ length: 48 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'ai',
    text: `历史消息 ${index + 1}\n这是用于验证真实滚动容器的较长内容，保持对话具有足够高度。`,
  }))
  const sideArrival = '侧栏上翻后到达的新消息'
  const reply = '已收到，我会按新的安排继续跟进。'
  const fullArrival = '全屏上翻后到达的新消息'
  let request: ChatRequestSnapshot | null = null
  let revision = 0

  await page.route('**/yolo/session/messages**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, messages, request, revision }),
    })
  })
  await page.route('**/yolo/session/send', async (route) => {
    const body = route.request().postDataJSON() as { text: string; client_request_id: string }
    messages.push({ role: 'user', text: body.text })
    request = {
      request_id: 'req-scroll', client_request_id: body.client_request_id, status: 'accepted', text: body.text,
      accepted_at: Date.now(), updated_at: Date.now(), revision: ++revision,
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, request, revision }) })
    setTimeout(() => {
      messages.push({ role: 'ai', text: reply })
      request = { ...request!, status: 'completed', updated_at: Date.now(), revision: ++revision }
    }, 400)
  })

  await page.setViewportSize({ width: 1440, height: 760 })
  await openYoloPanel(page)
  await page.getByRole('button', { name: '对话' }).click()

  const sideOwner = page.locator('.chat-pane-shell--side .dock-msgs')
  await expect(sideOwner.locator('.msg')).toHaveCount(messages.length)
  await expect(sideOwner).toHaveCSS('overflow-y', 'auto')
  await expect.poll(() => sideOwner.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await expectAtBottom(sideOwner)

  const input = page.getByRole('textbox', { name: '对 YOLO 说' })
  await expect(input).toBeFocused()
  await scrollToTop(sideOwner)
  messages.push({ role: 'ai', text: sideArrival })
  const newest = page.getByRole('button', { name: '有新消息，回到最新' })
  await expect(newest).toBeVisible({ timeout: 6_000 })
  await expect(input).toBeFocused()
  expect(await sideOwner.evaluate((element) => element.scrollTop)).toBe(0)
  await newest.click()
  await expectAtBottom(sideOwner)

  await input.fill('请把刚才的安排继续往下跟进')
  await input.press('Enter')
  await expect(sideOwner.getByText('已提交，等待助手回复')).toBeVisible()
  await expectAtBottom(sideOwner)
  await expect(sideOwner.getByText(reply)).toBeVisible({ timeout: 6_000 })
  await expectAtBottom(sideOwner)

  await page.locator('.dock .dact').filter({ hasText: '全屏' }).click()
  const fullOwner = page.locator('.chat-pane-shell--full > .p-body')
  await expect(fullOwner).toBeVisible()
  await expect(fullOwner).toHaveCSS('overflow-y', 'auto')
  await expect.poll(() => fullOwner.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await expectAtBottom(fullOwner)

  const fullInput = page.getByRole('textbox', { name: '对 YOLO 说' })
  await expect(fullInput).toBeFocused()
  await scrollToTop(fullOwner)
  messages.push({ role: 'ai', text: fullArrival })
  await expect(page.getByRole('button', { name: '有新消息，回到最新' })).toBeVisible({ timeout: 6_000 })
  await expect(fullInput).toBeFocused()
  expect(await fullOwner.evaluate((element) => element.scrollTop)).toBe(0)
  await page.getByRole('button', { name: '有新消息，回到最新' }).click()
  await expectAtBottom(fullOwner)

  await page.getByRole('button', { name: '侧栏' }).click()
  const restoredSideOwner = page.locator('.chat-pane-shell--side .dock-msgs')
  await expect(restoredSideOwner).toBeVisible()
  await expectAtBottom(restoredSideOwner)
})
