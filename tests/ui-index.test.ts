// M7 ui plugin wiring tests — settings section installation, the global
// dashboard endpoint registration, and the endpoint's scope following the
// latest session workspace. Includes the regression test for the loader
// passing `config: undefined` (must not throw reading `.enabled`).

import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/ui/index.ts'
import type Yolo from '../src/storage/index.ts'
import { TurnObservationService } from '../src/runtime/turn-observation.ts'

type Handler = (...args: any[]) => void

function makeCtx(yolo: Yolo) {
  const handlers = new Map<string, Handler>()
  const ctx = {
    yolo,
    agents: {},
    get: vi.fn(() => undefined),
    webServer: { register: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn() },
    // cordis dependency injection used by installSettingsSection
    inject: (_deps: string[], cb: (sctx: unknown) => void) => {
      cb({
        settings: {
          register: vi.fn(() => ({
            dispose: () => {},
            watch: () => () => {},
            get: () => undefined,
          })),
        },
        effect: () => () => {},
      })
    },
    on: (event: string, cb: Handler) => {
      handlers.set(event, cb)
      return () => handlers.delete(event)
    },
  }
  return { ctx, handlers }
}

function mockYolo(): Yolo {
  return {
    observations: new TurnObservationService(),
    conversations: {
      get: vi.fn(() => ({
        sessions: {},
        threads: {},
      })),
    },
    resolve: () => ({ scopeKey: 'test/main', db: {}, dataDir: '' }),
    listTodos: vi.fn(() => []),
    listGoals: vi.fn(() => []),
    listMilestones: vi.fn(() => []),
    listEvents: vi.fn(() => []),
    listEventsBetween: vi.fn(() => []),
    listPreferences: vi.fn(() => []),
    listSessionSummaries: vi.fn(() => []),
    listNotifications: vi.fn(() => []),
    listUnhandledNotifications: vi.fn(() => []),
    listWorkspaceMeta: vi.fn(() => []),
  } as unknown as Yolo
}

describe('ui apply: config normalization (Bug 1 regression)', () => {
  it('does not throw when the loader passes no config stanza at all', () => {
    const { ctx } = makeCtx(mockYolo())
    expect(() => apply(ctx as never, undefined)).not.toThrow()
  })

  it('does not throw on a partial config', () => {
    const { ctx } = makeCtx(mockYolo())
    expect(() => apply(ctx as never, { enabled: true } as never)).not.toThrow()
  })
})

describe('ui apply: global dashboard endpoint', () => {
  it('registers the lightweight badge endpoint exactly once', () => {
    const { ctx } = makeCtx(mockYolo())
    apply(ctx as never, undefined)
    const calls = (ctx.webServer.register as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.filter(([opts]) => opts.path === '/yolo/badge')).toHaveLength(1)
  })

  it('registers GET /yolo/dashboard exactly once', () => {
    const { ctx } = makeCtx(mockYolo())
    apply(ctx as never, undefined)
    const calls = (ctx.webServer.register as ReturnType<typeof vi.fn>).mock.calls
    const dashboards = calls.filter(([opts]) => opts.path === '/yolo/dashboard')
    expect(dashboards).toHaveLength(1)
    expect(dashboards[0][0].kind).toBe('prefix')
  })

  it('registers the paginated history endpoint exactly once', () => {
    const { ctx } = makeCtx(mockYolo())
    apply(ctx as never, undefined)
    const calls = (ctx.webServer.register as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.filter(([opts]) => opts.path === '/yolo/history')).toHaveLength(1)
  })

  it('registers the bounded identity receipt endpoint exactly once', () => {
    const { ctx } = makeCtx(mockYolo())
    apply(ctx as never, undefined)
    const calls = (ctx.webServer.register as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.filter(([opts]) => opts.path === '/yolo/identity-receipts')).toHaveLength(1)
  })

  it('serves the workspace of the most recent session, not process.cwd()', () => {
    const cwds: string[] = []
    const yolo = {
      ...mockYolo(),
      resolve: (c: string) => {
        cwds.push(c)
        return { scopeKey: 'test/main', db: {}, dataDir: '' }
      },
    } as unknown as Yolo
    const { ctx } = makeCtx(yolo)
    apply(ctx as never, undefined)

    // a turn finished in another workspace — the endpoint must follow it
    yolo.observations.observeTurnStopping('work-1', 1, '/ws/alpha', false)

    const register = (ctx.webServer.register as ReturnType<typeof vi.fn>).mock.calls
      .find(([opts]) => opts.path === '/yolo/dashboard')![0] as { handler: (req: unknown, res: unknown) => Promise<void> }
    const res = { writeHead: vi.fn(), end: vi.fn() }
    void register.handler({}, res)

    expect(cwds).toContain('/ws/alpha')
    const body = JSON.parse(String(res.end.mock.calls[0]?.[0]))
    expect(body.cwd).toBe('/ws/alpha')
  })

  // v0.3.3 review regression: YOLO threads own their workspace — a resident or
  // anchored thread turn must NOT move the dashboard's fallback workspace.
  it('a YOLO thread turn does not move the tracked workspace', () => {
    const cwds: string[] = []
    const yolo = {
      ...mockYolo(),
      resolve: (c: string) => {
        cwds.push(c)
        return { scopeKey: 'test/main', db: {}, dataDir: '' }
      },
    } as unknown as Yolo
    const { ctx } = makeCtx(yolo)
    apply(ctx as never)

    yolo.observations.observeTurnStopping('work-1', 1, '/ws/alpha', false)
    yolo.observations.observeTurnStopping('yolo-w-abc123def456', 1, '/ws/beta', true)
    yolo.observations.observeTurnStopping('yolo-a-abc123def456', 1, '/ws/beta', true)

    const register = (ctx.webServer.register as ReturnType<typeof vi.fn>).mock.calls
      .find(([opts]) => opts.path === '/yolo/dashboard')![0] as { handler: (req: unknown, res: unknown) => Promise<void> }
    const res = { writeHead: vi.fn(), end: vi.fn() }
    void register.handler({}, res)

    const body = JSON.parse(String(res.end.mock.calls[0]?.[0]))
    expect(body.cwd).toBe('/ws/alpha')
  })

  it('falls back to the process cwd before any session ran', () => {
    const cwds: string[] = []
    const yolo = {
      ...mockYolo(),
      resolve: (c: string) => {
        cwds.push(c)
        return { scopeKey: 'test/main', db: {}, dataDir: '' }
      },
    } as unknown as Yolo
    const { ctx } = makeCtx(yolo)
    apply(ctx as never, undefined)

    const register = (ctx.webServer.register as ReturnType<typeof vi.fn>).mock.calls
      .find(([opts]) => opts.path === '/yolo/dashboard')![0] as { handler: (req: unknown, res: unknown) => Promise<void> }
    void register.handler({}, { writeHead: vi.fn(), end: vi.fn() })

    expect(cwds).toHaveLength(1)
    expect(cwds[0]).toBe(process.cwd())
  })
})
