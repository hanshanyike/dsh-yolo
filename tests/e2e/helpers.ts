// E2E shared helpers — talk to the REAL running host through its HTTP
// endpoints (GET /yolo/dashboard + POST /yolo/actions). No mocked store.
//
// Naming: every item the suite creates carries a unique `[E2E]` prefix so the
// tests are idempotent and self-cleaning (afterAll removes what beforeAll
// made). The prefix is also what the "realistic wording" sweep ignores — this
// is machine-labelled fixture data, not a realistic user sentence.

import { request, expect, type APIRequestContext, type Page } from '@playwright/test'

export const E2E_PREFIX = '[E2E]'
export const HOST = process.env.YOLO_E2E_HOST ?? 'http://127.0.0.1:4080'

/** Unique-ish label so repeated local runs don't collide with stale leftovers. */
export function uid(tag = 'task'): string {
  return `${E2E_PREFIX} ${tag} ${Date.now()}`
}

/** Local "YYYY-MM-DD" for seeding tasks due today. */
export function todayStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Local "YYYY-MM-DD" for yesterday (seeds overdue rows). */
export function yesterdayStr(): string {
  const d = new Date(Date.now() - 86_400_000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface Api {
  req: APIRequestContext
  /** POST /yolo/actions and assert ok; returns the decoded body. */
  action: (body: Record<string, unknown>) => Promise<Record<string, unknown>>
  /** GET /yolo/dashboard. */
  dashboard: () => Promise<Record<string, any>>
  close: () => Promise<void>
}

/** Open the sidebar YOLO panel and wait for the board body to render. */
export async function openYoloPanel(page: Page): Promise<void> {
  // domcontentloaded (not 'load'): the SPA may keep a long-lived resource open,
  // so waiting for full 'load' has budgeted out (60s) in this suite.
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const btn = page.locator("button[title^='YOLO 助手看板']").first()
  await expect(btn).toBeVisible()
  await btn.click()
  await expect(page.locator('.yolo-scope .brand-name')).toHaveText('YOLO')

  // The board body (capture bar) renders only after the first dashboard payload
  // lands; the panel shows a skeleton until then. The endpoint is fast, but the
  // browser fetch over the live host can occasionally stall. Clicking 立即刷新
  // re-drives that fetch — exactly what a real user does when the board looks
  // empty — so row assertions run against real data, not a stuck skeleton.
  const capture = page.locator('.capture .cap-input')
  for (let i = 0; i < 4; i++) {
    if (await capture.isVisible().catch(() => false)) break
    const refresh = page.locator('button[aria-label="立即刷新"]')
    if (await refresh.isVisible().catch(() => false)) await refresh.click()
    await capture.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {})
  }
  await expect(capture).toBeVisible()
}

/** Open a bare API context against the host (no browser needed for seeding). */
export async function connectApi(): Promise<Api> {
  const req = await request.newContext({ baseURL: HOST, extraHTTPHeaders: { accept: 'application/json' } })
  // The host is a single shared process; a transient ECONNRESET on a fresh
  // connection is not a logic failure, so retry once after a short backoff.
  const retry = async <T>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn() } catch (e) {
      await new Promise((r) => setTimeout(r, 600))
      return fn()
    }
  }
  const action = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const r = await retry(() => req.post('/yolo/actions', { data: body }))
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>
    if (!r.ok() || j.ok !== true) {
      throw new Error(`action ${JSON.stringify(body)} failed: ${r.status()} ${JSON.stringify(j)}`)
    }
    return j
  }
  const dashboard = async (): Promise<Record<string, any>> => {
    const r = await retry(() => req.get('/yolo/dashboard'))
    if (!r.ok()) throw new Error(`dashboard failed: ${r.status()}`)
    return r.json()
  }
  return { req, action, dashboard, close: () => req.dispose() }
}

/** Create a todo via the real endpoint; returns its row. */
export async function createTodo(api: Api, title: string, opts: { due?: string } = {}): Promise<Record<string, any>> {
  const res = await api.action({ action: 'quick_add', kind: 'todo', title, due_at: opts.due })
  return res.item as Record<string, any>
}

/** Author an unhandled reminder/brief notification card (badge + kanban card). */
export async function authorNotification(
  api: Api,
  title: string,
  opts: { note?: string; notifKind?: 'reminder' | 'brief' } = {},
): Promise<Record<string, any>> {
  const res = await api.action({ action: 'author_notification', kind: 'notification', title, note: opts.note, notif_kind: opts.notifKind })
  return res.item as Record<string, any>
}

/** Cancel (soft-delete, audited) every todo whose title starts with the prefix. */
export async function cleanupPrefixedTodos(api: Api, prefix: string = E2E_PREFIX): Promise<number> {
  const d = await api.dashboard()
  const rows = (d.todos ?? []) as { id: string; title: string }[]
  let removed = 0
  for (const t of rows) {
    if (t.title && t.title.startsWith(prefix)) {
      await api.action({ action: 'cancel', kind: 'todo', id: t.id }).catch(() => {})
      removed++
    }
  }
  return removed
}

/** Dismiss every notification card whose title starts with the prefix (marks handled). */
export async function cleanupPrefixedNotifications(api: Api, prefix: string = E2E_PREFIX): Promise<number> {
  const d = await api.dashboard()
  const rows = (d.notifications ?? []) as { id: string; title: string }[]
  let removed = 0
  for (const n of rows) {
    if (n.title && n.title.startsWith(prefix)) {
      await api.action({ action: 'handled', kind: 'notification', id: n.id }).catch(() => {})
      removed++
    }
  }
  return removed
}

/** Wait (real time) until the dashboard satisfies a predicate; returns the snapshot. */
export async function waitForDashboard(
  api: Api,
  pred: (d: Record<string, any>) => boolean,
  { timeoutMs = 15_000, poll = 800, label = 'dashboard condition' } = {},
): Promise<Record<string, any>> {
  const start = Date.now()
  let last: Record<string, any> | null = null
  while (Date.now() - start < timeoutMs) {
    const d = await api.dashboard().catch(() => null)
    last = d ?? last
    if (d && pred(d)) return d
    await new Promise((r) => setTimeout(r, poll))
  }
  throw new Error(`timeout waiting for ${label}; last snapshot: ${JSON.stringify(last).slice(0, 500)}`)
}