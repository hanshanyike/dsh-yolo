/**
 * The YOLO plugin-configuration card.
 *
 * dsh 0.1.5's Plugins settings section dispatches `settings.plugin.item` by
 * settings namespace, and each card owns its own chrome. This card reproduces
 * the chrome the shipped cards render — the same header button, unsaved tag,
 * chevron disclosure, read-only notice, and discard/save footer, with the same
 * declarations and primitives (Tag, Switch, chevron icon) — so YOLO's card is
 * indistinguishable from the shell / agent-loop / web-search cards instead of
 * being the one card with its own look.
 */
import { useEffect, useRef, useState } from 'react'
import { IconChevronDownOutline14, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CardFieldState, CardShell } from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import packageJson from '../../package.json' with { type: 'json' }
import { YOLO_CARD_NS, type YoloCardLocaleKey } from './card-locale.ts'
import type { SwitchFieldState, YoloCardActions } from './card-form.ts'
import { YOLO_FIELD_COPY, YOLO_FIELD_GROUPS, YOLO_FIELD_SPECS, type YoloFieldSpec } from './model.ts'

const PACKAGE_VERSION = packageJson.version

/** What the card renders. */
export interface YoloCardState extends CardShell {
  /** One entry per value field, keyed by dotted path. */
  fields: Record<string, CardFieldState>
  /** One entry per switch field, keyed by dotted path. */
  switches: Record<string, SwitchFieldState>
}

/** The registration-side face the card's slot entry injects. */
export interface YoloCardFace extends YoloCardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useYoloCard. */
    yoloCard: SnapshotStore<YoloCardState>
  }
}

/** Props the renderer binds for the YOLO card. */
export type YoloSettingsCardProps =
  PropsRuntime<'settings.plugin.item'> & PropsLocale<typeof YOLO_CARD_NS> & InjectFace<YoloCardFace>

const SPECS = new Map(YOLO_FIELD_SPECS.map((spec) => [spec.field, spec]))

function specOf(field: string): YoloFieldSpec {
  const spec = SPECS.get(field)
  if (spec === undefined) throw new Error(`yolo card renders unknown field ${field}`)
  return spec
}

/**
 * Copy keys of a field's label and hint. The table is total by contract: a
 * missing entry must fail loudly rather than fall back to the dotted path
 * segment, which would render `model` on screen where a label belongs.
 */
function copyOf(field: string): { caption: YoloCardLocaleKey; hint: YoloCardLocaleKey } {
  const copy = YOLO_FIELD_COPY[field]
  if (copy === undefined) throw new Error(`yolo card has no copy for field ${field}`)
  return copy
}

function controlId(field: string): string {
  return `plugin-config-yolo-${field.replace(/\./gu, '-')}`
}

/**
 * Render the YOLO plugin card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card, or nothing while the namespace is unserved.
 */
export function YoloSettingsCard(props: YoloSettingsCardProps): JSX.Element | null {
  const { t, useYoloCard } = props
  const state = useYoloCard((snapshot) => snapshot)
  const [open, setOpen] = useState(false)
  const saveStarted = useRef(false)

  // A successful save collapses the card, exactly like the shipped cards; a
  // failed one keeps it open with its drafts.
  useEffect(() => {
    if (state.saving) {
      saveStarted.current = true
      return
    }
    if (!saveStarted.current) return
    saveStarted.current = false
    if (!state.dirty && !state.failed) setOpen(false)
  }, [state.dirty, state.failed, state.saving])

  if (!state.available) return null

  const title = t('title')
  const disabled = !state.writable || state.saving

  const renderValue = (field: string, experimental: boolean | undefined): JSX.Element => {
    const fieldState = state.fields[field] ?? { text: '', overridden: false, invalid: false }
    const spec = specOf(field)
    const id = controlId(field)
    const { caption, hint } = copyOf(field)
    const label = t(caption)
    const invalidKey = spec.control === 'value' ? spec.invalidKey : undefined
    return (
      <div className="yolo-card__field" key={field}>
        <div className="yolo-card__head">
          <label className="yolo-card__label" htmlFor={id}>{label}</label>
          {experimental === true ? <Tag tone="quiet">{t('experimental')}</Tag> : null}
          {fieldState.overridden ? (
            <span className="yolo-card__badges">
              <Tag tone="neutral">{t('overridden')}</Tag>
              <button type="button" className="yolo-card__reset" disabled={disabled} onClick={() => { props.resetField(field) }}>{t('reset')}</button>
            </span>
          ) : null}
        </div>
        <input
          id={id}
          className={fieldState.invalid ? 'yolo-card__input is-invalid' : 'yolo-card__input'}
          type="text"
          {...(spec.control === 'value' && spec.inputMode !== undefined ? { inputMode: spec.inputMode } : {})}
          {...(fieldState.invalid ? { 'aria-invalid': true } : {})}
          value={fieldState.text}
          disabled={disabled}
          onChange={(event) => { props.edit(field, event.target.value) }}
        />
        <p className={fieldState.invalid ? 'yolo-card__invalid' : 'yolo-card__hint'}>
          {fieldState.invalid && invalidKey !== undefined ? t(invalidKey) : t(hint)}
        </p>
      </div>
    )
  }

  const renderSwitch = (field: string, experimental: boolean | undefined): JSX.Element => {
    const switchState = state.switches[field] ?? { value: false, overridden: false }
    const { caption, hint } = copyOf(field)
    const label = t(caption)
    return (
      <div className="yolo-card__toggle" key={field}>
        <div className="yolo-card__toggle-row">
          <span className="yolo-card__toggle-label">
            <span>{label}</span>
            {experimental === true ? <Tag tone="quiet">{t('experimental')}</Tag> : null}
          </span>
          {switchState.overridden ? (
            <span className="yolo-card__badges">
              <Tag tone="neutral">{t('overridden')}</Tag>
              <button type="button" className="yolo-card__reset" disabled={disabled} onClick={() => { props.resetField(field) }}>{t('reset')}</button>
            </span>
          ) : null}
          <Switch
            checked={switchState.value}
            label={label}
            disabled={disabled}
            onChange={(next) => { props.setSwitch(field, next) }}
          />
        </div>
        <p className="yolo-card__hint">{t(hint)}</p>
      </div>
    )
  }

  return (
    <li className={open ? 'yolo-settings-card yolo-card is-open' : 'yolo-settings-card yolo-card'}>
      <button
        type="button"
        className="yolo-card__header"
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className="yolo-card__head-text">
          <span className="yolo-card__name">{title}</span>
          <span className="yolo-card__description">{t('description')}</span>
        </span>
        {state.dirty ? <Tag tone="neutral" className="yolo-card__pending">{t('unsaved')}</Tag> : null}
        <IconChevronDownOutline14 className={open ? 'yolo-card__chevron is-open' : 'yolo-card__chevron'} />
      </button>
      {open ? (
        <div className="yolo-card__body">
          {!state.writable ? <p className="yolo-card__read-only" role="status">{t('readOnly')}</p> : null}
          <p className="yolo-card__meta">{t('meta', { version: PACKAGE_VERSION })}</p>
          {YOLO_FIELD_GROUPS.map((group) => (
            <div className="yolo-card__group" key={group.titleKey}>
              <h4 className="yolo-card__group-title">{t(group.titleKey)}</h4>
              {group.rows.map((row) => (specOf(row.field).control === 'switch'
                ? renderSwitch(row.field, row.experimental)
                : renderValue(row.field, row.experimental)))}
            </div>
          ))}
          <div className="yolo-card__footer">
            {state.failed ? <p className="yolo-card__failed" role="status">{t('saveFailed')}</p> : null}
            <button type="button" className="yolo-card__discard" disabled={!state.dirty || state.saving} onClick={props.discard}>{t('discard')}</button>
            <button type="button" className="yolo-card__save" disabled={!state.dirty || state.invalid || state.saving} onClick={props.save}>{t(state.saving ? 'saving' : 'save')}</button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
