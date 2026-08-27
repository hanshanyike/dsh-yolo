import { test, expect } from '@playwright/test'
import { SPLIT_MIN_WIDTH } from '../../../client/panel/navigation.ts'
import { connectApi, createFixtures, openYoloPanel, revealHomeItems, todayStr, uid, type Api } from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(async () => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

test('上下文按导出的最小宽度切换 split/focus，并在变化中保留草稿', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 780 })
  await openYoloPanel(page)
  await revealHomeItems(page)
  const panel = page.locator('.yolo-scope')
  const left = (await panel.boundingBox())?.x
  expect(left).not.toBeUndefined()

  await page.getByRole('button', { name: '和助手聊聊' }).click()
  await expect(panel).toHaveAttribute('data-presentation', 'split')
  await expect(page.locator('.dock')).toBeVisible()
  const input = page.getByRole('textbox', { name: '对 YOLO 说' })
  await input.fill('尚未发送的客户回访补充说明')

  await page.setViewportSize({ width: Math.floor(left! + SPLIT_MIN_WIDTH - 2), height: 780 })
  await expect(panel).toHaveAttribute('data-presentation', 'focus')
  await expect(page.locator('.dock')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '助手对话' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: '助手页面' })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '对 YOLO 说' })).toHaveValue('尚未发送的客户回访补充说明')

  await page.setViewportSize({ width: Math.ceil(left! + SPLIT_MIN_WIDTH + 2), height: 780 })
  await expect(panel).toHaveAttribute('data-presentation', 'split')
  await expect(page.locator('.dock')).toBeVisible()
  await expect(page.getByRole('tablist', { name: '助手页面' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '对 YOLO 说' })).toHaveValue('尚未发送的客户回访补充说明')
})

test('视口虽宽于 960px、宿主让位后可用宽度不足时，详情、来源与对话都占满 focus', async ({ page }) => {
  const title = uid('确认客户回访材料')
  await fx.todo(title, { due: todayStr() })
  await page.setViewportSize({ width: 1440, height: 780 })
  await openYoloPanel(page)
  await revealHomeItems(page)
  const panel = page.locator('.yolo-scope')
  const left = (await panel.boundingBox())?.x
  expect(left).not.toBeUndefined()
  const narrowViewport = Math.floor(left! + SPLIT_MIN_WIDTH - 2)
  expect(narrowViewport).toBeGreaterThan(960)
  await page.setViewportSize({ width: narrowViewport, height: 780 })

  const assertFocusFillsPanel = async (kind: string): Promise<void> => {
    await expect(panel).toHaveAttribute('data-presentation', 'focus')
    const panelBox = await page.locator('.panel-frame').boundingBox()
    const contextBox = await panel.locator(`aside[data-foreground="${kind}"]`).boundingBox()
    expect(contextBox).not.toBeNull()
    expect(panelBox).not.toBeNull()
    // The prototype frame owns a 1px border on each side; the foreground
    // surface fills its content box, so compare the inner surface dimensions.
    expect(Math.abs(contextBox!.width - panelBox!.width)).toBeLessThanOrEqual(2)
  }

  const row = page.locator('.v2-judgment, .v2-today-row').filter({ hasText: title })
  await row.getByRole('button', { name: '处理', exact: true }).click()
  await assertFocusFillsPanel('item_detail')

  await page.getByRole('dialog', { name: title }).getByRole('button', { name: /^快速记一条/u }).click()
  await assertFocusFillsPanel('source_preview')

  await page.getByRole('button', { name: '返回首页' }).click()
  await page.getByRole('button', { name: '和助手聊聊' }).click()
  await assertFocusFillsPanel('assistant_chat')
})
