// YOLO dashboard payload — the cross-boundary shape served by the host
// (ui plugin) at GET /yolo/dashboard and consumed by the browser bundle to
// render the sidebar dashboard. Shared so both halves stay in sync.

import { localDateStr } from './text.ts'

/** Compact row shapes (a projection of the storage rows, safe for serialization). */
export interface YoloTodoRow {
  id: string
  title: string
  status: string
  priority?: string | null
  due_at?: string | null
  /** Owning milestone title (M8 plan view); null when unlinked. */
  milestone_title?: string | null
  /** Epoch ms of the last status/content change — powers the stale signal. */
  updated_at?: number
  /** Epoch ms when the todo was completed — powers the「完成 HH:MM」due-slot (5.4). */
  completed_at?: number | null
  /** due_at is before today and the todo is still open. */
  overdue?: boolean
  /** Still open but untouched for more than 7 days. */
  stale?: boolean
  /** Source badge label — the creating session's one-line summary (v0.3.0). */
  session_label?: string | null
}
export interface YoloGoalRow {
  id: string
  title: string
  status: string
  progress: number
  /** Owning milestone title (M8 plan view); null when unlinked. */
  milestone_title?: string | null
}
export interface YoloMilestoneRow {
  id: string
  title: string
  status: string
  target_date?: string | null
}
export interface YoloEventRow {
  id: string
  kind: string
  summary: string
  occurred_at: number
}
export interface YoloPreferenceRow {
  id: string
  key: string
  value: string
}

/** One ledger line of a day (v0.3.0): event + resolved source badge. */
export interface YoloLedgerEntry {
  id: string
  kind: string
  summary: string
  detail?: string | null
  occurred_at: number
  /** Resolved badge text: session summary / 快速记一条 / 早期记录. */
  label: string
  /** Originating dsh session — the badge jumps to it when set (client only). */
  session_id?: string | null
}

/** Notification card / badge row (reminders & briefs, v0.3.0). */
export interface YoloNotificationRow {
  id: string
  kind: string
  title: string
  body?: string | null
  todo_id?: string | null
  created_at: number
  handled: boolean
}

/** Complete dashboard projection served by the host. */
export interface YoloDashboardData {
  scopeKey: string
  cwd: string
  at: number
  todos: YoloTodoRow[]
  goals: YoloGoalRow[]
  milestones: YoloMilestoneRow[]
  events: YoloEventRow[]
  preferences: YoloPreferenceRow[]
  /** Today's ledger (local day) with source badges, newest first (v0.3.0). */
  ledger: YoloLedgerEntry[]
  /** Ledger day in local "YYYY-MM-DD" — also the filter key for TC-4. */
  ledgerDay: string
  /** Distinct source sessions appearing in the ledger ("N 会话"). */
  ledgerSessions: number
  /** Notification cards for the panel top (newest first, handled included). */
  notifications: YoloNotificationRow[]
  /** Unhandled notification count — the sidebar badge number (TB-3). */
  unhandled: number
}

const DAY_MS = 86_400_000

/** A todo counts as open unless it reached a terminal status. */
export function isTodoOpen(status: string): boolean {
  return status !== 'done' && status !== 'completed' && status !== 'cancelled'
}

/** Overdue = open todo whose due date (date part) is before today (local time). */
export function isTodoOverdue(dueAt: string | null | undefined, status: string, now = new Date()): boolean {
  if (!dueAt || !isTodoOpen(status)) return false
  const due = dueAt.length > 10 ? dueAt.slice(0, 10) : dueAt
  return due < localDateStr(now)
}

/** Stale = open todo untouched for more than `staleDays` days (default 7). */
export function isTodoStale(status: string, updatedAt: number | undefined, nowMs = Date.now(), staleDays = 7): boolean {
  if (!isTodoOpen(status) || !updatedAt) return false
  return nowMs - updatedAt > staleDays * DAY_MS
}

/** Latest user-facing text of one row, for compact list rendering. */
export function todoSummary(row: YoloTodoRow): string {
  const parts = [row.title]
  if (row.due_at) parts.push(`截止 ${row.due_at}`)
  if (row.priority && row.priority !== 'normal') parts.push(`[${row.priority}]`)
  return parts.join(' ')
}
