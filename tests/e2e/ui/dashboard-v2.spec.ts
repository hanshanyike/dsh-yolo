// Dashboard v2 information architecture and action-panel regressions against
// the real dsh host. All fixtures use realistic user commitments behind the
// machine-only [E2E] marker and are disposed by their exact ids.

import { test, expect, type Page } from '@playwright/test'
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

async function seedPrimaryJudgment(label: string): Promise<{ id: string; title: string }> {
  const title = uid(label)
  const todo = await fx.todo(title, { due: localDateOffset(-100) })
  const id = String(todo.id)

  // Every fact is auditable through the shared action API. Together these
  // facts give the fixture the deterministic maximum practical rank without
  // mocking server judgment: urgent + old overdue + repeated postpone + reminder.
  await api.action({ action: 'update', kind: 'todo', id, priority: 'urgent' })
  await api.action({ action: 'postpone', kind: 'todo', id, due_at: localDateOffset(-99) })
  await api.action({ action: 'postpone', kind: 'todo', id, due_at: localDateOffset(-98) })
  await fx.notification(`${title} 的截止提醒`, {
    note: '请确认客户演示材料已经交付，并记录需要继续跟进的事项。',
    todoId: id,
  })

  const data = await waitForDashboard(
    api,
    (dashboard) => dashboard.attention?.[0]?.todo_id === id,
    { label: `fixture ${id} to become the unique assistant judgment` },
  )
  expect(data.attention).toHaveLength(1)
  expect(data.attention[0].todo_id).toBe(id)
  return { id, title }
}

async function refreshBoard(page: Page): Promise<void> {
  await page.getByRole('button', { name: '更多看板操作' }).click()
  await page.getByRole('menuitem', { name: '刷新看板' }).click()
}

test('首页保持固定阅读顺序、唯一判断，更多处理展示完整语义对话框', async ({ page }) => {
  const primary = await seedPrimaryJudgment('确认客户演示材料的最终交付')
  await fx.todo(uid('整理下周客户回访需要确认的问题'), { due: localDateOffset(-1) })

  await openYoloPanel(page, { refreshOnSlow: false })
  await revealHomeItems(page)
  const surface = page.locator('.v2-today-surface')
  await expect(surface.getByRole('heading', { level: 1 })).toHaveText(/今天有 \d+ 件事需要你处理。/u)
  await expect(surface.getByRole('button', { name: '快速记录', exact: true })).toBeVisible()
  const judgment = surface.locator('.v2-judgment')
  await expect(judgment).toHaveCount(1)
  await expect(judgment).toHaveClass(/v2-judgment--full/)
  await expect(judgment.getByRole('heading', { name: primary.title })).toBeVisible()
  await expect(judgment.getByRole('heading', { name: '为什么现在' })).toBeVisible()
  await expect(surface.locator('.v2-today-row').filter({ hasText: primary.title })).toHaveCount(0)

  const readingOrder = await surface.locator(
    ':scope > header, :scope > section[aria-label="快速记录"], :scope > .v2-judgment, :scope > section[aria-labelledby="v2-attention-title"], :scope > section[aria-labelledby="v2-progress-title"]',
  ).evaluateAll((elements) => elements.map((element) => {
    if (element.matches('header')) return 'today-title'
    if (element.matches('[aria-label="快速记录"]')) return 'quick-capture'
    if (element.matches('.v2-judgment')) return 'judgment'
    if (element.matches('[aria-labelledby="v2-attention-title"]')) return 'attention-list'
    return 'today-progress'
  }))
  expect(readingOrder).toEqual(['today-title', 'quick-capture', 'judgment', 'attention-list', 'today-progress'])

  await judgment.getByRole('button', { name: '更多处理' }).click()
  const dialog = page.getByRole('dialog', { name: primary.title })
  await expect(dialog).toBeVisible()
  const describedBy = await dialog.getAttribute('aria-describedby')
  expect(describedBy).toBeTruthy()
  await expect(page.locator(`#${describedBy!}`)).toBeVisible()

  const dialogOrder = await dialog.locator(':scope > section, :scope > form').evaluateAll((elements) => elements.map((element) => {
    if (element.tagName === 'FORM') return element.querySelector('legend')?.textContent?.trim()
    return element.getAttribute('aria-label') ?? element.querySelector('h3')?.textContent?.trim()
  }))
  expect(dialogOrder).toEqual(['判断依据', '来源', '快速处理', '助手将记录的变化', '编辑事项', '危险操作'])
  await expect(dialog.getByRole('button', { name: '标记完成' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /推迟到明天/ })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '保存编辑' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '取消事项' })).toBeVisible()
})

test('W11: 助手判断首读为 full，复读 compact，依据变化后重新 full', async ({ page }) => {
  const primary = await seedPrimaryJudgment('核对发布前的客户验收结论')
  await openYoloPanel(page, { refreshOnSlow: false })

  await expect(page.locator('.v2-judgment--full')).toContainText(primary.title)
  await waitForDashboard(
    api,
    (dashboard) => dashboard.attention?.[0]?.todo_id === primary.id && dashboard.attention[0].seen_at != null,
    { label: `judgment ${primary.id} to persist seen state` },
  )

  await refreshBoard(page)
  const compact = page.locator('.v2-judgment--compact')
  await expect(compact).toContainText(primary.title)
  await expect(compact.getByRole('button', { name: '处理' })).toBeVisible()
  await expect(compact.getByRole('button', { name: '展开依据' })).toBeVisible()
  await expect(compact.getByRole('heading', { name: '为什么现在' })).toHaveCount(0)
  await compact.getByRole('button', { name: '展开依据' }).click()
  const expanded = page.locator('.v2-judgment--full')
  await expect(expanded.getByRole('heading', { name: '为什么现在' })).toBeVisible()
  await expanded.getByRole('button', { name: '收起依据' }).click()
  await expect(page.locator('.v2-judgment--compact').getByRole('button', { name: '展开依据' })).toBeVisible()

  // Trust state is bound to the immutable evidence fingerprint. A schedule
  // change produces new evidence, so the user must receive the full judgment
  // again instead of inheriting the old compact/seen presentation.
  await fx.notification(`${primary.title} 的补充截止提醒`, {
    note: '补充确认客户验收结论是否已经同步给所有参与方。',
    todoId: primary.id,
  })
  await refreshBoard(page)
  const changed = page.locator('.v2-judgment--full')
  await expect(changed).toContainText(primary.title)
  await expect(changed.getByRole('heading', { name: '为什么现在' })).toBeVisible()
})

test('已完成与已取消严格分离，两类终态事项都可以重新打开', async ({ page }) => {
  const completedTitle = uid('把采购确认结果同步给财务')
  const cancelledTitle = uid('取消不再需要的供应商回访')
  const completed = await fx.todo(completedTitle, { due: todayStr() })
  const cancelled = await fx.todo(cancelledTitle, { due: todayStr() })
  await api.action({ action: 'complete', kind: 'todo', id: completed.id })
  await api.action({ action: 'cancel', kind: 'todo', id: cancelled.id })

  await openYoloPanel(page)
  await page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^历史/ }).click()
  await page.getByRole('tablist', { name: '历史范围' }).getByRole('tab', { name: '已结束', exact: true }).click()
  const terminalFilters = page.getByRole('group', { name: '终态事项筛选' })
  await terminalFilters.getByRole('button', { name: /^已完成/ }).click()
  const completedRow = page.getByRole('listitem', { name: `已完成：${completedTitle}` })
  await expect(completedRow).toBeVisible()
  await expect(page.getByRole('listitem', { name: `已取消：${cancelledTitle}` })).toHaveCount(0)
  await completedRow.getByRole('button', { name: `重新打开：${completedTitle}` }).click()
  await expect(completedRow).toHaveCount(0)

  await terminalFilters.getByRole('button', { name: /^已取消/ }).click()
  const cancelledRow = page.getByRole('listitem', { name: `已取消：${cancelledTitle}` })
  await expect(cancelledRow).toBeVisible()
  await expect(page.getByRole('listitem', { name: `已完成：${completedTitle}` })).toHaveCount(0)
  await cancelledRow.getByRole('button', { name: `重新打开：${cancelledTitle}` }).click()
  await expect(cancelledRow).toHaveCount(0)

  await waitForDashboard(
    api,
    (dashboard) => {
      const rows = dashboard.todos as Array<{ id: string; status: string }>
      return rows.find((row) => row.id === completed.id)?.status === 'pending'
        && rows.find((row) => row.id === cancelled.id)?.status === 'pending'
    },
    { label: 'completed and cancelled fixtures to reopen' },
  )
})

test('接下来事项支持长标题编辑，最近变化的动作类型与摘要保持独立列', async ({ page }) => {
  const title = uid('和研发确认新版助手看板的验收范围与交付时间')
  const item = await fx.todo(title, { due: localDateOffset(3) })
  await api.action({ action: 'complete', kind: 'todo', id: item.id })
  await api.action({ action: 'reopen', kind: 'todo', id: item.id })

  await openYoloPanel(page)
  await page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^计划/ }).click()
  await page.getByRole('tablist', { name: '计划范围' }).getByRole('tab', { name: '接下来', exact: true }).click()
  const row = page.getByRole('listitem', { name: `任务：${title}` })
  await row.getByRole('button', { name: '编辑' }).click()

  const editor = page.getByRole('textbox', { name: '任务标题' })
  await expect(editor).toHaveJSProperty('tagName', 'TEXTAREA')
  const longTitle = `${title}，同时补充灰度计划、回滚负责人、验收证据和最终同步渠道`
  await editor.fill(longTitle)
  const editorBox = await editor.boundingBox()
  const formBox = await page.locator('.edit-form').boundingBox()
  expect(editorBox).not.toBeNull()
  expect(formBox).not.toBeNull()
  expect(editorBox!.width).toBeGreaterThan(formBox!.width * 0.9)
  expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await page.getByRole('button', { name: '取消', exact: true }).click()

  await page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^历史/ }).click()
  await page.getByRole('tablist', { name: '历史范围' }).getByRole('tab', { name: '最近变化', exact: true }).click()
  const reopened = page.locator('.lg-row').filter({
    has: page.locator('.lg-type', { hasText: '重新打开' }),
    hasText: title,
  }).first()
  await expect(reopened).toBeVisible()
  const columns = await reopened.evaluate((element) => {
    const type = element.querySelector('.lg-type')!.getBoundingClientRect()
    const summary = element.querySelector('.lg-sum')!.getBoundingClientRect()
    return {
      overlap: type.right > summary.left,
      overflow: element.scrollWidth > element.clientWidth + 1,
    }
  })
  expect(columns).toEqual({ overlap: false, overflow: false })
})

test('约 340px 紧凑模式保留首页、计划、历史与完整 ARIA 状态', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 })
  await openYoloPanel(page)

  const panel = page.locator('.yolo-scope')
  await expect(panel).toHaveClass(/compact/)
  const pages = page.getByRole('tablist', { name: '助手页面' })
  const tabs = pages.getByRole('tab')
  await expect(tabs).toHaveCount(3)
  const tabContracts = [
    { name: /^首页/, key: 'home' },
    { name: /^计划/, key: 'plan' },
    { name: /^历史/, key: 'history' },
  ]
  for (const contract of tabContracts) {
    await expect(pages.getByRole('tab', { name: contract.name })).toHaveAttribute('aria-controls', `yolo-page-${contract.key}`)
  }
  await expect(pages.getByRole('tab', { name: /^首页/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#yolo-surface-home[role="tabpanel"]')).toBeVisible()

  for (const selector of ['.p-head', '.y-tabs', '.v2-today-surface']) {
    expect(await page.locator(selector).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  }
  const panelWidth = await panel.evaluate((element) => element.getBoundingClientRect().width)
  expect(panelWidth).toBeGreaterThanOrEqual(320)
  expect(panelWidth).toBeLessThanOrEqual(400)
})
