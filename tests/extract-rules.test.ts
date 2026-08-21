// M2 rule capture tests — pure functions, no host needed.

import { describe, it, expect } from 'vitest'
import { extractCandidates, parseDate, normalizeText } from '../src/extract/rules.ts'

describe('rule extraction', () => {
  it('captures explicit todo', () => {
    const cs = extractCandidates('待办: 完成季度报告')
    expect(cs).toHaveLength(1)
    expect(cs[0].kind).toBe('todo')
    expect(cs[0].title).toContain('完成季度报告')
  })

  it('captures english todo', () => {
    const cs = extractCandidates('todo: write the tests')
    expect(cs[0]?.kind).toBe('todo')
    expect(cs[0]?.title).toContain('write the tests')
  })

  it('captures deadline-in-sentence todo', () => {
    const now = new Date('2026-08-20T12:00:00+08:00')
    const cs = extractCandidates('在 8/20 前完成报告', now)
    expect(cs.length).toBeGreaterThanOrEqual(1)
    const todo = cs.find((c) => c.kind === 'todo')
    expect(todo?.dueAt).toBe('2026-08-20')
  })

  it('captures milestone / goal / preference / decision', () => {
    expect(extractCandidates('里程碑: 完成 M2').some((c) => c.kind === 'milestone')).toBe(true)
    expect(extractCandidates('我的目标是发布 yolo').some((c) => c.kind === 'goal')).toBe(true)
    expect(extractCandidates('我喜欢用中文回复').some((c) => c.kind === 'preference')).toBe(true)
    expect(extractCandidates('我决定采用 SQLite').some((c) => c.kind === 'decision')).toBe(true)
  })

  it('dedup keys are stable per title', () => {
    const a = extractCandidates('待办: 完成报告')[0]
    const b = extractCandidates('待办: 完成报告')[0]
    expect(a?.dedupKey).toBe(b?.dedupKey)
  })
})

describe('parseDate', () => {
  const now = new Date('2026-08-20T12:00:00+08:00')

  it('parses explicit m/d before-date', () => {
    expect(parseDate('8/20前', now)).toBe('2026-08-20')
    expect(parseDate('8月20日前', now)).toBe('2026-08-20')
  })

  it('parses tomorrow / next week / end of month', () => {
    expect(parseDate('明天', now)).toBe('2026-08-21')
    expect(parseDate('下周', now)).toBe('2026-08-27') // Thursday + 7
    expect(parseDate('本月底', now)).toBe('2026-08-31')
  })

  it('returns null for unknown phrases', () => {
    expect(parseDate('不知道', now)).toBeNull()
  })
})

describe('normalizeText', () => {
  it('lowercases and collapses', () => {
    expect(normalizeText(' 完成 报告!! ')).toBe('完成 报告')
  })
})
