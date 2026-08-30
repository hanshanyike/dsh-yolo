import { readFileSync } from 'node:fs'
import { test, expect, type Page, type Locator } from '@playwright/test'
import { dismissHostSetupDialogs } from '../helpers.ts'

const packageVersion = (JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { version: string }).version

async function openYoloSettings(page: Page): Promise<Locator> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await dismissHostSetupDialogs(page)
  await page.getByRole('button', { name: '设置' }).click()
  const dialog = page.getByRole('dialog', { name: '设置' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '插件' }).click()
  const card = dialog.locator('.yolo-settings-card')
  await expect(card.getByRole('heading', { name: 'YOLO — 管理工作与生活的助手' })).toBeVisible()
  await expect(card.getByLabel(`发布版本 ${packageVersion}`)).toHaveText(`v${packageVersion}`)
  return card
}

test('YOLO 设置可保存并在刷新后回读，且关闭提醒进入真实运行配置（W14）', async ({ page }) => {
  let card = await openYoloSettings(page)
  const reminder = card.getByRole('checkbox', { name: /启用到期提醒/ })
  const identity = card.getByRole('checkbox', { name: /高置信事项自动关联/ })
  const mergeSuggestions = card.getByRole('checkbox', { name: /重复事项合并建议/ })
  const ahead = card.getByRole('textbox', { name: /^提前提醒（分钟）/ })
  const originalEnabled = await reminder.isChecked()
  const originalIdentity = await identity.isChecked()
  const originalMergeSuggestions = await mergeSuggestions.isChecked()
  const originalAhead = await ahead.inputValue()
  const alternateAhead = originalAhead === '7' ? '0' : '7'
  let changed = false

  await expect(card.getByRole('checkbox', { name: /启用 LLM 提取/ })).toBeVisible()
  await expect(card.getByRole('textbox', { name: /^提取模型/ })).toBeVisible()
  await expect(identity).toBeVisible()
  await expect(mergeSuggestions).toBeVisible()
  await expect(card.getByText(/仅在模型置信度至少为 0.98 且只有一个开放候选时/)).toBeVisible()
  await expect(card.getByRole('textbox', { name: /^扫描间隔（秒）/ })).toBeVisible()
  await expect(card.getByRole('checkbox', { name: /启用安静时段/ })).toBeVisible()
  await expect(card.getByRole('checkbox', { name: /启用早晚报/ })).toBeVisible()
  await expect(card.getByRole('textbox', { name: /^早报时间/ })).toBeVisible()
  await expect(card.getByRole('combobox', { name: /^快照节奏/ })).toBeVisible()
  await expect(card).not.toContainText('M4b')
  await expect(card).not.toContainText('位于设置项上方')

  try {
    await reminder.setChecked(false)
    await identity.setChecked(!originalIdentity)
    await mergeSuggestions.setChecked(!originalMergeSuggestions)
    if (!originalIdentity) await expect(card.getByText(/保存即确认启用实验能力/)).toBeVisible()
    await ahead.fill(alternateAhead)
    await card.getByRole('button', { name: '保存设置' }).click()
    await expect(card.getByRole('status')).toContainText('设置已保存')
    changed = true

    card = await openYoloSettings(page)
    await expect(card.getByRole('checkbox', { name: /启用到期提醒/ })).not.toBeChecked()
    await expect(card.getByRole('checkbox', { name: /高置信事项自动关联/ })).toBeChecked({ checked: !originalIdentity })
    await expect(card.getByRole('checkbox', { name: /重复事项合并建议/ })).toBeChecked({ checked: !originalMergeSuggestions })
    await expect(card.getByRole('textbox', { name: /^提前提醒（分钟）/ })).toHaveValue(alternateAhead)
  } finally {
    if (changed) {
      card = await openYoloSettings(page)
      await card.getByRole('checkbox', { name: /启用到期提醒/ }).setChecked(originalEnabled)
      await card.getByRole('checkbox', { name: /高置信事项自动关联/ }).setChecked(originalIdentity)
      await card.getByRole('checkbox', { name: /重复事项合并建议/ }).setChecked(originalMergeSuggestions)
      await card.getByRole('textbox', { name: /^提前提醒（分钟）/ }).fill(originalAhead)
      await card.getByRole('button', { name: '保存设置' }).click()
      await expect(card.getByRole('status')).toContainText('设置已保存')

      card = await openYoloSettings(page)
      await expect(card.getByRole('checkbox', { name: /启用到期提醒/ })).toBeChecked({ checked: originalEnabled })
      await expect(card.getByRole('checkbox', { name: /高置信事项自动关联/ })).toBeChecked({ checked: originalIdentity })
      await expect(card.getByRole('checkbox', { name: /重复事项合并建议/ })).toBeChecked({ checked: originalMergeSuggestions })
      await expect(card.getByRole('textbox', { name: /^提前提醒（分钟）/ })).toHaveValue(originalAhead)
    }
  }
})
