import { describe, expect, it } from 'vitest'
import { formatDueLabel } from '../client/panel/due-label.ts'

describe('formatDueLabel', () => {
  const now = new Date(2026, 7, 25, 10, 30)

  it('shows today when extraction did not provide a date', () => {
    expect(formatDueLabel(null, now)).toBe('今天')
    expect(formatDueLabel(undefined, now)).toBe('今天')
  })

  it('keeps date-only values local and human readable', () => {
    expect(formatDueLabel('2026-08-25', now)).toBe('今天')
    expect(formatDueLabel('2026-08-26', now)).toBe('明天')
  })

  it('renders local and offset datetimes in the local clock without exposing ISO', () => {
    expect(formatDueLabel('2026-08-25T18:05:00', now)).toBe('今天 18:05')
    const offset = '2026-08-26T02:15:00+08:00'
    const label = formatDueLabel(offset, now)
    expect(label).not.toContain('T')
    expect(label).not.toContain('+08:00')
  })

  it('does not echo an invalid persisted value to the user', () => {
    expect(formatDueLabel('not-a-date', now)).toBe('截止时间待确认')
  })
})
