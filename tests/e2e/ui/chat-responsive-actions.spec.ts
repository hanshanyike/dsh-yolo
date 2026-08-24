import { test, expect } from '@playwright/test'
import { connectApi, createFixtures, openYoloPanel, todayStr, uid, type Api } from '../helpers.ts'

let api: Api
test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })

test('1029x742 medium 对话返回 Today、恢复头部焦点并保留 draft', async ({ page }) => {
  await page.setViewportSize({ width: 1029, height: 742 })
  await openYoloPanel(page)
  const openChat = page.getByRole('button', { name: '对话' })
  await openChat.click()
  const back = page.getByRole('button', { name: '返回看板' })
  await expect(back).toBeVisible()
  await expect(page.getByRole('button', { name: '侧栏', exact: true })).toHaveCount(0)

  await page.getByRole('textbox', { name: '对 YOLO 说' }).fill('尚未发送的客户回访补充说明')
  await back.click()
  await expect(page.locator('.yolo-scope')).toBeVisible()
  await expect(page.locator('.v2-today-surface')).toBeVisible()
  await expect(page.getByRole('button', { name: '对话' })).toBeFocused()

  await page.getByRole('button', { name: '对话' }).click()
  await expect(page.getByRole('textbox', { name: '对 YOLO 说' })).toHaveValue('尚未发送的客户回访补充说明')
  await page.keyboard.press('Escape')
  await expect(page.locator('.v2-today-surface')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.yolo-scope')).toHaveCount(0)
})

test('available 959/960 即时切换承诺，wide full 与 side 可双向往返', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 })
  await openYoloPanel(page)
  await page.getByRole('button', { name: '对话' }).click()
  await expect(page.locator('.dock')).toBeVisible()
  const left = (await page.locator('.yolo-scope').boundingBox())!.x

  await page.setViewportSize({ width: Math.round(left) + 959, height: 760 })
  await expect(page.getByRole('button', { name: '返回看板' })).toBeVisible()
  await expect(page.locator('.dock')).toHaveCount(0)

  await page.setViewportSize({ width: Math.round(left) + 960, height: 760 })
  await expect(page.locator('.dock')).toBeVisible()
  await page.locator('.dock').getByRole('button', { name: '全屏' }).click()
  await expect(page.getByRole('button', { name: '侧栏', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '侧栏', exact: true }).click()
  await expect(page.locator('.dock')).toBeVisible()

  await page.locator('.dock').getByRole('button', { name: '全屏' }).click()
  await page.setViewportSize({ width: Math.round(left) + 959, height: 760 })
  await expect(page.getByRole('button', { name: '返回看板' })).toBeVisible()
})

test('medium anchored 返回看板后焦点回到打开对话的事项', async ({ page }) => {
  const fx = createFixtures(api)
  const title = uid('确认移动端评审的反馈结论')
  await fx.todo(title, { due: todayStr() })
  try {
    await page.setViewportSize({ width: 1029, height: 742 })
    await openYoloPanel(page)
    const task = page.locator('.v2-judgment, .v2-today-row').filter({ hasText: title })
    const row = page.locator('.v2-today-row').filter({ hasText: title })
    if (await row.count()) await row.getByRole('button', { name: '处理' }).click()
    else {
      const more = task.getByRole('button', { name: '更多处理' })
      if (await more.count()) await more.click()
      else await task.getByRole('button', { name: '处理' }).click()
    }
    await page.getByRole('dialog', { name: title }).getByRole('button', { name: '和助手讨论' }).click()
    await expect(page.getByRole('button', { name: '返回看板' })).toBeVisible()
    await page.getByRole('button', { name: '返回看板' }).click()
    await expect(task).toBeFocused()
  } finally {
    await fx.dispose()
  }
})
