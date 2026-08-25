import { test, expect, type Page } from '@playwright/test'
import { connectApi, createFixtures, openYoloPanel, uid, type Api } from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(async () => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

function localDateTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

async function tabCount(page: Page): Promise<number> {
  const value = await page.getByRole('tab', { name: /^今天/ }).locator('.nnum').textContent()
  return Number(value)
}

async function dueTodayCount(page: Page): Promise<number> {
  const text = await page.locator('.v2-today-surface > header').textContent() ?? ''
  return Number(text.match(/今天到期 (\d+) 件/u)?.[1] ?? Number.NaN)
}

async function closePanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: '关闭面板' }).click()
  await expect(page.locator('.yolo-scope')).toHaveCount(0)
}

test('Today tab 统计默认表面开放事项的去重并集，且可与 dueToday 合法不同', async ({ page }) => {
  await openYoloPanel(page)
  const baselineSurface = await tabCount(page)
  const baselineDueToday = await dueTodayCount(page)
  await closePanel(page)

  const preciseTitle = uid('跟进刚超过截止时刻的客户确认')
  const precise = await fx.todo(preciseTitle, { due: localDateTime(new Date(Date.now() - 60_000)) })
  // The same precise-overdue todo is carried by judgment/attention and a card,
  // but its scoped todo identity must contribute exactly once.
  await fx.notification(`${preciseTitle} 的截止提醒`, { todoId: String(precise.id) })

  const futureTitle = uid('确认下月演示材料是否齐备')
  const future = await fx.todo(futureTitle, { due: localDateTime(new Date(Date.now() + 30 * 86_400_000)) })
  await fx.notification(`${futureTitle} 的待确认提醒`, { todoId: String(future.id) })

  const terminalTitle = uid('已经结束的旧提醒事项')
  const terminal = await fx.todo(terminalTitle, { due: localDateTime(new Date(Date.now() + 60 * 86_400_000)) })
  await api.action({ action: 'complete', kind: 'todo', id: terminal.id })
  await fx.notification(`${terminalTitle} 的旧提醒`, { todoId: String(terminal.id) })

  await openYoloPanel(page, { refreshOnSlow: false })
  const todayTab = page.getByRole('tab', { name: /^今天/ })
  await expect(todayTab).toHaveAttribute('title', /助手判断、需要关注、今天到期和未处理提醒已去重/u)
  await expect(todayTab).toHaveAttribute('aria-label', /今天，\d+ 件。今天默认表面承接的开放事项/u)
  expect(await tabCount(page)).toBe(baselineSurface + 2)
  expect(await dueTodayCount(page)).toBe(baselineDueToday + 1)
  await expect(page.locator('.v2-today-surface > header')).toContainText(`今天需回应 ${baselineSurface + 2} 件`)

  await expect(page.locator('.v2-judgment, .v2-today-row').filter({ hasText: preciseTitle })).toBeVisible()
  await expect(page.locator('.notif').filter({ hasText: futureTitle })).toBeVisible()
  await expect(page.locator('.notif').filter({ hasText: terminalTitle })).toBeVisible()
})

test('partial 投影只统计已加载事项，并在 Today title 与 ARIA 中说明', async ({ page }) => {
  const title = uid('确认已加载工作区的今日安排')
  const item = await fx.todo(title, { due: localDateTime(new Date(Date.now() + 60 * 60_000)) })

  await page.route('**/yolo/dashboard?scope=all', async (route) => {
    const response = await route.fetch()
    const body = await response.json() as Record<string, any>
    const todos = (body.todos ?? []).filter((todo: Record<string, any>) => todo.id === item.id || todo.title === title)
    await route.fulfill({
      response,
      json: {
        ...body,
        todos,
        attention: [],
        notifications: [],
        summary: { ...body.summary, open: 1, overdue: 0, dueToday: 1, completedToday: 0, partial: true },
        workspaceErrors: ['另一个工作区暂不可用'],
      },
    })
  })

  await openYoloPanel(page, { refreshOnSlow: false })
  const todayTab = page.getByRole('tab', { name: /^今天/ })
  await expect(todayTab.locator('.nnum')).toHaveText('1')
  await expect(todayTab).toHaveAttribute('title', /部分工作区未加载，仅统计已加载内容/u)
  await expect(todayTab).toHaveAttribute('aria-label', /部分工作区未加载，仅统计已加载内容/u)
  await expect(page.getByRole('status')).toContainText('当前内容可能不完整')
})
