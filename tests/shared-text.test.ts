// Shared text helper tests — contentBlocksToText, normalizeTitle, localDateStr.

import { describe, expect, it } from 'vitest'
import { contentBlocksToText, localDateStr, normalizeTitle } from '../src/shared/text.ts'

describe('contentBlocksToText', () => {
  it('joins text blocks in order and drops non-text blocks', () => {
    const blocks = [
      { type: 'text', text: 'hello' },
      { type: 'image', url: 'x' },
      { type: 'text', text: 'world' },
    ]
    expect(contentBlocksToText(blocks)).toBe('hello\nworld')
  })

  it('ignores text blocks whose text is not a string', () => {
    expect(contentBlocksToText([{ type: 'text', text: 42 }])).toBe('')
  })

  it('returns empty for null/undefined/empty input', () => {
    expect(contentBlocksToText(undefined)).toBe('')
    expect(contentBlocksToText(null)).toBe('')
    expect(contentBlocksToText([])).toBe('')
  })
})

describe('normalizeTitle', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeTitle('Ship-It, NOW!')).toBe('ship it now')
  })

  it('normalizes CJK + ASCII mixtures consistently for dedup', () => {
    expect(normalizeTitle('完成 报告！')).toBe(normalizeTitle('完成 报告'))
    expect(normalizeTitle('完成报告')).toBe('完成报告')
  })

  it('trims to empty for punctuation-only input', () => {
    expect(normalizeTitle('!!! ???')).toBe('')
  })
})

describe('localDateStr', () => {
  it('formats local dates as zero-padded YYYY-MM-DD', () => {
    expect(localDateStr(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(localDateStr(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('matches the local calendar day even when UTC already rolled over', () => {
    // 2026-08-21 23:30 in UTC+8 is still 08-21; in UTC-5 it is 08-22 — local wins
    const d = new Date(2026, 7, 21, 23, 30)
    expect(localDateStr(d)).toBe('2026-08-21')
  })
})
