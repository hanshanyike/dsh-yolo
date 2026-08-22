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
  logger?: { warn(msg: string): void }
}

/** Register the persistent preferences section + dynamic recall context. */
export function registerYoloPrompt(ctx: Context, deps: YoloPromptDeps): void {
  // capability guidance — prevents the agent from spawning shell/tools for
  // reminders/deadlines that YOLO already extracts and stores automatically.
  // Also carries the reminder-reply rules for the YOLO resident thread, so the
  // delivered reminder text can stay human-readable (no agent instructions
  // pasted into chat history).
  ctx.systemPrompt.section({
    name: 'yolo-instructions',
    order: PROMPT_ORDER.instructions,
    text: () =>
      'YOLO (the personal memory plugin) is active. It automatically extracts deadlines, todos, goals, milestones, and preferences from the conversation. You do NOT need to create files, run shell commands, or call tools to set reminders for deadlines the user mentions — YOLO handles that.\n' +
      'When the user replies to a YOLO reminder (messages starting with "⏰ YOLO 提醒"), handle the reply with the yolo_action tool, referencing the todo by its title: 已完成 → yolo_action(action="complete", kind="todo", title=...); 推迟到某日 → action="postpone" with due_at="resolved absolute date"; 再提醒 → action="remind_again". Confirm briefly after acting; if the user does not respond to a reminder, never follow up on your own.',
  })

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

  // dynamic recall — FTS hits for the latest user message, token-budgeted.
  // System-prompt assembly must never fail because of a storage hiccup, so
  // recall degrades to empty on error instead of taking the turn down.
  ctx.systemPrompt.context({
    name: 'yolo-recall',
    order: PROMPT_ORDER.recallContext,
    text: () => {
      const q = deps.getLastUserText().trim()
      if (!q) return ''
      let hits
      try {
        hits = deps.yolo.search(deps.cwd(), q, DEFAULTS.recallTopK)
      } catch (e) {
        deps.logger?.warn(`[yolo] recall search failed: ${e instanceof Error ? e.message : String(e)}`)
        return ''
      }
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
