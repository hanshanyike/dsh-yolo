import type { YoloBadgeData, YoloBadgeNotification } from '../../src/shared/badge.ts'

/** Browser-run baseline for deciding whether a polled reminder is genuinely new. */
export interface ReminderObservationState {
  initialized: boolean
  unhandled: number
  maxCreatedAt: number
  /** Bounded id history protects repeated polls and equal-timestamp rows. */
  seenKeys: readonly string[]
}

export interface ReminderPopupCandidate {
  notification: YoloBadgeNotification
  /** Other new reminders in the bounded feed; rendered as one aggregate line. */
  additional: number
}

export interface ReminderObservation {
  state: ReminderObservationState
  popup?: ReminderPopupCandidate
}

export const INITIAL_REMINDER_OBSERVATION: ReminderObservationState = {
  initialized: false,
  unhandled: 0,
  maxCreatedAt: 0,
  seenKeys: [],
}

const MAX_SEEN_IDS = 64

function reminderKey(row: YoloBadgeNotification): string {
  return `${row.scope_cwd ?? ''}\u0000${row.id}`
}

/**
 * Turn a badge poll into an optional popup. The first successful poll is a
 * baseline, so reloads never replay the user's historical unread backlog.
 */
export function observeReminderBadge(
  previous: ReminderObservationState,
  data: YoloBadgeData,
): ReminderObservation {
  // A partial aggregate is not a trustworthy time baseline: a missing
  // workspace might contain a newer reminder and must be retried intact.
  if (data.partial) return { state: previous }

  const recent = (data.recentReminders ?? []).filter((row) => row.kind === 'reminder')
  const unseen = recent.filter((row) => (
    !previous.seenKeys.includes(reminderKey(row)) && row.created_at >= previous.maxCreatedAt
  ))
  const nextSeen = [...previous.seenKeys]
  for (const row of recent) {
    const key = reminderKey(row)
    if (!nextSeen.includes(key)) nextSeen.push(key)
  }
  const state: ReminderObservationState = {
    initialized: true,
    unhandled: Math.max(0, data.unhandled),
    maxCreatedAt: Math.max(previous.maxCreatedAt, ...recent.map((row) => row.created_at), 0),
    seenKeys: nextSeen.slice(-MAX_SEEN_IDS),
  }
  if (!previous.initialized || unseen.length === 0) return { state }
  const [latest] = unseen.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
  return {
    state,
    popup: {
      notification: latest,
      additional: unseen.length - 1,
    },
  }
}
