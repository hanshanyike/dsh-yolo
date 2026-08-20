// YOLO system-prompt contribution — persistent preference preamble + dynamic recall.
//
// NOTE (rc.8): AssembleContext exposes only { scope, signal } — there is no
// `userMessage`. Dynamic recall therefore reads a cached "latest user message"
// that the memory plugin maintains via session/event.

import type { Context } from '@deepseek-ai/cordis'
import type Yolo from '../storage/index.ts'
import { DEFAULTS, PROMPT_ORDER } from '../shared/constants.ts'

export interface YoloPromptDeps {
  yolo: Yolo
  cwd: () => string
  getLastUserText: () => string
}

/** Register the persistent preferences section + dynamic recall context. */
export function registerYoloPrompt(ctx: Context, deps: YoloPromptDeps): void {
  // persistent preamble — user profile + preferences, always in context
  ctx.systemPrompt.section({
    name: 'yolo-prefs',
    order: PROMPT_ORDER.preferencesPreamble,
    text: () => {
      const prefs = deps.yolo.listPreferences(deps.cwd())
      if (prefs.length === 0) return ''
      const lines = prefs.map((p) => `- ${p.key}: ${p.value}`)
      return `## User preferences\n${lines.join('\n')}`
    },
  })

  // dynamic recall — FTS hits for the latest user message, token-budgeted
  ctx.systemPrompt.context({
    name: 'yolo-recall',
    order: PROMPT_ORDER.recallContext,
    text: () => {
      const q = deps.getLastUserText().trim()
      if (!q) return ''
      const hits = deps.yolo.search(deps.cwd(), q, DEFAULTS.recallTopK)
      if (hits.length === 0) return ''

      const budgetChars = DEFAULTS.recallMaxTokens * 4 // rough chars ≈ tokens*4
      const lines: string[] = []
      let used = 0
      for (const h of hits) {
        const line = `[${h.row_type}] ${h.title}`
        used += line.length + 1
        if (used > budgetChars) break
        lines.push(line)
      }
      if (lines.length === 0) return ''
      return `## Related memory (from YOLO)\n${lines.join('\n')}`
    },
  })
}
