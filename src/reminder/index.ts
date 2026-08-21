// YOLO reminder plugin — wires the scheduler, session-start replay, and the
// turn-cadence snapshot trigger ('every_10_turns' storage interval).

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type Yolo from '../storage/index.ts'
import { startReminderScheduler, maybeWriteTurnSnapshot, type AgentLike } from './scheduler.ts'
import { sessionCwd } from '../shared/session.ts'

export const name = 'yolo-reminder'
export const inject = ['yolo', 'agents', 'settings'] as const

interface ReminderCtx extends Context {
  yolo: Yolo
}

/** Minimal structural view of the dsh settings service (config read per turn). */
interface SettingsLike {
  get(ns: unknown): { storage?: { snapshotInterval?: string } } | undefined
}

/** Storage snapshot cadence the user can pick in Settings. */
export const YOLO_NS = settingsNamespace('yolo')

/** Workspace cwd of an agent's session, when the payload carries one. */
function agentCwd(agent: unknown): string | undefined {
  return sessionCwd((agent as { session?: unknown })?.session)
}

export function apply(ctx: Context): void {
  const yctx = ctx as ReminderCtx
  const settings = (ctx as { settings?: SettingsLike }).settings
  let latestAgent: AgentLike | undefined
  // the workspace reminders/snapshots operate on — follows the latest session
  // (extraction writes under the session cwd; process.cwd() would miss it)
  let latestCwd: string | undefined

  // remember the most recent active agent + replay any pending reminders
  ctx.on('agent/session-start', (payload: { agent: unknown }) => {
    const agent = payload.agent as AgentLike
    latestAgent = agent
    const cwd = agentCwd(payload.agent) ?? process.cwd()
    latestCwd = cwd
    const pending = yctx.yolo.listPendingReminders(cwd)
    for (const p of pending.slice(0, 5)) {
      try {
        agent.followup(createUserMessage({ content: [{ type: 'text', text: p.payload }], source: { kind: 'user' } }))
        yctx.yolo.deletePendingReminder(cwd, p.id)
      } catch (e) {
        ctx.logger?.warn?.('[yolo-reminder] replay failed: %s', e instanceof Error ? e.message : String(e))
      }
    }
  })

  // turn-cadence snapshot: 'every_10_turns' writes a timestamped Markdown
  // snapshot every 10 finished turns (config read live via ctx.settings)
  let turnCount = 0
  ctx.on('agent/turn-stopping', (payload: { agent?: { session?: unknown } }) => {
    turnCount++
    try {
      const cwd = agentCwd(payload?.agent)
      if (cwd) latestCwd = cwd
      const config = settings?.get(YOLO_NS)
      if (config?.storage?.snapshotInterval === 'every_10_turns') {
        const path = maybeWriteTurnSnapshot(yctx.yolo, () => latestCwd ?? process.cwd(), turnCount)
        if (path) ctx.logger?.info?.('[yolo-reminder] turn snapshot written: %s', path)
      }
    } catch (e) {
      ctx.logger?.warn?.('[yolo-reminder] turn snapshot failed: %s', e instanceof Error ? e.message : String(e))
    }
  })

  // scheduler lives for the plugin lifetime; cleanup on unload
  ctx.effect(() =>
    startReminderScheduler(ctx, {
      yolo: yctx.yolo,
      cwd: () => latestCwd ?? process.cwd(),
      getLatestAgent: () => latestAgent,
    }),
  )

  ctx.logger?.info?.('[yolo] reminder plugin loaded')
}
