import { test, expect } from '@playwright/test'
import { SPLIT_MIN_WIDTH } from '../../../client/panel/navigation.ts'
import { connectApi, createFixtures, openYoloPanel, todayStr, uid, type Api } from '../helpers.ts'
import type { ChatMessage, ChatRequestSnapshot } from '../../../src/shared/chat.ts'

let api: Api
test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })

test('W5/W7/W10: assistant chat 慢回复跨 split/focus 与面板重挂载保持，且 POST 恰好一次', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-25T10:00:00+08:00') })
  const messages: ChatMessage[] = []
  const messagesByThread = new Map<string, ChatMessage[]>()
  const requestsByThread = new Map<string, ChatRequestSnapshot | null>()
  let currentThread = ''
  let request: ChatRequestSnapshot | null = null
  let revision = 0
  let postCount = 0
  const chatThreads = new Set<string>()

  await page.route('**/yolo/session/messages**', async (route) => {
    const thread = new URL(route.request().url()).searchParams.get('thread')
    if (thread) chatThreads.add(thread)
    const threadMessages = thread ? (messagesByThread.get(thread) ?? []) : messages
    const threadRequest = thread ? (requestsByThread.get(thread) ?? null) : request
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, messages: threadMessages, request: threadRequest, revision }),
    })
  })
  await page.route('**/yolo/session/send', async (route) => {
    postCount++
    const body = route.request().postDataJSON() as { text: string; thread: string; client_request_id: string }
    expect(body.thread).toMatch(/^a-/u)
    currentThread = body.thread
    request = {
      request_id: 'req-e2e-slow',
      client_request_id: body.client_request_id,
      status: 'accepted',
      text: body.text,
      accepted_at: Date.now(),
      updated_at: Date.now(),
      revision: ++revision,
    }
    const threadMessages = messagesByThread.get(body.thread) ?? []
    threadMessages.push({ role: 'user', text: body.text })
    messagesByThread.set(body.thread, threadMessages)
    requestsByThread.set(body.thread, request)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, request, revision }) })
  })

  await page.setViewportSize({ width: 1440, height: 760 })
  await openYoloPanel(page)
  const panel = page.locator('.yolo-scope')
  const left = (await panel.boundingBox())?.x
  expect(left).not.toBeUndefined()
  await page.locator('.p-head').getByRole('button', { name: '和助手聊聊' }).click()
  await expect(panel).toHaveAttribute('data-presentation', 'split')
  await expect(page.locator('aside[data-foreground="assistant_chat"]')).toHaveCount(1)
  await expect.poll(() => chatThreads.size).toBe(1)
  const input = page.getByRole('textbox', { name: '对 YOLO 说' })
  await input.fill('请确认明天的客户回访安排')
  await input.press('Enter')
  const transcript = page.getByRole('log', { name: '对话记录' })
  await expect(transcript.getByText('已提交，等待助手回复')).toBeVisible()
  expect(postCount).toBe(1)

  // split -> focus remounts ChatPane; the accepted request stays authoritative.
  await page.setViewportSize({ width: Math.floor(left! + SPLIT_MIN_WIDTH - 2), height: 760 })
  await expect(panel).toHaveAttribute('data-presentation', 'focus')
  await expect(page.getByRole('dialog', { name: '助手对话' })).toBeVisible()
  await expect(page.getByRole('log', { name: '对话记录' }).getByText('已提交，等待助手回复')).toBeVisible()
  expect(postCount).toBe(1)

  request = { ...request!, status: 'stale', updated_at: Date.now() + 31_000, revision: ++revision }
  requestsByThread.set(currentThread, request)
  await page.clock.fastForward(4_100)
  await expect(page.getByRole('log', { name: '对话记录' }).getByText('等待时间较长，回复可能仍在处理中')).toBeVisible()

  // Closing/reopening the host panel remounts the same foreground and request.
  await page.locator("button[title^='YOLO ·']").first().click()
  await expect(page.locator('.yolo-scope')).toHaveCount(0)
  await page.locator("button[title^='YOLO ·']").first().click()
  await expect(page.locator('aside[data-foreground="assistant_chat"]')).toHaveCount(1)
  await expect(page.locator('.yolo-scope')).toHaveAttribute('data-presentation', 'focus')
  await expect(page.getByRole('log', { name: '对话记录' }).getByText('等待时间较长，回复可能仍在处理中')).toBeVisible()
  expect(postCount).toBe(1)

  messages.push({ role: 'ai', text: '已经确认，明天上午回访客户。' })
  messagesByThread.set(currentThread, [...(messagesByThread.get(currentThread) ?? []), { role: 'ai', text: '已经确认，明天上午回访客户。' }])
  request = { ...request!, status: 'completed', updated_at: Date.now() + 32_000, revision: ++revision }
  requestsByThread.set(currentThread, request)
  await page.clock.fastForward(4_100)
  await expect(page.getByRole('log', { name: '对话记录' }).getByText('已经确认，明天上午回访客户。')).toBeVisible()
  await expect(page.getByText('等待时间较长，回复可能仍在处理中')).toHaveCount(0)
  expect(postCount).toBe(1)

  await page.setViewportSize({ width: Math.ceil(left! + SPLIT_MIN_WIDTH + 2), height: 760 })
  await expect(page.locator('.yolo-scope')).toHaveAttribute('data-presentation', 'split')
  await expect(page.locator('.dock').getByText('已经确认，明天上午回访客户。')).toBeVisible()
  expect(postCount).toBe(1)

  // Clicking the top-level entry again after closing starts a clean thread.
  const assistantToggle = page.locator('.p-head').getByRole('button', { name: '和助手聊聊' })
  await assistantToggle.click()
  await expect(page.locator('aside[data-foreground="assistant_chat"]')).toHaveCount(0)
  await assistantToggle.click()
  await expect(page.locator('aside[data-foreground="assistant_chat"]')).toHaveCount(1)
  await expect.poll(() => chatThreads.size).toBe(2)
  await expect(page.getByRole('log', { name: '对话记录' }).getByText('已经确认，明天上午回访客户。')).toHaveCount(0)
  expect(postCount).toBe(1)
})

test('W10/CHAT-01: 新助手会话、事项 A、事项 B 隔离；隐藏继续 episode，显式结束后新建 episode', async ({ page }) => {
  const fx = createFixtures(api)
  const titleA = uid('确认客户回访的交付安排')
  const titleB = uid('核对发布说明的最终版本')
  await fx.todo(titleA, { due: todayStr() })
  await fx.todo(titleB, { due: todayStr() })
  const requests = new Map<string, ChatRequestSnapshot>()
  const threadReads = new Set<string>()
  let postCount = 0

  await page.route('**/yolo/session/messages**', async (route) => {
    const thread = new URL(route.request().url()).searchParams.get('thread') ?? 'legacy-resident'
    threadReads.add(thread)
    const request = requests.get(thread) ?? null
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, messages: request ? [{ role: 'user', text: request.text }] : [], request, revision: request?.revision ?? 0 }),
    })
  })
  await page.route('**/yolo/session/send', async (route) => {
    postCount++
    const body = route.request().postDataJSON() as { text: string; thread?: string; client_request_id: string }
    const thread = body.thread ?? 'legacy-resident'
    const request: ChatRequestSnapshot = {
      request_id: `req-${thread}`,
      client_request_id: body.client_request_id,
      status: 'accepted',
      text: body.text,
      accepted_at: Date.now(), updated_at: Date.now(), revision: 1,
    }
    requests.set(thread, request)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, request, revision: 1 }) })
  })

  const openDiscussion = async (title: string): Promise<void> => {
    const row = page.getByRole('listitem', { name: `任务：${title}` })
    await row.getByRole('button', { name: '快速记一条', exact: true }).click()
    const source = page.locator(`section[aria-label="来源：${title}"]`)
    await source.getByRole('button', { name: '讨论这项安排' }).click()
    await expect(page.locator('aside[data-foreground="item_discussion"]')).toHaveCount(1)
    await expect(page.locator('.dock-ctx')).toHaveText(title)
  }

  try {
    await page.setViewportSize({ width: 1440, height: 760 })
    await openYoloPanel(page)
    await page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^计划/ }).click()
    await page.getByRole('tablist', { name: '计划范围' }).getByRole('tab', { name: '今天', exact: true }).click()
    await openDiscussion(titleA)
    await page.getByRole('textbox', { name: '对 YOLO 说' }).fill('继续跟进这项安排')
    await page.getByRole('textbox', { name: '对 YOLO 说' }).press('Enter')
    await expect(page.getByText('已提交，等待助手回复')).toBeVisible()
    expect(postCount).toBe(1)

    await page.locator("button[title^='YOLO ·']").first().click()
    await page.locator("button[title^='YOLO ·']").first().click()
    await expect(page.locator('.dock-ctx')).toHaveText(titleA)
    await expect(page.getByText('已提交，等待助手回复')).toBeVisible()
    expect(postCount).toBe(1)

    // Switching to the top-level assistant chat starts a new isolated episode
    // and hides A without ending A's episode.
    await page.getByRole('button', { name: '和助手聊聊' }).click()
    await expect(page.locator('aside[data-foreground="assistant_chat"]')).toHaveCount(1)
    await expect(page.getByText('已提交，等待助手回复')).toHaveCount(0)
    await expect.poll(() => [...threadReads].some((thread) => thread.startsWith('a-'))).toBe(true)
    expect(postCount).toBe(1)

    // Return to the board, then B receives a distinct discussion request.
    await page.getByRole('button', { name: '和助手聊聊' }).click()
    await expect(page.locator('aside[data-foreground]')).toHaveCount(0)
    await openDiscussion(titleB)
    await expect(page.getByText('已提交，等待助手回复')).toHaveCount(0)
    await page.getByRole('textbox', { name: '对 YOLO 说' }).fill('请先核对变更说明是否完整')
    await page.getByRole('textbox', { name: '对 YOLO 说' }).press('Enter')
    await expect(page.getByText('已提交，等待助手回复')).toBeVisible()
    expect(postCount).toBe(2)

    await page.getByRole('button', { name: '结束讨论' }).click()
    await openDiscussion(titleA)
    await expect(page.getByText('已提交，等待助手回复')).toBeVisible()
    expect(postCount).toBe(2)

    // Explicitly ending A removes its episode; reopening A creates a clean thread.
    await page.getByRole('button', { name: '结束讨论' }).click()
    await openDiscussion(titleA)
    await expect(page.getByText('已提交，等待助手回复')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: '对 YOLO 说' })).toBeEnabled()
    expect(threadReads.size).toBeGreaterThanOrEqual(4) // assistant-1 + A1 + B + A2
    expect(postCount).toBe(2)
  } finally {
    await fx.dispose()
  }
})
