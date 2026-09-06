import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { YoloSettings } from '../../src/contracts/config.ts'

export type EditableSettingsSection = 'extraction' | 'reminder' | 'brief' | 'storage'

export interface YoloSettingsDraft {
  extractionEnabled: boolean
  extractionModel: string
  todoIdentityR2Enabled: boolean
  todoIdentityR2MinConfidence: string
  todoIdentityR3Enabled: boolean
  reminderEnabled: boolean
  checkIntervalSec: string
  aheadMin: string
  quietHoursEnabled: boolean
  quietStart: string
  quietEnd: string
  briefEnabled: boolean
  morningTime: string
  eveningTime: string
  briefModel: string
  snapshotInterval: 'daily' | 'every_10_turns'
}

export interface SettingsValidationIssue {
  field: keyof YoloSettingsDraft
  message: string
}

export interface SaveSettingsResult {
  ok: boolean
  error?: string
}

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u
const EDITABLE_SECTIONS: readonly EditableSettingsSection[] = ['extraction', 'reminder', 'brief', 'storage']

export function settingsDraftFrom(value: YoloSettings): YoloSettingsDraft {
  return {
    extractionEnabled: value.extraction.enableLLM,
    extractionModel: value.extraction.model,
    todoIdentityR2Enabled: value.extraction.todoIdentityR2Enabled,
    // This field was added after earlier settings were persisted, so a
    // pre-existing document omits it; fall back to the schema default rather
    // than rendering "undefined" (which broke client-side validation).
    todoIdentityR2MinConfidence: String(value.extraction.todoIdentityR2MinConfidence ?? 0.85),
    todoIdentityR3Enabled: value.extraction.todoIdentityR3Enabled,
    reminderEnabled: value.reminder.enabled,
    checkIntervalSec: String(value.reminder.checkIntervalSec),
    aheadMin: String(value.reminder.aheadMin),
    quietHoursEnabled: value.reminder.quietHoursEnabled,
    quietStart: value.reminder.quietStart,
    quietEnd: value.reminder.quietEnd,
    briefEnabled: value.brief.enabled,
    morningTime: value.brief.morningTime,
    eveningTime: value.brief.eveningTime,
    briefModel: value.brief.model,
    snapshotInterval: value.storage.snapshotInterval === 'every_10_turns' ? 'every_10_turns' : 'daily',
  }
}

function wholeNumber(value: string): number | undefined {
  if (!/^\d+$/u.test(value.trim())) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function decimalNumber(value: string): number | undefined {
  const trimmed = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/u.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function validateSettingsDraft(draft: YoloSettingsDraft): SettingsValidationIssue[] {
  const issues: SettingsValidationIssue[] = []
  const interval = wholeNumber(draft.checkIntervalSec)
  const ahead = wholeNumber(draft.aheadMin)
  const confidence = decimalNumber(draft.todoIdentityR2MinConfidence)
  if (!draft.extractionModel.trim()) issues.push({ field: 'extractionModel', message: '提取模型不能为空。' })
  if (interval === undefined || interval < 10) issues.push({ field: 'checkIntervalSec', message: '扫描间隔必须是至少 10 秒的整数。' })
  if (ahead === undefined) issues.push({ field: 'aheadMin', message: '提前量必须是 0 或更大的整数分钟。' })
  if (confidence === undefined || confidence < 0 || confidence > 1) issues.push({ field: 'todoIdentityR2MinConfidence', message: '关联置信度阈值必须是 0 到 1 之间的数字。' })
  for (const [field, label] of [
    ['quietStart', '安静时段开始'],
    ['quietEnd', '安静时段结束'],
    ['morningTime', '早报时间'],
    ['eveningTime', '晚报时间'],
  ] as const) {
    if (!TIME.test(draft[field])) issues.push({ field, message: `${label}必须是有效的 HH:mm。` })
  }
  if (!draft.briefModel.trim()) issues.push({ field: 'briefModel', message: '简报模型不能为空。' })
  return issues
}

export function settingsFromDraft(current: YoloSettings, draft: YoloSettingsDraft): YoloSettings {
  return {
    ...current,
    extraction: {
      ...current.extraction,
      enableLLM: draft.extractionEnabled,
      model: draft.extractionModel.trim(),
      todoIdentityR2Enabled: draft.todoIdentityR2Enabled,
      todoIdentityR2MinConfidence: Number(draft.todoIdentityR2MinConfidence),
      todoIdentityR3Enabled: draft.todoIdentityR3Enabled,
    },
    reminder: {
      ...current.reminder,
      enabled: draft.reminderEnabled,
      checkIntervalSec: Number(draft.checkIntervalSec),
      aheadMin: Number(draft.aheadMin),
      quietHoursEnabled: draft.quietHoursEnabled,
      quietStart: draft.quietStart,
      quietEnd: draft.quietEnd,
    },
    brief: {
      ...current.brief,
      enabled: draft.briefEnabled,
      morningTime: draft.morningTime,
      eveningTime: draft.eveningTime,
      model: draft.briefModel.trim(),
    },
    storage: {
      ...current.storage,
      snapshotInterval: draft.snapshotInterval,
    },
  }
}

/** Fold a value into a canonical form so JSON comparison is key-order
 * independent. The host re-normalizes a section through schemastery (schema
 * key order), while `settingsFromDraft` builds the next section by spreading
 * the current value and appending new fields — a naive `JSON.stringify`
 * comparison would report a false mismatch on a newly added field. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]))
  }
  return value
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

export function changedSettingsSections(
  current: YoloSettings,
  next: YoloSettings,
): EditableSettingsSection[] {
  return EDITABLE_SECTIONS.filter((section) => !equal(current[section], next[section]))
}

/** Persist staged sections, then verify the Host-published read-back. */
export async function saveSettingsDraft(
  scope: SettingsScope<YoloSettings>,
  current: YoloSettings,
  draft: YoloSettingsDraft,
): Promise<SaveSettingsResult> {
  const issue = validateSettingsDraft(draft)[0]
  if (issue) return { ok: false, error: issue.message }
  const next = settingsFromDraft(current, draft)
  const sections = changedSettingsSections(current, next)
  try {
    for (const section of sections) await scope.set(section, next[section])
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '设置写入失败。' }
  }
  const accepted = scope.getSnapshot()
  if (accepted.status !== 'ready' || !accepted.value) return { ok: false, error: '宿主没有返回可用的设置。' }
  if (sections.some((section) => !equal(accepted.value![section], next[section]))) {
    return { ok: false, error: '保存未被宿主接受，请检查输入或刷新后重试。' }
  }
  return { ok: true }
}

export type { YoloSettings }
