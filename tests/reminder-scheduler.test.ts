// Scheduler lifecycle tests — interval ticking, error isolation, cleanup.

import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type Yolo from '../src/storage/index.ts'
import { inQuietWindow, runReminderTick, startReminderScheduler } from '../src/reminder/scheduler.ts'
import { localDateStr } from '../src/shared/text.ts'
import { DEFAULTS } from '../src/shared/constants.ts'

function mockYolo(overrides: Partial<Record<keyof Yolo, unknown>> = {}) {
  return {
    listTodos: vi.fn(() => []),
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
    expect(yolo.listTodos).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(yolo.listTodos).toHaveBeenCalledTimes(2)

    cleanup()
    await vi.advanceTimersByTimeAsync(3000)
    expect(yolo.listTodos).toHaveBeenCalledTimes(2)
  })

  it('isolates tick failures: a throwing tick does not kill the timer', async () => {
    vi.useFakeTimers()
    const yolo = mockYolo({ listTodos: vi.fn(() => { throw new Error('db down') }) })
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
    expect(yolo.listTodos).toHaveBeenCalledTimes(2)
    cleanup()
  })
})

describe('startReminderScheduler: reminder config wiring (M9 P44)', () => {
  it('falls back to the DEFAULTS interval when intervalMs is not passed', async () => {
    vi.useFakeTimers()
    const yolo = mockYolo()
    const cleanup = startReminderScheduler(mockCtx(), { yolo, cwd: () => '/tmp' })

    await vi.advanceTimersByTimeAsync(DEFAULTS.reminderCheckIntervalSec * 1000 - 1)
    expect(yolo.listTodos).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(yolo.listTodos).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('reads aheadMs from the provider fresh on each tick', async () => {
    const now = new Date(2026, 7, 25, 10)
    vi.useFakeTimers({ now })
    const dueSoon = {
      id: 'soon', title: '提交材料', due_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
      status: 'pending', scope_key: 's', created_at: now.getTime(), updated_at: now.getTime(), last_reminded_at: null,
    }
    const yolo = mockYolo({ listTodos: vi.fn(() => [dueSoon]) })
    let aheadMs = 60_000
    const cleanup = startReminderScheduler(mockCtx(), {
      yolo,
      cwd: () => '/tmp',
      intervalMs: 1000,
      aheadMs: () => aheadMs,
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(yolo.addNotification).not.toHaveBeenCalled()

    aheadMs = 3_600_000
    await vi.advanceTimersByTimeAsync(1000)
    expect(yolo.addNotification).toHaveBeenCalledTimes(1)
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
    expect(yolo.listTodos).not.toHaveBeenCalled()
    expect(yolo.writeSnapshot).toHaveBeenCalledTimes(1)
    cleanup()
  })
})

describe('startReminderScheduler: multi-workspace scan (v0.3.3 review fix)', () => {
  it('scans every known workspace each tick, not just the latest cwd', async () => {
    vi.useFakeTimers()
    const yolo = mockYolo()
    const cleanup = startReminderScheduler(mockCtx(), {
      yolo,
      cwd: () => '/ws/latest',
      intervalMs: 1000,
      workspaces: () => [{ cwd: '/ws/a' }, { cwd: '/ws/b' }],
    })

    await vi.advanceTimersByTimeAsync(1000)
    const cwds = (yolo.listTodos as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(cwds).toContain('/ws/a')
    expect(cwds).toContain('/ws/b')
    cleanup()
    await vi.advanceTimersByTimeAsync(1000)
    expect((yolo.listTodos as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === '/ws/a')).toHaveLength(1)
  })

  it('an empty workspaces list falls back to the single tracked cwd', async () => {
    vi.useFakeTimers()
    const yolo = mockYolo()
    const cleanup = startReminderScheduler(mockCtx(), {
      yolo,
      cwd: () => '/ws/only',
      intervalMs: 1000,
      workspaces: () => [],
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(yolo.listTodos).toHaveBeenCalledWith('/ws/only')
    cleanup()
  })

  it('one broken workspace does not block the others in the same tick', async () => {
    vi.useFakeTimers()
    const ctx = mockCtx()
    const yolo = mockYolo({
      listTodos: vi.fn((cwd: string) => {
        if (cwd === '/ws/bad') throw new Error('database locked')
        return []
      }),
    })
    const cleanup = startReminderScheduler(ctx, {
      yolo,
      cwd: () => '/ws/latest',
      intervalMs: 1000,
      workspaces: () => [{ cwd: '/ws/good' }, { cwd: '/ws/bad' }],
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(yolo.listTodos).toHaveBeenCalledWith('/ws/good')
    expect((ctx.logger.warn as ReturnType<typeof vi.fn>).mock.calls.some((c) => c[1] === '/ws/bad')).toBe(true)
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
      listTodos: vi.fn(() => due),
      addNotification: vi.fn(),
      addEvent: vi.fn(),
      setTodoReminded: vi.fn(),
    })
    const res = runReminderTick({
      yolo,
      cwd: () => '/tmp',
      aheadMs: 0,
      now: () => new Date('2026-08-26T00:00:00'),
      quiet: { enabled: true, start: '22:00', end: '08:00', now: () => new Date('2026-08-25T23:30:00') },
    })
    expect(res.notified).toBe(0)
    expect(yolo.addNotification).not.toHaveBeenCalled()
    expect(yolo.setTodoReminded).not.toHaveBeenCalled() // holds so it fires after the window
  })

  it('reminds normally during active hours', () => {
    const due = [{ id: 't1', title: '发演示稿', due_at: '2026-08-25', status: 'pending', scope_key: 's' }]
    const yolo = mockYolo({
      listTodos: vi.fn(() => due),
      setTodoReminded: vi.fn(),
    })
    const res = runReminderTick({
      yolo,
      cwd: () => '/tmp',
      aheadMs: 0,
      now: () => new Date('2026-08-26T10:00:00'),
      quiet: { enabled: true, start: '22:00', end: '08:00', now: () => new Date('2026-08-25T10:00:00') },
    })
    expect(res.notified).toBe(1)
    expect(yolo.setTodoReminded).toHaveBeenCalledTimes(1)
  })

  it('filters mixed due formats by one exact cutoff and ignores terminal or reminded rows', () => {
    const now = new Date(2026, 7, 25, 10)
    const rows = [
      { id: 'date-today', title: '今天的快速记录', due_at: '2026-08-25', status: 'pending', scope_key: 's' },
      { id: 'local-past', title: '本地上午截止', due_at: '2026-08-25T09:59:59', status: 'pending', scope_key: 's' },
      { id: 'z-past', title: '绝对时刻截止', due_at: new Date(now.getTime() - 1_000).toISOString(), status: 'pending', scope_key: 's' },
      { id: 'offset-future', title: '稍后截止', due_at: new Date(now.getTime() + 1_000).toISOString(), status: 'pending', scope_key: 's' },
      { id: 'done', title: '已经完成', due_at: '2020-01-01', status: 'done', scope_key: 's' },
      { id: 'reminded', title: '已经提醒', due_at: '2020-01-01', status: 'pending', scope_key: 's', last_reminded_at: 1 },
    ]
    const yolo = mockYolo({ listTodos: vi.fn(() => rows) })

    const result = runReminderTick({ yolo, cwd: () => '/tmp', aheadMs: 0, now: () => now })

    expect(result.notified).toBe(2)
    expect((yolo.setTodoReminded as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1]))
      .toEqual(['local-past', 'z-past'])
  })

  it('keeps quick-add date-only todos quiet across ticks, then fires exactly once at day end', () => {
    const row = {
      id: 'quick', title: '把演示稿发给研发', due_at: '2026-08-25', status: 'pending', scope_key: 's',
      last_reminded_at: null as number | null,
    }
    const yolo = mockYolo({
      listTodos: vi.fn(() => [row]),
      setTodoReminded: vi.fn((_cwd: string, id: string) => {
        if (id === row.id) row.last_reminded_at = Date.now()
      }),
    })

    expect(runReminderTick({ yolo, cwd: () => '/tmp', aheadMs: 0, now: () => new Date(2026, 7, 25, 12) }).notified).toBe(0)
    expect(runReminderTick({ yolo, cwd: () => '/tmp', aheadMs: 0, now: () => new Date(2026, 7, 25, 23, 59, 59, 998) }).notified).toBe(0)
    expect(runReminderTick({ yolo, cwd: () => '/tmp', aheadMs: 0, now: () => new Date(2026, 7, 25, 23, 59, 59, 999) }).notified).toBe(1)
    expect(runReminderTick({ yolo, cwd: () => '/tmp', aheadMs: 0, now: () => new Date(2026, 7, 26, 0, 5) }).notified).toBe(0)
    expect(yolo.addNotification).toHaveBeenCalledTimes(1)
    expect(yolo.setTodoReminded).toHaveBeenCalledTimes(1)
  })
})
