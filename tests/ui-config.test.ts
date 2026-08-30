// Runtime config contract — schemastery defaults, validation and the legacy UI
// import path remain stable after configuration ownership leaves the UI.

import { describe, expect, it } from 'vitest'
import { YOLO_SETTINGS_NAMESPACE, type YoloConfig } from '../src/contracts/config.ts'
import { Config, YOLO_NS } from '../src/runtime/config.ts'
import { Config as UiCompatibilityConfig } from '../src/ui/config.ts'
import type { Config as UiCompatibilityConfigType } from '../src/ui/config.ts'

describe('YOLO runtime Config schema', () => {
  it('owns the stable settings namespace outside the UI compatibility layer', () => {
    expect(YOLO_SETTINGS_NAMESPACE).toBe('yolo')
    expect(YOLO_NS).toBe('yolo')
    expect(UiCompatibilityConfig).toBe(Config)
    const compatible: UiCompatibilityConfigType = Config(undefined)
    expect(compatible).toMatchObject({} satisfies Partial<YoloConfig>)
  })

  it('applies defaults for an empty object', () => {
    const c = Config(undefined)
    expect(c.enabled).toBe(true)
    expect(c.extraction.enableLLM).toBe(true)
    expect(c.extraction.model).toBe('deepseek-chat')
    expect(c.extraction.todoIdentityR2Enabled).toBe(false)
    expect(c.extraction.todoIdentityR3Enabled).toBe(false)
    expect(c.reminder.enabled).toBe(true)
    expect(c.storage.scope).toBe('workspace')
    expect(c.storage.snapshotInterval).toBe('daily')
    expect(c.recall.topK).toBe(5)
  })

  it('accepts explicit overrides', () => {
    const c = Config({ enabled: false, extraction: { todoIdentityR2Enabled: true, todoIdentityR3Enabled: true }, reminder: { enabled: false }, recall: { topK: 8 } } as never)
    expect(c.enabled).toBe(false)
    expect(c.reminder.enabled).toBe(false)
    expect(c.recall.topK).toBe(8)
    expect(c.extraction.enableLLM).toBe(true) // untouched fields keep defaults
    expect(c.extraction.todoIdentityR2Enabled).toBe(true)
    expect(c.extraction.todoIdentityR3Enabled).toBe(true)
  })

  it('rejects out-of-range numbers', () => {
    expect(() => Config({ extraction: { minIntervalSec: 1 } } as never)).toThrow(/minIntervalSec/)
    expect(() => Config({ recall: { topK: 99 } } as never)).toThrow(/topK/)
  })

  it('rejects invalid clocks and unsupported snapshot cadences', () => {
    expect(() => Config({ reminder: { quietStart: '24:00' } } as never)).toThrow(/quietStart/)
    expect(() => Config({ brief: { morningTime: '9:00' } } as never)).toThrow(/morningTime/)
    expect(() => Config({ storage: { snapshotInterval: 'weekly' } } as never)).toThrow(/snapshotInterval/)
  })
})
