// YOLO UI plugin (host half) — M4a.
// Registers the YOLO settings namespace on the dsh Settings page via
// installSettingsSection, and declares the custom durable session events.

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import '../shared/events.ts'
import { Config, type Config as ConfigSchema } from './config.ts'

/** The namespace is the join key shared with the client half (settings.plugin.item). */
export const YOLO_NS = settingsNamespace('yolo')

export const name = 'yolo-ui'
export const inject: string[] = []

export function apply(ctx: Context, config: ConfigSchema): void {
  installSettingsSection(ctx, YOLO_NS, Config, config, {
    // config changes take effect live; host plugins read ctx config on next turn
    setSource: (current) => {
      // M4b: notify extract/reminder plugins of live config changes
      void current
    },
    onChange: () => {
      // M4b: react to live settings edits
    },
  })
  ctx.logger?.info?.('[yolo] ui plugin loaded')
}
