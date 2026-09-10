/**
 * YOLO plugin-configuration card model: which settings the card edits, how a
 * stored value becomes draft text and back, and how the rows are grouped.
 *
 * Pure data + pure functions — no React, no Cordis — so the rules stay unit
 * testable without a host. `card-form.ts` turns this table into the staged form
 * the card renders.
 *
 * Field identity is the DOTTED PATH inside the `yolo` settings namespace
 * (`reminder.checkIntervalSec`), because the card writes nested path ops
 * through the settings scope rather than whole sections. That keeps the
 * per-field "overridden / reset to composition default" semantics the shipped
 * plugin cards have.
 */
import type { YoloCardLocaleKey } from './card-locale.ts'
import type { YoloSettings } from '../../src/contracts/config.ts'

/** The write one field's staged draft performs when the card is saved. */
export type FieldWrite = { kind: 'set'; value: unknown } | { kind: 'clear' }

/** A staged value field: text, number, or time — rendered as a labelled input. */
export interface ValueFieldSpec {
  /** Dotted path inside the namespace section; also the field's stable id. */
  readonly field: string
  readonly path: readonly string[]
  readonly control: 'value'
  /** Keypad hint only; what a draft accepts is decided by {@link parse}. */
  readonly inputMode?: 'numeric' | 'decimal'
  /** Copy shown in place of the hint while the draft is not accepted. */
  readonly invalidKey?: YoloCardLocaleKey
  /** Render a stored value as draft text; the empty string when absent. */
  readonly format: (value: unknown) => string
  /** The write this draft stages, or undefined when the field does not accept it. */
  readonly parse: (text: string) => FieldWrite | undefined
}

/** A staged switch: a boolean, or an enum spelled as two named values. */
export interface SwitchFieldSpec {
  readonly field: string
  readonly path: readonly string[]
  readonly control: 'switch'
  /** Whether a stored value reads as "on". */
  readonly isOn: (value: unknown) => boolean
  /** Value written when the switch turns on. */
  readonly on: unknown
  /** Value written when the switch turns off. */
  readonly off: unknown
}

export type YoloFieldSpec = ValueFieldSpec | SwitchFieldSpec

/** One rendered row; `experimental` adds the card's 实验性 marker. */
export interface YoloFieldRow {
  readonly field: string
  readonly experimental?: boolean
}

/** The locale keys one field renders: its label and its hint line. */
export interface YoloFieldCopy {
  readonly caption: YoloCardLocaleKey
  readonly hint: YoloCardLocaleKey
}

/**
 * Copy for every field, spelled out rather than derived from the dotted path.
 * Two fields end in `model` (extraction and brief) and two in `enabled`, so a
 * derived key would silently fall back to the raw path segment and render
 * `model` on screen — this table is the single place that maps a field to its
 * words, and `tests/settings-card.test.ts` proves it is total.
 */
export const YOLO_FIELD_COPY: Record<string, YoloFieldCopy> = {
  'extraction.enableLLM': { caption: 'extractionEnabled', hint: 'extractionEnabledHint' },
  'extraction.model': { caption: 'extractionModel', hint: 'extractionModelHint' },
  'extraction.todoIdentityR2Enabled': { caption: 'identityR2', hint: 'identityR2Hint' },
  'extraction.todoIdentityR2MinConfidence': { caption: 'identityR2Confidence', hint: 'identityR2ConfidenceHint' },
  'extraction.todoIdentityR3Enabled': { caption: 'identityR3', hint: 'identityR3Hint' },
  'reminder.enabled': { caption: 'reminderEnabled', hint: 'reminderEnabledHint' },
  'reminder.checkIntervalSec': { caption: 'checkIntervalSec', hint: 'checkIntervalSecHint' },
  'reminder.aheadMin': { caption: 'aheadMin', hint: 'aheadMinHint' },
  'reminder.quietHoursEnabled': { caption: 'quietHoursEnabled', hint: 'quietHoursEnabledHint' },
  'reminder.quietStart': { caption: 'quietStart', hint: 'quietStartHint' },
  'reminder.quietEnd': { caption: 'quietEnd', hint: 'quietEndHint' },
  'brief.enabled': { caption: 'briefEnabled', hint: 'briefEnabledHint' },
  'brief.morningTime': { caption: 'morningTime', hint: 'morningTimeHint' },
  'brief.eveningTime': { caption: 'eveningTime', hint: 'eveningTimeHint' },
  'brief.model': { caption: 'briefModel', hint: 'briefModelHint' },
  'storage.snapshotInterval': { caption: 'snapshotEvery10Turns', hint: 'snapshotEvery10TurnsHint' },
}

/** One titled block of rows. */
export interface YoloFieldGroup {
  readonly titleKey: YoloCardLocaleKey
  readonly rows: readonly YoloFieldRow[]
}

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u

/** Read a nested value by path; undefined when any segment is absent or not an object. */
export function readPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** Whether every path segment exists, independently of the value stored there. */
export function hasPath(value: unknown, path: readonly string[]): boolean {
  let current: unknown = value
  for (const key of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return false
    if (!Object.hasOwn(current, key)) return false
    current = (current as Record<string, unknown>)[key]
  }
  return true
}

/** Identity for the scalar values this card writes. */
export function sameValue(a: unknown, b: unknown): boolean {
  return Object.is(a, b)
}

function valueField(field: string, inputMode: ValueFieldSpec['inputMode'], parse: ValueFieldSpec['parse'], invalidKey?: YoloCardLocaleKey): ValueFieldSpec {
  const path = field.split('.')
  return {
    field,
    path,
    control: 'value',
    ...(inputMode === undefined ? {} : { inputMode }),
    ...(invalidKey === undefined ? {} : { invalidKey }),
    format: (value) => {
      if (typeof value === 'string') return value
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      return ''
    },
    parse,
  }
}

/** A free-text field; an empty draft clears the field back to the composition layer. */
export function textField(field: string): ValueFieldSpec {
  return valueField(field, undefined, (text) => {
    const trimmed = text.trim()
    return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
  })
}

/** A 24-hour `HH:mm` field; an empty draft clears the field. */
export function timeField(field: string): ValueFieldSpec {
  return valueField(field, undefined, (text) => {
    const trimmed = text.trim()
    if (trimmed === '') return { kind: 'clear' }
    return TIME.test(trimmed) ? { kind: 'set', value: trimmed } : undefined
  }, 'invalidTime')
}

/** A whole-or-decimal number field bounded by `min`/`max`; an empty draft clears the field. */
export function numberField(field: string, bounds: { integer?: boolean; min?: number; max?: number }): ValueFieldSpec {
  const inputMode = bounds.integer === true ? 'numeric' : 'decimal'
  return valueField(field, inputMode, (text) => {
    const trimmed = text.trim().replace(',', '.')
    if (trimmed === '') return { kind: 'clear' }
    if (bounds.integer === true ? !/^\d+$/u.test(trimmed) : !/^\d+(?:\.\d+)?$/u.test(trimmed)) return undefined
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) return undefined
    if (bounds.min !== undefined && parsed < bounds.min) return undefined
    if (bounds.max !== undefined && parsed > bounds.max) return undefined
    return { kind: 'set', value: parsed }
  }, 'invalidNumber')
}

/** A boolean switch. */
export function switchField(field: string): SwitchFieldSpec {
  return { field, path: field.split('.'), control: 'switch', isOn: (value) => value === true, on: true, off: false }
}

/** A two-value enum rendered as a switch, so the card needs no select control. */
export function enumSwitchField(field: string, on: string, off: string): SwitchFieldSpec {
  return { field, path: field.split('.'), control: 'switch', isOn: (value) => value === on, on, off }
}

/** Every field the card edits, keyed by dotted path. */
export const YOLO_FIELD_SPECS: readonly YoloFieldSpec[] = [
  switchField('extraction.enableLLM'),
  textField('extraction.model'),
  switchField('extraction.todoIdentityR2Enabled'),
  numberField('extraction.todoIdentityR2MinConfidence', { min: 0, max: 1 }),
  switchField('extraction.todoIdentityR3Enabled'),
  switchField('reminder.enabled'),
  numberField('reminder.checkIntervalSec', { integer: true, min: 10 }),
  numberField('reminder.aheadMin', { integer: true, min: 0 }),
  switchField('reminder.quietHoursEnabled'),
  timeField('reminder.quietStart'),
  timeField('reminder.quietEnd'),
  switchField('brief.enabled'),
  timeField('brief.morningTime'),
  timeField('brief.eveningTime'),
  textField('brief.model'),
  enumSwitchField('storage.snapshotInterval', 'every_10_turns', 'daily'),
]

/** Card layout: the groups the rows render under, in order. */
export const YOLO_FIELD_GROUPS: readonly YoloFieldGroup[] = [
  {
    titleKey: 'groupExtraction',
    rows: [{ field: 'extraction.enableLLM' }, { field: 'extraction.model' }],
  },
  {
    titleKey: 'groupExperimental',
    rows: [
      { field: 'extraction.todoIdentityR2Enabled', experimental: true },
      { field: 'extraction.todoIdentityR2MinConfidence', experimental: true },
      { field: 'extraction.todoIdentityR3Enabled', experimental: true },
    ],
  },
  {
    titleKey: 'groupReminder',
    rows: [
      { field: 'reminder.enabled' },
      { field: 'reminder.checkIntervalSec' },
      { field: 'reminder.aheadMin' },
      { field: 'reminder.quietHoursEnabled' },
      { field: 'reminder.quietStart' },
      { field: 'reminder.quietEnd' },
    ],
  },
  {
    titleKey: 'groupBrief',
    rows: [
      { field: 'brief.enabled' },
      { field: 'brief.morningTime' },
      { field: 'brief.eveningTime' },
      { field: 'brief.model' },
    ],
  },
  {
    titleKey: 'groupStorage',
    rows: [{ field: 'storage.snapshotInterval' }],
  },
]

/** The subset of the namespace this card may write. */
export type { YoloSettings }
