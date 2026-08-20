// M4a/M5 UI config tests — schemastery schema defaults and validation.

import { describe, expect, it } from 'vitest'
import { Config } from '../src/ui/config.ts'

describe('YOLO Config schema', () => {
  it('applies defaults for an empty object', () => {
    const c = Config(undefined)
    expect(c.enabled).toBe(true)
    expect(c.extraction.enableRules).toBe(true)
    expect(c.extraction.enableLLM).toBe(true)
    expect(c.extraction.model).toBe('deepseek-chat')
    expect(c.reminder.enabled).toBe(true)
    expect(c.storage.scope).toBe('workspace')
    expect(c.storage.snapshotInterval).toBe('daily')
    expect(c.recall.topK).toBe(5)
  })

  it('accepts explicit overrides', () => {
    const c = Config({ enabled: false, reminder: { enabled: false }, recall: { topK: 8 } } as never)
    expect(c.enabled).toBe(false)
    expect(c.reminder.enabled).toBe(false)
    expect(c.recall.topK).toBe(8)
    expect(c.extraction.enableRules).toBe(true) // untouched fields keep defaults
  })

  it('rejects out-of-range numbers', () => {
    expect(() => Config({ extraction: { minIntervalSec: 1 } } as never)).toThrow(/minIntervalSec/)
    expect(() => Config({ recall: { topK: 99 } } as never)).toThrow(/topK/)
  })
})
