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

test('NOTIF-API-02: 单条删除与一键清除都从记录、角标和首页投影中消失', async () => {
  const keepTitle = uid('提醒我把合同发给法务')
  const dropTitle = uid('提醒我确认下周的评审时间')
  const keep = await fx.notification(`⏰ ${keepTitle}`, { note: '法务今天下午在，越早越好' })
  const drop = await fx.notification(`⏰ ${dropTitle}`, { note: '评审时间还没最终定' })

  const seeded = await api.notifications()
  const seededIds = seeded.items.map((row: Record<string, unknown>) => String(row.id))
  expect(seededIds).toEqual(expect.arrayContaining([String(keep.id), String(drop.id)]))

  expect(await api.dismiss({ notification: { id: String(drop.id), scope_cwd: String(drop.scope_cwd) } }))
    .toMatchObject({ ok: true, removed: 1 })
  const afterOne = await api.notifications()
  const afterOneIds = afterOne.items.map((row: Record<string, unknown>) => String(row.id))
  expect(afterOneIds).not.toContain(String(drop.id))
  expect(afterOneIds).toContain(String(keep.id))
  expect(afterOne.unseen).toBe(seeded.unseen - 1)
  expect((await api.dashboard()).notifications.map((row: Record<string, unknown>) => String(row.id)))
    .not.toContain(String(drop.id))

  // A replay (double click, stale client) is a no-op, not a 404.
  expect(await api.dismiss({ notification: { id: String(drop.id), scope_cwd: String(drop.scope_cwd) } }))
    .toMatchObject({ ok: true, removed: 0 })

  const cleared = await api.dismiss({ all: true })
  expect(cleared.removed).toBeGreaterThanOrEqual(1)
  const empty = await api.notifications()
  expect(empty.items).toEqual([])
  expect(empty.unseen).toBe(0)
  expect(empty.nextCursor).toBeNull()
  expect((await api.dashboard()).notifications.map((row: Record<string, unknown>) => String(row.id)))
    .not.toContain(String(keep.id))
})
