// YOLO reminder scheduler — time-triggered proactive reminders.
// Scans due todos on an interval; injects a user-visible reminder into the most
// recent active agent (with followup wake), or queues it as pending for replay
// on the next agent/session-start. `last_reminded_at` prevents re-firing.

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type Yolo from '../storage/index.ts'
import { DEFAULTS } from '../shared/constants.ts'

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

/** One scheduler pass — pure enough to unit test with a mocked yolo. */
export function runReminderTick(deps: {
  yolo: Yolo
  cwd: () => string
  aheadMs: number
  getLatestAgent: () => AgentLike | undefined
}): TickResult {
  const cwd = deps.cwd()
  const aheadIso = new Date(Date.now() + deps.aheadMs).toISOString()
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
    } catch (e) {
      ctx.logger?.warn?.('[yolo-reminder] tick failed: %s', e instanceof Error ? e.message : String(e))
    }
  }

  const timer = setInterval(tick, intervalMs)
  return () => clearInterval(timer)
}
