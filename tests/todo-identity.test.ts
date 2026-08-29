import { describe, expect, it } from 'vitest'
import {
  extractionTodoFingerprint,
  extractionTodoOperationId,
  extractionTodoUpdateFingerprint,
  todoEvidenceFingerprint,
  toolTodoActionId,
  toolTodoFingerprint,
  todoOperationRequestHash,
} from '../src/shared/todo-identity.ts'

describe('todo source fingerprints', () => {
  it('is stable for one extraction candidate while separating candidates and turns', () => {
    const first = extractionTodoFingerprint('session-a', 3, 0, '把演示稿发给研发')
    expect(extractionTodoFingerprint('session-a', 3, 0, '把演示稿发给研发')).toBe(first)
    expect(extractionTodoFingerprint('session-a', 3, 1, '把演示稿发给研发')).not.toBe(first)
    expect(extractionTodoFingerprint('session-a', 4, 0, '把演示稿发给研发')).not.toBe(first)
    expect(extractionTodoFingerprint('session-a', 3, 0, '把演示稿发给产品')).not.toBe(first)
  })

  it('keeps create, update and tool operations in separate namespaces', () => {
    const create = extractionTodoFingerprint('session-a', 3, 0, '确认发布安排')
    const update = extractionTodoUpdateFingerprint('session-a', 3, 0, '确认发布安排')
    const write = toolTodoFingerprint('session-a', 'call-123')
    const action = toolTodoActionId('session-a', 'call-123')
    expect(new Set([create, update, write, action])).toHaveLength(4)
  })

  it('uses the host call id rather than mutable tool arguments for retry identity', () => {
    expect(toolTodoFingerprint('session-a', 'call-123')).toBe(toolTodoFingerprint('session-a', 'call-123'))
    expect(toolTodoFingerprint('session-a', 'call-124')).not.toBe(toolTodoFingerprint('session-a', 'call-123'))
  })

  it('hashes operation payloads independently of object key order', () => {
    expect(todoOperationRequestHash({ title: '确认发布', due_at: '2026-08-30' }))
      .toBe(todoOperationRequestHash({ due_at: '2026-08-30', title: '确认发布' }))
    expect(todoOperationRequestHash({ title: '确认发布' }))
      .not.toBe(todoOperationRequestHash({ title: '确认上线' }))
  })

  it('separates one stable extraction operation from its per-todo evidence', () => {
    const operation = extractionTodoOperationId('session-a', 3)
    expect(extractionTodoOperationId('session-a', 3)).toBe(operation)
    expect(todoEvidenceFingerprint(operation, 'todo-a')).toBe(todoEvidenceFingerprint(operation, 'todo-a'))
    expect(todoEvidenceFingerprint(operation, 'todo-b')).not.toBe(todoEvidenceFingerprint(operation, 'todo-a'))
  })
})
