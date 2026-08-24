import { describe, expect, it } from 'vitest'
import {
  compareDueAt,
  dueAtLocalDate,
  dueAtTimestamp,
  isDueAtReached,
  isTodoOverdue,
  parseDueAt,
} from '../src/shared/due.ts'
import { localDateStr } from '../src/shared/text.ts'

const NOW = new Date(2026, 7, 25, 10, 0, 0, 0)

describe('shared due semantics', () => {
  it('treats a date-only value as the end of its local calendar day', () => {
    const today = localDateStr(NOW)
    const parsed = parseDueAt(today)
    expect(parsed).toMatchObject({ kind: 'date', localDate: today })
    expect(new Date(parsed!.timestamp)).toEqual(new Date(2026, 7, 25, 23, 59, 59, 999))
    expect(isDueAtReached(today, new Date(2026, 7, 25, 23, 59, 59, 998))).toBe(false)
    expect(isDueAtReached(today, new Date(2026, 7, 25, 23, 59, 59, 999))).toBe(true)
    expect(isTodoOverdue(today, 'pending', new Date(2026, 7, 25, 23, 59, 59, 999))).toBe(false)
    expect(isTodoOverdue(today, 'pending', new Date(2026, 7, 26, 0, 0, 0, 0))).toBe(true)
  })

  it('parses a timezone-less datetime as an exact local wall-clock time', () => {
    expect(dueAtTimestamp('2026-08-25T09:59:59')).toBe(new Date(2026, 7, 25, 9, 59, 59).getTime())
    expect(isTodoOverdue('2026-08-25T09:59:59', 'pending', NOW)).toBe(true)
    expect(isTodoOverdue('2026-08-25T10:00:01', 'pending', NOW)).toBe(false)
  })

  it('honors Z and explicit offsets as absolute instants and derives their local day', () => {
    const before = new Date(NOW.getTime() - 1_000).toISOString()
    const after = new Date(NOW.getTime() + 1_000).toISOString()
    expect(isTodoOverdue(before, 'pending', NOW)).toBe(true)
    expect(isTodoOverdue(after, 'pending', NOW)).toBe(false)

    const localNextDay = new Date(2026, 7, 26, 0, 30)
    expect(dueAtLocalDate(localNextDay.toISOString())).toBe('2026-08-26')
    expect(dueAtTimestamp('2026-08-25T10:00:00+08:00')).toBe(Date.parse('2026-08-25T02:00:00Z'))
  })

  it('never marks terminal or invalid todos overdue', () => {
    for (const status of ['done', 'completed', 'cancelled']) {
      expect(isTodoOverdue('2000-01-01T00:00:00Z', status, NOW)).toBe(false)
    }
    expect(parseDueAt('2026-02-30')).toBeNull()
    expect(parseDueAt('not-a-date')).toBeNull()
    expect(isDueAtReached('not-a-date', NOW)).toBe(false)
  })

  it('sorts mixed due values by their actual instant', () => {
    const values = [
      '2026-08-25',
      '2026-08-25T11:00:00',
      new Date(2026, 7, 25, 9).toISOString(),
    ]
    expect([...values].sort(compareDueAt)).toEqual([values[2], values[1], values[0]])
  })
})
