import { describe, expect, it } from 'vitest'
import type { YoloBadgeNotification } from '../src/contracts/badge.ts'
import type { YoloDashboardData } from '../src/contracts/dashboard.ts'
import { findReminderTodo } from '../client/panel/controllers/use-notification-navigation.ts'
import { buildActionScopeIndex, withActionScope } from '../client/panel/kanban/use-kanban-actions.ts'

function dashboard(): YoloDashboardData {
  return {
    scopeKey: 'all',
    cwd: 'D:/fallback',
    at: 1,
    todos: [
      { id: 'same', title: '甲工作区事项', status: 'pending', scope_cwd: 'D:/a' },
      { id: 'same', title: '乙工作区事项', status: 'pending', scope_cwd: 'D:/b' },
      { id: 'unique', title: '唯一事项', status: 'pending', scope_cwd: 'D:/a' },
    ],
    goals: [], milestones: [], events: [], preferences: [], ledger: [],
    ledgerDay: '2026-08-30', ledgerSessions: 0, notifications: [], unhandled: 0,
  }
}

function reminder(overrides: Partial<YoloBadgeNotification> = {}): YoloBadgeNotification {
  return {
    id: 'notice-1', kind: 'reminder', title: '提醒', todo_id: 'same',
    scope_cwd: 'D:/b', created_at: 1, ...overrides,
  }
}

describe('panel use-case controllers', () => {
  it('routes unique rows to their workspace without guessing ambiguous ids', () => {
    const index = buildActionScopeIndex(dashboard())
    expect(index.get('unique')).toBe('D:/a')
    expect(index.get('same')).toBeNull()
    expect(withActionScope({ action: 'complete', kind: 'todo', id: 'unique' }, index))
      .toMatchObject({ scope_cwd: 'D:/a' })
    expect(withActionScope({ action: 'complete', kind: 'todo', id: 'same' }, index))
      .not.toHaveProperty('scope_cwd')
  })

  it('preserves an explicit action scope over inferred ownership', () => {
    const index = buildActionScopeIndex(dashboard())
    expect(withActionScope({
      action: 'complete', kind: 'todo', id: 'unique', scope_cwd: 'D:/manual',
    }, index)).toMatchObject({ scope_cwd: 'D:/manual' })
  })

  it('resolves a reminder by compound workspace and todo identity', () => {
    expect(findReminderTodo(dashboard(), reminder())?.title).toBe('乙工作区事项')
    expect(findReminderTodo(dashboard(), reminder({ scope_cwd: 'D:/missing' }))).toBeUndefined()
    expect(findReminderTodo(dashboard(), reminder({ kind: 'brief' }))).toBeUndefined()
  })
})
