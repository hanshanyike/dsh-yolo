import { describe, expect, it } from 'vitest'
import { dashboardSignature } from '../client/panel/YoloPanel.tsx'
import type { YoloDashboardData } from '../src/shared/dashboard.ts'

function dashboard(at: number): YoloDashboardData {
  return {
    scopeKey: 'scope/main',
    cwd: '/ws/project',
    at,
    todos: [{ id: 'todo-1', title: '发送访谈纪要', status: 'pending', updated_at: 1 }],
    goals: [],
    milestones: [],
    events: [],
    preferences: [],
    ledger: [],
    ledgerDay: '2026-08-23',
    ledgerSessions: 0,
    notifications: [],
    unhandled: 0,
  }
}

describe('dashboard refresh signature', () => {
  it('ignores response generation time when business data is unchanged', () => {
    expect(dashboardSignature(dashboard(1))).toBe(dashboardSignature(dashboard(2)))
  })

  it('changes for a real item transition', () => {
    const before = dashboard(1)
    const after = dashboard(2)
    after.todos = [{ ...after.todos[0]!, status: 'done', completed_at: 2 }]
    expect(dashboardSignature(after)).not.toBe(dashboardSignature(before))
  })
})
