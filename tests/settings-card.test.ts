import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

// The card renders the host's own atoms, which the browser resolves from the
// client module baseline. A node test has no baseline table, and the package's
// transitive graph (shiki, katex) is irrelevant here, so stand them in.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Tag: () => null,
  Switch: () => null,
  IconChevronDownOutline14: () => null,
}))

import { inject } from '../client/index.ts'
import { YoloCardForm } from '../client/settings/card-form.ts'
import { en, zh } from '../client/settings/card-locale.ts'
import {
  hasPath,
  numberField,
  readPath,
  timeField,
  YOLO_FIELD_COPY,
  YOLO_FIELD_GROUPS,
  YOLO_FIELD_SPECS,
  type YoloSettings,
} from '../client/settings/model.ts'
import { Config } from '../src/runtime/config.ts'

/** Deep-merge a plain object over another, mirroring the host's layer resolution. */
function merge(base: unknown, over: unknown): unknown {
  if (over === undefined || over === null || typeof over !== 'object' || Array.isArray(over)) return over ?? base
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return over
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(over as Record<string, unknown>)) {
    out[key] = merge((base as Record<string, unknown>)[key], value)
  }
  return out
}

/** Apply one path op the way the host's `applyPathOp` does, materializing containers. */
function applyOp(section: Record<string, unknown>, op: SettingsPathOpView): Record<string, unknown> {
  const [head, ...rest] = op.path
  if (head === undefined) return op.op === 'unset' ? {} : { ...(op.value as Record<string, unknown>) }
  if (rest.length === 0) {
    if (op.op === 'set') return { ...section, [head]: op.value }
    const { [head]: _removed, ...kept } = section
    return kept
  }
  const child = section[head]
  const nextChild = typeof child === 'object' && child !== null && !Array.isArray(child) ? child as Record<string, unknown> : {}
  return { ...section, [head]: applyOp(nextChild, { ...op, path: rest }) }
}

interface ScopeDouble extends SettingsScope<YoloSettings> {
  mutate: ReturnType<typeof vi.fn>
  userOf: () => Record<string, unknown>
}

/** A writable namespace double whose resolved value layers the fake user document over the composition base. */
function writableScope(accept = true): ScopeDouble {
  const base = Config(undefined) as unknown as Record<string, unknown>
  let user: Record<string, unknown> = {}
  let revision = 1
  const snapshot = (): SettingsScopeSnapshot<YoloSettings> => ({
    status: 'ready',
    value: (Object.keys(user).length === 0 ? base : merge(base, user)) as YoloSettings,
    base,
    user: Object.keys(user).length === 0 ? undefined : user,
    revision,
    writable: true,
    mode: 'host',
  })
  return {
    getSnapshot: snapshot,
    subscribe: vi.fn(() => () => {}),
    set: vi.fn(async (field: string, value: unknown) => {
      if (accept) user = applyOp(user, { op: 'set', path: [field], value: value as never })
      revision += 1
    }),
    unset: vi.fn(async (field: string) => {
      if (accept) user = applyOp(user, { op: 'unset', path: [field] })
      revision += 1
    }),
    mutate: vi.fn(async (ops: readonly SettingsPathOpView[]) => {
      if (accept) for (const op of ops) user = applyOp(user, op)
      revision += 1
    }),
    userOf: () => user,
  }
}

function form(scope: ScopeDouble): YoloCardForm {
  return new YoloCardForm(scope, YOLO_FIELD_SPECS)
}

describe('YOLO settings card model', () => {
  it('binds the browser plugin to the durable settings service and the card locale seat', () => {
    expect(inject).toContain('settingsScope')
    expect(inject).toContain('locale')
  })

  it('carries every locale key in both shipped languages', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    expect(Object.keys(zh).length).toBeGreaterThan(0)
  })

  it('covers every rendered row with a field spec and vice versa', () => {
    const rendered = YOLO_FIELD_GROUPS.flatMap((group) => group.rows.map((row) => row.field))
    expect(new Set(rendered).size).toBe(rendered.length)
    expect([...rendered].sort()).toEqual(YOLO_FIELD_SPECS.map((spec) => spec.field).sort())
  })

  // A derived copy key would silently fall back to the raw path segment: two
  // fields end in `model`, so the card once rendered the literal text "model".
  it('spells out copy for every field in both shipped languages', () => {
    const captions = new Set<string>()
    for (const spec of YOLO_FIELD_SPECS) {
      const copy = YOLO_FIELD_COPY[spec.field]
      expect(copy, `no copy for ${spec.field}`).toBeDefined()
      expect(Object.keys(zh)).toContain(copy!.caption)
      expect(Object.keys(zh)).toContain(copy!.hint)
      expect(zh[copy!.caption]).not.toBe('')
      expect(en[copy!.hint]).not.toBe('')
      // Every field must read as its own concept: a shared caption is exactly
      // the collision that let two different `model` fields render one key.
      expect(captions.has(copy!.caption), `duplicate caption ${copy!.caption}`).toBe(false)
      captions.add(copy!.caption)
    }
    expect(Object.keys(YOLO_FIELD_COPY).sort()).toEqual(YOLO_FIELD_SPECS.map((spec) => spec.field).sort())
  })

  it('reads nested settings paths and reports presence independently of value', () => {
    const value = { reminder: { checkIntervalSec: 60, quietStart: '22:00' } }
    expect(readPath(value, ['reminder', 'checkIntervalSec'])).toBe(60)
    expect(readPath(value, ['reminder', 'missing'])).toBeUndefined()
    expect(readPath(value, ['storage', 'snapshotInterval'])).toBeUndefined()
    expect(hasPath(value, ['reminder', 'quietStart'])).toBe(true)
    expect(hasPath(value, ['reminder', 'quietEnd'])).toBe(false)
    expect(hasPath(value, ['storage', 'snapshotInterval'])).toBe(false)
  })

  it('accepts only the drafts its field declares', () => {
    const interval = numberField('reminder.checkIntervalSec', { integer: true, min: 10 })
    const confidence = numberField('extraction.todoIdentityR2MinConfidence', { min: 0, max: 1 })
    const quietStart = timeField('reminder.quietStart')

    expect(interval.parse('30')).toEqual({ kind: 'set', value: 30 })
    expect(interval.parse('')).toEqual({ kind: 'clear' })
    expect(interval.parse('5')).toBeUndefined()
    expect(interval.parse('12.5')).toBeUndefined()
    expect(interval.parse('abc')).toBeUndefined()

    expect(confidence.parse('0.85')).toEqual({ kind: 'set', value: 0.85 })
    expect(confidence.parse('1.5')).toBeUndefined()
    expect(confidence.parse('-0.1')).toBeUndefined()

    expect(quietStart.parse('22:30')).toEqual({ kind: 'set', value: '22:30' })
    expect(quietStart.parse('25:00')).toBeUndefined()
    expect(quietStart.format(undefined)).toBe('')
  })
})

describe('YOLO settings card form', () => {
  it('stages a draft, reports it dirty, and writes one nested mutation on save', async () => {
    const scope = writableScope()
    const card = form(scope)

    expect(card.shell()).toMatchObject({ available: true, writable: true, dirty: false, invalid: false })
    card.actions().edit('reminder.aheadMin', '15')
    expect(card.shell()).toMatchObject({ dirty: true, invalid: false })
    expect(card.field('reminder.aheadMin')).toEqual({ text: '15', overridden: true, invalid: false })

    await card.save()
    expect(scope.mutate).toHaveBeenCalledTimes(1)
    const [ops, fence] = scope.mutate.mock.calls[0] as [SettingsPathOpView[], number]
    expect(ops).toEqual([{ op: 'set', path: ['reminder', 'aheadMin'], value: 15 }])
    expect(fence).toBe(1)
    expect(card.shell()).toMatchObject({ dirty: false, failed: false })
    expect(readPath(scope.userOf(), ['reminder', 'aheadMin'])).toBe(15)
  })

  it('groups every staged edit into a single fenced mutation', async () => {
    const scope = writableScope()
    const card = form(scope)

    card.actions().edit('reminder.aheadMin', '15')
    card.actions().setSwitch('reminder.enabled', false)
    card.actions().edit('storage.snapshotInterval', '')
    card.actions().setSwitch('storage.snapshotInterval', true)

    await card.save()
    const [ops] = scope.mutate.mock.calls[0] as [SettingsPathOpView[], number]
    expect(ops).toEqual([
      { op: 'set', path: ['reminder', 'aheadMin'], value: 15 },
      { op: 'set', path: ['reminder', 'enabled'], value: false },
      { op: 'set', path: ['storage', 'snapshotInterval'], value: 'every_10_turns' },
    ])
    expect(card.shell().dirty).toBe(false)
  })

  it('blocks the save while a draft is not a value its field accepts', () => {
    const scope = writableScope()
    const card = form(scope)

    card.actions().edit('reminder.checkIntervalSec', '5')
    expect(card.field('reminder.checkIntervalSec')).toMatchObject({ invalid: true })
    expect(card.shell()).toMatchObject({ dirty: true, invalid: true })

    return card.save().then(() => {
      expect(scope.mutate).not.toHaveBeenCalled()
    })
  })

  it('marks a field overridden only while the raw user layer carries it', async () => {
    const scope = writableScope()
    const card = form(scope)

    expect(card.field('reminder.aheadMin').overridden).toBe(false)
    card.actions().edit('reminder.aheadMin', '15')
    await card.save()
    expect(card.field('reminder.aheadMin').overridden).toBe(true)
    expect(card.field('reminder.checkIntervalSec').overridden).toBe(false)
  })

  it('stages a reset as one unset so the field re-inherits the composition layer', async () => {
    const scope = writableScope()
    const card = form(scope)

    card.actions().edit('reminder.aheadMin', '15')
    await card.save()
    card.actions().resetField('reminder.aheadMin')
    expect(card.field('reminder.aheadMin')).toMatchObject({ text: String((Config(undefined)).reminder.aheadMin), overridden: false })

    await card.save()
    const [ops] = scope.mutate.mock.calls[1] as [SettingsPathOpView[], number]
    expect(ops).toEqual([{ op: 'unset', path: ['reminder', 'aheadMin'] }])
    expect(hasPath(scope.userOf(), ['reminder', 'aheadMin'])).toBe(false)
    expect(card.field('reminder.aheadMin').overridden).toBe(false)
  })

  it('drops every staged draft on discard', () => {
    const scope = writableScope()
    const card = form(scope)

    card.actions().setSwitch('brief.enabled', false)
    expect(card.switchState('brief.enabled').value).toBe(false)
    expect(card.shell().dirty).toBe(true)

    card.actions().discard()
    expect(card.shell().dirty).toBe(false)
    expect(card.switchState('brief.enabled').value).toBe((Config(undefined)).brief.enabled)
  })

  it('ignores a staged edit that matches the value already in effect', () => {
    const scope = writableScope()
    const card = form(scope)

    card.actions().edit('reminder.checkIntervalSec', '5')
    card.actions().edit('reminder.checkIntervalSec', String((Config(undefined)).reminder.checkIntervalSec))
    expect(card.shell()).toMatchObject({ dirty: false, invalid: false })
  })

  it('reports a host rejection and keeps the drafts for correction', async () => {
    const scope = writableScope(false)
    const card = form(scope)

    card.actions().edit('reminder.aheadMin', '15')
    await card.save()

    expect(card.shell()).toMatchObject({ dirty: true, failed: true })
    expect(card.field('reminder.aheadMin').text).toBe('15')
    expect(scope.mutate.mock.calls[0]![1]).toBe(1)

    // The retry re-fences on whatever the host now stands at rather than the
    // stale revision the draft began from, so correcting and saving again can
    // actually land (the real scope resolves an absent fence to the latest
    // revision).
    await card.save()
    expect(scope.mutate.mock.calls[1]![1]).toBeUndefined()
  })

  it('renders a value field from the composition layer when a legacy document omits it', () => {
    const scope = writableScope()
    const card = form(scope)

    expect(card.field('extraction.todoIdentityR2MinConfidence').text).toBe('0.85')
    expect(card.field('extraction.todoIdentityR2MinConfidence').overridden).toBe(false)
  })
})
