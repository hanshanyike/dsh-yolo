// YOLO reminder scheduler — time-triggered proactive reminders.
// Scans due todos on an interval; injects a user-visible reminder into the most
// recent active agent (with followup wake), or queues it as pending for replay
// on the next agent/session-start. `last_reminded_at` prevents re-firing.

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type Yolo from '../storage/index.ts'
import { DEFAULTS } from '../shared/constants.ts'
import { localDateStr } from '../shared/text.ts'

/** Minimal structural view of a dsh Agent (avoids linking the agent package). */
export interface AgentLike {
  inject(message: unknown): void
  followup(message?: unknown): void
}

export interface SchedulerDeps {
  yolo: Yolo
  cwd: () => string
  getLatestAgent: () => AgentLike | undefined
  intervalMs?: number
  aheadMs?: number
}

export interface TickResult {
  reminded: number
  queued: number
}

export function reminderText(title: string, dueAt?: string | null): string {
  return `⏰ 提醒: ${title}${dueAt ? ` (到期 ${dueAt})` : ''}`
}

/** Format a Date as local-time "YYYY-MM-DDTHH:mm:ss" (no timezone suffix). */
function localIso(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Write today's Markdown snapshot once per calendar day. Returns the path or null. */
export function maybeWriteDailySnapshot(yolo: Yolo, cwd: () => string): string | null {
  const today = localDateStr()
  if (yolo.lastSnapshotDate(cwd()) === today) return null
  const path = yolo.writeSnapshot(cwd(), today)
  yolo.setSnapshotDate(cwd(), today)
  return path
}

/**
 * Write a timestamped Markdown snapshot on a turn cadence ('every_10_turns').
 * The caller counts turns; this fires once per N turns with a unique filename.
 * Returns the path or null when the cadence has not been reached.
 */
export function maybeWriteTurnSnapshot(yolo: Yolo, cwd: () => string, turnCount: number, every = 10): string | null {
  if (turnCount <= 0 || turnCount % every !== 0) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return yolo.writeSnapshot(cwd(), `turn-${turnCount}-${stamp}`)
}

/** One scheduler pass — pure enough to unit test with a mocked yolo. */
export function runReminderTick(deps: {
  yolo: Yolo
  cwd: () => string
  aheadMs: number
  getLatestAgent: () => AgentLike | undefined
}): TickResult {
  const cwd = deps.cwd()
  // due_at is stored either as a local date (YYYY-MM-DD, from rule capture) or a
  // full ISO datetime. Compare in LOCAL time so a date-only due date fires from
  // local midnight — toISOString() would lag by the UTC offset (up to 8h in UTC+8).
  const aheadIso = localIso(new Date(Date.now() + deps.aheadMs))
  const due = deps.yolo.listDueTodos(cwd, aheadIso)

  let reminded = 0
  let queued = 0
  for (const t of due) {
    const text = reminderText(t.title, t.due_at)
    const msg = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    const agent = deps.getLatestAgent()
    if (agent) {
      agent.inject(msg)
      agent.followup()
      reminded++
    } else {
      // no active session — queue for replay on agent/session-start
      deps.yolo.queueReminder(cwd, { todo_id: t.id, fire_at: Date.now(), payload: text })
      queued++
    }
    deps.yolo.setTodoReminded(cwd, t.id)
  }
  return { reminded, queued }
}

/** Create a scheduler; returns a cleanup function for ctx.effect. */
export function startReminderScheduler(ctx: Context, deps: SchedulerDeps): () => void {
  const intervalMs = deps.intervalMs ?? DEFAULTS.reminderCheckIntervalSec * 1000
  const aheadMs = deps.aheadMs ?? DEFAULTS.reminderAheadMin * 60_000

  const tick = (): void => {
    try {
      runReminderTick({ yolo: deps.yolo, cwd: deps.cwd, aheadMs, getLatestAgent: deps.getLatestAgent })
      maybeWriteDailySnapshot(deps.yolo, deps.cwd)
    } catch (e) {
      ctx.logger?.warn?.('[yolo-reminder] tick failed: %s', e instanceof Error ? e.message : String(e))
    }
  }

  const timer = setInterval(tick, intervalMs)
  return () => clearInterval(timer)
}
