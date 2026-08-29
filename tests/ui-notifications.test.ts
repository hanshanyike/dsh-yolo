import { describe, expect, it } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import type { Notification, Todo } from '../src/storage/types.ts'
import { buildNotificationLogData } from '../src/ui/notifications.ts'

const WS_A = 'D:\\work\\alpha'
const WS_B = 'D:\\work\\beta'

function notification(id: string, createdAt: number, over: Partial<Notification> = {}): Notification {
  return {
    id,
    kind: 'reminder',
    title: `提醒 ${id}`,
    created_at: createdAt,
    seen_at: null,
    handled_at: null,
    scope_key: 'scope/default',
    ...over,
  }
}

function fakeYolo(rows: Record<string, Notification[]>, failures = new Set<string>()): Yolo {
  const todos: Todo[] = [{
    id: 'todo-a', title: '把演示稿发给研发', status: 'pending', due_at: '2026-08-30',
    scope_key: 'a/default', created_at: 1, updated_at: 1,
  }]
  return {
    listWorkspaceMeta: () => [
      { cwd: WS_A, scopeKey: 'a/default' },
      { cwd: WS_B, scopeKey: 'b/default' },
    ],
    runInScope: (cwd: string, _scopeKey: string, fn: () => unknown) => {
      if (failures.has(cwd)) throw new Error('locked')
      return fn()
    },
    listTodos: (cwd: string) => cwd === WS_A ? todos : [],
    listNotificationsUntil: (cwd: string, openedAt: number, limit: number) => (rows[cwd] ?? [])
      .filter((row) => row.created_at <= openedAt)
      .sort((left, right) => right.created_at - left.created_at || right.id.localeCompare(left.id))
      .slice(0, limit),
    countUnseenNotifications: (cwd: string) => (rows[cwd] ?? []).filter((row) => row.seen_at == null).length,
  } as unknown as Yolo
}

describe('notification record projection', () => {
  it('globally orders, paginates and resolves todo/workspace context', () => {
    const yolo = fakeYolo({
      [WS_A]: [notification('a-old', 100), notification('a-new', 400, { todo_id: 'todo-a', scope_key: 'a/default' })],
      [WS_B]: [notification('b-mid', 300, { kind: 'brief', scope_key: 'b/default' })],
    })
    const first = buildNotificationLogData(yolo, WS_A, { cursor: { openedAt: 500, offset: 0 }, limit: 2 })
    expect(first.items.map((row) => row.id)).toEqual(['a-new', 'b-mid'])
    expect(first.items[0]).toMatchObject({ todo: { id: 'todo-a', status: 'pending' }, ws: { label: 'alpha' } })
    expect(first.unseen).toBe(3)
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(first.partial).toBe(false)

    const second = buildNotificationLogData(yolo, WS_A, { cursor: { openedAt: 500, offset: 2 }, limit: 2 })
    expect(second.items.map((row) => row.id)).toEqual(['a-old'])
    expect(second.nextCursor).toBeNull()
  })

  it('keeps readable workspaces when another notification store fails', () => {
    const data = buildNotificationLogData(fakeYolo({
      [WS_A]: [notification('available', 100)],
      [WS_B]: [notification('locked', 200)],
    }, new Set([WS_B])), WS_A, { cursor: { openedAt: 500, offset: 0 } })
    expect(data.items.map((row) => row.id)).toEqual(['available'])
    expect(data.partial).toBe(true)
    expect(data.workspaceErrors).toEqual(['beta: locked'])
  })
})
