// api 套件 · HTTP 接口测试（无浏览器）— cross-workspace aggregation contract (v0.3.0/v0.3.3) over
// plain HTTP, no browser. GET /yolo/dashboard?scope=all must be accepted and
// never 500 — it carries the board shape (todos/notifications arrays), and
// when the aggregate view is active it tags scope=all with workspace info.

import { test, expect } from '@playwright/test'
import { connectApi, type Api } from '../helpers.ts'

let api: Api

test.beforeAll(async () => {
  api = await connectApi()
})
test.afterAll(async () => {
  await api.close()
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
