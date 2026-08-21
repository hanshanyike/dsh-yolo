// YOLO memory plugin — model-visible memory management + persistent context.
// M1: memory tools (memory_search/write/forget, yolo_query).
// M3: systemPrompt preference preamble + dynamic recall from the latest user message.

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { contentBlocksToText } from '../shared/text.ts'
import { registerYoloPrompt } from './recall.ts'
import { registerYoloTools, type YoloContext } from './tools.ts'

export const name = 'yolo-memory'
export const inject = ['yolo', 'tools', 'systemPrompt'] as const

export function apply(ctx: Context): void {
  const yctx = ctx as YoloContext
  registerYoloTools(yctx)

  // track the latest user message for dynamic recall (AssembleContext has no userMessage in rc.8)
  // and the latest session cwd so recall reads the scope extraction writes to.
  let lastUserText = ''
  let lastSessionCwd: string | undefined
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (session && typeof session === 'object') {
      const meta = (session as { meta?: { cwd?: string } }).meta
      if (meta?.cwd) lastSessionCwd = meta.cwd
    }
    if (event.type !== 'user/message') return
    const text = contentBlocksToText((event.data as { content?: readonly unknown[] }).content)
    if (text) lastUserText = text
  })

  registerYoloPrompt(ctx, {
    yolo: yctx.yolo,
    cwd: () => lastSessionCwd ?? process.cwd(),
    getLastUserText: () => lastUserText,
    logger: ctx.logger,
  })

  ctx.logger?.info?.('[yolo] memory plugin loaded')
}
