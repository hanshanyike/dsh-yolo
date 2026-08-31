import { test, expect } from '@playwright/test'
import { connectApi, createFixtures, uid, waitForDashboard, withWorkspaceDatabase, type Api } from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(() => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

test('GOAL-01/GOAL-02: goal owns multiple support todos, next step is explicit, and completion is not inferred', async () => {
  const goal = await fx.goal(uid('在九月完成产品发布'), {
    completionCriteria: '生产环境稳定运行',
    targetDate: '2026-09-30',
  })
  const first = await fx.todo(uid('确认灰度发布范围'), { due: '2026-09-05' })
  const second = await fx.todo(uid('准备上线公告'), { due: '2026-09-10' })

  await api.action({ action: 'link', kind: 'goal', id: goal.id, todo_id: first.id })
  await api.action({ action: 'link', kind: 'goal', id: goal.id, todo_id: second.id })
  await api.action({ action: 'set_next', kind: 'goal', id: goal.id, todo_id: first.id })

  const dashboard = await waitForDashboard(api, (data) => {
    const row = (data.goals ?? []).find((item: Record<string, any>) => item.id === goal.id)
    return row?.next_todo_id === first.id && row?.linked_todo_count === 2
  }, { label: 'goal relation projection with two support todos' })
  const row = (dashboard.goals ?? []).find((item: Record<string, any>) => item.id === goal.id) as Record<string, any>
  expect(row).toMatchObject({
    completion_criteria: '生产环境稳定运行',
    target_date: '2026-09-30',
    next_todo: { id: first.id, title: first.title },
    open_todo_count: 2,
  })

  const detailResponse = await api.req.get(`/yolo/goals/${goal.id}`)
  expect(detailResponse.ok()).toBeTruthy()
  const detail = await detailResponse.json() as Record<string, any>
  expect(detail).toMatchObject({ ok: true, goal: { id: goal.id }, support_todos: expect.arrayContaining([
    expect.objectContaining({ id: first.id }), expect.objectContaining({ id: second.id }),
  ]) })

  await api.action({ action: 'complete', kind: 'todo', id: first.id })
  const afterComplete = await waitForDashboard(api, (data) => {
    const next = (data.goals ?? []).find((item: Record<string, any>) => item.id === goal.id)
    return next?.next_todo_id == null && next?.status === 'active'
  }, { label: 'completed goal next step is cleared without achieving goal' })
  expect((afterComplete.goals ?? []).find((item: Record<string, any>) => item.id === goal.id)).toMatchObject({ status: 'active', progress: 0 })

  await api.action({
    action: 'review', kind: 'goal', id: goal.id, progress: 100,
    note: '灰度准备已经完成，等待最终验收', next_todo_id: second.id,
    next_review_at: '2026-09-15T10:00:00+08:00',
  })
  const reviewed = await waitForDashboard(api, (data) => {
    const next = (data.goals ?? []).find((item: Record<string, any>) => item.id === goal.id)
    return next?.progress === 100 && next?.next_todo_id === second.id
  }, { label: 'goal review current state' })
  expect((reviewed.goals ?? []).find((item: Record<string, any>) => item.id === goal.id)).toMatchObject({ status: 'active', progress: 100 })

  const owner = reviewed.todos.find((item: Record<string, any>) => item.id === first.id)
  expect(owner).toBeTruthy()
  const audit = withWorkspaceDatabase(owner, (db) => db.prepare(
    `SELECT kind, summary FROM events WHERE subject_type = 'goal' AND subject_id = ? ORDER BY occurred_at DESC`,
  ).all(goal.id) as Array<Record<string, unknown>>)
  expect(audit.map((event) => event.kind)).toEqual(expect.arrayContaining(['goal_created', 'goal_linked', 'goal_next_step_set', 'goal_next_step_cleared', 'goal_reviewed', 'goal_progress']))
})
