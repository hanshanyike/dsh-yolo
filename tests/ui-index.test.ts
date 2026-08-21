// M4b ui plugin wiring tests — the dashboard publish triggers:
// automatic publish after each turn and on the '/yolo' text command.

import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/ui/index.ts'
import type Yolo from '../src/storage/index.ts'
import type { Config } from '../src/ui/config.ts'

type Handler = (...args: any[]) => void

function makeCtx(yolo: Yolo) {
  const handlers = new Map<string, Handler>()
  const ctx = {
    yolo,
    webServer: { register: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn() },
    // cordis dependency injection used by installSettingsSection
    inject: (_deps: string[], cb: (sctx: unknown) => void) => {
      cb({
        settings: {
          register: vi.fn(() => ({
            dispose: () => {},
            watch: () => () => {},
            get: () => undefined,
          })),
        },
        effect: () => () => {},
      })
    },
    on: (event: string, cb: Handler) => {
      handlers.set(event, cb)
      return () => handlers.delete(event)
    },
  }
  return { ctx, handlers }
}

function mockYolo(): Yolo {
  return {
    resolve: () => ({ scopeKey: 'test/main', db: {}, dataDir: '' }),
    listTodos: vi.fn(() => []),
    listGoals: vi.fn(() => []),
    listMilestones: vi.fn(() => []),
    listEvents: vi.fn(() => []),
    listPreferences: vi.fn(() => []),
  } as unknown as Yolo
}

function config(over: Partial<Config> = {}): Config {
  return {
    enabled: true,
    extraction: { enableRules: true, enableLLM: true, model: 'deepseek-chat', minIntervalSec: 30 },
    reminder: { enabled: true, checkIntervalSec: 300, aheadMin: 60 },
    storage: { scope: 'workspace', snapshotInterval: 'daily' },
    recall: { maxTokens: 512, topK: 5 },
    ...over,
  }
}

function userMessage(text: string) {
  return { type: 'user/message', data: { content: [{ type: 'text', text }] } }
}

describe('ui apply: dashboard publish', () => {
  it('publishes a snapshot after every finished turn', () => {
    const append = vi.fn()
    const { ctx, handlers } = makeCtx(mockYolo())
    apply(ctx as never, config())
    const onTurn = handlers.get('agent/turn-stopping')!
    onTurn({ agent: { session: { append, meta: { cwd: '/ws' } } } })
    expect(append).toHaveBeenCalledTimes(1)
    const [type, payload] = append.mock.calls[0] as [string, { scopeKey: string; data: { at: number } }]
    expect(type).toBe('yolo/snapshot')
    expect(payload.scopeKey).toBe('test/main')
    expect(payload.data.at).toBeGreaterThan(0)
  })

  it('does not publish when the plugin is disabled', () => {
    const append = vi.fn()
    const { ctx, handlers } = makeCtx(mockYolo())
    apply(ctx as never, config({ enabled: false }))
    const onTurn = handlers.get('agent/turn-stopping')!
    onTurn({ agent: { session: { append, meta: {} } } })
    expect(append).not.toHaveBeenCalled()
  })

  it('publishes on the /yolo command and ignores other messages', () => {
    const append = vi.fn()
    const { ctx, handlers } = makeCtx(mockYolo())
    apply(ctx as never, config())
    const onEvent = handlers.get('session/event')!

    onEvent({ append, meta: {} }, userMessage('你好'))
    expect(append).not.toHaveBeenCalled()

    onEvent({ append, meta: { cwd: '/ws' } }, userMessage('/yolo'))
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('survives publish failures', () => {
    const append = vi.fn(() => { throw new Error('durable down') })
    const { ctx, handlers } = makeCtx(mockYolo())
    apply(ctx as never, config())
    const onTurn = handlers.get('agent/turn-stopping')!
    expect(() => onTurn({ agent: { session: { append, meta: {} } } })).not.toThrow()
  })
})
