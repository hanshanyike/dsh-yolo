// YOLO extract plugin (M7) — LLM semantic extraction, the only strategy.
// The accepted direct-human messages are captured at agent/pre-step; after a
// durable successful turn/end, a separate serialized background job sends
// that bounded input to the extraction model as strict JSON. The old
// per-message regex fast path was removed: regexes could not judge semantics,
// produced noise, and the industry (Mem0 / Claude Code auto-memory) extracts
// with an LLM after a useful interaction, not per message.
//
// All handlers are failure-isolated: they never throw into the agent loop.

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { LlmRuntime, Message, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type Yolo from '../storage/index.ts'
import type { MilestoneStatus, Priority } from '../storage/types.ts'
import { DEFAULTS } from '../shared/constants.ts'
import { shouldDropExtracted } from '../shared/quality.ts'
import { sessionCwd } from '../shared/session.ts'
import { extractionTodoOperationId, todoEvidenceFingerprint, todoOperationRequestHash } from '../shared/todo-identity.ts'
import { isYoloSessionId } from '../ui/session.ts'
import { contentBlocksToText, llmExtract, type ExtractionResult, type ExtractedUpdate, type LlmExtractionObservation } from './llm-extract.ts'
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
    extraction?: {
      enableLLM?: boolean
      model?: string
      minIntervalSec?: number
      minTurnChars?: number
      maxRunsPerDay?: number
    }
  } | undefined
}

const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'urgent']

/** Coerce an LLM-provided priority string into the domain union (null when unknown). */
function toPriority(v: string | null | undefined): Priority | null {
  return PRIORITIES.includes(v as Priority) ? (v as Priority) : null
}

/** cwd for scope partitioning. Prefer the session's creation cwd when present. */
function cwdOf(session: Session): string {
  return sessionCwd(session) ?? process.cwd()
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

/** Keep only direct human input. Plugin context and tool results are also
 * user-role messages, but they are not evidence of a user's commitment. */
function humanMessagesToText(messages: readonly UserMessage[], maxChars = 8000): string {
  const joined = messages
    .filter((message) => message.source?.kind === 'user')
    .map((message) => contentBlocksToText(message.content).trim())
    .filter(Boolean)
    .map((text) => `user: ${text}`)
    .join('\n')
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined
}

/** A preview is provenance, not another transcript store. Keep only direct
 * human input from this accepted turn, normalize layout, and truncate by
 * Unicode code points so astral characters are never split. */
export function sourceExcerptFromMessages(messages: readonly UserMessage[], maxChars = 400): string | null {
  const text = messages
    .filter((message) => message.source?.kind === 'user')
    .map((message) => contentBlocksToText(message.content).trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!text) return null
  return Array.from(text).slice(0, maxChars).join('')
}

interface ExtractAgent extends Pick<Agent, 'id' | 'options' | 'session' | 'status'> {
  whenIdle?: () => Promise<void>
}

function completedTurn(session: Session, turn: number): boolean {
  const events = (session as Session & { events?: ReadonlyArray<{ type: string; data?: { turn?: number; reason?: { kind?: string } } }> }).events
  if (!events) return true
  let end: { data?: { reason?: { kind?: string } } } | undefined
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event.type === 'turn/end' && event.data?.turn === turn) {
      end = event
      break
    }
  }
  const reason = end?.data?.reason?.kind
  return reason === 'completed' || reason === 'max-tokens'
}

/** Modern hosts expose a durable event log and always deliver direct-human
 * input through agent/pre-step. Only event-log-less compatibility hosts may
 * use the derived-message fallback; otherwise an automatic Goal round
 * (`role=user`, `source.kind=goal`) can make every round re-extract an older
 * human request. */
function hasDurableEventLog(session: Session): boolean {
  return Array.isArray((session as Session & { events?: readonly unknown[] }).events)
}

function routeFor(ctx: Context, agent: ExtractAgent, configuredModel?: string): { provider: string; model: string } {
  const selected = (ctx as { get?: (name: string) => { currentSelection(): { provider: string; model: string } } | undefined })
    .get?.('agentDefaultModel')?.currentSelection()
  const provider = agent.options?.provider || selected?.provider || 'deepseek'
  const routedModel = agent.options?.model || selected?.model
  return {
    provider,
    // The historical setting stores only a model id, not its provider. Apply
    // it on the DeepSeek route where that id is meaningful; other providers
    // must keep their paired model instead of receiving "deepseek-chat".
    model: provider === 'deepseek' ? (configuredModel || routedModel || 'deepseek-chat') : (routedModel || configuredModel || 'deepseek-chat'),
  }
}

async function waitForSpacing(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms)
    function done(): void {
      signal.removeEventListener('abort', aborted)
      resolve()
    }
    function aborted(): void {
      clearTimeout(timer)
      reject(signal.reason ?? new Error('extraction spacing aborted'))
    }
    signal.addEventListener('abort', aborted, { once: true })
  })
}

/** Merge an LLM ExtractionResult into storage. Upserts dedup by title/key;
 * events are deduped against recent timeline summaries (they have no key).
 * M8: todos/goals link to milestones by title, and updates[] apply state
 * changes to known items AFTER new items land (so "created + finished in one
 * turn" works). Unmatched updates are dropped silently — hallucinated titles
 * are the norm, not the exception.
 * v0.3.0: everything lands with session attribution — events carry
 * session_id, NEW todos write a todo_created ledger event, and a
 * session_summary keeps the ledger's source badge readable. */
function mergeExtraction(
  yolo: Yolo,
  cwd: string,
  r: ExtractionResult,
  source: { sessionId: string; turn: number; excerpt: string | null; operationId: string; occurredAt: number },
): void {
  const { sessionId } = source
  // Write-quality gate (v0.3.2 / B3): junk acknowledgements and bare meta
  // commands never land in storage — a wrong memory can trigger a wrong reminder.
  for (const m of r.milestones) {
    if (shouldDropExtracted('milestone', m.title)) continue
    yolo.addMilestone(cwd, { title: m.title, target_date: m.target_date, description: m.description, source: 'llm' })
  }
  const link = (title: string | null | undefined): string | null =>
    title ? yolo.findMilestoneId(cwd, title) : null
  for (const t of r.todos) {
    if (shouldDropExtracted('todo', t.title)) continue
    const { todo, created } = yolo.addTodo(cwd, {
      title: t.title,
      due_at: t.due_at,
      priority: toPriority(t.priority),
      milestone_id: link(t.milestone_title),
      source: 'llm',
      session_id: sessionId,
      source_excerpt: source.excerpt,
      source_turn: source.excerpt ? source.turn : null,
      evidence_operation_key: source.operationId,
      evidence_source_kind: source.excerpt ? 'human' : 'extraction',
      evidence_occurred_at: source.occurredAt,
    })
    if (created) {
      yolo.addEvent(cwd, {
        kind: 'todo_created',
        summary: `＋ 记录新待办「${t.title}」`,
        detail: t.due_at ? `截止 ${t.due_at}` : null,
        session_id: sessionId,
        source: 'llm',
        subject_type: 'todo',
        subject_id: todo.id,
        subject_title: todo.title,
        change: {
          status: { before: null, after: todo.status },
          ...(todo.due_at ? { due_at: { before: null, after: todo.due_at } } : {}),
        },
      })
    }
  }
  for (const g of r.goals) {
    if (shouldDropExtracted('goal', g.title)) continue
    yolo.addGoal(cwd, { title: g.title, description: g.description, milestone_id: link(g.milestone_title) })
  }
  for (const p of r.preferences) {
    if (shouldDropExtracted('preference', p.key, p.value)) continue
    yolo.addPreference(cwd, { key: p.key, value: p.value, session_id: sessionId })
  }
  const recentSummaries = new Set(yolo.listEvents(cwd, 30).map((e) => e.summary))
  for (const e of r.events) {
    if (shouldDropExtracted('event', e.summary)) continue
    if (recentSummaries.has(e.summary)) continue
    recentSummaries.add(e.summary)
    yolo.addEvent(cwd, { kind: e.kind, summary: e.summary, occurred_at: e.occurred_at ? Date.parse(e.occurred_at) || undefined : undefined, session_id: sessionId, source: 'llm' })
  }
  if (r.session_summary) yolo.upsertSessionSummary(cwd, sessionId, r.session_summary)
  applyUpdates(yolo, cwd, r.updates, source)
}

const MILESTONE_STATUSES: readonly MilestoneStatus[] = ['planned', 'active', 'done', 'abandoned']

/** Route LLM state-change updates onto the storage domain actions (M8).
 * v0.3.0: carries session_id so ledger events stay attributed to their origin. */
function applyUpdates(
  yolo: Yolo,
  cwd: string,
  updates: readonly ExtractedUpdate[],
  source: { sessionId: string; turn: number; excerpt: string | null; operationId: string; occurredAt: number },
): void {
  const { sessionId } = source
  for (const u of updates) {
    if (u.kind === 'todo') {
      const args = { session_id: sessionId }
      let todo = null
      if (u.status === 'done') todo = yolo.applyTodoAction(cwd, { title: u.match_title }, 'complete', args)
      else if (u.status === 'cancelled') todo = yolo.applyTodoAction(cwd, { title: u.match_title }, 'cancel', args)
      else if (u.status === 'in_progress') todo = yolo.applyTodoAction(cwd, { title: u.match_title }, 'start', args)
      else if (u.due_at) todo = yolo.applyTodoAction(cwd, { title: u.match_title }, 'postpone', { due_at: u.due_at, ...args })
      if (todo) {
        yolo.addTodoEvidence(cwd, todo.id, {
          session_id: sessionId,
          turn_seq: source.turn,
          source_kind: source.excerpt ? 'human' : 'extraction',
          relation: u.status === 'done' ? 'completion_claim' : 'update',
          excerpt: source.excerpt,
          occurred_at: source.occurredAt,
          source_fingerprint: todoEvidenceFingerprint(source.operationId, todo.id),
        })
      }
    } else if (u.kind === 'goal') {
      if (typeof u.progress === 'number') yolo.applyGoalProgress(cwd, { title: u.match_title }, u.progress, u.note ?? undefined, sessionId)
    } else if (u.kind === 'milestone' && u.status && MILESTONE_STATUSES.includes(u.status as MilestoneStatus)) {
      yolo.applyMilestoneStatus(cwd, { title: u.match_title }, u.status as MilestoneStatus, sessionId)
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
  const captured = new Map<string, Map<number, UserMessage[]>>()
  const capturedAt = new Map<string, Map<number, number>>()
  const jobs = new Map<string, Promise<void>>()
  const scheduledTurns = new Set<string>()
  const controllers = new Set<AbortController>()

  ctx.on('agent/pre-step', async (
    payload: { agent: ExtractAgent; messages: UserMessage[]; turn: number; signal: AbortSignal },
    next: () => Promise<PreStepDecision>,
  ) => {
    const decision = await next()
    if (decision.kind !== 'enter' || payload.signal.aborted || isYoloSessionId(payload.agent.id)) return decision
    const human = decision.messages.filter((message) => message.source?.kind === 'user')
    if (human.length) {
      const turns = captured.get(payload.agent.id) ?? new Map<number, UserMessage[]>()
      const current = turns.get(payload.turn) ?? []
      const seen = new Set(current.map((message) => message.id))
      turns.set(payload.turn, [...current, ...human.filter((message) => !seen.has(message.id))])
      captured.set(payload.agent.id, turns)
      const clocks = capturedAt.get(payload.agent.id) ?? new Map<number, number>()
      if (!clocks.has(payload.turn)) clocks.set(payload.turn, Date.now())
      capturedAt.set(payload.agent.id, clocks)
    }
    return decision
  })

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'turn/end') return
    const reason = event.data.reason.kind
    if (reason === 'completed' || reason === 'max-tokens') return
    captured.get(session.id)?.delete(event.data.turn)
    capturedAt.get(session.id)?.delete(event.data.turn)
    scheduledTurns.delete(`${session.id}:${event.data.turn}`)
  })

  // Scheduling only: never keep the expiring turn signal or block turn close.
  ctx.on('agent/turn-stopping', (payload: { agent: ExtractAgent; turn: number }) => {
    const { agent, turn } = payload
    const hostOwnsIdleBoundary = typeof agent.whenIdle === 'function'
    const sessionId = agent.id || agent.session.id
    if (isYoloSessionId(sessionId)) return
    const turnKey = `${sessionId}:${turn}`
    if (scheduledTurns.has(turnKey)) return
    scheduledTurns.add(turnKey)

    const previous = jobs.get(sessionId) ?? Promise.resolve()
    const job = previous.catch(() => {}).then(async () => {
      try {
        await agent.whenIdle?.()
        // Read only after true idle so steering accepted after an earlier
        // turn-stopping boundary is included in the same extraction.
        const capturedMessages = captured.get(sessionId)?.get(turn) ?? []
        const acceptedAt = capturedAt.get(sessionId)?.get(turn)
        captured.get(sessionId)?.delete(turn)
        capturedAt.get(sessionId)?.delete(turn)
        if (!completedTurn(agent.session, turn)) return
        const session = agent.session
        const cwd = cwdOf(session)
        const config = settings?.get(YOLO_NS)?.extraction
        if (config?.enableLLM === false) return

        const route = routeFor(ctx, agent, config?.model)
        const derived = session.deriveMessages()
        const turnText = capturedMessages.length
          ? humanMessagesToText(capturedMessages)
          : !hasDurableEventLog(session)
              ? (() => {
                  // Compatibility only: never treat plugin/Goal user-role
                  // messages as human evidence, even on an older host.
                  const latest = [...derived].reverse().find((message) =>
                    message.role === 'user' && message.source?.kind === 'user',
                  )
                  return latest ? messagesToText([latest]) : ''
                })()
              : ''
        if (!turnText.trim()) return

        const lastUserText = capturedMessages.length
          ? contentBlocksToText(capturedMessages[capturedMessages.length - 1].content).trim()
          : turnText.replace(/^user:\s*/u, '').trim()
        const minTurnChars = config?.minTurnChars ?? DEFAULTS.extractionMinTurnChars
        if (lastUserText.length < minTurnChars) return

        const maxRunsPerDay = config?.maxRunsPerDay ?? DEFAULTS.extractionMaxRunsPerDay
        const todayStart = new Date().setHours(0, 0, 0, 0)
        if (yctx.yolo.countExtractionsSince(cwd, todayStart) >= maxRunsPerDay) {
          ctx.logger?.warn?.('[yolo-extract] daily run cap %d reached, skipping extraction', maxRunsPerDay)
          return
        }

        const controller = new AbortController()
        controllers.add(controller)
        const last = yctx.yolo.lastExtractionAt(cwd, session.id, 'llm')
        const spacingMs = (config?.minIntervalSec ?? DEFAULTS.extractionMinIntervalSec) * 1000
        const operationId = extractionTodoOperationId(session.id, turn)
        const requestHash = todoOperationRequestHash({ turnText, messages: capturedMessages.length || 1 })
        let started = Date.now()
        let observation: LlmExtractionObservation | undefined
        try {
          if (last) await waitForSpacing(Math.max(0, last + spacingMs - Date.now()), controller.signal)
          started = Date.now()
          const sourceExcerpt = sourceExcerptFromMessages(capturedMessages)
          const result = await llmExtract({
            llm: yctx.llm,
            provider: route.provider,
            model: route.model,
            turnText,
            knownContext: knownDigest(yctx.yolo, cwd),
            signal: controller.signal,
            // Resolve “today/tomorrow” from when the host accepted the user's
            // input, not from a later idle/spacing boundary that may cross midnight.
            now: new Date(acceptedAt ?? started),
            observe: (value) => { observation = value },
          })
          const hasContent = result.todos.length > 0 || result.milestones.length > 0 || result.goals.length > 0 || result.updates.length > 0
          const persisted = yctx.yolo.runIdempotentAction(cwd, operationId, requestHash, () => {
            if (sourceExcerpt) {
              yctx.yolo.promoteToolTodoOrigins(cwd, {
                session_id: session.id,
                source_excerpt: sourceExcerpt,
                source_turn: turn,
                created_from: acceptedAt ?? started,
                created_to: started,
                evidence_operation_key: operationId,
                evidence_occurred_at: acceptedAt ?? started,
              })
            }
            mergeExtraction(yctx.yolo, cwd, result, {
              sessionId: session.id,
              turn,
              // Compatibility fallback text is useful extraction input but is
              // not sufficiently strong provenance to persist as a quotation.
              excerpt: sourceExcerpt,
              operationId,
              occurredAt: acceptedAt ?? started,
            })
            yctx.yolo.logExtraction(cwd, {
              session_id: session.id,
              turn_seq: turn,
              strategy: 'llm',
              status: hasContent ? 'ok' : 'empty',
              extracted_json: JSON.stringify({
                raw: observation?.rawText ?? null,
                parsed: result,
                finish: observation?.finish ?? null,
                route,
                input: {
                  chars: turnText.length,
                  messages: capturedMessages.length || 1,
                  last_user_chars: lastUserText.length,
                  accepted_at: acceptedAt ? new Date(acceptedAt).toISOString() : null,
                },
              }),
              token_in: observation?.usage?.inputTokens ?? null,
              token_out: observation?.usage?.outputTokens ?? null,
              duration_ms: Date.now() - started,
            })
            return JSON.stringify({ status: hasContent ? 'ok' : 'empty' })
          })
          if (persisted.status === 'conflict') {
            ctx.logger?.warn?.('[yolo-extract] operation id reused with different input: %s', operationId)
          }
        } catch (e) {
          try {
            yctx.yolo.logExtraction(cwd, {
              session_id: session.id,
              turn_seq: turn,
              strategy: 'llm',
              status: 'error',
              extracted_json: JSON.stringify({
                error: e instanceof Error ? e.message : String(e),
                raw: observation?.rawText ?? null,
                finish: observation?.finish ?? null,
                route,
              }).slice(0, 1200),
              token_in: observation?.usage?.inputTokens ?? null,
              token_out: observation?.usage?.outputTokens ?? null,
              duration_ms: Date.now() - started,
            })
          } catch {
            // storage itself is unavailable; failure remains isolated
          }
          throw e
        } finally {
          controllers.delete(controller)
        }
      } catch (e) {
        ctx.logger?.warn?.('[yolo-extract] background extraction failed: %s', e instanceof Error ? e.message : String(e))
      }
    }).finally(() => {
      scheduledTurns.delete(turnKey)
      if (jobs.get(sessionId) === job) jobs.delete(sessionId)
    })
    jobs.set(sessionId, job)
    // Real dsh agents must return immediately so turn/end can commit and
    // whenIdle can resolve. Minimal compatibility hosts without whenIdle have
    // no such boundary, so returning the job preserves their serial contract.
    return hostOwnsIdleBoundary ? undefined : job
  })

  ;(ctx as { effect?: (effect: () => () => void) => unknown }).effect?.(() => () => {
    for (const controller of controllers) controller.abort(new Error('yolo-extract disposed'))
    controllers.clear()
    captured.clear()
    capturedAt.clear()
    scheduledTurns.clear()
  })

  ctx.logger?.info?.('[yolo] extract plugin loaded')
}
