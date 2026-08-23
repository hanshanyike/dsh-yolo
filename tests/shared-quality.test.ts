// Write-quality gate (B3) — pure tests for the extraction junk filter.
// A managing assistant must never store acknowledgement noise or bare meta
// commands in place of a real commitment (a wrong memory can trigger a wrong
// reminder).

import { describe, expect, it } from 'vitest'
import { shouldDropExtracted } from '../src/shared/quality.ts'

describe('shouldDropExtracted (write-quality gate)', () => {
  it('keeps a real commitment', () => {
    expect(shouldDropExtracted('todo', '周三把演示稿发给研发')).toBe(false)
  })

  it('keeps a real tracking rule preference', () => {
    expect(shouldDropExtracted('preference', 'reminder-ahead', '1h')).toBe(false)
  })

  it('drops empty titles', () => {
    expect(shouldDropExtracted('todo', '')).toBe(true)
    expect(shouldDropExtracted('todo', '   ')).toBe(true)
  })

  it('drops single-char titles (no real commitment)', () => {
    expect(shouldDropExtracted('todo', 'A')).toBe(true)
    expect(shouldDropExtracted('todo', '中')).toBe(true)
  })

  it('drops acknowledgement noise that is not a commitment', () => {
    for (const ack of ['好的', '收到', 'ok', '嗯', '知道了', '行', '没问题', '好的收到', '👌']) {
      expect(shouldDropExtracted('todo', ack)).toBe(true)
      expect(shouldDropExtracted('event', ack)).toBe(true)
    }
  })

  it('drops bare meta commands that reference the memory system', () => {
    for (const meta of ['记住', '记住这个', '记录下来', '记一下', '记一下这个']) {
      expect(shouldDropExtracted('todo', meta)).toBe(true)
    }
  })

  it('keeps a commitment that merely mentions remembering something real', () => {
    expect(shouldDropExtracted('todo', '记得把演示稿发给研发')).toBe(false)
  })

  it('drops a preference with an empty value (a rule must carry its rule)', () => {
    expect(shouldDropExtracted('preference', 'reminder-ahead', '')).toBe(true)
    expect(shouldDropExtracted('preference', 'reminder-ahead', '   ')).toBe(true)
  })
})
