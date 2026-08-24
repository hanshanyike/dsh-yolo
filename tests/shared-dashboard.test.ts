// Shared dashboard payload tests — row projection shapes, the compact
// todo summary used by list rendering, and the M8 overdue/stale signals.

import { describe, expect, it } from 'vitest'
import { isTodoOverdue, isTodoStale, isTodoOpen, todoSummary, type YoloDashboardData } from '../src/shared/dashboard.ts'

describe('todoSummary', () => {
  it('renders title, due date and priority', () => {
    expect(todoSummary({ id: '1', title: '完成报告', status: 'pending', due_at: '2026-08-25', priority: 'high' }))
      .toBe('完成报告 截止 2026-08-25 [high]')
  })
  it('omits empty fields', () => {
    expect(todoSummary({ id: '2', title: '普通任务', status: 'pending' })).toBe('普通任务')
  })
  it('omits the normal priority tag', () => {
    expect(todoSummary({ id: '3', title: 'x', status: 'pending', priority: 'normal' })).toBe('x')
  })
})

describe('isTodoOpen', () => {
  it('treats pending/in_progress as open, terminal statuses as closed', () => {
    expect(isTodoOpen('pending')).toBe(true)
    expect(isTodoOpen('in_progress')).toBe(true)
    expect(isTodoOpen('done')).toBe(false)
    expect(isTodoOpen('completed')).toBe(false)
    expect(isTodoOpen('cancelled')).toBe(false)
  })
})

describe('isTodoOverdue (M8)', () => {
  it('flags open todos whose due date is before today', () => {
    const yesterday = new Date(Date.now() - 86_400_000)
    const y = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
    expect(isTodoOverdue(y, 'pending')).toBe(true)
  })
  it('today and future dates are not overdue', () => {
    const tomorrow = new Date(Date.now() + 86_400_000)
    const t = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
    expect(isTodoOverdue(t, 'pending')).toBe(false)
    expect(isTodoOverdue(null, 'pending')).toBe(false)
  })
  it('a past-due date on a closed todo is not overdue', () => {
    expect(isTodoOverdue('2000-01-01', 'done')).toBe(false)
    expect(isTodoOverdue('2000-01-01', 'cancelled')).toBe(false)
  })
  it('compares datetime strings at their exact local instant', () => {
    const now = new Date(2026, 7, 25, 10)
    expect(isTodoOverdue('2026-08-25T09:59:59', 'pending', now)).toBe(true)
    expect(isTodoOverdue('2026-08-25T10:00:01', 'pending', now)).toBe(false)
  })
})

describe('isTodoStale (M8)', () => {
  it('flags open todos untouched for more than 7 days', () => {
    const weekAgo = Date.now() - 8 * 86_400_000
    expect(isTodoStale('pending', weekAgo)).toBe(true)
    expect(isTodoStale('in_progress', weekAgo)).toBe(true)
  })
  it('recently touched or closed todos are not stale', () => {
    expect(isTodoStale('pending', Date.now() - 86_400_000)).toBe(false)
    expect(isTodoStale('done', Date.now() - 90 * 86_400_000)).toBe(false)
    expect(isTodoStale('pending', undefined)).toBe(false)
  })
  it('honors a custom stale window', () => {
    const twoDaysAgo = Date.now() - 2 * 86_400_000
    expect(isTodoStale('pending', twoDaysAgo, Date.now(), 1)).toBe(true)
    expect(isTodoStale('pending', twoDaysAgo, Date.now(), 7)).toBe(false)
  })
})

describe('YoloDashboardData serialization contract', () => {
  it('round-trips an empty payload', () => {
    const data: YoloDashboardData = {
      scopeKey: 'k', cwd: '/w', at: 1,
      todos: [], goals: [], milestones: [], events: [], preferences: [],
      ledger: [], ledgerDay: '2026-08-22', ledgerSessions: 0,
      notifications: [], unhandled: 0,
    }
    expect(JSON.parse(JSON.stringify(data))).toEqual(data)
  })

  it('round-trips M8 plan-context rows (milestone_title/overdue/stale)', () => {
    const data: YoloDashboardData = {
      scopeKey: 'k', cwd: '/w', at: 1,
      todos: [{ id: 't', title: 'x', status: 'pending', milestone_title: 'm', updated_at: 1, overdue: true, stale: false }],
      goals: [{ id: 'g', title: 'y', status: 'active', progress: 50, milestone_title: 'm' }],
      milestones: [], events: [], preferences: [],
      ledger: [{ id: 'e', kind: 'todo_completed', summary: '完成：x', occurred_at: 1, label: '会话摘要' }],
      ledgerDay: '2026-08-22', ledgerSessions: 1,
      notifications: [{ id: 'n', kind: 'reminder', title: '⏰ x', todo_id: 't', created_at: 1, handled: false }],
      unhandled: 1,
    }
    expect(JSON.parse(JSON.stringify(data))).toEqual(data)
  })
})
