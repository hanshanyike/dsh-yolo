// YOLO browser-side bundle (M7) — settings card + the global sidebar
// dashboard. The per-session dashboard tab was removed: YOLO memory is a
// global, cross-session surface, so the dashboard lives in the sidebar
// (session-independent), not inside every conversation.

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ui-sidebar SlotMap merge (sidebar.footer.action).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the ui-settings-plugins SlotMap merge (settings.plugin.item).
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { SettingsCard } from './settings/SettingsCard.tsx'
import { YoloSidebarDashboard } from './sidebar/YoloSidebarDashboard.tsx'

export const name = 'yolo-client'

/** Required services: the slot registry. */
export const inject = ['slots'] as const

export function apply(ctx: Context): void {
  ctx.logger?.info?.('[yolo] client bundle loaded')

  // 1. settings card (keyed by the 'yolo' namespace declared in the host half)
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register({ name: 'settings.plugin.item', key: 'yolo' }, SettingsCard),
  )

  // 2. GLOBAL sidebar dashboard — app shell footer, independent of any session.
  //    Fetches /yolo/dashboard (host JSON endpoint); the panel refreshes on
  //    open, on demand, and on a 30s poll while open.
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'yolo',
      order: 10,
      inject: () => ({}),
    }, YoloSidebarDashboard),
  )
}
