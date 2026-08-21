// YOLO UI plugin (host half) — M4a + M4b data channel.
// Registers the YOLO settings namespace on the dsh Settings page, declares the
// custom durable session events, and publishes the dashboard projection:
//   - automatically after every finished turn (agent/turn-stopping)
//   - on the '/yolo' text command (user message starting with /yolo)

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import '../shared/events.ts'
import { Config, type Config as ConfigSchema } from './config.ts'
import { publishDashboard, registerDashboardEndpoint, type SessionLike } from './dashboard.ts'
import { contentBlocksToText } from '../extract/llm-extract.ts'

/** The namespace is the join key shared with the client half (settings.plugin.item). */
export const YOLO_NS = settingsNamespace('yolo')

export const name = 'yolo-ui'
export const inject = ['yolo', 'webServer'] as const

interface UiCtx extends Context {
  yolo: import('../storage/index.ts').default
  webServer: import('./dashboard.ts').WebServerLike
}

/** Extract plain text from a user message's content blocks. */
function userText(content?: unknown): string {
  return contentBlocksToText(content as never[] | undefined)
}

export function apply(ctx: UiCtx, config: ConfigSchema): void {
  installSettingsSection(ctx, YOLO_NS, Config, config, {
    // config changes take effect live; host plugins read ctx config on next turn
    setSource: (current) => {
      void current
    },
    onChange: () => {
      // no live reaction needed in rc.8; next turn reads the new config
    },
  })

  // ---- dashboard data channel ----

  /** Publish to a session, resolving cwd from its meta (falls back to process cwd). */
  const publish = (session: SessionLike): void => {
    const cwd = session.meta?.cwd ?? process.cwd()
    publishDashboard(ctx.yolo, session, cwd)
  }

  // global JSON endpoint for the sidebar button (session-independent)
  registerDashboardEndpoint(ctx, ctx.yolo, () => process.cwd())

  // publish after every finished turn so the tab always reflects latest state
  ctx.on('agent/turn-stopping', (payload) => {
    if (!config.enabled) return
    const agent = payload.agent as { session?: SessionLike }
    if (!agent.session) return
    try {
      publish(agent.session)
    } catch (e) {
      ctx.logger?.warn?.('[yolo-ui] turn publish failed: %s', e instanceof Error ? e.message : String(e))
    }
  })

  // '/yolo' text command — force a publish (and thus a tab refresh) on demand
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'user/message') return
    const text = userText(event.data.content)
    if (/^\/yolo\b/.test(text.trim())) {
      try {
        publish(session as unknown as SessionLike)
      } catch (e) {
        ctx.logger?.warn?.('[yolo-ui] /yolo publish failed: %s', e instanceof Error ? e.message : String(e))
      }
    }
  })

  ctx.logger?.info?.('[yolo] ui plugin loaded')
}
