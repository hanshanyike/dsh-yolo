import { describe, expect, it } from 'vitest'
import {
  buildItemDetailModel,
  buildSourcePreviewModel,
  buildSourceSessionAction,
} from '../client/panel/ForegroundContext.tsx'

const item = { id: 'todo-1', scopeCwd: 'D:\\Code\\quarterly', title: '把季度材料发给研发' }

describe('foreground context display models', () => {
  it('exposes bounded session evidence without inventing source time', () => {
    const model = buildSourcePreviewModel(item, {
      type: 'session', label: '季度发布讨论', session_id: 'session-1',
      excerpt: `本周发出材料  ${'😀'.repeat(420)}`, turn: 4,
      created_at: 1_777_777_777_000,
      workspace: { slug: 'quarterly/default', label: 'quarterly', cwd: item.scopeCwd },
    })

    expect(model).toMatchObject({
      typeLabel: '来源会话', workspaceLabel: 'quarterly', workspaceCwd: item.scopeCwd,
      sessionId: 'session-1', turn: 4, createdAt: 1_777_777_777_000, canOpenSession: true,
    })
    expect(Array.from(model.excerpt ?? '')).toHaveLength(400)
  })

  it('keeps a session preview available when an old row has no excerpt', () => {
    const source = buildSourcePreviewModel(item, {
      type: 'session', label: '来源会话', session_id: 'session-old', excerpt: null,
    })
    expect(source).toEqual(expect.objectContaining({
      sessionId: 'session-old', canOpenSession: true, degradation: '此事项创建时未保存来源摘录。',
    }))
    expect(buildSourceSessionAction(source, { status: 'pending' })).toMatchObject({
      visible: true, disabled: true, label: '正在打开原会话…',
    })
    expect(buildSourceSessionAction(source, { status: 'error', message: '会话暂不可用' })).toMatchObject({
      visible: true, disabled: false, label: '重试打开原会话',
    })
  })

  it('never makes manual, tool or legacy sources jumpable', () => {
    const cases = [
      ['manual', '手动记录'],
      ['tool', '助手操作'],
      ['legacy', '早期记录'],
    ] as const
    for (const [type, typeLabel] of cases) {
      const model = buildSourcePreviewModel(item, { type, label: '旧标签', session_id: 'forged-session' })
      expect(model).toMatchObject({ typeLabel, canOpenSession: false })
      expect(model).not.toHaveProperty('sessionId')
    }
  })

  it('builds a minimal item detail model without deriving due date or status', () => {
    const model = buildItemDetailModel({ kind: 'item_detail', item }, undefined)
    expect(model).toEqual({ title: item.title, workspaceCwd: item.scopeCwd, hasSource: false })
    expect(model).not.toHaveProperty('status')
    expect(model).not.toHaveProperty('dueAt')
  })
})
