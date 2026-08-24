// Dashboard-v2 trust-chain gates against the real dsh host. The browser sees
// real dashboard/action responses; the partial-data case changes only one
// response projection in transit and never mocks the underlying action API.

import { test, expect, type Page, type Route } from '@playwright/test'
import {
  connectApi,
  createFixtures,
  openYoloPanel,
  uid,
  waitForDashboard,
  type Api,
} from '../helpers.ts'

interface ActionExchange {
  request: Record<string, any>
  response: Record<string, any>
}

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => {
  api = await connectApi()
})

test.afterAll(async () => {
  await api.close()
})

test.beforeEach(async () => {
  fx = createFixtures(api)
})

test.afterEach(async () => {
  await fx.dispose()
})

function localDateOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const part = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`
}

async function seedPrimaryJudgment(label: string): Promise<{
  id: string
  title: string
  dueAt: string
  attention: Record<string, any>
}> {
  const title = uid(label)
  const todo = await fx.todo(title, { due: localDateOffset(-100) })
  const id = String(todo.id)
  await api.action({ action: 'update', kind: 'todo', id, priority: 'urgent' })
  await api.action({ action: 'postpone', kind: 'todo', id, due_at: localDateOffset(-99) })
  const dueAt = localDateOffset(-98)
  await api.action({ action: 'postpone', kind: 'todo', id, due_at: dueAt })
  await fx.notification(`${title} 的截止提醒`, {
    note: '请确认客户材料已经交付，并记录仍需继续跟进的事项。',
    todoId: id,
  })

  const dashboard = await waitForDashboard(
    api,
    (data) => data.attention?.[0]?.todo_id === id,
    { label: `fixture ${id} to become the unique assistant judgment` },
  )
  expect(dashboard.attention).toHaveLength(1)
  return { id, title, dueAt, attention: dashboard.attention[0] as Record<string, any> }
}

async function recordBrowserActions(page: Page): Promise<ActionExchange[]> {
  const exchanges: ActionExchange[] = []
  await page.route('**/yolo/actions', async (route: Route) => {
    const request = (route.request().postDataJSON() ?? {}) as Record<string, any>
    const upstream = await route.fetch()
    const response = (await upstream.json()) as Record<string, any>
    exchanges.push({ request, response })
    await route.fulfill({ response: upstream, json: response })
  })
  return exchanges
}

async function waitForAction(
  exchanges: ActionExchange[],
  predicate: (exchange: ActionExchange) => boolean,
): Promise<ActionExchange> {
  await expect.poll(() => exchanges.find(predicate), { timeout: 25_000 }).toBeTruthy()
  return exchanges.find(predicate)!
}

async function openJudgmentTaskPanel(page: Page, title: string): Promise<void> {
  const judgment = page.locator('.v2-judgment').filter({ hasText: title })
  const fullAction = judgment.getByRole('button', { name: '更多处理' })
  if (await fullAction.isVisible().catch(() => false)) await fullAction.click()
  else await judgment.getByRole('button', { name: '处理' }).click()
  await expect(page.getByRole('dialog', { name: title })).toBeVisible()
}

test('W12: 服务端学习回执可检查，postpone 的服务端 undo 恢复原日期', async ({ page }) => {
  const primary = await seedPrimaryJudgment('确认客户演示材料的交付时间')
  const snapshot = await api.dashboard()
  expect(snapshot.capabilities?.preferenceUndo).toBe(false)
  const exchanges = await recordBrowserActions(page)

  await openYoloPanel(page, { refreshOnSlow: false })
  await openJudgmentTaskPanel(page, primary.title)
  const dialog = page.getByRole('dialog', { name: primary.title })
  await dialog.getByRole('button', { name: /推迟到明天/ }).click()

  const receipt = dialog.locator('.v2-learning-receipt')
  await expect(receipt).toBeVisible()
  await expect(receipt.getByRole('status')).toContainText('已推迟到')
  await expect(receipt).toContainText('作用范围')
  await expect(receipt).toContainText('本事项')
  await expect(receipt).toContainText('变化')
  await expect(dialog.getByRole('button', { name: '查看提醒偏好' })).toHaveCount(0)
  await expect(dialog).not.toContainText(/已学会|记住了|已调整.*偏好/)

  const postpone = await waitForAction(
    exchanges,
    ({ request }) => request.action === 'postpone' && request.id === primary.id,
  )
  expect(postpone.request.scope_cwd).toBe(primary.attention.scope_cwd)
  expect(postpone.response.learning_receipt).toMatchObject({
    type: 'schedule_change',
    scope: 'item',
    reversible: true,
  })
  expect(postpone.response.undo).toMatchObject({ action: 'update', kind: 'todo', id: primary.id, due_at: primary.dueAt })

  await receipt.getByRole('button', { name: '撤销变化' }).click()
  const undo = await waitForAction(
    exchanges,
    ({ request }) => request.action === 'update' && request.id === primary.id && request.due_at === primary.dueAt,
  )
  expect(undo.request.scope_cwd).toBe(primary.attention.scope_cwd)
  await waitForDashboard(
    api,
    (data) => data.todos?.find((todo: Record<string, any>) => todo.id === primary.id)?.due_at === primary.dueAt,
    { label: `server undo to restore ${primary.id} due date` },
  )
})

test('W13: 单次 partial projection 只提示一次，仍按原 workspace scope 安全处理', async ({ page }) => {
  const primary = await seedPrimaryJudgment('确认合作方访谈纪要的跟进安排')
  const exchanges = await recordBrowserActions(page)
  let injected = 0
  await page.route('**/yolo/dashboard?scope=all', async (route) => {
    const upstream = await route.fetch()
    const dashboard = (await upstream.json()) as Record<string, any>
    if (injected === 0) {
      injected++
      dashboard.summary = { ...(dashboard.summary ?? {}), partial: true }
      dashboard.workspaceErrors = ['归档项目：暂时无法读取']
    }
    await route.fulfill({ response: upstream, json: dashboard })
  })

  await openYoloPanel(page, { refreshOnSlow: false })
  const partial = page.locator('.v2-today-partial')
  await expect(partial).toHaveCount(1)
  await expect(partial).toContainText('部分工作区暂不可用')
  await expect(partial).toContainText('归档项目：暂时无法读取')
  await expect(page.locator('.v2-judgment-partial')).toHaveCount(0)
  expect(injected).toBe(1)

  await openJudgmentTaskPanel(page, primary.title)
  const dialog = page.getByRole('dialog', { name: primary.title })
  await expect(dialog.getByRole('heading', { name: '判断依据' })).toBeVisible()
  await dialog.getByRole('button', { name: '标记完成' }).click()
  await expect(dialog.locator('.v2-learning-receipt')).toContainText('已标记完成')

  const handled = await waitForAction(
    exchanges,
    ({ request }) => request.action === 'complete' && request.id === primary.id,
  )
  expect(handled.request.scope_cwd).toBe(primary.attention.scope_cwd)
  expect(handled.response).toMatchObject({ ok: true, learning_receipt: { scope: 'item' } })
})

test('W14/W16: header 控件可读，判断 reason/evidence 与响应一致且重点不重复', async ({ page }) => {
  const primary = await seedPrimaryJudgment('核对发布前客户验收结论')
  await openYoloPanel(page, { refreshOnSlow: false })

  const judgment = page.locator('.v2-judgment').filter({ hasText: primary.title })
  await expect(judgment).toHaveCount(1)
  await expect(judgment.locator('.v2-judgment-reason')).toHaveText(String(primary.attention.explanation))
  for (const evidence of (primary.attention.evidence as Array<{ label: string }>).slice(0, 3)) {
    await expect(judgment.getByRole('region', { name: '为什么现在' })).toContainText(evidence.label)
  }
  await expect(page.locator('.v2-today-row').filter({ hasText: primary.title })).toHaveCount(0)

  await expect(page.getByRole('button', { name: '对话' })).toBeVisible()
  await expect(page.getByRole('button', { name: '通知' })).toHaveAttribute('aria-label', /^通知，.+/)
  await expect(page.getByRole('button', { name: '更多看板操作' })).toHaveAttribute('aria-label', '更多看板操作')
  await expect(page.getByRole('button', { name: '关闭面板' })).toHaveAttribute('aria-label', '关闭面板')
  await expect(judgment.getByRole('group', { name: '处理助手判断' })).toBeVisible()

  await openJudgmentTaskPanel(page, primary.title)
  await expect(page.getByRole('button', { name: '关闭事项处理面板' })).toHaveAttribute('aria-label', '关闭事项处理面板')
})

test('W1/W2/W7/W11/W16: 需要关注行去重依据且在 340px 窄面板内换行', async ({ page }) => {
  const primary = await seedPrimaryJudgment('确认客户验收材料是否已经归档')
  const singleTitle = uid('跟进昨天到期的供应商回复')
  const single = await fx.todo(singleTitle, { due: localDateOffset(-1) })
  const multiTitle = uid('确认多次推迟的发布审批安排')
  const multi = await fx.todo(multiTitle, { due: localDateOffset(-7) })
  await api.action({ action: 'update', kind: 'todo', id: String(multi.id), priority: 'urgent' })
  await api.action({ action: 'postpone', kind: 'todo', id: String(multi.id), due_at: localDateOffset(-6) })
  await api.action({ action: 'postpone', kind: 'todo', id: String(multi.id), due_at: localDateOffset(-5) })

  const dashboard = await waitForDashboard(api, (data) => {
    const singleRow = data.todos?.find((todo: Record<string, any>) => todo.id === String(single.id))
    const multiRow = data.todos?.find((todo: Record<string, any>) => todo.id === String(multi.id))
    return data.attention?.[0]?.todo_id === primary.id
      && singleRow?.attention_reason?.evidence?.length === 1
      && multiRow?.attention_reason?.evidence?.length >= 3
  }, { label: 'secondary attention rows to expose single and multiple evidence facts' })
  const singleReason = dashboard.todos.find((todo: Record<string, any>) => todo.id === String(single.id)).attention_reason
  const multiReason = dashboard.todos.find((todo: Record<string, any>) => todo.id === String(multi.id)).attention_reason
  expect(singleReason.short_reason).toBe(singleReason.evidence[0].label)

  await page.setViewportSize({ width: 400, height: 800 })
  await openYoloPanel(page, { refreshOnSlow: false })
  await expect(page.locator('.yolo-scope')).toHaveClass(/compact/)

  const singleText = page.locator('.v2-today-row').filter({ hasText: singleTitle }).locator('.v2-today-row-reason')
  await expect(singleText).toHaveText(String(singleReason.short_reason))
  expect((await singleText.textContent())?.split(String(singleReason.short_reason)).length ?? 0).toBe(2)
  await expect(singleText).not.toContainText('·')

  const labels = [
    String(multiReason.short_reason),
    ...multiReason.evidence.map((item: Record<string, any>) => String(item.label)),
  ].filter((label, index, all) => label.trim().length > 0 && all.indexOf(label) === index)
  const expectedMultiText = `${labels[0]} · ${labels.slice(1).join('，')}`
  const multiText = page.locator('.v2-today-row').filter({ hasText: multiTitle }).locator('.v2-today-row-reason')
  await expect(multiText).toHaveText(expectedMultiText)
  expect(await multiText.evaluate((element) => ({
    wraps: getComputedStyle(element).overflowWrap,
    contained: element.scrollWidth <= element.clientWidth,
  }))).toEqual({ wraps: 'anywhere', contained: true })

  const judgment = page.locator('.v2-judgment').filter({ hasText: primary.title })
  await expect(judgment.locator('.v2-judgment-reason')).toHaveText(String(primary.attention.explanation))
})
