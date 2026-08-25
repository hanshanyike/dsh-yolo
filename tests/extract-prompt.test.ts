// M7+M8 extraction prompt tests — the semantic-extraction system prompt and the
// known-memories dedup digest rendering (M8: rows carry state).

import { describe, expect, it } from 'vitest'
import { buildExtractionPrompt, buildKnownContext } from '../src/extract/prompt.ts'

describe('buildExtractionPrompt', () => {
  it('embeds the current date for relative-date resolution', () => {
    const prompt = buildExtractionPrompt(new Date('2026-08-22T00:00:00Z'))
    expect(prompt).toContain('Current local datetime: 2026-08-22T')
    expect(prompt).toContain('milestones')
    expect(prompt).toContain('preferences')
  })

  it('uses the host local date instead of the UTC calendar date', () => {
    const localEarlyMorning = new Date(2026, 7, 24, 0, 30)
    const prompt = buildExtractionPrompt(localEarlyMorning)
    expect(prompt).toContain('Current local datetime: 2026-08-24T00:30:00')
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

  it('keeps calendar-only intent date-only and reserves datetimes for a clock or duration', () => {
    const prompt = buildExtractionPrompt(new Date())
    expect(prompt).toContain('今天、明天、下周、周五')
    expect(prompt).toContain('never turn them into midnight datetimes')
    expect(prompt).toContain('下午三点、14:30、1分钟后')
  })

  it('declares the updates array for state changes of known items (M8)', () => {
    const prompt = buildExtractionPrompt(new Date())
    expect(prompt).toContain('"updates"')
    expect(prompt).toContain('STATE CHANGES')
    expect(prompt).toContain('match_title')
    expect(prompt).toContain('state materially changed')
    // unknown-item state changes must not go to updates
    expect(prompt).toContain('NOT in Known memories')
  })
})

describe('buildKnownContext', () => {
  it('returns null when nothing is stored', () => {
    expect(buildKnownContext({ todos: [], goals: [], milestones: [], preferences: [], events: [] })).toBeNull()
  })

  it('renders one line per category with state markers (M8)', () => {
    const text = buildKnownContext({
      todos: [
        { title: '写周报', status: 'pending', due_at: '2026-08-25' },
        { title: '修复登录', status: 'in_progress' },
      ],
      goals: [{ title: '发布插件', progress: 40 }],
      milestones: [{ title: 'M7', status: 'active' }],
      preferences: [{ key: 'lang', value: 'zh' }],
      events: ['选定 SQLite'],
    })
    expect(text).toContain('[pending] 写周报 (due 2026-08-25)')
    expect(text).toContain('[in_progress] 修复登录')
    expect(text).toContain('[40%] 发布插件')
    expect(text).toContain('[active] M7')
    expect(text).toContain('Preferences: lang=zh')
    expect(text).toContain('Recent events: 选定 SQLite')
  })

  it('caps the digest at 1500 chars — a hint, not a payload', () => {
    const text = buildKnownContext({
      todos: Array.from({ length: 200 }, (_, i) => ({ title: `todo-item-with-a-fairly-long-title-number-${i}`, status: 'pending' })),
      goals: [],
      milestones: [],
      preferences: [],
      events: [],
    })
    expect(text!.length).toBeLessThanOrEqual(1501) // 1500 + ellipsis
  })
})
