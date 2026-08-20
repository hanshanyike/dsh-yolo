// M2 merge tests — candidate folding into storage, using a recording stub.

import { describe, it, expect, vi } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import { mergeCandidates } from '../src/extract/merge.ts'
import type { Candidate } from '../src/extract/rules.ts'

function makeStub() {
  const calls: Record<string, unknown[]> = {}
  const yolo = {
    addTodo: vi.fn((...a: unknown[]) => void calls.todos?.push(a)),
    addMilestone: vi.fn((...a: unknown[]) => void calls.milestones?.push(a)),
    addGoal: vi.fn((...a: unknown[]) => void calls.goals?.push(a)),
    addPreference: vi.fn((...a: unknown[]) => void calls.preferences?.push(a)),
    addEvent: vi.fn((...a: unknown[]) => void calls.events?.push(a)),
  } as unknown as Yolo
  return { yolo, calls: yolo as unknown as { addTodo: ReturnType<typeof vi.fn>; addMilestone: ReturnType<typeof vi.fn>; addGoal: ReturnType<typeof vi.fn>; addPreference: ReturnType<typeof vi.fn>; addEvent: ReturnType<typeof vi.fn> } }
}

const cwd = '/tmp/work'

describe('mergeCandidates', () => {
  it('dispatches each candidate kind to the right storage method', () => {
    const { yolo, calls } = makeStub()
    const cs: Candidate[] = [
      { kind: 'todo', dedupKey: 'todo:a', title: 'a', dueAt: '2026-08-21', priority: 'high' },
      { kind: 'milestone', dedupKey: 'ms:b', title: 'b', targetDate: '2026-09-01' },
      { kind: 'goal', dedupKey: 'goal:c', title: 'c' },
      { kind: 'preference', dedupKey: 'pref:lang', title: 'lang', prefKey: 'lang', prefValue: 'zh' },
      { kind: 'decision', dedupKey: 'evt:d', title: 'd' },
    ]
    const r = mergeCandidates(yolo, cwd, cs)
    expect(r.added).toBe(5)
    expect(r.skipped).toBe(0)
    expect(calls.addTodo).toHaveBeenCalledTimes(1)
    expect(calls.addMilestone).toHaveBeenCalledTimes(1)
    expect(calls.addGoal).toHaveBeenCalledTimes(1)
    expect(calls.addPreference).toHaveBeenCalledTimes(1)
    expect(calls.addEvent).toHaveBeenCalledTimes(1)
  })

  it('skips preference without key/value', () => {
    const { yolo } = makeStub()
    const r = mergeCandidates(yolo, cwd, [
      { kind: 'preference', dedupKey: 'pref:x', title: 'x', prefKey: null, prefValue: null },
    ])
    expect(r.skipped).toBe(1)
  })

  it('counts storage throws as skipped', () => {
    const yolo = {
      addTodo: vi.fn(() => {
        throw new Error('db full')
      }),
    } as unknown as Yolo
    const r = mergeCandidates(yolo, cwd, [{ kind: 'todo', dedupKey: 'todo:x', title: 'x' }])
    expect(r.skipped).toBe(1)
    expect(r.added).toBe(0)
  })
})
