import { describe, expect, it } from 'vitest'
import {
  buildTodoCandidateContext,
  buildTodoResolverPrompt,
  parseTodoResolverJson,
} from '../src/extract/todo-resolver.ts'

describe('todo identity shadow resolver', () => {
  it('renders stable ids, terminal state and historical aliases', () => {
    const context = buildTodoCandidateContext([{
      id: 'todo-1',
      title: '把演示稿发给研发',
      status: 'done',
      due_at: '2026-09-01',
      aliases: ['发送研发演示材料'],
      rank: -2,
    }])
    expect(context).toContain('id=todo-1')
    expect(context).toContain('status=done')
    expect(context).toContain('aliases=["发送研发演示材料"]')
  })

  it('defines the full decision set and keeps shadow output non-mutating', () => {
    const prompt = buildTodoResolverPrompt(new Date(2026, 7, 30, 9, 0, 0))
    for (const decision of ['LINK', 'UPDATE', 'REOPEN', 'NEW_OCCURRENCE', 'CREATE', 'ATTACH_STEP', 'ASK', 'NOOP']) {
      expect(prompt).toContain(decision)
    }
    expect(prompt).toContain('OBSERVATION ONLY')
    expect(prompt).toContain('MUST NOT be treated as authorization')
  })

  it('drops invented ids, clamps confidence and rejects the wrong schema', () => {
    const parsed = parseTodoResolverJson(JSON.stringify({ resolutions: [{
      decision: 'UPDATE',
      candidate_ids: ['todo-1', 'invented', 'todo-1'],
      proposed_title: '把演示稿改到周五发送',
      confidence: 1.4,
      reason: '明确改期',
    }] }), new Set(['todo-1']))
    expect(parsed).toEqual([{
      decision: 'UPDATE',
      candidate_ids: ['todo-1'],
      proposed_title: '把演示稿改到周五发送',
      confidence: 1,
      reason: '明确改期',
    }])
    expect(() => parseTodoResolverJson('{"todos":[]}', new Set())).toThrow(/wrong-schema/)
  })
})
