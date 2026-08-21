// YOLO extract plugin — the hybrid extractor.
//   fast path: per-message rule capture via `session/event`
//   slow path: turn-end LLM structured pull via `agent/turn-stopping`
// All handlers are failure-isolated: they never throw into the agent loop.

import type { Context } from '@deepseek-ai/cordis'
import type { LlmRuntime, Message } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type Yolo from '../storage/index.ts'
import type { Priority } from '../storage/types.ts'
import { DEFAULTS } from '../shared/constants.ts'
import { CandidateBuffer } from './buffer.ts'
import { contentBlocksToText, llmExtract, type ExtractionResult } from './llm-extract.ts'
import { mergeCandidates } from './merge.ts'
import { extractCandidates } from './rules.ts'

export const name = 'yolo-extract'
export const inject = ['yolo', 'llm', 'sessions'] as const

interface YoloCtx extends Context {
  yolo: Yolo
  llm: LlmRuntime
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

/** Fold an ordered message list into one bounded text blob for the extractor. */
function messagesToText(messages: readonly Message[], maxChars = 8000): string {
  const parts: string[] = []
  for (const m of messages) {
    const text = contentBlocksToText(m.content)
    if (text) parts.push(`${m.role}: ${text}`)
  }
  const joined = parts.join('\n')
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined
}

/** Merge an LLM ExtractionResult into storage (mirrors mergeCandidates for rule output). */
function mergeExtraction(yolo: Yolo, cwd: string, r: ExtractionResult): void {
  for (const m of r.milestones) yolo.addMilestone(cwd, { title: m.title, target_date: m.target_date, description: m.description, source: 'llm' })
  for (const t of r.todos) yolo.addTodo(cwd, { title: t.title, due_at: t.due_at, priority: toPriority(t.priority), source: 'llm' })
  for (const g of r.goals) yolo.addGoal(cwd, { title: g.title, description: g.description })
  for (const p of r.preferences) yolo.addPreference(cwd, { key: p.key, value: p.value })
  for (const e of r.events) yolo.addEvent(cwd, { kind: e.kind, summary: e.summary, occurred_at: e.occurred_at ? Date.parse(e.occurred_at) : undefined })
}

export function apply(ctx: Context): void {
  const yctx = ctx as YoloCtx
  const buffers = new Map<string, CandidateBuffer>()
  const minIntervalMs = DEFAULTS.extractionMinIntervalSec * 1000

  // fast path — rules on every user/assistant message
  ctx.on('session/event', (session: Session, event: { type: string; data: unknown }) => {
    if (event.type !== 'user/message' && event.type !== 'assistant/message') return
    const text = contentBlocksToText((event.data as { content?: readonly unknown[] }).content)
    if (!text) return
    let buf = buffers.get(session.id)
    if (!buf) {
      buf = new CandidateBuffer()
      buffers.set(session.id, buf)
    }
    for (const c of extractCandidates(text)) buf.add(c)
  })

  // slow path — turn end: flush rules + LLM structured pull
  ctx.on('agent/turn-stopping', async (payload: { agent: { session: Session }; turn: number; signal?: AbortSignal }) => {
    try {
      const { agent, turn, signal } = payload
      const session = agent.session
      const cwd = cwdOf(session)

      // 1) flush rule candidates
      const buf = buffers.get(session.id)
      if (buf && buf.size > 0) {
        mergeCandidates(yctx.yolo, cwd, buf.drain())
      }

      // 2) throttled LLM extraction
      const last = yctx.yolo.lastExtractionAt(cwd, session.id, 'llm')
      if (last && Date.now() - last < minIntervalMs) return

      const turnText = messagesToText(session.deriveMessages())
      if (!turnText.trim()) return

      const started = Date.now()
      const result = await llmExtract({
        llm: yctx.llm,
        // host default; overridable at M4 via plugin config
        provider: 'deepseek',
        model: 'deepseek-chat',
        turnText,
        signal,
      })

      mergeExtraction(yctx.yolo, cwd, result)
      const hasContent = result.todos.length > 0 || result.milestones.length > 0 || result.goals.length > 0
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
}
