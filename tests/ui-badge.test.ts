import { describe, expect, it, vi } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import { buildBadgeData, registerBadgeEndpoint } from '../src/ui/badge.ts'

function yolo(overrides: Partial<Yolo> = {}): Yolo {
  return {
    listWorkspaceMeta: () => [],
    countUnhandledNotifications: () => 3,
    countUnseenNotifications: () => 4,
    listRecentUnseenNotifications: () => [],
    listRecentUnhandledReminders: () => [],
    runInScope: (_cwd: string, _scopeKey: string, fn: () => unknown) => fn(),
    ...overrides,
  } as unknown as Yolo
}

describe('lightweight badge feed', () => {
  it('counts the fallback workspace without building a dashboard', () => {
    const count = vi.fn(() => 4)
    expect(buildBadgeData(yolo({ countUnseenNotifications: count }), '/ws/current')).toMatchObject({
      unseen: 4, unhandled: 3, recentNotifications: [], recentReminders: [], revision: expect.any(Number),
    })
    expect(count).toHaveBeenCalledWith('/ws/current')
  })

  it('carries a bounded unseen preview feed', () => {
    const rows = [
      { id: 'n2', kind: 'reminder' as const, title: '核对发布清单', created_at: 200, scope_key: 'current/main' },
      { id: 'n1', kind: 'reminder' as const, title: '把演示稿发给研发', body: '发送前核对数字', created_at: 100, scope_key: 'current/main' },
    ]
    expect(buildBadgeData(yolo({ listRecentUnseenNotifications: () => rows }), '/ws/current')).toMatchObject({
      unseen: 4,
      unhandled: 3,
      recentNotifications: [
        { id: 'n2', kind: 'reminder', title: '核对发布清单', body: null, todo_id: null, scope_cwd: '/ws/current', created_at: 200 },
        { id: 'n1', kind: 'reminder', title: '把演示稿发给研发', body: '发送前核对数字', todo_id: null, scope_cwd: '/ws/current', created_at: 100 },
      ],
      recentReminders: [
        { id: 'n2', kind: 'reminder', title: '核对发布清单', body: null, todo_id: null, scope_cwd: '/ws/current', created_at: 200 },
        { id: 'n1', kind: 'reminder', title: '把演示稿发给研发', body: '发送前核对数字', todo_id: null, scope_cwd: '/ws/current', created_at: 100 },
      ],
    })
  })

  it('aggregates known workspace counts and marks partial results', () => {
    const data = buildBadgeData(yolo({
      listWorkspaceMeta: () => [
        { workspaceId: 'workspace-a', cwd: '/ws/a', scopeKey: 'a/main' },
        { workspaceId: 'workspace-b', cwd: '/ws/b', scopeKey: 'b/main' },
      ],
      countUnhandledNotifications: (cwd: string) => {
        if (cwd === '/ws/b') throw new Error('locked')
        return 2
      },
      countUnseenNotifications: (cwd: string) => cwd === '/ws/b' ? 9 : 2,
    }), '/ws/current')
    expect(data).toMatchObject({ unseen: 2, unhandled: 2, recentNotifications: [], recentReminders: [], partial: true })
  })

  it('sorts and caps recent reminders across workspaces deterministically', () => {
    const data = buildBadgeData(yolo({
      listWorkspaceMeta: () => [
        { workspaceId: 'workspace-a', cwd: '/ws/a', scopeKey: 'a/main' },
        { workspaceId: 'workspace-b', cwd: '/ws/b', scopeKey: 'b/main' },
      ],
      countUnhandledNotifications: () => 3,
      countUnseenNotifications: () => 3,
      listRecentUnseenNotifications: (cwd: string) => Array.from({ length: 4 }, (_, index) => ({
        id: `${cwd.at(-1)}-${index}`,
        kind: 'reminder' as const,
        title: `提醒 ${cwd.at(-1)}-${index}`,
        created_at: index === 3 ? 500 : (cwd.endsWith('a') ? 100 : 200) + index,
        scope_key: `${cwd.at(-1)}/main`,
      })),
    }), '/ws/current')

    expect(data.unhandled).toBe(6)
    expect(data.unseen).toBe(6)
    expect(data.recentNotifications).toHaveLength(5)
    expect(data.recentReminders).toHaveLength(5)
    expect(data.recentReminders?.map((row) => row.id)).toEqual(['a-3', 'b-3', 'b-2', 'b-1', 'b-0'])
  })

  it('keeps equal raw ids distinct when they belong to different workspaces', () => {
    const data = buildBadgeData(yolo({
      listWorkspaceMeta: () => [
        { workspaceId: 'workspace-a', cwd: '/ws/a', scopeKey: 'a/main' },
        { workspaceId: 'workspace-b', cwd: '/ws/b', scopeKey: 'b/main' },
      ],
      countUnhandledNotifications: () => 1,
      countUnseenNotifications: () => 1,
      listRecentUnseenNotifications: () => [{
        id: 'same-id', kind: 'reminder', title: '检查清单', created_at: 500, scope_key: 'scope/main',
      }],
    }), '/ws/current')

    expect(data.recentReminders?.map((row) => row.scope_cwd)).toEqual(['/ws/a', '/ws/b'])
  })

  it('registers a JSON endpoint', () => {
    const res = { writeHead: vi.fn(), end: vi.fn() }
    const register = vi.fn((opts: { handler: (req: unknown, response: typeof res) => void }) => opts.handler({}, res))
    registerBadgeEndpoint({ webServer: { register } }, yolo(), () => '/ws/current')
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'prefix', path: '/yolo/badge' }))
    expect(JSON.parse(String(res.end.mock.calls[0]?.[0]))).toMatchObject({
      unseen: 4, unhandled: 3, recentNotifications: [], recentReminders: [], revision: expect.any(Number),
    })
  })
})
