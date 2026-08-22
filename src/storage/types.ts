// YOLO domain types — mirror src/storage/schema.sql tables.

export type MilestoneStatus = 'planned' | 'active' | 'done' | 'abandoned'
export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'cancelled'
export type GoalStatus = 'active' | 'achieved' | 'abandoned'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
// M8: state-flow kinds (todo_completed/postponed/…) have no CHECK constraint
// in schema.sql — the column is free-form by design.
export type EventKind =
  | 'note'
  | 'decision'
  | 'milestone_reached'
  | 'reminder_fired'
  | 'todo_created'
  | 'todo_completed'
  | 'todo_cancelled'
  | 'todo_postponed'
  | 'todo_remind_again'
  | 'todo_started'
  | 'todo_updated'
  | 'todo_reopened'
  | 'goal_progress'
  | 'goal_status'
  | 'milestone_status'
  | 'brief_generated'
/** Domain action applicable to a todo (M8 Organizer). reopen = undo of complete (5.4). */
export type TodoAction = 'start' | 'complete' | 'cancel' | 'postpone' | 'remind_again' | 'reopen'
export type ExtractionStrategy = 'rule' | 'llm'
export type ExtractionStatus = 'ok' | 'empty' | 'error'
export type ScopeMode = 'workspace' | 'user' | 'global'
export type RowType = 'todo' | 'milestone' | 'goal' | 'preference' | 'event'

/** Where a memory item came from — for audit + dedup. */
export type Source = 'rule' | 'llm' | 'tool' | 'manual'

export interface UserProfile {
  display_name?: string | null
  timezone?: string | null
  working_hours?: { start: string; end: string } | null
  traits?: string[]
  updated_at: number
}

export interface Milestone {
  id: string
  title: string
  description?: string | null
  target_date?: string | null
  status: MilestoneStatus
  scope_key: string
  source?: Source | null
  created_at: number
  updated_at: number
}

export interface Todo {
  id: string
  title: string
  detail?: string | null
  status: TodoStatus
  priority?: Priority | null
  due_at?: string | null
  milestone_id?: string | null
  scope_key: string
  dedup_key?: string | null
  source?: Source | null
  session_id?: string | null
  created_at: number
  updated_at: number
  completed_at?: number | null
  last_reminded_at?: number | null
}

export interface Goal {
  id: string
  title: string
  description?: string | null
  progress: number // 0–100
  status: GoalStatus
  milestone_id?: string | null
  scope_key: string
  created_at: number
  updated_at: number
}

export interface Preference {
  id: string
  key: string
  value: string
  confidence: number
  scope_key: string
  updated_at: number
}

export interface TimelineEvent {
  id: string
  kind: EventKind
  summary: string
  detail?: string | null
  session_id?: string | null
  source?: Source | null
  occurred_at: number
  scope_key: string
}

/** One-line summary of an originating dsh session (ledger source badge). */
export interface SessionSummary {
  session_id: string
  summary: string
  scope_key: string
  updated_at: number
}

export type NotificationKind = 'reminder' | 'brief'

/** Kanban notification card / badge source row (v0.3.0). */
export interface Notification {
  id: string
  kind: NotificationKind
  title: string
  body?: string | null
  todo_id?: string | null
  scope_cwd?: string | null
  created_at: number
  handled_at?: number | null
  scope_key: string
}

export interface ExtractionLog {
  id?: number
  session_id: string
  turn_seq: number
  strategy: ExtractionStrategy
  status: ExtractionStatus
  error?: string | null
  extracted_json?: string | null
  token_in?: number | null
  token_out?: number | null
  duration_ms?: number | null
  created_at: number
}

export interface PendingReminder {
  id: string
  todo_id?: string | null
  milestone_id?: string | null
  fire_at: number
  payload: string
  scope_key: string
  session_hint?: string | null
}

/** FTS search hit — joins yolo_fts rows back to their source table. */
export interface SearchHit {
  row_type: RowType
  row_id: string
  title: string
  body: string
  rank: number
}
