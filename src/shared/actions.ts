// YOLO action request — the shared contract for in-place plan operations.
// One validation + dispatch path serves all three entrances (M8): the
// yolo_action model tool, the extraction update applier, and the dashboard
// POST /yolo/actions endpoint, so behavior and audit stay identical.

import type Yolo from '../storage/index.ts'
import type { MilestoneStatus, TodoAction } from '../storage/types.ts'

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

/** Validate + dispatch one action request against the YOLO store. Never throws. */
export function applyYoloAction(yolo: Yolo, cwd: string, r: YoloActionRequest): YoloActionOutcome {
  const action = String(r.action ?? '')
  const kind = String(r.kind ?? '')
  const ref: { id?: string; title?: string } = {
    id: typeof r.id === 'string' && r.id ? r.id : undefined,
    title: typeof r.title === 'string' && r.title ? r.title : undefined,
  }
  if (!ref.id && !ref.title) return { ok: false, error: 'pass id or title', httpStatus: 400 }

  if (action === 'set_progress') {
    if (kind !== 'goal' || typeof r.progress !== 'number' || !Number.isFinite(r.progress)) {
      return { ok: false, error: 'set_progress requires kind=goal and progress', httpStatus: 400 }
    }
    const g = yolo.applyGoalProgress(cwd, ref, r.progress, typeof r.note === 'string' ? r.note : undefined)
    return g
      ? { ok: true, item: g as unknown as Record<string, unknown> }
      : { ok: false, error: 'goal not found', httpStatus: 404 }
  }

  if (action === 'set_status') {
    const status = String(r.status ?? '')
    if (kind !== 'milestone' || !MILESTONE_STATUSES.includes(status as MilestoneStatus)) {
      return { ok: false, error: 'set_status requires kind=milestone and status in planned|active|done|abandoned', httpStatus: 400 }
    }
    const m = yolo.applyMilestoneStatus(cwd, ref, status as MilestoneStatus)
    return m
      ? { ok: true, item: m as unknown as Record<string, unknown> }
      : { ok: false, error: 'milestone not found', httpStatus: 404 }
  }

  if (kind !== 'todo' || !TODO_ACTIONS.includes(action as TodoAction)) {
    return { ok: false, error: `unsupported action "${action}" for kind "${kind}"`, httpStatus: 400 }
  }
  if (action === 'postpone' && typeof r.due_at !== 'string') {
    return { ok: false, error: 'postpone requires due_at (absolute date YYYY-MM-DD)', httpStatus: 400 }
  }
  const t = yolo.applyTodoAction(
    cwd,
    ref,
    action as TodoAction,
    action === 'postpone' ? { due_at: r.due_at as string } : undefined,
  )
  return t
    ? { ok: true, item: t as unknown as Record<string, unknown> }
    : { ok: false, error: 'todo not found', httpStatus: 404 }
}
