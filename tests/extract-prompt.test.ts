// M7 extraction prompt tests — the semantic-extraction system prompt and the
// known-memories dedup digest rendering.

import { describe, expect, it } from 'vitest'
import { buildExtractionPrompt, buildKnownContext } from '../src/extract/prompt.ts'

describe('buildExtractionPrompt', () => {
  it('embeds the current date for relative-date resolution', () => {
    const prompt = buildExtractionPrompt(new Date('2026-08-22T00:00:00Z'))
    expect(prompt).toContain('Current date: 2026-08-22')
    expect(prompt).toContain('milestones')
    expect(prompt).toContain('preferences')
  })

  it('demands JSON-only output and dedup against known memories', () => {
    const prompt = buildExtractionPrompt(new Date())
    expect(prompt).toContain('Return ONLY JSON')
    expect(prompt).toContain('Known memories')
    expect(prompt).toContain('Never invent')
  })

  it('covers scheduled commitments in the todo taxonomy', () => {
    const prompt = buildExtractionPrompt(new Date())
    expect(prompt).toContain('scheduled commitments')
    expect(prompt).toContain('trips')
    expect(prompt).toContain('scheduled plans')
  })
})

describe('buildKnownContext', () => {
  it('returns null when nothing is stored', () => {
    expect(buildKnownContext({ todos: [], goals: [], milestones: [], preferences: [], events: [] })).toBeNull()
  })

  it('renders one line per category', () => {
    const text = buildKnownContext({
      todos: ['写周报', '修复登录'],
      goals: ['发布插件'],
      milestones: ['M7'],
      preferences: [{ key: 'lang', value: 'zh' }],
      events: ['选定 SQLite'],
    })
    expect(text).toContain('Todos: 写周报 | 修复登录')
    expect(text).toContain('Goals: 发布插件')
    expect(text).toContain('Milestones: M7')
    expect(text).toContain('Preferences: lang=zh')
    expect(text).toContain('Recent events: 选定 SQLite')
  })

  it('caps the digest at 1500 chars — a hint, not a payload', () => {
    const text = buildKnownContext({
      todos: Array.from({ length: 200 }, (_, i) => `todo-item-with-a-fairly-long-title-number-${i}`),
      goals: [],
      milestones: [],
      preferences: [],
      events: [],
    })
    expect(text!.length).toBeLessThanOrEqual(1501) // 1500 + ellipsis
  })
})
