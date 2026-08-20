// YOLO reminder plugin — wires the scheduler + session-start replay.

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type Yolo from '../storage/index.ts'
import { startReminderScheduler, type AgentLike } from './scheduler.ts'

export const name = 'yolo-reminder'
export const inject = ['yolo', 'agents'] as const

interface ReminderCtx extends Context {
  yolo: Yolo
}

export function apply(ctx: Context): void {
  const yctx = ctx as unknown as ReminderCtx
  let latestAgent: AgentLike | undefined

  // remember the most recent active agent + replay any pending reminders
  ctx.on('agent/session-start', (payload) => {
    const agent = payload.agent as unknown as AgentLike
    latestAgent = agent
    const cwd = process.cwd()
    const pending = yctx.yolo.listPendingReminders(cwd)
    for (const p of pending.slice(0, 5)) {
      try {
        agent.inject(createUserMessage({ content: [{ type: 'text', text: p.payload }], source: { kind: 'user' } }))
        agent.followup()
        yctx.yolo.deletePendingReminder(cwd, p.id)
      } catch (e) {
        ctx.logger?.warn?.('[yolo-reminder] replay failed: %s', e instanceof Error ? e.message : String(e))
      }
    }
  })

  // scheduler lives for the plugin lifetime; cleanup on unload
  ctx.effect(() =>
    startReminderScheduler(ctx, {
      yolo: yctx.yolo,
      cwd: () => process.cwd(),
      getLatestAgent: () => latestAgent,
    }),
  )

  ctx.logger?.info?.('[yolo] reminder plugin loaded')
}
