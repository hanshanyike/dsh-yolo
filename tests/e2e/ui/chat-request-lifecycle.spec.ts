import { test, expect } from '@playwright/test'
import { connectApi, createFixtures, openYoloPanel, todayStr, uid, type Api } from '../helpers.ts'
import type { ChatMessage, ChatRequestSnapshot } from '../../../src/shared/chat.ts'

let api: Api
test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })

test('W5/W7/W10: 慢回复跨 full/side 与面板重挂载保持，且不会二次 POST', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-25T10:00:00+08:00') })
  const messages: ChatMessage[] = []
  let request: ChatRequestSnapshot | null = null
  let revision = 0
  let postCount = 0

  await page.route('**/yolo/session/messages**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, messages, request, revision }),
    })
  })
  await page.route('**/yolo/session/send', async (route) => {
    postCount++
    const body = route.request().postDataJSON() as { text: string; client_request_id: string }
    request = {
      request_id: 'req-e2e-slow',
      client_request_id: body.client_request_id,
      status: 'accepted',
      text: body.text,
      accepted_at: Date.now(),
      updated_at: Date.now(),
      revision: ++revision,
    }
    messages.push({ role: 'user', text: body.text })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, request, revision }) })
  })

  await openYoloPanel(page)
  await page.getByRole('button', { name: '对话' }).click()
  const input = page.getByRole('textbox', { name: '对 YOLO 说' })
  await input.fill('请确认明天的客户回访安排')
  await input.press('Enter')
  const transcript = page.getByRole('log', { name: '对话记录' })
  await expect(transcript.getByText('已提交，等待助手回复')).toBeVisible()
  expect(postCount).toBe(1)

  // side -> full unmounts/remounts ChatPane; hydration must keep the same request.
  await page.getByRole('button', { name: '全屏' }).click()
  await expect(page.getByRole('log', { name: '对话记录' }).getByText('已提交，等待助手回复')).toBeVisible()
  expect(postCount).toBe(1)

  request = { ...request!, status: 'stale', updated_at: Date.now() + 31_000, revision: ++revision }
  await page.clock.fastForward(4_100)
  await expect(page.getByRole('log', { name: '对话记录' }).getByText('等待时间较长，回复可能仍在处理中')).toBeVisible()

  // Esc returns to side; closing/reopening the panel remounts again. Neither
  // transition is permission to replay the POST.
  await page.keyboard.press('Escape')
  await expect(page.locator('.dock')).toBeVisible()
  await page.locator("button[title^='YOLO 助手看板']").first().click()
  await expect(page.locator('.yolo-scope')).toHaveCount(0)
  await page.locator("button[title^='YOLO 助手看板']").first().click()
  await expect(page.getByRole('log', { name: '对话记录' }).getByText('等待时间较长，回复可能仍在处理中')).toBeVisible()
  expect(postCount).toBe(1)

  messages.push({ role: 'ai', text: '已经确认，明天上午回访客户。' })
  request = { ...request!, status: 'completed', updated_at: Date.now() + 32_000, revision: ++revision }
  await page.clock.fastForward(4_100)
  await expect(page.getByRole('log', { name: '对话记录' }).getByText('已经确认，明天上午回访客户。')).toBeVisible()
  await expect(page.getByText('等待时间较长，回复可能仍在处理中')).toHaveCount(0)
  expect(postCount).toBe(1)
})

test('W10: anchored pending 在面板重开后回到同一线程，关闭后新事项线程不复用', async ({ page }) => {
  const fx = createFixtures(api)
  const title = uid('确认客户回访的交付安排')
  await fx.todo(title, { due: todayStr() })
  const requests = new Map<string, ChatRequestSnapshot>()
  const threadReads = new Set<string>()
  let postCount = 0

  await page.route('**/yolo/session/messages**', async (route) => {
    const thread = new URL(route.request().url()).searchParams.get('thread') ?? 'resident'
    threadReads.add(thread)
    const request = requests.get(thread) ?? null
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, messages: request ? [{ role: 'user', text: request.text }] : [], request, revision: request?.revision ?? 0 }),
    })
  })
  await page.route('**/yolo/session/send', async (route) => {
    postCount++
    const body = route.request().postDataJSON() as { text: string; thread: string; client_request_id: string }
    const request: ChatRequestSnapshot = {
      request_id: `req-${body.thread}`,
      client_request_id: body.client_request_id,
      status: 'accepted',
      text: body.text,
      accepted_at: Date.now(), updated_at: Date.now(), revision: 1,
    }
    requests.set(body.thread, request)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, request, revision: 1 }) })
  })

  const openDiscussion = async (): Promise<void> => {
    const row = page.locator('.v2-today-row').filter({ hasText: title })
    if (await row.count()) await row.getByRole('button', { name: '处理' }).click()
    else {
      const judgment = page.locator('.v2-judgment').filter({ hasText: title })
      const more = judgment.getByRole('button', { name: '更多处理' })
      if (await more.count()) await more.click()
      else await judgment.getByRole('button', { name: '处理' }).click()
    }
    await page.getByRole('dialog', { name: title }).getByRole('button', { name: '和助手讨论' }).click()
  }

  try {
    await openYoloPanel(page)
    await openDiscussion()
    await page.getByRole('textbox', { name: '对 YOLO 说' }).fill('继续跟进这项安排')
    await page.getByRole('textbox', { name: '对 YOLO 说' }).press('Enter')
    await expect(page.getByText('已提交，等待助手回复')).toBeVisible()
    expect(postCount).toBe(1)

    await page.locator("button[title^='YOLO 助手看板']").first().click()
    await page.locator("button[title^='YOLO 助手看板']").first().click()
    await expect(page.locator('.dock-ctx')).toHaveText(title)
    await expect(page.getByText('已提交，等待助手回复')).toBeVisible()
    expect(postCount).toBe(1)

    await page.getByRole('button', { name: '收起侧栏对话' }).click()
    await openDiscussion()
    await expect(page.getByRole('textbox', { name: '对 YOLO 说' })).toBeEnabled()
    await expect(page.getByText('已提交，等待助手回复')).toHaveCount(0)
    expect(threadReads.size).toBeGreaterThanOrEqual(2)
    expect(postCount).toBe(1)
  } finally {
    await fx.dispose()
  }
})
