// ui 套件 · 里程碑归属（用户报告 2026-09-11）。
//
// 目标面曾把「所有 planned/active 里程碑」画成一条跨工作区的共享时间轴，只按状态
// 过滤、从不检查归属，于是别的目标（甚至别的库）的里程碑会出现在某个目标卡片下方，
// 看起来像它自己的阶段 —— 现场例子：「发布 0.5.0 版本」出现在
// 「Capability-evidence-anchored skill-selection defense」下面。
//
// 里程碑没有 HTTP 创建动作（只能来自抽取或记忆工具），所以本用例按现场数据形状
// 直接写工作区 SQLite：一个目标带一条自己的里程碑（goal_milestones 关联），
// 另有一条不属于任何目标的里程碑。真实浏览器随后验证分组结果。

import { expect, test } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import {
  connectApi,
  createFixtures,
  ensureHostAuth,
  openYoloPanel,
  uid,
  waitForDashboard,
  type WorkspaceOwnedRow,
} from '../helpers.ts'
import { dbFileName } from '../../../src/storage/scope.ts'

/** Resolve the real workspace SQLite store owning one dashboard row. */
function workspaceDb(row: WorkspaceOwnedRow): DatabaseSync {
  const cwd = row.scope_cwd ?? row.ws?.cwd
  const scopeKey = row.ws?.slug
  if (!cwd || !scopeKey) throw new Error('dashboard row does not expose ws.cwd + ws.slug')
  const db = new DatabaseSync(join(cwd, '.dsh', 'yolo', dbFileName(scopeKey)))
  db.exec('PRAGMA busy_timeout=5000')
  return db
}

/** Seed one milestone, optionally linking it to a goal exactly as extraction does. */
function seedMilestone(
  db: DatabaseSync,
  scopeKey: string,
  row: { id: string; title: string; target?: string | null; goalId?: string },
): void {
  const now = Date.now()
  db.prepare(
    'INSERT INTO milestones (id, title, target_date, status, scope_key, source, created_at, updated_at) '
    + "VALUES (?, ?, ?, 'planned', ?, 'manual', ?, ?)",
  ).run(row.id, row.title, row.target ?? null, scopeKey, now, now)
  if (row.goalId) {
    db.prepare('INSERT INTO goal_milestones (goal_id, milestone_id, position, created_at) VALUES (?, ?, 0, ?)')
      .run(row.goalId, row.id, now)
  }
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

test('PLAN-MS-03: 里程碑归到它自己的目标，别的目标不再共享同一条轨道', async ({ page }) => {
  const api = await connectApi()
  const fixtures = createFixtures(api)
  const anchor = await fixtures.todo('[E2E] 里程碑归属回归的前置事项')
  const dashboard = await waitForDashboard(api, (d) => d.todos.some((row: Record<string, unknown>) => row.id === anchor.id))
  const owner = dashboard.todos.find((row: Record<string, unknown>) => row.id === anchor.id) as WorkspaceOwnedRow | undefined
  if (!owner?.ws?.cwd || !owner.ws.slug) throw new Error('anchor todo row is missing its workspace owner')

  const goalTitle = uid('完成技能选择防线')
  const goal = await fixtures.goal(goalTitle, { completionCriteria: '在独立验收下通过' })
  const ownedTitle = uid('能力真值实验')
  const orphanTitle = uid('发布 0.5.0 版本')

  let db: DatabaseSync | undefined
  const seeded: string[] = []
  try {
    db = workspaceDb(owner)
    const scopeKey = String(owner.ws.slug)
    seeded.push(`e2e-ms-owned-${Date.now()}`, `e2e-ms-orphan-${Date.now()}`)
    seedMilestone(db, scopeKey, { id: seeded[0]!, title: ownedTitle, goalId: String(goal.id) })
    seedMilestone(db, scopeKey, { id: seeded[1]!, title: orphanTitle })

    await openYoloPanel(page)
    await page.getByRole('tablist', { name: '助手页面' }).getByRole('tab', { name: /^目标/ }).click()

    const card = page.locator('.goal').filter({ hasText: goalTitle })
    await expect(card).toBeVisible()
    // The goal shows the milestone it actually carries…
    const chip = card.locator('.cap').filter({ hasText: ownedTitle })
    await expect(chip).toBeVisible()
    // …and never the one that belongs to no goal.
    await expect(card).not.toContainText(orphanTitle)

    // The leftover milestone still has to be reachable: it sits on the shared
    // axis, which is now explicitly labelled as unowned.
    const track = page.locator('.goal-track')
    await expect(track).toBeVisible()
    await expect(page.locator('.goal-head').filter({ hasText: '其他里程碑' })).toHaveCount(1)
    await expect(track.locator('.ms-label b').filter({ hasText: orphanTitle })).toHaveCount(1)
    await expect(track.locator('.ms-label b').filter({ hasText: ownedTitle })).toHaveCount(0)

    // A goal-owned milestone opens its editor next to its own chip instead of
    // on the axis (the axis popover only serves its own dots).
    await chip.click()
    await expect(card.getByRole('dialog', { name: `编辑里程碑：${ownedTitle}` })).toBeVisible()
    await card.locator('.ms-pop.inline').getByRole('button', { name: '关闭' }).click()
    await expect(card.locator('.ms-pop.inline')).toHaveCount(0)

    if (process.env.YOLO_E2E_SHOTS) {
      await card.screenshot({ path: 'output/playwright/milestone-ownership.png' })
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
