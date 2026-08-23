// L2 · ui lane — the panel still renders its board with the scope switch in
// the header (v0.3.3: the board is always aggregate; the header switch is the
// remaining surface). A real aggregate view needs the opt-in config toggled in
// Settings, so the row-level contract lives in api/dashboard-scope.spec.ts.

import { test, expect } from '@playwright/test'
import { openYoloPanel } from '../helpers.ts'

test('panel still renders its board with the scope switch in the header', async ({ page }) => {
  await openYoloPanel(page)
  const switchBtn = page.locator('.wsswitch button', { hasText: '全部' })
  if (await switchBtn.isVisible().catch(() => false)) {
    await switchBtn.click()
    await expect(page.locator('.yolo-scope .brand-name')).toHaveText('YOLO')
  }
})
