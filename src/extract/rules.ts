// YOLO rule capture — cheap, per-message signal extraction (the "hybrid" fast path).
// Regular expressions recognize explicit/intent signals for todos, deadlines,
// milestones, goals, preferences and decisions. LLM extraction (llm-extract.ts)
// runs at turn end for the full structured pass.

import type { Priority } from '../storage/types.ts'
import { normalizeTitle as normalizeText } from '../shared/text.ts'

export { normalizeText }

export type CandidateKind = 'todo' | 'milestone' | 'goal' | 'preference' | 'decision'

/** A captured candidate before it is merged into storage. */
export interface Candidate {
  kind: CandidateKind
  dedupKey: string
  title: string
  detail?: string | null
  dueAt?: string | null
  priority?: Priority | null
  targetDate?: string | null
  prefKey?: string | null
  prefValue?: string | null
}

/** Parse a relative/absolute date phrase to ISO date (YYYY-MM-DD), or null. */
export function parseDate(text: string, now = new Date()): string | null {
  const t = text.trim().toLowerCase()
  // explicit "8/20前", "8月20日前"
  let m = t.match(/(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?\s*前/)
  if (m) {
    const month = Number(m[1])
    const day = Number(m[2])
    // Roll to next year only when the date is strictly in the past:
    // month strictly earlier, or same month with a day already gone.
    // (Naive `month < now.getMonth() + 1` misfires on the current month:
    //  on 8/20, "8/20前" and "8/25前" would both wrongly become next year.)
    const curMonth = now.getMonth() + 1
    const curDay = now.getDate()
    const pastMonth = month < curMonth
    const sameMonthPastDay = month === curMonth && day < curDay
    const year = pastMonth || sameMonthPastDay ? now.getFullYear() + 1 : now.getFullYear()
    return `${year}-${pad(month)}-${pad(day)}`
  }
  // 明天 / tomorrow
  if (/明天|tomorrow/.test(t)) return isoAdd(now, 1)
  // 后天 / day after tomorrow
  if (/后天/.test(t)) return isoAdd(now, 2)
  // 本周末 / this weekend
  if (/本周末|这个周末/.test(t)) {
    const day = now.getDay()
    const diff = day === 0 ? 0 : 7 - day // Sunday(0) is the weekend itself; else next Sunday
    return isoAdd(now, diff)
  }
  // 本月底 / end of month
  if (/本月底|这个月底/.test(t)) {
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`
  }
  // 下周[一二三四五六日天]? — bare "下周" = next week, same weekday (+7)
  m = t.match(/下周([一二三四五六日天])?/)
  if (m) {
    if (m[1]) {
      const weekdayMap: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }
      const target = weekdayMap[m[1]] ?? 1
      const cur = now.getDay()
      let diff = (target - cur + 7) % 7
      diff = diff === 0 ? 7 : diff // next week, not this week
      return isoAdd(now, 7 + diff)
    }
    return isoAdd(now, 7)
  }
  // next week (english)
  if (/next week/.test(t)) return isoAdd(now, 7)
  // this week
  if (/this week|本周/.test(t)) return isoAdd(now, 7)
  return null
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isoAdd(now: Date, days: number): string {
  const d = new Date(now)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Extract candidates from one message's text. Pure + side-effect free. */
export function extractCandidates(text: string, now = new Date()): Candidate[] {
  const out: Candidate[] = []
  const lines = text.split(/\n+/)

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const t = line.replace(/^[>#\-\s*]+/, '')

    // explicit todo: "待办: 完成报告", "todo: write tests"
    const todo = t.match(/^(?:待办|todo|要做|需要|记得|别忘了|记住)\s*[:：]?\s*(.+)$/i)
    if (todo) {
      const title = todo[1].trim()
      out.push({
        kind: 'todo',
        dedupKey: `todo:${normalizeText(title)}`,
        title,
        dueAt: parseDate(title, now),
      })
      continue
    }

    // deadline in a sentence: "在 8/20 前完成报告"
    const due = t.match(/(\d{1,2}\s*[\/月]\s*\d{1,2}\s*日?\s*前|明天|后天|下周[一二三四五六日天]?|本周末|本月底|tomorrow|next week)/i)
    if (due && /(完成|提交|搞定|做完|交付|写|做)/.test(t)) {
      const dueAt = parseDate(due[1], now)
      if (dueAt) {
        const title = t
          .replace(/(?:在|于)?\s*\d{1,2}\s*[\/月]\s*\d{1,2}\s*日?\s*前|明天|后天|下周[一二三四五六日天]?|本周末|本月底|tomorrow|next week/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
        if (title) out.push({ kind: 'todo', dedupKey: `todo:${normalizeText(title)}`, title, dueAt })
      }
      continue
    }

    // milestone
    const ms = t.match(/^(?:里程碑|阶段|milestone)\s*[:：]?\s*(.+)$/i)
    if (ms) {
      const title = ms[1].trim()
      out.push({ kind: 'milestone', dedupKey: `ms:${normalizeText(title)}`, title, targetDate: parseDate(title, now) })
      continue
    }

    // goal
    const goal = t.match(/^(?:我的)?目标(?:是|：|:)?\s*(.+)$/)
    if (goal) {
      const title = goal[1].trim()
      out.push({ kind: 'goal', dedupKey: `goal:${normalizeText(title)}`, title })
      continue
    }

    // preference (allow zero-space: 我喜欢用中文回复)
    const pref = t.match(/^(?:我喜欢|我习惯|我偏好|我讨厌|prefer|i like|i prefer)\s*(.+)$/i)
    if (pref) {
      const value = pref[1].trim()
      const key = normalizeText(value).split(' ')[0] || 'style'
      out.push({ kind: 'preference', dedupKey: `pref:${key}`, title: value, prefKey: key, prefValue: value })
      continue
    }

    // decision -> timeline event (allow zero-space: 我决定采用SQLite)
    const dec = t.match(/^(?:决定|我决定|选择了|我选|chose|decided)\s*(.+)$/i)
    if (dec) {
      const summary = dec[1].trim()
      out.push({ kind: 'decision', dedupKey: `evt:decision:${normalizeText(summary)}`, title: summary })
      continue
    }
  }

  return out
}
