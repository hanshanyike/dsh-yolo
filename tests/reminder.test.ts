// M3/M5 reminder tests — scheduler tick + daily snapshot logic with mocked storage.

import { describe, it, expect, vi } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import { reminderText, runReminderTick, maybeWriteDailySnapshot, maybeWriteTurnSnapshot } from '../src/reminder/scheduler.ts'
import type { Todo } from '../src/storage/types.ts'
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
    listDueTodos: vi.fn(() => todos),
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

  it('with an id it is reply-able: carries the id and yolo_action routing (M8)', () => {
    const text = reminderText('交报告', '2026-08-21', 'todo-123')
    expect(text).toContain('待办 id: todo-123')
    expect(text).toContain('yolo_action')
    expect(text).toContain('complete')
    expect(text).toContain('postpone')
    expect(text).toContain('remind_again')
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
    const yolo = mockYolo([todo('t1', '交报告'), todo('t2', '回复邮件')])
    const r = runReminderTick({ yolo, cwd: () => '/tmp', aheadMs: 60000 })
    expect(r.notified).toBe(2)
    expect(yolo.addNotification).toHaveBeenCalledTimes(2)
    expect(yolo.setTodoReminded).toHaveBeenCalledTimes(2)
  })

  it('calls listDueTodos with a future-bound ISO timestamp', () => {
    const yolo = mockYolo([])
    runReminderTick({ yolo, cwd: () => '/tmp', aheadMs: 60000 })
    const [cwd, iso] = (yolo.listDueTodos as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(cwd).toBe('/tmp')
    expect(new Date(iso).getTime()).toBeGreaterThan(Date.now() - 1000)
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
