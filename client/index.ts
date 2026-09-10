// YOLO browser-side bundle (M7) — settings card + the global sidebar
// dashboard. The per-session dashboard tab was removed: YOLO memory is a
// global, cross-session surface, so the dashboard lives in the sidebar
// (session-independent), not inside every conversation.

// Type-only imports. dsh 0.1.2 removed @deepseek-ai/dsh-client-runtime; its
// client symbols migrated by domain (upgrade card DSH-0.1.2-A1-25):
//   ClientContext -> cordis Context · ISessions -> dsh-api-session-controller/client
//   SessionId -> dsh-session/types · SettingsScope -> dsh-client-ui-settings/client
// dsh 0.1.5 moved the client settings scope onto the `settingsScope` binder and
// turned the plugin card into a locale-bearing contribution of the shared
// `settings.plugin.item` slot: a card declares `locale:` and receives the
// framework-bound `t`, so its chrome and copy follow every other plugin card.
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the `locale` Context augmentation and the LocaleNamespaceMap seat.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `slots` Context augmentation (client-ui-renderer provides it
// since the 0.1.2 client-runtime unbundling).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ui-sidebar SlotMap merge (sidebar.footer.action).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the ui-settings-plugins SlotMap merge (settings.plugin.item)
// and the shared card-form types the YOLO card implements.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
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
export const inject = ['slots', 'sessions', 'theme', 'locale', 'settingsScope'] as const

const VALUE_FIELDS = YOLO_FIELD_SPECS.filter((spec) => spec.control === 'value').map((spec) => spec.field)
const SWITCH_FIELDS = YOLO_FIELD_SPECS.filter((spec) => spec.control === 'switch').map((spec) => spec.field)

export function apply(ctx: ClientContext): void {
  ctx.logger?.info?.('[yolo] client bundle loaded')

  // 1. Card copy — the card registers `locale:`, so the framework binds this
  //    dictionary's reader as the component's `t` seat, exactly as the shipped
  //    plugin cards do.
  ctx.effect(() => ctx.locale.register(YOLO_CARD_NS, { zh, en }), 'yolo-client: card dictionary')
  // The card chrome's stylesheet, owned by this fiber so a stop removes it.
  ctx.effect(mountYoloCardStyle, 'yolo-client: plugin card stylesheet')

  // 2. Settings card — `settings.plugin.item` is keyed by the settings
  //    namespace the host half registered, so the section pairs the two
  //    without ever learning what `yolo` means.
  const scope = ctx.settingsScope.bind<YoloSettings>({ namespace: YOLO_SETTINGS_NAMESPACE })
  const form = new YoloCardForm(scope, YOLO_FIELD_SPECS)
  const store = form.bind((): YoloCardState => ({
    ...form.shell(),
    fields: Object.fromEntries(VALUE_FIELDS.map((field) => [field, form.field(field)])),
    switches: Object.fromEntries(SWITCH_FIELDS.map((field) => [field, form.switchState(field)])),
  }))
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: YOLO_SETTINGS_NAMESPACE,
    locale: YOLO_CARD_NS,
    inject: (): YoloCardFace => ({ hooks: { yoloCard: store }, ...form.actions() }),
  }, YoloSettingsCard))

  // 3. GLOBAL sidebar dashboard — app shell footer, independent of any session.
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
