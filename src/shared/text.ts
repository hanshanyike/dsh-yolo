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
