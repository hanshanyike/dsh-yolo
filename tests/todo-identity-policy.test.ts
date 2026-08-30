import { describe, expect, it } from 'vitest'
import type { ExtractionResult } from '../src/contracts/extraction.ts'
import type { TodoIdentityCandidate, TodoResolutionPrediction } from '../src/domain/types.ts'
import {
  planTodoIdentityApplication,
  TODO_IDENTITY_MIN_CONFIDENCE,
  TODO_IDENTITY_POLICY_VERSION,
} from '../src/application/ingestion/todo-identity-policy.ts'

const EMPTY: ExtractionResult = {
  session_summary: null,
  milestones: [],
  todos: [],
  goals: [],
  preferences: [],
  events: [],
  updates: [],
}

const OPEN: TodoIdentityCandidate = {
  id: 'todo-open',
  title: '把客户访谈纪要发给产品组',
  status: 'pending',
  due_at: '2026-09-02',
  aliases: [],
  rank: -1,
}

function prediction(over: Partial<TodoResolutionPrediction> = {}): TodoResolutionPrediction {
  return {
    decision: 'LINK',
    candidate_ids: [OPEN.id],
    confidence: TODO_IDENTITY_MIN_CONFIDENCE,
    reason: '同一交付物和接收方',
    ...over,
  }
}

describe('R2a todo identity application policy', () => {
  it('authorizes only one high-confidence open-candidate LINK or UPDATE', () => {
    expect(planTodoIdentityApplication(EMPTY, [prediction()], [OPEN], true)).toMatchObject({
      policy_version: TODO_IDENTITY_POLICY_VERSION,
      mode: 'authorized',
      decision: 'LINK',
      candidate_id: OPEN.id,
    })
    expect(planTodoIdentityApplication({
      ...EMPTY,
      updates: [{ kind: 'todo', match_title: '访谈纪要', due_at: '2026-09-05' }],
    }, [prediction({ decision: 'UPDATE', confidence: 0.99 })], [OPEN], true)).toMatchObject({
      mode: 'authorized',
      decision: 'UPDATE',
      candidate_id: OPEN.id,
    })
  })

  it.each([
    ['low confidence', prediction({ confidence: TODO_IDENTITY_MIN_CONFIDENCE - 0.01 }), [OPEN], 'confidence_below_threshold'],
    ['multiple candidates', prediction({ candidate_ids: [OPEN.id, 'todo-other'] }), [OPEN], 'candidate_not_unique'],
    ['terminal candidate', prediction(), [{ ...OPEN, status: 'done' as const }], 'candidate_not_open'],
    ['terminal decision', prediction({ decision: 'REOPEN' }), [OPEN], 'decision_not_authorized:REOPEN'],
    ['occurrence', prediction({ decision: 'NEW_OCCURRENCE' }), [OPEN], 'decision_not_authorized:NEW_OCCURRENCE'],
    ['step', prediction({ decision: 'ATTACH_STEP' }), [OPEN], 'decision_not_authorized:ATTACH_STEP'],
    ['ambiguous', prediction({ decision: 'ASK' }), [OPEN], 'decision_not_authorized:ASK'],
    ['noop', prediction({ decision: 'NOOP', candidate_ids: [] }), [OPEN], 'decision_not_authorized:NOOP'],
  ])('blocks %s', (_name, resolverPrediction, candidates, reason) => {
    expect(planTodoIdentityApplication(EMPTY, [resolverPrediction as TodoResolutionPrediction], candidates as TodoIdentityCandidate[], true)).toMatchObject({
      mode: 'blocked',
      reason,
    })
  })

  it('blocks ambiguous extraction shapes and conflicting LINK updates', () => {
    expect(planTodoIdentityApplication({
      ...EMPTY,
      todos: [{ title: '发访谈纪要' }],
      updates: [{ kind: 'todo', match_title: '访谈纪要', due_at: '2026-09-05' }],
    }, [prediction({ decision: 'UPDATE' })], [OPEN], true)).toMatchObject({ mode: 'blocked', reason: 'todo_mutation_shape_ambiguous' })

    expect(planTodoIdentityApplication({
      ...EMPTY,
      updates: [{ kind: 'todo', match_title: '访谈纪要', due_at: '2026-09-05' }],
    }, [prediction()], [OPEN], true)).toMatchObject({ mode: 'blocked', reason: 'link_conflicts_with_extracted_update' })
  })

  it('blocks status, priority and field-bearing LINK decisions in R2a', () => {
    expect(planTodoIdentityApplication(EMPTY, [prediction({ decision: 'UPDATE' })], [OPEN], true)).toMatchObject({
      mode: 'blocked', reason: 'update_shape_missing',
    })
    expect(planTodoIdentityApplication({
      ...EMPTY,
      updates: [{ kind: 'todo', match_title: '访谈纪要', status: 'done' }],
    }, [prediction({ decision: 'UPDATE' })], [OPEN], true)).toMatchObject({ mode: 'blocked', reason: 'update_field_not_authorized' })
    expect(planTodoIdentityApplication({
      ...EMPTY,
      todos: [{ title: '把客户访谈纪要发给产品组', due_at: '2026-09-05', priority: 'high' }],
    }, [prediction({ decision: 'UPDATE' })], [OPEN], true)).toMatchObject({ mode: 'blocked', reason: 'update_field_not_authorized' })
    expect(planTodoIdentityApplication({
      ...EMPTY,
      todos: [{ title: '把客户访谈纪要发给产品组', due_at: '2026-09-05' }],
    }, [prediction()], [OPEN], true)).toMatchObject({ mode: 'blocked', reason: 'link_conflicts_with_extracted_fields' })
  })

  it('allows one independent CREATE and falls back only when resolver output is empty', () => {
    expect(planTodoIdentityApplication({ ...EMPTY, todos: [{ title: '给物业报修漏水' }] }, [prediction({
      decision: 'CREATE', candidate_ids: [], confidence: 0.99,
    })], [], true)).toMatchObject({ mode: 'create' })
    expect(planTodoIdentityApplication(EMPTY, [], [OPEN], true)).toMatchObject({ mode: 'fallback', reason: 'resolver_empty' })
    expect(planTodoIdentityApplication(EMPTY, [prediction(), prediction()], [OPEN], true)).toMatchObject({
      mode: 'blocked', reason: 'multiple_resolutions',
    })
  })

  it('is default-off until model predictions satisfy the evaluation gate', () => {
    expect(planTodoIdentityApplication(EMPTY, [prediction()], [OPEN])).toMatchObject({
      mode: 'fallback', reason: 'policy_disabled',
    })
  })
})
