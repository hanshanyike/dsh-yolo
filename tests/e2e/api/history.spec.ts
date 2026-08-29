import { test, expect } from '@playwright/test'
import { connectApi, createFixtures, todayStr, uid, type Api } from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => {
  api = await connectApi()
  fx = createFixtures(api)
})

test.afterEach(async () => { await fx.dispose() })
test.afterAll(async () => { await api.close() })

test('HIST-03: 独立时间线分页并排除内部审计事件', async () => {
  const title = uid('确认客户演示材料的最终发送时间')
  const item = await fx.todo(title, { due: todayStr() })
  await api.action({ action: 'postpone', kind: 'todo', id: item.id, due_at: '2026-09-03' })
  const denied = await api.req.post('/yolo/actions', { data: { action: 'unsupported-history-action', kind: 'todo', id: item.id } })
  expect(denied.status()).toBe(400)

  const first = await api.history({ view: 'timeline', limit: 1 })
  expect(first.events).toHaveLength(1)
  expect(first.nextCursor).toEqual(expect.any(String))
  const second = await api.history({ view: 'timeline', limit: 20, cursor: String(first.nextCursor) })
  const rows = [...first.events, ...second.events] as Array<Record<string, any>>
  const own = rows.filter((row) => row.subject?.id === item.id)
  expect(own.map((row) => row.kind)).toEqual(expect.arrayContaining(['todo_created', 'todo_postponed']))
  expect(own.every((row) => row.subject.title === title)).toBe(true)
  expect(own.find((row) => row.kind === 'todo_postponed')?.change).toEqual({
    due_at: { before: todayStr(), after: '2026-09-03' },
  })
  expect(rows.some((row) => row.kind === 'action_denied')).toBe(false)
})

test('HIST-04: 按事项保持改名前后的稳定身份并在终态筛选中可达', async () => {
  const original = uid('把季度复盘结论发给管理层')
  const renamed = `${original}和项目负责人`
  const item = await fx.todo(original, { due: todayStr() })
  await api.action({ action: 'update', kind: 'todo', id: item.id, title: renamed })
  await api.action({ action: 'complete', kind: 'todo', id: item.id })

  const grouped = await api.history({ view: 'items', status: 'ended', q: '季度复盘结论' })
  const subject = grouped.items.find((row: Record<string, any>) => row.id === item.id)
  expect(subject).toMatchObject({ title: renamed, status: 'done', change_count: 3 })

  const detail = await api.history({
    view: 'subject', subject_type: 'todo', subject_id: String(item.id), scope_cwd: String(subject.scope_cwd),
  })
  expect(detail.events.map((row: Record<string, any>) => row.kind)).toEqual(['todo_completed', 'todo_updated', 'todo_created'])
  expect(detail.events.find((row: Record<string, any>) => row.kind === 'todo_updated')?.change.title)
    .toEqual({ before: original, after: renamed })
})
