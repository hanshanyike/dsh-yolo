import type { HistoryChangeSet, HistorySubjectType } from '../domain/types.ts'
import type { WorkspaceTag } from './dashboard.ts'

export type YoloHistoryView = 'timeline' | 'items' | 'subject'
export type YoloHistoryStatusFilter = 'all' | 'open' | 'ended' | 'completed' | 'cancelled'

export interface YoloHistorySubjectRef {
  type: HistorySubjectType
  id: string
  title: string
}

export interface YoloHistoryEvent {
  id: string
  kind: string
  summary: string
  detail?: string | null
  occurred_at: number
  label: string
  session_id?: string | null
  subject?: YoloHistorySubjectRef
  related_subject?: YoloHistorySubjectRef
  change?: HistoryChangeSet | null
  scope_cwd: string
  ws: WorkspaceTag
}

export interface YoloHistoryItem {
  type: HistorySubjectType
  id: string
  title: string
  status: string
  record_status?: string
  merged_into_id?: string | null
  merge_undo_available?: boolean
  last_changed_at: number
  change_count: number
  latest_summary: string | null
  scope_cwd: string
  ws: WorkspaceTag
}

export interface YoloHistoryData {
  view: YoloHistoryView
  openedAt: number
  events: YoloHistoryEvent[]
  items: YoloHistoryItem[]
  nextCursor: string | null
  partial: boolean
  workspaceErrors: string[]
  revision: number
}
