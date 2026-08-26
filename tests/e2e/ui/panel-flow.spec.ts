// ui 套件 · 浏览器端到端测试 — core panel interaction flow (TA-1..TA-6), driven against the
// REAL running host through its HTTP endpoints + a real browser. Fixtures are
// seeded via POST /yolo/actions with a unique [E2E] prefix and disposed by id
// after each test (createFixtures), so rows created through raw browser UI
// (the capture bar) are registered with trackTodo() once they exist.
//
// The task titles are realistic developer sentences ("核对接口字段",
// "回复设计评审的意见"…); the [E2E] prefix labels them as machine fixture data
// (see helpers.ts note on the realistic-wording sweep).

import { test, expect, type Page } from '@playwright/test'
import {
  connectApi,
  createFixtures,
  uid,
  openYoloPanel,
  revealHomeItems,
  todayStr,
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

/** Dashboard-v2 can promote a due item into the unique judgment or keep it in a Today section. */
function taskFor(page: Page, title: string) {
  return page.locator('.v2-judgment, .v2-today-row').filter({ hasText: title })
}

function todayRowFor(page: Page, title: string) {
  return page.locator('.v2-today-row').filter({ hasText: title })
}

function localDateTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function localDateOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

async function openTaskHandling(page: Page, title: string): Promise<void> {
  const row = todayRowFor(page, title)
  if (await row.count()) {
    await row.getByRole('button', { name: '处理' }).click()
  } else {
    const judgment = page.locator('.v2-judgment').filter({ hasText: title })
    const more = judgment.getByRole('button', { name: '更多处理' })
    if (await more.count()) await more.click()
    else await judgment.getByRole('button', { name: '处理' }).click()
  }
  await expect(page.getByRole('dialog', { name: title })).toBeVisible()
}

async function completeTask(page: Page, title: string): Promise<void> {
  const row = todayRowFor(page, title)
  if (await row.count()) {
    await row.getByRole('checkbox', { name: `完成：${title}` }).click()
  } else {
    const judgment = page.locator('.v2-judgment').filter({ hasText: title })
    const complete = judgment.getByRole('button', { name: '完成', exact: true })
    if (await complete.count()) await complete.click()
    else {
      await judgment.getByRole('button', { name: '处理' }).click()
      await page.getByRole('dialog', { name: title }).getByRole('button', { name: '标记完成' }).click()
    }
  }
}

test('打开助手看板并按真实任务渲染今日行（TA-1/TA-2）', async ({ page }) => {
  const title = uid('给首页改版核对接口字段')
  await fx.todo(title, { due: todayStr() })

  await openYoloPanel(page)
  await revealHomeItems(page)

  await expect(taskFor(page, title)).toBeVisible()
  const row = todayRowFor(page, title)
  if (await row.count()) {
    await expect(row.locator('time')).toHaveAttribute('datetime', todayStr())
  } else {
    // A same-day due item may be promoted to the unique deterministic judgment.
    await expect(page.locator('.v2-judgment').filter({ hasText: title })).toContainText('截止时间')
  }
})

test('完成任务弹出撤销，4 秒内撤销后任务恢复原位（TA-3 / 5.4）', async ({ page }) => {
  const title = uid('回复设计评审的修改意见')
  await fx.todo(title, { due: todayStr() })

  await openYoloPanel(page)
  await revealHomeItems(page)
  await expect(taskFor(page, title)).toBeVisible()

  // Complete from whichever approved v2 presentation owns the task.
  await completeTask(page, title)
  const toast = page.locator('.toast').filter({ hasText: '已完成' })
  await expect(toast).toBeVisible()
  await expect(toast.locator('button', { hasText: '撤销' })).toBeVisible()
  // the row retires from the open sections
  await expect(taskFor(page, title)).toHaveCount(0)

  // undo within the 4s window restores it
  await toast.locator('button', { hasText: '撤销' }).click()
  await expect(page.locator('.toast').filter({ hasText: '已撤销' })).toBeVisible()
  await expect(taskFor(page, title)).toBeVisible()
})

test('逾期事项进入 v2 关注判断并保留可核验处理依据（TA-4）', async ({ page }) => {
  const overdueTitle = uid('把渠道预算缺口补上')
  const todayTitle = uid('给周会整理三点结论')
  const overdue = await fx.todo(overdueTitle, { due: localDateOffset(-100) })
  await api.action({ action: 'update', kind: 'todo', id: overdue.id, priority: 'urgent' })
  await api.action({ action: 'postpone', kind: 'todo', id: overdue.id, due_at: localDateOffset(-99) })
  await api.action({ action: 'postpone', kind: 'todo', id: overdue.id, due_at: localDateOffset(-98) })
  await fx.notification(`${overdueTitle} 的截止提醒`, { todoId: String(overdue.id), note: '请确认预算缺口的处理方案。' })
  await fx.todo(todayTitle, { due: todayStr() })
  await waitForDashboard(api, (dashboard) => dashboard.attention?.[0]?.todo_id === String(overdue.id), {
    label: 'overdue fixture to become the server-ranked primary judgment',
  })

  await openYoloPanel(page)
  await revealHomeItems(page)
  // Both remain visible, while v2 promotes the overdue fact into an explicit
  // judgment/attention reason instead of hiding unrelated work behind a capsule.
  await expect(taskFor(page, overdueTitle)).toBeVisible()
  await expect(taskFor(page, todayTitle)).toBeVisible()
  await expect(taskFor(page, overdueTitle)).toContainText('逾期')

  await openTaskHandling(page, overdueTitle)
  const dialog = page.getByRole('dialog', { name: overdueTitle })
  await expect(dialog.getByRole('heading', { name: '判断依据' })).toBeVisible()
  await expect(dialog).toContainText('逾期')
})

test('W2/W11/W16: 同日精确 datetime 到时后进入逾期事实与摘要', async ({ page }) => {
  const title = uid('跟进刚超过截止时间的客户确认')
  await fx.todo(title, { due: localDateTime(new Date(Date.now() - 60_000)) })
  const futureTitle = uid('稍后确认研发联调结果')
  await fx.todo(futureTitle, { due: localDateTime(new Date(Date.now() + 3_600_000)) })

  await openYoloPanel(page)
  await revealHomeItems(page)
  await expect(taskFor(page, title)).toContainText(/逾期|已超过截止时间/)
  await expect(taskFor(page, futureTitle)).not.toContainText(/逾期|已超过截止时间/)
  await expect(page.locator('.v2-today-surface > header')).toContainText(/逾期 \d+ 件/)
})

test('捕获条快速记一条并落入看板（TA-2 快捷入口）', async ({ page }) => {
  const title = uid('给演示准备一台备用显示器')
  await openYoloPanel(page)

  await page.locator('.cap-input').fill(title)
  await page.keyboard.press('Enter')
  await expect(page.locator('.toast').filter({ hasText: '已记下' })).toBeVisible()
  await revealHomeItems(page)
  // this row was born in the browser, not through the API — look its id up
  // once so dispose() can remove it by id like every other fixture
  const d = await api.dashboard()
  const row = ((d.todos ?? []) as { id: string; title: string }[]).find((t) => t.title === title)
  if (row) fx.trackTodo(String(row.id))
  await expect(taskFor(page, title)).toBeVisible()
})

test('“讨论这项安排”打开 item discussion，并与“和助手聊聊”使用同一前景位置（TA-5）', async ({ page }) => {
  const title = uid('定稿本周直播的主题')
  await fx.todo(title, { due: todayStr() })
  await openYoloPanel(page)
  await revealHomeItems(page)

  await openTaskHandling(page, title)
  const taskDialog = page.getByRole('dialog', { name: title })
  await taskDialog.getByRole('button', { name: /快速记一条/u }).click()
  await expect(taskDialog).toHaveCount(0)
  const source = page.locator(`section[aria-label="来源：${title}"]`)
  await source.getByRole('button', { name: '讨论这项安排' }).click()
  await expect(source).toHaveCount(0)
  await expect(page.locator('.dock')).toBeVisible()
  await expect(page.locator('aside[data-foreground="item_discussion"]')).toHaveCount(1)
  await expect(page.locator('.dock-tag')).toHaveText('上下文')
  await expect(page.locator('.dock-ctx')).toHaveText(title)
  const chatInput = page.getByRole('textbox', { name: '对 YOLO 说' })
  await expect(chatInput).toBeFocused()
  await chatInput.fill('先确认直播主题的候选范围')
  await expect(chatInput).toHaveValue('先确认直播主题的候选范围')
  const transcript = page.getByRole('log', { name: '对话记录' })
  await expect(transcript.locator('.msg.me')).toHaveCount(0)
  await expect(transcript.locator('.msg.ai').first()).toContainText(`我们来讨论「${title}」。现在进展怎么样，接下来需要调整什么？`)
  // Background sync runs every four seconds. An empty anchored conversation
  // must stay mounted instead of flashing blank at each polling boundary.
  await expect(transcript.locator('.msg.ai').first()).toBeVisible({ timeout: 5_500 })
  await page.waitForTimeout(4_500)
  await expect(transcript.locator('.msg.ai').first()).toContainText(`我们来讨论「${title}」。现在进展怎么样，接下来需要调整什么？`)
})

test('Esc 逐级退出：assistant chat 前景→首页→关闭面板（TA-6）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 760 })
  await openYoloPanel(page)

  await page.getByRole('button', { name: '和助手聊聊' }).click()
  await expect(page.locator('aside[data-foreground="assistant_chat"]')).toHaveCount(1)
  await expect(page.locator('.yolo-scope')).toHaveAttribute('data-presentation', 'split')
  await expect(page.locator('.dock')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.locator('aside[data-foreground]')).toHaveCount(0)
  await expect(page.getByRole('tablist', { name: '助手页面' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.yolo-scope')).toHaveCount(0)
})
