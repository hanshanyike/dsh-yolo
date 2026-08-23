// Scheduler lifecycle tests — interval ticking, error isolation, cleanup.

import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type Yolo from '../src/storage/index.ts'
import { inQuietWindow, runReminderTick, startReminderScheduler } from '../src/reminder/scheduler.ts'
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

describe('inQuietWindow (v0.3.2 quiet-hours gate)', () => {
  it('surfaces no window when start/end are empty or equal', () => {
    expect(inQuietWindow('10:00', '', '18:00')).toBe(false)
    expect(inQuietWindow('10:00', '10:00', '10:00')).toBe(false)
  })

  it('detects a same-day window', () => {
    expect(inQuietWindow('12:30', '12:00', '14:00')).toBe(true)
    expect(inQuietWindow('15:00', '12:00', '14:00')).toBe(false)
  })

  it('detects a window that wraps midnight', () => {
    expect(inQuietWindow('23:00', '22:00', '08:00')).toBe(true)
    expect(inQuietWindow('03:00', '22:00', '08:00')).toBe(true)
    expect(inQuietWindow('09:00', '22:00', '08:00')).toBe(false)
  })
})

describe('runReminderTick quiet-hours hold (v0.3.2)', () => {
  it('does not mark a due todo reminded while outside active hours', () => {
    const due = [{ id: 't1', title: '发演示稿', due_at: '2026-08-25', status: 'pending', scope_key: 's' }]
    const yolo = mockYolo({
      listDueTodos: vi.fn(() => due),
      addNotification: vi.fn(),
      addEvent: vi.fn(),
      setTodoReminded: vi.fn(),
    })
    const res = runReminderTick({
      yolo,
      cwd: () => '/tmp',
      aheadMs: 0,
      quiet: { enabled: true, start: '22:00', end: '08:00', now: () => new Date('2026-08-25T23:30:00') },
    })
    expect(res.notified).toBe(0)
    expect(yolo.addNotification).not.toHaveBeenCalled()
    expect(yolo.setTodoReminded).not.toHaveBeenCalled() // holds so it fires after the window
  })

  it('reminds normally during active hours', () => {
    const due = [{ id: 't1', title: '发演示稿', due_at: '2026-08-25', status: 'pending', scope_key: 's' }]
    const yolo = mockYolo({
      listDueTodos: vi.fn(() => due),
      setTodoReminded: vi.fn(),
    })
    const res = runReminderTick({
      yolo,
      cwd: () => '/tmp',
      aheadMs: 0,
      quiet: { enabled: true, start: '22:00', end: '08:00', now: () => new Date('2026-08-25T10:00:00') },
    })
    expect(res.notified).toBe(1)
    expect(yolo.setTodoReminded).toHaveBeenCalledTimes(1)
  })
})

