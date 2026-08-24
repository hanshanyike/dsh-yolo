import { localDateStr } from './text.ts'

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/u
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u
const OFFSET_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/iu

export interface ParsedDueAt {
  kind: 'date' | 'datetime'
  timestamp: number
  localDate: string
}

function localTimestamp(parts: readonly number[], endOfDay: boolean): number | undefined {
  const [year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0] = parts
  const date = new Date(
    year!,
    month! - 1,
    day!,
    endOfDay ? 23 : hour,
    endOfDay ? 59 : minute,
    endOfDay ? 59 : second,
    endOfDay ? 999 : millisecond,
  )
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month! - 1
    || date.getDate() !== day
    || (!endOfDay && (
      date.getHours() !== hour
      || date.getMinutes() !== minute
      || date.getSeconds() !== second
      || date.getMilliseconds() !== millisecond
    ))
  ) return undefined
  return date.getTime()
}

/**
 * Parse the persisted due_at contract into one instant and one local calendar
 * day. Date-only values mean the end of that local day; datetimes without a
 * zone are local wall-clock times; Z/offset datetimes preserve their instant.
 */
export function parseDueAt(value: string | null | undefined): ParsedDueAt | null {
  if (!value) return null
  const input = value.trim()
  const dateOnly = DATE_ONLY.exec(input)
  if (dateOnly) {
    const timestamp = localTimestamp(dateOnly.slice(1).map(Number), true)
    return timestamp === undefined ? null : { kind: 'date', timestamp, localDate: input }
  }

  const local = LOCAL_DATETIME.exec(input)
  if (local) {
    const parts = local.slice(1, 7).map((part) => Number(part ?? 0))
    parts.push(Number((local[7] ?? '').padEnd(3, '0') || 0))
    const timestamp = localTimestamp(parts, false)
    return timestamp === undefined
      ? null
      : { kind: 'datetime', timestamp, localDate: localDateStr(new Date(timestamp)) }
  }

  if (!OFFSET_DATETIME.test(input)) return null
  const calendar = DATE_ONLY.exec(input.slice(0, 10))
  if (!calendar || localTimestamp(calendar.slice(1).map(Number), false) === undefined) return null
  const timestamp = Date.parse(input)
  return Number.isFinite(timestamp)
    ? { kind: 'datetime', timestamp, localDate: localDateStr(new Date(timestamp)) }
    : null
}

export function dueAtTimestamp(value: string | null | undefined): number | undefined {
  return parseDueAt(value)?.timestamp
}

export function dueAtLocalDate(value: string | null | undefined): string | undefined {
  return parseDueAt(value)?.localDate
}

/** True when the due instant is at or inside the optional lead window. */
export function isDueAtReached(value: string | null | undefined, now = new Date(), aheadMs = 0): boolean {
  const timestamp = dueAtTimestamp(value)
  return timestamp !== undefined && timestamp <= now.getTime() + Math.max(0, aheadMs)
}

/** Overdue is strict: an open todo becomes overdue only after its due instant. */
export function isTodoOverdue(value: string | null | undefined, status: string, now = new Date()): boolean {
  if (status === 'done' || status === 'completed' || status === 'cancelled') return false
  const timestamp = dueAtTimestamp(value)
  return timestamp !== undefined && timestamp < now.getTime()
}

export function compareDueAt(a: string | null | undefined, b: string | null | undefined): number {
  const left = dueAtTimestamp(a) ?? Number.POSITIVE_INFINITY
  const right = dueAtTimestamp(b) ?? Number.POSITIVE_INFINITY
  return left - right
}
