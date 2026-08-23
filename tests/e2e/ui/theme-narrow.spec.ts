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
  await openPanelUnderBackground(page, '#ffffff', { width: 460, height: 800 })

  // compact reduces the panel & opens chat full-screen, not a side dock
  await expect(page.locator('.yolo-scope')).toHaveClass(/compact/)
  await page.locator('.p-head .ctoggle').filter({ hasText: '对话' }).click()
  await expect(page.locator('.p-head .ctoggle').filter({ hasText: '侧栏' })).toBeVisible()
  await expect(page.locator('.dock')).toHaveCount(0)

  // Esc back to the kanban, then close the panel
  await page.keyboard.press('Escape')
  await expect(page.locator('.p-head .ctoggle').filter({ hasText: '对话' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.yolo-scope')).toHaveCount(0)
})
