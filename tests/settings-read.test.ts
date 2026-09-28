import { describe, expect, it } from 'vitest'
import { readYoloConfig } from '../src/runtime/settings-read.ts'

describe('dsh 0.2 Loader settings', () => {
  it('reads the UI entry even when other plugin entries are present', () => {
    const value = { reminder: { checkIntervalSec: 45 } }
    expect(readYoloConfig({ describe: () => [
      { ns: 'other', value: { reminder: { checkIntervalSec: 1 } } },
      { ns: 'yolo-ui', value },
    ] })).toBe(value)
  })

  it('uses the loader fallback until the UI entry is served', () => {
    expect(readYoloConfig({ describe: () => [] })).toBeUndefined()
  })
})
