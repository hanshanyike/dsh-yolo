// YOLO LLM extraction — the turn-end semantic pass (the only extraction
// strategy since M7; the per-message regex fast path was removed).
// Folds ctx.llm.stream output via BlockAssembler, then parses strict JSON with
// defensive parsing. Provider/transport failures throw to the turn handler,
// which isolates them from the agent loop and writes an error audit row.

import { BlockAssembler, type FinishReason, type LlmRuntime, type Message, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { contentBlocksToText } from '../shared/text.ts'
import { buildExtractionPrompt } from './prompt.ts'
import type { ExtractionResult } from '../contracts/extraction.ts'

export type {
  ExtractedEvent,
  ExtractedGoal,
  ExtractedMilestone,
  ExtractedPreference,
  ExtractedTodo,
  ExtractedUpdate,
  ExtractionResult,
} from '../contracts/extraction.ts'

export { contentBlocksToText }

export const EMPTY_EXTRACTION: ExtractionResult = {
  session_summary: null,
  milestones: [],
  todos: [],
  goals: [],
  preferences: [],
  events: [],
  updates: [],
}

/** Accept date-only deadlines and timezone-qualified ISO-8601 instants. */
function validDueAt(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) return text
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(text) && Number.isFinite(Date.parse(text))) return text
  return null
}

function extractionCandidates(text: string): string[] {
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim()
  const candidates = [cleaned]
  const brace = cleaned.match(/\{[\s\S]*\}/)
  if (brace) candidates.push(brace[0])
  return candidates
}

function parseExtractionJsonStrict(text: string): ExtractionResult {
  const recognized = ['session_summary', 'milestones', 'todos', 'goals', 'preferences', 'events', 'updates']
  for (const c of extractionCandidates(text)) {
    try {
      const parsed = JSON.parse(c) as Partial<ExtractionResult>
      if (!parsed || typeof parsed !== 'object' || !recognized.some((key) => Object.hasOwn(parsed, key))) continue
      return validateExtraction(parsed)
    } catch {
      // try next candidate
    }
  }
  throw new Error('extraction model returned malformed or wrong-schema JSON')
}

/** Tolerant public parser used by offline callers. Runtime extraction uses the
 * strict sibling so malformed output is audited as an error, not false empty. */
export function parseExtractionJson(text: string): ExtractionResult {
  try {
    return parseExtractionJsonStrict(text)
  } catch {
    return EMPTY_EXTRACTION
  }
}

/** Shape-check + coerce parsed JSON into a well-typed ExtractionResult. */
export function validateExtraction(raw: Partial<ExtractionResult> | null | undefined): ExtractionResult {
  const result: ExtractionResult = { session_summary: null, milestones: [], todos: [], goals: [], preferences: [], events: [], updates: [] }
  if (!raw || typeof raw !== 'object') return result
  if (typeof raw.session_summary === 'string' && raw.session_summary.trim()) {
    result.session_summary = raw.session_summary.trim().slice(0, 32)
  }
  for (const m of Array.isArray(raw.milestones) ? raw.milestones : []) {
    if (m && typeof m.title === 'string') {
      result.milestones.push({
        title: m.title,
        target_date: typeof m.target_date === 'string' ? m.target_date : null,
        description: typeof m.description === 'string' ? m.description : null,
      })
    }
  }
  for (const t of Array.isArray(raw.todos) ? raw.todos : []) {
    if (t && typeof t.title === 'string') {
      result.todos.push({
        title: t.title,
        due_at: validDueAt(t.due_at),
        priority: typeof t.priority === 'string' ? t.priority : null,
        milestone_title: typeof t.milestone_title === 'string' ? t.milestone_title : null,
      })
    }
  }
  for (const g of Array.isArray(raw.goals) ? raw.goals : []) {
    if (g && typeof g.title === 'string') {
      result.goals.push({
        title: g.title,
        description: typeof g.description === 'string' ? g.description : null,
        milestone_title: typeof g.milestone_title === 'string' ? g.milestone_title : null,
        completion_hint: typeof g.completion_hint === 'string' ? g.completion_hint : null,
        target_date: validDueAt(g.target_date),
        management_intent: g.management_intent === 'explicit' || g.management_intent === 'inferred' || g.management_intent === 'unclear'
          ? g.management_intent
          : 'unclear',
      })
    }
  }
  for (const p of Array.isArray(raw.preferences) ? raw.preferences : []) {
    if (p && typeof p.key === 'string' && typeof p.value === 'string') {
      result.preferences.push({ key: p.key, value: p.value })
    }
  }
  for (const e of Array.isArray(raw.events) ? raw.events : []) {
    if (e && typeof e.summary === 'string') {
      const kind = e.kind === 'decision' || e.kind === 'milestone_reached' || e.kind === 'note' ? e.kind : 'note'
      result.events.push({
        kind,
        summary: e.summary,
        occurred_at: typeof e.occurred_at === 'string' ? e.occurred_at : null,
      })
    }
  }
  for (const u of Array.isArray(raw.updates) ? raw.updates : []) {
    if (u && typeof u.match_title === 'string' && (u.kind === 'todo' || u.kind === 'goal' || u.kind === 'milestone')) {
      result.updates.push({
        kind: u.kind,
        match_title: u.match_title,
        status: typeof u.status === 'string' ? u.status : null,
        progress: typeof u.progress === 'number' ? Math.round(u.progress) : null,
        due_at: validDueAt(u.due_at),
        note: typeof u.note === 'string' ? u.note : null,
      })
    }
  }
  return result
}

export interface LlmExtractOptions {
  llm: LlmRuntime
  provider: string
  model: string
  turnText: string
  /** Compact digest of already-stored memories — the model skips unchanged facts. */
  knownContext?: string | null
  signal?: AbortSignal
  /** Authoritative host-local clock captured when the host accepted the input. */
  now?: Date
  /** Capture the provider-neutral response before normalization for audit/debug. */
  observe?: (observation: LlmExtractionObservation) => void
}

export interface LlmExtractionObservation {
  rawText: string
  finish: FinishReason
  usage?: TokenUsage
}

/**
 * Run the turn-end extraction call. Returns a full result (possibly empty).
 * NOTE: host's GenerateOptions.purpose only accepts 'compaction' | 'session-title'
 * (no custom tag), so we use 'session-title' to segregate auxiliary traffic.
 */
export async function llmExtract(opts: LlmExtractOptions): Promise<ExtractionResult> {
  const { llm, provider, model, turnText, knownContext, signal, observe, now = new Date() } = opts
  if (!turnText.trim()) return EMPTY_EXTRACTION

  const userContent = knownContext
    ? `Known memories (do not re-extract unchanged facts):\n${knownContext}\n\n--- Conversation turn ---\n${turnText}`
    : turnText

  const stream = llm.stream({
    provider,
    model,
    system: buildExtractionPrompt(now),
    messages: [{ role: 'user', content: [{ type: 'text', text: userContent }] }] as Message[],
    temperature: 0,
    maxTokens: 2048,
    purpose: 'session-title',
    signal,
  })

  const assembler = new BlockAssembler()
  for await (const chunk of stream) {
    assembler.push(chunk)
  }
  const finish = assembler.finish
  const blocks = assembler.blocks()
  const text = contentBlocksToText(blocks).trim()
  observe?.({ rawText: text, finish, usage: assembler.usage })
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    throw new Error(`extraction model ${finish.kind}: ${finish.failure.message}`)
  }
  if (!text) throw new Error('extraction model returned no text')
  return parseExtractionJsonStrict(text)
}
