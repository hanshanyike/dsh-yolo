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

/** The namespace is the join key shared with the client half (settings.plugin.item). */
export const YOLO_NS = settingsNamespace('yolo')

export const name = 'yolo-ui'
export const inject = ['yolo', 'webServer'] as const

interface UiCtx extends Context {
  yolo: Yolo
  webServer: WebServerLike
}

/** Structural view of a session payload carrying a workspace cwd. */
interface SessionLike {
  meta?: { cwd?: string }
}

/** Narrow an unknown session payload to the structural shape we read. */
function toSessionLike(v: unknown): SessionLike | undefined {
  if (typeof v === 'object' && v !== null) return v as SessionLike
  return undefined
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

  // ---- sidebar dashboard data channel ----
  // The dashboard is global (session-independent), but its scope follows the
  // workspace of the most recent session so the sidebar shows what the user is
  // actually working on. Falls back to the host process cwd.
  let latestSessionCwd: string | undefined
  ctx.on('agent/turn-stopping', (payload: { agent?: { session?: unknown } }) => {
    const s = toSessionLike(payload.agent?.session)
    if (s?.meta?.cwd) latestSessionCwd = s.meta.cwd
  })

  registerDashboardEndpoint(ctx, ctx.yolo, () => latestSessionCwd ?? process.cwd())
  // M8: in-place dashboard operations (complete/postpone/cancel + goal/milestone)
  registerActionsEndpoint(ctx, ctx.yolo, () => latestSessionCwd ?? process.cwd())

  ctx.logger?.info?.('[yolo] ui plugin loaded')
}
