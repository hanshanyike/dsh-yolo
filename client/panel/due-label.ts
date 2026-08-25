import { parseDueAt } from '../../src/shared/due.ts'
import { localDateStr } from '../../src/shared/text.ts'

const DAY_MS = 86_400_000

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function addLocalDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00`)
  date.setDate(date.getDate() + amount)
  return localDateStr(date)
}

/** User-facing due label. Persisted ISO stays in <time dateTime>, never in text. */
export function formatDueLabel(value: string | null | undefined, now = new Date()): string {
  if (!value) return '不限期'
  const parsed = parseDueAt(value)
  if (!parsed) return '截止时间待确认'

  const today = localDateStr(now)
  const day = parsed.localDate
  const clock = parsed.kind === 'datetime'
    ? ` ${pad(new Date(parsed.timestamp).getHours())}:${pad(new Date(parsed.timestamp).getMinutes())}`
    : ''

  if (day === today) return `今天${clock}`
  if (day === addLocalDays(today, 1)) return `明天${clock}`
  if (day === addLocalDays(today, -1)) return `昨天${clock}`

  const distance = Math.round(
    (new Date(`${day}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / DAY_MS,
  )
  const monthDay = `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`
  if (distance > 1 && distance <= 7) {
    return `周${'日一二三四五六'[new Date(`${day}T00:00:00`).getDay()]} · ${monthDay}${clock}`
  }
  return `${monthDay}${clock}`
}
