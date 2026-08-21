// YOLO browser-side bundle — M4b+: settings card + dashboard tab + header chip
// + global sidebar button. Follows the ui-trajectory pattern: register a
// conversation node definition, a view definition, then contribute the tab via
// the conversation.view slot; the sidebar button is a root-scoped slot.

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.view and
// conversation.session.header.actions rows must be in the program to type).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-sidebar SlotMap merge (sidebar.footer.action).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the ui-settings-plugins SlotMap merge (settings.plugin.item).
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: pulls the dsh-session SessionEventMap merge for 'yolo/snapshot'.
import type {} from '../src/shared/events.ts'
import { SettingsCard } from './settings/SettingsCard.tsx'
import { YoloTab } from './tab/YoloTab.tsx'
import { HeaderButton } from './trigger/HeaderButton.tsx'
import { YoloSidebarButton } from './sidebar/YoloSidebarButton.tsx'
import { yoloDashboardDefinition } from './node/DashboardNode.ts'
import { yoloViewDefinition } from './tab/ViewBuilder.ts'

export const name = 'yolo-client'

/** Required services: the slot registry plus the conversation node/view registries. */
export const inject = ['slots', 'conversationEvents', 'conversationViews'] as const

export function apply(ctx: Context): void {
  ctx.logger?.info?.('[yolo] client bundle loaded')

  // 1. conversation node definition — matches 'yolo/snapshot' durable events
  ctx.conversationEvents.register(yoloDashboardDefinition)

  // 2. conversation view definition — per-Session 'yolo' snapshot builder
  ctx.conversationViews.register(yoloViewDefinition)

  // 3. settings card (keyed by the 'yolo' namespace declared in the host half)
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register({ name: 'settings.plugin.item', key: 'yolo' }, SettingsCard),
  )

  // 4. dashboard tab in the conversation view ring
  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register({
      name: 'conversation.view',
      id: 'yolo',
      order: 20,
      label: () => 'YOLO',
      inject: () => ({}),
    }, YoloTab),
  )

  // 5. compact chip in the session header actions
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'yolo',
      order: 10,
      inject: () => ({}),
    }, HeaderButton),
  )

  // 6. GLOBAL sidebar button — app shell footer, independent of any session.
  //    Fetches /yolo/dashboard (host JSON endpoint) on click.
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'yolo',
      order: 10,
      inject: () => ({}),
    }, YoloSidebarButton),
  )
}
