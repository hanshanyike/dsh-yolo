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
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import type Yolo from '../storage/index.ts'
import { Config, YOLO_NS as YOLO_SETTINGS_NS, type Config as ConfigSchema } from '../runtime/config.ts'
import { registerActionsEndpoint } from './actions.ts'
import { registerDashboardEndpoint, type WebServerLike } from './dashboard.ts'
import { registerBadgeEndpoint } from './badge.ts'
import { registerNotificationsEndpoint } from './notifications.ts'
import { registerHistoryEndpoint } from './history.ts'
import { registerIdentityReceiptsEndpoint } from './identity.ts'
import { registerSessionEndpoints, type AgentsLike } from '../application/conversation/index.ts'

/** The namespace is the join key shared with the client half (settings.plugin.item). */
export const YOLO_NS = YOLO_SETTINGS_NS

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
  let configSource = (): ConfigSchema => entry

  installSettingsSection(ctx, YOLO_NS, Config, entry, {
    // Settings owns the live source after registration. Keep the normalized
    // loader entry as a defensive fallback while the service is starting or
    // when a lightweight test/memory provider has no accepted document yet.
    setSource: (current) => { configSource = () => current() ?? entry },
    onChange: () => {
      // Consumers read configSource lazily; no restart callback is needed here.
    },
  })

  // ---- panel data + chat channel ----
  // Runtime observation has one owner on ctx.yolo; UI is only a consumer.
  const currentCwd = (): string => ctx.yolo.observations.latestWorkspaceCwd(process.cwd())

  registerDashboardEndpoint(ctx, ctx.yolo, currentCwd, {
    allowAggregate: () => configSource().ui.aggregateAcrossWorkspaces,
    focusDefaultCount: () => configSource().ui.focusDefaultCount,
  })
  registerBadgeEndpoint(ctx, ctx.yolo, currentCwd)
  registerNotificationsEndpoint(ctx, ctx.yolo, currentCwd)
  registerHistoryEndpoint(ctx, ctx.yolo, currentCwd)
  registerIdentityReceiptsEndpoint(ctx, ctx.yolo)
  // M8: in-place dashboard operations (complete/postpone/cancel + goal/milestone)
  // v0.3.0 E: + update/rename/abandon/quick_add/handled + snapshot sync
  registerActionsEndpoint(ctx, ctx.yolo, currentCwd)
  // Resident thread for internal YOLO delivery (for example reminders).
  // v0.3.3: agents are created with the harness's model selection so they reply.
  const defaultModel = (): { provider: string; model: string } | undefined => {
    const sel = ctx.get('agentDefaultModel')
    return sel ? sel.currentSelection() : undefined
  }
  const conversations = ctx.yolo.conversations.get(
    // inject declares 'agents' (runtime access is legal); the structural cast
    // sidesteps the AgentRegistry / AgentsLike signature mismatch
    ctx.agents as unknown as AgentsLike,
    { info: (f, ...a) => ctx.logger?.info?.(f, ...a), warn: (f, ...a) => ctx.logger?.warn?.(f, ...a) },
    defaultModel,
  )
  registerSessionEndpoints(
    ctx,
    conversations.sessions,
    conversations.threads,
    currentCwd,
    () => ctx.yolo.listWorkspaceMeta(),
  )

  ctx.logger?.info?.('[yolo] ui plugin loaded')
}
