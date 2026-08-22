// YOLO kanban view — Mono design system v2.1 (frontend-redesign.md ch.4-5).
// Sections follow 4.2 top-to-bottom: toolbar (presets · range chip · focus
// capsules · filter menu) → notification cards → task sections (逾期/今日/
// 未来7天/滞留, de-carded hairline rows) → folds (goals & milestones, day
// ledger) → quick capture. All mutations go through POST /yolo/actions so a
// click and a chat reply produce identical transitions + audit events.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { YoloDashboardData, YoloMilestoneRow, YoloTodoRow } from '../../src/shared/dashboard.ts'
import { isTodoOpen } from '../../src/shared/dashboard.ts'
import {
  applyKanbanFilter,
  dueBucket,
  focusCounts,
  hasDetailFilter,
  matchRangePreset,
  rangeLabel,
  rangeOfPreset,
  sortForKanban,
  type FocusBucket,
  type KanbanFilter,
  type PresetTab,
  type RangePresetKind,
} from '../../src/shared/filters.ts'
import { DEFAULT_FILTER } from '../../src/shared/filters.ts'
import { localDateStr } from '../../src/shared/text.ts'
import {
  IcBell, IcChat, IcCheck, IcChevron, IcClose, IcDots, IcFlag, IcFilter, IcPin, IcPlusDay,
} from '../design/icons.tsx'
import type { ChatAnchor } from './ChatPane.tsx'
import { readPanelState, writePanelState } from './state.ts'

export interface KanbanViewProps {
  data: YoloDashboardData
  refresh: () => Promise<void>
  /** Open the side chat anchored to a card (聊一聊). */
  onOpenChat: (anchor: ChatAnchor) => void
  /** Jump to a dsh session (ledger source badges); optional. */
  openSession?: (sessionId: string) => void
  /** Increments when polled data actually changed — replays the sweep line. */
  sweepTick?: number
}

interface EditorDraft {
  id: string
  title: string
  due: string
  priority: string
  milestoneTitle: string
}

const DAY_MS = 86_400_000

const PRESETS: { key: PresetTab; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'all', label: '全部' },
  { key: 'done', label: '已完成' },
]

const FOCUS_LABEL: Record<FocusBucket, string> = {
  overdue: '逾期',
  today: '今日',
  week: '未来7天',
  stale: '滞留',
}

const LEDGER_KIND_LABEL: Record<string, string> = {
  todo_completed: '完成',
  todo_created: '新增',
  todo_started: '开始',
  todo_cancelled: '取消',
  todo_postponed: '推迟',
  todo_updated: '更新',
  todo_remind_again: '再提醒',
  reminder_fired: '提醒',
  brief_generated: '简报',
  goal_progress: '目标',
  goal_status: '目标',
  milestone_status: '里程碑',
  note: '记录',
  decision: '决策',
  milestone_reached: '里程碑',
}

function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function dayOf(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : ''
}

function localDayStr(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return localDayStr(d)
}

function nextDayStr(dueAt: string | null | undefined): string {
  const today = localDateStr()
  const dueDay = dayOf(dueAt)
  const base = dueDay > today ? dueDay : today
  return addDays(base, 1)
}

/** Due text: 今天/明天/昨天 · 周X M/D within a week · M/D beyond (5.2). */
function fmtDue(iso: string | null | undefined): string {
  if (!iso) return '不限期'
  const day = iso.slice(0, 10)
  const today = localDateStr()
  const time = iso.length > 10 ? ` ${iso.slice(11, 16)}` : ''
  if (day === today) return `今天${time}`
  if (day === addDays(today, 1)) return '明天'
  if (day === addDays(today, -1)) return '昨天'
  const diff = Math.round((new Date(`${day}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / DAY_MS)
  if (diff > 1 && diff <= 7) return `周${'日一二三四五六'[new Date(`${day}T00:00:00`).getDay()]} ${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}${time}`
}

/** Days since the last touch, for the stale meta signal (4.4). */
function untouchedDays(t: YoloTodoRow): number {
  if (!t.updated_at) return 0
  return Math.floor((Date.now() - t.updated_at) / DAY_MS)
}

/** Position (0..100) of a milestone dot on its track, by target date. */
function dotPos(target: string | null | undefined): number {
  if (!target) return 50
  const today = localDateStr()
  const diff = (new Date(`${target.slice(0, 10)}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / DAY_MS
  return Math.max(4, Math.min(96, 50 + (diff / 90) * 46))
}

interface Section {
  key: string
  label: string
  danger: boolean
  rows: YoloTodoRow[]
}

export function KanbanView({ data, refresh, onOpenChat, openSession, sweepTick = 0 }: KanbanViewProps): JSX.Element {
  const initial = useMemo(() => readPanelState().filter, [])
  const [filter, setFilter] = useState<KanbanFilter>(initial)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [completing, setCompleting] = useState<Set<string>>(new Set())
  const [toastText, setToastText] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorDraft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [quickAdd, setQuickAdd] = useState('')
  const [quickBusy, setQuickBusy] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState<{ kind: 'goal' | 'milestone'; id: string; title: string } | null>(null)
  const [msPop, setMsPop] = useState<{ id: string; x: number } | null>(null)
  const fltBtnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => { writePanelState({ filter }) }, [filter])

  // Toast auto-retire (5.1): 2.4s.
  useEffect(() => {
    if (!toastText) return
    const t = window.setTimeout(() => { setToastText(null) }, 2_400)
    return () => { window.clearTimeout(t) }
  }, [toastText])

  const act = useCallback(
    async (key: string, body: Record<string, unknown>): Promise<boolean> => {
      setBusyKey(key)
      setActionError(null)
      try {
        const r = await fetch('/yolo/actions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const res = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null
        if (!r.ok || !res?.ok) throw new Error(res?.error ?? `HTTP ${r.status}`)
        await refresh()
        return true
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setBusyKey(null)
      }
    },
    [refresh],
  )

  // Complete flow (5.4): optimistic fill + retire, POST, refresh.
  const completeTodo = useCallback(async (t: YoloTodoRow): Promise<void> => {
    setCompleting((s) => { const n = new Set(s); n.add(t.id); return n })
    const ok = await act(t.id, { action: 'complete', kind: 'todo', id: t.id })
    setCompleting((s) => { const n = new Set(s); n.delete(t.id); return n })
    if (ok) setToastText(`已完成 · ${t.title}`)
  }, [act])

  const counts = useMemo(() => focusCounts(data.todos), [data.todos])
  const visible = useMemo(() => sortForKanban(applyKanbanFilter(data.todos, filter)), [data.todos, filter])
  const milestoneTitles = useMemo(() => data.milestones.map((m) => m.title), [data.milestones])
  const openNotifications = data.notifications.filter((n) => !n.handled)
  const activeGoals = data.goals.filter((g) => g.status === 'active')
  const openMilestones = data.milestones.filter((m) => m.status === 'planned' || m.status === 'active')

  // Task sections (4.2④): 逾期 → 今日 → 未来7天 → 滞留; stale rows leave the
  // due sections for their own. Undated/far rows ride with 未来7天.
  const sections = useMemo<Section[]>(() => {
    if (filter.preset === 'done') {
      return [{ key: 'done', label: '已完成', danger: false, rows: visible }]
    }
    const overdue: YoloTodoRow[] = []
    const today: YoloTodoRow[] = []
    const week: YoloTodoRow[] = []
    const stale: YoloTodoRow[] = []
    for (const t of visible) {
      if (t.stale) { stale.push(t); continue }
      const b = dueBucket(t)
      if (b === 'overdue') overdue.push(t)
      else if (b === 'today') today.push(t)
      else week.push(t)
    }
    return [
      { key: 'overdue', label: '逾期', danger: true, rows: overdue },
      { key: 'today', label: '今日', danger: false, rows: today },
      { key: 'week', label: '未来 7 天', danger: false, rows: week },
      { key: 'stale', label: '滞留', danger: false, rows: stale },
    ].filter((s) => s.rows.length > 0)
  }, [visible, filter.preset])

  const patchFilter = (patch: Partial<KanbanFilter>): void => {
    setFilter((f) => ({ ...f, ...patch }))
  }

  const saveEditor = async (): Promise<void> => {
    if (!editor) return
    const ok = await act(`edit-${editor.id}`, {
      action: 'update',
      kind: 'todo',
      id: editor.id,
      title: editor.title,
      due_at: editor.due || null,
      priority: editor.priority || null,
      milestone_title: editor.milestoneTitle || '',
    })
    if (ok) setEditor(null)
  }

  const sendQuickAdd = async (): Promise<void> => {
    const text = quickAdd.trim()
    if (!text || quickBusy) return
    setQuickBusy(true)
    const ok = await act('quick-add', { action: 'quick_add', kind: 'todo', title: text })
    if (ok) {
      setQuickAdd('')
      setToastText('已记下 · 今日到期')
    }
    setQuickBusy(false)
  }

  // Filter menu: outside-pointer + Esc close (Esc must not unwind the panel).
  useEffect(() => {
    if (!filterMenuOpen) return
    const onPointer = (e: PointerEvent): void => {
      const t = e.target as Node | null
      if (!t) return
      if (menuRef.current?.contains(t)) return
      if (fltBtnRef.current?.contains(t)) return
      setFilterMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setFilterMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [filterMenuOpen])

  const rangeActive = filter.rangeFrom !== null || filter.rangeTo !== null

  return (
    <div style={{ minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* ② toolbar 40px */}
      <div className="p-toolbar">
        <div className="seg" role="tablist">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={filter.preset === p.key}
              className={`seg-btn${filter.preset === p.key ? ' on' : ''}`}
              onClick={() => { patchFilter({ preset: p.key }) }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="tb-spacer" />
        {rangeActive && (
          <button type="button" className="range-chip" title="按时段筛选生效中，点击清除" onClick={() => { patchFilter({ rangeFrom: null, rangeTo: null }) }}>
            <b>{rangeLabel(filter.rangeFrom, filter.rangeTo)}</b><IcClose size={10} />
          </button>
        )}
        <div className="caps">
          {(Object.keys(FOCUS_LABEL) as FocusBucket[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`cap${filter.focus === k ? ' on' : ''}`}
              onClick={() => {
                patchFilter({ focus: filter.focus === k ? null : k, preset: filter.preset === 'done' ? 'today' : filter.preset })
              }}
            >
              {FOCUS_LABEL[k]} <span className="num">{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="flt-wrap">
          <button
            ref={fltBtnRef}
            type="button"
            className={`flt${hasDetailFilter(filter) ? ' has-filters' : ''}`}
            onClick={() => { setFilterMenuOpen((v) => !v) }}
          >
            <IcFilter size={12} />筛选<span className="chev"><IcChevron size={10} /></span><span className="flt-dot" />
          </button>
          <div ref={menuRef} className={`menu${filterMenuOpen ? ' open' : ''}`}>
            <div className="menu-g">状态</div>
            <FilterRow label="仅逾期" on={filter.overdueOnly} onToggle={() => { patchFilter({ overdueOnly: !filter.overdueOnly }) }} />
            <FilterRow label="仅进行中" on={filter.inProgressOnly} onToggle={() => { patchFilter({ inProgressOnly: !filter.inProgressOnly }) }} />
            <FilterRow label="仅滞留" on={filter.staleOnly} onToggle={() => { patchFilter({ staleOnly: !filter.staleOnly }) }} />
            <div className="menu-g">时段（到期日）</div>
            <select
              className="msel"
              value={matchRangePreset(filter.rangeFrom, filter.rangeTo) ?? ''}
              onChange={(e) => {
                const v = e.target.value
                if (!v) patchFilter({ rangeFrom: null, rangeTo: null })
                else if (v !== 'custom') patchFilter(rangeOfPreset(v as RangePresetKind))
              }}
            >
              <option value="">不限</option>
              <option value="today">今天</option>
              <option value="thisWeek">本周</option>
              <option value="thisMonth">本月</option>
              {rangeActive && matchRangePreset(filter.rangeFrom, filter.rangeTo) === 'custom' && <option value="custom">自定义</option>}
            </select>
            <div className="range-inputs">
              <input type="date" className="mdate" value={filter.rangeFrom ?? ''} title="起（含当天）" onChange={(e) => { patchFilter({ rangeFrom: e.target.value || null }) }} />
              <span className="range-tilde">~</span>
              <input type="date" className="mdate" value={filter.rangeTo ?? ''} title="止（含当天）" onChange={(e) => { patchFilter({ rangeTo: e.target.value || null }) }} />
            </div>
            <div className="menu-g">里程碑</div>
            <select className="msel" value={filter.milestoneTitle ?? ''} onChange={(e) => { patchFilter({ milestoneTitle: e.target.value || null }) }}>
              <option value="">全部</option>
              {milestoneTitles.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <div className="menu-g">关键词</div>
            <input className="minput" value={filter.keyword ?? ''} placeholder="标题包含…" onChange={(e) => { patchFilter({ keyword: e.target.value }) }} />
            {hasDetailFilter(filter) && (
              <div className="menu-clear">
                <button type="button" className="btn btn-ghost" onClick={() => { setFilter({ ...DEFAULT_FILTER, preset: filter.preset }) }}>清除全部筛选</button>
              </div>
            )}
          </div>
        </div>
        <span key={sweepTick} className={`sweep${sweepTick > 0 ? ' run' : ''}`} />
      </div>

      {/* ③-⑥ body */}
      <div className="p-body">
        <main className="p-main">
          {actionError && (
            <div className="err-line">
              <span>操作失败：{actionError}</span>
              <button type="button" className="nact" onClick={() => { setActionError(null) }}>关闭</button>
            </div>
          )}

          {/* notification cards — the only surface above the canvas (5.3) */}
          {openNotifications.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {openNotifications.slice(0, 4).map((n) => (
                <div key={n.id} className={`notif${n.kind === 'reminder' ? ' reminder' : ''}`}>
                  <div className="notif-head">
                    <IcBell size={13} />
                    <span className="notif-type">{notifTypeLabel(n.kind, n.title)}</span>
                    <span className="notif-time mono">{fmtTime(n.created_at)}</span>
                  </div>
                  <div className="notif-body">
                    <div style={{ fontWeight: 500 }}>{n.title.replace(/^[⏰☀🌙]\s*/, '')}</div>
                    {n.body && <div style={{ color: 'var(--y-text-2)', marginTop: 2 }}>{n.body.split('\n')[0]}</div>}
                  </div>
                  <div className="notif-acts">
                    {n.kind === 'reminder' && n.todo_id && (
                      <>
                        <button type="button" className="nact" disabled={busyKey === `n-${n.id}`} onClick={() => { void act(`n-${n.id}`, { action: 'complete', kind: 'todo', id: n.todo_id }) }}>
                          <IcCheck size={12} />完成
                        </button>
                        <button type="button" className="nact" disabled={busyKey === `n-${n.id}`} onClick={() => { void act(`n-${n.id}`, { action: 'postpone', kind: 'todo', id: n.todo_id, due_at: nextDayStr(null) }) }}>
                          <IcPlusDay size={12} />+1d
                        </button>
                      </>
                    )}
                    <button type="button" className="nact nact--chat" onClick={() => { onOpenChat({ title: n.title.replace(/^[⏰☀🌙]\s*/, ''), detail: n.body ?? null }) }}>
                      <IcChat size={12} />聊一聊
                    </button>
                    <button type="button" className="nact" disabled={busyKey === `n-${n.id}`} onClick={() => { void act(`n-${n.id}`, { action: 'handled', kind: 'notification', id: n.id }) }}>
                      知道了
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* task sections (5.2) */}
          {sections.map((s) => (
            <section key={s.key} className="sec" aria-label={`${s.label} ${s.rows.length}`}>
              <div className="sec-head">
                <span className="sec-name">{s.label}</span>
                <span className={`sec-count${s.danger ? ' danger' : ''}`}>{s.rows.length}</span>
                <span className="sec-rule" />
              </div>
              {s.rows.map((t) =>
                editor?.id === t.id ? (
                  <TodoEditor
                    key={t.id}
                    draft={editor}
                    milestones={milestoneTitles}
                    busy={busyKey === `edit-${t.id}`}
                    confirming={confirmDelete === t.id}
                    onChange={setEditor}
                    onSave={() => { void saveEditor() }}
                    onCancel={() => { setEditor(null); setConfirmDelete(null) }}
                    onDelete={() => { setConfirmDelete(t.id) }}
                    onConfirmDelete={async () => {
                      const id = t.id
                      setConfirmDelete(null)
                      setEditor(null)
                      await act(`del-${id}`, { action: 'cancel', kind: 'todo', id })
                    }}
                  />
                ) : (
                  <TodoRowView
                    key={t.id}
                    t={t}
                    busy={busyKey === t.id}
                    completing={completing.has(t.id)}
                    onComplete={() => { void completeTodo(t) }}
                    onAct={(action, extra) => { void act(t.id, { action, kind: 'todo', id: t.id, ...extra }) }}
                    onEdit={() => { setEditor({ id: t.id, title: t.title, due: dayOf(t.due_at), priority: t.priority ?? '', milestoneTitle: t.milestone_title ?? '' }) }}
                    onChat={() => { onOpenChat({ title: t.title, detail: t.due_at ? `到期 ${t.due_at}` : null }) }}
                  />
                ),
              )}
            </section>
          ))}

          {visible.length === 0 && (
            <div className="empty">
              <h4>当前筛选下没有任务</h4>
              <p>说一句，我来记下</p>
            </div>
          )}

          {/* ⑤ folds: goals & milestones / day ledger */}
          <div className={`fold${planOpen ? ' open' : ''}`}>
            <button type="button" className="fold-head" onClick={() => { setPlanOpen((v) => !v) }} aria-expanded={planOpen}>
              <IcChevron size={12} />
              <span>目标与里程碑</span>
              <span className="fold-stat">{activeGoals.length + openMilestones.length}</span>
            </button>
            <div className="fold-body">
              <div className="fold-inner" style={{ paddingBottom: 10 }}>
                {activeGoals.map((g) => (
                  <GoalBlock
                    key={g.id}
                    goal={g}
                    milestones={data.milestones.filter((m) => m.title === g.milestone_title)}
                    renaming={renameDraft?.kind === 'goal' && renameDraft.id === g.id}
                    renameValue={renameDraft?.kind === 'goal' && renameDraft.id === g.id ? renameDraft.title : ''}
                    busy={busyKey === `goal-${g.id}`}
                    onRenameStart={() => { setRenameDraft({ kind: 'goal', id: g.id, title: g.title }) }}
                    onRenameChange={(v) => { setRenameDraft((d) => d ? { ...d, title: v } : d) }}
                    onRenameSave={async () => {
                      const d = renameDraft
                      setRenameDraft(null)
                      if (d && d.title.trim() && d.title !== g.title) await act(`goal-${g.id}`, { action: 'rename', kind: 'goal', id: g.id, title: d.title.trim() })
                    }}
                    onRenameCancel={() => { setRenameDraft(null) }}
                    onAbandon={() => { void act(`goal-${g.id}`, { action: 'abandon', kind: 'goal', id: g.id }) }}
                    onMsDot={(m, x) => { setMsPop(msPop?.id === m.id ? null : { id: m.id, x }) }}
                    msPopId={msPop?.id ?? null}
                  />
                ))}
                {openMilestones.length > 0 && (
                  <MilestoneTrack
                    milestones={openMilestones}
                    renaming={renameDraft?.kind === 'milestone' ? renameDraft : null}
                    busyKey={busyKey}
                    pop={msPop}
                    onDot={(m, x) => { setMsPop(msPop?.id === m.id ? null : { id: m.id, x }) }}
                    onRenameStart={(m) => { setRenameDraft({ kind: 'milestone', id: m.id, title: m.title }) }}
                    onRenameChange={(v) => { setRenameDraft((d) => d ? { ...d, title: v } : d) }}
                    onRenameSave={async (m) => {
                      const d = renameDraft
                      setRenameDraft(null)
                      if (d && d.title.trim() && d.title !== m.title) await act(`ms-${m.id}`, { action: 'rename', kind: 'milestone', id: m.id, title: d.title.trim() })
                    }}
                    onRenameCancel={() => { setRenameDraft(null) }}
                    onStatus={(m, status) => { void act(`ms-${m.id}`, { action: 'set_status', kind: 'milestone', id: m.id, status }) }}
                    onPopClose={() => { setMsPop(null) }}
                  />
                )}
                {activeGoals.length === 0 && openMilestones.length === 0 && (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--y-text-3)' }}>暂无进行中的目标与里程碑。</p>
                )}
              </div>
            </div>
          </div>

          <div className={`fold${ledgerOpen ? ' open' : ''}`}>
            <button type="button" className="fold-head" onClick={() => { setLedgerOpen((v) => !v) }} aria-expanded={ledgerOpen}>
              <IcChevron size={12} />
              <span>今日台账</span>
              <span className="fold-stat" title="今天发生过对话、且产生了记录的去重会话数；点行末会话标签可跳回该对话">
                {data.ledger.length} 条 · {data.ledgerSessions} 会话
              </span>
            </button>
            <div className="fold-body">
              <div className="fold-inner" style={{ paddingBottom: 10 }}>
                {data.ledger.length === 0 && <p style={{ margin: 0, fontSize: 12, color: 'var(--y-text-3)' }}>今天还没有记录。</p>}
                {data.ledger.map((e) => (
                  <div key={e.id} className={`lg-row${e.kind === 'todo_completed' ? ' is-done' : ''}`}>
                    {e.kind === 'todo_completed' && <IcCheck className="ic-ok" size={12} />}
                    <span className="lg-time">{fmtTime(e.occurred_at)}</span>
                    <span className="lg-type">{LEDGER_KIND_LABEL[e.kind] ?? e.kind}</span>
                    <span className="lg-sum" title={e.summary}>{e.summary}</span>
                    {e.label && (e.session_id && openSession ? (
                      <button
                        type="button"
                        className="lg-src-btn"
                        title="跳到该会话"
                        onClick={() => { openSession(e.session_id!) }}
                      >
                        <span>{e.label}</span>↗
                      </button>
                    ) : (
                      <span className="lg-src" title={e.label}><IcPin size={10} /><span>{e.label}</span></span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* ⑥ capture bar 52px */}
      <footer className="capture">
        <input
          className="cap-input"
          value={quickAdd}
          placeholder={quickBusy ? '保存中…' : '+ 快速记一条，回车保存（默认今日到期）'}
          disabled={quickBusy}
          onChange={(e) => { setQuickAdd(e.target.value) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void sendQuickAdd()
          }}
        />
        <span className={`enter-hint${quickAdd.trim() ? ' lit' : ''}`}>↵</span>
      </footer>

      {/* toast (5.1) */}
      {toastText && (
        <div className="toast show" role="status">
          <span>{toastText}</span>
        </div>
      )}
    </div>
  )
}

function notifTypeLabel(kind: string, title: string): string {
  if (kind === 'reminder') return '到期提醒'
  if (kind === 'brief') return title.startsWith('☀') ? '早报' : title.startsWith('🌙') ? '晚报' : '简报'
  return '通知'
}

function FilterRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }): JSX.Element {
  return (
    <div className="mrow" onClick={onToggle} role="checkbox" aria-checked={on} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}>
      <span className={`ck${on ? ' on' : ''}`}><IcCheck size={10} /></span>
      {label}
    </div>
  )
}

function TodoRowView({ t, busy, completing, onComplete, onAct, onEdit, onChat }: {
  t: YoloTodoRow
  busy: boolean
  completing: boolean
  onComplete: () => void
  onAct: (action: string, extra?: { due_at?: string }) => void
  onEdit: () => void
  onChat: () => void
}): JSX.Element {
  const open = isTodoOpen(t.status)
  const done = !open
  const isUrgent = t.priority === 'urgent'
  const showFlag = isUrgent || t.priority === 'high'
  const rowCls = [
    'row',
    t.overdue && open ? ' overdue' : '',
    t.status === 'in_progress' ? ' inprog' : '',
    completing ? ' retire' : '',
    done ? ' done-row' : '',
  ].join('')
  return (
    <div className={rowCls}>
      <button
        type="button"
        className={`ctl${done || completing ? ' done' : ''}`}
        onClick={() => { if (open) onComplete() }}
        aria-label={open ? `完成：${t.title}` : `已完成：${t.title}`}
        title={open ? '标记完成' : '已完成'}
      >
        <IcCheck size={9} />
      </button>
      <div className="row-main">
        <div className="row-title" title={t.title}>
          {showFlag && <IcFlag size={12} className={isUrgent ? 'urgent' : undefined} />}
          <span className={`tt${done ? ' done' : ''}`}>{t.title}</span>
          {t.status === 'in_progress' && <span className="inprog-tag">进行中</span>}
        </div>
        <div className="row-meta">
          <span className="due">{fmtDue(t.due_at)}</span>
          {open && t.overdue && <span style={{ color: 'var(--y-danger-text)' }}>逾期</span>}
          {open && t.stale && (
            <>
              <span className="sep">·</span>
              <span>{untouchedDays(t)} 天未动</span>
            </>
          )}
          {t.milestone_title && (
            <>
              <span className="sep">·</span>
              <span>{t.milestone_title}</span>
            </>
          )}
          {t.session_label && (
            <span className="src" title={t.session_label}>
              <IcPin size={11} />
              <span>{t.session_label}</span>
            </span>
          )}
        </div>
      </div>
      {open && (
        <div className="row-acts">
          <button type="button" className="act" disabled={busy} title="标记完成" aria-label="标记完成" onClick={onComplete}><IcCheck size={14} /></button>
          <button type="button" className="act" disabled={busy} title={`推迟到 ${nextDayStr(t.due_at)}`} aria-label="推迟一天" onClick={() => { onAct('postpone', { due_at: nextDayStr(t.due_at) }) }}><IcPlusDay size={14} /></button>
          <button type="button" className="act" disabled={busy} title="编辑" aria-label="编辑" onClick={onEdit}><IcDots size={14} /></button>
          <button type="button" className="act" disabled={busy} title="聊一聊" aria-label="聊一聊" onClick={onChat}><IcChat size={14} /></button>
        </div>
      )}
    </div>
  )
}

function TodoEditor({ draft, milestones, busy, confirming, onChange, onSave, onCancel, onDelete, onConfirmDelete }: {
  draft: EditorDraft
  milestones: readonly string[]
  busy: boolean
  confirming: boolean
  onChange: (d: EditorDraft) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  onConfirmDelete: () => void
}): JSX.Element {
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
    }
  }
  return (
    <div className="row editing">
      <div className="edit-form" onKeyDown={onKey}>
        <input
          autoFocus
          className="ef-input ef-title"
          value={draft.title}
          onChange={(e) => { onChange({ ...draft, title: e.target.value }) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSave() }}
        />
        <input type="date" className="ef-input ef-date" value={draft.due} onChange={(e) => { onChange({ ...draft, due: e.target.value }) }} />
        <select className="ef-sel" value={draft.priority} onChange={(e) => { onChange({ ...draft, priority: e.target.value }) }}>
          <option value="">优先级</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="urgent">urgent</option>
        </select>
        <select className="ef-sel" value={draft.milestoneTitle} onChange={(e) => { onChange({ ...draft, milestoneTitle: e.target.value }) }}>
          <option value="">无里程碑</option>
          {milestones.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost ef-btn" disabled={busy} onClick={onSave}>保存</button>
        <button type="button" className="btn btn-ghost ef-btn" disabled={busy} onClick={onCancel}>取消</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-danger ef-btn" disabled={busy} onClick={onDelete}>删除…</button>
        {confirming && (
          <div className="confirm-strip" role="dialog" aria-label="确认删除">
            <span style={{ flex: 1 }}>确认删除这条待办？（写入审计事件，可追溯）</span>
            <button type="button" className="btn btn-danger ef-btn" disabled={busy} onClick={onConfirmDelete}>删除</button>
            <button type="button" className="btn btn-ghost ef-btn" onClick={onDelete}>取消</button>
          </div>
        )}
      </div>
    </div>
  )
}

function GoalBlock({ goal, milestones, renaming, renameValue, busy, onRenameStart, onRenameChange, onRenameSave, onRenameCancel, onAbandon, onMsDot, msPopId }: {
  goal: YoloDashboardData['goals'][number]
  milestones: YoloMilestoneRow[]
  renaming: boolean
  renameValue: string
  busy: boolean
  onRenameStart: () => void
  onRenameChange: (v: string) => void
  onRenameSave: () => void
  onRenameCancel: () => void
  onAbandon: () => void
  onMsDot: (m: YoloMilestoneRow, x: number) => void
  msPopId: string | null
}): JSX.Element {
  const pct = Math.max(0, Math.min(100, goal.progress))
  return (
    <div className="goal">
      <div className="goal-head">
        {renaming ? (
          <input
            autoFocus
            className="goal-name-input"
            value={renameValue}
            onChange={(e) => { onRenameChange(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) onRenameSave()
              if (e.key === 'Escape') { e.stopPropagation(); onRenameCancel() }
            }}
          />
        ) : (
          <button type="button" className="goal-name" title="点击改名" onClick={onRenameStart}>{goal.title}</button>
        )}
        <span className="goal-pct">{pct}%</span>
        <button type="button" className="nact" disabled={busy} title="放弃该目标（进度来自对话陈述，只读）" onClick={onAbandon}>放弃</button>
      </div>
      <div className="goal-track">
        <div className="goal-fill" style={{ width: `${pct}%` }} />
        {milestones.map((m) => {
          const x = dotPos(m.target_date)
          return (
            <button
              key={m.id}
              type="button"
              className={`ms-dot${m.status === 'done' ? ' done' : m.status === 'active' ? ' active' : ''}${msPopId === m.id ? ' hl' : ''}`}
              style={{ left: `${x}%` }}
              title={m.title}
              onClick={() => { onMsDot(m, x) }}
            >
              <span className="ms-label"><b>{m.title}</b><i>{m.target_date ? m.target_date.slice(5, 10) : ''}</i></span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Shared time axis for open milestones that no active goal carries (5.5). */
function MilestoneTrack({ milestones, renaming, busyKey, pop, onDot, onRenameStart, onRenameChange, onRenameSave, onRenameCancel, onStatus, onPopClose }: {
  milestones: YoloMilestoneRow[]
  renaming: { id: string; title: string } | null
  busyKey: string | null
  pop: { id: string; x: number } | null
  onDot: (m: YoloMilestoneRow, x: number) => void
  onRenameStart: (m: YoloMilestoneRow) => void
  onRenameChange: (v: string) => void
  onRenameSave: (m: YoloMilestoneRow) => void
  onRenameCancel: () => void
  onStatus: (m: YoloMilestoneRow, status: string) => void
  onPopClose: () => void
}): JSX.Element {
  const target = milestones.find((m) => m.id === pop?.id)
  return (
    <div className="goal" style={{ borderBottom: 'none' }}>
      <div className="goal-head">
        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--y-text-3)' }}>里程碑</span>
      </div>
      <div className="goal-track">
        {milestones.map((m) => {
          const x = dotPos(m.target_date)
          return (
            <button
              key={m.id}
              type="button"
              className={`ms-dot${m.status === 'done' ? ' done' : m.status === 'active' ? ' active' : ''}${pop?.id === m.id ? ' hl' : ''}`}
              style={{ left: `${x}%` }}
              title={m.title}
              onClick={() => { onDot(m, x) }}
            >
              <span className="ms-label"><b>{m.title}</b><i>{m.target_date ? m.target_date.slice(5, 10) : ''}</i></span>
            </button>
          )
        })}
        {target && pop && (
          <div className="ms-pop" style={{ '--x': `${pop.x}%` } as React.CSSProperties}>
            {renaming?.id === target.id ? (
              <input
                autoFocus
                value={renaming.title}
                onChange={(e) => { onRenameChange(e.target.value) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) onRenameSave(target)
                  if (e.key === 'Escape') { e.stopPropagation(); onRenameCancel() }
                }}
              />
            ) : (
              <input
                value={target.title}
                title="点击改名"
                onFocus={() => { onRenameStart(target) }}
                onChange={() => { /* controlled rename starts on focus */ }}
                readOnly
              />
            )}
            <div className="ms-pop-row">
              {(['planned', 'active', 'done', 'abandoned'] as const).map((st) => (
                <button key={st} type="button" className={`ms-st${target.status === st ? ' on' : ''}`} disabled={busyKey === `ms-${target.id}`} onClick={() => { onStatus(target, st) }}>
                  {MS_STATUS_LABEL[st]}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost ef-btn" style={{ width: '100%', marginTop: 4 }} onClick={onPopClose}>关闭</button>
          </div>
        )}
      </div>
    </div>
  )
}

const MS_STATUS_LABEL: Record<string, string> = {
  planned: '计划',
  active: '进行',
  done: '完成',
  abandoned: '放弃',
}
