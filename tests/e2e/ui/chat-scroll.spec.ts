import { test, expect, type Locator } from '@playwright/test'
import { SPLIT_MIN_WIDTH } from '../../../client/panel/navigation.ts'
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

test('W5/W7/W10: assistant chat 长历史在 split/focus 各自 owner 跟随最新且不抢用户上翻位置', async ({ page }) => {
  const messages: ChatMessage[] = Array.from({ length: 48 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'ai',
    text: `历史消息 ${index + 1}\n这是用于验证真实滚动容器的较长内容，保持对话具有足够高度。`,
  }))
  const splitArrival = '双栏上翻后到达的新消息'
  const reply = '已收到，我会按新的安排继续跟进。'
  const focusArrival = '聚焦模式上翻后到达的新消息'
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
  const panel = page.locator('.yolo-scope')
  const left = (await panel.boundingBox())?.x
  expect(left).not.toBeUndefined()
  await page.getByRole('button', { name: '和助手聊聊' }).click()
  await expect(panel).toHaveAttribute('data-presentation', 'split')
  await expect(page.locator('aside[data-foreground="assistant_chat"]')).toHaveCount(1)

  const splitOwner = page.locator('.chat-pane-shell--side .dock-msgs')
  await expect(splitOwner.locator('.msg')).toHaveCount(messages.length)
  await expect(splitOwner).toHaveCSS('overflow-y', 'auto')
  await expect.poll(() => splitOwner.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await expectAtBottom(splitOwner)

  const input = page.getByRole('textbox', { name: '对 YOLO 说' })
  // Establish the real user state under test. autoFocus timing is owned by the
  // browser click lifecycle; this scenario verifies that polling/new messages
  // preserve an input the user is actively using.
  await input.focus()
  await expect(input).toBeFocused()
  await input.fill('第一行消息\n第二行消息')
  await expect.poll(() => input.evaluate((element) => element.tagName)).toBe('TEXTAREA')
  await expect.poll(() => input.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(36)
  await input.fill('')
  await scrollToTop(splitOwner)
  await expect(input).toBeFocused()
  const splitPoll = page.waitForResponse('**/yolo/session/messages**')
  messages.push({ role: 'ai', text: splitArrival })
  revision += 1
  await splitPoll
  const newest = page.getByRole('button', { name: '有新消息，回到最新' })
  await expect(newest).toBeVisible()
  await expect(input).toBeFocused()
  expect(await splitOwner.evaluate((element) => element.scrollTop)).toBe(0)
  await newest.click()
  await expectAtBottom(splitOwner)

  await input.fill('请把刚才的安排继续往下跟进')
  await input.press('Enter')
  await expect(splitOwner.getByText('已提交，等待助手回复')).toBeVisible()
  await expectAtBottom(splitOwner)
  await expect(splitOwner.getByText(reply)).toBeVisible({ timeout: 6_000 })
  await expectAtBottom(splitOwner)

  await page.setViewportSize({ width: Math.floor(left! + SPLIT_MIN_WIDTH - 2), height: 760 })
  await expect(panel).toHaveAttribute('data-presentation', 'focus')
  const focusOwner = page.locator('.chat-pane-shell--full > .p-body')
  await expect(focusOwner).toBeVisible()
  await expect(focusOwner).toHaveCSS('overflow-y', 'auto')
  await expect.poll(() => focusOwner.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await expectAtBottom(focusOwner)

  const focusInput = page.getByRole('textbox', { name: '对 YOLO 说' })
  await focusInput.focus()
  await expect(focusInput).toBeFocused()
  await scrollToTop(focusOwner)
  await expect(focusInput).toBeFocused()
  const focusPoll = page.waitForResponse('**/yolo/session/messages**')
  messages.push({ role: 'ai', text: focusArrival })
  revision += 1
  await focusPoll
  await expect(page.getByRole('button', { name: '有新消息，回到最新' })).toBeVisible()
  await expect(focusInput).toBeFocused()
  expect(await focusOwner.evaluate((element) => element.scrollTop)).toBe(0)
  await page.getByRole('button', { name: '有新消息，回到最新' }).click()
  await expectAtBottom(focusOwner)

  await page.setViewportSize({ width: Math.ceil(left! + SPLIT_MIN_WIDTH + 2), height: 760 })
  await expect(panel).toHaveAttribute('data-presentation', 'split')
  const restoredSplitOwner = page.locator('.chat-pane-shell--side .dock-msgs')
  await expect(restoredSplitOwner).toBeVisible()
  await expectAtBottom(restoredSplitOwner)
})
