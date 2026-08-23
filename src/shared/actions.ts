// YOLO action request — the shared contract for in-place plan operations.
// One validation + dispatch path serves all three entrances (M8): the
// yolo_action model tool, the extraction update applier, and the dashboard
// POST /yolo/actions endpoint, so behavior and audit stay identical.
// v0.3.0 adds the panel's edit surface (E): update / rename / abandon /
// quick_add / handled, plus todo delete (= cancel, TE-6 audit semantics).
// M9 P34: every denial also leaves an action_denied audit event.

import type Yolo from '../storage/index.ts'
import type { MilestoneStatus, Priority, TimelineEvent, Todo, TodoAction } from '../storage/types.ts'
import { createHash } from 'node:crypto'
import { localDateStr } from './text.ts'
import { buildDashboardData } from '../ui/dashboard.ts'

const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'urgent']

/** What callers pass: action + kind + an item reference (id preferred, fuzzy title fallback). */
export interface YoloActionRequest {
  action: string
  kind: string
  id?: string
  title?: string
  due_at?: string | null
  progress?: number
  status?: string
  note?: string
  /** Inline-edit fields (v0.3.0 E): priority + milestone by title. */
  priority?: string
  milestone_title?: string
  /** Consolidate's surviving target (into_*); the source uses the existing id/title. */
  into_id?: string
  into_title?: string
  /** Originating dsh session, stamped on the audit event (chat actions only). */
  session_id?: string
  /** Notification sub-kind when authoring a card (author_notification): 'reminder' | 'brief'. */
  notif_kind?: string
  /** Dashboard-v2 workspace/action identity and immutable judgment binding. */
  scope_cwd?: string
  client_action_id?: string
  reason_version?: string
  evidence_fingerprint?: string
  feedback_reason?: AttentionFeedbackReason
  suppressed_until?: number
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
  expires_at?: number
}

/**
 * Action outcome. `httpStatus` is a hint for HTTP callers (404 for missing
 * items, 400 for validation); the model tool ignores it and just reads ok/error.
 */
export type YoloActionOutcome =
  | {
      ok: true
      item: Record<string, unknown>
      audit_event_id?: string
      undo?: YoloUndoDescriptor
      learning_receipt?: YoloLearningReceipt
    }
  | { ok: false; error: string; code: string; httpStatus: 400 | 404 | 409 }

const TODO_ACTIONS: readonly TodoAction[] = ['complete', 'start', 'cancel', 'postpone', 'remind_again', 'reopen']
const MILESTONE_STATUSES: readonly MilestoneStatus[] = ['planned', 'active', 'done', 'abandoned']

function toPriority(v: unknown): Priority | null | undefined {
  if (typeof v !== 'string') return undefined
  return PRIORITIES.includes(v as Priority) ? (v as Priority) : null
}

const ATTENTION_FEEDBACK_REASONS = [
  'wrong_time',
  'not_important',
  'wrong_goal',
  'stale_signal_unhelpful',
  'other',
] as const satisfies readonly AttentionFeedbackReason[]

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
    id: typeof r.id === 'string' && r.id ? r.id : undefined,
    title: typeof r.title === 'string' && r.title ? r.title : undefined,
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
    const { todo, created } = yolo.addTodo(cwd, { title: ref.title, due_at: due, source: 'manual' })
    if (created) {
      yolo.addEvent(cwd, {
        kind: 'todo_created',
        summary: `＋ 快速记一条「${todo.title}」`,
        detail: due ? `截止 ${due}` : null,
        source: 'manual',
      })
    }
    return { ok: true, item: todo as unknown as Record<string, unknown> }
  }

  if (!ref.id && !ref.title) return deny(yolo, cwd, r, 'pass id or title', 400)

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
    const patch: { title?: string; due_at?: string | null; priority?: Priority | null; milestone_id?: string | null } = {}
    if (typeof r.title === 'string' && r.title.trim()) patch.title = r.title.trim()
    if (r.due_at !== undefined) patch.due_at = typeof r.due_at === 'string' && r.due_at ? r.due_at : null
    if (r.priority !== undefined) patch.priority = toPriority(r.priority)
    if (r.milestone_title !== undefined) {
      patch.milestone_id = r.milestone_title ? yolo.findMilestoneId(cwd, r.milestone_title) : null
    }
    if (Object.keys(patch).length === 0) {
      return deny(yolo, cwd, r, 'update requires at least one of title/due_at/priority/milestone_title', 400)
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
    const res = yolo.applyTodoConsolidate(cwd, ref, into, sessionId)
    return res.ok
      ? { ok: true, item: res.target as unknown as Record<string, unknown> }
      : deny(yolo, cwd, r, res.error, res.kind === 'not-found' ? 404 : 400)
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
    priority: r.priority ?? null,
    milestone_title: r.milestone_title ?? null,
    into_id: r.into_id ?? null,
    into_title: r.into_title ?? null,
    session_id: r.session_id ?? null,
    notif_kind: r.notif_kind ?? null,
    scope_cwd: r.scope_cwd ?? null,
    reason_version: r.reason_version ?? null,
    evidence_fingerprint: r.evidence_fingerprint ?? null,
    feedback_reason: r.feedback_reason ?? null,
    suppressed_until: r.suppressed_until ?? null,
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
  if (!clientActionId) return applyYoloActionOnce(yolo, cwd, r)

  const hash = hashYoloActionRequest(r)
  const result = yolo.runIdempotentAction(
    cwd,
    clientActionId,
    hash,
    () => JSON.stringify(applyYoloActionOnce(yolo, cwd, r)),
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
