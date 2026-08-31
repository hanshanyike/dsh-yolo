// YOLO domain and persisted-fact types. SQLite codecs consume these types;
// storage is no longer their owner.

import type { HistoryChangeSet } from '../contracts/history.ts'
export type { HistoryChangeSet, HistoryChangeValue, HistoryFieldChange } from '../contracts/history.ts'

export type MilestoneStatus = 'planned' | 'active' | 'done' | 'abandoned'
export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'cancelled'
export type TodoRecordStatus = 'canonical' | 'merged' | 'rejected'
export type TodoEvidenceSourceKind = 'human' | 'assistant_action' | 'panel_action' | 'extraction'
export type TodoEvidenceRelation = 'origin' | 'mention' | 'update' | 'correction' | 'completion_claim' | 'discussion'
export type TodoResolutionDecision = 'LINK' | 'UPDATE' | 'REOPEN' | 'NEW_OCCURRENCE' | 'CREATE' | 'ATTACH_STEP' | 'ASK' | 'NOOP'
export type GoalStatus = 'candidate' | 'active' | 'paused' | 'achieved' | 'abandoned'
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
  | 'todo_deleted'
  | 'goal_progress'
  | 'goal_status'
  | 'goal_updated'
  | 'milestone_status'
  | 'milestone_updated'
  | 'brief_generated'
  | 'attention_seen'
  | 'attention_suppressed'
  | 'attention_feedback'
  // M9 P34/P35: rejected-action audit + explicit todo merge
  | 'action_denied'
    | 'todo_consolidated'
    | 'todo_consolidation_undone'
    | 'todo_merge_suggestion_dismissed'
    | 'todo_identity_corrected'
/** Domain action applicable to a todo (M8 Organizer). reopen = undo of complete (5.4). */
export type TodoAction = 'start' | 'complete' | 'cancel' | 'postpone' | 'remind_again' | 'reopen'
export type ExtractionStrategy = 'rule' | 'llm'
export type ExtractionStatus = 'ok' | 'empty' | 'error'
export type ScopeMode = 'workspace' | 'user' | 'global'
export type RowType = 'todo' | 'milestone' | 'goal' | 'preference' | 'event'
export type HistorySubjectType = 'todo' | 'goal' | 'milestone'

/** Where a memory item came from — for audit + dedup. */
export type Source = 'rule' | 'llm' | 'tool' | 'manual' | 'legacy'

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

/** Stable-id candidate supplied to the extraction model's shadow resolver. */
export interface TodoIdentityCandidate {
  /** Canonical todo id. Merged aliases resolve to this id before leaving storage. */
  id: string
  title: string
  status: TodoStatus
  due_at?: string | null
  /** Matched historical titles that now resolve to this canonical todo. */
  aliases: string[]
  /** Search rank retained for deterministic ordering and offline evaluation. */
  rank: number
  /** Similarity fallback candidates are valid resolver evidence but cannot by
   * themselves authorize the narrower R2a automatic-write policy. */
  match_source?: 'similarity'
}

/** Provider-neutral resolver prediction. A prediction is evidence for the
 * deterministic application policy; it never authorizes a write by itself. */
export interface TodoResolutionPrediction {
  decision: TodoResolutionDecision
  candidate_ids: string[]
  proposed_title?: string | null
  confidence?: number | null
  reason?: string | null
}

/** Append-only observation from the non-mutating todo identity resolver. */
export interface TodoResolutionLog {
  id?: number
  scope_key: string
  session_id: string
  turn_seq: number
  operation_id: string
  input_fingerprint: string
  /** Bounded local-only excerpt used for manual resolver labeling. */
  input_excerpt: string
  resolver_version: string
  model_provider: string
  model_name: string
  status: 'ok' | 'empty' | 'error'
  error?: string | null
  candidates_json: string
  resolutions_json: string
  /** Deterministic R2 application-policy decision and durable outcome. */
  application_json?: string | null
  token_in?: number | null
  token_out?: number | null
  duration_ms?: number | null
  created_at: number
}

export type TodoIdentityFeedbackReason = 'wrong_item' | 'wrong_change' | 'other'
export type TodoIdentityUndoStatus = 'not_needed' | 'applied' | 'conflict'

/** Append-only user correction of one applied resolver decision. The original
 * resolution/evidence rows remain immutable and auditable. */
export interface TodoIdentityFeedback {
  id: string
  resolution_operation_id: string
  scope_key: string
  todo_id: string
  evidence_id: string
  verdict: 'incorrect'
  reason: TodoIdentityFeedbackReason
  undo_status: TodoIdentityUndoStatus
  due_before?: string | null
  due_after?: string | null
  created_at: number
}

export interface TodoIdentityReceipt {
  resolution_id: number
  operation_id: string
  todo_id: string
  decision: 'LINK' | 'UPDATE'
  application_status: 'linked' | 'updated' | 'no_change'
  confidence?: number | null
  reason?: string | null
  input_excerpt: string
  evidence_id: string
  due_before?: string | null
  due_after?: string | null
  created_at: number
  feedback?: TodoIdentityFeedback | null
}

/** Durable R3 merge operation. Snapshots and migrated relation ids make the
 * explicit user-confirmed merge reversible without rewriting old events. */
export interface TodoMergeRecord {
  id: string
  scope_key: string
  source_id: string
  target_id: string
  source_snapshot_json: string
  target_before_json: string
  target_after_json: string
  notification_ids_json: string
  reminder_ids_json: string
  status: 'active' | 'undone'
  created_at: number
  undone_at?: number | null
}

export interface Goal {
  id: string
  title: string
  description?: string | null
  progress: number // 0–100
  status: GoalStatus
  milestone_id?: string | null
  completion_criteria?: string | null
  target_date?: string | null
  next_review_at?: string | null
  next_todo_id?: string | null
  progress_note?: string | null
  progress_source?: GoalProgressSource
  scope_key: string
  source?: Source | null
  session_id?: string | null
  source_excerpt?: string | null
  source_turn?: number | null
  created_at: number
  updated_at: number
}

export type GoalProgressSource = 'user_claimed' | 'milestone_evidence' | 'legacy' | 'none'
export type GoalTodoRelation = 'support' | 'next'

export interface GoalTodoLink {
  goal_id: string
  todo_id: string
  relation: GoalTodoRelation
  is_primary: number
  created_at: number
}

export interface GoalMilestoneLink {
  goal_id: string
  milestone_id: string
  position: number
  created_at: number
}

export type GoalEvidenceSourceKind = TodoEvidenceSourceKind
export type GoalEvidenceRelation = 'origin' | 'mention' | 'update' | 'progress' | 'review'

export interface GoalEvidence {
  id: string
  goal_id: string
  source_scope_key: string
  session_id?: string | null
  turn_seq?: number | null
  source_kind: GoalEvidenceSourceKind
  relation: GoalEvidenceRelation
  excerpt?: string | null
  occurred_at: number
  source_fingerprint: string
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
  /** Stable product-object identity. Legacy/free-form events deliberately keep this null. */
  subject_type?: HistorySubjectType | null
  subject_id?: string | null
  /** Immutable label at event time, so later rename/delete never rewrites history. */
  subject_title?: string | null
  /** Optional second object for relations such as duplicate consolidation. */
  related_subject_type?: HistorySubjectType | null
  related_subject_id?: string | null
  related_subject_title?: string | null
  /** Structured field-level facts; summary remains the human-readable projection. */
  change?: HistoryChangeSet | null
}

export interface HistorySubjectStats {
  subject_type: HistorySubjectType
  subject_id: string
  change_count: number
  last_changed_at: number
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
  seen_at?: number | null
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

/** One canonical-todo near-duplicate pair (normalized-title collision) with both
 * rows' titles, so the memory-health surface can render and offer a merge. */
export interface DuplicateTodoPair {
  /** Owning scope; older payloads may omit it. */
  scopeKey?: string
  /** Suggested keeper id: the earliest-created canonical todo in the collision group. */
  a: string
  /** Duplicate id: a later canonical todo that shares the normalized title. */
  b: string
  aTitle: string
  bTitle: string
  /** Recommendation evidence only; never merge authorization. */
  confidence?: number
  reason?: string
  source?: 'resolver' | 'exact' | 'similarity'
}

export interface TodoMergeSuggestionFeedback {
  pair_key: string
  scope_key: string
  a_id: string
  b_id: string
  verdict: 'not_duplicate'
  reason?: string | null
  created_at: number
}
