// YOLO reminder plugin (v0.3.0) — wires the scheduler and the turn-cadence
// snapshot trigger. Reminders now deliver to the YOLO resident thread + kanban
// notification cards only (D7: work sessions are 100% silent; the old
// session-start replay into whatever session started next is gone — TB-1).

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { createUserMessage, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import type Yolo from '../storage/index.ts'
import { startReminderScheduler, maybeWriteTurnSnapshot, resolveReminderRuntime } from './scheduler.ts'
import { YoloSessions, isYoloSessionId, type AgentLike, type AgentsLike } from '../ui/session.ts'
import { sessionCwd } from '../shared/session.ts'
import { DEFAULTS } from '../shared/constants.ts'

export const name = 'yolo-reminder'
export const inject = ['yolo', 'agents', 'llm', 'settings'] as const

interface ReminderCtx extends Context {
  yolo: Yolo
}

/** Minimal structural view of the dsh settings service (config read per tick). */
interface SettingsLike {
  get(ns: unknown): {
    brief?: { enabled?: boolean; morningTime?: string; eveningTime?: string; model?: string }
    storage?: { snapshotInterval?: string }
    reminder?: { checkIntervalSec?: number; aheadMin?: number; enabled?: boolean; quietHoursEnabled?: boolean; quietStart?: string; quietEnd?: string }
  } | undefined
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
  // the workspace reminders/briefs/snapshots operate on — follows the latest session
  let latestCwd: string | undefined

  const trackCwd = (agent: unknown): void => {
    const cwd = agentCwd(agent)
    if (cwd) latestCwd = cwd
  }
  ctx.on('agent/session-start', (payload: { agent: unknown }) => {
    // YOLO threads (resident + anchored chat) must NOT move the tracked workspace
    if (!isYoloSessionId((payload.agent as { id?: string } | undefined)?.id)) trackCwd(payload.agent)
  })

  // turn-cadence snapshot: 'every_10_turns' writes a timestamped Markdown
  // snapshot every 10 finished turns (config read live via ctx.settings)
  let turnCount = 0
  ctx.on('agent/turn-stopping', (payload: { agent?: { session?: unknown } }) => {
    turnCount++
    try {
      trackCwd(payload?.agent)
      const config = settings?.get(YOLO_NS)
      if (config?.storage?.snapshotInterval === 'every_10_turns') {
        const path = maybeWriteTurnSnapshot(yctx.yolo, () => latestCwd ?? process.cwd(), turnCount)
        if (path) ctx.logger?.info?.('[yolo-reminder] turn snapshot written: %s', path)
      }
    } catch (e) {
      ctx.logger?.warn?.('[yolo-reminder] turn snapshot failed: %s', e instanceof Error ? e.message : String(e))
    }
  })

  // reminder delivery target: the workspace's YOLO resident thread (v0.3.0 B)
  // v0.3.3: created with the harness model selection so the agent replies.
  const sessions = new YoloSessions(
    (ctx as { agents?: AgentsLike }).agents,
    { info: (f, ...a) => ctx.logger?.info?.(f, ...a), warn: (f, ...a) => ctx.logger?.warn?.(f, ...a) },
    () => {
      const sel = (ctx as { get?: (s: string) => { currentSelection(): { provider: string; model: string } } | undefined }).get?.('agentDefaultModel')
      return sel?.currentSelection()
    },
  )
  const deliver = async (cwd: string, text: string): Promise<void> => {
    const agent: AgentLike | undefined = await sessions.ensure(cwd)
    if (!agent) return
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  }

  // scheduler lives for the plugin lifetime; cleanup on unload
  const llm = (ctx as { llm?: LlmRuntime }).llm
  const reminderCfg = (): { checkIntervalSec?: number; aheadMin?: number; enabled?: boolean } | undefined =>
    settings?.get(YOLO_NS)?.reminder
  ctx.effect(() =>
    startReminderScheduler(ctx, {
      yolo: yctx.yolo,
      cwd: () => latestCwd ?? process.cwd(),
      deliver,
      // interval cannot re-arm a live timer, so it is fixed at startup;
      // ahead/enabled/quiet are read per tick so Settings edits apply without reload
      intervalMs: resolveReminderRuntime(reminderCfg()).intervalMs,
      aheadMs: () => resolveReminderRuntime(reminderCfg()).aheadMs,
      reminderEnabled: () => resolveReminderRuntime(reminderCfg()).enabled,
      quiet: () => {
        const r = settings?.get(YOLO_NS)?.reminder
        return {
          enabled: r?.quietHoursEnabled ?? DEFAULTS.reminderQuietEnabled,
          start: r?.quietStart ?? DEFAULTS.reminderQuietStart,
          end: r?.quietEnd ?? DEFAULTS.reminderQuietEnd,
        }
      },
      briefs: {
        config: () => {
          const b = settings?.get(YOLO_NS)?.brief
          return {
            enabled: b?.enabled ?? DEFAULTS.briefEnabled,
            morningTime: b?.morningTime ?? DEFAULTS.briefMorningTime,
            eveningTime: b?.eveningTime ?? DEFAULTS.briefEveningTime,
            model: b?.model ?? DEFAULTS.briefModel,
          }
        },
        llm,
        provider: 'deepseek',
      },
    }),
  )

  ctx.logger?.info?.('[yolo] reminder plugin loaded')
}
