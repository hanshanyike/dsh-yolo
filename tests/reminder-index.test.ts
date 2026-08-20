// M3/M5 reminder plugin wiring tests — session-start replay and turn-snapshot
// trigger, exercising the apply() registrations with a mocked context.

import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/reminder/index.ts'
import type Yolo from '../src/storage/index.ts'
import type { PendingReminder } from '../src/storage/types.ts'

type Handler = (...args: any[]) => void

function makeCtx(yolo: Yolo) {
  const handlers = new Map<string, Handler>()
  const ctx = {
    yolo,
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
    listPendingReminders: vi.fn(() => []),
    deletePendingReminder: vi.fn(),
    queueReminder: vi.fn(),
    writeSnapshot: vi.fn(() => '/tmp/snap.md'),
    ...over,
  } as unknown as Yolo
}

describe('reminder apply: session-start replay', () => {
  it('replays queued reminders into the new agent and clears them', () => {
    const pending: PendingReminder[] = [
      { id: 'r1', todo_id: 't1', fire_at: Date.now() - 100, payload: '⏰ 提醒: 交报告', scope_key: 's', },
      { id: 'r2', todo_id: 't2', fire_at: Date.now() - 50, payload: '⏰ 提醒: 开会', scope_key: 's', },
    ]
    const yolo = mockYolo({ listPendingReminders: vi.fn(() => pending) })
    const { ctx, handlers } = makeCtx(yolo)
    apply(ctx as never)

    const agent = { inject: vi.fn(), followup: vi.fn() }
    const onStart = handlers.get('agent/session-start')!
    onStart({ agent })

    expect(agent.inject).toHaveBeenCalledTimes(2)
    expect(agent.followup).toHaveBeenCalledTimes(2)
    expect(yolo.deletePendingReminder).toHaveBeenCalledTimes(2)
  })

  it('tolerates replay failures without crashing', () => {
    const pending: PendingReminder[] = [
      { id: 'r1', todo_id: 't1', fire_at: Date.now(), payload: '⏰ x', scope_key: 's', },
    ]
    const yolo = mockYolo({ listPendingReminders: vi.fn(() => pending) })
    const { ctx, handlers } = makeCtx(yolo)
    apply(ctx as never)

    const agent = { inject: vi.fn(() => { throw new Error('boom') }), followup: vi.fn() }
    const onStart = handlers.get('agent/session-start')!
    expect(() => onStart({ agent })).not.toThrow()
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
    for (let i = 0; i < 9; i++) onTurn()
    expect(yolo.writeSnapshot).not.toHaveBeenCalled()
    onTurn() // 10th
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
    for (let i = 0; i < 12; i++) onTurn()
    expect(yolo.writeSnapshot).not.toHaveBeenCalled()
  })
})
