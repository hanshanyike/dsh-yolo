import { test, expect } from '@playwright/test'
import { connectApi, createFixtures, openYoloPanel, todayStr, uid, type Api } from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(async () => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

async function openPlanToday(page: import('@playwright/test').Page): Promise<void> {
  await openYoloPanel(page, { refreshOnSlow: false })
  await page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^计划/ }).click()
  await page.getByRole('tablist', { name: '计划范围' }).getByRole('tab', { name: '今天', exact: true }).click()
}

type OpenSessionMode = 'unavailable' | 'throw' | 'success'

/** Patch only the slot-injected host bridge in the real browser bundle. This
 * keeps YoloPanel and its state machine real while making the host outcome
 * deterministic for negative and recovery navigation cases. */
async function mockOpenSession(page: import('@playwright/test').Page, mode: OpenSessionMode): Promise<void> {
  await page.route('**/plugins/dsh-plugin-yolo/client.js*', async (route) => {
    const response = await route.fetch()
    const source = await response.text()
    const bridge = /openSession:\s*\(sessionId\)\s*=>\s*\{\s*ctx\.sessions\.open\(sessionId\);\s*\},/u
    let replacement: string
    if (mode === 'unavailable') replacement = 'openSession: void 0,'
    else if (mode === 'throw') replacement = 'openSession: (sessionId) => { throw new Error("模拟宿主导航失败"); },'
    else replacement = 'openSession: (sessionId) => { window.__yoloOpenedSessionIds = [...(window.__yoloOpenedSessionIds ?? []), sessionId]; },'
    const patched = source.replace(bridge, replacement)
    if (patched === source) throw new Error('could not patch YOLO openSession bridge')
    await route.fulfill({ response, body: patched })
  })
}

async function projectSessionSource(
  page: import('@playwright/test').Page,
  itemId: unknown,
  label = '发布约定讨论',
  onlyItem = false,
): Promise<void> {
  await page.route('**/yolo/dashboard?scope=all', async (route) => {
    const response = await route.fetch()
    const body = await response.json() as Record<string, any>
    const rows = onlyItem ? (body.todos ?? []).filter((todo: Record<string, any>) => String(todo.id) === String(itemId)) : (body.todos ?? [])
    body.todos = rows.map((todo: Record<string, any>) => String(todo.id) === String(itemId) ? {
      ...todo,
      source: {
        type: 'session', label, session_id: 'session-source-e2e',
        excerpt: '请继续跟进这项发布约定。', turn: 6, workspace: todo.ws,
      },
    } : todo)
    body.attention = (body.attention ?? []).filter((row: Record<string, any>) => String(row.todo_id) !== String(itemId))
    if (onlyItem) body.notifications = []
    await route.fulfill({ response, json: body })
  })
}

test('手动来源明确降级，不提供原会话跳转', async ({ page }) => {
  const title = uid('确认客户访谈的参与人名单')
  await fx.todo(title, { due: todayStr() })

  await openPlanToday(page)
  const row = page.getByRole('listitem', { name: `任务：${title}` })
  await row.getByRole('button', { name: '快速记一条', exact: true }).click()

  const preview = page.locator(`section[aria-label="来源：${title}"]`)
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('手动记录')
  await expect(preview).toContainText('这项安排由你直接记录，没有关联会话。')
  await expect(preview.getByRole('button', { name: /打开原会话/u })).toHaveCount(0)
  await expect(preview.getByRole('button', { name: '讨论这项安排' })).toBeVisible()

  await preview.getByRole('button', { name: '返回上一层' }).click()
  await expect(preview).toHaveCount(0)
  await expect(row).toBeVisible()
})

test('旧会话来源无摘录时保留会话入口并诚实说明降级', async ({ page }) => {
  const title = uid('核对旧会话中的发布约定')
  const item = await fx.todo(title, { due: todayStr() })
  await page.route('**/yolo/dashboard?scope=all', async (route) => {
    const response = await route.fetch()
    const body = await response.json() as Record<string, any>
    body.todos = (body.todos ?? []).map((todo: Record<string, any>) => todo.id === item.id ? {
      ...todo,
      source: {
        type: 'session', label: '发布约定讨论', session_id: 'legacy-session-without-excerpt',
        excerpt: null, turn: null, workspace: todo.ws,
      },
    } : todo)
    await route.fulfill({ response, json: body })
  })

  await openPlanToday(page)
  const row = page.getByRole('listitem', { name: `任务：${title}` })
  await row.getByRole('button', { name: '发布约定讨论', exact: true }).click()
  const preview = page.locator(`section[aria-label="来源：${title}"]`)
  await expect(preview).toContainText('legacy-session-without-excerpt')
  await expect(preview).toContainText('此事项创建时未保存来源摘录。')
  await expect(preview.getByRole('button', { name: '打开原会话', exact: true })).toBeVisible()
  await expect(preview.locator('blockquote')).toHaveCount(0)
})

for (const mode of ['unavailable', 'throw'] as const) {
  test(`SRC-02: openSession ${mode === 'unavailable' ? '不可用' : '抛错'}时保留来源前景与计划页面`, async ({ page }) => {
    const title = uid(mode === 'unavailable' ? '核对无法打开的来源会话' : '核对导航失败后的来源信息')
    const item = await fx.todo(title, { due: todayStr() })
    await mockOpenSession(page, mode)
    await projectSessionSource(page, item.id)

    await openPlanToday(page)
    const row = page.getByRole('listitem', { name: `任务：${title}` })
    await row.getByRole('button', { name: '发布约定讨论', exact: true }).click()
    const preview = page.locator(`section[aria-label="来源：${title}"]`)
    await preview.getByRole('button', { name: '打开原会话', exact: true }).click()

    await expect(page.locator('.yolo-scope')).toBeVisible()
    await expect(page.locator('aside[data-foreground="source_preview"]')).toHaveCount(1)
    await expect(preview).toBeVisible()
    await expect(page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^计划/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tablist', { name: '计划范围' }).getByRole('tab', { name: '今天', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(preview.getByRole('alert')).toContainText(mode === 'unavailable' ? '当前宿主不支持打开会话。' : '模拟宿主导航失败')
    await expect(preview.getByRole('button', { name: '重试打开原会话' })).toBeVisible()
  })
}

test('SRC-04: 打开来源成功后收起，重开恢复来源并返回事项详情', async ({ page }) => {
  const title = uid('恢复发布回顾的来源位置')
  const item = await fx.todo(title, { due: todayStr() })
  await mockOpenSession(page, 'success')
  await projectSessionSource(page, item.id, '发布回顾会话', true)

  await openYoloPanel(page, { refreshOnSlow: false })
  const homeRow = page.locator('.v2-today-row').filter({ hasText: title })
  await expect(homeRow).toHaveCount(1)
  await homeRow.getByRole('button', { name: '处理', exact: true }).click()
  const detail = page.getByRole('dialog', { name: title })
  await expect(detail).toBeVisible()
  await detail.getByRole('button', { name: /^发布回顾会话/u }).click()
  const preview = page.locator(`section[aria-label="来源：${title}"]`)
  await preview.getByRole('button', { name: '打开原会话', exact: true }).click()

  await expect(page.locator('.yolo-scope')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __yoloOpenedSessionIds?: string[] }).__yoloOpenedSessionIds)).toEqual(['session-source-e2e'])

  await page.locator("button[title^='YOLO 助手看板']").first().click()
  await expect(page.locator('.yolo-scope')).toBeVisible()
  await expect(page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^首页/ })).toHaveAttribute('aria-selected', 'true')
  await expect(preview).toBeVisible()
  await preview.getByRole('button', { name: '返回上一层' }).click()
  await expect(page.getByRole('dialog', { name: title })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __yoloOpenedSessionIds?: string[] }).__yoloOpenedSessionIds)).toEqual(['session-source-e2e'])
})
