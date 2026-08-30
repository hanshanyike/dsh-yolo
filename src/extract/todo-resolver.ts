import { BlockAssembler, type FinishReason, type LlmRuntime, type Message, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type { TodoIdentityCandidate, TodoResolutionDecision, TodoResolutionPrediction } from '../domain/types.ts'
import { contentBlocksToText, localDateStr } from '../shared/text.ts'

export const TODO_RESOLVER_VERSION = 'shadow-v2'

const DECISIONS: readonly TodoResolutionDecision[] = [
  'LINK', 'UPDATE', 'REOPEN', 'NEW_OCCURRENCE', 'CREATE', 'ATTACH_STEP', 'ASK', 'NOOP',
]

export type ShadowTodoResolution = TodoResolutionPrediction

export interface TodoResolverObservation {
  rawText: string
  finish: FinishReason
  usage?: TokenUsage
}

function localClock(now: Date): string {
  const offsetMinutes = -now.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, '0')
  return `${localDateStr(now)}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}${sign}${hours}:${minutes}`
}

export function buildTodoCandidateContext(candidates: readonly TodoIdentityCandidate[]): string {
  if (candidates.length === 0) return '(no candidates recalled)'
  return candidates.map((candidate) => {
    const due = candidate.due_at ? ` due=${candidate.due_at}` : ''
    const aliases = candidate.aliases.length ? ` aliases=${JSON.stringify(candidate.aliases)}` : ''
    return `- id=${candidate.id} status=${candidate.status}${due} title=${JSON.stringify(candidate.title)}${aliases}`
  }).join('\n')
}

export function buildTodoResolverPrompt(now: Date): string {
  return `You are a shadow identity resolver for a managing assistant. Classify each management-relevant todo mention in the user's finished turn against the supplied candidate todos.

This is OBSERVATION ONLY. Your output is logged for evaluation and MUST NOT be treated as authorization to mutate, merge, reopen, or create anything.

Current local datetime: ${localClock(now)}.

Return ONLY JSON with this schema:
{"resolutions":[{"decision":"LINK|UPDATE|REOPEN|NEW_OCCURRENCE|CREATE|ATTACH_STEP|ASK|NOOP","candidate_ids":["stable-id"],"proposed_title":string|null,"confidence":0.0,"reason":string}]}

Decision meanings:
- LINK: the turn mentions or continues the same current occurrence without explicitly changing a stored field or state. Words such as "继续", "接着" and "还在处理" alone are LINK, not UPDATE.
- UPDATE: it explicitly changes a field or state of the same open occurrence, including due time, recipient, priority, status or another named attribute.
- REOPEN: it explicitly corrects a terminal occurrence (for example, "其实还没完成").
- NEW_OCCURRENCE: it explicitly introduces another occurrence (for example, "下周再做一次").
- CREATE: it is a new independent commitment.
- ATTACH_STEP: it is an execution step under an existing top-level todo.
- ASK: identity is ambiguous, including multiple plausible candidates or unclear terminal semantics.
- NOOP: no durable todo action is present or the turn only repeats a terminal fact.

Rules:
- Use only ids present in Candidate todos. Never invent an id.
- CREATE and NOOP normally use an empty candidate_ids array.
- An explicit personal obligation or plan such as "我要", "我得", "需要" or a deadline-bound action is durable. If it is independent of every candidate, use CREATE rather than NOOP.
- Prefer ASK over a risky link. Similar wording alone is insufficient: compare deliverable, actor, recipient, project, time and occurrence.
- A completed/cancelled candidate needs an explicit correction such as "其实还没完成" or "之前标错了" for REOPEN, or an explicit recurrence for NEW_OCCURRENCE. Vague wording such as "还得处理一下" is ASK, not REOPEN.
- Different workspaces are outside this candidate set and must not be inferred.
- Emit one row per distinct todo mention. If the turn contains no todo mention, return {"resolutions":[]}.
- confidence measures identity and decision certainty, not how important the task is. Use 0.98 or above only for LINK/UPDATE when exactly one open candidate matches every available distinguishing fact, no plausible competitor exists, and the decision follows the rules above. Use at most 0.95 for any residual ambiguity or non-authorized decision. Keep reason concise and in the user's language.`
}

function jsonCandidates(text: string): string[] {
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim()
  const candidates = [cleaned]
  const object = cleaned.match(/\{[\s\S]*\}/)
  if (object) candidates.push(object[0])
  return candidates
}

export function parseTodoResolverJson(text: string, allowedIds: ReadonlySet<string>): ShadowTodoResolution[] {
  let raw: unknown
  for (const candidate of jsonCandidates(text)) {
    try {
      raw = JSON.parse(candidate)
      if (raw && typeof raw === 'object' && Array.isArray((raw as { resolutions?: unknown }).resolutions)) break
    } catch {
      raw = undefined
    }
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { resolutions?: unknown }).resolutions)) {
    throw new Error('todo resolver returned malformed or wrong-schema JSON')
  }
  const result: ShadowTodoResolution[] = []
  for (const item of (raw as { resolutions: unknown[] }).resolutions) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    if (!DECISIONS.includes(value.decision as TodoResolutionDecision)) continue
    const candidateIds = Array.isArray(value.candidate_ids)
      ? [...new Set(value.candidate_ids.filter((id): id is string => typeof id === 'string' && allowedIds.has(id)))].slice(0, 5)
      : []
    const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
      ? Math.max(0, Math.min(1, value.confidence))
      : null
    result.push({
      decision: value.decision as TodoResolutionDecision,
      candidate_ids: candidateIds,
      proposed_title: typeof value.proposed_title === 'string' ? value.proposed_title.trim().slice(0, 200) || null : null,
      confidence,
      reason: typeof value.reason === 'string' ? value.reason.trim().slice(0, 300) || null : null,
    })
  }
  return result
}

export async function llmResolveTodoIdentity(opts: {
  llm: LlmRuntime
  provider: string
  model: string
  turnText: string
  candidates: readonly TodoIdentityCandidate[]
  signal?: AbortSignal
  now?: Date
  observe?: (observation: TodoResolverObservation) => void
}): Promise<ShadowTodoResolution[]> {
  const { llm, provider, model, turnText, candidates, signal, now = new Date(), observe } = opts
  if (!turnText.trim()) return []
  const content = `Candidate todos:\n${buildTodoCandidateContext(candidates)}\n\n--- Conversation turn ---\n${turnText}`
  const stream = llm.stream({
    provider,
    model,
    system: buildTodoResolverPrompt(now),
    messages: [{ role: 'user', content: [{ type: 'text', text: content }] }] as Message[],
    temperature: 0,
    maxTokens: 1024,
    purpose: 'session-title',
    signal,
  })
  const assembler = new BlockAssembler()
  for await (const chunk of stream) assembler.push(chunk)
  const finish = assembler.finish
  const text = contentBlocksToText(assembler.blocks()).trim()
  observe?.({ rawText: text, finish, usage: assembler.usage })
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    throw new Error(`todo resolver ${finish.kind}: ${finish.failure.message}`)
  }
  if (!text) throw new Error('todo resolver returned no text')
  return parseTodoResolverJson(text, new Set(candidates.map((candidate) => candidate.id)))
}
