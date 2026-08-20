// YOLO browser-side bundle — M4b: settings card + dashboard tab injection.
// Uses structural (duck-typed) ctx to stay independent of the deep client type
// chain; the real ClientContext satisfies this shape at runtime.
//
// NOTE: `conversation.view` is technically ConversationViewRegistry.register
// (snapshot-builder based); we inject via slots here as the lightweight shell.
// Live data binding + the registry-based tab land in the M4b follow-up.

import { createElement } from 'react'
import { SettingsCard } from './settings/SettingsCard.tsx'
import { YoloTab } from './tab/YoloTab.tsx'

export const name = 'yolo-client'

interface SlotRegistration {
  name: string
  key?: string
}

interface ClientCtxLike {
  logger?: { info?: (msg: string) => void }
  slots?: {
    inject(key: string, register: () => unknown): unknown
    register(opts: SlotRegistration, view: unknown): unknown
  }
  conversationViews?: { register(def: unknown): unknown }
}

export function apply(ctx: ClientCtxLike): void {
  ctx.logger?.info?.('[yolo] client bundle loaded')

  // settings card (keyed by the 'yolo' namespace declared in the host half)
  ctx.slots?.inject('settings.plugin.item', () =>
    ctx.slots!.register({ name: 'settings.plugin.item', key: 'yolo' }, SettingsCard),
  )

  // dashboard tab shell
  ctx.slots?.inject('conversation.view', () =>
    ctx.slots!.register({ name: 'conversation.view', key: 'yolo' }, YoloTab),
  )

  // placeholder for the registry-based view (M4b follow-up)
  void createElement
}
