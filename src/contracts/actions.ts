import type { TodoRangeField } from '../shared/todo-range.ts'
import type { TodoIdentityFeedbackReason } from '../domain/types.ts'

export interface YoloActionRequest {
  action: string
  kind: string
  id?: string
  title?: string
  due_at?: string | null
  progress?: number
  status?: string
  note?: string
  priority?: string | null
  milestone_title?: string | null
  /** Goal management fields; optional to preserve older action payloads. */
  todo_id?: string
  milestone_id?: string
  position?: number
  is_primary?: boolean
  next_todo_id?: string | null
  relation?: 'support' | 'next'
  completion_criteria?: string | null
  target_date?: string | null
  next_review_at?: string | null
  detail?: string | null
  into_id?: string
  into_title?: string
  merge_id?: string
  session_id?: string
  session_turn?: number | null
  notif_kind?: string
  scope_cwd?: string
  client_action_id?: string
  reason_version?: string
  evidence_fingerprint?: string
  feedback_reason?: AttentionFeedbackReason
  resolution_id?: number
  identity_feedback_reason?: TodoIdentityFeedbackReason
  suppressed_until?: number
  range_field?: TodoRangeField
  range_from?: string
  range_to?: string
  confirmation?: string
}

export type AttentionFeedbackReason =
  | 'wrong_time'
  | 'not_important'
  | 'wrong_goal'
  | 'stale_signal_unhelpful'
  | 'other'

export interface YoloLearningReceipt {
  type: 'state_change' | 'schedule_change' | 'reminder_reset' | 'feedback_count' | 'preference_change' | 'no_learning'
  summary: string
  scope: 'item' | 'workspace' | 'global'
  before?: string | number | null
  after?: string | number | null
  preference_id?: string
  reversible: boolean
}

export interface YoloUndoDescriptor {
  action: string
  kind: string
  id: string
  due_at?: string | null
  merge_id?: string
  expires_at?: number
}

export type YoloActionOutcome =
  | {
      ok: true
      item: Record<string, unknown>
      audit_event_id?: string
      undo?: YoloUndoDescriptor
      learning_receipt?: YoloLearningReceipt
    }
  | { ok: false; error: string; code: string; httpStatus: 400 | 404 | 409 }
