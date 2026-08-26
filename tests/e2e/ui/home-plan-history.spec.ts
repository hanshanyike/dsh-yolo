import { test, expect } from '@playwright/test'
import { connectApi, createFixtures, openYoloPanel, todayStr, uid, type Api } from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(async () => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

function localDateOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

test('一级信息架构只有首页、计划、历史，计划提供四个明确分区', async ({ page }) => {
  const todayTitle = uid('今天确认客户回访安排')
  const upcomingTitle = uid('下周提交差旅报销材料')
  await fx.todo(todayTitle, { due: todayStr() })
  await fx.todo(upcomingTitle, { due: localDateOffset(3) })

  await openYoloPanel(page)
  const pages = page.getByRole('tablist', { name: '助手页面' })
  await expect(pages.getByRole('tab')).toHaveCount(3)
  await expect(pages.getByRole('tab', { name: /^首页/ })).toHaveAttribute('aria-selected', 'true')
  await expect(pages.getByRole('tab', { name: /^计划/ })).toBeVisible()
  await expect(pages.getByRole('tab', { name: /^历史/ })).toBeVisible()
  await expect(pages.getByRole('tab', { name: /进展/u })).toHaveCount(0)
  await expect(pages.getByRole('tab', { name: /Agent 任务/u })).toHaveCount(0)

  await pages.getByRole('tab', { name: /^计划/ }).click()
  const plan = page.getByRole('tablist', { name: '计划范围' })
  await expect(plan.getByRole('tab')).toHaveCount(4)
  for (const label of ['今天', '接下来', '目标', '全部']) {
    await expect(plan.getByRole('tab', { name: label, exact: true })).toBeVisible()
  }

  await plan.getByRole('tab', { name: '今天', exact: true }).click()
  await expect(page.getByRole('heading', { name: '今天', exact: true })).toBeVisible()
  await expect(page.getByRole('listitem', { name: `任务：${todayTitle}` })).toBeVisible()
  await expect(page.getByRole('listitem', { name: `任务：${upcomingTitle}` })).toHaveCount(0)

  await plan.getByRole('tab', { name: '接下来', exact: true }).click()
  await expect(page.getByRole('heading', { name: '接下来', exact: true })).toBeVisible()
  await expect(page.getByRole('listitem', { name: `任务：${upcomingTitle}` })).toBeVisible()

  await plan.getByRole('tab', { name: '目标', exact: true }).click()
  await expect(page.getByRole('heading', { name: '目标与里程碑' })).toBeVisible()

  await plan.getByRole('tab', { name: '全部', exact: true }).click()
  await expect(page.getByRole('heading', { name: '全部计划' })).toBeVisible()
  await expect(page.getByRole('listitem', { name: `任务：${todayTitle}` })).toBeVisible()
  await expect(page.getByRole('listitem', { name: `任务：${upcomingTitle}` })).toBeVisible()
})

test('历史严格拆分已结束与最近变化', async ({ page }) => {
  const completedTitle = uid('把采购确认结果同步给财务')
  const completed = await fx.todo(completedTitle, { due: todayStr() })
  await api.action({ action: 'complete', kind: 'todo', id: completed.id })

  await openYoloPanel(page)
  await page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^历史/ }).click()
  const history = page.getByRole('tablist', { name: '历史范围' })
  await expect(history.getByRole('tab')).toHaveCount(2)
  await expect(history.getByRole('tab', { name: '已结束', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(history.getByRole('tab', { name: '最近变化', exact: true })).toBeVisible()
  await expect(page.getByRole('listitem', { name: `已完成：${completedTitle}` })).toBeVisible()

  await history.getByRole('tab', { name: '最近变化', exact: true }).click()
  await expect(page.getByRole('heading', { name: '最近变化' })).toBeVisible()
  const completedChange = page.locator('.lg-row.is-done').filter({ hasText: completedTitle })
  await expect(completedChange).toHaveCount(1)
  await expect(completedChange).toBeVisible()
  await expect(page.getByRole('heading', { name: '今日进展' })).toHaveCount(0)
})
