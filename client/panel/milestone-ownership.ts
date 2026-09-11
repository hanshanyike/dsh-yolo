/**
 * Milestone ownership for the plan view's 目标与里程碑 surface.
 *
 * Milestones used to be rendered as one flat, cross-workspace time axis that
 * filtered by status only — even though the code claimed it carried "milestones
 * that no active goal carries". The dashboard has always had the goal↔milestone
 * relation (`goal_milestones`), and every milestone row now exposes the goals
 * that own it (`goal_ids`), so the surface groups by ownership instead:
 * a goal shows its own milestones, and the shared axis carries only the
 * leftovers. Before this, a goal with no linked milestone sat above a track
 * full of other goals' milestones and read as if they were its own.
 *
 * Milestone ids are only unique inside their own store, so every key is scoped
 * by the owning workspace: the board aggregates all known workspaces.
 */

import type { YoloGoalRow, YoloMilestoneRow } from '../../src/contracts/dashboard.ts'

/** Row identity that survives cross-workspace aggregation. */
export function milestoneOwnerKey(ws: { cwd?: string } | undefined, id: string): string {
  return `${ws?.cwd ?? ''}\u0000${id}`
}

/** Milestones of one goal, earliest target date first (undated last). */
export function sortGoalMilestones(rows: readonly YoloMilestoneRow[]): YoloMilestoneRow[] {
  return [...rows].sort((a, b) => (a.target_date ?? '9999-99-99').localeCompare(b.target_date ?? '9999-99-99')
    || a.title.localeCompare(b.title))
}

/** Milestones an axis may carry: still planned or in progress (not terminal). */
export function isOpenMilestone(row: YoloMilestoneRow): boolean {
  return row.status === 'planned' || row.status === 'active'
}

export interface MilestoneOwnership {
  /** Owner-scoped goal key → the milestones that goal carries. */
  byGoal: Map<string, YoloMilestoneRow[]>
  /** Open milestones that none of the given goals owns. */
  unowned: YoloMilestoneRow[]
}

/**
 * Resolve which milestones belong to which goal.
 *
 * @param goals - the goals the surface renders; ownership is only meaningful
 *   against those, so a milestone of an abandoned goal lands in `unowned`
 *   rather than disappearing.
 * @param milestones - every milestone row in the aggregate dashboard.
 */
export function resolveMilestoneOwnership(
  goals: readonly YoloGoalRow[],
  milestones: readonly YoloMilestoneRow[],
): MilestoneOwnership {
  const byGoal = new Map<string, YoloMilestoneRow[]>()
  for (const goal of goals) byGoal.set(milestoneOwnerKey(goal.ws, goal.id), [])

  for (const milestone of milestones) {
    for (const goalId of milestone.goal_ids ?? []) {
      const list = byGoal.get(milestoneOwnerKey(milestone.ws, goalId))
      // A shared milestone lists several goals; it shows under each of them.
      if (list && !list.some((row) => row.id === milestone.id)) list.push(milestone)
    }
  }

  // Legacy fallback: a store whose link rows have not migrated yet still names
  // its current milestone by title on the goal itself.
  for (const goal of goals) {
    const title = goal.milestone_title
    if (!title) continue
    const list = byGoal.get(milestoneOwnerKey(goal.ws, goal.id))
    if (!list || list.some((row) => row.title === title)) continue
    const match = milestones.find((row) => row.title === title
      && (row.ws?.cwd ?? '') === (goal.ws?.cwd ?? ''))
    if (match) list.push(match)
  }

  const owned = new Set<string>()
  for (const list of byGoal.values()) {
    for (const row of list) owned.add(milestoneOwnerKey(row.ws, row.id))
  }

  return {
    byGoal,
    unowned: milestones.filter((row) => isOpenMilestone(row) && !owned.has(milestoneOwnerKey(row.ws, row.id))),
  }
}
