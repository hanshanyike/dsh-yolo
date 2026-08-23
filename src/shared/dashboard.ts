// YOLO dashboard payload — the cross-boundary shape served by the host
// (ui plugin) at GET /yolo/dashboard and consumed by the browser bundle to
// render the sidebar dashboard. Shared so both halves stay in sync.

import { localDateStr } from './text.ts'
import type { DuplicateTodoPair } from '../storage/types.ts'

/** A workspace tag attached to aggregated rows (cross-workspace view, v0.3.0). */
export interface WorkspaceTag {
  /** Scope key (`sha1(cwd)/branch`) — stable, dedup anchor. */
  slug: string
  /** Human-friendly workspace name (e.g. the workspace folder's basename). */
  label: string
  /** Absolute workspace cwd — lets the panel route an action to the row's own scope. */
  cwd?: string
}

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
  /** v0.3.2 feedback track: times completed (good) vs cancelled (stale). */
  belief?: { good: number; stale: number }
  /** Owning workspace when aggregated across scopes (v0.3.0). */
  ws?: WorkspaceTag
}
export interface YoloGoalRow {
  id: string
  title: string
  status: string
  progress: number
  /** Owning milestone title (M8 plan view); null when unlinked. */
  milestone_title?: string | null
  /** Owning workspace when aggregated across scopes (v0.3.0). */
  ws?: WorkspaceTag
}
export interface YoloMilestoneRow {
  id: string
  title: string
  status: string
  target_date?: string | null
  /** Owning workspace when aggregated across scopes (v0.3.0). */
  ws?: WorkspaceTag
}
export interface YoloEventRow {
  id: string
  kind: string
  summary: string
  occurred_at: number
  /** Owning workspace when aggregated across scopes (v0.3.0). */
  ws?: WorkspaceTag
}
export interface YoloPreferenceRow {
  id: string
  key: string
  value: string
  /** Owning workspace when aggregated across scopes (v0.3.0). */
  ws?: WorkspaceTag
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
  /** Owning workspace when aggregated across scopes (v0.3.0). */
  ws?: WorkspaceTag
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
  /** Owning workspace when aggregated across scopes (v0.3.0). */
  ws?: WorkspaceTag
}

/** Memory-health snapshot (v0.3.0): recall/extraction quality + duplicate candidates. */
export interface YoloMemoryHealth {
  /** Semantic-recall LLM runs today (recall_log). */
  recallRunsToday: number
  /** Share of runs that produced expansions (0..1). */
  recallHitRate: number
  /** Semantic-recall LLM runs today that errored. */
  recallErrorsToday: number
  /** LLM extraction runs today that errored. */
  extractionErrorsToday: number
  /** Rejected actions today (action_denied). */
  deniedToday: number
  /** Open-todo near-duplicate candidate pairs (normalized title collision within scope). */
  duplicateTodos: DuplicateTodoPair[]
}/** Cross-workspace aggregate summary (v0.3.0). */
export interface YoloWorkspaceInfo {
  slug: string
  label: string
  /** Number of open todos contributed by this workspace. */
  count: number
}

/** Complete dashboard projection served by the host. */
export interface YoloDashboardData {
  scopeKey: string
  cwd: string
  at: number
  /** 'current' (default) or 'all' (cross-workspace aggregation, v0.3.0). */
  scope?: 'current' | 'all'
  /** Aggregate workspace list when scope === 'all'. */
  workspaces?: YoloWorkspaceInfo[]
  /** Number of workspaces in the aggregate view. */
  workspaceCount?: number
  /** Workspaces that failed to read in the aggregate view ("label: error"),
   *  present only when at least one was skipped (v0.3.3 review fix). */
  workspaceErrors?: string[]
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
  /** Memory-health snapshot (v0.3.0). */
  health?: YoloMemoryHealth
  /** Default number of focus rows to surface before folding (R9; 0 = show all). */
  focusDefaultCount?: number
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

