// YOLO action request — the shared contract for in-place plan operations.
// One validation + dispatch path serves all three entrances (M8): the
// yolo_action model tool, the extraction update applier, and the dashboard
// POST /yolo/actions endpoint, so behavior and audit stay identical.
// v0.3.0 adds the panel's edit surface (E): update / rename / abandon /
// quick_add / handled, plus todo delete (= cancel, TE-6 audit semantics).

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
  /** Originating dsh session, stamped on the audit event (chat actions only). */
  session_id?: string
}

/**
 * Action outcome. `httpStatus` is a hint for HTTP callers (404 for missing
 * items, 400 for validation); the model tool ignores it and just reads ok/error.
 */
export type YoloActionOutcome =
  | { ok: true; item: Record<string, unknown> }
  | { ok: false; error: string; httpStatus: 400 | 404 }

const TODO_ACTIONS: readonly TodoAction[] = ['complete', 'start', 'cancel', 'postpone', 'remind_again']
const MILESTONE_STATUSES: readonly MilestoneStatus[] = ['planned', 'active', 'done', 'abandoned']

function toPriority(v: unknown): Priority | null | undefined {
  if (typeof v !== 'string') return undefined
  return PRIORITIES.includes(v as Priority) ? (v as Priority) : null
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
      return { ok: false, error: 'handled requires kind=notification and id', httpStatus: 400 }
    }
    const changed = yolo.markNotificationHandled(cwd, ref.id)
    return changed
      ? { ok: true, item: { id: ref.id, handled: true } }
      : { ok: false, error: 'notification not found (or already handled)', httpStatus: 404 }
  }

  // ---- quick capture (v0.3.0 A): direct write, no LLM in the loop ----
  if (action === 'quick_add') {
    if (kind !== 'todo' || !ref.title) {
      return { ok: false, error: 'quick_add requires kind=todo and title', httpStatus: 400 }
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

  if (!ref.id && !ref.title) return { ok: false, error: 'pass id or title', httpStatus: 400 }

  // ---- goal / milestone maintenance (v0.3.0 E) ----
  if (action === 'rename') {
    const id = ref.id
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    if (!id || !title || (kind !== 'goal' && kind !== 'milestone')) {
      return { ok: false, error: 'rename requires kind=goal|milestone, id, and the NEW title', httpStatus: 400 }
    }
    const row =
      kind === 'goal'
        ? yolo.applyGoalRename(cwd, id, title, sessionId)
        : yolo.applyMilestoneRename(cwd, id, title, sessionId)
    return row
      ? { ok: true, item: row as unknown as Record<string, unknown> }
      : { ok: false, error: `${kind} not found`, httpStatus: 404 }
  }
  if (action === 'abandon') {
    if (kind !== 'goal' || !ref.id) {
      return { ok: false, error: 'abandon requires kind=goal and id', httpStatus: 400 }
    }
    const g = yolo.applyGoalAbandon(cwd, ref.id, sessionId)
    return g
      ? { ok: true, item: g as unknown as Record<string, unknown> }
      : { ok: false, error: 'goal not found', httpStatus: 404 }
  }

  if (action === 'set_progress') {
    if (kind !== 'goal' || typeof r.progress !== 'number' || !Number.isFinite(r.progress)) {
      return { ok: false, error: 'set_progress requires kind=goal and progress', httpStatus: 400 }
    }
    const g = yolo.applyGoalProgress(cwd, ref, r.progress, typeof r.note === 'string' ? r.note : undefined, sessionId)
    return g
      ? { ok: true, item: g as unknown as Record<string, unknown> }
      : { ok: false, error: 'goal not found', httpStatus: 404 }
  }

  if (action === 'set_status') {
    const status = String(r.status ?? '')
    if (kind !== 'milestone' || !MILESTONE_STATUSES.includes(status as MilestoneStatus)) {
      return { ok: false, error: 'set_status requires kind=milestone and status in planned|active|done|abandoned', httpStatus: 400 }
    }
    const m = yolo.applyMilestoneStatus(cwd, ref, status as MilestoneStatus, sessionId)
    return m
      ? { ok: true, item: m as unknown as Record<string, unknown> }
      : { ok: false, error: 'milestone not found', httpStatus: 404 }
  }

  // ---- todo plan edits + state flow ----
  if (action === 'update') {
    if (kind !== 'todo') return { ok: false, error: 'update requires kind=todo', httpStatus: 400 }
    const patch: { title?: string; due_at?: string | null; priority?: Priority | null; milestone_id?: string | null } = {}
    if (typeof r.title === 'string' && r.title.trim()) patch.title = r.title.trim()
    if (r.due_at !== undefined) patch.due_at = typeof r.due_at === 'string' && r.due_at ? r.due_at : null
    if (r.priority !== undefined) patch.priority = toPriority(r.priority)
    if (r.milestone_title !== undefined) {
      patch.milestone_id = r.milestone_title ? yolo.findMilestoneId(cwd, r.milestone_title) : null
    }
    if (Object.keys(patch).length === 0) {
      return { ok: false, error: 'update requires at least one of title/due_at/priority/milestone_title', httpStatus: 400 }
    }
    const t = ref.id ? yolo.applyTodoUpdate(cwd, ref.id, patch, sessionId) : null
    return t
      ? { ok: true, item: t as unknown as Record<string, unknown> }
      : { ok: false, error: 'todo not found', httpStatus: 404 }
  }

  if (kind !== 'todo' || !TODO_ACTIONS.includes(action as TodoAction)) {
    return { ok: false, error: `unsupported action "${action}" for kind "${kind}"`, httpStatus: 400 }
  }
  if (action === 'postpone' && typeof r.due_at !== 'string') {
    return { ok: false, error: 'postpone requires due_at (absolute date YYYY-MM-DD)', httpStatus: 400 }
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
    : { ok: false, error: 'todo not found', httpStatus: 404 }
}
