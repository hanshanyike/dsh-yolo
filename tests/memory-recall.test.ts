// M3 recall tests — systemPrompt section/context registration and the
// dynamic FTS recall text builder.

import { describe, expect, it, vi } from 'vitest'
import { registerYoloPrompt } from '../src/memory/recall.ts'
import type Yolo from '../src/storage/index.ts'

function makeCtx() {
  const sections: Array<{ name: string; text(): string }> = []
  const contexts: Array<{ name: string; text(): string }> = []
  return {
    ctx: {
      systemPrompt: {
        section: (s: { name: string; text(): string }) => sections.push(s),
        context: (c: { name: string; text(): string }) => contexts.push(c),
      },
    },
    sections,
    contexts,
  }
}

function mockYolo(over: Partial<Yolo> = {}): Yolo {
  return {
    listPreferences: vi.fn(() => []),
    search: vi.fn(() => []),
    ...over,
  } as unknown as Yolo
}

describe('registerYoloPrompt', () => {
  it('registers the prefs section and recall context', () => {
    const { ctx, sections, contexts } = makeCtx()
    registerYoloPrompt(ctx as never, { yolo: mockYolo(), cwd: () => '/w', getLastUserText: () => '' })
    expect(sections.map((s) => s.name)).toEqual(['yolo-prefs'])
    expect(contexts.map((c) => c.name)).toEqual(['yolo-recall'])
  })

  it('prefs section renders preferences or empty', () => {
    const { ctx, sections } = makeCtx()
    registerYoloPrompt(ctx as never, { yolo: mockYolo(), cwd: () => '/w', getLastUserText: () => '' })
    expect(sections[0].text()).toBe('')

    const yolo = mockYolo({
      listPreferences: vi.fn(() => [{ id: '1', key: '语言', value: '中文', confidence: 1, scope_key: 's', updated_at: 0 }]),
    })
    const c2 = makeCtx()
    registerYoloPrompt(c2.ctx as never, { yolo, cwd: () => '/w', getLastUserText: () => '' })
    expect(c2.sections[0].text()).toContain('语言: 中文')
  })

  it('recall context returns nothing without a user message', () => {
    const { ctx, contexts } = makeCtx()
    registerYoloPrompt(ctx as never, { yolo: mockYolo(), cwd: () => '/w', getLastUserText: () => '   ' })
    expect(contexts[0].text()).toBe('')
  })

  it('recall context renders FTS hits under the memory heading', () => {
    const yolo = mockYolo({
      search: vi.fn(() => [
        { row_type: 'todo' as const, title: '完成报告', row_id: 't1', body: '', rank: 1 },
        { row_type: 'goal' as const, title: '发布 v0.1', row_id: 'g1', body: '', rank: 2 },
      ]),
    })
    const { ctx, contexts } = makeCtx()
    registerYoloPrompt(ctx as never, { yolo, cwd: () => '/w', getLastUserText: () => '报告' })
    const text = contexts[0].text()
    expect(text).toContain('Related memory')
    expect(text).toContain('[todo] 完成报告')
    expect(text).toContain('[goal] 发布 v0.1')
  })
})
