import { test, expect, type Page } from '@playwright/test'
import { connectApi, createFixtures, openYoloPanel, todayStr, uid, waitForDashboard, yesterdayStr, type Api } from '../helpers.ts'

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

async function isolateDashboardToTodos(page: Page, ids: ReadonlySet<string>, forcePrimaryId?: string): Promise<void> {
  await page.route('**/yolo/dashboard**', async (route) => {
    const response = await route.fetch()
    const data = await response.json() as Record<string, any>
    const todos = (data.todos ?? []).filter((row: Record<string, any>) => ids.has(String(row.id)))
    const titles = todos.map((row: Record<string, any>) => String(row.title))
    const mentionsFixture = (row: Record<string, any>): boolean => titles.some((title: string) => String(row.summary ?? '').includes(title))
    const ledger = (data.ledger ?? []).filter(mentionsFixture)
    const serverAttention = (data.attention ?? []).filter((row: Record<string, any>) => ids.has(String(row.todo_id)))
    const forcedTodo = forcePrimaryId ? todos.find((row: Record<string, any>) => String(row.id) === forcePrimaryId) : undefined
    const reason = forcedTodo?.attention_reason
    const attention = forcedTodo && reason ? [{
      id: `e2e-attention-${forcedTodo.id}`,
      todo_id: String(forcedTodo.id),
      scope_cwd: forcedTodo.scope_cwd ?? forcedTodo.ws?.cwd ?? data.cwd,
      ws: forcedTodo.ws,
      score: 100,
      level: 'attention',
      reason_code: reason.code,
      short_reason: reason.short_reason,
      explanation: reason.explanation,
      evidence: reason.evidence ?? [],
      reason_version: reason.reason_version,
      evidence_fingerprint: reason.evidence_fingerprint,
      seen_at: Date.now(),
      source: forcedTodo.source,
    }] : serverAttention
    await route.fulfill({ response, json: {
      ...data,
      todos,
      goals: [],
      milestones: [],
      events: (data.events ?? []).filter(mentionsFixture),
      preferences: [],
      ledger,
      attention,
      notifications: (data.notifications ?? []).filter((row: Record<string, any>) => row.todo_id && ids.has(String(row.todo_id))),
      unhandled: 0,
      summary: {
        open: todos.filter((row: Record<string, any>) => row.status !== 'done' && row.status !== 'completed' && row.status !== 'cancelled').length,
        overdue: todos.filter((row: Record<string, any>) => row.overdue === true).length,
        dueToday: todos.filter((row: Record<string, any>) => String(row.due_at ?? '').slice(0, 10) === todayStr()).length,
        completedToday: todos.filter((row: Record<string, any>) => row.status === 'done' || row.status === 'completed').length,
        changesToday: ledger.length,
        partial: false,
      },
      workspaceErrors: [],
    } })
  })
}

test('首次使用空状态不使用轨道话术', async ({ page }) => {
  await isolateDashboardToTodos(page, new Set())

  await openYoloPanel(page)
  const empty = page.locator('.v2-today-empty')
  await expect(empty).toContainText('助手会帮你记下并继续跟进')
  await expect(empty).not.toContainText('轨道')
})

test('一级信息架构只有首页、计划、历史，计划提供四个明确分区', async ({ page }) => {
  const todayTitle = uid('今天确认客户回访安排')
  const upcomingTitle = uid('下月提交差旅报销材料')
  const today = await fx.todo(todayTitle, { due: todayStr() })
  const upcoming = await fx.todo(upcomingTitle, { due: localDateOffset(30) })
  await isolateDashboardToTodos(page, new Set([String(today.id), String(upcoming.id)]))

  await openYoloPanel(page)
  const pages = page.getByRole('tablist', { name: '助手页面' })
  await expect(pages.getByRole('tab')).toHaveCount(3)
  await expect(pages.getByRole('tab', { name: /^首页/ })).toHaveAttribute('aria-selected', 'true')
  await expect(pages.getByRole('tab', { name: /^计划/ })).toBeVisible()
  await expect(pages.getByRole('tab', { name: /^历史/ })).toBeVisible()
  await expect(pages.getByRole('tab', { name: /进展/u })).toHaveCount(0)
  await expect(pages.getByRole('tab', { name: /Agent 任务/u })).toHaveCount(0)
  await expect(page.locator('.v2-judgment, .v2-today-row').filter({ hasText: todayTitle })).toBeVisible()
  await expect(page.getByRole('heading', { name: '接下来', exact: true })).toBeVisible()
  await expect(page.locator('.v2-today-row').filter({ hasText: upcomingTitle })).toBeVisible()
  await expect(page.getByRole('heading', { name: '最近变化', exact: true })).toBeVisible()

  await pages.getByRole('tab', { name: /^计划/ }).click()
  const plan = page.getByRole('tablist', { name: '计划范围' })
  await expect(plan.getByRole('tab')).toHaveCount(4)
  for (const label of ['今天', '接下来', '目标', '全部']) {
    await expect(plan.getByRole('tab', { name: label, exact: true })).toBeVisible()
  }

  await plan.getByRole('tab', { name: '今天', exact: true }).click()
  await expect(page.getByRole('heading', { name: '今天', exact: true })).toBeVisible()
  await expect(page.getByRole('listitem', { name: `任务：${todayTitle}` })).toBeVisible()
  await expect(page.getByRole('listitem', { name: `任务：${todayTitle}` }).getByRole('button', { name: '讨论这项安排' })).toBeVisible()
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

test('已有工作区的安静首页不拿无日期积压填充，也不退回首次使用空状态', async ({ page }) => {
  const backlogTitle = uid('整理以后可能采用的访谈方法')
  const backlog = await fx.todo(backlogTitle)
  await api.action({ action: 'update', kind: 'todo', id: backlog.id, due_at: null })
  await isolateDashboardToTodos(page, new Set([String(backlog.id)]))

  await openYoloPanel(page)
  await expect(page.locator('.v2-today-row').filter({ hasText: backlogTitle })).toHaveCount(0)
  await expect(page.locator('.v2-today-empty')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '最近变化', exact: true })).toBeVisible()
})

test('历史支持按时间和按事项查看同一条变化事实', async ({ page }) => {
  const completedTitle = uid('把采购确认结果同步给财务')
  const completed = await fx.todo(completedTitle, { due: todayStr() })
  await api.action({ action: 'complete', kind: 'todo', id: completed.id })

  await openYoloPanel(page)
  await page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^历史/ }).click()
  const history = page.getByRole('tablist', { name: '历史范围' })
  await expect(history.getByRole('tab')).toHaveCount(2)
  await expect(history.getByRole('tab', { name: '按时间', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(history.getByRole('tab', { name: '按事项', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '时间线', exact: true })).toBeVisible()
  await expect(page.locator('.history-event').filter({
    has: page.locator('.history-event__kind', { hasText: '完成' }),
    hasText: completedTitle,
  })).toBeVisible()

  await history.getByRole('tab', { name: '按事项', exact: true }).click()
  await page.getByRole('group', { name: '历史事项状态' }).getByRole('button', { name: '已完成', exact: true }).click()
  const completedRow = page.getByRole('listitem', { name: `已完成：${completedTitle}` })
  await expect(completedRow).toBeVisible()
  await completedRow.getByRole('button').filter({ hasText: completedTitle }).click()
  await expect(completedRow.locator('.history-event').filter({ hasText: completedTitle })).toHaveCount(2)
})

test('首页在五项压力下只突出一个主项，其余默认收束并保持可达', async ({ page }) => {
  const items = await Promise.all([
    fx.todo(uid('确认客户演示材料已经发出'), { due: yesterdayStr() }),
    fx.todo(uid('回复产品评审提出的问题'), { due: yesterdayStr() }),
    fx.todo(uid('补齐发布说明中的升级步骤'), { due: yesterdayStr() }),
    fx.todo(uid('确认供应商收到采购信息'), { due: yesterdayStr() }),
    fx.todo(uid('补充酒店预订确认号'), { due: yesterdayStr() }),
  ])
  const ids = new Set(items.map((item) => String(item.id)))
  await waitForDashboard(api, (data) => {
    const rows = (data.todos ?? []).filter((row: Record<string, unknown>) => ids.has(String(row.id)))
    return rows.length === 5 && rows.every((row: Record<string, unknown>) => row.attention_reason != null)
  }, { label: 'Home pressure fixtures to receive server attention facts' })
  await isolateDashboardToTodos(page, ids, String(items[0].id))

  await openYoloPanel(page)
  await expect(page.locator('.v2-judgment')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '查看其余 4 项安排' })).toBeVisible()
  for (const item of items) {
    const title = String(item.title)
    const occurrences = page.locator('.v2-judgment, .v2-today-row').filter({ hasText: title })
    expect(await occurrences.count()).toBeLessThanOrEqual(1)
  }

  await page.getByRole('button', { name: '查看其余 4 项安排' }).click()
  for (const item of items) {
    await expect(page.locator('.v2-judgment, .v2-today-row').filter({ hasText: String(item.title) })).toBeVisible()
  }
  await expect(page.getByRole('button', { name: '收起次要安排' })).toBeVisible()
})
