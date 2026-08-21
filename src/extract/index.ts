// YOLO extract plugin (M7) — LLM semantic extraction, the only strategy.
// At every finished turn (agent/turn-stopping) the whole turn is sent to the
// extraction model, which returns durable memories as strict JSON. The old
// per-message regex fast path was removed: regexes could not judge semantics,
// produced noise, and the industry (Mem0 / Claude Code auto-memory) extracts
// with an LLM after a useful interaction, not per message.
//
// All handlers are failure-isolated: they never throw into the agent loop.

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { LlmRuntime, Message } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type Yolo from '../storage/index.ts'
import type { MilestoneStatus, Priority } from '../storage/types.ts'
import { DEFAULTS } from '../shared/constants.ts'
import { contentBlocksToText, llmExtract, type ExtractionResult, type ExtractedUpdate } from './llm-extract.ts'
import { buildKnownContext } from './prompt.ts'

export const name = 'yolo-extract'
export const inject = ['yolo', 'llm', 'sessions', 'settings'] as const

export const YOLO_NS = settingsNamespace('yolo')

interface YoloCtx extends Context {
  yolo: Yolo
  llm: LlmRuntime
}

/** Minimal structural view of the dsh settings service (config read per turn). */
interface SettingsLike {
  get(ns: unknown): {
    extraction?: { enableLLM?: boolean; model?: string; minIntervalSec?: number }
  } | undefined
}

const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'urgent']

/** Coerce an LLM-provided priority string into the domain union (null when unknown). */
function toPriority(v: string | null | undefined): Priority | null {
  return PRIORITIES.includes(v as Priority) ? (v as Priority) : null
}

/** cwd for scope partitioning. Prefer the session's creation cwd when present. */
function cwdOf(session: Session): string {
  const meta = (session as { meta?: { cwd?: string } }).meta
  return meta?.cwd ?? process.cwd()
}

/**
 * Fold an ordered message list into one bounded text blob for the extractor.
 * Keeps the TAIL when over budget: the newest messages carry what the turn
 * just decided and are the most valuable extraction input.
 */
function messagesToText(messages: readonly Message[], maxChars = 8000): string {
  const parts: string[] = []
  for (const m of messages) {
    const text = contentBlocksToText(m.content)
    if (text) parts.push(`${m.role}: ${text}`)
  }
  const joined = parts.join('\n')
  return joined.length > maxChars ? joined.slice(-maxChars) : joined
}

/** Merge an LLM ExtractionResult into storage. Upserts dedup by title/key;
 * events are deduped against recent timeline summaries (they have no key).
 * M8: todos/goals link to milestones by title, and updates[] apply state
 * changes to known items AFTER new items land (so "created + finished in one
 * turn" works). Unmatched updates are dropped silently — hallucinated titles
 * are the norm, not the exception. */
function mergeExtraction(yolo: Yolo, cwd: string, r: ExtractionResult): void {
  for (const m of r.milestones) yolo.addMilestone(cwd, { title: m.title, target_date: m.target_date, description: m.description, source: 'llm' })
  const link = (title: string | null | undefined): string | null =>
    title ? yolo.findMilestoneId(cwd, title) : null
  for (const t of r.todos) {
    yolo.addTodo(cwd, { title: t.title, due_at: t.due_at, priority: toPriority(t.priority), milestone_id: link(t.milestone_title), source: 'llm' })
  }
  for (const g of r.goals) yolo.addGoal(cwd, { title: g.title, description: g.description, milestone_id: link(g.milestone_title) })
  for (const p of r.preferences) yolo.addPreference(cwd, { key: p.key, value: p.value })
  const recentSummaries = new Set(yolo.listEvents(cwd, 30).map((e) => e.summary))
  for (const e of r.events) {
    if (recentSummaries.has(e.summary)) continue
    recentSummaries.add(e.summary)
    yolo.addEvent(cwd, { kind: e.kind, summary: e.summary, occurred_at: e.occurred_at ? Date.parse(e.occurred_at) || undefined : undefined })
  }
  applyUpdates(yolo, cwd, r.updates)
}

const MILESTONE_STATUSES: readonly MilestoneStatus[] = ['planned', 'active', 'done', 'abandoned']

/** Route LLM state-change updates onto the storage domain actions (M8). */
function applyUpdates(yolo: Yolo, cwd: string, updates: readonly ExtractedUpdate[]): void {
  for (const u of updates) {
    if (u.kind === 'todo') {
      if (u.status === 'done') yolo.applyTodoAction(cwd, { title: u.match_title }, 'complete')
      else if (u.status === 'cancelled') yolo.applyTodoAction(cwd, { title: u.match_title }, 'cancel')
      else if (u.status === 'in_progress') yolo.applyTodoAction(cwd, { title: u.match_title }, 'start')
      else if (u.due_at) yolo.applyTodoAction(cwd, { title: u.match_title }, 'postpone', { due_at: u.due_at })
    } else if (u.kind === 'goal') {
      if (typeof u.progress === 'number') yolo.applyGoalProgress(cwd, { title: u.match_title }, u.progress, u.note ?? undefined)
    } else if (u.kind === 'milestone' && u.status && MILESTONE_STATUSES.includes(u.status as MilestoneStatus)) {
      yolo.applyMilestoneStatus(cwd, { title: u.match_title }, u.status as MilestoneStatus)
    }
  }
}

/** Compact digest of what is already stored, so the model skips unchanged facts
 * and can target state changes (M8: rows carry status/progress/due). */
function knownDigest(yolo: Yolo, cwd: string): string | null {
  try {
    return buildKnownContext({
      todos: yolo.listTodos(cwd).map((t) => ({ title: t.title, status: t.status, due_at: t.due_at })),
      goals: yolo.listGoals(cwd).map((g) => ({ title: g.title, progress: g.progress })),
      milestones: yolo.listMilestones(cwd).map((m) => ({ title: m.title, status: m.status })),
      preferences: yolo.listPreferences(cwd).map((p) => ({ key: p.key, value: p.value })),
      events: yolo.listEvents(cwd, 15).map((e) => e.summary),
    })
  } catch {
    return null
  }
}

export function apply(ctx: Context): void {
  const yctx = ctx as YoloCtx
  const settings = (ctx as { settings?: SettingsLike }).settings

  // turn end: LLM semantic extraction (throttled per session)
  ctx.on('agent/turn-stopping', async (payload: { agent: { session: Session }; turn: number; signal?: AbortSignal }) => {
    try {
      const { agent, turn, signal } = payload
      const session = agent.session
      const cwd = cwdOf(session)

      const config = settings?.get(YOLO_NS)?.extraction
      if (config?.enableLLM === false) return

      const model = config?.model || 'deepseek-chat'
      const minIntervalMs = (config?.minIntervalSec ?? DEFAULTS.extractionMinIntervalSec) * 1000

      const last = yctx.yolo.lastExtractionAt(cwd, session.id, 'llm')
      if (last && Date.now() - last < minIntervalMs) return

      const turnText = messagesToText(session.deriveMessages())
      if (!turnText.trim()) return

      const started = Date.now()
      const result = await llmExtract({
        llm: yctx.llm,
        provider: 'deepseek',
        model,
        turnText,
        knownContext: knownDigest(yctx.yolo, cwd),
        signal,
      })

      mergeExtraction(yctx.yolo, cwd, result)
      const hasContent =
        result.todos.length > 0 || result.milestones.length > 0 || result.goals.length > 0 || result.updates.length > 0
      yctx.yolo.logExtraction(cwd, {
        session_id: session.id,
        turn_seq: turn,
        strategy: 'llm',
        status: hasContent ? 'ok' : 'empty',
        extracted_json: JSON.stringify(result),
        duration_ms: Date.now() - started,
      })
    } catch (e) {
      // never block turn close
      ctx.logger?.warn?.('[yolo-extract] turn failed: %s', e instanceof Error ? e.message : String(e))
    }
  })

  ctx.logger?.info?.('[yolo] extract plugin loaded')
}
