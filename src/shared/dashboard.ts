// YOLO dashboard payload — the cross-boundary shape served by the host
// (ui plugin) at GET /yolo/dashboard and consumed by the browser bundle to
// render the sidebar dashboard. Shared so both halves stay in sync.

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

/** Complete dashboard projection served by the host. */
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

/** Latest user-facing text of one row, for compact list rendering. */
export function todoSummary(row: YoloTodoRow): string {
  const parts = [row.title]
  if (row.due_at) parts.push(`截止 ${row.due_at}`)
  if (row.priority && row.priority !== 'normal') parts.push(`[${row.priority}]`)
  return parts.join(' ')
}
