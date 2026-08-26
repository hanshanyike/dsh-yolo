import { test, expect } from '@playwright/test'
import { SPLIT_MIN_WIDTH } from '../../../client/panel/navigation.ts'
import { openYoloPanel } from '../helpers.ts'

test('上下文按导出的最小宽度切换 split/focus，并在变化中保留草稿', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 780 })
  await openYoloPanel(page)
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
