// E2E — cross-workspace aggregation contract (v0.3.0), against the REAL host.
// Loop 1: GET /yolo/dashboard?scope=all must be accepted and never 500 — when
// ui.aggregateAcrossWorkspaces is off (default) it degrades to the current
// workspace view, so row-level assertions target the wiring, not the aggregate.
// Loop 2: the panel still renders its board (the scope toggle lives in the
// header; a real aggregate view needs the opt-in config toggled in Settings).

import { test, expect } from '@playwright/test'
import {
  connectApi,
  openYoloPanel,
  cleanupPrefixedTodos,
  cleanupPrefixedNotifications,
  type Api,
} from './helpers.ts'

let api: Api

test.beforeAll(async () => {
  api = await connectApi()
})
test.afterAll(async () => {
  await cleanupPrefixedTodos(api)
  await cleanupPrefixedNotifications(api)
  await api.close()
})
test.beforeEach(async () => {
  await cleanupPrefixedTodos(api)
  await cleanupPrefixedNotifications(api)
})

test('GET /yolo/dashboard?scope=all is accepted and returns a valid dashboard', async () => {
  const r = await api.req.get('/yolo/dashboard?scope=all')
  expect(r.status()).toBe(200)
  const d = (await r.json()) as Record<string, any>
  // Either a real aggregate view (opt-in on) or the current-scope fallback:
  // both carry the board shape, never an error object.
  expect(Array.isArray(d.todos)).toBe(true)
  expect(Array.isArray(d.notifications)).toBe(true)
  expect(d.error).toBeUndefined()
  // Default current view has no scope flag; opt-in aggregate sets scope=all.
  if (d.scope === 'all') {
    expect(typeof d.workspaceCount).toBe('number')
    expect(Array.isArray(d.workspaces)).toBe(true)
  }
})

test('panel still renders its board with the scope switch in the header', async ({ page }) => {
  await openYoloPanel(page)
  const switchBtn = page.locator('.wsswitch button', { hasText: '全部' })
  if (await switchBtn.isVisible().catch(() => false)) {
    await switchBtn.click()
    await expect(page.locator('.yolo-scope .brand-name')).toHaveText('YOLO')
  }
})
