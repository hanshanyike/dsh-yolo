// Host-half skew regression (upgrade-behind-a-running-host).
//
// dist/client is read fresh per page load while the host process keeps the
// server half it booted with, so upgrading dist while the host runs serves a
// NEW client against an OLD server: new subpaths answer 405 (observed live:
// deleting a notification answered 405 after the 0.5.0 upgrade) and nothing
// explained why. The panel now compares GET /yolo/version against its own
// bundled version and asks for a host restart; a 405 on dismiss explains
// itself instead of printing "HTTP 405".
//
// A genuinely stale server half cannot be staged in the suite, so the specs
// intercept exactly the two endpoints the client reads and fulfil the stale
// answers a rebuilt-behind-a-running-host deployment produces. Everything
// else drives the real host.

import { expect, test } from '@playwright/test'
import { connectApi, createFixtures, ensureHostAuth, openYoloPanel } from '../helpers.ts'

test.beforeEach(async ({ page }) => {
  await ensureHostAuth(page)
})

test.describe('host skew notice', () => {
  test('GOAL-SKEW-01: a differing host version surfaces the restart notice, dismissibly', async ({ page }) => {
    await page.route('**/yolo/version', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ current: '0.4.3' }),
    }))
    await openYoloPanel(page)
    const notice = page.locator('.yolo-scope .skew-line')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('0.4.3')
    await expect(notice).toContainText('重启宿主')

    await notice.getByRole('button', { name: '知道了' }).click()
    await expect(notice).toBeHidden()
    // Opt-in visual evidence for the real-browser walkthrough (W1).
    if (process.env.YOLO_E2E_SHOTS) {
      const board = page.locator('.yolo-scope')
      await board.screenshot({ path: 'output/playwright/host-skew-notice.png' })
    }
  })

  test('GOAL-SKEW-02: a missing version endpoint is also skew (the endpoint ships with this bundle)', async ({ page }) => {
    await page.route('**/yolo/version', (route) => route.fulfill({ status: 404, body: '' }))
    await openYoloPanel(page)
    const notice = page.locator('.yolo-scope .skew-line')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('旧版本')
    await expect(notice).toContainText('重启宿主')
  })

  test('GOAL-SKEW-03: a matching host shows no notice', async ({ page }) => {
    await openYoloPanel(page)
    // The real host serves the same build as this bundle, so the panel must
    // stay quiet — a false restart demand would be worse than none.
    await expect(page.locator('.yolo-scope .skew-line')).toHaveCount(0)
  })

  test('GOAL-SKEW-04: a dismiss that answers 405 explains the restart instead of "HTTP 405"', async ({ page }) => {
    const api = await connectApi()
    const fixtures = createFixtures(api)
    try {
      await fixtures.notification('[E2E] 把演示稿发给研发')
      await openYoloPanel(page)
      await page.locator('.yolo-scope .bell').click()
      const log = page.locator('.yolo-scope .notification-log')
      await expect(log).toBeVisible()
      const row = log.locator('li', { hasText: '把演示稿发给研发' }).first()
      await expect(row).toBeVisible()

      // The stale half answers 405 without a body; the running half of this
      // build would answer 200. Fulfil the stale signature exactly.
      await page.route('**/yolo/notifications/dismiss', (route) => route.fulfill({
        status: 405,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'method not allowed', code: 'method_not_allowed' }),
      }))
      await row.locator('.notification-log__dismiss').click()
      await expect(log.locator('.notification-log__error')).toBeVisible()
      await expect(log.locator('.notification-log__error')).toContainText('宿主还在运行旧版助手')
      await expect(log.locator('.notification-log__error')).toContainText('重启宿主')
      // The delivery is still there: the failure must not drop the row.
      await expect(row).toBeVisible()
    } finally {
      await fixtures.dispose()
      await api.close()
    }
  })
})
