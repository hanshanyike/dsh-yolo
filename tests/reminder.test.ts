// M3 reminder tests — scheduler tick logic with mocked storage/agent.

import { describe, it, expect, vi } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import { reminderText, runReminderTick } from '../src/reminder/scheduler.ts'
import type { Todo } from '../src/storage/types.ts'

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
    queueReminder: vi.fn(),
    setTodoReminded: vi.fn(),
  } as unknown as Yolo
}

describe('reminderText', () => {
  it('includes due date when present', () => {
    expect(reminderText('开会', '2026-08-21')).toContain('开会')
    expect(reminderText('开会', '2026-08-21')).toContain('2026-08-21')
    expect(reminderText('开会')).not.toContain('到期')
  })
})

describe('runReminderTick', () => {
  it('injects + followups when an agent is active', () => {
    const yolo = mockYolo([todo('t1', '交报告', '2026-08-21')])
    const agent = { inject: vi.fn(), followup: vi.fn() }
    const r = runReminderTick({ yolo, cwd: () => '/tmp', aheadMs: 60000, getLatestAgent: () => agent })
    expect(r.reminded).toBe(1)
    expect(r.queued).toBe(0)
    expect(agent.inject).toHaveBeenCalledTimes(1)
    expect(agent.followup).toHaveBeenCalledTimes(1)
    expect(yolo.setTodoReminded).toHaveBeenCalledWith('/tmp', 't1')
  })

  it('queues when no agent is active', () => {
    const yolo = mockYolo([todo('t1', '交报告'), todo('t2', '回复邮件')])
    const r = runReminderTick({ yolo, cwd: () => '/tmp', aheadMs: 60000, getLatestAgent: () => undefined })
    expect(r.queued).toBe(2)
    expect(r.reminded).toBe(0)
    expect(yolo.queueReminder).toHaveBeenCalledTimes(2)
    expect(yolo.setTodoReminded).toHaveBeenCalledTimes(2)
  })

  it('calls listDueTodos with a future-bound ISO timestamp', () => {
    const yolo = mockYolo([])
    runReminderTick({ yolo, cwd: () => '/tmp', aheadMs: 60000, getLatestAgent: () => undefined })
    const [cwd, iso] = (yolo.listDueTodos as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(cwd).toBe('/tmp')
    expect(new Date(iso).getTime()).toBeGreaterThan(Date.now() - 1000)
  })
})
