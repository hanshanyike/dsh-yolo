// YOLO dashboard payload — the cross-boundary shape published by the host
// (ui plugin) as a durable 'yolo/snapshot' session event and consumed by the
// browser bundle to render the YOLO tab. Shared so both halves stay in sync.

/** Compact row shapes (a projection of the storage rows, safe for serialization). */
export interface YoloTodoRow {
  id: string
  title: string
  status: string
  priority?: string | null
  due_at?: string | null
}
export interface YoloGoalRow {
  id: string
  title: string
  status: string
  progress: number
}
export interface YoloMilestoneRow {
  id: string
  title: string
  status: string
  target_date?: string | null
}
export interface YoloEventRow {
  id: string
  kind: string
  summary: string
  occurred_at: number
}
export interface YoloPreferenceRow {
  id: string
  key: string
  value: string
}

/** Complete dashboard projection published by the host. */
export interface YoloDashboardData {
  scopeKey: string
  cwd: string
  at: number
  todos: YoloTodoRow[]
  goals: YoloGoalRow[]
  milestones: YoloMilestoneRow[]
  events: YoloEventRow[]
  preferences: YoloPreferenceRow[]
}

/** Immutable per-Session view snapshot produced by the browser builder. */
export interface YoloSnapshot {
  scopeKey: string
  cwd: string
  at: number
  todos: readonly YoloTodoRow[]
  goals: readonly YoloGoalRow[]
  milestones: readonly YoloMilestoneRow[]
  events: readonly YoloEventRow[]
  preferences: readonly YoloPreferenceRow[]
}

/** Stable empty snapshot until a 'yolo/snapshot' event has assembled. */
export const EMPTY_YOLO_SNAPSHOT: YoloSnapshot = {
  scopeKey: '',
  cwd: '',
  at: 0,
  todos: [],
  goals: [],
  milestones: [],
  events: [],
  preferences: [],
}

/** Latest user-facing text of one row, for compact list rendering. */
export function todoSummary(row: YoloTodoRow): string {
  const parts = [row.title]
  if (row.due_at) parts.push(`截止 ${row.due_at}`)
  if (row.priority && row.priority !== 'normal') parts.push(`[${row.priority}]`)
  return parts.join(' ')
}
