import { readFileSync } from 'node:fs'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { dismissHostSetupDialogs, ensureHostAuth } from '../helpers.ts'

const packageVersion = (JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { version: string }).version

/** Expand the card when it is collapsed (it starts collapsed, like every plugin card). */
async function expand(card: Locator): Promise<void> {
  const header = card.locator('.yolo-card__header')
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

async function openYoloSettings(page: Page): Promise<Locator> {
  await ensureHostAuth(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await dismissHostSetupDialogs(page)
  await page.getByRole('button', { name: '设置' }).click()
  const dialog = page.getByRole('dialog', { name: '设置' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '插件', exact: true }).click()
  const card = dialog.locator('.yolo-settings-card')
  await expect(card).toBeVisible({ timeout: 30_000 })
  return card
}

/** The chrome properties a plugin card must share with the cards dsh ships. */
function chromeOf(locator: Locator): Promise<{ radius: string; background: string; borderWidth: string }> {
  return locator.evaluate((el: Element) => {
    const style = getComputedStyle(el)
    return {
      radius: style.borderTopLeftRadius,
      background: style.backgroundColor,
      borderWidth: style.borderTopWidth,
    }
  })
}

test('YOLO 插件配置卡与其他插件卡一致，保存后刷新仍生效（W14）', async ({ page }) => {
  let card = await openYoloSettings(page)

  // ---- 1. the card IS a card of the shared Plugins list -------------------
  // dsh 0.1.5 renders every plugin card as an `<li>` inside one card list; the
  // old YOLO surface was a `<form>` and therefore never looked like a card at
  // all. The slot renderer wraps each contribution in a plain `<div>`, so the
  // container shared with the shipped cards is the nearest ancestor `<ul>`.
  expect(await card.evaluate((el: Element) => el.tagName)).toBe('LI')
  const list = card.locator('xpath=ancestor::ul[1]')
  expect(await list.count()).toBe(1)

  // Collapsed by default, with the same header semantics as the shipped cards.
  const header = card.locator('.yolo-card__header')
  await expect(header).toHaveJSProperty('tagName', 'BUTTON')
  await expect(header).toHaveAttribute('aria-expanded', 'false')
  await expect(card.locator('.yolo-card__name')).toHaveText('YOLO — 管理工作与生活的助手')
  await expect(card.locator('.yolo-card__description')).toContainText('低打扰提醒')
  await expect(card.locator('.yolo-card__body')).toHaveCount(0)

  // Same chrome declarations as a sibling plugin card (radius, fill, hairline).
  const sibling = list.locator('li').filter({ hasNotText: 'YOLO — 管理工作与生活的助手' }).first()
  await expect(sibling).toHaveCount(1)
  expect(await chromeOf(card)).toEqual(await chromeOf(sibling))

  // ---- 2. the form lives inside the disclosure ---------------------------
  await expand(card)
  await expect(card.locator('.yolo-card__meta')).toContainText(`v${packageVersion}`)
  const reminder = card.getByRole('switch', { name: '启用到期提醒' })
  const identity = card.getByRole('switch', { name: '高置信事项自动关联' })
  const mergeSuggestions = card.getByRole('switch', { name: '重复事项合并建议' })
  const ahead = card.getByRole('textbox', { name: '提前提醒（分钟）' })
  await expect(card.getByRole('switch', { name: '启用 LLM 提取' })).toBeVisible()
  await expect(card.getByRole('textbox', { name: '提取模型' })).toBeVisible()
  await expect(identity).toBeVisible()
  await expect(mergeSuggestions).toBeVisible()
  await expect(card.getByText(/结合模型语义判断和受保护的标题相似度/)).toBeVisible()
  await expect(card.getByText(/仅在模型置信度至少达到下方阈值/)).toBeVisible()
  await expect(card.getByRole('textbox', { name: '扫描间隔（秒）' })).toBeVisible()
  // The 实验性 marker sits NEXT TO the label, so it never pollutes the control's
  // accessible name (exact match would fail otherwise).
  await expect(card.getByRole('textbox', { name: '关联置信度阈值', exact: true })).toBeVisible()
  await expect(card.getByText('实验性').first()).toBeVisible()
  await expect(card.getByRole('switch', { name: '启用安静时段' })).toBeVisible()
  await expect(card.getByRole('switch', { name: '启用早晚报' })).toBeVisible()
  await expect(card.getByRole('textbox', { name: '早报时间' })).toBeVisible()
  await expect(card.getByRole('switch', { name: /快照/ })).toBeVisible()
  await expect(card).not.toContainText('M4b')
  await expect(card).not.toContainText('位于设置项上方')

  const originalEnabled = await reminder.isChecked()
  const originalIdentity = await identity.isChecked()
  const originalMergeSuggestions = await mergeSuggestions.isChecked()
  const originalAhead = await ahead.inputValue()
  const alternateAhead = originalAhead === '7' ? '0' : '7'
  let changed = false

  try {
    // ---- 3. staged save: one discard/save footer, no per-field commit ----
    await reminder.setChecked(false)
    await identity.setChecked(!originalIdentity)
    await mergeSuggestions.setChecked(!originalMergeSuggestions)
    await ahead.fill(alternateAhead)
    await expect(card.locator('.yolo-card__pending')).toHaveText('未保存')
    await card.getByRole('button', { name: '保存' }).click()
    // A successful save collapses the card — the shipped cards' own feedback.
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    changed = true

    // ---- 4. the host accepted it: re-open and read the stored values -----
    card = await openYoloSettings(page)
    await expand(card)
    await expect(card.getByRole('switch', { name: '启用到期提醒' })).not.toBeChecked()
    await expect(card.getByRole('switch', { name: '高置信事项自动关联' })).toBeChecked({ checked: !originalIdentity })
    await expect(card.getByRole('switch', { name: '重复事项合并建议' })).toBeChecked({ checked: !originalMergeSuggestions })
    await expect(card.getByRole('textbox', { name: '提前提醒（分钟）' })).toHaveValue(alternateAhead)

    // ---- 5. an accepted write is an override, with a reset that clears it -
    await expect(card.getByRole('button', { name: '恢复默认' }).first()).toBeVisible()
  } finally {
    if (changed) {
      card = await openYoloSettings(page)
      await expand(card)
      await card.getByRole('switch', { name: '启用到期提醒' }).setChecked(originalEnabled)
      await card.getByRole('switch', { name: '高置信事项自动关联' }).setChecked(originalIdentity)
      await card.getByRole('switch', { name: '重复事项合并建议' }).setChecked(originalMergeSuggestions)
      await card.getByRole('textbox', { name: '提前提醒（分钟）' }).fill(originalAhead)
      await card.getByRole('button', { name: '保存' }).click()
      await expect(card.locator('.yolo-card__header')).toHaveAttribute('aria-expanded', 'false')

      card = await openYoloSettings(page)
      await expand(card)
      await expect(card.getByRole('switch', { name: '启用到期提醒' })).toBeChecked({ checked: originalEnabled })
      await expect(card.getByRole('switch', { name: '高置信事项自动关联' })).toBeChecked({ checked: originalIdentity })
      await expect(card.getByRole('switch', { name: '重复事项合并建议' })).toBeChecked({ checked: originalMergeSuggestions })
      await expect(card.getByRole('textbox', { name: '提前提醒（分钟）' })).toHaveValue(originalAhead)
    }
  }
})

test('YOLO 配置卡拒绝无效草稿并保留草稿（W14）', async ({ page }) => {
  const card = await openYoloSettings(page)
  await expand(card)
  const interval = card.getByRole('textbox', { name: '扫描间隔（秒）' })

  await interval.fill('5')
  await expect(interval).toHaveAttribute('aria-invalid', 'true')
  await expect(card.getByText('请填数字；留空表示使用默认值。')).toBeVisible()
  await expect(card.getByRole('button', { name: '保存' })).toBeDisabled()

  // Discard drops the draft and restores the stored text; nothing was written.
  await card.getByRole('button', { name: '放弃修改' }).click()
  await expect(interval).not.toHaveAttribute('aria-invalid', 'true')
  await expect(card.locator('.yolo-card__pending')).toHaveCount(0)
})
