// YOLO end-to-end (browser) tests — real host, real browser.
//
// These drive a RUNNING dsh web host (dev.mjs, default http://127.0.0.1:3080)
// with system Edge/Chrome, so they exercise the actual client bundle, the
// real /yolo/dashboard + /yolo/actions endpoints, and the real SQLite store.
// They are a LOCAL complementary lane — CI runs the keyless unit suite only
// (reminder/brief/scheduler triggering is unit-tested; see docs/testing.md).
//
//   pnpm dev:web        # step 1: start the host (or have it already running)
//   pnpm test:e2e       # step 2: run the browser suite
//
// Browser: use the system-installed Edge/Chrome channel so no browser download
// is needed. Override with `--project=chromium` + PLAYWRIGHT_BROWSERS_PATH if
// you prefer the bundled Chromium.

import { defineConfig } from '@playwright/test'

const HOST = process.env.YOLO_E2E_HOST ?? 'http://127.0.0.1:3080'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // 15s: the live host recomputes the board on every action + the panel re-fetches
  // on each refresh, so a generous assertion window absorbs occasional slow rounds.
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
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

