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
  /** due_at is before today and the todo is still open. */
  overdue?: boolean
  /** Still open but untouched for more than 7 days. */
  stale?: boolean
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
