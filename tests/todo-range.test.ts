import { describe, expect, it } from 'vitest'
import {
  isLocalDateValue,
  matchesTodoRange,
  selectTodosInRange,
  validateTodoRange,
} from '../src/shared/todo-range.ts'

const created = new Date(2026, 7, 29, 10).getTime()

describe('todo date-range semantics', () => {
  it('validates real local dates and inclusive ordered ranges', () => {
    expect(isLocalDateValue('2026-08-29')).toBe(true)
    expect(isLocalDateValue('2026-02-30')).toBe(false)
    expect(validateTodoRange({ field: 'due_at', from: '2026-08-29', to: '2026-08-29' })).toBeNull()
    expect(validateTodoRange({ field: 'created_at', from: '2026-08-30', to: '2026-08-29' })).toContain('on or before')
  })

  it('uses shared due semantics for date-only, local and offset datetimes', () => {
    const selector = { field: 'due_at' as const, from: '2026-08-29', to: '2026-08-30' }
    expect(matchesTodoRange({ status: 'pending', created_at: created, due_at: '2026-08-29' }, selector)).toBe(true)
    expect(matchesTodoRange({ status: 'pending', created_at: created, due_at: '2026-08-30T16:00:00+08:00' }, selector)).toBe(true)
    expect(matchesTodoRange({ status: 'pending', created_at: created, due_at: null }, selector)).toBe(false)
  })

  it('cancels only open canonical rows but allows permanent deletion of terminal rows', () => {
    const rows = [
      { id: 'open', status: 'pending', record_status: 'canonical', due_at: '2026-08-29', created_at: created },
      { id: 'done', status: 'done', record_status: 'canonical', due_at: '2026-08-29', created_at: created },
      { id: 'merged', status: 'pending', record_status: 'merged', due_at: '2026-08-29', created_at: created },
    ]
    const selector = { field: 'due_at' as const, from: '2026-08-29', to: '2026-08-29' }
    expect(selectTodosInRange(rows, selector, 'bulk_cancel').map((row) => row.id)).toEqual(['open'])
    expect(selectTodosInRange(rows, selector, 'bulk_delete').map((row) => row.id)).toEqual(['open', 'done'])
  })

  it('matches creation date using the local calendar day', () => {
    expect(matchesTodoRange(
      { status: 'pending', created_at: created },
      { field: 'created_at', from: '2026-08-29', to: '2026-08-29' },
    )).toBe(true)
  })
})
