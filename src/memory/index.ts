// YOLO memory plugin — model-visible memory management + persistent context.
// M1: memory tools (memory_search/write/forget, yolo_query).
// M3: systemPrompt preference preamble + dynamic recall from the latest user message.
// v0.3.0: host-LLM semantic recall (expansion + rerank) prewarmed per user message.

import type { Context } from '@deepseek-ai/cordis'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { contentBlocksToText } from '../shared/text.ts'
import { sessionCwd, sessionId } from '../shared/session.ts'
import { isYoloSessionId } from '../ui/session.ts'
import { DEFAULTS } from '../shared/constants.ts'
import { RecallDedupTracker, registerYoloPrompt } from './recall.ts'
import { registerYoloTools, type YoloContext } from './tools.ts'
import {
  defaultSemanticConfig,
  expandQuery,
  rerankCandidates,
  dedupeSearchHits,
  SemanticRecall,
  type RerankVerdict,
  type SemanticConfig,
} from './semantic.ts'

export const name = 'yolo-memory'
export const inject = ['yolo', 'tools', 'systemPrompt', 'llm', 'settings'] as const

const YOLO_NS = settingsNamespace('yolo')

type SettingsLike = { get?(ns: unknown): { semantic?: Partial<SemanticConfig> } | undefined }

/** Read the live semanticRecall config slice from settings (fall back to DEFAULTS). */
function readSemanticConfig(settings: SettingsLike | undefined): SemanticConfig {
  const cc = settings?.get?.(YOLO_NS)?.semantic
  return { ...defaultSemanticConfig(), ...(cc ?? {}) }
}

export function apply(ctx: Context): void {
  const yctx = ctx as YoloContext
  const llm = (ctx as unknown as { llm: LlmRuntime }).llm
  registerYoloTools(yctx)

  // track the latest user message for dynamic recall (AssembleContext has no userMessage in rc.8)
  // and the latest session cwd so recall reads the scope extraction writes to.
  let lastUserText = ''
  let lastSessionCwd: string | undefined
  const recallDedup = new RecallDedupTracker()
  const semantic = new SemanticRecall(readSemanticConfig((ctx as unknown as { settings?: SettingsLike }).settings))

  const prewarmSemantic = (session: Session, text: string): void => {
    if (!llm) return
    const query = text.trim()
    const cfg = readSemanticConfig((ctx as unknown as { settings?: SettingsLike }).settings)
    semantic.setConfig(cfg)
    if (!semantic.shouldExpand(query)) return
    const cwd = sessionCwd(session) ?? lastSessionCwd ?? process.cwd()
    const session_id = sessionId(session) ?? null
    void (async () => {
      const started = Date.now()
      try {
        const expansions = await expandQuery(llm, { model: cfg.model, text: query, topK: cfg.expansionsPerQuery })
        const latency = Date.now() - started
        semantic.noteOutcome(expansions.length > 0)
        semantic.rememberExpansions(query, expansions)
        semantic.consumeDaily()
        const detHits = yctx.yolo.search(cwd, query, DEFAULTS.recallTopK)
        const expanded = dedupeSearchHits([...detHits, ...expansions.flatMap((e) => yctx.yolo.search(cwd, e, DEFAULTS.recallTopK))])
        let rerankOutcome: RerankVerdict[] | undefined
        if (cfg.rerankOn && expanded.length > 0) {
          rerankOutcome = await rerankCandidates(llm, {
            model: cfg.model,
            query,
            candidates: expanded.slice(0, cfg.maxRerankCandidates),
            limit: cfg.maxRerankCandidates,
          })
          if (rerankOutcome.length) semantic.rememberRerank(query, expanded, rerankOutcome)
        }
        yctx.yolo.logRecall(cwd, {
          session_id,
          query,
          expansions: expansions.length ? JSON.stringify(expansions) : null,
          rerank_outcome: rerankOutcome?.length ? JSON.stringify(rerankOutcome) : null,
          latency_ms: latency,
          source: 'user',
          status: expansions.length ? 'ok' : 'empty',
        })
      } catch (e) {
        semantic.noteOutcome(false)
        yctx.yolo.logRecall(cwd, {
          session_id,
          query,
          source: 'user',
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
          latency_ms: Date.now() - started,
        })
      }
    })()
  }

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    // YOLO threads own their scope: their events never move lastSessionCwd,
    // and recall prewarm skips them (reminder/tool traffic must not burn the
    // semantic-recall budget or pollute the tracked user message).
    if (isYoloSessionId(sessionId(session))) return
    const sessionWd = sessionCwd(session)
    if (sessionWd) lastSessionCwd = sessionWd
    if (event.type !== 'user/message') return
    const text = contentBlocksToText((event.data as { content?: readonly unknown[] }).content)
    if (!text) return
    lastUserText = text
    recallDedup.onUserMessage(sessionId(session) ?? '', text)
    prewarmSemantic(session, text)
  })

  registerYoloPrompt(ctx, {
    yolo: yctx.yolo,
    cwd: () => lastSessionCwd ?? process.cwd(),
    getLastUserText: () => lastUserText,
    getInjected: () => recallDedup.getInjected(),
    onRecallKept: (keys) => recallDedup.onRecallKept(keys),
    semantic,
    logger: ctx.logger,
  })

  ctx.logger?.info?.('[yolo] memory plugin loaded')
}

