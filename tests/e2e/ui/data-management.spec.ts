import { test, expect } from '@playwright/test'
import {
  connectApi,
  createFixtures,
  openYoloPanel,
  revealHomeItems,
  todayStr,
  uid,
  waitForDashboard,
  type Api,
} from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(() => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

async function openDataManager(page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator> {
  await page.getByRole('button', { name: '更多看板操作' }).click()
  await page.getByRole('menuitem', { name: '事项数据管理' }).click()
  const dialog = page.getByRole('dialog', { name: '按日期处理事项' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('W3/W12/W13/W15: 日期范围先预览，批量取消后可永久删除', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  const rangeDay = '2098-07-23'
  const first = await fx.todo(uid('向产品组发送客户访谈结论'), { due: rangeDay })
  const second = await fx.todo(uid('确认供应商下季度交付窗口'), { due: rangeDay })
  const outside = await fx.todo(uid('安排下一次客户回访'), { due: '2098-07-24' })
  await openYoloPanel(page)

  let dialog = await openDataManager(page)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await dialog.getByLabel('开始日期（含）').fill(rangeDay)
  await dialog.getByLabel('结束日期（含）').fill(rangeDay)
  await expect(dialog.getByRole('button', { name: '确认取消 2 项' })).toBeEnabled()
  await dialog.getByRole('button', { name: '确认取消 2 项' }).click()
  await expect(dialog.getByRole('status')).toHaveText('已取消 2 项。')
  let dashboard = await api.dashboard()
  expect(dashboard.todos.find((row: Record<string, any>) => row.id === first.id)?.status).toBe('cancelled')
  expect(dashboard.todos.find((row: Record<string, any>) => row.id === second.id)?.status).toBe('cancelled')
  expect(dashboard.todos.find((row: Record<string, any>) => row.id === outside.id)?.status).toBe('pending')
  await dialog.getByRole('button', { name: '关闭数据管理' }).click()
  await expect(page.getByRole('button', { name: '更多看板操作' })).toBeFocused()

  await page.setViewportSize({ width: 400, height: 800 })
  dialog = await openDataManager(page)
  await expect(page.locator('.yolo-scope')).toHaveClass(/compact/)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await dialog.getByRole('radio', { name: /永久删除/u }).check()
  await dialog.getByLabel('开始日期（含）').fill(rangeDay)
  await dialog.getByLabel('结束日期（含）').fill(rangeDay)
  await dialog.getByLabel('输入“永久删除”继续').fill('永久删除')
  await expect(dialog.getByRole('button', { name: '永久删除 2 项' })).toBeEnabled()
  await dialog.getByRole('button', { name: '永久删除 2 项' }).click()
  await expect(dialog.getByRole('status')).toHaveText('已永久删除 2 项。')
  fx.untrackTodo(String(first.id))
  fx.untrackTodo(String(second.id))
  dashboard = await api.dashboard()
  expect(dashboard.todos.some((row: Record<string, any>) => row.id === first.id || row.id === second.id)).toBe(false)
  expect(dashboard.todos.some((row: Record<string, any>) => row.id === outside.id)).toBe(true)
  expect(consoleErrors).toEqual([])
})

test('W3/W15: 事项详情区分可恢复取消与不可恢复永久删除', async ({ page }) => {
  const title = uid('删除重复导入的客户会面安排')
  const todo = await fx.todo(title, { due: todayStr() })
  await openYoloPanel(page)
  await revealHomeItems(page)

  const row = page.locator('.v2-judgment, .v2-today-row').filter({ hasText: title })
  await row.getByRole('button', { name: /^(?:处理|更多处理)$/u }).click()
  const detail = page.getByRole('dialog', { name: title })
  await expect(detail.getByRole('button', { name: '取消事项' })).toBeVisible()
  await detail.getByRole('button', { name: '永久删除事项' }).click()
  await detail.getByLabel('输入“永久删除”继续').fill('永久删除')
  await detail.getByRole('button', { name: '永久删除', exact: true }).click()
  await expect(detail).toHaveCount(0)
  fx.untrackTodo(String(todo.id))
  await waitForDashboard(api, (data) => !data.todos?.some((item: Record<string, any>) => item.id === todo.id), {
    label: 'single permanent deletion to leave the dashboard',
  })
})
