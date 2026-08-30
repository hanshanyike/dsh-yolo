import type { WorkspaceTag, YoloTodoRow } from '../../../src/shared/dashboard.ts'
import type { AttentionFeedbackReason } from '../../../src/contracts/actions.ts'
import { dueAtLocalDate, isTodoOverdue } from '../../../src/shared/due.ts'

export type JudgmentPresentation = 'full' | 'compact'

export type JudgmentActionIntent =
  | 'complete'
  | 'postpone_tomorrow'
  | 'discuss'
  | 'open_panel'

export type JudgmentFeedbackReason = AttentionFeedbackReason

export interface JudgmentEvidence {
  /** Stable server reason/evidence code; the client must not invent it. */
  code: string
  label: string
  value?: string | number | null
}

export interface JudgmentSource {
  type: 'session' | 'manual' | 'tool' | 'legacy'
  label: string
  sessionId?: string | null
  excerpt?: string | null
  workspace?: WorkspaceTag
}

/** Minimal v2-compatible todo projection while the server contract is landing. */
export interface YoloTodoRowV2 extends YoloTodoRow {
  detail?: string | null
  session_id?: string | null
  postpone_count?: number
  source?: JudgmentSource
}

export interface AssistantJudgmentView {
  id: string
  version: string
  evidenceFingerprint: string
  todo: YoloTodoRowV2
  presentation: JudgmentPresentation
  reason: string
  fullReason: string
  evidence: readonly JudgmentEvidence[]
  source?: JudgmentSource
  appearedAt?: number
  impact?: string
}

export type TaskActionIntent =
  | { type: 'complete' }
  | { type: 'postpone'; dueAt: string }
  | { type: 'discuss' }
  | { type: 'remind_again' }
  | { type: 'suppress' }
  | { type: 'feedback'; reason: JudgmentFeedbackReason }
  | { type: 'cancel' }
  | { type: 'delete' }

export interface TaskEditDraft {
  title: string
  dueAt: string
  priority: string
  milestone: string
  detail: string
}

export type LearningReceiptType =
  | 'state_change'
  | 'schedule_change'
  | 'reminder_reset'
  | 'feedback_count'
  | 'preference_change'
  | 'no_learning'

export type LearningScope = 'item' | 'workspace' | 'global'

/** Exact client projection of a successful server learning_receipt. */
export interface LearningReceiptData {
  type: LearningReceiptType
  summary: string
  scope: LearningScope
  before?: string | number | null
  after?: string | number | null
  preferenceId?: string
  reversible: boolean
  sourceAction?: string
  occurredAt?: number
}

export interface LearningReceiptView {
  summary: string
  scopeLabel: string
  before?: string | number | null
  after?: string | number | null
  reversible: boolean
  sourceAction?: string
  occurredAt?: number
}

export interface TodayTodoPartitions {
  attention: YoloTodoRowV2[]
  today: YoloTodoRowV2[]
  upcoming: YoloTodoRowV2[]
  completed: YoloTodoRowV2[]
  cancelled: YoloTodoRowV2[]
}

function localDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Tomorrow as a local calendar date, safe across month/year and DST boundaries. */
export function tomorrowLocalDate(now = new Date()): string {
  return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
}

function dueDate(row: YoloTodoRowV2): string | null {
  return dueAtLocalDate(row.due_at) ?? null
}

/**
 * Build mutually-exclusive Today surface lists and remove the highlighted todo
 * from every secondary active list. Input order remains the server order.
 */
export function partitionTodayTodos(
  rows: readonly YoloTodoRowV2[],
  highlightedTodoId?: string | null,
  now = new Date(),
): TodayTodoPartitions {
  const result: TodayTodoPartitions = {
    attention: [],
    today: [],
    upcoming: [],
    completed: [],
    cancelled: [],
  }
  const today = localDate(now)

  for (const row of rows) {
    if (row.status === 'cancelled') {
      result.cancelled.push(row)
      continue
    }
    if (row.status === 'done' || row.status === 'completed') {
      result.completed.push(row)
      continue
    }
    if (row.id === highlightedTodoId) continue

    const due = dueDate(row)
    if ((row.overdue ?? isTodoOverdue(row.due_at, row.status, now)) || row.stale === true) {
      result.attention.push(row)
    } else if (due === today) {
      result.today.push(row)
    } else {
      result.upcoming.push(row)
    }
  }

  return result
}

const SCOPE_LABELS: Record<LearningScope, string> = {
  item: '本事项',
  workspace: '本工作区',
  global: '所有工作区',
}

/**
 * A receipt view exists only when the server returned a receipt. This is the
 * client-side trust gate that prevents inferred “learned” claims.
 */
export function buildLearningReceiptView(
  receipt: LearningReceiptData | null | undefined,
): LearningReceiptView | null {
  if (!receipt) return null
  return {
    summary: receipt.summary,
    scopeLabel: SCOPE_LABELS[receipt.scope],
    before: receipt.before,
    after: receipt.after,
    reversible: receipt.reversible,
    sourceAction: receipt.sourceAction,
    occurredAt: receipt.occurredAt,
  }
}
