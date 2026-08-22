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
  /** Due-date window [rangeFrom, rangeTo] (local YYYY-MM-DD, inclusive).
   * Either side may be null (open-ended); both null = no window. Todos
   * without a due date drop out while a window is active. */
  rangeFrom: string | null
  rangeTo: string | null
}

export const DEFAULT_FILTER: KanbanFilter = {
  preset: 'all',
  focus: null,
  inProgressOnly: false,
  overdueOnly: false,
  staleOnly: false,
  milestoneTitle: null,
  keyword: null,
  rangeFrom: null,
  rangeTo: null,
}

/** Quick due-date windows offered by the filter menu. */
export type RangePresetKind = 'today' | 'thisWeek' | 'thisMonth'

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return localDateStr(d)
}

/** Resolve a quick window to concrete [from, to] (local YYYY-MM-DD, inclusive). */
export function rangeOfPreset(kind: RangePresetKind, today = localDateStr()): { rangeFrom: string; rangeTo: string } {
  if (kind === 'today') return { rangeFrom: today, rangeTo: today }
  if (kind === 'thisWeek') {
    // Monday..Sunday of the current week (local)
    const offset = (new Date(`${today}T00:00:00`).getDay() + 6) % 7
    const monday = addDays(today, -offset)
    return { rangeFrom: monday, rangeTo: addDays(monday, 6) }
  }
  const ym = today.slice(0, 7)
  return { rangeFrom: `${ym}-01`, rangeTo: localDateStr(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)) }
}

/** Inverse of rangeOfPreset for the select control; 'custom' when a window is
 * set but matches no preset, null when no window is active. */
export function matchRangePreset(from: string | null, to: string | null, today = localDateStr()): RangePresetKind | 'custom' | null {
  if (from === null && to === null) return null
  for (const k of ['today', 'thisWeek', 'thisMonth'] as const) {
    const p = rangeOfPreset(k, today)
    if (p.rangeFrom === from && p.rangeTo === to) return k
  }
  return 'custom'
}

/** Compact chip label for the active window, e.g. "8/18~8/24". */
export function rangeLabel(from: string | null, to: string | null): string {
  const short = (d: string): string => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
  if (from !== null && to !== null) return `${short(from)}~${short(to)}`
  if (from !== null) return `${short(from)} 起`
  if (to !== null) return `至 ${short(to)}`
  return ''
}

/** Any non-default detail filter or focus active? (drives the 筛选 chip) */
export function hasDetailFilter(f: KanbanFilter): boolean {
  return (
    f.focus !== null ||
    f.inProgressOnly ||
    f.overdueOnly ||
    f.staleOnly ||
    f.milestoneTitle !== null ||
    (f.keyword !== null && f.keyword !== '') ||
    f.rangeFrom !== null ||
    f.rangeTo !== null
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
    if (f.rangeFrom !== null || f.rangeTo !== null) {
      const due = dayOf(t.due_at)
      if (!due) return false
      if (f.rangeFrom !== null && due < f.rangeFrom) return false
      if (f.rangeTo !== null && due > f.rangeTo) return false
    }
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
