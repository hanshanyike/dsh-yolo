import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Yolo from '../src/storage/index.ts'
import { buildDashboardData } from '../src/application/read-models/dashboard.ts'
import { buildGoalDetail } from '../src/application/read-models/goal-detail.ts'
import { applyYoloAction } from '../src/shared/actions.ts'
import { registerGoalDetailEndpoint } from '../src/ui/goals.ts'

describe('goal dashboard and detail projection', () => {
  let cwd: string
  let yolo: Yolo

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'yolo-goal-detail-'))
    yolo = new Yolo({ logger: { info: () => {}, warn: () => {} }, reflect: { provide: () => {} }, effect: () => () => {} } as never)
  })

  afterEach(() => {
    yolo.close()
    rmSync(cwd, { recursive: true, force: true })
  })

  it('projects the next step, counts, source and current milestone from stable relations', () => {
    const goal = yolo.addGoal(cwd, {
      title: '完成产品发布', source: 'manual', source_excerpt: '帮我持续跟进发布目标',
      completion_criteria: '生产环境稳定运行', target_date: '2026-09-30',
    })
    const next = yolo.addTodo(cwd, { title: '确认灰度范围', source: 'manual' }).todo
    const later = yolo.addTodo(cwd, { title: '准备上线公告', source: 'manual' }).todo
    const milestone = yolo.addMilestone(cwd, { title: '灰度验证通过', target_date: '2026-09-15', source: 'manual' })
    yolo.linkGoalTodo(cwd, goal.id, next.id)
    yolo.linkGoalTodo(cwd, goal.id, later.id)
    yolo.setGoalNextTodo(cwd, goal.id, next.id)
    yolo.linkGoalMilestone(cwd, goal.id, milestone.id)

    const dashboard = buildDashboardData(yolo, cwd, '2026-09-01')
    expect(dashboard.goals[0]).toMatchObject({
      id: goal.id,
      completion_criteria: '生产环境稳定运行',
      target_date: '2026-09-30',
      next_todo_id: next.id,
      next_todo: { id: next.id, title: '确认灰度范围' },
      open_todo_count: 2,
      linked_todo_count: 2,
      current_milestone: { id: milestone.id, title: '灰度验证通过' },
      milestone_count: 1,
      attention: null,
      source: { type: 'manual', label: '快速记一条' },
    })
  })

  it('detail shows linked todos and goal history without changing their lifecycle', () => {
    const goal = yolo.addGoal(cwd, { title: '完成研究计划', source: 'manual' })
    const todo = yolo.addTodo(cwd, { title: '确定研究问题', source: 'manual' }).todo
    applyYoloAction(yolo, cwd, { action: 'link', kind: 'goal', id: goal.id, todo_id: todo.id })
    applyYoloAction(yolo, cwd, { action: 'set_next', kind: 'goal', id: goal.id, todo_id: todo.id })
    applyYoloAction(yolo, cwd, { action: 'review', kind: 'goal', id: goal.id, progress: 40, note: '问题范围已经收窄' })

    const detail = buildGoalDetail(yolo, cwd, goal.id)
    expect(detail).not.toBeNull()
    expect(detail?.support_todos).toEqual([expect.objectContaining({ id: todo.id, status: 'pending' })])
    expect(detail?.goal).toMatchObject({ next_todo_id: todo.id, progress: 40, status: 'active' })
    expect(detail?.recent_progress.map((event) => event.kind)).toEqual(expect.arrayContaining(['goal_reviewed', 'goal_progress']))
  })

  it('serves a single goal detail through the scoped HTTP adapter', async () => {
    const goal = yolo.addGoal(cwd, { title: '完成发布说明', source: 'manual' })
    const server = { register: vi.fn() }
    registerGoalDetailEndpoint({ webServer: server }, yolo, () => cwd)
    const handler = (server.register.mock.calls[0]?.[0] as { handler: (req: unknown, res: unknown) => Promise<void> }).handler
    const response = { writeHead: vi.fn(), end: vi.fn() }
    await handler({ method: 'GET', url: `/yolo/goals/${goal.id}` }, response)
    expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    expect(JSON.parse(response.end.mock.calls[0]?.[0] as string)).toMatchObject({ ok: true, goal: { id: goal.id, title: '完成发布说明' } })
  })
})
