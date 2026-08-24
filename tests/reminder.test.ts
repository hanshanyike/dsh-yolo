// M3/M5 reminder tests — scheduler tick + daily snapshot logic with mocked storage.

import { describe, it, expect, vi } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import { reminderText, runReminderTick, maybeWriteDailySnapshot, maybeWriteTurnSnapshot, resolveReminderRuntime } from '../src/reminder/scheduler.ts'
import type { Todo } from '../src/storage/types.ts'
import { DEFAULTS } from '../src/shared/constants.ts'
import { localDateStr } from '../src/shared/text.ts'

function todo(id: string, title: string, dueAt?: string): Todo {
  return {
    id,
    title,
    status: 'pending',
    scope_key: 'test/main',
    created_at: Date.now(),
    updated_at: Date.now(),
    due_at: dueAt ?? null,
  }
}

function mockYolo(todos: Todo[]) {
  return {
    listTodos: vi.fn(() => todos),
    addNotification: vi.fn(),
    addEvent: vi.fn(),
    setTodoReminded: vi.fn(),
    lastSnapshotDate: vi.fn(() => undefined),
    writeSnapshot: vi.fn(() => '/tmp/snap.md'),
    setSnapshotDate: vi.fn(),
  } as unknown as Yolo
}

describe('reminderText', () => {
  it('includes due date when present', () => {
    expect(reminderText('开会', '2026-08-21')).toContain('开会')
    expect(reminderText('开会', '2026-08-21')).toContain('2026-08-21')
    expect(reminderText('开会')).not.toContain('到期')
  })

  it('is human-readable only — no agent instructions leak into chat history', () => {
    const text = reminderText('交报告', '2026-08-21')
    expect(text).not.toContain('yolo_action')
    expect(text).not.toContain('待办 id')
    expect(text).not.toContain('请用')
    expect(text.split('\n')).toHaveLength(1)
  })
})

describe('runReminderTick', () => {
  it('writes a notification card + event and delivers into the YOLO thread (v0.3.0 B)', () => {
    const yolo = mockYolo([todo('t1', '交报告', '2026-08-21')])
    const deliver = vi.fn().mockResolvedValue(undefined)
    const r = runReminderTick({ yolo, cwd: () => '/tmp', aheadMs: 60000, deliver })
    expect(r.notified).toBe(1)
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(deliver.mock.calls[0][1]).toContain('交报告')
    expect(yolo.addNotification).toHaveBeenCalledWith('/tmp', expect.objectContaining({ kind: 'reminder', todo_id: 't1' }))
    expect(yolo.addEvent).toHaveBeenCalledWith('/tmp', expect.objectContaining({ kind: 'reminder_fired' }))
    expect(yolo.setTodoReminded).toHaveBeenCalledWith('/tmp', 't1')
  })

  it('TB-1: the card is the guaranteed surface — no deliver still notifies, nothing is queued for work sessions', () => {
    const yolo = mockYolo([todo('t1', '交报告', '2020-01-01'), todo('t2', '回复邮件', '2020-01-01T09:00:00')])
    const r = runReminderTick({ yolo, cwd: () => '/tmp', aheadMs: 60000 })
    expect(r.notified).toBe(2)
    expect(yolo.addNotification).toHaveBeenCalledTimes(2)
    expect(yolo.setTodoReminded).toHaveBeenCalledTimes(2)
  })

  it('keeps date-only today out while an earlier exact datetime is due', () => {
    const yolo = mockYolo([
      todo('quick', '快速记录', '2026-08-25'),
      todo('exact', '上午截止', '2026-08-25T09:59:59'),
    ])
    const result = runReminderTick({
      yolo,
      cwd: () => '/tmp',
      aheadMs: 0,
      now: () => new Date(2026, 7, 25, 10),
    })
    expect(result.notified).toBe(1)
    expect(yolo.listTodos).toHaveBeenCalledWith('/tmp')
    expect(yolo.setTodoReminded).toHaveBeenCalledWith('/tmp', 'exact')
  })
})

describe('maybeWriteDailySnapshot', () => {
  it('writes once per day and stamps the date', () => {
    const yolo = mockYolo([])
    const p1 = maybeWriteDailySnapshot(yolo, () => '/tmp')
    expect(p1).toBe('/tmp/snap.md')
    expect(yolo.writeSnapshot).toHaveBeenCalledTimes(1)
    expect(yolo.setSnapshotDate).toHaveBeenCalledTimes(1)
  })

  it('skips when already snapshotted today', () => {
    const yolo = mockYolo([])
    ;(yolo.lastSnapshotDate as ReturnType<typeof vi.fn>).mockReturnValue(localDateStr())
    const p = maybeWriteDailySnapshot(yolo, () => '/tmp')
    expect(p).toBeNull()
    expect(yolo.writeSnapshot).not.toHaveBeenCalled()
  })
})

describe('resolveReminderRuntime', () => {
  it('defaults aheadMin to 0 so "到点才提醒" is the default (R3)', () => {
    expect(resolveReminderRuntime().aheadMs).toBe(0)
    expect(DEFAULTS.reminderAheadMin).toBe(0)
  })

  it('accepts an explicit 0 lead and honors a positive lead (R3)', () => {
    expect(resolveReminderRuntime({ aheadMin: 0 }).aheadMs).toBe(0)
    expect(resolveReminderRuntime({ aheadMin: 30 }).aheadMs).toBe(1_800_000)
  })

  it('passes valid settings through', () => {
    expect(resolveReminderRuntime({ checkIntervalSec: 120, aheadMin: 30, enabled: true })).toEqual({
      intervalMs: 120_000,
      aheadMs: 1_800_000,
      enabled: true,
    })
  })

  it('falls back to DEFAULTS for a missing section or missing fields', () => {
    expect(resolveReminderRuntime()).toEqual({
      intervalMs: DEFAULTS.reminderCheckIntervalSec * 1000,
      aheadMs: DEFAULTS.reminderAheadMin * 60_000,
      enabled: true,
    })
    expect(resolveReminderRuntime({}).aheadMs).toBe(DEFAULTS.reminderAheadMin * 60_000)
    expect(resolveReminderRuntime({ enabled: false }).intervalMs).toBe(DEFAULTS.reminderCheckIntervalSec * 1000)
  })

  it('falls back to DEFAULTS on invalid values', () => {
    const r = resolveReminderRuntime({ checkIntervalSec: -10, aheadMin: Number.NaN })
    expect(r.intervalMs).toBe(DEFAULTS.reminderCheckIntervalSec * 1000)
    expect(r.aheadMs).toBe(DEFAULTS.reminderAheadMin * 60_000)
  })

  it('maps enabled=false so the reminder tick can go idle', () => {
    expect(resolveReminderRuntime({ enabled: false }).enabled).toBe(false)
    expect(resolveReminderRuntime({ enabled: true }).enabled).toBe(true)
    expect(resolveReminderRuntime({}).enabled).toBe(true)
  })
})

describe('maybeWriteTurnSnapshot', () => {
  it('writes at every Nth turn with a timestamped name', () => {
    const yolo = mockYolo([])
    ;(yolo.writeSnapshot as ReturnType<typeof vi.fn>).mockReturnValue('/tmp/turn-snap.md')
    const p = maybeWriteTurnSnapshot(yolo, () => '/tmp', 10)
    expect(p).toBe('/tmp/turn-snap.md')
    expect(yolo.writeSnapshot).toHaveBeenCalledTimes(1)
    const [cwd, dateStr] = (yolo.writeSnapshot as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(cwd).toBe('/tmp')
    expect(dateStr).toMatch(/^turn-10-/)
  })

  it('skips turns not on the cadence', () => {
    const yolo = mockYolo([])
    expect(maybeWriteTurnSnapshot(yolo, () => '/tmp', 9)).toBeNull()
    expect(yolo.writeSnapshot).not.toHaveBeenCalled()
  })
})
