// Milestone track overlap regression (upgrade report: 「里程碑会出现重叠在一起」).
//
// The shared time axis positioned dots purely by target date, so milestones
// without a target date all landed at 50%, same-date milestones landed at the
// same point, and labels alternated between only two rows by DOM parity —
// two stacked dots on the same parity printed labels one over another
// (observed live: two undated milestones exactly coinciding). The track now
// lays dots out collision-free (client/panel/milestone-track-layout.ts).
//
// Milestones have no HTTP create action (they arrive through extraction or
// the memory tool), so this spec seeds the workspace SQLite directly with the
// live-data shape that triggered the report: two undated milestones plus one
// dated shortly before today. The browser then drives the real panel.

import { expect, test } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import {
  connectApi,
  createFixtures,
  ensureHostAuth,
  openYoloPanel,
  waitForDashboard,
  type WorkspaceOwnedRow,
} from '../helpers.ts'
import { dbFileName } from '../../../src/storage/scope.ts'

/** Resolve the real workspace SQLite store owning one dashboard row. */
function workspaceDb(row: WorkspaceOwnedRow): DatabaseSync {
  const cwd = row.scope_cwd ?? row.ws?.cwd
  const scopeKey = row.ws?.slug
  if (!cwd || !scopeKey) throw new Error('dashboard row does not expose ws.cwd + ws.slug')
  // Same path rule as withWorkspaceDatabase, kept open because the spec
  // writes (seed) and reads (verify) across the whole test body.
  const db = new DatabaseSync(join(cwd, '.dsh', 'yolo', dbFileName(scopeKey)))
  db.exec('PRAGMA busy_timeout=5000')
  return db
}

function seedMilestones(
  db: DatabaseSync,
  scopeKey: string,
  rows: Array<{ id: string; title: string; target: string | null }>,
): void {
  const now = Date.now()
  const insert = db.prepare(
    'INSERT INTO milestones (id, title, target_date, status, scope_key, source, created_at, updated_at) '
    + "VALUES (?, ?, ?, 'planned', ?, 'manual', ?, ?)",
  )
  for (const row of rows) insert.run(row.id, row.title, row.target, scopeKey, now, now)
}

function removeMilestones(db: DatabaseSync, ids: string[]): void {
  if (ids.length === 0) return
  const marks = ids.map(() => '?').join(',')
  db.prepare(`DELETE FROM goal_milestones WHERE milestone_id IN (${marks})`).run(...ids)
  db.prepare(`DELETE FROM milestones WHERE id IN (${marks})`).run(...ids)
}

test.beforeEach(async ({ page }) => {
  await ensureHostAuth(page)
})

test('PLAN-MS-01: undated and near-date milestones never stack dots or labels', async ({ page }) => {
  const api = await connectApi()
  const fixtures = createFixtures(api)
  // A real row anchors the workspace store: the action answer carries no ws
  // block, so the owner (cwd + scope key) is read back from the dashboard.
  const anchor = await fixtures.todo('[E2E] 安排里程碑验收的前置事项')
  const dashboard = await waitForDashboard(api, (d) => d.todos.some((row: Record<string, unknown>) => row.id === anchor.id))
  const owner = dashboard.todos.find((row: Record<string, unknown>) => row.id === anchor.id) as WorkspaceOwnedRow | undefined
  if (!owner?.ws?.cwd || !owner.ws.slug) throw new Error('anchor todo row is missing its workspace owner')
  let db: DatabaseSync | undefined
  const seeded: string[] = []
  try {
    db = workspaceDb(owner)
    const scopeKey = String(owner.ws.slug)
    // Before the fix, alpha and beta both sat at exactly 50% with labels on
    // the same row; review sat ~6% away, still inside label-collision range.
    const rows = [
      { id: `e2e-ms-a-${Date.now()}`, title: '[E2E] 完成内部评审', target: null },
      { id: `e2e-ms-b-${Date.now()}`, title: '[E2E] 灰度验证通过', target: null },
      { id: `e2e-ms-c-${Date.now()}`, title: '[E2E] 演示环境就绪', target: dateDaysAgo(12) },
    ]
    seeded.push(...rows.map((row) => row.id))
    seedMilestones(db, scopeKey, rows)

    await openYoloPanel(page)
    await page.locator('#yolo-tab-goals').click()

    const track = page.locator('.yolo-scope .goal-track')
    await expect(track).toBeVisible()
    const dots = track.locator('.ms-dot')
    await expect(dots).toHaveCount(3)

    // Dots: pairwise distinct horizontal positions (they share the track
    // line, so the x center is the separation that matters).
    const dotBoxes = await dots.evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top, w: rect.width, h: rect.height }
    }))
    for (let i = 0; i < dotBoxes.length; i++) {
      for (let j = i + 1; j < dotBoxes.length; j++) {
        expect(Math.abs(dotBoxes[i]!.x - dotBoxes[j]!.x), `dots ${i}/${j} must not share a position`).toBeGreaterThanOrEqual(8)
      }
    }

    // Labels: no two label boxes may intersect anywhere.
    const labels = track.locator('.ms-label')
    await expect(labels).toHaveCount(3)
    const labelBoxes = await labels.evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    }))
    for (let i = 0; i < labelBoxes.length; i++) {
      for (let j = i + 1; j < labelBoxes.length; j++) {
        const a = labelBoxes[i]!
        const b = labelBoxes[j]!
        const overlaps = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
        expect(overlaps, `labels ${i}/${j} must not overlap`).toBe(false)
      }
    }

    // Every dot stays an individually clickable target: the edit popover
    // opens on the dot that used to be buried under another one.
    await dots.nth(1).click()
    await expect(track.locator('.ms-pop')).toBeVisible()
    await track.locator('.ms-pop').getByRole('button', { name: '关闭' }).click()
    await expect(track.locator('.ms-pop')).toHaveCount(0)

    // Opt-in visual evidence for the real-browser walkthrough (W2/W7).
    if (process.env.YOLO_E2E_SHOTS) {
      await track.screenshot({ path: 'output/playwright/milestone-track-overlap.png' })
    }
  } finally {
    if (db) {
      try { removeMilestones(db, seeded) } catch { /* best effort; the sweep below is the backstop */ }
      db.close()
    }
    await fixtures.dispose()
    await api.close()
  }
})

/** Local YYYY-MM-DD for today - `days`. */
function dateDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

test('PLAN-MS-02: the collision layout still fits the 340px compact panel (W7)', async ({ page }) => {
  // 400px host viewport leaves roughly 340px beside the native sidebar —
  // the product's formal compact width. With the whole milestone set forced
  // into a narrow band, every dot and label must stay inside the board
  // column instead of overflowing the panel.
  await page.setViewportSize({ width: 400, height: 800 })
  const api = await connectApi()
  const fixtures = createFixtures(api)
  const anchor = await fixtures.todo('[E2E] 窄屏里程碑回归的前置事项')
  const dashboard = await waitForDashboard(api, (d) => d.todos.some((row: Record<string, unknown>) => row.id === anchor.id))
  const owner = dashboard.todos.find((row: Record<string, unknown>) => row.id === anchor.id) as WorkspaceOwnedRow | undefined
  if (!owner?.ws?.cwd || !owner.ws.slug) throw new Error('anchor todo row is missing its workspace owner')
  let db: DatabaseSync | undefined
  const seeded: string[] = []
  try {
    db = workspaceDb(owner)
    // Six undated milestones in the compact band: the densest realistic
    // shape (one undated pair was the live report; six proves the layout
    // degrades gracefully instead of overflowing at the edges).
    const rows = Array.from({ length: 6 }, (_, i) => ({
      id: `e2e-ms-n${i}-${Date.now()}`,
      title: `[E2E] 灰度阶段 ${i + 1} 验证`,
      target: null,
    }))
    seeded.push(...rows.map((row) => row.id))
    seedMilestones(db, String(owner.ws.slug), rows)

    await openYoloPanel(page)
    await page.locator('#yolo-tab-goals').click()
    const track = page.locator('.yolo-scope .goal-track')
    await expect(track).toBeVisible()
    await expect(track.locator('.ms-dot')).toHaveCount(6)

    // No horizontal overflow in the board scroll container.
    const body = page.locator('.yolo-scope .p-body')
    expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    // Every dot and label stays inside the main content box.
    const inside = await track.evaluate((node) => {
      const mainBox = node.closest('.p-main')!.getBoundingClientRect()
      const all = Array.from(node.querySelectorAll<HTMLElement>('.ms-dot, .ms-label'))
      return all.every((el) => {
        const r = el.getBoundingClientRect()
        return r.left >= mainBox.left - 0.5 && r.right <= mainBox.right + 0.5
      })
    })
    expect(inside).toBe(true)
  } finally {
    if (db) {
      try { removeMilestones(db, seeded) } catch { /* best effort */ }
      db.close()
    }
    await fixtures.dispose()
    await api.close()
  }
})
