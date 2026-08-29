import { dueAtLocalDate } from './due.ts'
import { localDateStr } from './text.ts'

export type TodoRangeField = 'due_at' | 'created_at'
export type TodoRangeAction = 'bulk_cancel' | 'bulk_delete'

export interface TodoRangeSelector {
  field: TodoRangeField
  from: string
  to: string
}

export interface TodoRangeRow {
  created_at?: number
  due_at?: string | null
  record_status?: string | null
  status: string
}

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u

/** Strict local calendar date validation; Date.parse would normalize invalid days. */
export function isLocalDateValue(value: string): boolean {
  const match = LOCAL_DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

export function validateTodoRange(selector: TodoRangeSelector): string | null {
  if (selector.field !== 'due_at' && selector.field !== 'created_at') return 'range_field must be due_at|created_at'
  if (!isLocalDateValue(selector.from) || !isLocalDateValue(selector.to)) {
    return 'range_from and range_to must be valid local dates (YYYY-MM-DD)'
  }
  if (selector.from > selector.to) return 'range_from must be on or before range_to'
  return null
}

export function todoRangeDate(row: TodoRangeRow, field: TodoRangeField): string | null {
  if (field === 'due_at') return dueAtLocalDate(row.due_at) ?? null
  if (typeof row.created_at !== 'number' || !Number.isFinite(row.created_at)) return null
  return localDateStr(new Date(row.created_at))
}

/** Range endpoints are inclusive local calendar days. */
export function matchesTodoRange(row: TodoRangeRow, selector: TodoRangeSelector): boolean {
  const date = todoRangeDate(row, selector.field)
  return date !== null && date >= selector.from && date <= selector.to
}

export function isTodoRangeEligible(row: TodoRangeRow, action: TodoRangeAction): boolean {
  if ((row.record_status ?? 'canonical') !== 'canonical') return false
  if (action === 'bulk_delete') return true
  return row.status === 'pending' || row.status === 'in_progress'
}

export function selectTodosInRange<T extends TodoRangeRow>(
  rows: readonly T[],
  selector: TodoRangeSelector,
  action: TodoRangeAction,
): T[] {
  return rows.filter((row) => isTodoRangeEligible(row, action) && matchesTodoRange(row, selector))
}
