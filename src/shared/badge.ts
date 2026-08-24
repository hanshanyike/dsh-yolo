/** Minimal reminder preview carried by the lightweight sidebar feed. */
export interface YoloBadgeNotification {
  id: string
  kind: 'reminder' | 'brief'
  title: string
  body?: string | null
  todo_id?: string | null
  /** Owning workspace, so equal row ids in different stores stay distinct. */
  scope_cwd?: string
  created_at: number
}

/** Lightweight sidebar badge payload. Deliberately independent from the full dashboard. */
export interface YoloBadgeData {
  unhandled: number
  /** Bounded newest-first reminder feed for the in-app popup. */
  recentReminders?: YoloBadgeNotification[]
  /** True when at least one known workspace could not be counted. */
  partial?: boolean
}
