// ui 套件 · 浏览器端到端测试 — theme resolution (W6) + narrow-panel chat fullscreen (W7).
// The panel resolves light/dark from the host `--background` CSS variable on
// <html>; the test pins that contract deterministically by overriding the
// variable before the panel mounts, then asserts the resolved data-y-theme.

import { test, expect, type Page } from '@playwright/test'

/** Set the host --background variable, load the app, then open the panel. */
async function openPanelUnderBackground(page: Page, background: string, viewport: { width: number; height: number } = { width: 1440, height: 900 }): Promise<void> {
  await page.setViewportSize(viewport)
  await page.goto('/')
  await page.evaluate((bg) => {
    document.documentElement.style.setProperty('--background', bg)
  }, background)
  const btn = page.locator("button[title^='YOLO 助手看板']").first()
  // The host app boot + sidebar render can exceed the default expect on a
  // cold machine — wait generously so a slow boot is not a flaky fail.
  await expect(btn).toBeVisible({ timeout: 30_000 })
  await btn.click()
  await expect(page.locator('.yolo-scope .brand-name')).toHaveText('YOLO')
}

test('亮色宿主下面板解析为 light 主题（W6）', async ({ page }) => {
  await openPanelUnderBackground(page, '#ffffff')
  await expect(page.locator('.yolo-scope')).toHaveAttribute('data-y-theme', 'light')
})

test('暗色宿主下面板解析为 dark 主题（W6）', async ({ page }) => {
  await openPanelUnderBackground(page, '#0a0a0a')
  await expect(page.locator('.yolo-scope')).toHaveAttribute('data-y-theme', 'dark')
})

test('窄屏面板为紧凑态，对话直接全屏展开（W7）', async ({ page }) => {
  // 400px host viewport leaves roughly 340px beside the native sidebar: the
  // product's formal compact width, not merely a generic mobile breakpoint.
  await openPanelUnderBackground(page, '#ffffff', { width: 400, height: 800 })

  // compact reduces the panel & opens chat full-screen, not a side dock
  await expect(page.locator('.yolo-scope')).toHaveClass(/compact/)
  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveCount(3)
  await expect(page.getByRole('tab', { name: /今天/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /即将/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /已完成/ })).toBeVisible()
  expect(await page.locator('.p-head').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.locator('.y-tabs').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.locator('.p-head .ctoggle').filter({ hasText: '对话' }).click()
  await expect(page.locator('.p-head .ctoggle').filter({ hasText: '返回看板' })).toBeVisible()
  await expect(page.locator('.dock')).toHaveCount(0)

  // Esc back to the kanban, then close the panel
  await page.keyboard.press('Escape')
  await expect(page.locator('.p-head .ctoggle').filter({ hasText: '对话' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.yolo-scope')).toHaveCount(0)
})

test('更多菜单承载辅助视图、刷新和目标主题，并在 Esc 后恢复焦点', async ({ page }) => {
  await openPanelUnderBackground(page, '#ffffff')
  await expect(page.locator('.p-head .flt')).toHaveCount(0)
  await expect(page.locator('.list-tools .flt')).toBeVisible()
  const more = page.getByRole('button', { name: '更多看板操作' })
  await more.click()

  await expect(page.getByRole('menuitem', { name: '目标与里程碑' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '今日台账' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '高级筛选' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '刷新看板' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '切换为深色主题' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()

  await more.click()
  await page.getByRole('menuitem', { name: '目标与里程碑' }).click()
  await expect(page.getByRole('heading', { name: '目标与里程碑' })).toBeVisible()
})
