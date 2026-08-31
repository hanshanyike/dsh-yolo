// YOLO action request — the shared contract for in-place plan operations.
// One validation + dispatch path serves all three entrances (M8): the
// yolo_action model tool, the extraction update applier, and the dashboard
// POST /yolo/actions endpoint, so behavior and audit stay identical.
// v0.3.0 adds the panel's edit surface (E): update / rename / abandon /
// quick_add / handled, plus todo delete (= cancel, TE-6 audit semantics).
// M9 P34: every denial also leaves an action_denied audit event.

import type Yolo from '../../storage/index.ts'
import type { GoalStatus, MilestoneStatus, Priority, TimelineEvent, Todo, TodoAction } from '../../domain/types.ts'
import { createHash } from 'node:crypto'
import { localDateStr } from '../../shared/text.ts'
import { todoEvidenceFingerprint } from '../../shared/todo-identity.ts'
import { buildDashboardData } from '../read-models/dashboard.ts'
import { validateTodoRange, type TodoRangeField, type TodoRangeSelector } from '../../shared/todo-range.ts'
import type {
  AttentionFeedbackReason,
  YoloActionOutcome,
  YoloActionRequest,
  YoloLearningReceipt,
} from '../../contracts/actions.ts'
import type { HistoryChangeSet } from '../../contracts/history.ts'
import type { TodoIdentityFeedbackReason } from '../../domain/types.ts'
import type { ScopeRef } from '../../domain/scope.ts'
export type {
  AttentionFeedbackReason,
  YoloActionOutcome,
  YoloActionRequest,
  YoloLearningReceipt,
  YoloUndoDescriptor,
} from '../../contracts/actions.ts'

const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'urgent']

const TODO_ACTIONS: readonly TodoAction[] = ['complete', 'start', 'cancel', 'postpone', 'remind_again', 'reopen']
const MILESTONE_STATUSES: readonly MilestoneStatus[] = ['planned', 'active', 'done', 'abandoned']
const GOAL_STATUSES: readonly GoalStatus[] = ['candidate', 'active', 'paused', 'achieved', 'abandoned']

function toPriority(v: unknown): Priority | null | undefined {
  if (v === null || v === '') return null
  if (typeof v !== 'string' || !PRIORITIES.includes(v as Priority)) return undefined
  return v as Priority
}

const ATTENTION_FEEDBACK_REASONS = [
  'wrong_time',
  'not_important',
  'wrong_goal',
  'stale_signal_unhelpful',
  'other',
] as const satisfies readonly AttentionFeedbackReason[]
const IDENTITY_FEEDBACK_REASONS = ['wrong_item', 'wrong_change', 'other'] as const satisfies readonly TodoIdentityFeedbackReason[]

function latestAuditFor(yolo: Yolo, cwd: string, action: string, startedAt: number): TimelineEvent | undefined {
  const expected: Partial<Record<TodoAction, string>> = {
    complete: 'todo_completed',
    cancel: 'todo_cancelled',
    postpone: 'todo_postponed',
    remind_again: 'todo_remind_again',
    reopen: 'todo_reopened',
    start: 'todo_started',
  }
  const kind = expected[action as TodoAction]
  if (!kind) return undefined
  return yolo.listEvents?.(cwd, 1)?.find((event) => event.kind === kind && event.occurred_at >= startedAt)
}

function todoSuccessOutcome(action: string, before: Todo | null, after: Todo, audit?: TimelineEvent): YoloActionOutcome {
  const base = {
    ok: true as const,
    item: after as unknown as Record<string, unknown>,
    ...(audit ? { audit_event_id: audit.id } : {}),
  }
  const unchanged = before != null && (
    (action === 'postpone' && before.due_at === after.due_at)
    || (action === 'remind_again' && before.last_reminded_at === after.last_reminded_at)
    || ((action === 'complete' || action === 'cancel' || action === 'reopen' || action === 'start') && before.status === after.status)
  )
  if (unchanged) {
    return {
      ...base,
      learning_receipt: { type: 'no_learning', summary: '事项状态未变化；未改变提醒偏好', scope: 'item', reversible: false },
    }
  }
  if (action === 'complete') {
    return {
      ...base,
      undo: { action: 'reopen', kind: 'todo', id: after.id, expires_at: Date.now() + 4_000 },
      learning_receipt: {
        type: 'state_change', summary: '已标记完成', scope: 'item', before: before?.status ?? null, after: after.status, reversible: true,
      },
    }
  }
  if (action === 'postpone') {
    return {
      ...base,
      undo: { action: 'update', kind: 'todo', id: after.id, due_at: before?.due_at ?? null, expires_at: Date.now() + 4_000 },
      learning_receipt: {
        type: 'schedule_change', summary: `已推迟到 ${after.due_at ?? '未设置日期'}`, scope: 'item',
        before: before?.due_at ?? null, after: after.due_at ?? null, reversible: true,
      },
    }
  }
  if (action === 'remind_again') {
    return {
      ...base,
      learning_receipt: {
        type: 'reminder_reset', summary: '已允许再次提醒；未改变提醒偏好', scope: 'item',
        before: before?.last_reminded_at ?? null, after: after.last_reminded_at ?? null, reversible: false,
      },
    }
  }
  if (action === 'cancel') {
    return {
      ...base,
      learning_receipt: {
        type: 'feedback_count', summary: '已取消事项；未改变提醒偏好', scope: 'item',
        before: before?.status ?? null, after: after.status, reversible: false,
      },
    }
  }
  if (action === 'reopen') {
    return {
      ...base,
      learning_receipt: {
        type: 'state_change', summary: '已重新打开事项', scope: 'item',
        before: before?.status ?? null, after: after.status, reversible: false,
      },
    }
  }
  return base
}

/**
 * Reject an action AND leave an action_denied audit trail (M9 P34: silent
 * {ok:false} was an observability blind spot — "why did nothing happen" was
 * unanswerable from the timeline). Best-effort: an audit failure never masks
 * the original outcome.
 */
function deny(
  yolo: Yolo,
  cwd: string,
  r: YoloActionRequest,
  error: string,
  httpStatus: 400 | 404 | 409,
  code = httpStatus === 404 ? 'not_found' : httpStatus === 409 ? 'conflict' : 'validation_error',
): YoloActionOutcome {
  const action = String(r.action ?? '')
  const kind = String(r.kind ?? '')
  const sessionId = typeof r.session_id === 'string' && r.session_id ? r.session_id : null
  try {
    yolo.addEvent(cwd, {
      kind: 'action_denied',
      summary: `⚠ 拒绝 ${action}/${kind}：${error}`,
      detail: JSON.stringify({ action, kind, id: r.id, title: r.title, into_id: r.into_id, into_title: r.into_title }).slice(0, 300),
      session_id: sessionId,
      source: sessionId ? null : 'manual',
    })
  } catch {
    // audit is best-effort; the denial outcome itself must still be returned
  }
  return { ok: false, error, code, httpStatus }
}

/** Validate + dispatch one action request against the YOLO store. Never throws. */
function applyYoloActionOnce(yolo: Yolo, cwd: string, r: YoloActionRequest): YoloActionOutcome {
  const action = String(r.action ?? '')
  const kind = String(r.kind ?? '')
  const ref: { id?: string; title?: string } = {
    ...(typeof r.id === 'string' && r.id ? { id: r.id } : {}),
    ...(typeof r.title === 'string' && r.title ? { title: r.title } : {}),
  }
  const sessionId = typeof r.session_id === 'string' && r.session_id ? r.session_id : undefined

  // ---- dashboard-v2 judgment trust state ----
  if (kind === 'attention' && (action === 'seen' || action === 'suppress' || action === 'feedback')) {
    if (!ref.id || !r.reason_version || !r.evidence_fingerprint) {
      return deny(
        yolo,
        cwd,
        r,
        `${action} requires kind=attention, id, reason_version and evidence_fingerprint`,
        400,
        'attention_binding_required',
      )
    }
    const current = buildDashboardData(yolo, cwd).attention?.[0]
    const bound = current
      && (ref.id === current.todo_id || ref.id === current.id)
      && r.reason_version === current.reason_version
      && r.evidence_fingerprint === current.evidence_fingerprint
    if (!bound || !current) {
      return deny(yolo, cwd, r, 'assistant judgment changed; refresh before responding', 409, 'stale_attention')
    }
    const currentTodo = yolo.findTodo?.(cwd, { id: current.todo_id })
    const judgmentTitle = currentTodo?.title ?? current.todo_id
    if (action === 'seen' && current.seen_at != null) {
      const existing = yolo.listAttentionFeedback(cwd).find((row) =>
        row.todo_id === current.todo_id
        && row.reason_version === current.reason_version
        && row.evidence_fingerprint === current.evidence_fingerprint,
      )
      return {
        ok: true,
        item: (existing ?? { todo_id: current.todo_id, seen_at: current.seen_at }) as unknown as Record<string, unknown>,
        learning_receipt: {
          type: 'no_learning', summary: '已记录为看过；未改变提醒偏好', scope: 'item', reversible: false,
        },
      }
    }

    const ts = Date.now()
    let patch: { seen_at?: number; suppressed_until?: number; feedback_reason?: string }
    let eventKind: 'attention_seen' | 'attention_suppressed' | 'attention_feedback'
    let summary: string
    let receiptType: YoloLearningReceipt['type'] = 'no_learning'
    if (action === 'seen') {
      patch = { seen_at: ts }
      eventKind = 'attention_seen'
      summary = `已查看助手判断：「${judgmentTitle}」`
    } else if (action === 'suppress') {
      if (typeof r.suppressed_until !== 'number' || !Number.isFinite(r.suppressed_until) || r.suppressed_until <= ts) {
        return deny(yolo, cwd, r, 'suppress requires a future suppressed_until timestamp', 400, 'invalid_suppression')
      }
      patch = { seen_at: ts, suppressed_until: r.suppressed_until }
      eventKind = 'attention_suppressed'
      summary = `已暂时忽略助手判断：「${judgmentTitle}」至 ${new Date(r.suppressed_until).toISOString()}`
    } else {
      if (!ATTENTION_FEEDBACK_REASONS.includes(r.feedback_reason as (typeof ATTENTION_FEEDBACK_REASONS)[number])) {
        return deny(yolo, cwd, r, 'feedback_reason is not supported', 400, 'invalid_feedback')
      }
      patch = { seen_at: ts, feedback_reason: r.feedback_reason }
      eventKind = 'attention_feedback'
      summary = `已记录助手判断原因反馈：「${judgmentTitle}」· ${r.feedback_reason}`
      receiptType = 'feedback_count'
    }
    const stored = yolo.recordAttentionFeedback(cwd, {
      todo_id: current.todo_id,
      reason_version: current.reason_version,
      evidence_fingerprint: current.evidence_fingerprint,
    }, patch)
    const audit = yolo.addEvent(cwd, {
      kind: eventKind,
      summary,
      detail: JSON.stringify({
        todo_id: current.todo_id,
        reason_version: current.reason_version,
        evidence_fingerprint: current.evidence_fingerprint,
        feedback_reason: patch.feedback_reason,
        suppressed_until: patch.suppressed_until,
      }),
      session_id: sessionId ?? null,
      source: sessionId ? null : 'manual',
    })
    return {
      ok: true,
      item: stored as unknown as Record<string, unknown>,
      ...(audit ? { audit_event_id: audit.id } : {}),
      learning_receipt: {
        type: receiptType,
        summary: action === 'seen'
          ? '已记录为看过；未改变提醒偏好'
          : action === 'suppress'
            ? '已忽略本次判断；未改变提醒偏好'
            : '已记录原因反馈；未改变提醒偏好',
        scope: 'item',
        reversible: false,
      },
    }
  }

  // ---- notification handling (v0.3.0 B/D cards) ----
  if (action === 'handled') {
    if (kind !== 'notification' || !ref.id) {
      return deny(yolo, cwd, r, 'handled requires kind=notification and id', 400)
    }
    // Idempotent success (double-click「知道了」, or a stale client replay):
    // the requested end state already holds. Deliberately NOT audited — and
    // NOT an error: the old 404 made the UI show 「操作失败」 for a benign
    // repeat click (v0.3.3 review fix).
    yolo.markNotificationHandled(cwd, ref.id)
    return { ok: true, item: { id: ref.id, handled: true } }
  }

  // notification card authoring (E2E + assist surfaces): mirror of the scheduler's
  // addNotification, so a card (and its badge) can be surfaced on demand.
  if (action === 'author_notification') {
    if (kind !== 'notification' || !ref.title) {
      return deny(yolo, cwd, r, 'author_notification requires kind=notification and title', 400)
    }
    const notif = yolo.addNotification(cwd, {
      kind: r.notif_kind === 'brief' ? 'brief' : 'reminder',
      title: ref.title,
      body: typeof r.note === 'string' && r.note ? r.note : null,
      todo_id: ref.id ?? null,
      scope_cwd: cwd,
    })
    return { ok: true, item: notif as unknown as Record<string, unknown> }
  }

  // ---- quick capture (v0.3.0 A): direct write, no LLM in the loop ----
  if (action === 'quick_add') {
    if (kind !== 'todo' || !ref.title) {
      return deny(yolo, cwd, r, 'quick_add requires kind=todo and title', 400)
    }
    const due = typeof r.due_at === 'string' && r.due_at ? r.due_at : localDateStr()
    const { todo, created } = yolo.addTodo(cwd, {
      title: ref.title,
      due_at: due,
      source: 'manual',
      evidence_operation_key: r.client_action_id,
      evidence_source_kind: 'panel_action',
    })
    if (created) {
      yolo.addEvent(cwd, {
        kind: 'todo_created',
        summary: `＋ 快速记一条「${todo.title}」`,
        detail: due ? `截止 ${due}` : null,
        source: 'manual',
        subject_type: 'todo',
        subject_id: todo.id,
        subject_title: todo.title,
        change: {
          status: { before: null, after: todo.status },
          ...(todo.due_at ? { due_at: { before: null, after: todo.due_at } } : {}),
        },
      })
    }
    return { ok: true, item: todo as unknown as Record<string, unknown> }
  }

  if (action === 'create' && kind === 'goal') {
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    if (!title) return deny(yolo, cwd, r, 'goal create requires title', 400)
    const requestedStatus = r.status === undefined ? 'active' : r.status
    if (!GOAL_STATUSES.includes(requestedStatus as GoalStatus)) {
      return deny(yolo, cwd, r, 'invalid goal status', 400, 'invalid_goal_status')
    }
    const goal = yolo.addGoal(cwd, {
      title,
      description: r.detail?.trim() || null,
      status: requestedStatus as GoalStatus,
      completion_criteria: r.completion_criteria?.trim() || null,
      target_date: r.target_date?.trim() || null,
      next_review_at: r.next_review_at?.trim() || null,
      source: sessionId ? 'llm' : 'manual',
      session_id: sessionId ?? null,
    })
    yolo.addEvent(cwd, {
      kind: 'goal_created', summary: `＋ 记录新目标「${goal.title}」`, detail: goal.completion_criteria ?? null,
      session_id: sessionId ?? null, source: sessionId ? null : 'manual',
      subject_type: 'goal', subject_id: goal.id, subject_title: goal.title,
      change: { status: { before: null, after: goal.status } },
    })
    if (r.milestone_id) {
      const link = yolo.linkGoalMilestone(cwd, goal.id, r.milestone_id, r.position ?? 0)
      yolo.addEvent(cwd, {
        kind: 'goal_linked', summary: `目标关联里程碑`, detail: JSON.stringify(link),
        session_id: sessionId ?? null, source: sessionId ? null : 'manual',
        subject_type: 'goal', subject_id: goal.id, subject_title: goal.title,
        related_subject_type: 'milestone', related_subject_id: r.milestone_id,
        change: { relation: { before: null, after: 'milestone' } },
      })
    }
    return { ok: true, item: goal as unknown as Record<string, unknown> }
  }

  // ---- date-range todo maintenance ----
  if (action === 'bulk_cancel' || action === 'bulk_delete') {
    if (kind !== 'todo') return deny(yolo, cwd, r, `${action} requires kind=todo`, 400)
    const selector: TodoRangeSelector = {
      field: r.range_field as TodoRangeField,
      from: typeof r.range_from === 'string' ? r.range_from : '',
      to: typeof r.range_to === 'string' ? r.range_to : '',
    }
    const rangeError = validateTodoRange(selector)
    if (rangeError) return deny(yolo, cwd, r, rangeError, 400, 'invalid_todo_range')
    if (action === 'bulk_delete' && r.confirmation !== 'PERMANENT_DELETE') {
      return deny(yolo, cwd, r, 'bulk_delete requires permanent-delete confirmation', 400, 'permanent_delete_confirmation_required')
    }
    if (action === 'bulk_cancel') {
      const items = yolo.cancelTodosInRange(cwd, selector, { session_id: sessionId ?? null })
      return {
        ok: true,
        item: { action, affected: items.length, ids: items.map((item) => item.id), ...selector },
        learning_receipt: {
          type: items.length > 0 ? 'state_change' : 'no_learning',
          summary: items.length > 0 ? `已取消 ${items.length} 项` : '范围内没有可取消的开放事项',
          scope: 'workspace',
          reversible: items.length > 0,
        },
      }
    }
    const deleted = yolo.deleteTodosInRange(cwd, selector, { session_id: sessionId ?? null })
    return {
      ok: true,
      item: { action, affected: deleted.ids.length, ids: deleted.ids, deleted_record_count: deleted.deleted_record_count, ...selector },
      ...(deleted.audit_event_id ? { audit_event_id: deleted.audit_event_id } : {}),
      learning_receipt: {
        type: deleted.ids.length > 0 ? 'state_change' : 'no_learning',
        summary: deleted.ids.length > 0 ? `已永久删除 ${deleted.ids.length} 项` : '范围内没有可永久删除的事项',
        scope: 'workspace',
        reversible: false,
      },
    }
  }

  if (action === 'identity_reject') {
    if (kind !== 'todo' || typeof r.id !== 'string' || !r.id || !Number.isInteger(r.resolution_id)) {
      return deny(yolo, cwd, r, 'identity_reject requires kind=todo, id and integer resolution_id', 400, 'invalid_identity_feedback')
    }
    if (!IDENTITY_FEEDBACK_REASONS.includes(r.identity_feedback_reason as TodoIdentityFeedbackReason)) {
      return deny(yolo, cwd, r, 'identity_reject requires identity_feedback_reason', 400, 'invalid_identity_feedback')
    }
    const rejected = yolo.rejectTodoIdentityResolution(
      cwd,
      r.resolution_id!,
      r.id,
      r.identity_feedback_reason as TodoIdentityFeedbackReason,
    )
    if (!rejected.ok) {
      return deny(yolo, cwd, r, rejected.error, rejected.kind === 'not-found' ? 404 : 409, `identity_feedback_${rejected.kind}`)
    }
    return {
      ok: true,
      item: rejected.todo as unknown as Record<string, unknown>,
      ...(rejected.audit_event_id ? { audit_event_id: rejected.audit_event_id } : {}),
      learning_receipt: {
        type: 'feedback_count',
        summary: rejected.feedback.undo_status === 'applied'
          ? '已记录关联反馈并撤销自动改期'
          : rejected.feedback.undo_status === 'conflict'
            ? '已记录关联反馈；保留你后来修改的截止时间'
            : '已记录关联反馈并排除本次来源',
        scope: 'item',
        reversible: false,
      },
    }
  }

  if (action === 'dismiss_merge_suggestion') {
    if (kind !== 'todo' || typeof r.id !== 'string' || !r.id || typeof r.into_id !== 'string' || !r.into_id) {
      return deny(yolo, cwd, r, 'dismiss_merge_suggestion requires two todo ids', 400, 'invalid_merge_suggestion_feedback')
    }
    const feedback = yolo.dismissTodoMergeSuggestion(cwd, r.id, r.into_id, r.note)
    return feedback
      ? {
          ok: true,
          item: feedback as unknown as Record<string, unknown>,
          learning_receipt: {
            type: 'feedback_count', summary: '已隐藏这组重复事项建议', scope: 'item', reversible: false,
          },
        }
      : deny(yolo, cwd, r, 'merge suggestion pair not found', 404, 'merge_suggestion_not_found')
  }

  if (!ref.id && !ref.title) return deny(yolo, cwd, r, 'pass id or title', 400)

  if (action === 'delete') {
    if (kind !== 'todo' || !ref.id) return deny(yolo, cwd, r, 'delete requires kind=todo and id', 400)
    if (r.confirmation !== 'PERMANENT_DELETE') {
      return deny(yolo, cwd, r, 'delete requires permanent-delete confirmation', 400, 'permanent_delete_confirmation_required')
    }
    const deleted = yolo.deleteTodoPermanently(cwd, ref.id, { session_id: sessionId ?? null })
    return deleted
      ? {
          ok: true,
          item: { id: deleted.id, deleted: true, deleted_record_count: deleted.deleted_record_count },
          learning_receipt: {
            type: 'state_change', summary: '事项已永久删除', scope: 'item', reversible: false,
          },
        }
      : deny(yolo, cwd, r, 'todo not found', 404)
  }

  // ---- goal / milestone maintenance (v0.3.0 E) ----
  if (action === 'rename') {
    const id = ref.id
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    if (!id || !title || (kind !== 'goal' && kind !== 'milestone')) {
      return deny(yolo, cwd, r, 'rename requires kind=goal|milestone, id, and the NEW title', 400)
    }
    const row =
      kind === 'goal'
        ? yolo.applyGoalRename(cwd, id, title, sessionId)
        : yolo.applyMilestoneRename(cwd, id, title, sessionId)
    return row
      ? { ok: true, item: row as unknown as Record<string, unknown> }
      : deny(yolo, cwd, r, `${kind} not found`, 404)
  }
  if (action === 'abandon') {
    if (kind !== 'goal' || !ref.id) {
      return deny(yolo, cwd, r, 'abandon requires kind=goal and id', 400)
    }
    const g = yolo.applyGoalAbandon(cwd, ref.id, sessionId)
    return g
      ? { ok: true, item: g as unknown as Record<string, unknown> }
      : deny(yolo, cwd, r, 'goal not found', 404)
  }

  if (kind === 'goal' && ['activate', 'pause', 'resume', 'achieve'].includes(action)) {
    if (!ref.id) return deny(yolo, cwd, r, `${action} requires kind=goal and id`, 400)
    const status: GoalStatus = action === 'achieve' ? 'achieved' : action === 'pause' ? 'paused' : 'active'
    const before = yolo.getGoal(cwd, ref.id)
    if (!before) return deny(yolo, cwd, r, 'goal not found', 404)
    const g = yolo.setGoalStatus(cwd, ref.id, status)
    if (!g) return deny(yolo, cwd, r, 'goal not found', 404)
    if (before.status !== g.status) {
      yolo.addEvent(cwd, {
        kind: 'goal_status',
        summary: `目标「${g.title}」${status === 'achieved' ? '已达成' : status === 'paused' ? '已暂停' : '已恢复进行'}`,
        session_id: sessionId ?? null,
        source: sessionId ? null : 'manual',
        subject_type: 'goal', subject_id: g.id, subject_title: g.title,
        change: { status: { before: before.status, after: g.status } },
      })
    }
    return { ok: true, item: g as unknown as Record<string, unknown> }
  }

  if (kind === 'goal' && action === 'update') {
    if (!ref.id) return deny(yolo, cwd, r, 'goal update requires id', 400)
    const patch: Parameters<Yolo['updateGoal']>[2] = {}
    if (typeof r.title === 'string' && r.title.trim()) patch.title = r.title.trim()
    if (r.detail !== undefined) patch.description = typeof r.detail === 'string' && r.detail.trim() ? r.detail.trim() : null
    if (r.completion_criteria !== undefined) patch.completion_criteria = r.completion_criteria?.trim() || null
    if (r.target_date !== undefined) patch.target_date = r.target_date?.trim() || null
    if (r.next_review_at !== undefined) patch.next_review_at = r.next_review_at?.trim() || null
    if (Object.keys(patch).length === 0) return deny(yolo, cwd, r, 'goal update requires a goal field', 400)
    const before = yolo.getGoal(cwd, ref.id)
    const g = yolo.updateGoal(cwd, ref.id, patch)
    if (!g) return deny(yolo, cwd, r, 'goal not found', 404)
    yolo.addEvent(cwd, {
      kind: 'goal_updated', summary: `目标「${g.title}」已更新`, detail: JSON.stringify(patch),
      session_id: sessionId ?? null, source: sessionId ? null : 'manual',
      subject_type: 'goal', subject_id: g.id, subject_title: before?.title ?? g.title,
      change: Object.fromEntries(Object.entries(patch).map(([key, after]) => [key, {
        before: (before as unknown as Record<string, unknown> | undefined)?.[key] ?? null,
        after,
      }])) as HistoryChangeSet,
    })
    return { ok: true, item: g as unknown as Record<string, unknown> }
  }

  if (kind === 'goal' && (action === 'link' || action === 'unlink')) {
    if (!ref.id || (!r.todo_id && !r.milestone_id)) return deny(yolo, cwd, r, `${action} requires goal id and todo_id or milestone_id`, 400)
    try {
      if (r.todo_id && action === 'link') {
        const link = yolo.linkGoalTodo(cwd, ref.id, r.todo_id, {
          relation: r.relation ?? 'support',
          is_primary: r.is_primary === true,
        })
        yolo.addEvent(cwd, {
          kind: 'goal_linked', summary: `目标关联事项`, detail: JSON.stringify(link),
          session_id: sessionId ?? null, source: sessionId ? null : 'manual',
          subject_type: 'goal', subject_id: ref.id, related_subject_type: 'todo', related_subject_id: r.todo_id,
          change: { relation: { before: null, after: link.relation } },
        })
        return { ok: true, item: link as unknown as Record<string, unknown> }
      }
      if (r.todo_id) {
        const removed = yolo.unlinkGoalTodo(cwd, ref.id, r.todo_id)
        if (!removed) return deny(yolo, cwd, r, 'goal relation not found', 404, 'goal_relation_not_found')
        yolo.addEvent(cwd, {
          kind: 'goal_unlinked', summary: `目标已解除事项关联`, detail: r.todo_id,
          session_id: sessionId ?? null, source: sessionId ? null : 'manual',
          subject_type: 'goal', subject_id: ref.id, related_subject_type: 'todo', related_subject_id: r.todo_id,
          change: { relation: { before: 'support', after: null } },
        })
        return { ok: true, item: { goal_id: ref.id, todo_id: r.todo_id, unlinked: true } }
      }
      if (action === 'link' && r.milestone_id) {
        const existed = yolo.listGoalMilestoneLinks(cwd, ref.id).some((link) => link.milestone_id === r.milestone_id)
        const link = yolo.linkGoalMilestone(cwd, ref.id, r.milestone_id, r.position ?? 0)
        if (!existed) {
          yolo.addEvent(cwd, {
            kind: 'goal_linked', summary: `目标关联里程碑`, detail: JSON.stringify(link),
            session_id: sessionId ?? null, source: sessionId ? null : 'manual',
            subject_type: 'goal', subject_id: ref.id, related_subject_type: 'milestone', related_subject_id: r.milestone_id,
            change: { relation: { before: null, after: 'milestone' } },
          })
        }
        return { ok: true, item: link as unknown as Record<string, unknown> }
      }
      if (r.milestone_id) {
        const removed = yolo.unlinkGoalMilestone(cwd, ref.id, r.milestone_id)
        if (!removed) return deny(yolo, cwd, r, 'goal relation not found', 404, 'goal_relation_not_found')
        yolo.addEvent(cwd, {
          kind: 'goal_unlinked', summary: `目标已解除里程碑关联`, detail: r.milestone_id,
          session_id: sessionId ?? null, source: sessionId ? null : 'manual',
          subject_type: 'goal', subject_id: ref.id, related_subject_type: 'milestone', related_subject_id: r.milestone_id,
          change: { relation: { before: 'milestone', after: null } },
        })
        return { ok: true, item: { goal_id: ref.id, milestone_id: r.milestone_id, unlinked: true } }
      }
      return deny(yolo, cwd, r, 'goal relation not found', 404, 'goal_relation_not_found')
    } catch (error) {
      return deny(yolo, cwd, r, error instanceof Error ? error.message : String(error), 409, 'goal_relation_conflict')
    }
  }

  if (kind === 'goal' && (action === 'set_next' || action === 'clear_next')) {
    if (!ref.id) return deny(yolo, cwd, r, `${action} requires goal id`, 400)
    try {
      const g = action === 'set_next'
        ? (r.todo_id ? yolo.setGoalNextTodo(cwd, ref.id, r.todo_id) : null)
        : yolo.clearGoalNextTodo(cwd, ref.id)
      if (!g) return deny(yolo, cwd, r, action === 'set_next' ? 'set_next requires todo_id' : 'goal not found', action === 'set_next' ? 400 : 404)
      yolo.addEvent(cwd, {
        kind: action === 'set_next' ? 'goal_next_step_set' : 'goal_next_step_cleared', summary: action === 'set_next' ? `目标「${g.title}」已设置下一步` : `目标「${g.title}」已清除下一步`,
        detail: g.next_todo_id ?? null, session_id: sessionId ?? null, source: sessionId ? null : 'manual',
        subject_type: 'goal', subject_id: g.id, subject_title: g.title,
        change: { next_todo_id: { before: null, after: g.next_todo_id ?? null } },
      })
      return { ok: true, item: g as unknown as Record<string, unknown> }
    } catch (error) {
      return deny(yolo, cwd, r, error instanceof Error ? error.message : String(error), 400, 'next_todo_invalid')
    }
  }

  if (kind === 'goal' && action === 'review') {
    if (!ref.id) return deny(yolo, cwd, r, 'review requires goal id', 400)
    const before = yolo.getGoal(cwd, ref.id)
    if (!before) return deny(yolo, cwd, r, 'goal not found', 404)
    try {
      if (r.completion_criteria !== undefined || r.target_date !== undefined || r.next_review_at !== undefined || r.detail !== undefined) {
        yolo.updateGoal(cwd, ref.id, {
          ...(r.completion_criteria !== undefined ? { completion_criteria: r.completion_criteria?.trim() || null } : {}),
          ...(r.target_date !== undefined ? { target_date: r.target_date?.trim() || null } : {}),
          ...(r.next_review_at !== undefined ? { next_review_at: r.next_review_at?.trim() || null } : {}),
          ...(r.detail !== undefined ? { description: r.detail?.trim() || null } : {}),
        })
      }
      if (typeof r.progress === 'number' && Number.isFinite(r.progress)) yolo.applyGoalProgress(cwd, { id: ref.id }, r.progress, r.note, sessionId)
      if (r.next_todo_id !== undefined) {
        if (r.next_todo_id === null) yolo.clearGoalNextTodo(cwd, ref.id)
        else yolo.setGoalNextTodo(cwd, ref.id, r.next_todo_id)
      }
      if (r.status !== undefined) {
        if (!GOAL_STATUSES.includes(r.status as GoalStatus)) throw new Error('invalid goal status')
        yolo.setGoalStatus(cwd, ref.id, r.status as GoalStatus)
      }
      const g = yolo.getGoal(cwd, ref.id)
      if (!g) return deny(yolo, cwd, r, 'goal not found', 404)
      yolo.addEvent(cwd, {
        kind: 'goal_reviewed', summary: `已回顾目标「${g.title}」`, detail: r.note ?? null,
        session_id: sessionId ?? null, source: sessionId ? null : 'manual',
        subject_type: 'goal', subject_id: g.id, subject_title: g.title,
        change: { status: { before: before.status, after: g.status }, next_todo_id: { before: before.next_todo_id ?? null, after: g.next_todo_id ?? null } },
      })
      return { ok: true, item: g as unknown as Record<string, unknown> }
    } catch (error) {
      return deny(yolo, cwd, r, error instanceof Error ? error.message : String(error), 400, 'goal_review_invalid')
    }
  }

  if (action === 'set_progress') {
    if (kind !== 'goal' || typeof r.progress !== 'number' || !Number.isFinite(r.progress)) {
      return deny(yolo, cwd, r, 'set_progress requires kind=goal and progress', 400)
    }
    const g = yolo.applyGoalProgress(cwd, ref, r.progress, typeof r.note === 'string' ? r.note : undefined, sessionId)
    return g
      ? { ok: true, item: g as unknown as Record<string, unknown> }
      : deny(yolo, cwd, r, 'goal not found', 404)
  }

  if (action === 'set_status') {
    const status = String(r.status ?? '')
    if (kind !== 'milestone' || !MILESTONE_STATUSES.includes(status as MilestoneStatus)) {
      return deny(yolo, cwd, r, 'set_status requires kind=milestone and status in planned|active|done|abandoned', 400)
    }
    const m = yolo.applyMilestoneStatus(cwd, ref, status as MilestoneStatus, sessionId)
    return m
      ? { ok: true, item: m as unknown as Record<string, unknown> }
      : deny(yolo, cwd, r, 'milestone not found', 404)
  }

  // ---- todo plan edits + state flow ----
  if (action === 'update') {
    if (kind !== 'todo') return deny(yolo, cwd, r, 'update requires kind=todo', 400)
    const patch: { title?: string; detail?: string | null; due_at?: string | null; priority?: Priority | null; milestone_id?: string | null } = {}
    if (typeof r.title === 'string' && r.title.trim()) patch.title = r.title.trim()
    if (r.detail !== undefined) patch.detail = typeof r.detail === 'string' && r.detail.trim() ? r.detail.trim() : null
    if (r.due_at !== undefined) patch.due_at = typeof r.due_at === 'string' && r.due_at ? r.due_at : null
    if (r.priority !== undefined) {
      const priority = toPriority(r.priority)
      if (priority === undefined) {
        return deny(yolo, cwd, r, 'priority must be low|medium|high|urgent or empty', 400, 'invalid_priority')
      }
      patch.priority = priority
    }
    if (r.milestone_title !== undefined) {
      if (r.milestone_title === null || r.milestone_title.trim() === '') {
        patch.milestone_id = null
      } else {
        const milestoneId = yolo.findMilestoneId(cwd, r.milestone_title.trim())
        if (!milestoneId) {
          return deny(yolo, cwd, r, 'milestone not found', 404, 'milestone_not_found')
        }
        patch.milestone_id = milestoneId
      }
    }
    if (Object.keys(patch).length === 0) {
      return deny(yolo, cwd, r, 'update requires at least one of title/detail/due_at/priority/milestone_title', 400)
    }
    const t = ref.id ? yolo.applyTodoUpdate(cwd, ref.id, patch, sessionId) : null
    return t
      ? { ok: true, item: t as unknown as Record<string, unknown> }
      : deny(yolo, cwd, r, 'todo not found', 404)
  }

  // ---- consolidate (M9 P35): explicit merge of a duplicate todo into its keeper ----
  if (action === 'consolidate') {
    const into: { id?: string; title?: string } = {
      id: typeof r.into_id === 'string' && r.into_id ? r.into_id : undefined,
      title: typeof r.into_title === 'string' && r.into_title ? r.into_title : undefined,
    }
    if (kind !== 'todo') return deny(yolo, cwd, r, 'consolidate requires kind=todo', 400)
    if ((!ref.id && !ref.title) || (!into.id && !into.title)) {
      return deny(yolo, cwd, r, 'consolidate requires source (id|title) and target (into_id|into_title)', 400)
    }
    if (r.confirmation !== 'CONFIRM_CONSOLIDATE') {
      return deny(yolo, cwd, r, 'consolidate requires an explicit preview confirmation', 409, 'consolidation_confirmation_required')
    }
    const res = yolo.applyTodoConsolidate(cwd, ref, into, sessionId)
    return res.ok
      ? {
          ok: true,
          item: { ...res.target, merge_id: res.merge.id } as unknown as Record<string, unknown>,
          learning_receipt: {
            type: 'state_change', summary: `已合并重复事项「${res.target.title}」`, scope: 'item', reversible: true,
          },
          undo: { action: 'undo_consolidate', kind: 'todo', id: res.merge.source_id, merge_id: res.merge.id },
        }
      : deny(yolo, cwd, r, res.error, res.kind === 'not-found' ? 404 : 400)
  }

  if (action === 'undo_consolidate') {
    const mergeId = typeof r.merge_id === 'string' && r.merge_id
      ? r.merge_id
      : typeof r.id === 'string' && r.id
        ? yolo.findActiveTodoMerge(cwd, r.id)?.id
        : undefined
    if (kind !== 'todo' || !mergeId) {
      return deny(yolo, cwd, r, 'undo_consolidate requires an active merged todo or merge_id', 400, 'invalid_merge_undo')
    }
    const res = yolo.undoTodoConsolidation(cwd, mergeId, sessionId)
    return res.ok
      ? {
          ok: true,
          item: { ...res.source, target_restore_status: res.target_restore_status } as unknown as Record<string, unknown>,
          learning_receipt: {
            type: 'state_change',
            summary: res.target_restore_status === 'applied' ? '已撤销事项合并' : '已撤销事项关系；保留后续编辑',
            scope: 'item', reversible: false,
          },
        }
      : deny(yolo, cwd, r, res.error, res.kind === 'not-found' ? 404 : 409, `consolidation_undo_${res.kind}`)
  }

  if (kind !== 'todo' || !TODO_ACTIONS.includes(action as TodoAction)) {
    return deny(yolo, cwd, r, `unsupported action "${action}" for kind "${kind}"`, 400)
  }
  if (action === 'postpone' && typeof r.due_at !== 'string') {
    return deny(yolo, cwd, r, 'postpone requires due_at (absolute date YYYY-MM-DD)', 400)
  }
  // UI "delete" is the audited soft-delete (TE-6: todo_cancelled event)
  const before = yolo.findTodo?.(cwd, ref) ?? null
  const startedAt = Date.now()
  const t = yolo.applyTodoAction(
    cwd,
    ref,
    action as TodoAction,
    action === 'postpone' ? { due_at: r.due_at as string, session_id: sessionId ?? null } : { session_id: sessionId ?? null },
  )
  return t
    ? todoSuccessOutcome(action, before, t, latestAuditFor(yolo, cwd, action, startedAt))
    : deny(yolo, cwd, r, 'todo not found', 404)
}

export function hashYoloActionRequest(r: YoloActionRequest): string {
  const canonical = {
    action: r.action,
    kind: r.kind,
    id: r.id ?? null,
    title: r.title ?? null,
    due_at: r.due_at ?? null,
    progress: r.progress ?? null,
    status: r.status ?? null,
    note: r.note ?? null,
    detail: r.detail ?? null,
    priority: r.priority ?? null,
    milestone_title: r.milestone_title ?? null,
    todo_id: r.todo_id ?? null,
    milestone_id: r.milestone_id ?? null,
    next_todo_id: r.next_todo_id ?? null,
    relation: r.relation ?? null,
    completion_criteria: r.completion_criteria ?? null,
    target_date: r.target_date ?? null,
    next_review_at: r.next_review_at ?? null,
    position: r.position ?? null,
    is_primary: r.is_primary ?? null,
    into_id: r.into_id ?? null,
    into_title: r.into_title ?? null,
    merge_id: r.merge_id ?? null,
    session_id: r.session_id ?? null,
    session_turn: r.session_turn ?? null,
    notif_kind: r.notif_kind ?? null,
    scope_cwd: r.scope_cwd ?? null,
    reason_version: r.reason_version ?? null,
    evidence_fingerprint: r.evidence_fingerprint ?? null,
    feedback_reason: r.feedback_reason ?? null,
    resolution_id: r.resolution_id ?? null,
    identity_feedback_reason: r.identity_feedback_reason ?? null,
    suppressed_until: r.suppressed_until ?? null,
    range_field: r.range_field ?? null,
    range_from: r.range_from ?? null,
    range_to: r.range_to ?? null,
    confirmation: r.confirmation ?? null,
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/** Validate + dispatch with an optional durable, cross-restart idempotency key. */
export function applyYoloAction(yolo: Yolo, cwd: string, r: YoloActionRequest): YoloActionOutcome {
  const rawId = r.client_action_id
  if (rawId !== undefined && (typeof rawId !== 'string' || !rawId.trim() || rawId.length > 128)) {
    return deny(yolo, cwd, r, 'client_action_id must be a non-empty string up to 128 characters', 400, 'invalid_client_action_id')
  }
  const clientActionId = rawId?.trim()
  if (!clientActionId) return yolo.runWorkspaceTransaction(cwd, () => applyYoloActionOnce(yolo, cwd, r))

  const hash = hashYoloActionRequest(r)
  const result = yolo.runIdempotentAction(
    cwd,
    clientActionId,
    hash,
    () => {
      const outcome = applyYoloActionOnce(yolo, cwd, r)
      const todoId = outcome.ok && r.kind === 'todo' && typeof outcome.item?.id === 'string'
        ? outcome.item.id
        : undefined
      if (todoId && r.action !== 'delete' && r.action !== 'identity_reject' && r.action !== 'consolidate' && r.action !== 'undo_consolidate') {
        const relation = r.action === 'quick_add'
          ? 'origin'
          : r.action === 'complete'
            ? 'completion_claim'
            : r.action === 'reopen'
              ? 'correction'
              : 'update'
        yolo.addTodoEvidence(cwd, todoId, {
          session_id: r.session_id ?? null,
          turn_seq: r.session_turn ?? null,
          source_kind: r.session_id ? 'assistant_action' : 'panel_action',
          relation,
          source_fingerprint: todoEvidenceFingerprint(clientActionId, todoId),
        })
      }
      return JSON.stringify(outcome)
    },
  )
  if (result.status === 'conflict') {
    return {
      ok: false,
      error: 'client_action_id was already used for a different request',
      code: 'idempotency_conflict',
      httpStatus: 409,
    }
  }
  try {
    return JSON.parse(result.outcome_json) as YoloActionOutcome
  } catch {
    return { ok: false, error: 'stored action outcome is unreadable', code: 'idempotency_record_invalid', httpStatus: 409 }
  }
}

/** Typed application entry. cwd-based `applyYoloAction` remains only as the
 * compatibility facade for older package-internal consumers. */
export function applyYoloActionInScope(yolo: Yolo, scope: ScopeRef, request: YoloActionRequest): YoloActionOutcome {
  try {
    return yolo.runInScopeRef(scope, (cwd) => applyYoloAction(yolo, cwd, request))
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: 'invalid_scope',
      httpStatus: 400,
    }
  }
}
