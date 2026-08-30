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
import type { TodoIdentityCandidate } from '../domain/types.ts'
import { DEFAULTS } from '../shared/constants.ts'
import { sessionCwd } from '../shared/session.ts'
import { extractionTodoOperationId, todoOperationRequestHash } from '../shared/todo-identity.ts'
import { isYoloSessionId } from '../runtime/session-identity.ts'
import { contentBlocksToText, llmExtract, type LlmExtractionObservation } from './llm-extract.ts'
import { llmResolveTodoIdentity, TODO_RESOLVER_VERSION, type ShadowTodoResolution, type TodoResolverObservation } from './todo-resolver.ts'
import {
  applyExtractionResult,
  buildKnownMemoryContext,
  type TodoIdentityApplicationOutcome,
} from '../application/ingestion/apply-extraction.ts'
import { planTodoIdentityApplication } from '../application/ingestion/todo-identity-policy.ts'
import {
  runTodoResolverReplay,
  writeTodoResolverReplayStatus,
  TODO_RESOLVER_GOLD_AS_OF,
  TODO_RESOLVER_REPLAY_AS_OF,
  TODO_RESOLVER_REPLAY_FLAG,
  TODO_RESOLVER_REPLAY_INPUT,
  TODO_RESOLVER_REPLAY_OUTPUT,
  TODO_RESOLVER_REPLAY_STATUS,
} from '../evaluation/todo-resolver-replay.ts'

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
      todoIdentityR2Enabled?: boolean
    }
  } | undefined
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

function replayRouteFor(ctx: Context, configuredModel?: string): { provider: string; model: string } {
  const selected = (ctx as { get?: (name: string) => { currentSelection(): { provider: string; model: string } } | undefined })
    .get?.('agentDefaultModel')?.currentSelection()
  const provider = selected?.provider || 'deepseek'
  return {
    provider,
    model: provider === 'deepseek'
      ? (configuredModel || selected?.model || 'deepseek-chat')
      : (selected?.model || configuredModel || 'deepseek-chat'),
  }
}

function startConfiguredResolverReplay(ctx: Context, yctx: YoloCtx, settings?: SettingsLike): void {
  if (process.env[TODO_RESOLVER_REPLAY_FLAG] !== '1') return
  const input = process.env[TODO_RESOLVER_REPLAY_INPUT]
  const output = process.env[TODO_RESOLVER_REPLAY_OUTPUT]
  const status = process.env[TODO_RESOLVER_REPLAY_STATUS]
  if (!input || !output || !status) {
    ctx.logger?.warn?.('[yolo-extract] resolver replay requested without input/output/status paths')
    return
  }

  // Defer until the profile has finished registering its configured LLM
  // adapter and default-model selection. The normal product path remains
  // untouched when the explicit replay flag is absent.
  const controller = new AbortController()
  const timer = setTimeout(() => {
    const route = replayRouteFor(ctx, settings?.get(YOLO_NS)?.extraction?.model)
    const rawAsOf = process.env[TODO_RESOLVER_REPLAY_AS_OF] || TODO_RESOLVER_GOLD_AS_OF
    const asOf = new Date(rawAsOf)
    void runTodoResolverReplay({
      llm: yctx.llm,
      provider: route.provider,
      model: route.model,
      inputFile: input,
      outputFile: output,
      asOf,
      signal: controller.signal,
      onProgress: (completed, total, sampleId) => {
        ctx.logger?.info?.('[yolo-extract] resolver replay %d/%d: %s', completed, total, sampleId)
      },
    }).then((summary) => {
      writeTodoResolverReplayStatus(status, { status: 'ok', ...summary })
      ctx.logger?.info?.('[yolo-extract] resolver replay complete: %d/%d predicted', summary.predicted, summary.samples)
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      try {
        writeTodoResolverReplayStatus(status, { status: 'error', error: message.slice(0, 1000) })
      } catch (statusError) {
        ctx.logger?.warn?.('[yolo-extract] failed to write resolver replay status: %s', statusError instanceof Error ? statusError.message : String(statusError))
      }
      ctx.logger?.warn?.('[yolo-extract] resolver replay failed: %s', message)
    })
  }, 1_000)
  ctx.effect(() => () => {
    clearTimeout(timer)
    controller.abort(new Error('todo resolver replay host stopped'))
  })
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

export function apply(ctx: Context): void {
  const yctx = ctx as YoloCtx
  const settings = (ctx as { settings?: SettingsLike }).settings
  startConfiguredResolverReplay(ctx, yctx, settings)
  const capturedTodoCandidates = new Map<string, Map<number, TodoIdentityCandidate[]>>()
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
      yctx.yolo.observations.captureHumanTurn(
        payload.agent.id,
        payload.turn,
        cwdOf(payload.agent.session),
        human,
      )
      // Identity candidates are facts from BEFORE the assistant can run tools
      // in this turn. Capturing later at turn-stopping would let the shadow
      // resolver see the due/status that the assistant just wrote and inflate
      // offline accuracy by leaking the result into its input.
      const snapshots = capturedTodoCandidates.get(payload.agent.id) ?? new Map<number, TodoIdentityCandidate[]>()
      try {
        const existing = snapshots.get(payload.turn) ?? []
        const byId = new Map(existing.map((candidate) => [candidate.id, candidate]))
        for (const candidate of yctx.yolo.recallTodoIdentityCandidates(
          cwdOf(payload.agent.session),
          humanMessagesToText(human),
        )) {
          // Late human steering may introduce another todo. Add new ids but
          // never replace the first pre-tool snapshot of an existing id.
          if (!byId.has(candidate.id)) byId.set(candidate.id, candidate)
        }
        snapshots.set(payload.turn, [...byId.values()])
        capturedTodoCandidates.set(payload.agent.id, snapshots)
      } catch {
        // Candidate recall is observational. The durable extraction path
        // remains available and can use a conservative background fallback.
      }
    }
    return decision
  })

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'turn/end') return
    const reason = event.data.reason.kind
    if (reason === 'completed' || reason === 'max-tokens') return
    yctx.yolo.observations.discardHumanTurn(session.id, event.data.turn)
    capturedTodoCandidates.get(session.id)?.delete(event.data.turn)
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
        const capturedTurn = yctx.yolo.observations.takeHumanTurn(sessionId, turn)
        const capturedMessages = capturedTurn?.messages ?? []
        const acceptedAt = capturedTurn?.acceptedAt
        const preStepTodoCandidates = capturedTodoCandidates.get(sessionId)?.get(turn)
        capturedTodoCandidates.get(sessionId)?.delete(turn)
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
          // Snapshot resolver candidates before the legacy extraction write.
          // Otherwise a newly-created todo from this same turn would appear as
          // its own prior candidate and invalidate the shadow observation.
          const todoCandidates = (preStepTodoCandidates ?? yctx.yolo.recallTodoIdentityCandidates(cwd, turnText)).filter((candidate) =>
            !yctx.yolo.listTodoEvidence(cwd, candidate.id).some((evidence) =>
              evidence.session_id === session.id
              && evidence.turn_seq === turn
              && evidence.source_kind === 'assistant_action'
              && evidence.relation === 'origin',
            ),
          )
          const result = await llmExtract({
            llm: yctx.llm,
            provider: route.provider,
            model: route.model,
            turnText,
            knownContext: buildKnownMemoryContext(yctx.yolo, cwd),
            signal: controller.signal,
            // Resolve “today/tomorrow” from when the host accepted the user's
            // input, not from a later idle/spacing boundary that may cross midnight.
            now: new Date(acceptedAt ?? started),
            observe: (value) => { observation = value },
          })
          const hasContent = result.todos.length > 0 || result.milestones.length > 0 || result.goals.length > 0 || result.updates.length > 0
          const resolverStarted = Date.now()
          let resolverObservation: TodoResolverObservation | undefined
          let resolutions: ShadowTodoResolution[] = []
          let resolverError: unknown
          try {
            resolutions = await llmResolveTodoIdentity({
              llm: yctx.llm,
              provider: route.provider,
              model: route.model,
              turnText,
              candidates: todoCandidates,
              signal: controller.signal,
              now: new Date(acceptedAt ?? started),
              observe: (value) => { resolverObservation = value },
            })
          } catch (error) {
            resolverError = error
          }
          const todoIdentityPlan = resolverError
            ? undefined
            : planTodoIdentityApplication(result, resolutions, todoCandidates, config?.todoIdentityR2Enabled === true)
          const scope = yctx.yolo.scopeRefForCwd(cwd)
          let todoIdentityOutcome: TodoIdentityApplicationOutcome | undefined
          const persisted = yctx.yolo.runIdempotentScopeAction(scope, operationId, requestHash, (scopedCwd) => {
            if (sourceExcerpt) {
              yctx.yolo.promoteToolTodoOrigins(scopedCwd, {
                session_id: session.id,
                source_excerpt: sourceExcerpt,
                source_turn: turn,
                created_from: acceptedAt ?? started,
                created_to: started,
                evidence_operation_key: operationId,
                evidence_occurred_at: acceptedAt ?? started,
              })
            }
            todoIdentityOutcome = applyExtractionResult(yctx.yolo, scopedCwd, result, {
              sessionId: session.id,
              turn,
              // Compatibility fallback text is useful extraction input but is
              // not sufficiently strong provenance to persist as a quotation.
              excerpt: sourceExcerpt,
              operationId,
              occurredAt: acceptedAt ?? started,
            }, todoIdentityPlan)
            yctx.yolo.logExtraction(scopedCwd, {
              session_id: session.id,
              turn_seq: turn,
              strategy: 'llm',
              status: hasContent ? 'ok' : 'empty',
              extracted_json: JSON.stringify({
                raw: observation?.rawText ?? null,
                parsed: result,
                todo_identity: todoIdentityOutcome ?? todoIdentityPlan ?? { status: 'resolver_error' },
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
          } else {
            // The resolver prediction remains observational evidence. Only the
            // deterministic R2a application policy may authorize the narrow
            // same-workspace LINK/UPDATE subset, and its outcome is audited.
            if (!resolverError) {
              yctx.yolo.logTodoResolution(cwd, {
                session_id: session.id,
                turn_seq: turn,
                operation_id: operationId,
                input_fingerprint: requestHash,
                input_excerpt: turnText.slice(-1000),
                resolver_version: TODO_RESOLVER_VERSION,
                model_provider: route.provider,
                model_name: route.model,
                status: resolutions.length ? 'ok' : 'empty',
                candidates_json: JSON.stringify(todoCandidates),
                resolutions_json: JSON.stringify(resolutions),
                application_json: JSON.stringify(todoIdentityOutcome ?? todoIdentityPlan ?? null),
                token_in: resolverObservation?.usage?.inputTokens ?? null,
                token_out: resolverObservation?.usage?.outputTokens ?? null,
                duration_ms: Date.now() - resolverStarted,
              })
            } else {
              try {
                yctx.yolo.logTodoResolution(cwd, {
                  session_id: session.id,
                  turn_seq: turn,
                  operation_id: operationId,
                  input_fingerprint: requestHash,
                  input_excerpt: turnText.slice(-1000),
                  resolver_version: TODO_RESOLVER_VERSION,
                  model_provider: route.provider,
                  model_name: route.model,
                  status: 'error',
                  error: resolverError instanceof Error ? resolverError.message : String(resolverError),
                  candidates_json: JSON.stringify(todoCandidates),
                  resolutions_json: '[]',
                  application_json: JSON.stringify({ status: 'fallback', reason: 'resolver_error' }),
                  token_in: resolverObservation?.usage?.inputTokens ?? null,
                  token_out: resolverObservation?.usage?.outputTokens ?? null,
                  duration_ms: Date.now() - resolverStarted,
                })
              } catch {
                // Storage failure is already isolated by the outer extraction
                // handler. The completed extraction remains authoritative.
              }
              ctx.logger?.warn?.('[yolo-extract] shadow todo resolver failed: %s', resolverError instanceof Error ? resolverError.message : String(resolverError))
            }
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
    capturedTodoCandidates.clear()
    scheduledTurns.clear()
  })

  ctx.logger?.info?.('[yolo] extract plugin loaded')
}
