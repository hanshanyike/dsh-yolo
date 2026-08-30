import { randomUUID } from 'node:crypto'
import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  connectApi, createFixtures, dismissHostSetupDialogs, openYoloPanel, revealHomeItems,
  todayStr, waitForDashboard, withWorkspaceDatabase, type Api,
} from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(() => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

async function openSettings(page: Page): Promise<Locator> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await dismissHostSetupDialogs(page)
  await page.getByRole('button', { name: '设置' }).click()
  const dialog = page.getByRole('dialog', { name: '设置' })
  await dialog.getByRole('button', { name: '插件' }).click()
  const card = dialog.locator('.yolo-settings-card')
  await expect(card).toBeVisible()
  return card
}

test('R3-UI: 开关启用建议，状态冲突先预览选择，确认合并后可以撤销', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => { browserErrors.push(error.message) })
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
  const stamp = Date.now()
  const openTitle = `[E2E] ${stamp} 把访谈纪要-发给产品组`
  const doneTitle = `[E2E] ${stamp} 把访谈纪要 发给产品组`
  const created = await fx.todo(openTitle, { due: todayStr() })
  const dashboard = await waitForDashboard(api, (data) => data.todos.some((row: Record<string, unknown>) => row.id === created.id))
  const openRow = dashboard.todos.find((row: Record<string, unknown>) => row.id === created.id)
  const doneId = randomUUID()
  withWorkspaceDatabase(openRow, (db) => {
    const now = Date.now()
    db.prepare(`INSERT INTO todos(id,title,status,scope_key,source,created_at,updated_at,completed_at)
                VALUES(?,?,'done',?,'manual',?,?,?)`)
      .run(doneId, doneTitle, openRow.ws.slug, now + 1, now + 1, now + 1)
  })
  fx.trackTodo(doneId)

  let enabled = false
  try {
    let card = await openSettings(page)
    const toggle = card.getByRole('checkbox', { name: /重复事项合并建议/ })
    if (await toggle.isChecked()) {
      await toggle.setChecked(false)
      await card.getByRole('button', { name: '保存设置' }).click()
      await expect(card.getByRole('status')).toContainText('设置已保存')
    }
    expect((await api.dashboard()).health.duplicateTodos).toEqual([])
    await toggle.setChecked(true)
    await card.getByRole('button', { name: '保存设置' }).click()
    await expect(card.getByRole('status')).toContainText('设置已保存')
    enabled = true
    await waitForDashboard(api, (data) => data.health?.duplicateTodos?.some((pair: Record<string, unknown>) => (
      pair.a === openRow.id && pair.b === doneId
    )), { label: 'R3 suggestion after enabling the switch' })

    await openYoloPanel(page)
    await revealHomeItems(page)
    const row = page.locator('.v2-judgment, .v2-today-row').filter({ hasText: openTitle })
    await row.getByRole('button', { name: '处理' }).click()
    const suggestion = page.getByRole('region', { name: '重复事项合并建议' })
    await expect(suggestion).toContainText(doneTitle)
    await suggestion.getByRole('button', { name: '预览合并' }).click()
    await expect(suggestion).toContainText('两项状态不同')
    await expect(suggestion).toContainText('你选择保留的事项决定合并后的业务状态')
    await page.setViewportSize({ width: 390, height: 850 })
    expect(await suggestion.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await suggestion.getByRole('button', { name: '保留当前事项并合并' }).click()

    const receipt = page.getByRole('region', { name: '助手记录回执' })
    await expect(receipt).toContainText('已合并重复事项')
    const activeMerge = withWorkspaceDatabase(openRow, (db) => db.prepare(
      "SELECT id,status,source_id,target_id FROM todo_merge_log WHERE status='active'",
    ).get())
    expect(activeMerge).toMatchObject({ status: 'active', source_id: doneId, target_id: openRow.id })

    await page.getByRole('button', { name: '关闭事项处理面板' }).click()
    await page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^历史/ }).click()
    await page.getByRole('tablist', { name: '历史范围' }).getByRole('tab', { name: '按事项', exact: true }).click()
    const mergedRow = page.getByRole('listitem', { name: `已合并：${doneTitle}` })
    await expect(mergedRow).toBeVisible()
    await mergedRow.getByRole('button', { name: '撤销合并' }).click()
    await expect(mergedRow).toBeHidden()
    const restored = withWorkspaceDatabase(openRow, (db) => ({
      source: db.prepare('SELECT status,record_status,merged_into_id FROM todos WHERE id=?').get(doneId),
      merge: db.prepare('SELECT status,undone_at FROM todo_merge_log WHERE id=?').get((activeMerge as { id: string }).id),
    }))
    expect(restored.source).toEqual({ status: 'done', record_status: 'canonical', merged_into_id: null })
    expect(restored.merge).toMatchObject({ status: 'undone', undone_at: expect.any(Number) })
    expect(browserErrors).toEqual([])
  } finally {
    if (enabled) {
      await page.setViewportSize({ width: 1440, height: 900 })
      const card = await openSettings(page)
      await card.getByRole('checkbox', { name: /重复事项合并建议/ }).setChecked(false)
      await card.getByRole('button', { name: '保存设置' }).click()
      await expect(card.getByRole('status')).toContainText('设置已保存')
    }
    for (const id of [doneId, openRow.id]) {
      await api.action({
        action: 'delete', kind: 'todo', id, scope_cwd: openRow.scope_cwd, confirmation: 'PERMANENT_DELETE',
      }).catch(() => {})
      fx.untrackTodo(id)
    }
  }
})
