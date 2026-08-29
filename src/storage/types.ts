// YOLO domain types — mirror src/storage/schema.sql tables.

export type MilestoneStatus = 'planned' | 'active' | 'done' | 'abandoned'
export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'cancelled'
export type TodoRecordStatus = 'canonical' | 'merged' | 'rejected'
export type TodoEvidenceSourceKind = 'human' | 'assistant_action' | 'panel_action' | 'extraction'
export type TodoEvidenceRelation = 'origin' | 'mention' | 'update' | 'correction' | 'completion_claim' | 'discussion'
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
  | 'attention_seen'
  | 'attention_suppressed'
  | 'attention_feedback'
  // M9 P34/P35: rejected-action audit + explicit todo merge
  | 'action_denied'
  | 'todo_consolidated'
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
  /** Bounded excerpt of the direct user input that created this todo. */
  source_excerpt?: string | null
  /** Originating host turn. Null for manual/tool/legacy rows and older data. */
  source_turn?: number | null
  created_at: number
  updated_at: number
  completed_at?: number | null
  last_reminded_at?: number | null
  /** v0.3.2 feedback: times the user completed it (good) vs cancelled it (stale). */
  good_count?: number
  stale_count?: number
  /** Record identity state, independent from the user-facing business status. */
  record_status?: TodoRecordStatus
  /** Canonical record when this row is a merged historical alias. */
  merged_into_id?: string | null
}

/** Immutable evidence connecting a todo record to a session, turn or action. */
export interface TodoEvidence {
  id: string
  todo_id: string
  source_scope_key: string
  session_id?: string | null
  turn_seq?: number | null
  source_kind: TodoEvidenceSourceKind
  relation: TodoEvidenceRelation
  excerpt?: string | null
  occurred_at: number
  source_fingerprint: string
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
  /** Epoch ms when this value became current (R14 time-validity). */
  valid_at?: number | null
  /** Epoch ms when a newer value superseded this one (null = current). */
  invalid_at?: number | null
  /** Originating dsh session (provenance, R14). */
  session_id?: string | null
}

/** Append-only provenance trail for preference supersessions (R14). Each row
 * records a value that was current for a window, so future readers can answer
 * "what did we believe before, and which session said it". */
export interface PreferenceHistory {
  id: string
  key: string
  value: string
  scope_key: string
  session_id: string | null
  valid_at: number
  invalid_at: number | null
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

/** Persisted trust state for one immutable assistant-judgment version. */
export interface AttentionFeedback {
  scope_key: string
  todo_id: string
  reason_version: string
  evidence_fingerprint: string
  seen_at?: number | null
  suppressed_until?: number | null
  feedback_reason?: string | null
  created_at: number
  updated_at: number
}

/** Durable action outcome used for cross-restart idempotency. */
export interface ClientActionRecord {
  scope_key: string
  client_action_id: string
  request_hash: string
  outcome_json: string
  created_at: number
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

/** One semantic-recall observation (v0.3.0): what the model expanded / re-ranked and what was injected. */
export interface RecallLog {
  id?: number
  scope_key: string
  session_id?: string | null
  query: string
  /** JSON stringified string[] of LLM-generated equivalent queries. */
  expansions?: string | null
  /** JSON stringified string[] of injected keys (`row_type:row_id`). */
  kept_keys?: string | null
  /** JSON stringified Record<key, reason> for dropped candidates. */
  drop_reasons?: string | null
  /** JSON stringified array of { key, keep, reason } from the rerank pass. */
  rerank_outcome?: string | null
  latency_ms?: number | null
  source: 'user' | 'system'
  status: 'ok' | 'empty' | 'error'
  error?: string | null
  created_at: number
}

/** One open-todo near-duplicate pair (normalized-title collision) with both
 * rows' titles, so the memory-health surface can render and offer a merge. */
export interface DuplicateTodoPair {
  /** Keeper id: the earliest-created open todo in the collision group. */
  a: string
  /** Duplicate id: a later open todo that shares the normalized title. */
  b: string
  aTitle: string
  bTitle: string
}
