// YOLO shared text helpers — used by storage, extract, memory and ui.
// Centralized so dedup/formatting behavior cannot drift between plugins.

/**
 * Concatenate the text content blocks of a message.
 * Accepts the loose structural shape so session-event payloads need no cast.
 */
export function contentBlocksToText(blocks: readonly unknown[] | undefined | null): string {
  if (!blocks) return ''
  const parts: string[] = []
  for (const b of blocks) {
    if (typeof b === 'object' && b !== null) {
      const { type, text } = b as { type?: unknown; text?: unknown }
      if (type === 'text' && typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('\n')
}

/** Normalize a title for cross-message dedup: lowercase + collapse non-alphanumerics. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Local-time "YYYY-MM-DD" — toISOString().slice(0,10) would lag by the UTC offset. */
export function localDateStr(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Authoritative local clock context for relative dates in long-lived sessions. */
export function localClockGuidance(now = new Date()): string {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const offsetMinutes = -now.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteOffset = Math.abs(offsetMinutes)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const offset = `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`
  return `Current local time: ${localDateStr(now)} ${pad(now.getHours())}:${pad(now.getMinutes())} UTC${offset}; today=${localDateStr(now)}; tomorrow=${localDateStr(tomorrow)}. This clock is authoritative: resolve relative dates from it, never from conversation history or stored reminders.`
}

const DAY_MS = 86_400_000

/** Local-day bounds [from, to) in epoch ms for a "YYYY-MM-DD" string (ledger, briefs). */
export function dayBounds(day: string): { from: number; to: number } {
  const from = new Date(`${day}T00:00:00`).getTime()
  return { from, to: from + DAY_MS }
}

/** Local-time "HH:mm" of a Date — brief trigger comparison. */
export function localHm(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}
