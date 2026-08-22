// Scheduler lifecycle tests — interval ticking, error isolation, cleanup.

import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type Yolo from '../src/storage/index.ts'
import { startReminderScheduler } from '../src/reminder/scheduler.ts'

function mockYolo(overrides: Partial<Record<keyof Yolo, unknown>> = {}) {
  return {
    listDueTodos: vi.fn(() => []),
    addNotification: vi.fn(),
    addEvent: vi.fn(),
    setTodoReminded: vi.fn(),
    lastSnapshotDate: vi.fn(() => new Date().toISOString().slice(0, 10)),
    writeSnapshot: vi.fn(),
    setSnapshotDate: vi.fn(),
    ...overrides,
  } as unknown as Yolo
}

function mockCtx(): Context {
  return { logger: { info: vi.fn(), warn: vi.fn() } } as unknown as Context
}

afterEach(() => {
  vi.useRealTimers()
})

describe('startReminderScheduler', () => {
  it('ticks on the configured interval and stops after cleanup', async () => {
    vi.useFakeTimers()
    const yolo = mockYolo()
    const cleanup = startReminderScheduler(mockCtx(), {
      yolo,
      cwd: () => '/tmp',
      intervalMs: 1000,
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(yolo.listDueTodos).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(yolo.listDueTodos).toHaveBeenCalledTimes(2)

    cleanup()
    await vi.advanceTimersByTimeAsync(3000)
    expect(yolo.listDueTodos).toHaveBeenCalledTimes(2)
  })

  it('isolates tick failures: a throwing tick does not kill the timer', async () => {
    vi.useFakeTimers()
    const yolo = mockYolo({ listDueTodos: vi.fn(() => { throw new Error('db down') }) })
    const ctx = mockCtx()
    const cleanup = startReminderScheduler(ctx, {
      yolo,
      cwd: () => '/tmp',
      intervalMs: 1000,
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect((ctx.logger.warn as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(1)
    // second tick still runs (timer survived the first failure)
    await vi.advanceTimersByTimeAsync(1000)
    expect(yolo.listDueTodos).toHaveBeenCalledTimes(2)
    cleanup()
  })
})
