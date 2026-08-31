// ui 套件 · 目标 surface 的真实浏览器闭环：目标是长期结果，推进动作打开
// 独立讨论，暂停/恢复改变目标跟进状态。

import { test, expect } from '@playwright/test'
import {
  connectApi,
  createFixtures,
  openYoloPanel,
  uid,
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

test('目标卡片展示长期结果并支持讨论、暂停和恢复', async ({ page }) => {
  const title = uid('在九月完成产品发布')
  await fx.goal(title, { completionCriteria: '生产环境稳定运行', targetDate: '2099-09-30' })

  await openYoloPanel(page)
  const pages = page.getByRole('tablist', { name: '助手页面' })
  await pages.getByRole('tab', { name: /^计划/ }).click()
  const plan = page.getByRole('tablist', { name: '计划范围' })
  await plan.getByRole('tab', { name: '目标', exact: true }).click()

  const card = page.locator('.goal').filter({ hasText: title })
  await expect(card).toBeVisible()
  await expect(card).toContainText('完成标准：生产环境稳定运行')
  await expect(card).toContainText('目标日期：2099-09-30')
  await expect(card).toContainText('进行中')

  await card.getByRole('button', { name: '推进目标' }).click()
  await expect(page.locator('aside[data-foreground="item_discussion"]')).toBeVisible()
  await expect(page.locator('aside[data-foreground="item_discussion"]')).toContainText(`我们来讨论「${title}」`)

  await page.locator('aside[data-foreground="item_discussion"]').getByRole('button', { name: '结束讨论' }).click()
  await expect(page.locator('aside[data-foreground="item_discussion"]')).toHaveCount(0)

  await card.getByRole('button', { name: '暂停' }).click()
  await expect(card).toContainText('已暂停')
  await expect(card.getByRole('button', { name: '恢复' })).toBeVisible()

  await card.getByRole('button', { name: '恢复' }).click()
  await expect(card).toContainText('进行中')
  await expect(card.getByRole('button', { name: '暂停' })).toBeVisible()
})
