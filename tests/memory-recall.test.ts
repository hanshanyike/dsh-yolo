// M3/M9 recall tests — systemPrompt section/context registration, the dynamic
// FTS recall text builder, prompt-template escaping, the preference cap, and
// session injection dedup through the deps seam.

import { describe, expect, it, vi } from 'vitest'
import { registerYoloPrompt, type YoloPromptDeps } from '../src/memory/recall.ts'
import type Yolo from '../src/storage/index.ts'
import type { Preference, SearchHit } from '../src/storage/types.ts'

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

function deps(over: Partial<YoloPromptDeps> = {}): YoloPromptDeps {
  return {
    yolo: mockYolo(),
    cwd: () => '/w',
    getLastUserText: () => '',
    getInjected: () => new Set<string>(),
    onRecallKept: () => {},
    ...over,
  }
}

function pref(key: string, value: string, updatedAt: number): Preference {
  return { id: `p${updatedAt}`, key, value, confidence: 1, scope_key: 's', updated_at: updatedAt }
}

function hit(rowType: SearchHit['row_type'], rowId: string, title: string, rank = 0): SearchHit {
  return { row_type: rowType, row_id: rowId, title, body: '', rank }
}

describe('registerYoloPrompt', () => {
  it('registers the instructions section, prefs section and recall context', () => {
    const { ctx, sections, contexts } = makeCtx()
    registerYoloPrompt(ctx as never, deps())
    expect(sections.map((s) => s.name)).toEqual(['yolo-instructions', 'yolo-prefs'])
    expect(contexts.map((c) => c.name)).toEqual(['yolo-recall'])
  })

  it('instructions section renders capability guidance', () => {
    const { ctx, sections } = makeCtx()
    registerYoloPrompt(ctx as never, deps())
    expect(sections[0].text()).toContain('YOLO (the personal memory plugin) is active')
  })

  it('prefs section renders preferences or empty', () => {
    const { ctx, sections } = makeCtx()
    registerYoloPrompt(ctx as never, deps())
    expect(sections[1].text()).toBe('')

    const yolo = mockYolo({
      listPreferences: vi.fn(() => [pref('语言', '中文', 0)]),
    })
    const c2 = makeCtx()
    registerYoloPrompt(c2.ctx as never, deps({ yolo }))
    expect(c2.sections[1].text()).toContain('语言: 中文')
  })

  it('recall context returns nothing without a user message', () => {
    const { ctx, contexts } = makeCtx()
    registerYoloPrompt(ctx as never, deps({ getLastUserText: () => '   ' }))
    expect(contexts[0].text()).toBe('')
  })

  it('recall context renders FTS hits under the memory heading', () => {
    const yolo = mockYolo({
      search: vi.fn(() => [
        hit('todo', 't1', '完成报告', 1),
        hit('goal', 'g1', '发布 v0.1', 2),
      ]),
    })
    const { ctx, contexts } = makeCtx()
    registerYoloPrompt(ctx as never, deps({ yolo, getLastUserText: () => '报告' }))
    const text = contexts[0].text()
    expect(text).toContain('Related memory')
    expect(text).toContain('[todo] 完成报告')
    expect(text).toContain('[goal] 发布 v0.1')
  })
})

describe('registerYoloPrompt escaping (M9)', () => {
  it('escapes {{...}} in preference values before injection', () => {
    const yolo = mockYolo({
      listPreferences: vi.fn(() => [pref('称呼', '称呼 {{user}} 本人', 1)]),
    })
    const { ctx, sections } = makeCtx()
    registerYoloPrompt(ctx as never, deps({ yolo }))
    const text = sections[1].text()
    expect(text).toContain('｛｛user}}')
    expect(text).not.toContain('{{user}}')
  })

  it('escapes {{...}} in recalled hit titles before injection', () => {
    const yolo = mockYolo({
      search: vi.fn(() => [hit('todo', 't1', '配置 {{env}} 环境变量', 1)]),
    })
    const { ctx, contexts } = makeCtx()
    registerYoloPrompt(ctx as never, deps({ yolo, getLastUserText: () => '环境变量' }))
    const text = contexts[0].text()
    expect(text).toContain('｛｛env}}')
    expect(text).not.toContain('{{env}}')
  })
})

describe('registerYoloPrompt preference cap (M9)', () => {
  it('injects only the 12 most recently updated preferences', () => {
    const entries: Array<[string, string]> = [
      ['沟通语言', '中文'],
      ['回复语气', '直接简洁'],
      ['代码风格', '函数式优先'],
      ['命名规范', 'camelCase'],
      ['测试习惯', '先写测试'],
      ['提交粒度', '小步提交'],
      ['周报格式', '要点式'],
      ['会议偏好', '提前五分钟进会'],
      ['午休时间', '12:30 到 13:30'],
      ['通勤方式', '地铁'],
      ['早餐口味', '清淡'],
      ['咖啡偏好', '燕麦拿铁'],
      ['显示器布局', '主屏竖排'],
      ['键盘布局', '默认布局'],
      ['桌面主题', '深色'],
    ]
    const yolo = mockYolo({
      listPreferences: vi.fn(() => entries.map(([k, v], i) => pref(k, v, i + 1))),
    })
    const { ctx, sections } = makeCtx()
    registerYoloPrompt(ctx as never, deps({ yolo }))
    const lines = sections[1].text().split('\n')
    expect(lines).toHaveLength(1 + 12) // heading + 12 prefs
    // newest 12 kept (indices 3..14), oldest 3 dropped
    expect(sections[1].text()).toContain('桌面主题: 深色')
    expect(sections[1].text()).toContain('命名规范: camelCase')
    expect(sections[1].text()).not.toContain('沟通语言')
    expect(sections[1].text()).not.toContain('回复语气')
    expect(sections[1].text()).not.toContain('代码风格')
  })
})

describe('registerYoloPrompt injection dedup (M9)', () => {
  it('filters out hits whose keys are already injected', () => {
    const yolo = mockYolo({
      search: vi.fn(() => [
        hit('todo', 't1', '把演示稿发给研发', 1),
        hit('todo', 't2', '提醒我周三交周报', 2),
      ]),
    })
    const { ctx, contexts } = makeCtx()
    registerYoloPrompt(
      ctx as never,
      deps({ yolo, getLastUserText: () => '演示稿', getInjected: () => new Set(['todo:t1']) }),
    )
    const text = contexts[0].text()
    expect(text).not.toContain('把演示稿发给研发')
    expect(text).toContain('提醒我周三交周报')
  })

  it('reports the kept keys back through onRecallKept', () => {
    const onRecallKept = vi.fn()
    const yolo = mockYolo({
      search: vi.fn(() => [
        hit('todo', 't1', '把演示稿发给研发', 1),
        hit('goal', 'g1', '上线个人助手', 2),
      ]),
    })
    const { ctx, contexts } = makeCtx()
    registerYoloPrompt(
      ctx as never,
      deps({
        yolo,
        getLastUserText: () => '演示稿',
        getInjected: () => new Set(['todo:t1']),
        onRecallKept,
      }),
    )
    contexts[0].text()
    expect(onRecallKept).toHaveBeenCalledWith(['goal:g1'])
  })

  it('reports an empty kept list when every hit is already injected', () => {
    const onRecallKept = vi.fn()
    const yolo = mockYolo({
      search: vi.fn(() => [hit('todo', 't1', '把演示稿发给研发', 1)]),
    })
    const { ctx, contexts } = makeCtx()
    registerYoloPrompt(
      ctx as never,
      deps({
        yolo,
        getLastUserText: () => '演示稿',
        getInjected: () => new Set(['todo:t1']),
        onRecallKept,
      }),
    )
    expect(contexts[0].text()).toBe('')
    expect(onRecallKept).toHaveBeenCalledWith([])
  })

  it('caps each row_type at the kind quota inside the recall context', () => {
    const yolo = mockYolo({
      search: vi.fn(() => [
        hit('todo', 't1', '把演示稿发给研发', 1),
        hit('todo', 't2', '提醒我周三交周报', 2),
        hit('todo', 't3', '整理季度汇报材料', 3),
      ]),
    })
    const { ctx, contexts } = makeCtx()
    registerYoloPrompt(ctx as never, deps({ yolo, getLastUserText: () => '汇报材料' }))
    const text = contexts[0].text()
    expect(text).toContain('把演示稿发给研发')
    expect(text).toContain('提醒我周三交周报')
    expect(text).not.toContain('整理季度汇报材料')
  })
})
