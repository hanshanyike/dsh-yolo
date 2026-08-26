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
