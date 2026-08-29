import { test, expect } from '@playwright/test'
import { connectApi, createFixtures, openYoloPanel, revealHomeItems, todayStr, uid, type Api } from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(async () => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

test('来源、事项讨论和助手对话互斥复用同一个前景位置', async ({ page }) => {
  const title = uid('确认设计评审结论')
  await fx.todo(title, { due: todayStr() })
  await openYoloPanel(page)
  await page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^计划/ }).click()
  await page.getByRole('tablist', { name: '计划范围' }).getByRole('tab', { name: '今天', exact: true }).click()

  const row = page.getByRole('listitem', { name: `任务：${title}` })
  await row.getByRole('button', { name: '快速记一条', exact: true }).click()
  const source = page.locator(`section[aria-label="来源：${title}"]`)
  await expect(source).toBeVisible()
  await expect(page.locator('.panel-frame > div > aside')).toHaveCount(1)

  await source.getByRole('button', { name: '讨论这项安排' }).click()
  await expect(source).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '对 YOLO 说' })).toBeVisible()
  await expect(page.locator('.panel-frame > div > aside')).toHaveCount(1)

  await page.locator('.p-head').getByRole('button', { name: '和助手聊聊' }).click()
  await expect(page.locator('.fs-anchor')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '对 YOLO 说' })).toBeVisible()
  await expect(page.locator('.panel-frame > div > aside')).toHaveCount(1)

  await page.getByRole('button', { name: '关闭上下文' }).click()
  await expect(page.locator('.panel-frame > div > aside')).toHaveCount(0)
  await expect(row).toBeVisible()
})

test('事项详情与来源预览共用前景，返回后保留编辑草稿', async ({ page }) => {
  const title = uid('确认活动场地与供应商档期')
  await fx.todo(title, { due: todayStr() })
  await openYoloPanel(page)
  await revealHomeItems(page)

  const homeRow = page.locator('.v2-judgment, .v2-today-row').filter({ hasText: title })
  await homeRow.getByRole('button', { name: /^(?:处理|更多处理)$/u }).click()
  const detail = page.getByRole('dialog', { name: title })
  await expect(detail).toBeVisible()
  await expect(page.locator('.panel-frame > div > aside')).toHaveCount(1)

  const titleInput = detail.getByRole('textbox', { name: '标题' })
  await titleInput.fill(`${title}（待确认）`)
  const detailSourceButton = detail.getByRole('button', { name: /快速记一条/u })
  await detailSourceButton.click()

  const source = page.locator(`section[aria-label="来源：${title}"]`)
  await expect(source).toBeVisible()
  await expect(detail).toHaveCount(0)
  await expect(page.locator('.panel-frame > div > aside')).toHaveCount(1)

  await source.getByRole('button', { name: '返回上一层' }).click()
  await expect(detail).toBeVisible()
  await expect(titleInput).toHaveValue(`${title}（待确认）`)
  await expect(detailSourceButton).toBeFocused()

  await detail.getByRole('button', { name: '和助手讨论' }).click()
  await expect(detail).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '对 YOLO 说' })).toBeVisible()
  await expect(page.locator('.panel-frame > div > aside')).toHaveCount(1)
})
