export type HistoryChangeValue = string | number | boolean | null

export interface HistoryFieldChange {
  before: HistoryChangeValue
  after: HistoryChangeValue
}

export type HistoryChangeSet = Record<string, HistoryFieldChange>
export type {
  YoloHistoryData,
  YoloHistoryEvent,
  YoloHistoryItem,
  YoloHistoryStatusFilter,
  YoloHistorySubjectRef,
  YoloHistoryView,
} from '../shared/history.ts'
