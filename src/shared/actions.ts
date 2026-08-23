// YOLO action request — the shared contract for in-place plan operations.
// One validation + dispatch path serves all three entrances (M8): the
// yolo_action model tool, the extraction update applier, and the dashboard
// POST /yolo/actions endpoint, so behavior and audit stay identical.
// v0.3.0 adds the panel's edit surface (E): update / rename / abandon /
// quick_add / handled, plus todo delete (= cancel, TE-6 audit semantics).
// M9 P34: every denial also leaves an action_denied audit event.

import type Yolo from '../storage/index.ts'
import type { MilestoneStatus, Priority, TodoAction } from '../storage/types.ts'
import { localDateStr } from './text.ts'

const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'urgent']

/** What callers pass: action + kind + an item reference (id preferred, fuzzy title fallback). */
export interface YoloActionRequest {
  action: string
  kind: string
  id?: string
  title?: string
  due_at?: string
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
}

/**
 * Action outcome. `httpStatus` is a hint for HTTP callers (404 for missing
 * items, 400 for validation); the model tool ignores it and just reads ok/error.
 */
export type YoloActionOutcome =
  | { ok: true; item: Record<string, unknown> }
  | { ok: false; error: string; httpStatus: 400 | 404 }

const TODO_ACTIONS: readonly TodoAction[] = ['complete', 'start', 'cancel', 'postpone', 'remind_again', 'reopen']
const MILESTONE_STATUSES: readonly MilestoneStatus[] = ['planned', 'active', 'done', 'abandoned']

function toPriority(v: unknown): Priority | null | undefined {
  if (typeof v !== 'string') return undefined
  return PRIORITIES.includes(v as Priority) ? (v as Priority) : null
}

/**
 * Reject an action AND leave an action_denied audit trail (M9 P34: silent
 * {ok:false} was an observability blind spot — "why did nothing happen" was
 * unanswerable from the timeline). Best-effort: an audit failure never masks
 * the original outcome.
 */
function deny(yolo: Yolo, cwd: string, r: YoloActionRequest, error: string, httpStatus: 400 | 404): YoloActionOutcome {
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
  return { ok: false, error, httpStatus }
}

/** Validate + dispatch one action request against the YOLO store. Never throws. */
export function applyYoloAction(yolo: Yolo, cwd: string, r: YoloActionRequest): YoloActionOutcome {
  const action = String(r.action ?? '')
  const kind = String(r.kind ?? '')
  const ref: { id?: string; title?: string } = {
    id: typeof r.id === 'string' && r.id ? r.id : undefined,
    title: typeof r.title === 'string' && r.title ? r.title : undefined,
  }
  const sessionId = typeof r.session_id === 'string' && r.session_id ? r.session_id : undefined

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
  const t = yolo.applyTodoAction(
    cwd,
    ref,
    action as TodoAction,
    action === 'postpone' ? { due_at: r.due_at as string, session_id: sessionId ?? null } : { session_id: sessionId ?? null },
  )
  return t
    ? { ok: true, item: t as unknown as Record<string, unknown> }
    : deny(yolo, cwd, r, 'todo not found', 404)
}
