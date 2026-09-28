// YOLO browser-side bundle (M7) — settings card + the global sidebar
// dashboard. The per-session dashboard tab was removed: YOLO memory is a
// global, cross-session surface, so the dashboard lives in the sidebar
// (session-independent), not inside every conversation.

// Type-only imports. dsh 0.1.2 removed @deepseek-ai/dsh-client-runtime; its
// client symbols migrated by domain (upgrade card DSH-0.1.2-A1-25):
//   ClientContext -> cordis Context · ISessions -> dsh-api-session-controller/client
//   SessionId -> dsh-session/types · SettingsScope -> dsh-client-ui-settings/client
// dsh 0.1.7-rc.2 exposes Loader configuration through configForms and lets plugins
// contribute their own pages to settings.plugins.tab.
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the `locale` Context augmentation and the LocaleNamespaceMap seat.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `slots` Context augmentation (client-ui-renderer provides it
// since the 0.1.2 client-runtime unbundling).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ui-sidebar SlotMap merge (sidebar.footer.action).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the Plugins settings tab contribution contract.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: contributes ctx.theme, the host-owned durable light/dark runtime.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { YOLO_SETTINGS_NAMESPACE } from '../src/contracts/config.ts'
import { YoloSidebarDashboard } from './sidebar/YoloSidebarDashboard.tsx'
import { YoloCardForm } from './settings/card-form.ts'
import { en, YOLO_CARD_NS, zh } from './settings/card-locale.ts'
import { mountYoloCardStyle } from './settings/card-style.ts'
import { YOLO_FIELD_SPECS, type YoloSettings } from './settings/model.ts'
import { YoloSettingsCard, type YoloCardFace, type YoloCardState } from './settings/SettingsCard.tsx'

export const name = 'yolo-client'

/** Required services: slots, session jumps, theme, card copy, and durable plugin settings. */
export const inject = ['slots', 'uiWorkspace', 'theme', 'locale', 'configForms'] as const

const VALUE_FIELDS = YOLO_FIELD_SPECS.filter((spec) => spec.control === 'value').map((spec) => spec.field)
const SWITCH_FIELDS = YOLO_FIELD_SPECS.filter((spec) => spec.control === 'switch').map((spec) => spec.field)

export function apply(ctx: ClientContext): void {
  ctx.logger?.info?.('[yolo] client bundle loaded')

  // 1. Card copy — the tab registers `locale:`, so the framework binds this
  //    dictionary's reader as the component's `t` seat.
  ctx.effect(() => ctx.locale.register(YOLO_CARD_NS, { zh, en }), 'yolo-client: card dictionary')
  // The card chrome's stylesheet, owned by this fiber so a stop removes it.
  ctx.effect(mountYoloCardStyle, 'yolo-client: plugin card stylesheet')

  // 2. The Plugins section now accepts feature-owned tabs. The form reads the
  //    Host Loader entry for the YOLO UI plugin and writes its fields atomically.
  const scope = ctx.configForms.get<YoloSettings>('yolo-ui')
  const form = new YoloCardForm(scope, YOLO_FIELD_SPECS)
  const store = form.bind((): YoloCardState => ({
    ...form.shell(),
    fields: Object.fromEntries(VALUE_FIELDS.map((field) => [field, form.field(field)])),
    switches: Object.fromEntries(SWITCH_FIELDS.map((field) => [field, form.switchState(field)])),
  }))
  const stopSettingsTab = ctx.configForms.whileServed(['yolo-ui'], () => ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: YOLO_SETTINGS_NAMESPACE,
    order: 40,
    label: 'YOLO',
    locale: YOLO_CARD_NS,
    inject: (): YoloCardFace => ({ hooks: { yoloCard: store }, ...form.actions() }),
  }, YoloSettingsCard)))
  ctx.effect(() => stopSettingsTab, 'yolo-client: settings tab')

  // 3. GLOBAL sidebar dashboard — app shell footer, independent of any session.
  //    Fetches /yolo/dashboard (host JSON endpoint); the panel refreshes on
  //    open, on demand after actions — no poll while open (v0.3.3).
  //    The panel's ledger badges jump to their source session via the runtime
  //    workspace navigation service (ctx.uiWorkspace.openSession).
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'yolo',
      order: 10,
      inject: () => ({
        openSession: (sessionId: string): void => {
          ctx.uiWorkspace.openSession(sessionId as SessionId)
        },
        setTheme: (theme: 'dark' | 'light'): void => { ctx.theme.setTheme(theme) },
      }),
    }, YoloSidebarDashboard),
  )
}
