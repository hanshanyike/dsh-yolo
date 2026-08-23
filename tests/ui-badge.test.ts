import { describe, expect, it, vi } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import { buildBadgeData, registerBadgeEndpoint } from '../src/ui/badge.ts'

function yolo(overrides: Partial<Yolo> = {}): Yolo {
  return {
    listWorkspaceMeta: () => [],
    countUnhandledNotifications: () => 3,
    runInScope: (_cwd: string, _scopeKey: string, fn: () => unknown) => fn(),
    ...overrides,
  } as unknown as Yolo
}

describe('lightweight badge feed', () => {
  it('counts the fallback workspace without building a dashboard', () => {
    const count = vi.fn(() => 3)
    expect(buildBadgeData(yolo({ countUnhandledNotifications: count }), '/ws/current')).toEqual({ unhandled: 3 })
    expect(count).toHaveBeenCalledWith('/ws/current')
  })

  it('aggregates known workspace counts and marks partial results', () => {
    const data = buildBadgeData(yolo({
      listWorkspaceMeta: () => [
        { cwd: '/ws/a', scopeKey: 'a/main' },
        { cwd: '/ws/b', scopeKey: 'b/main' },
      ],
      countUnhandledNotifications: (cwd: string) => {
        if (cwd === '/ws/b') throw new Error('locked')
        return 2
      },
    }), '/ws/current')
    expect(data).toEqual({ unhandled: 2, partial: true })
  })

  it('registers a JSON endpoint', () => {
    const res = { writeHead: vi.fn(), end: vi.fn() }
    const register = vi.fn((opts: { handler: (req: unknown, response: typeof res) => void }) => opts.handler({}, res))
    registerBadgeEndpoint({ webServer: { register } }, yolo(), () => '/ws/current')
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'prefix', path: '/yolo/badge' }))
    expect(JSON.parse(String(res.end.mock.calls[0]?.[0]))).toEqual({ unhandled: 3 })
  })
})
