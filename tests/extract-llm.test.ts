// M2 LLM extraction tests — JSON parsing tolerance + mocked stream folding.

import { describe, it, expect } from 'vitest'
import type { LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import { llmExtract, parseExtractionJson, validateExtraction, contentBlocksToText, EMPTY_EXTRACTION } from '../src/extract/llm-extract.ts'

function chunkStream(text: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' } as StreamChunk
    yield { type: 'text-delta', index: 0, text } as StreamChunk
    yield { type: 'block-end', index: 0, block: { type: 'text', text } } as StreamChunk
  })()
}

function mockLlm(text: string): LlmRuntime {
  return { stream: () => chunkStream(text) } as unknown as LlmRuntime
}

describe('parseExtractionJson', () => {
  it('parses fenced json', () => {
    const r = parseExtractionJson('```json\n{"todos":[{"title":"x"}]}\n```')
    expect(r.todos).toHaveLength(1)
    expect(r.todos[0].title).toBe('x')
  })

  it('recovers json inside surrounding noise', () => {
    const r = parseExtractionJson('Sure! Here you go: {"goals":[{"title":"g"}]} and that is all.')
    expect(r.goals).toHaveLength(1)
  })

  it('returns empty on garbage', () => {
    expect(parseExtractionJson('not json at all')).toEqual(EMPTY_EXTRACTION)
  })
})

describe('validateExtraction', () => {
  it('drops malformed entries and keeps valid ones', () => {
    const r = validateExtraction({
      todos: [{ title: 'ok' }, { nope: true }, 'bad'] as never,
      milestones: [{ title: 'm' }] as never,
      events: [{ summary: 'e', kind: 'decision' }] as never,
    })
    expect(r.todos).toHaveLength(1)
    expect(r.milestones).toHaveLength(1)
    expect(r.events[0].kind).toBe('decision')
  })

  it('coerces unknown event kinds to note', () => {
    const r = validateExtraction({ events: [{ summary: 'x', kind: 'weird' }] } as never)
    expect(r.events[0].kind).toBe('note')
  })
})

describe('llmExtract', () => {
  it('returns empty for blank text without calling the model', async () => {
    const llm = mockLlm('')
    expect(await llmExtract({ llm, provider: 'p', model: 'm', turnText: '   ' })).toEqual(EMPTY_EXTRACTION)
  })

  it('folds a stream and parses the result', async () => {
    const json = JSON.stringify({
      todos: [{ title: 'ship yolo', due_at: '2026-08-21', priority: 'high' }],
      milestones: [{ title: 'M2 done', target_date: '2026-08-25' }],
      preferences: [{ key: 'lang', value: 'zh' }],
      events: [{ kind: 'note', summary: 'worked on M2' }],
    })
    const r = await llmExtract({ llm: mockLlm(json), provider: 'p', model: 'm', turnText: 'some turn' })
    expect(r.todos[0]?.title).toBe('ship yolo')
    expect(r.todos[0]?.due_at).toBe('2026-08-21')
    expect(r.milestones[0]?.title).toBe('M2 done')
    expect(r.preferences[0]?.value).toBe('zh')
    expect(r.events[0]?.summary).toContain('M2')
  })
})

describe('contentBlocksToText', () => {
  it('joins text blocks and skips non-text', () => {
    expect(contentBlocksToText([{ type: 'text', text: 'a' }, { type: 'tool-call' } as never, { type: 'text', text: 'b' }])).toBe('a\nb')
  })
})
