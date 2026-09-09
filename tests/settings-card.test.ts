import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { inject } from '../client/index.ts'
import { changedSettingsSections, saveSettingsDraft, settingsDraftFrom, settingsFromDraft, validateSettingsDraft, type YoloSettings } from '../client/settings/model.ts'
import { resolveReminderRuntime } from '../src/reminder/scheduler.ts'
import { Config } from '../src/runtime/config.ts'

function writableScope(initial: YoloSettings, accept = true): SettingsScope<YoloSettings> & { set: ReturnType<typeof vi.fn> } {
  let value = initial
  const snapshot = (): SettingsScopeSnapshot<YoloSettings> => ({
    status: 'ready', value, base: Config(undefined), user: {}, revision: 1, writable: true, mode: 'host',
  })
  return {
    getSnapshot: snapshot,
    subscribe: vi.fn(() => () => {}),
    // dsh 0.1.2 added the atomic `mutate` op to the SettingsScope face; the card
    // uses field `set`, so the double only needs to typecheck.
    mutate: vi.fn(() => Promise.resolve()),
    set: vi.fn(async (field: string, next: unknown) => {
      if (accept) value = { ...value, [field]: next }
    }),
    unset: vi.fn(async () => {}),
  }
}

describe('YOLO settings card model', () => {
  it('binds the browser plugin to the durable settings service', () => {
    expect(inject).toContain('settingsScope')
  })

  it('preserves non-editable fields while staging editable sections', () => {
    const current = Config({ recall: { topK: 8 }, extraction: { minIntervalSec: 45 } } as never)
    const draft = settingsDraftFrom(current)
    draft.extractionModel = 'deepseek-reasoner'
    draft.todoIdentityR2Enabled = true
    draft.todoIdentityR3Enabled = true
    draft.reminderEnabled = false
    const next = settingsFromDraft(current, draft)

    expect(next.recall.topK).toBe(8)
    expect(next.extraction.minIntervalSec).toBe(45)
    expect(next.extraction.todoIdentityR2Enabled).toBe(true)
    expect(next.extraction.todoIdentityR3Enabled).toBe(true)
    expect(changedSettingsSections(current, next)).toEqual(['extraction', 'reminder'])
    expect(resolveReminderRuntime(next.reminder).enabled).toBe(false)
  })

  it('persists only changed top-level sections and verifies host read-back', async () => {
    const current = Config(undefined)
    const scope = writableScope(current)
    const draft = settingsDraftFrom(current)
    draft.reminderEnabled = false
    draft.aheadMin = '15'
    draft.snapshotInterval = 'every_10_turns'

    await expect(saveSettingsDraft(scope, current, draft)).resolves.toEqual({ ok: true })
    expect(scope.set.mock.calls.map((call) => call[0])).toEqual(['reminder', 'storage'])
    expect(scope.getSnapshot().value?.reminder).toMatchObject({ enabled: false, aheadMin: 15 })
    expect(scope.getSnapshot().value?.storage.snapshotInterval).toBe('every_10_turns')
  })

  it('stages and persists the R2a experimental switch in the extraction section', async () => {
    const current = Config(undefined)
    const scope = writableScope(current)
    const draft = settingsDraftFrom(current)
    expect(draft.todoIdentityR2Enabled).toBe(false)

    draft.todoIdentityR2Enabled = true
    await expect(saveSettingsDraft(scope, current, draft)).resolves.toEqual({ ok: true })
    expect(scope.set).toHaveBeenCalledTimes(1)
    expect(scope.set).toHaveBeenCalledWith('extraction', expect.objectContaining({ todoIdentityR2Enabled: true }))
    expect(scope.getSnapshot().value?.extraction.todoIdentityR2Enabled).toBe(true)
  })

  it('stages and persists the R3 suggestion switch without granting auto-merge', async () => {
    const current = Config(undefined)
    const scope = writableScope(current)
    const draft = settingsDraftFrom(current)
    expect(draft.todoIdentityR3Enabled).toBe(false)

    draft.todoIdentityR3Enabled = true
    await expect(saveSettingsDraft(scope, current, draft)).resolves.toEqual({ ok: true })
    expect(scope.set).toHaveBeenCalledWith('extraction', expect.objectContaining({ todoIdentityR3Enabled: true }))
    expect(scope.getSnapshot().value?.extraction.todoIdentityR3Enabled).toBe(true)
  })

  it('stages and persists the R2a confidence threshold with decimal validation', async () => {
    const current = Config(undefined)
    const scope = writableScope(current)
    const draft = settingsDraftFrom(current)
    expect(draft.todoIdentityR2MinConfidence).toBe('0.85')

    draft.todoIdentityR2MinConfidence = '0.75'
    await expect(saveSettingsDraft(scope, current, draft)).resolves.toEqual({ ok: true })
    expect(scope.set).toHaveBeenCalledWith('extraction', expect.objectContaining({ todoIdentityR2MinConfidence: 0.75 }))
    expect(scope.getSnapshot().value?.extraction.todoIdentityR2MinConfidence).toBe(0.75)

    draft.todoIdentityR2MinConfidence = '1.5'
    expect(validateSettingsDraft(draft).map((issue) => issue.field)).toContain('todoIdentityR2MinConfidence')
  })

  it('renders the default threshold for a legacy settings doc missing the field', () => {
    const legacy = Config(undefined)
    const extraction = { ...legacy.extraction } as Partial<YoloSettings['extraction']>
    delete extraction.todoIdentityR2MinConfidence
    expect(settingsDraftFrom({ ...legacy, extraction } as YoloSettings).todoIdentityR2MinConfidence).toBe('0.85')
  })

  it('accepts a host read-back whose section keys are schema-reordered', async () => {
    function sortKeysDeep(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(sortKeysDeep)
      if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>
        return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortKeysDeep(record[key])]))
      }
      return value
    }
    const legacy = Config(undefined)
    const extraction = { ...legacy.extraction } as Partial<YoloSettings['extraction']>
    delete extraction.todoIdentityR2MinConfidence
    let stored = { ...legacy, extraction } as YoloSettings
    const scope = {
      getSnapshot: () => ({
        status: 'ready' as const,
        value: sortKeysDeep(stored) as YoloSettings,
        base: Config(undefined),
        user: {},
        revision: 1,
        writable: true,
        mode: 'host' as const,
      }),
      subscribe: vi.fn(() => () => {}),
      set: vi.fn(async (field: string, next: unknown) => {
        stored = { ...stored, [field]: sortKeysDeep(next) } as YoloSettings
      }),
      unset: vi.fn(async () => {}),
    }
    const draft = settingsDraftFrom({ ...legacy, extraction } as YoloSettings)
    draft.todoIdentityR2Enabled = true
    await expect(saveSettingsDraft(scope as never, { ...legacy, extraction } as YoloSettings, draft)).resolves.toEqual({ ok: true })
  })

  it('rejects invalid values before persistence', async () => {
    const current = Config(undefined)
    const scope = writableScope(current)
    const draft = settingsDraftFrom(current)
    draft.checkIntervalSec = '5'
    draft.quietStart = '25:00'

    expect(validateSettingsDraft(draft).map((issue) => issue.field)).toEqual(['checkIntervalSec', 'quietStart'])
    await expect(saveSettingsDraft(scope, current, draft)).resolves.toMatchObject({ ok: false })
    expect(scope.set).not.toHaveBeenCalled()
  })

  it('reports a host rejection instead of claiming a save', async () => {
    const current = Config(undefined)
    const scope = writableScope(current, false)
    const draft = settingsDraftFrom(current)
    draft.reminderEnabled = false

    await expect(saveSettingsDraft(scope, current, draft)).resolves.toEqual({
      ok: false,
      error: '保存未被宿主接受，请检查输入或刷新后重试。',
    })
  })
})
