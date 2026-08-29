import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import packageJson from '../../package.json' with { type: 'json' }
import { YoloLogo } from '../YoloLogo.tsx'
import { saveSettingsDraft, settingsDraftFrom, validateSettingsDraft, type YoloSettings, type YoloSettingsDraft } from './model.ts'

interface SettingsCardProps { scope: SettingsScope<YoloSettings> }

const sectionStyle = { border: '1px solid var(--border, rgba(127, 127, 127, .25))', borderRadius: 10, padding: 14, display: 'grid', gap: 12 } as const
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 } as const
const labelStyle = { display: 'grid', gap: 5, fontSize: 13 } as const
const hintStyle = { color: 'var(--foreground-secondary, #666)', fontSize: 12 } as const
const inputStyle = { minWidth: 0, padding: '7px 9px', color: 'inherit', background: 'var(--background, transparent)', border: '1px solid var(--border, rgba(127, 127, 127, .35))', borderRadius: 7 } as const
const PACKAGE_VERSION = packageJson.version

function baseSettings(snapshot: SettingsScopeSnapshot<YoloSettings>): Partial<YoloSettings> {
  return snapshot.base && typeof snapshot.base === 'object' ? snapshot.base as Partial<YoloSettings> : {}
}

function defaultHint(value: unknown): string {
  if (typeof value === 'boolean') return `默认：${value ? '开启' : '关闭'}`
  return value == null ? '' : `默认：${String(value)}`
}

export function SettingsCard({ scope }: SettingsCardProps): JSX.Element {
  const snapshot = useSyncExternalStore(
    (listener) => scope.subscribe(listener),
    () => scope.getSnapshot(),
    () => scope.getSnapshot(),
  )
  const current = snapshot.value
  const [draft, setDraft] = useState<YoloSettingsDraft | undefined>(() => current ? settingsDraftFrom(current) : undefined)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; text: string }>()

  useEffect(() => {
    if (current && !dirty && !saving) setDraft(settingsDraftFrom(current))
  }, [current, dirty, saving])

  const issues = useMemo(() => draft ? validateSettingsDraft(draft) : [], [draft])
  const defaults = baseSettings(snapshot)
  const patch = <K extends keyof YoloSettingsDraft>(field: K, value: YoloSettingsDraft[K]): void => {
    setDraft((previous) => previous ? { ...previous, [field]: value } : previous)
    setDirty(true)
    setFeedback(undefined)
  }
  const save = async (): Promise<void> => {
    if (!draft || !current || saving) return
    setSaving(true)
    setFeedback(undefined)
    const result = await saveSettingsDraft(scope, current, draft)
    setSaving(false)
    if (!result.ok) {
      setFeedback({ kind: 'error', text: result.error ?? '保存失败，请重试。' })
      return
    }
    const accepted = scope.getSnapshot().value
    if (accepted) setDraft(settingsDraftFrom(accepted))
    setDirty(false)
    setFeedback({ kind: 'success', text: '设置已保存。除扫描间隔外，新设置会在下一次运行时读取。' })
  }

  if (snapshot.status === 'unavailable') return <div className="yolo-settings-card" style={{ padding: '14px 0' }}><h3 style={{ margin: 0 }}>YOLO 设置暂不可用</h3><p role="alert" style={hintStyle}>当前连接无法读取宿主持久化设置。请在本机 dsh 设置页重试。</p></div>
  if (snapshot.status === 'loading' || !draft || !current) return <div className="yolo-settings-card" style={{ padding: '14px 0' }} aria-busy="true">正在读取 YOLO 设置…</div>

  return (
    <form className="yolo-settings-card" style={{ padding: '12px 0', display: 'grid', gap: 14 }} onSubmit={(event) => { event.preventDefault(); void save() }}>
      <header>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ margin: '0 0 6px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}><YoloLogo size={20} />YOLO — 管理工作与生活的助手</h3>
          <span aria-label={`发布版本 ${PACKAGE_VERSION}`} style={{ marginBottom: 6, padding: '2px 7px', border: '1px solid var(--border, rgba(127, 127, 127, .35))', borderRadius: 999, color: 'var(--foreground-secondary, #666)', fontSize: 11, fontWeight: 700, letterSpacing: '.04em' }}>v{PACKAGE_VERSION}</span>
        </div>
        <p style={{ margin: 0, ...hintStyle }}>配置对话提取、低打扰提醒、早晚报与本地快照。当前值由宿主保存，刷新后仍会保留。</p>
      </header>
      <fieldset style={sectionStyle}>
        <legend>LLM 提取</legend>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={draft.extractionEnabled} onChange={(event) => patch('extractionEnabled', event.target.checked)} />启用 LLM 提取 <span style={hintStyle}>{defaultHint(defaults.extraction?.enableLLM)}</span></label>
        <label style={labelStyle}>提取模型<input style={inputStyle} value={draft.extractionModel} onChange={(event) => patch('extractionModel', event.target.value)} aria-invalid={issues.some((issue) => issue.field === 'extractionModel')} /><span style={hintStyle}>{defaultHint(defaults.extraction?.model)}</span></label>
      </fieldset>
      <fieldset style={sectionStyle}>
        <legend>到期提醒</legend>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={draft.reminderEnabled} onChange={(event) => patch('reminderEnabled', event.target.checked)} />启用到期提醒 <span style={hintStyle}>{defaultHint(defaults.reminder?.enabled)}</span></label>
        <div style={gridStyle}>
          <label style={labelStyle}>扫描间隔（秒）<input style={inputStyle} inputMode="numeric" value={draft.checkIntervalSec} onChange={(event) => patch('checkIntervalSec', event.target.value)} aria-invalid={issues.some((issue) => issue.field === 'checkIntervalSec')} /><span style={hintStyle}>至少 10 秒；重启宿主后生效。{defaultHint(defaults.reminder?.checkIntervalSec)}</span></label>
          <label style={labelStyle}>提前提醒（分钟）<input style={inputStyle} inputMode="numeric" value={draft.aheadMin} onChange={(event) => patch('aheadMin', event.target.value)} aria-invalid={issues.some((issue) => issue.field === 'aheadMin')} /><span style={hintStyle}>0 表示到点提醒。{defaultHint(defaults.reminder?.aheadMin)}</span></label>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={draft.quietHoursEnabled} onChange={(event) => patch('quietHoursEnabled', event.target.checked)} />启用安静时段 <span style={hintStyle}>{defaultHint(defaults.reminder?.quietHoursEnabled)}</span></label>
        <div style={gridStyle}>
          <label style={labelStyle}>安静时段开始<input type="time" style={inputStyle} value={draft.quietStart} onChange={(event) => patch('quietStart', event.target.value)} aria-invalid={issues.some((issue) => issue.field === 'quietStart')} /><span style={hintStyle}>{defaultHint(defaults.reminder?.quietStart)}</span></label>
          <label style={labelStyle}>安静时段结束<input type="time" style={inputStyle} value={draft.quietEnd} onChange={(event) => patch('quietEnd', event.target.value)} aria-invalid={issues.some((issue) => issue.field === 'quietEnd')} /><span style={hintStyle}>{defaultHint(defaults.reminder?.quietEnd)}</span></label>
        </div>
      </fieldset>
      <fieldset style={sectionStyle}>
        <legend>早晚报</legend>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={draft.briefEnabled} onChange={(event) => patch('briefEnabled', event.target.checked)} />启用早晚报 <span style={hintStyle}>{defaultHint(defaults.brief?.enabled)}</span></label>
        <div style={gridStyle}>
          <label style={labelStyle}>早报时间<input type="time" style={inputStyle} value={draft.morningTime} onChange={(event) => patch('morningTime', event.target.value)} aria-invalid={issues.some((issue) => issue.field === 'morningTime')} /><span style={hintStyle}>{defaultHint(defaults.brief?.morningTime)}</span></label>
          <label style={labelStyle}>晚报时间<input type="time" style={inputStyle} value={draft.eveningTime} onChange={(event) => patch('eveningTime', event.target.value)} aria-invalid={issues.some((issue) => issue.field === 'eveningTime')} /><span style={hintStyle}>{defaultHint(defaults.brief?.eveningTime)}</span></label>
        </div>
        <label style={labelStyle}>简报模型<input style={inputStyle} value={draft.briefModel} onChange={(event) => patch('briefModel', event.target.value)} aria-invalid={issues.some((issue) => issue.field === 'briefModel')} /><span style={hintStyle}>{defaultHint(defaults.brief?.model)}</span></label>
      </fieldset>
      <fieldset style={sectionStyle}>
        <legend>本地快照</legend>
        <label style={labelStyle}>快照节奏<select style={inputStyle} value={draft.snapshotInterval} onChange={(event) => patch('snapshotInterval', event.target.value as YoloSettingsDraft['snapshotInterval'])}><option value="daily">每日一次</option><option value="every_10_turns">每 10 轮工作对话</option></select><span style={hintStyle}>写入本地 Markdown 快照；YOLO 自身对话不计入轮次。{defaultHint(defaults.storage?.snapshotInterval)}</span></label>
      </fieldset>
      {issues.length > 0 && <p role="alert" style={{ margin: 0, color: 'var(--danger, #b42318)' }}>{issues[0]!.message}</p>}
      {feedback && <p role={feedback.kind === 'error' ? 'alert' : 'status'} style={{ margin: 0, color: feedback.kind === 'error' ? 'var(--danger, #b42318)' : 'var(--success, #157347)' }}>{feedback.text}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button type="button" disabled={!dirty || saving} onClick={() => { setDraft(settingsDraftFrom(current)); setDirty(false); setFeedback(undefined) }}>放弃修改</button><button type="submit" disabled={!snapshot.writable || !dirty || saving || issues.length > 0}>{saving ? '保存中…' : '保存设置'}</button></div>
      {!snapshot.writable && <p role="alert" style={{ margin: 0, ...hintStyle }}>当前连接为只读模式，请在本机宿主中修改设置。</p>}
    </form>
  )
}

/** Slot components receive no owner props, so bind the namespace scope here. */
export function settingsCardFor(scope: SettingsScope<YoloSettings>): () => JSX.Element {
  return function BoundSettingsCard(): JSX.Element { return <SettingsCard scope={scope} /> }
}
