// YOLO UI plugin (host half) — settings section + sidebar dashboard data
// channel. Registers the YOLO settings namespace on the dsh Settings page and
// serves the global dashboard projection at GET /yolo/dashboard for the
// browser-side sidebar dashboard.
//
// NOTE: the cordis loader passes `config` as undefined when the bundle yml has
// no config stanza for this plugin — schemastery defaults only apply when we
// normalize explicitly. Config(config ?? {}) is therefore REQUIRED before any
// `.enabled` access (fixes "Cannot read properties of undefined").

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type Yolo from '../storage/index.ts'
import { registerActionsEndpoint } from './actions.ts'
import { Config, type Config as ConfigSchema } from './config.ts'
import { registerDashboardEndpoint, type WebServerLike } from './dashboard.ts'
import { registerBadgeEndpoint } from './badge.ts'
import { YoloSessions, YoloChatThreads, registerSessionEndpoints, isYoloSessionId, type AgentsLike } from './session.ts'
import { sessionCwd } from '../shared/session.ts'

/** The namespace is the join key shared with the client half (settings.plugin.item). */
export const YOLO_NS = settingsNamespace('yolo')

export const name = 'yolo-ui'
export const inject = ['yolo', 'webServer', 'agents'] as const

interface UiCtx extends Context {
  yolo: Yolo
  webServer: WebServerLike
}

export function apply(ctx: UiCtx, config?: Partial<ConfigSchema>): void {
  // normalize: fill schemastery defaults even when the loader passed nothing
  // (runtime accepts partial input and fills defaults; the cast states that)
  const entry = Config((config ?? {}) as ConfigSchema) as ConfigSchema

  installSettingsSection(ctx, YOLO_NS, Config, entry, {
    setSource: (current) => {
      void current
    },
    onChange: () => {
      // no live reaction needed in rc.8; next turn reads the new config
    },
  })

  // ---- panel data + chat channel ----
  // The dashboard is global (session-independent), but its scope follows the
  // workspace of the most recent session so the panel shows what the user is
  // actually working on. Falls back to the host process cwd.
  let latestSessionCwd: string | undefined
  ctx.on('agent/session-start', (payload: { agent?: unknown }) => {
    if (isYoloSessionId((payload.agent as { id?: string } | undefined)?.id)) return // YOLO threads don't move the workspace
    const cwd = sessionCwd((payload.agent as { session?: unknown } | undefined)?.session)
    if (cwd) latestSessionCwd = cwd
  })
  ctx.on('agent/turn-stopping', (payload: { agent?: { id?: string; session?: unknown } }) => {
    // YOLO threads own their workspace: a resident/anchored thread turn must
    // never move the shared "latest workspace" tracker — it would silently
    // re-target quick actions, the dashboard fallback and snapshots to another
    // scope (mirrors the session-start guard above).
    if (isYoloSessionId((payload.agent as { id?: string } | undefined)?.id)) return
    const cwd = sessionCwd(payload.agent?.session)
    if (cwd) latestSessionCwd = cwd
  })

  registerDashboardEndpoint(ctx, ctx.yolo, () => latestSessionCwd ?? process.cwd(), {
    allowAggregate: () => entry.ui.aggregateAcrossWorkspaces,
    focusDefaultCount: () => entry.ui.focusDefaultCount,
  })
  registerBadgeEndpoint(ctx, ctx.yolo, () => latestSessionCwd ?? process.cwd())
  // M8: in-place dashboard operations (complete/postpone/cancel + goal/milestone)
  // v0.3.0 E: + update/rename/abandon/quick_add/handled + snapshot sync
  registerActionsEndpoint(ctx, ctx.yolo, () => latestSessionCwd ?? process.cwd())
  // v0.3.0 A/B: the YOLO resident thread (对话 Tab + 侧栏对话)
  // v0.3.3: agents are created with the harness's model selection so they reply.
  const defaultModel = (): { provider: string; model: string } | undefined => {
    const sel = ctx.get('agentDefaultModel')
    return sel ? sel.currentSelection() : undefined
  }
  const sessions = new YoloSessions(
    // inject declares 'agents' (runtime access is legal); the structural cast
    // sidesteps the AgentRegistry / AgentsLike signature mismatch
    ctx.agents as unknown as AgentsLike,
    { info: (f, ...a) => ctx.logger?.info?.(f, ...a), warn: (f, ...a) => ctx.logger?.warn?.(f, ...a) },
    defaultModel,
  )
  // v0.3.2 聊一聊 anchored chats are fresh ephemeral threads, not resident history
  const threads = new YoloChatThreads(
    ctx.agents as unknown as AgentsLike,
    { info: (f, ...a) => ctx.logger?.info?.(f, ...a), warn: (f, ...a) => ctx.logger?.warn?.(f, ...a) },
    defaultModel,
  )
  registerSessionEndpoints(ctx, sessions, threads, () => latestSessionCwd ?? process.cwd())

  ctx.logger?.info?.('[yolo] ui plugin loaded')
}
