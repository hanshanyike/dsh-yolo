// v0.3.0 reminder plugin wiring tests — workspace tracking (session-start)
// and the turn-cadence snapshot trigger, exercising the apply() registrations
// with a mocked context. The old session-start REPLAY into work sessions is
// gone (D7/TB-1): reminders deliver only via the scheduler's YOLO-thread path.

import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/reminder/index.ts'
import type Yolo from '../src/storage/index.ts'
import { TurnObservationService } from '../src/runtime/turn-observation.ts'

type Handler = (...args: any[]) => void

function makeCtx(yolo: Yolo) {
  const handlers = new Map<string, Handler>()
  const ctx = {
    yolo,
    agents: {},
    logger: { info: vi.fn(), warn: vi.fn() },
    settings: {
      get: vi.fn(() => undefined),
    },
    on: (event: string, cb: Handler) => {
      handlers.set(event, cb)
      return () => handlers.delete(event)
    },
    effect: vi.fn(() => () => {}),
  }
  return { ctx, handlers }
}

function mockYolo(over: Partial<Yolo> = {}): Yolo {
  return {
    observations: new TurnObservationService(),
    conversations: {
      get: vi.fn(() => ({
        sessions: { ensure: vi.fn(async () => undefined) },
        threads: {},
      })),
    },
    listWorkspaceMeta: vi.fn(() => []),
    listPendingReminders: vi.fn(() => []),
    deletePendingReminder: vi.fn(),
    queueReminder: vi.fn(),
    writeSnapshot: vi.fn(() => '/tmp/snap.md'),
    ...over,
  } as unknown as Yolo
}

describe('reminder apply: workspace tracking (v0.3.0)', () => {
  it('tracks the workspace of work sessions for snapshot/reminder scoping', () => {
    const yolo = mockYolo()
    const { ctx, handlers } = makeCtx(yolo)
    ;(ctx.settings.get as ReturnType<typeof vi.fn>).mockReturnValue({
      storage: { snapshotInterval: 'every_10_turns' },
    })
    apply(ctx as never)

    yolo.observations.observeSession('work-1', '/ws/alpha', false)

    const onTurn = handlers.get('agent/turn-stopping')!
    for (let i = 1; i <= 10; i++) {
      const payload = { agent: { id: 'work-1', session: { header: { id: 's1', cwd: '/ws/alpha' } } }, turn: i }
      yolo.observations.observeTurnStopping('work-1', i, '/ws/alpha', false)
      onTurn(payload)
    }
    expect(yolo.writeSnapshot).toHaveBeenCalledWith('/ws/alpha', expect.any(String))
  })

  it('TB-5: YOLO resident threads never move the tracked workspace', () => {
    const yolo = mockYolo()
    const { ctx, handlers } = makeCtx(yolo)
    ;(ctx.settings.get as ReturnType<typeof vi.fn>).mockReturnValue({
      storage: { snapshotInterval: 'every_10_turns' },
    })
    apply(ctx as never)

    yolo.observations.observeSession('work-1', '/ws/alpha', false)
    yolo.observations.observeSession('yolo-w-abc123', '/ws/yolo', true)

    // v0.3.3 review regression: the turn-stopping path must skip YOLO threads
    // too — a reminder reply turn carries the thread's session (with a cwd),
    // and before the guard it moved latestCwd to the thread's workspace.
    const onTurn = handlers.get('agent/turn-stopping')!
    const yoloTurn = { agent: { id: 'yolo-w-abc123', session: { header: { id: 'y1', cwd: '/ws/yolo' } } } }
    for (let i = 1; i <= 10; i++) onTurn({ ...yoloTurn, turn: i })
    expect(yolo.writeSnapshot).not.toHaveBeenCalledWith('/ws/yolo', expect.any(String))
    expect(yolo.observations.latestWorkspaceCwd()).toBe('/ws/alpha')
  })
})

describe('reminder apply: turn-cadence snapshot', () => {
  it('writes a snapshot on the 10th turn when configured', () => {
    const yolo = mockYolo()
    const { ctx, handlers } = makeCtx(yolo)
    ;(ctx.settings.get as ReturnType<typeof vi.fn>).mockReturnValue({
      storage: { snapshotInterval: 'every_10_turns' },
    })
    apply(ctx as never)

    const onTurn = handlers.get('agent/turn-stopping')!
    for (let i = 1; i <= 9; i++) onTurn({ agent: { id: 'work-1' }, turn: i })
    expect(yolo.writeSnapshot).not.toHaveBeenCalled()
    onTurn({ agent: { id: 'work-1' }, turn: 10 })
    expect(yolo.writeSnapshot).toHaveBeenCalledTimes(1)
  })

  it('skips turn snapshots when the interval is daily', () => {
    const yolo = mockYolo()
    const { ctx, handlers } = makeCtx(yolo)
    ;(ctx.settings.get as ReturnType<typeof vi.fn>).mockReturnValue({
      storage: { snapshotInterval: 'daily' },
    })
    apply(ctx as never)

    const onTurn = handlers.get('agent/turn-stopping')!
    for (let i = 1; i <= 12; i++) onTurn({ agent: { id: 'work-1' }, turn: i })
    expect(yolo.writeSnapshot).not.toHaveBeenCalled()
  })
})
