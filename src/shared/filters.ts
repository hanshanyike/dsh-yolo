// YOLO kanban filtering (v0.3.0 E) — pure logic shared by the browser panel
// and the vitest suite. The panel owns no filtering rules of its own: preset
// tabs, focus buckets and the composable detail filters all resolve here, so
// TE-1..TE-3 semantics are pinned by tests instead of by UI code.

import type { YoloTodoRow } from './dashboard.ts'
import { isTodoOverdue } from './dashboard.ts'
import { localDateStr } from './text.ts'

const DAY_MS = 86_400_000

/** Preset tabs of the filter bar (4.2). */
export type PresetTab = 'today' | 'all' | 'done'

/** Focus pill buckets (4.2). `stale` is a flag, not a due bucket. */
export type FocusBucket = 'overdue' | 'today' | 'week' | 'stale'

/** The full composable filter state of the kanban. */
export interface KanbanFilter {
  preset: PresetTab
  /** Active focus pill, or null when none is selected. */
  focus: FocusBucket | null
  /** Detail filters (筛选▾) — all optional/null, AND-combined. */
  inProgressOnly: boolean
  overdueOnly: boolean
  staleOnly: boolean
  milestoneTitle: string | null
  keyword: string | null
}

export const DEFAULT_FILTER: KanbanFilter = {
  preset: 'all',
  focus: null,
  inProgressOnly: false,
  overdueOnly: false,
  staleOnly: false,
  milestoneTitle: null,
  keyword: null,
}

/** Any non-default detail filter or focus active? (drives the 筛选 chip) */
export function hasDetailFilter(f: KanbanFilter): boolean {
  return (
    f.focus !== null ||
    f.inProgressOnly ||
    f.overdueOnly ||
    f.staleOnly ||
    f.milestoneTitle !== null ||
    (f.keyword !== null && f.keyword !== '')
  )
}

const isOpen = (t: YoloTodoRow): boolean => t.status !== 'done' && t.status !== 'completed' && t.status !== 'cancelled'
const dayOf = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '')

/** Due bucket of one open todo: 逾期 / 今日 / 未来7天 / none. */
export function dueBucket(t: YoloTodoRow, today = localDateStr()): 'overdue' | 'today' | 'week' | 'none' {
  if (!isOpen(t) || !t.due_at) return 'none'
  const due = dayOf(t.due_at)
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  if (new Date(`${due}T00:00:00`).getTime() <= new Date(`${today}T00:00:00`).getTime() + 7 * DAY_MS) return 'week'
  return 'none'
}

/** Focus pill counts over ALL todos (not the filtered list). */
export function focusCounts(todos: readonly YoloTodoRow[], today = localDateStr()): Record<FocusBucket, number> {
  const c: Record<FocusBucket, number> = { overdue: 0, today: 0, week: 0, stale: 0 }
  for (const t of todos) {
    if (!isOpen(t)) continue
    const b = dueBucket(t, today)
    if (b !== 'none') c[b]++
    if (t.stale) c.stale++
  }
  return c
}

/** Apply the whole filter to a todo list. Preset picks the base set; every
 * active detail filter ANDs on top (TE-3). */
export function applyKanbanFilter(
  todos: readonly YoloTodoRow[],
  f: KanbanFilter,
  today = localDateStr(),
): YoloTodoRow[] {
  const kw = f.keyword?.trim().toLowerCase() ?? ''
  return todos.filter((t) => {
    // preset base (TE-1): 今日 = overdue + today-due, never future items
    if (f.preset === 'done') {
      if (isOpen(t)) return false
    } else {
      if (!isOpen(t)) return false
      if (f.preset === 'today') {
        const b = dueBucket(t, today)
        if (b !== 'overdue' && b !== 'today') return false
      }
    }
    if (f.focus) {
      if (!isOpen(t)) return false
      if (f.focus === 'stale') {
        if (!t.stale) return false
      } else if (dueBucket(t, today) !== f.focus) return false
    }
    if (f.inProgressOnly && t.status !== 'in_progress') return false
    if (f.overdueOnly && !isTodoOverdue(t.due_at, t.status, new Date(`${today}T00:00:00`))) return false
    if (f.staleOnly && !t.stale) return false
    if (f.milestoneTitle !== null && (t.milestone_title ?? '') !== f.milestoneTitle) return false
    if (kw && !t.title.toLowerCase().includes(kw)) return false
    return true
  })
}

/** Default kanban ordering: overdue first, then by due date, undated last. */
export function sortForKanban(todos: readonly YoloTodoRow[]): YoloTodoRow[] {
  const rank = (t: YoloTodoRow): number => {
    if (!isOpen(t)) return 3
    if (isTodoOverdue(t.due_at, t.status)) return 0
    return t.due_at ? 1 : 2
  }
  return [...todos].sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    if (a.due_at && b.due_at) return a.due_at < b.due_at ? -1 : a.due_at > b.due_at ? 1 : 0
    if (a.due_at) return -1
    if (b.due_at) return 1
    return 0
  })
}
