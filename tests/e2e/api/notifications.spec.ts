import { test, expect } from '@playwright/test'
import { connectApi, createFixtures, uid, type Api } from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(async () => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

test('NOTIF-API-01: 未读、处理与完整分页是三条独立契约', async () => {
  const baseline = await api.notifications()
  const ids: string[] = []
  for (let index = 0; index < 22; index++) {
    const row = await fx.notification(uid(`提醒我确认第 ${index + 1} 项客户材料`), {
      note: `确认客户材料第 ${index + 1} 项的交付状态`,
      notifKind: index % 5 === 0 ? 'brief' : 'reminder',
    })
    ids.push(String(row.id))
  }

  const first = await api.notifications()
  expect(first.unseen).toBe((baseline.unseen ?? 0) + 22)
  expect(first.items).toHaveLength(20)
  expect(first.nextCursor).toEqual(expect.any(String))
  const second = await api.notifications(String(first.nextCursor))
  const loadedIds = [...first.items, ...second.items].map((row: Record<string, unknown>) => String(row.id))
  expect(ids.every((id) => loadedIds.includes(id))).toBe(true)

  const seen = await api.seen({ opened_at: first.openedAt })
  expect(seen.unseen).toBe(0)
  const dashboard = await api.dashboard()
  const authored = dashboard.notifications.filter((row: Record<string, unknown>) => ids.includes(String(row.id)))
  expect(authored.every((row: Record<string, unknown>) => row.seen === true)).toBe(true)
  expect(authored.every((row: Record<string, unknown>) => row.handled === false)).toBe(true)
})
