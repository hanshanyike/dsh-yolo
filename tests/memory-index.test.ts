// Memory plugin wiring tests — apply() registers tools + prompt and tracks the
// latest user message for dynamic recall.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Yolo from '../src/storage/index.ts'
import { apply } from '../src/memory/index.ts'

type Handler = (...args: any[]) => void

interface CapturedSection {
  name: string
  text(): string
}

let cwd: string
let yolo: Yolo

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'yolo-memory-idx-'))
  vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  yolo = new Yolo({ logger: { info: () => {}, warn: () => {} }, reflect: { provide: () => {} }, effect: () => () => {} } as never)
})

afterEach(() => {
  yolo.close()
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

function makeCtx() {
  const handlers = new Map<string, Handler>()
  const tools: Array<{ name: string }> = []
  const sections: CapturedSection[] = []
  const contexts: CapturedSection[] = []
  const ctx = {
    yolo,
    logger: { info: vi.fn(), warn: vi.fn() },
    tools: { register: (t: { name: string }) => tools.push(t) },
    systemPrompt: {
      section: (s: CapturedSection) => sections.push(s),
      context: (c: CapturedSection) => contexts.push(c),
    },
    on: (event: string, cb: Handler) => {
      handlers.set(event, cb)
      return () => handlers.delete(event)
    },
  }
  return { ctx, handlers, tools, sections, contexts }
}

describe('memory apply()', () => {
  it('registers the five memory tools and the prompt contributions', () => {
    const { ctx, tools, sections, contexts } = makeCtx()
    apply(ctx as never)
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['memory_forget', 'memory_search', 'memory_write', 'yolo_action', 'yolo_query'].sort(),
    )
    expect(sections.map((s) => s.name)).toEqual(['yolo-instructions', 'yolo-prefs'])
    expect(contexts.map((c) => c.name)).toEqual(['yolo-recall'])
  })

  it('tracks the latest user message for dynamic recall', () => {
    const { ctx, handlers, contexts } = makeCtx()
    apply(ctx as never)
    const onEvent = handlers.get('session/event')!

    // seed a searchable memory row, then drive the recall context with the
    // tracked latest user message (a substring of the title — trigram MATCH)
    yolo.addTodo(cwd, { title: '准备季度汇报材料', source: 'manual' })
    onEvent(undefined, { type: 'user/message', data: { content: [{ type: 'text', text: '季度汇报' }] } })

    const recall = contexts[0].text()
    expect(recall).toContain('Related memory')
    expect(recall).toContain('准备季度汇报材料')
  })

  it('ignores assistant messages and unrelated event types for recall tracking', () => {
    const { ctx, handlers, contexts } = makeCtx()
    apply(ctx as never)
    const onEvent = handlers.get('session/event')!
    onEvent(undefined, { type: 'assistant/message', data: { content: [{ type: 'text', text: 'assistant text' }] } })
    onEvent(undefined, { type: 'tool/result', data: {} })
    expect(contexts[0].text()).toBe('')
  })

  // real-world regression: user messages containing FTS5 syntax characters
  // (angle brackets, quotes, operators) crashed the MATCH query and took the
  // whole turn down with "fts5: syntax error near ..."
  it.each([
    '帮我看看 <div>渲染为什么失败',
    '比较 a<b 和 a>b',
    '他说"好的"然后 AND OR NOT 全是保留字',
    '路径 C:\\Users\\x*y (特殊字符)',
    '箭头 -> 方向 ← 左',
  ])('recall survives FTS5 syntax characters in the user message: %s', (message) => {
    const { ctx, handlers, contexts } = makeCtx()
    apply(ctx as never)
    const onEvent = handlers.get('session/event')!

    yolo.addTodo(cwd, { title: '准备季度汇报材料', source: 'manual' })
    onEvent(undefined, { type: 'user/message', data: { content: [{ type: 'text', text: message }] } })

    expect(() => contexts[0].text()).not.toThrow()
  })

  // M9: 2-char CJK queries cannot match the trigram index — the LIKE fallback
  // inside the hybrid recall path is what makes them hit.
  it('recalls a todo from a 2-char CJK user message', () => {
    const { ctx, handlers, contexts } = makeCtx()
    apply(ctx as never)
    const onEvent = handlers.get('session/event')!

    yolo.addTodo(cwd, { title: '找研发同学评审', source: 'manual' })
    onEvent(undefined, { type: 'user/message', data: { content: [{ type: 'text', text: '研发' }] } })

    const recall = contexts[0].text()
    expect(recall).toContain('Related memory')
    expect(recall).toContain('找研发同学评审')
  })

  it('recalls a rephrased question the old single-phrase search missed', () => {
    const { ctx, handlers, contexts } = makeCtx()
    apply(ctx as never)
    const onEvent = handlers.get('session/event')!

    yolo.addTodo(cwd, { title: '把演示稿发给研发', source: 'manual' })
    onEvent(undefined, { type: 'user/message', data: { content: [{ type: 'text', text: '演示稿进展如何' }] } })

    const recall = contexts[0].text()
    expect(recall).toContain('Related memory')
    expect(recall).toContain('把演示稿发给研发')
  })

  it('suppresses re-injection within a session and re-injects after a session switch', () => {
    const { ctx, handlers, contexts } = makeCtx()
    apply(ctx as never)
    const onEvent = handlers.get('session/event')!

    yolo.addTodo(cwd, { title: '准备季度汇报材料', source: 'manual' })
    const s1 = { header: { id: 'session-1', cwd } }
    const s2 = { header: { id: 'session-2', cwd } }

    onEvent(s1, { type: 'user/message', data: { content: [{ type: 'text', text: '季度汇报' }] } })
    expect(contexts[0].text()).toContain('准备季度汇报材料')

    // next message in the same session commits the previous round's keys —
    // the row is now injected and must not be rendered again (search still hits)
    onEvent(s1, { type: 'user/message', data: { content: [{ type: 'text', text: '再看看季度汇报的安排' }] } })
    expect(yolo.search(cwd, '再看看季度汇报的安排')).not.toHaveLength(0)
    expect(contexts[0].text()).toBe('')

    // a different session clears the injected set — the row injects fresh
    onEvent(s2, { type: 'user/message', data: { content: [{ type: 'text', text: '季度汇报' }] } })
    expect(contexts[0].text()).toContain('准备季度汇报材料')
  })
})
