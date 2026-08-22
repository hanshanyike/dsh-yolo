// Scheduler lifecycle tests — interval ticking, error isolation, cleanup.

import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type Yolo from '../src/storage/index.ts'
import { startReminderScheduler } from '../src/reminder/scheduler.ts'
import { localDateStr } from '../src/shared/text.ts'
import { DEFAULTS } from '../src/shared/constants.ts'

function mockYolo(overrides: Partial<Record<keyof Yolo, unknown>> = {}) {
  return {
    listDueTodos: vi.fn(() => []),
    addNotification: vi.fn(),
    addEvent: vi.fn(),
    setTodoReminded: vi.fn(),
    lastSnapshotDate: vi.fn(() => localDateStr()),
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

describe('startReminderScheduler: reminder config wiring (M9 P44)', () => {
  it('falls back to the DEFAULTS interval when intervalMs is not passed', async () => {
    vi.useFakeTimers()
    const yolo = mockYolo()
    const cleanup = startReminderScheduler(mockCtx(), { yolo, cwd: () => '/tmp' })

    await vi.advanceTimersByTimeAsync(DEFAULTS.reminderCheckIntervalSec * 1000 - 1)
    expect(yolo.listDueTodos).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(yolo.listDueTodos).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('reads aheadMs from the provider fresh on each tick', async () => {
    vi.useFakeTimers()
    const yolo = mockYolo()
    let aheadMs = 60_000
    const cleanup = startReminderScheduler(mockCtx(), {
      yolo,
      cwd: () => '/tmp',
      intervalMs: 1000,
      aheadMs: () => aheadMs,
    })

    await vi.advanceTimersByTimeAsync(1000)
    // localIso truncates to whole seconds, so allow ~1s of rounding slack
    const iso1 = (yolo.listDueTodos as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
    expect(new Date(iso1).getTime() - Date.now()).toBeGreaterThanOrEqual(59_000)
    expect(new Date(iso1).getTime() - Date.now()).toBeLessThan(61_000)

    aheadMs = 3_600_000
    await vi.advanceTimersByTimeAsync(1000)
    const iso2 = (yolo.listDueTodos as ReturnType<typeof vi.fn>).mock.calls[1][1] as string
    expect(new Date(iso2).getTime() - Date.now()).toBeGreaterThanOrEqual(3_599_000)
    expect(new Date(iso2).getTime() - Date.now()).toBeLessThan(3_601_000)
    cleanup()
  })

  it('reminderEnabled=false idles the due scan but keeps daily snapshots', async () => {
    vi.useFakeTimers()
    let snapshotted = false
    const yolo = mockYolo({
      lastSnapshotDate: vi.fn(() => (snapshotted ? localDateStr() : undefined)),
      writeSnapshot: vi.fn(() => {
        snapshotted = true
        return '/tmp/snap.md'
      }),
    })
    const cleanup = startReminderScheduler(mockCtx(), {
      yolo,
      cwd: () => '/tmp',
      intervalMs: 1000,
      reminderEnabled: () => false,
    })

    await vi.advanceTimersByTimeAsync(2000)
    expect(yolo.listDueTodos).not.toHaveBeenCalled()
    expect(yolo.writeSnapshot).toHaveBeenCalledTimes(1)
    cleanup()
  })
})

