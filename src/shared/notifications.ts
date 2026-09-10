import type { WorkspaceTag } from './dashboard.ts'

export interface YoloNotificationTodoRef {
  id: string
  title: string
  status: string
  due_at?: string | null
}

/** One immutable delivery in the notification record. */
export interface YoloNotificationLogItem {
  id: string
  kind: 'reminder' | 'brief'
  title: string
  body?: string | null
  todo_id?: string | null
  scope_cwd: string
  created_at: number
  seen: boolean
  handled: boolean
  ws: WorkspaceTag
  /** Present only while the original todo can still be resolved. */
  todo?: YoloNotificationTodoRef
}

export interface YoloNotificationLogData {
  items: YoloNotificationLogItem[]
  unseen: number
  openedAt: number
  nextCursor: string | null
  partial: boolean
  workspaceErrors: string[]
  revision: number
}

export interface YoloNotificationSeenRequest {
  opened_at?: number
  notification?: { id: string; scope_cwd: string }
}

export interface YoloNotificationSeenOutcome {
  ok: true
  changed: number
  unseen: number
  partial: boolean
  revision: number
}

/**
 * Remove deliveries from the record. Exactly one of the two shapes is used:
 * one delivery (`notification`) or the whole record in every known workspace
 * (`all`). Reads stay the source of truth — a removed delivery disappears from
 * the record, the badge and the dashboard projection alike.
 */
export interface YoloNotificationDismissRequest {
  notification?: { id: string; scope_cwd: string }
  all?: boolean
}

export interface YoloNotificationDismissOutcome {
  ok: true
  /** Rows actually removed; 0 for an already-removed id (idempotent replay). */
  removed: number
  unseen: number
  partial: boolean
  revision: number
}
