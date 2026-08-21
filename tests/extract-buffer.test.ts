// CandidateBuffer tests — per-session rule-capture buffering before turn-end flush.

import { describe, expect, it } from 'vitest'
import { CandidateBuffer } from '../src/extract/buffer.ts'
import type { Candidate } from '../src/extract/rules.ts'

function candidate(dedupKey: string, title: string): Candidate {
  return { kind: 'todo', dedupKey, title }
}

describe('CandidateBuffer', () => {
  it('accumulates candidates and reports size', () => {
    const buf = new CandidateBuffer()
    buf.add(candidate('todo:a', 'A'))
    buf.add(candidate('todo:b', 'B'))
    expect(buf.size).toBe(2)
  })

  it('replaces earlier candidates with the same dedup key (latest wins)', () => {
    const buf = new CandidateBuffer()
    buf.add(candidate('todo:a', 'first'))
    buf.add({ ...candidate('todo:a', 'second'), dueAt: '2026-09-01' })
    expect(buf.size).toBe(1)
    const drained = buf.drain()
    expect(drained).toHaveLength(1)
    expect(drained[0].title).toBe('second')
    expect(drained[0].dueAt).toBe('2026-09-01')
  })

  it('drain empties the buffer and repeated drains return nothing', () => {
    const buf = new CandidateBuffer()
    buf.add(candidate('todo:a', 'A'))
    expect(buf.drain()).toHaveLength(1)
    expect(buf.size).toBe(0)
    expect(buf.drain()).toHaveLength(0)
  })
})
