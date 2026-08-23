// v0.3.0 semantic recall tests — host-LLM query expansion + candidate rerank,
// the SemanticRecall budget/cache gate, the deterministic rerank floor, and the
// recalled-context widening with cached expansions.

import { describe, expect, it, vi } from 'vitest'
import type { LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  expandQuery,
  rerankCandidates,
  dedupeSearchHits,
  SemanticRecall,
} from '../src/memory/semantic.ts'
import { applyRerank } from '../src/memory/recall.ts'
import type { SearchHit } from '../src/storage/types.ts'

function chunkStream(text: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' } as StreamChunk
    yield { type: 'text-delta', index: 0, text } as StreamChunk
    yield { type: 'block-end', index: 0, block: { type: 'text', text } } as StreamChunk
  })()
}

function makeLlm(impl: () => AsyncIterable<StreamChunk>): { llm: LlmRuntime; stream: ReturnType<typeof vi.fn> } {
  const stream = vi.fn(impl)
  return { llm: { stream } as unknown as LlmRuntime, stream }
}

function mockLlm(text: string): { llm: LlmRuntime; stream: ReturnType<typeof vi.fn> } {
  return makeLlm(() => chunkStream(text))
}

function llmThrow(msg: string): { llm: LlmRuntime; stream: ReturnType<typeof vi.fn> } {
  return makeLlm(() => {
    throw new Error(msg)
  })
}

function hit(rowType: SearchHit['row_type'], rowId: string, title: string, rank = 0): SearchHit {
  return { row_type: rowType, row_id: rowId, title, body: '', rank }
}

describe('expandQuery', () => {
  it('parses a strict JSON array of equivalent queries', async () => {
    const { llm } = mockLlm('["季度总结","Q3 report"]')
    const out = await expandQuery(llm, { model: 'm', text: '季度总结', topK: 3 })
    expect(out).toEqual(['季度总结', 'Q3 report'])
  })

  it('tolerates code-fenced/prose-wrapped arrays and dedupes + caps', async () => {
    const { llm } = mockLlm('```json\n["a","b","a","c","d"]\n```')
    const out = await expandQuery(llm, { model: 'm', text: 'query text', topK: 3 })
    expect(out).toEqual(['a', 'b', 'c'])
  })

  it('returns empty on malformed output', async () => {
    const { llm } = mockLlm('no array here')
    expect(await expandQuery(llm, { model: 'm', text: 'x', topK: 2 })).toEqual([])
  })

  it('returns empty when the LLM call throws', async () => {
    const { llm } = llmThrow('down')
    expect(await expandQuery(llm, { model: 'm', text: 'x', topK: 2 })).toEqual([])
  })
})

describe('rerankCandidates', () => {
  const candidates = [hit('todo', 't1', '提醒我周三交周报'), hit('goal', 'g1', '上线个人助手'), hit('milestone', 'm1', '发布 v0.3.0')]

  it('maps keep/drop verdicts back to valid candidate keys', async () => {
    const verdicts = JSON.stringify([
      { key: 'todo:t1', keep: true, reason: 'confident' },
      { key: 'goal:g1', keep: false, reason: 'irrelevant' },
    ])
    const { llm } = mockLlm(verdicts)
    const out = await rerankCandidates(llm, { model: 'm', query: '周报', candidates, limit: 5 })
    expect(out).toEqual([
      { key: 'todo:t1', keep: true, reason: 'confident' },
      { key: 'goal:g1', keep: false, reason: 'irrelevant' },
    ])
  })

  it('drops keys not in the candidate set and sanitizes unknown reasons', async () => {
    const verdicts = JSON.stringify([
      { key: 'todo:zz', keep: true, reason: 'confident' },
      { key: 'milestone:m1', keep: true, reason: 'maybe' },
    ])
    const { llm } = mockLlm(verdicts)
    const out = await rerankCandidates(llm, { model: 'm', query: 'q', candidates, limit: 5 })
    expect(out).toEqual([{ key: 'milestone:m1', keep: true, reason: 'related' }])
  })

  it('returns empty when the LLM call throws', async () => {
    const { llm } = llmThrow('down')
    expect(await rerankCandidates(llm, { model: 'm', query: 'q', candidates, limit: 5 })).toEqual([])
  })
})

describe('dedupeSearchHits', () => {
  it('dedupes by row_type:row_id preserving the first-seen order', () => {
    const out = dedupeSearchHits([hit('todo', 't1', 'a'), hit('todo', 't2', 'b'), hit('todo', 't1', 'a2'), hit('goal', 'g1', 'c')])
    expect(out.map((h) => `${h.row_type}:${h.row_id}`)).toEqual(['todo:t1', 'todo:t2', 'goal:g1'])
  })
})

describe('SemanticRecall', () => {
  it('gates expansion on enabled, min chars, budget and cache', () => {
    const s = new SemanticRecall({ enabled: true, minQueryChars: 6, dailyBudget: 2, expansionsPerQuery: 3 })
    expect(s.shouldExpand('季度总结和汇报')).toBe(true)
    expect(s.shouldExpand('好的')).toBe(false) // below minQueryChars
    s.rememberExpansions('季度总结和汇报', ['季度总结'])
    expect(s.shouldExpand('季度总结和汇报')).toBe(false) // cached
    expect(s.shouldExpand('另一个超过六个字的查询')).toBe(true)
    s.consumeDaily()
    s.consumeDaily()
    expect(s.dailyUsed).toBe(2)
    expect(s.shouldExpand('再一个超过六个字的查询')).toBe(false) // budget exhausted
  })

  it('respects a disabled config', () => {
    const s = new SemanticRecall({ enabled: false })
    expect(s.shouldExpand('足够长的查询文本')).toBe(false)
  })

  it('auto-degrades semantic widening after consecutive empty runs (R15/P39)', () => {
    const s = new SemanticRecall({ enabled: true, minQueryChars: 0, degradeAfterEmpty: 2 })
    expect(s.shouldExpand('a')).toBe(true)
    s.noteOutcome(false)
    expect(s.isDegraded()).toBe(false)
    s.noteOutcome(false)
    expect(s.isDegraded()).toBe(true)
    expect(s.shouldExpand('b')).toBe(false) // degraded → deterministic recall only
    s.noteOutcome(true)
    expect(s.isDegraded()).toBe(false)
    expect(s.shouldExpand('c')).toBe(true)
    s.noteOutcome(false)
    s.noteOutcome(false)
    expect(s.isDegraded()).toBe(true)
    s.resetDegrade()
    expect(s.isDegraded()).toBe(false)
  })

  // v0.3.3 review regression: degraded previously stuck until process restart —
  // shouldExpand() short-circuits on degraded, so noteOutcome(true) could never
  // run again to lift it, and rollDay() only reset the budget.
  it('a new day lifts the auto-degrade (one flaky day must not silence recall forever)', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-23T10:00:00'))
      const s = new SemanticRecall({ enabled: true, minQueryChars: 0, degradeAfterEmpty: 2 })
      s.noteOutcome(false)
      s.noteOutcome(false)
      expect(s.isDegraded()).toBe(true)
      expect(s.shouldExpand('query-a')).toBe(false) // degraded → deterministic only

      vi.setSystemTime(new Date('2026-08-24T10:00:00'))
      expect(s.shouldExpand('query-b')).toBe(true) // day rolled → fresh chance
      expect(s.isDegraded()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('caps expansions at expansionsPerQuery', () => {
    const s = new SemanticRecall({ expansionsPerQuery: 2 })
    s.rememberExpansions('q', ['a', 'b', 'c'])
    expect(s.getExpansions('q')).toEqual(['a', 'b'])
  })

  it('builds an order-independent rerank key over the candidate set', () => {
    const s = new SemanticRecall({ maxRerankCandidates: 8 })
    const a = [hit('todo', 't2', 'b'), hit('todo', 't1', 'a')]
    const b = [hit('todo', 't1', 'a'), hit('todo', 't2', 'b')]
    expect(s.rerankKey('q', a)).toBe(s.rerankKey('q', b))
  })

  it('remembers and retrieves rerank verdicts, honoring rerankOn', () => {
    const s = new SemanticRecall({ rerankOn: true })
    const cands = [hit('todo', 't1', 'a')]
    const v = [{ key: 'todo:t1', keep: true, reason: 'confident' as const }]
    s.rememberRerank('q', cands, v)
    expect(s.getRerank('q', cands)).toEqual(v)
    const off = new SemanticRecall({ rerankOn: false })
    expect(off.getRerank('q', cands)).toBeUndefined()
  })
})

describe('applyRerank (deterministic floor)', () => {
  const det = [hit('todo', 't1', '提醒我周三交周报'), hit('todo', 't2', '把演示稿发给研发')]
  const pool = [...det, hit('goal', 'g1', '上线个人助手')]

  it('keeps verdict-kept items first, then the deterministic floor, then the rest', () => {
    const verdicts = [{ key: 'goal:g1', keep: true, reason: 'confident' as const }]
    const out = applyRerank(pool, verdicts, 2, det)
    expect(out.map((h) => h.row_id)).toEqual(['g1', 't1', 't2'])
  })

  it('never drops below the deterministic floor even when rerank drops everything', () => {
    const verdicts = [
      { key: 'todo:t1', keep: false, reason: 'irrelevant' as const },
      { key: 'todo:t2', keep: false, reason: 'irrelevant' as const },
      { key: 'goal:g1', keep: false, reason: 'irrelevant' as const },
    ]
    const out = applyRerank(pool, verdicts, 2, det)
    expect(out).toHaveLength(pool.length) // floor (t1,t2) + goal
    expect(out.map((h) => h.row_id)).toEqual(['t1', 't2', 'g1'])
  })

  it('returns the pool unchanged when there are no verdicts', () => {
    expect(applyRerank(pool, undefined, 2, det)).toEqual(pool)
  })
})



