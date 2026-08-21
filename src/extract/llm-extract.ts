// YOLO LLM extraction — the turn-end semantic pass (the only extraction
// strategy since M7; the per-message regex fast path was removed).
// Folds ctx.llm.stream output via BlockAssembler, then parses strict JSON with
// defensive fallbacks. Never throws into the caller: all failures return empty.

import { BlockAssembler, type LlmRuntime, type Message } from '@deepseek-ai/dsh-llm'
import { contentBlocksToText } from '../shared/text.ts'
import { buildExtractionPrompt } from './prompt.ts'

export { contentBlocksToText }

export interface ExtractedTodo {
  title: string
  due_at?: string | null
  priority?: string | null
  milestone_title?: string | null
}
export interface ExtractedMilestone {
  title: string
  target_date?: string | null
  description?: string | null
}
export interface ExtractedGoal {
  title: string
  description?: string | null
  milestone_title?: string | null
}
export interface ExtractedPreference {
  key: string
  value: string
}
export interface ExtractedEvent {
  kind: 'note' | 'decision' | 'milestone_reached'
  summary: string
  occurred_at?: string | null
}
/** M8: state change of an item already in Known memories (matched by title). */
export interface ExtractedUpdate {
  kind: 'todo' | 'goal' | 'milestone'
  match_title: string
  status?: string | null
  progress?: number | null
  due_at?: string | null
  note?: string | null
}

export interface ExtractionResult {
  milestones: ExtractedMilestone[]
  todos: ExtractedTodo[]
  goals: ExtractedGoal[]
  preferences: ExtractedPreference[]
  events: ExtractedEvent[]
  updates: ExtractedUpdate[]
}

export const EMPTY_EXTRACTION: ExtractionResult = {
  milestones: [],
  todos: [],
  goals: [],
  preferences: [],
  events: [],
  updates: [],
}

/** Defensive parse of the model's JSON output. Returns empty result on any failure. */
export function parseExtractionJson(text: string): ExtractionResult {
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim()
  const candidates = [cleaned]
  const brace = cleaned.match(/\{[\s\S]*\}/)
  if (brace) candidates.push(brace[0])
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as Partial<ExtractionResult>
      return validateExtraction(parsed)
    } catch {
      // try next candidate
    }
  }
  return EMPTY_EXTRACTION
}

/** Shape-check + coerce parsed JSON into a well-typed ExtractionResult. */
export function validateExtraction(raw: Partial<ExtractionResult> | null | undefined): ExtractionResult {
  const result: ExtractionResult = { milestones: [], todos: [], goals: [], preferences: [], events: [], updates: [] }
  if (!raw || typeof raw !== 'object') return result
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
        due_at: typeof t.due_at === 'string' ? t.due_at : null,
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
        due_at: typeof u.due_at === 'string' ? u.due_at : null,
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
}

/**
 * Run the turn-end extraction call. Returns a full result (possibly empty).
 * NOTE: host's GenerateOptions.purpose only accepts 'compaction' | 'session-title'
 * (no custom tag), so we use 'session-title' to segregate auxiliary traffic.
 */
export async function llmExtract(opts: LlmExtractOptions): Promise<ExtractionResult> {
  const { llm, provider, model, turnText, knownContext, signal } = opts
  if (!turnText.trim()) return EMPTY_EXTRACTION

  const userContent = knownContext
    ? `Known memories (do not re-extract unchanged facts):\n${knownContext}\n\n--- Conversation turn ---\n${turnText}`
    : turnText

  const stream = llm.stream({
    provider,
    model,
    system: buildExtractionPrompt(new Date()),
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
  const blocks = assembler.blocks()
  return parseExtractionJson(contentBlocksToText(blocks))
}
