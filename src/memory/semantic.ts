// YOLO semantic recall — host-LLM query expansion + candidate rerank, stacked on
// the deterministic FTS hybrid recall. No embedding dependency: the host's LLM
// is reused (purpose 'session-title' segregates auxiliary traffic, same as briefs).
//
// Guarantees:
//  - expansion/rerank NEVER block the read path (async prewarm fills a cache)
//  - LLM failure silently falls back to deterministic recall (never empty)
//  - rerank never bypasses the deterministic applyRecallPolicy in recall.ts
//  - a hard deterministic floor keeps at least recallTopK hits on any rerank

import { BlockAssembler, type LlmRuntime, type Message } from '@deepseek-ai/dsh-llm'
import { contentBlocksToText } from '../shared/text.ts'
import { DEFAULTS } from '../shared/constants.ts'
import type { SearchHit } from '../domain/types.ts'

/** semanticRecall config slice (lives in the yolo settings namespace). */
export interface SemanticConfig {
  enabled: boolean
  model: string
  expansionsPerQuery: number
  rerankOn: boolean
  maxRerankCandidates: number
  dailyBudget: number
  minQueryChars: number
  /** R15/P39 auto-degrade guard: after this many consecutive empty expansion
   * runs, stop calling the LLM for the rest of the day (deterministic FTS only).
   * 0 disables the guard. */
  degradeAfterEmpty: number
}

export function defaultSemanticConfig(): SemanticConfig {
  return { ...DEFAULTS.semantic }
}

export interface RerankVerdict {
  key: string
  keep: boolean
  reason: 'confident' | 'related' | 'weak' | 'irrelevant'
}

const keyOf = (h: SearchHit): string => `${h.row_type}:${h.row_id}`

/** Merge hits, deduped by (row_type,row_id) preserving first-seen order. */
export function dedupeSearchHits(hits: readonly SearchHit[]): SearchHit[] {
  const seen = new Set<string>()
  const out: SearchHit[] = []
  for (const h of hits) {
    const k = keyOf(h)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(h)
  }
  return out
}

/** Local day key (YYYY-MM-DD) for the daily semantic budget. */
function dayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// ---- LLM plumbing (same shape as extract/llm-extract.ts) ----

async function llmText(
  llm: LlmRuntime,
  opts: { model: string; system: string; user: string; signal?: AbortSignal },
): Promise<string> {
  const stream = llm.stream({
    provider: 'deepseek',
    model: opts.model,
    system: opts.system,
    messages: [{ role: 'user', content: [{ type: 'text', text: opts.user }] }] as Message[],
    temperature: 0,
    maxTokens: 512,
    purpose: 'session-title',
    signal: opts.signal,
  })
  const assembler = new BlockAssembler()
  for await (const chunk of stream) assembler.push(chunk)
  return contentBlocksToText(assembler.blocks())
}

/** Pull the first JSON array out of an LLM reply (tolerates code fences/prose). */
function extractJsonArray(text: string): unknown[] {
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim()
  const m = cleaned.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const v = JSON.parse(m[0])
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

const EXPAND_SYSTEM =
  'You expand a user query into equivalent search queries. Return ONLY a JSON array of strings, e.g. ["季度总结","Q3 report","第一季度汇报"]. Generate 1-3 queries that a retrieval index might contain, covering paraphrase and cross-language (translate non-English queries into English and CJK when likely). Never invent entities not present in the query. No prose, no fences.'

function buildExpandUser(text: string, topK: number): string {
  return `Original query (Chinese or mixed): "${text}"\nReturn up to ${topK} equivalent retrieval queries as a JSON array of strings.`
}

const RERANK_SYSTEM =
  'You rank candidate memory rows against a user query for relevance. Return ONLY a JSON array of objects, each { key, keep, reason } where key must exactly match the provided candidate key, keep is boolean, and reason is one of confident|related|weak|irrelevant. Sort kept candidates best-first. No prose, no fences.'

function buildRerankUser(query: string, candidates: readonly SearchHit[], limit: number): string {
  const rows = candidates
    .slice(0, limit)
    .map((h, i) => `${i + 1}. key="${keyOf(h)}" [${h.row_type}] ${h.title} — ${h.body.slice(0, 60)}`)
    .join('\n')
  return `User query: "${query}"\nCandidates:\n${rows}\nReturn a JSON array of { key, keep, reason } using the exact candidate keys above.`
}

/** Expand a user query into equivalent retrieval queries. Never throws. */
export async function expandQuery(
  llm: LlmRuntime,
  opts: { model: string; text: string; topK: number; signal?: AbortSignal },
): Promise<string[]> {
  try {
    const text = await llmText(llm, { model: opts.model, system: EXPAND_SYSTEM, user: buildExpandUser(opts.text, opts.topK), signal: opts.signal })
    const raw = extractJsonArray(text)
    const seen = new Set<string>()
    const out: string[] = []
    for (const s of raw) {
      const v = String(s).trim()
      if (!v || seen.has(v)) continue
      seen.add(v)
      out.push(v)
      if (out.length >= opts.topK) break
    }
    return out
  } catch {
    return []
  }
}

/** Rank a candidate pool against a user query. Never throws. */
export async function rerankCandidates(
  llm: LlmRuntime,
  opts: { model: string; query: string; candidates: readonly SearchHit[]; limit: number; signal?: AbortSignal },
): Promise<RerankVerdict[]> {
  try {
    const text = await llmText(llm, { model: opts.model, system: RERANK_SYSTEM, user: buildRerankUser(opts.query, opts.candidates, opts.limit), signal: opts.signal })
    const valid = new Set(opts.candidates.map(keyOf))
    const raw = extractJsonArray(text)
    const seen = new Set<string>()
    const out: RerankVerdict[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const o = item as { key?: unknown; keep?: unknown; reason?: unknown }
      if (typeof o.key !== 'string' || !valid.has(o.key) || seen.has(o.key)) continue
      seen.add(o.key)
      const reason: RerankVerdict['reason'] =
        o.reason === 'confident' || o.reason === 'related' || o.reason === 'weak' || o.reason === 'irrelevant' ? o.reason : 'related'
      out.push({ key: o.key, keep: o.keep === true || o.keep === 'true', reason })
      if (out.length >= opts.limit) break
    }
    return out
  } catch {
    return []
  }
}

/** Session-invariant cache + daily budget for expansion and rerank. */
export class SemanticRecall {
  private cfg: SemanticConfig
  private readonly expCache = new Map<string, string[]>()
  private readonly rerankCache = new Map<string, RerankVerdict[]>()
  private usedToday = 0
  private today = dayKey()
  private consecutiveEmpty = 0
  private degraded = false

  constructor(cfg?: Partial<SemanticConfig>) {
    this.cfg = { ...defaultSemanticConfig(), ...cfg }
  }

  setConfig(cfg: Partial<SemanticConfig>): void {
    this.cfg = { ...this.cfg, ...cfg }
    if (cfg.degradeAfterEmpty === 0) {
      this.consecutiveEmpty = 0
      this.degraded = false
    }
  }

  private rollDay(): void {
    const d = dayKey()
    if (d !== this.today) {
      this.today = d
      this.usedToday = 0
      // A new day is a fresh chance for the model: clear the auto-degrade.
      // Without this, one flaky day silenced semantic recall FOREVER —
      // shouldExpand() short-circuits on degraded, so noteOutcome(true) could
      // never run again to lift it (stuck until process restart).
      this.consecutiveEmpty = 0
      this.degraded = false
    }
  }

  /** True when we should run an LLM expansion for this query (gated + uncached). */
  shouldExpand(query: string): boolean {
    this.rollDay()
    const q = query.trim()
    if (!this.cfg.enabled || this.cfg.expansionsPerQuery <= 0) return false
    if (this.degraded) return false
    if (q.length < this.cfg.minQueryChars) return false
    if (this.usedToday >= this.cfg.dailyBudget) return false
    return !this.expCache.has(q)
  }

  /** Feed back the outcome of an expansion run (R15/P39 auto-degrade guard).
   * A non-empty result resets the streak; repeated empty results (a flaky or
   * unavailable model) degrade semantic widening to deterministic recall. */
  noteOutcome(hasContent: boolean): void {
    this.rollDay()
    const cap = this.cfg.degradeAfterEmpty
    if (hasContent) {
      this.consecutiveEmpty = 0
      this.degraded = false
      return
    }
    if (cap <= 0) return
    this.consecutiveEmpty += 1
    if (this.consecutiveEmpty >= cap) this.degraded = true
  }

  /** True when the auto-degrade guard has silenced semantic widening today. */
  isDegraded(): boolean {
    return this.degraded
  }

  /** Bypass the degrade guard (manual recovery / degrade disabled). */
  resetDegrade(): void {
    this.consecutiveEmpty = 0
    this.degraded = false
  }

  getExpansions(query: string): string[] {
    return this.expCache.get(query.trim()) ?? []
  }

  rememberExpansions(query: string, expansions: readonly string[]): void {
    this.expCache.set(query.trim(), expansions.slice(0, this.cfg.expansionsPerQuery))
  }

  consumeDaily(): void {
    this.usedToday += 1
  }

  get dailyUsed(): number {
    return this.usedToday
  }

  rerankEnabled(): boolean {
    return this.cfg.rerankOn
  }

  /** Stable signature for a (query, candidate-set) rerank, order-independent. */
  rerankKey(query: string, candidates: readonly SearchHit[]): string {
    const keys = candidates.map(keyOf).sort()
    const sig = keys.slice(0, this.cfg.maxRerankCandidates).join('|')
    return `${query.trim()}|${sig}`
  }

  getRerank(query: string, candidates: readonly SearchHit[]): RerankVerdict[] | undefined {
    if (!this.cfg.rerankOn) return undefined
    return this.rerankCache.get(this.rerankKey(query, candidates))
  }

  rememberRerank(query: string, candidates: readonly SearchHit[], verdicts: readonly RerankVerdict[]): void {
    this.rerankCache.set(this.rerankKey(query, candidates), [...verdicts])
  }
}
