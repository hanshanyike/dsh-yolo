// YOLO memory plugin — model-visible memory management.
// M1: registers memory tools (memory_search/write/forget, yolo_query).
// M3: adds persistent preference preamble + dynamic recall (systemPrompt section/context).

import type { Context } from '@deepseek-ai/cordis'
import { registerYoloTools, type YoloContext } from './tools.ts'

export const name = 'yolo-memory'
export const inject = ['yolo', 'tools', 'systemPrompt'] as const

export function apply(ctx: Context): void {
  registerYoloTools(ctx as YoloContext)
  ctx.logger?.info?.('[yolo] memory plugin loaded')
  // M3 (injection milestone):
  //   ctx.systemPrompt.section({ name: 'yolo-prefs', order: PROMPT_ORDER.preferencesPreamble, ... })
  //   ctx.systemPrompt.context({ name: 'yolo-recall', order: PROMPT_ORDER.recallContext, ... })
}
