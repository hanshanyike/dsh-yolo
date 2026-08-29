import { describe, expect, it } from 'vitest'
import type { YoloBadgeData, YoloBadgeNotification } from '../src/shared/badge.ts'
import {
  INITIAL_REMINDER_OBSERVATION,
  observeReminderBadge,
} from '../client/sidebar/reminder-popup.ts'

function reminder(id: string, createdAt: number): YoloBadgeNotification {
  return { id, kind: 'reminder', title: `提醒 ${id}`, created_at: createdAt }
}

function badge(rows: YoloBadgeNotification[], unseen = rows.length): YoloBadgeData {
  return { unseen, unhandled: rows.length, recentNotifications: rows, recentReminders: rows.filter((row) => row.kind === 'reminder') }
}

describe('reminder popup observation', () => {
  it('uses the first complete poll as a baseline instead of replaying unread history', () => {
    const result = observeReminderBadge(INITIAL_REMINDER_OBSERVATION, badge([reminder('historical', 100)], 8))
    expect(result.popup).toBeUndefined()
    expect(result.state).toMatchObject({ initialized: true, unseen: 8, maxCreatedAt: 100 })
  })

  it('does not establish or advance a baseline from a partial aggregate', () => {
    const partial = observeReminderBadge(INITIAL_REMINDER_OBSERVATION, {
      ...badge([reminder('possibly-stale', 200)]),
      partial: true,
    })
    expect(partial).toEqual({ state: INITIAL_REMINDER_OBSERVATION })
  })

  it('surfaces the newest reminder once and aggregates other new rows', () => {
    const baseline = observeReminderBadge(INITIAL_REMINDER_OBSERVATION, badge([reminder('old', 100)])).state
    const nextData = badge([reminder('newest', 300), reminder('newer', 200), reminder('old', 100)])
    const next = observeReminderBadge(baseline, nextData)
    expect(next.popup).toEqual({ notification: reminder('newest', 300), additional: 1 })
    expect(observeReminderBadge(next.state, nextData).popup).toBeUndefined()
  })

  it('does not mistake an older reminder revealed after handling for a new arrival', () => {
    const baseline = observeReminderBadge(INITIAL_REMINDER_OBSERVATION, badge([reminder('latest', 200)])).state
    const afterHandled = observeReminderBadge(baseline, badge([reminder('older', 100)]))
    expect(afterHandled.popup).toBeUndefined()
  })

  it('accepts unseen equal-timestamp rows and surfaces brief deliveries', () => {
    const baseline = observeReminderBadge(INITIAL_REMINDER_OBSERVATION, badge([reminder('first', 200)])).state
    const brief: YoloBadgeNotification = { id: 'brief', kind: 'brief', title: '早报', created_at: 300 }
    const equalTimestamp = observeReminderBadge(baseline, badge([brief, reminder('second', 200), reminder('first', 200)]))
    expect(equalTimestamp.popup).toEqual({ notification: brief, additional: 1 })
  })

  it('deduplicates by workspace and id rather than a raw id alone', () => {
    const first = { ...reminder('shared-id', 200), scope_cwd: '/ws/a' }
    const second = { ...reminder('shared-id', 300), scope_cwd: '/ws/b' }
    const baseline = observeReminderBadge(INITIAL_REMINDER_OBSERVATION, badge([first])).state
    expect(observeReminderBadge(baseline, badge([second, first])).popup?.notification).toEqual(second)
  })

  it('surfaces a replacement delivery even when the total unseen count is unchanged', () => {
    const baseline = observeReminderBadge(INITIAL_REMINDER_OBSERVATION, badge([reminder('old', 100)], 3)).state
    const replacement = observeReminderBadge(baseline, badge([reminder('replacement', 200)], 3))
    expect(replacement.popup?.notification.id).toBe('replacement')
  })

  it('preserves the creation watermark across a complete empty response', () => {
    const baseline = observeReminderBadge(INITIAL_REMINDER_OBSERVATION, badge([reminder('old', 100)])).state
    const empty = observeReminderBadge(baseline, badge([]))
    expect(empty.popup).toBeUndefined()
    expect(empty.state.maxCreatedAt).toBe(100)
  })
})
