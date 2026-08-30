// YOLO browser-side bundle (M7) — settings card + the global sidebar
// dashboard. The per-session dashboard tab was removed: YOLO memory is a
// global, cross-session surface, so the dashboard lives in the sidebar
// (session-independent), not inside every conversation.

// Type-only: the client Context — its `sessions` service (contract ISessions)
// is what backs the ledger's session jumps, unlike the bare cordis Context.
import type { ClientContext, ISessions, SessionId, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-sidebar SlotMap merge (sidebar.footer.action).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the ui-settings-plugins SlotMap merge (settings.plugin.item).
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: contributes ctx.theme, the host-owned durable light/dark runtime.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { settingsCardFor } from './settings/SettingsCard.tsx'
import { YOLO_SETTINGS_NAMESPACE, type YoloSettings } from '../src/contracts/config.ts'
import { YoloSidebarDashboard } from './sidebar/YoloSidebarDashboard.tsx'

export const name = 'yolo-client'

/** Required services: slots, session jumps, theme, and durable plugin settings. */
export const inject = ['slots', 'sessions', 'theme', 'settingsScope'] as const

export function apply(ctx: ClientContext): void {
  ctx.logger?.info?.('[yolo] client bundle loaded')

  // 1. settings card (keyed by the 'yolo' namespace declared in the host half)
  const settingsScope = (ctx as unknown as {
    settingsScope: { bind<T>(spec: { namespace: string }): SettingsScope<T> }
  }).settingsScope.bind<YoloSettings>({ namespace: YOLO_SETTINGS_NAMESPACE })
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register({ name: 'settings.plugin.item', key: 'yolo' }, settingsCardFor(settingsScope)),
  )

  // 2. GLOBAL sidebar dashboard — app shell footer, independent of any session.
  //    Fetches /yolo/dashboard (host JSON endpoint); the panel refreshes on
  //    open, on demand after actions — no poll while open (v0.3.3).
  //    The panel's ledger badges jump to their source session via the runtime
  //    session service (ctx.sessions.open — same call the sidebar rows make).
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'yolo',
      order: 10,
      inject: () => ({
        openSession: (sessionId: string): void => {
          // One tsc program covers host + client halves; the host half's
          // dsh-session merge (SessionStore, no .open) shadows the browser
          // runtime's ISessions on Context.sessions, so re-narrow here.
          ;(ctx.sessions as unknown as ISessions).open(sessionId as SessionId)
        },
        setTheme: (theme: 'dark' | 'light'): void => { ctx.theme.setTheme(theme) },
      }),
    }, YoloSidebarDashboard),
  )
}
