// YOLO end-to-end (browser) tests — real host, real browser.
//
// These drive a RUNNING dsh web host (default http://127.0.0.1:3080) with
// system Edge/Chrome, so they exercise the actual client bundle, the real
// /yolo/dashboard + /yolo/actions endpoints, and the real SQLite store. They
// are a LOCAL supplementary suite — CI runs the keyless unit tests only
// (reminder/brief/scheduler triggering is unit-tested; see docs/testing.md).
//
//   node scripts/e2e.mjs                # bring up/reuse the host, run all specs
//   node scripts/e2e.mjs --suite=api    # api suite: HTTP integration tests (no browser)
//   node scripts/e2e.mjs --no-host      # reuse whatever host already answers
//
// Browser: use the system-installed Edge/Chrome channel so no browser download
// is needed. Override with `--project=chromium` + PLAYWRIGHT_BROWSERS_PATH if
// you prefer the bundled Chromium.
//
// Reports: set YOLO_E2E_REPORT=<path> to also write a machine-readable JSON
// report there (agents/CI consume this instead of scraping console output).

import { defineConfig } from '@playwright/test'

const HOST = process.env.YOLO_E2E_HOST ?? 'http://127.0.0.1:3080'

const reporter: import('@playwright/test').ReporterDescription[] = [['list']]
if (process.env.YOLO_E2E_REPORT) reporter.push(['json', { outputFile: process.env.YOLO_E2E_REPORT }])

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // 25s: the live host recomputes the board on every action + the panel re-fetches
  // on each refresh, and the host app boot can be slow on a cold machine, so a
  // generous assertion window absorbs occasional slow rounds.
  expect: { timeout: 25_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter,
  use: {
    baseURL: HOST,
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    channel: process.env.YOLO_E2E_CHANNEL ?? 'msedge',
    locale: 'zh-CN',
  },
  projects: [{ name: 'yolo-e2e', use: { browserName: 'chromium' } }],
})

