import type { Config as YoloConfig } from './config.ts'

/** The dsh 0.1.7-rc.2 settings service exposes live Loader entries through describe(). */
export interface SettingsReader {
  describe(): readonly { ns: string; value: unknown }[]
}

export function readYoloConfig(settings: SettingsReader | undefined): YoloConfig | undefined {
  const value = settings?.describe().find((entry) => entry.ns === 'yolo-ui')?.value
  if (value === undefined) return undefined
  return value as YoloConfig
}
