// YOLO system-prompt contribution — persistent preference preamble + dynamic recall.
//
// NOTE (rc.8): AssembleContext exposes only { scope, signal } — there is no
// `userMessage`. Dynamic recall therefore reads a cached "latest user message"
// that the memory plugin maintains via session/event.

import type { Context } from '@deepseek-ai/cordis'
import type Yolo from '../storage/index.ts'
import type { RowType, SearchHit } from '../storage/types.ts'
import { DEFAULTS, PROMPT_ORDER } from '../shared/constants.ts'
import { dedupeSearchHits, type SemanticRecall, type RerankVerdict } from './semantic.ts'

export interface YoloPromptDeps {
  yolo: Yolo
  cwd: () => string
  getLastUserText: () => string
  /** Keys already injected earlier in this session — filtered out of recall. */
  getInjected: () => ReadonlySet<string>
  /** Report this assembly's kept keys back to the dedup tracker. */
  onRecallKept: (keys: readonly string[]) => void
  /** Optional host-LLM semantic recall (expansion + rerank), prewarmed async. */
  semantic?: SemanticRecall
  logger?: { warn(msg: string): void }
}

/** The host interpolates `{{name}}` strictly in section/context text, so
 *  user-derived memory containing template literals would silently substitute
 *  or throw during assembly — break the pattern with full-width braces. */
export function escapePromptTemplates(s: string): string {
  return s.replace(/\{\{/g, '｛｛')
}

export interface RecallPolicyOptions {
  injected: ReadonlySet<string>
  kindQuota: number
  budgetChars: number
}

export interface RecallDrop {
  key: string
  reason: 'already-injected' | 'kind-quota' | 'over-budget'
}

/** Recall decision layer: filter already-injected keys, cap rows per kind,
 *  then greedily fill the char budget. Over-budget rows are skipped, not a
 *  break — a single long line must not strand the remaining budget. */
export function applyRecallPolicy(
  hits: readonly SearchHit[],
  opts: RecallPolicyOptions,
): { keep: SearchHit[]; drops: RecallDrop[] } {
  const { injected, kindQuota, budgetChars } = opts
  const keep: SearchHit[] = []
  const drops: RecallDrop[] = []
  const perKind = new Map<RowType, number>()
  let used = 0
  for (const h of hits) {
    const key = `${h.row_type}:${h.row_id}`
    const line = `[${h.row_type}] ${h.title}`
    if (injected.has(key)) {
      drops.push({ key, reason: 'already-injected' })
      continue
    }
    if ((perKind.get(h.row_type) ?? 0) >= kindQuota) {
      drops.push({ key, reason: 'kind-quota' })
      continue
    }
    if (used + line.length + 1 > budgetChars) {
      drops.push({ key, reason: 'over-budget' })
      continue
    }
    perKind.set(h.row_type, (perKind.get(h.row_type) ?? 0) + 1)
    used += line.length + 1
    keep.push(h)
  }
  return { keep, drops }
}

const keyOf = (h: SearchHit): string => `${h.row_type}:${h.row_id}`

/** Apply cached rerank verdicts to a candidate pool, against a deterministic
 *  floor: the top `floor` deterministic hits always survive, so a model that
 *  judges everything irrelevant can never silently empty the context. */
export function applyRerank(
  pool: readonly SearchHit[],
  verdicts: readonly RerankVerdict[] | undefined,
  floor: number,
  detHits: readonly SearchHit[],
): SearchHit[] {
  if (!verdicts || verdicts.length === 0) return [...pool]
  const byKey = new Map(pool.map((h) => [keyOf(h), h]))
  const keptVerdicts = verdicts.filter((v) => v.keep && byKey.has(v.key))
  const ordered: SearchHit[] = []
  const seen = new Set<string>()
  for (const v of keptVerdicts) {
    if (seen.has(v.key)) continue
    seen.add(v.key)
    ordered.push(byKey.get(v.key)!)
  }
  // deterministic floor: never drop below floor from the direct (un-expanded) hits
  for (const h of detHits.slice(0, floor)) {
    const k = keyOf(h)
    if (!seen.has(k)) {
      seen.add(k)
      ordered.push(h)
    }
  }
  // append the rest of the pool (rank order) that was not dropped
  for (const h of pool) {
    const k = keyOf(h)
    if (!seen.has(k)) {
      seen.add(k)
      ordered.push(h)
    }
  }
  return ordered
}

/** Session-scoped injection dedup. Kept keys are committed to `injected` only
 *  when the NEXT user message arrives: within one round, repeated assemblies
 *  (multiple model steps) query with the same injected set, so the rendered
 *  text stays byte-identical and prefix caches survive. On a session switch
 *  the accumulated injected set is cleared first — the new session starts
 *  fresh except for rows rendered in the immediately preceding turn. */
export class RecallDedupTracker {
  private sessionId = ''
  private keptKeys: readonly string[] = []
  private readonly injected = new Set<string>()

  onUserMessage(sessionId: string, text: string): void {
    if (!text) return
    if (sessionId !== this.sessionId) {
      this.sessionId = sessionId
      this.injected.clear()
    }
    for (const key of this.keptKeys) this.injected.add(key)
    this.keptKeys = []
  }

  getInjected(): ReadonlySet<string> {
    return this.injected
  }

  onRecallKept(keys: readonly string[]): void {
    this.keptKeys = [...keys]
  }
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
      'YOLO (the management plugin) is active. It automatically extracts commitments (todos), plans (goals/milestones) and tracking rules (preferences) from the conversation, and reminds you when they come due. You do NOT need to create files, run shell commands, or call tools to set reminders for deadlines the user mentions — YOLO handles that.\n' +
      'When the user replies to a YOLO reminder (messages starting with "⏰ YOLO 提醒"), handle the reply with the yolo_action tool, referencing the todo by its title: 已完成 → yolo_action(action="complete", kind="todo", title=...); 推迟到某日 → action="postpone" with due_at="resolved absolute date"; 再提醒 → action="remind_again". Confirm briefly after acting; if the user does not respond to a reminder, never follow up on your own.',
  })

  // persistent preamble — user profile + preferences, always in context
  ctx.systemPrompt.section({
    name: 'yolo-prefs',
    order: PROMPT_ORDER.preferencesPreamble,
    text: () => {
      const prefs = [...deps.yolo.listPreferences(deps.cwd())]
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(0, DEFAULTS.recallPrefsMax)
      if (prefs.length === 0) return ''
      const lines = prefs.map((p) => escapePromptTemplates(`- ${p.key}: ${p.value}`))
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
      try {
        const detHits = deps.yolo.search(deps.cwd(), q, DEFAULTS.recallTopK)
        let pool = detHits
        if (deps.semantic) {
          // widen with cached LLM expansions, then apply the cached rerank verdicts
          const expanded: SearchHit[] = [...detHits]
          for (const exp of deps.semantic.getExpansions(q)) {
            expanded.push(...deps.yolo.search(deps.cwd(), exp, DEFAULTS.recallTopK))
          }
          pool = applyRerank(dedupeSearchHits(expanded), deps.semantic.getRerank(q, expanded), DEFAULTS.recallTopK, detHits)
        }

        const budgetChars = DEFAULTS.recallMaxTokens * 4 // rough chars ≈ tokens*4
        const { keep } = applyRecallPolicy(pool, {
          injected: deps.getInjected(),
          kindQuota: DEFAULTS.recallKindQuota,
          budgetChars,
        })
        deps.onRecallKept(keep.map((h) => `${h.row_type}:${h.row_id}`))
        if (keep.length === 0) return ''

        const lines = keep.map((h) => escapePromptTemplates(`[${h.row_type}] ${h.title}`))
        return `## Related memory (from YOLO)\n${lines.join('\n')}`
      } catch (e) {
        deps.logger?.warn(`[yolo] recall search failed: ${e instanceof Error ? e.message : String(e)}`)
        return ''
      }
    },
  })
}

