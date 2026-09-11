// Regression: 不同目标的里程碑堆到一起 (user report 2026-09-11).
//
// The plan view drew one flat milestone axis filtered by status only, so a
// goal with no linked milestone sat above a track carrying other goals'
// milestones (live case: 「发布 0.5.0 版本」 from another workspace appearing
// under 「Capability-evidence-anchored skill-selection defense」). Ownership now
// comes from the goal_milestones relation, surfaced as `goal_ids`.

import { describe, expect, it } from 'vitest'
import {
  milestoneOwnerKey,
  resolveMilestoneOwnership,
  sortGoalMilestones,
  type MilestoneOwnership,
} from '../client/panel/milestone-ownership.ts'
import type { YoloGoalRow, YoloMilestoneRow, WorkspaceTag } from '../src/contracts/dashboard.ts'

const WS_A: WorkspaceTag = { slug: 'aaaa_default', label: 'dsh-yolo', cwd: 'D:\\Code\\WorkBuddy\\dsh-yolo' }
const WS_B: WorkspaceTag = { slug: 'bbbb_default', label: 'SkillSEO', cwd: 'D:\\Code\\SkillSEO' }

function goal(id: string, title: string, ws: WorkspaceTag = WS_A, extra: Partial<YoloGoalRow> = {}): YoloGoalRow {
  return { id, title, status: 'active', progress: 0, ws, ...extra }
}

function milestone(id: string, title: string, ws: WorkspaceTag = WS_A, extra: Partial<YoloMilestoneRow> = {}): YoloMilestoneRow {
  return { id, title, status: 'planned', target_date: null, goal_ids: [], ws, ...extra }
}

/** Milestone ids of one goal under the resolved ownership. */
function ownedIds(ownership: MilestoneOwnership, g: YoloGoalRow): string[] {
  return (ownership.byGoal.get(milestoneOwnerKey(g.ws, g.id)) ?? []).map((row) => row.id)
}

describe('milestone ownership', () => {
  it('groups each milestone under the goal that carries it', () => {
    const release = goal('g-release', '完成 0.5.0 发布')
    const defense = goal('g-defense', 'Capability-evidence-anchored skill-selection defense', WS_B)
    const prd = milestone('ms-prd', '进行 PRD 设计', WS_A, { goal_ids: ['g-release'] })
    const experiment = milestone('ms-exp', '能力真值实验：30 skill + 120 请求 + 独立验收', WS_B, { goal_ids: ['g-defense'] })

    const ownership = resolveMilestoneOwnership([release, defense], [prd, experiment])

    expect(ownedIds(ownership, release)).toEqual(['ms-prd'])
    expect(ownedIds(ownership, defense)).toEqual(['ms-exp'])
    // The live bug: another goal's milestone rendered on the shared axis.
    expect(ownership.unowned).toEqual([])
  })

  it('leaves a milestone of an unrendered goal on the shared axis instead of dropping it', () => {
    const defense = goal('g-defense', 'Capability-evidence-anchored skill-selection defense', WS_B)
    const orphanRelease = milestone('ms-050', '发布 0.5.0 版本', WS_A, { goal_ids: ['g-abandoned'] })
    const orphanPrd = milestone('ms-prd', '进行 PRD 设计', WS_A, { goal_ids: [] })

    const ownership = resolveMilestoneOwnership([defense], [orphanRelease, orphanPrd])

    expect(ownedIds(ownership, defense)).toEqual([])
    expect(ownership.unowned.map((row) => row.id)).toEqual(['ms-050', 'ms-prd'])
  })

  it('keeps ids apart across workspaces: the same id is not the same milestone', () => {
    const local = goal('g-1', '本地目标')
    const remote = goal('g-1', '同名 id 的另一个工作区目标', WS_B)
    const localMs = milestone('ms-1', '本地里程碑', WS_A, { goal_ids: ['g-1'] })
    const remoteMs = milestone('ms-1', '远端里程碑', WS_B, { goal_ids: ['g-1'] })

    const ownership = resolveMilestoneOwnership([local, remote], [localMs, remoteMs])

    expect(ownedIds(ownership, local)).toEqual(['ms-1'])
    expect(ownedIds(ownership, remote)).toEqual(['ms-1'])
    expect(ownership.unowned).toEqual([])
    // …and the two rows stay distinguishable by owner-scoped key.
    expect(milestoneOwnerKey(WS_A, 'ms-1')).not.toBe(milestoneOwnerKey(WS_B, 'ms-1'))
  })

  it('does not lose a milestone shared by two goals', () => {
    const first = goal('g-1', '第一个目标')
    const second = goal('g-2', '第二个目标')
    const shared = milestone('ms-shared', '灰度验证通过', WS_A, { goal_ids: ['g-1', 'g-2'] })

    const ownership = resolveMilestoneOwnership([first, second], [shared])

    expect(ownedIds(ownership, first)).toEqual(['ms-shared'])
    expect(ownedIds(ownership, second)).toEqual(['ms-shared'])
    expect(ownership.unowned).toEqual([])
  })

  it('shows a goal its own milestones whatever their status, but never a finished one on the axis', () => {
    const g = goal('g-1', '完成产品发布')
    const open = milestone('ms-open', '灰度中', WS_A, { status: 'active', goal_ids: ['g-1'] })
    const done = milestone('ms-done', '内部评审完成', WS_A, { status: 'done', goal_ids: ['g-1'] })

    const ownership = resolveMilestoneOwnership([g], [open, done])

    expect(ownedIds(ownership, g).sort()).toEqual(['ms-done', 'ms-open'])
    expect(ownership.unowned).toEqual([])
  })

  it('falls back to the goal milestone title for stores that have not migrated', () => {
    const g = goal('g-1', '完成产品发布', WS_A, { milestone_title: '灰度验证通过' })
    const legacy = milestone('ms-legacy', '灰度验证通过')

    const ownership = resolveMilestoneOwnership([g], [legacy])

    expect(ownedIds(ownership, g)).toEqual(['ms-legacy'])
    expect(ownership.unowned).toEqual([])
  })

  it('does not borrow a same-title milestone from another workspace', () => {
    const g = goal('g-1', '完成产品发布', WS_A, { milestone_title: '灰度验证通过' })
    const foreign = milestone('ms-foreign', '灰度验证通过', WS_B)

    const ownership = resolveMilestoneOwnership([g], [foreign])

    expect(ownedIds(ownership, g)).toEqual([])
    expect(ownership.unowned.map((row) => row.id)).toEqual(['ms-foreign'])
  })

  it('orders a goal milestones by target date with undated ones last', () => {
    const rows = [
      milestone('c', '无日期'),
      milestone('b', '九月', WS_A, { target_date: '2026-09-30' }),
      milestone('a', '八月', WS_A, { target_date: '2026-08-30' }),
    ]
    expect(sortGoalMilestones(rows).map((row) => row.id)).toEqual(['a', 'b', 'c'])
  })
})
