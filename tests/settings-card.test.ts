import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { inject } from '../client/index.ts'
import { changedSettingsSections, saveSettingsDraft, settingsDraftFrom, settingsFromDraft, validateSettingsDraft, type YoloSettings } from '../client/settings/model.ts'
import { resolveReminderRuntime } from '../src/reminder/scheduler.ts'
import { Config } from '../src/ui/config.ts'

function writableScope(initial: YoloSettings, accept = true): SettingsScope<YoloSettings> & { set: ReturnType<typeof vi.fn> } {
  let value = initial
  const snapshot = (): SettingsScopeSnapshot<YoloSettings> => ({
    status: 'ready', value, base: Config(undefined), user: {}, revision: 1, writable: true, mode: 'host',
  })
  return {
    getSnapshot: snapshot,
    subscribe: vi.fn(() => () => {}),
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
    draft.reminderEnabled = false
    const next = settingsFromDraft(current, draft)

    expect(next.recall.topK).toBe(8)
    expect(next.extraction.minIntervalSec).toBe(45)
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
