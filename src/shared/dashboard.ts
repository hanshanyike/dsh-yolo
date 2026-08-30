// YOLO dashboard payload — the cross-boundary shape served by the host
// (ui plugin) at GET /yolo/dashboard and consumed by the browser bundle to
// render the sidebar dashboard. Shared so both halves stay in sync.

import type { DuplicateTodoPair } from '../domain/types.ts'
export { isTodoOverdue } from './due.ts'

/** A workspace tag attached to aggregated rows (cross-workspace view, v0.3.0). */
export interface WorkspaceTag {
  /** Cwd-only scope key (`sha1(canonical cwd)/default`) — stable dedup anchor. */
  slug: string
  /** Human-friendly workspace name (e.g. the workspace folder's basename). */
  label: string
  /** Absolute workspace cwd — lets the panel route an action to the row's own scope. */
  cwd?: string
}

/** Structured provenance used by dashboard v2 instead of a display-only badge. */
export interface YoloItemSource {
  type: 'session' | 'manual' | 'tool' | 'legacy'
  label: string
  session_id?: string | null
  excerpt?: string | null
  /** Originating host turn when known. The current host navigation opens the session only. */
  turn?: number | null
  /** Item creation time; the host does not expose a separate source-message timestamp. */
  created_at?: number | null
  workspace?: WorkspaceTag
  /** What produced this evidence, independent from its navigation surface. */
  origin_kind?: 'human' | 'assistant_action' | 'panel_action' | 'extraction'
  /** Why this evidence is attached to the canonical todo. */
  relation?: 'origin' | 'mention' | 'update' | 'correction' | 'completion_claim' | 'discussion'
}

export type YoloAttentionReasonCode =
  | 'reminder_due'
  | 'overdue'
  | 'due_soon'
  | 'high_priority'
  | 'repeated_postpone'
  | 'stale'
  | 'milestone_risk'

export interface YoloAttentionEvidence {
  code: string
  label: string
  value?: string | number
}

/** One deterministic, server-ranked judgment candidate (dashboard v2). */
export interface YoloAttentionRow {
  /** Stable owner + todo key; a changed judgment is identified by its fingerprint. */
  id: string
  todo_id: string
  scope_cwd: string
  ws: WorkspaceTag
  score: number
  level: 'critical' | 'attention' | 'normal'
  reason_code: YoloAttentionReasonCode
  short_reason: string
  explanation: string
  evidence: YoloAttentionEvidence[]
  reason_version: string
  evidence_fingerprint: string
  seen_at?: number | null
  suppressed_until?: number | null
  feedback_reason?: string | null
  source?: YoloItemSource
}

export interface YoloDashboardSummary {
  open: number
  overdue: number
  dueToday: number
  completedToday: number
  changesToday: number
  partial: boolean
}

export interface YoloDashboardCapabilities {
  preferenceUndo: boolean
  notificationSeen: boolean
  sourceExcerpt: boolean
}

/** Compact row shapes (a projection of the storage rows, safe for serialization). */
export interface YoloTodoRow {
  id: string
  title: string
  detail?: string | null
  status: string
  priority?: string | null
  due_at?: string | null
  /** Owning milestone title (M8 plan view); null when unlinked. */
  milestone_title?: string | null
  /** Stable milestone facts used by the deterministic attention rules. */
  milestone_id?: string | null
  milestone_status?: string | null
  milestone_open_todo_count?: number
  /** Epoch ms of the last status/content change — powers the stale signal. */
  updated_at?: number
  /** Persisted creation time, used by provenance preview and stable ordering. */
  created_at?: number
  /** Epoch ms when the todo was completed — powers the「完成 HH:MM」due-slot (5.4). */
  completed_at?: number | null
  /** The shared due instant has passed and the todo is still open. */
  overdue?: boolean
  /** Still open but untouched for more than 7 days. */
  stale?: boolean
  /** Source badge label — the creating session's one-line summary (v0.3.0). */
  session_label?: string | null
  session_id?: string | null
  /** Structured dashboard-v2 provenance. */
  source?: YoloItemSource
  /** Immutable provenance entries, including sessions linked after creation. */
  sources?: YoloItemSource[]
  source_count?: number
  related_session_count?: number
  /** Owning cwd duplicated explicitly for action routing without parsing labels. */
  scope_cwd?: string
  /** Conservatively derived from auditable todo_postponed events. */
  postpone_count?: number
  /** Server-projected deterministic reason for secondary "需要关注" rows. */
  attention_reason?: {
    code: YoloAttentionReasonCode
    short_reason: string
    explanation: string
    evidence: YoloAttentionEvidence[]
    reason_version: string
    evidence_fingerprint: string
  }
  reminder?: {
    id?: string
    unhandled: boolean
    unhandled_count?: number
    last_fired_at?: number | null
    title?: string
    body?: string | null
  }
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
  seen?: boolean
  handled: boolean
  /** Owning cwd for routing notification actions in an aggregate projection. */
  scope_cwd?: string
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
  /** R3 canonical-todo duplicate suggestions (normalized title collision within scope). */
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
  /** Additive dashboard-v2 contract marker; old clients safely ignore it. */
  ui_contract_version?: 2
  /** 'current' (default) or 'all' (cross-workspace aggregation, v0.3.0). */
  scope?: 'current' | 'all'
  /** Aggregate workspace list when scope === 'all'. */
  workspaces?: YoloWorkspaceInfo[]
  /** Number of workspaces in the aggregate view. */
  workspaceCount?: number
  /** Workspaces that failed to read in the aggregate view ("label: error"),
   *  present only when at least one was skipped (v0.3.3 review fix). */
  workspaceErrors?: string[]
  /** At most one server-selected judgment in v2. */
  attention?: YoloAttentionRow[]
  summary?: YoloDashboardSummary
  capabilities?: YoloDashboardCapabilities
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
  /** Reminder-domain backlog count; retained separately from the unread badge. */
  unhandled: number
  /** Notification deliveries not viewed yet. Owns the header/sidebar badge. */
  unseen?: number
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
