// Shared dashboard payload tests — row projection shapes and the compact
// todo summary used by list rendering.

import { describe, expect, it } from 'vitest'
import { todoSummary, type YoloDashboardData } from '../src/shared/dashboard.ts'

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

describe('YoloDashboardData serialization contract', () => {
  it('round-trips an empty payload', () => {
    const data: YoloDashboardData = {
      scopeKey: 'k', cwd: '/w', at: 1,
      todos: [], goals: [], milestones: [], events: [], preferences: [],
    }
    expect(JSON.parse(JSON.stringify(data))).toEqual(data)
  })
})
