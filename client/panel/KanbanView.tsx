// YOLO kanban faces — v5「宿主原生」drawer (frontend-redesign-v5-native.md §四).
// The panel is a drawer from the host sidebar's right edge; its face switching
// is a horizontal tab bar owned by the shell (YoloPanel). This component
// renders the ACTIVE face (今日 / 即将 / 已完成 / 目标 / 台账) inside one
// independently-scrolling body. All filtering/bucketing stays in the shared
// pure functions (src/shared/filters.ts); every mutation goes through
// POST /yolo/actions so a click and a chat reply produce identical transitions
// + audit events.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { YoloDashboardData, YoloMilestoneRow, YoloTodoRow } from '../../src/shared/dashboard.ts'
import { isTodoOpen } from '../../src/shared/dashboard.ts'
import {
  applyKanbanFilter,
  dueBucket,
  focusCounts,
  hasDetailFilter,
  partitionFocusRows,
  sortForKanban,
  type FocusBucket,
  type KanbanFilter,
} from '../../src/shared/filters.ts'
import { localDateStr } from '../../src/shared/text.ts'
import {
  IcBell, IcChat, IcCheck, IcChevron, IcDots, IcFlag, IcPin, IcPlusDay,
} from '../design/icons.tsx'
import type { ChatAnchor } from './ChatPane.tsx'
import { CaptureBar } from './CaptureBar.tsx'
import { DayHero } from './DayHero.tsx'
import type { ViewKey } from './ViewTabs.tsx'

export interface KanbanViewProps {
  data: YoloDashboardData
  refresh: () => Promise<void>
  /** The persisted kanban filter (owned by the shell). */
  filter: KanbanFilter
  patchFilter: (patch: Partial<KanbanFilter>) => void
  /** Active horizontal view tab. */
  view: ViewKey
  /** Switch the view (e.g. quick-add lands on 今日). */
  onViewChange: (view: ViewKey) => void
  /** Open the side chat anchored to a card (聊一聊). */
  onOpenChat: (anchor: ChatAnchor) => void
  /** Jump to a dsh session (ledger source badges); optional. */
  openSession?: (sessionId: string) => void
  /** Increments when the header bell jumps to today's notification cards. */
  notifFocusTick?: number
}

interface EditorDraft {
  id: string
  title: string
  due: string
  priority: string
  milestoneTitle: string
}

const DAY_MS = 86_400_000

/** Notification cards preview before a 查看全部 inbox fold (5.3, P0-1). */
const NOTIF_PREVIEW = 4

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

interface Section {
  key: string
  label: string
  danger: boolean
  accent: boolean
  rows: YoloTodoRow[]
}

interface Buckets {
  overdue: YoloTodoRow[]
  today: YoloTodoRow[]
  week: YoloTodoRow[]
  stale: YoloTodoRow[]
}

/** Bucket open rows by due date. By default stale rows leave for their own
 *  bucket (the 即将 face's 滞留 section). The 今日 face opts OUT: a stale row
 *  still has a due bucket, and hiding it there made the hero/胶囊 counts show
 *  rows the list did not — an all-stale day rendered a blank board with no
 *  empty state (v0.3.3 review fix; undated rows never reach this face). */
function partitionRows(rows: readonly YoloTodoRow[], opts: { splitStale?: boolean } = {}): Buckets {
  const out: Buckets = { overdue: [], today: [], week: [], stale: [] }
  for (const t of rows) {
    if (opts.splitStale !== false && t.stale) { out.stale.push(t); continue }
    const b = dueBucket(t)
    if (b === 'overdue') out.overdue.push(t)
    else if (b === 'today') out.today.push(t)
    else out.week.push(t)
  }
  return out
}

function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Relative "due" label for a reminder card header (5.3). */
function dueMomentLabel(iso: string): string {
  const day = iso.slice(0, 10)
  const today = localDateStr()
  const time = iso.length > 10 ? ` ${iso.slice(11, 16)}` : ''
  if (day < today) {
    const diff = Math.round((new Date(`${today}T00:00:00`).getTime() - new Date(`${day}T00:00:00`).getTime()) / DAY_MS)
    return `逾期 ${diff} 天`
  }
  return fmtDue(iso) || `${day}${time}`
}

/** Local "M/D HH:MM" label for brief cards (they are dated, not due-ranked). */
function localDayLabel(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(ms)}`
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

/** Done-slot text「完成 HH:MM」for completed rows (5.4). */
function fmtDone(epochMs: number): string {
  const d = new Date(epochMs)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `完成 ${hh}:${mm}`
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

function notifTypeLabel(kind: string, title: string): string {
  if (kind === 'reminder') return '到期提醒'
  if (kind === 'brief') return title.startsWith('☀') ? '早报' : title.startsWith('🌙') ? '晚报' : '简报'
  return '通知'
}

const noop = (): void => {}

export function KanbanView({ data, refresh, filter, patchFilter, view, onViewChange, onOpenChat, openSession, notifFocusTick = 0 }: KanbanViewProps): JSX.Element {
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [completing, setCompleting] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ text: string; undo?: YoloTodoRow } | null>(null)
  const [editor, setEditor] = useState<EditorDraft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [quickBusy, setQuickBusy] = useState(false)
  const [notifShowAll, setNotifShowAll] = useState(false)
  const [foldedOpen, setFoldedOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState<{ kind: 'goal' | 'milestone'; id: string; title: string } | null>(null)
  const [msPop, setMsPop] = useState<{ id: string; x: number } | null>(null)
  // v0.3.2: completion/处理 animations — rows retire with a height collapse
  // before being removed, so nothing "jumps" out of the board.
  const [retiring, setRetiring] = useState<YoloTodoRow[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)

  // Toast auto-retire (5.1): 2.4s; completion toasts hold the 4s undo window (5.4).
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => { setToast(null) }, toast.undo ? 4_000 : 2_400)
    return () => { window.clearTimeout(t) }
  }, [toast])

  // Each face scrolls independently: switching tabs starts at the top.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [view])

  // The header bell jumps to today's notification cards.
  useEffect(() => {
    if (notifFocusTick > 0 && view === 'today') notifRef.current?.scrollIntoView({ block: 'start' })
  }, [notifFocusTick, view])

  // Map every board row to its owning workspace cwd so an action on an
  // all-workspaces row routes to that scope (the board is always scope=all).
  const wsCwdById = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of data.todos) if (t.ws?.cwd) m.set(t.id, t.ws.cwd)
    for (const g of data.goals) if (g.ws?.cwd) m.set(g.id, g.ws.cwd)
    for (const ms of data.milestones) if (ms.ws?.cwd) m.set(ms.id, ms.ws.cwd)
    for (const n of data.notifications) if (n.ws?.cwd) m.set(n.id, n.ws.cwd)
    return m
  }, [data])

  const act = useCallback(
    async (key: string, body: Record<string, unknown>): Promise<boolean> => {
      setBusyKey(key)
      setActionError(null)
      try {
        const payload = { ...body }
        const scopeCwd = wsCwdById.get(String(body.id))
        if (scopeCwd) payload.scope_cwd = scopeCwd
        const r = await fetch('/yolo/actions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
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
    [refresh, wsCwdById],
  )

  // Complete flow (5.4): optimistic fill + retire, POST, refresh, toast with undo.
  const completeTodo = useCallback(async (t: YoloTodoRow): Promise<void> => {
    setCompleting((s) => { const n = new Set(s); n.add(t.id); return n })
    const ok = await act(t.id, { action: 'complete', kind: 'todo', id: t.id })
    setCompleting((s) => { const n = new Set(s); n.delete(t.id); return n })
    if (ok) {
      const snapshot = { ...t }
      setRetiring((r) => [...r, snapshot])
      window.setTimeout(() => { setRetiring((r) => r.filter((x) => x.id !== snapshot.id)) }, 520)
      setToast({ text: `已完成 · ${t.title}`, undo: t })
    }
  }, [act])

  // Undo of complete (5.4, 4s window): reopen restores the row.
  const undoComplete = useCallback(async (t: YoloTodoRow): Promise<void> => {
    setToast(null)
    const ok = await act(`reopen-${t.id}`, { action: 'reopen', kind: 'todo', id: t.id })
    if (ok) {
      setRetiring((r) => r.filter((x) => x.id !== t.id))
      setToast({ text: `已撤销 · ${t.title}` })
    }
  }, [act])

  const counts = useMemo(() => focusCounts(data.todos), [data.todos])
  const milestoneTitles = useMemo(() => data.milestones.map((m) => m.title), [data.milestones])

  // Per-face filtered sets — the shared filter functions stay the source of
  // truth: the face only picks the preset the tab maps to.
  const visibleToday = useMemo(
    () => sortForKanban(applyKanbanFilter(data.todos, { ...filter, preset: 'today' })),
    [data.todos, filter],
  )
  const visibleUpcoming = useMemo(
    () => sortForKanban(applyKanbanFilter(data.todos, { ...filter, preset: 'all' })),
    [data.todos, filter],
  )
  const visibleDone = useMemo(
    () => sortForKanban(applyKanbanFilter(data.todos, { ...filter, preset: 'done' })),
    [data.todos, filter],
  )

  // R9: cap the default today face to the top-N focus rows; the rest fold away
  // so a busy board opens quiet. Only when no detail filter is engaged.
  const defaultFilterOnly = view === 'today' && !hasDetailFilter(filter)
  const { focus, folded } = useMemo(
    () => (defaultFilterOnly ? partitionFocusRows(visibleToday, data.focusDefaultCount ?? 0) : { focus: visibleToday, folded: [] }),
    [visibleToday, defaultFilterOnly, data.focusDefaultCount],
  )

  const retiringToShowToday = useMemo(
    () => retiring.filter((t) => !visibleToday.some((v) => v.id === t.id)),
    [retiring, visibleToday],
  )
  const retiringToShowUpcoming = useMemo(
    () => retiring.filter((t) => !visibleUpcoming.some((v) => v.id === t.id)),
    [retiring, visibleUpcoming],
  )

  const todaySections = useMemo<Section[]>(() => {
    // splitStale:false — the 今日 face buckets stale rows by their due date so
    // the visible rows match the hero/胶囊 counts (stale keeps its「N 天未动」tag).
    const p = partitionRows(focus, { splitStale: false })
    for (const t of retiringToShowToday) {
      if (t.stale) p.stale.push(t)
      else if (dueBucket(t) === 'overdue') p.overdue.push(t)
      else if (dueBucket(t) === 'today') p.today.push(t)
      else p.week.push(t)
    }
    return [
      { key: 'overdue', label: '已逾期', danger: true, accent: false, rows: p.overdue },
      { key: 'today', label: '今天', danger: false, accent: true, rows: p.today },
    ].filter((s) => s.rows.length > 0)
  }, [focus, retiringToShowToday])

  const upcomingSections = useMemo<Section[]>(() => {
    const p = partitionRows(visibleUpcoming)
    for (const t of retiringToShowUpcoming) {
      if (t.stale) p.stale.push(t)
      else if (dueBucket(t) === 'week') p.week.push(t)
      else if (dueBucket(t) === 'overdue' || dueBucket(t) === 'today') { /* stays in today's face */ }
      else p.week.push(t)
    }
    return [
      { key: 'week', label: '未来 7 天', danger: false, accent: false, rows: p.week },
      { key: 'stale', label: '滞留', danger: false, accent: false, rows: p.stale },
    ].filter((s) => s.rows.length > 0)
  }, [visibleUpcoming, retiringToShowUpcoming])

  const openNotifications = data.notifications.filter((n) => !n.handled)
  const activeGoals = data.goals.filter((g) => g.status === 'active')
  const openMilestones = data.milestones.filter((m) => m.status === 'planned' || m.status === 'active')
  const avgGoalPct = Math.round(activeGoals.reduce((a, g) => a + g.progress, 0) / Math.max(activeGoals.length, 1))

  const patch = useCallback((p: Partial<KanbanFilter>) => { patchFilter(p) }, [patchFilter])

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

  const sendQuickAdd = useCallback(async (text: string): Promise<boolean> => {
    if (quickBusy) return false
    setQuickBusy(true)
    const ok = await act('quick-add', { action: 'quick_add', kind: 'todo', title: text })
    if (ok) {
      setToast({ text: '已记下 · 今日到期' })
      onViewChange('today')
    }
    setQuickBusy(false)
    return ok
  }, [act, quickBusy, onViewChange])

  const rowActions = (t: YoloTodoRow): { onComplete: () => void; onAct: (action: string, extra?: { due_at?: string }) => void; onEdit: () => void; onChat: () => void } => ({
    onComplete: () => { void completeTodo(t) },
    onAct: (action, extra) => { void act(t.id, { action, kind: 'todo', id: t.id, ...extra }) },
    onEdit: () => { setEditor({ id: t.id, title: t.title, due: dayOf(t.due_at), priority: t.priority ?? '', milestoneTitle: t.milestone_title ?? '' }) },
    onChat: () => { onOpenChat({ title: t.title, detail: t.due_at ? `到期 ${t.due_at}` : null }) },
  })

  const renderRow = (t: YoloTodoRow, opts: { retiring?: boolean } = {}): JSX.Element => (
    editor?.id === t.id ? (
      <TodoEditor
        key={t.id}
        draft={editor}
        milestones={milestoneTitles}
        busy={busyKey === `edit-${t.id}` || busyKey === `del-${t.id}`}
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
        retiring={opts.retiring}
        {...rowActions(t)}
      />
    )
  )

  const renderSection = (s: Section, opts: { retiringIds: Set<string> }): JSX.Element => (
    <section key={s.key} className={`sec${s.danger ? ' danger' : ''}${s.accent ? ' today' : ''}`} aria-label={`${s.label} ${s.rows.length}`}>
      <div className="sec-head">
        <span className="sec-name"><span className="dot" />{s.label}</span>
        <span className={`sec-count${s.danger ? ' danger' : ''}`}>{s.rows.length}</span>
        <span className="sec-rule" />
      </div>
      {s.rows.map((t) => renderRow(t, { retiring: opts.retiringIds.has(t.id) }))}
    </section>
  )

  const caps = (
    <div className="caps" role="group" aria-label="聚焦筛选">
      {(Object.keys(FOCUS_LABEL) as FocusBucket[]).map((k) => (
        <button
          key={k}
          type="button"
          className={`cap${filter.focus === k ? ' on' : ''}`}
          onClick={() => { patch({ focus: filter.focus === k ? null : k }) }}
        >
          {FOCUS_LABEL[k]} <span className="num">{counts[k]}</span>
        </button>
      ))}
    </div>
  )

  const notifCards = (
    <div ref={notifRef} style={{ marginTop: 12 }}>
      {(notifShowAll ? openNotifications : openNotifications.slice(0, NOTIF_PREVIEW)).map((n) => {
        const dueFor = n.kind === 'reminder' && n.todo_id ? data.todos.find((td) => td.id === n.todo_id) : undefined
        const timeLabel = dueFor?.due_at ? dueMomentLabel(dueFor.due_at) : n.kind === 'brief' ? localDayLabel(n.created_at) : fmtTime(n.created_at)
        return (
          <div key={n.id} className={`notif${n.kind === 'reminder' ? ' reminder' : ''}`}>
            <div className="notif-head">
              <IcBell size={13} />
              <span className="notif-type">{notifTypeLabel(n.kind, n.title)}</span>
              <span className="notif-time mono">{timeLabel}</span>
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
                  <button type="button" className="nact" disabled={busyKey === `n-${n.id}`} onClick={() => { void act(`n-${n.id}`, { action: 'postpone', kind: 'todo', id: n.todo_id, due_at: nextDayStr(dueFor?.due_at ?? null) }) }}>
                    <IcPlusDay size={12} />+1d
                  </button>
                  <button type="button" className="nact" disabled={busyKey === `n-${n.id}`} onClick={() => { void act(`n-${n.id}`, { action: 'remind_again', kind: 'todo', id: n.todo_id }) }}>
                    <IcBell size={12} />再提醒
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
        )
      })}
      {openNotifications.length > NOTIF_PREVIEW && (
        <button type="button" className="notif-more" onClick={() => { setNotifShowAll((v) => !v) }}>
          {notifShowAll ? '收起' : `查看全部 ${openNotifications.length} 条`}
          <IcChevron size={10} className={notifShowAll ? 'up' : ''} />
        </button>
      )}
    </div>
  )

  const retiringToday = useMemo(() => new Set(retiringToShowToday.map((t) => t.id)), [retiringToShowToday])
  const retiringUpcoming = useMemo(() => new Set(retiringToShowUpcoming.map((t) => t.id)), [retiringToShowUpcoming])

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <CaptureBar busy={quickBusy} onSubmit={sendQuickAdd} />
      <div className="p-body" ref={bodyRef}>
        <main className="p-main">
          {actionError && (
            <div className="err-line">
              <span>操作失败：{actionError}</span>
              <button type="button" className="nact" onClick={() => { setActionError(null) }}>关闭</button>
            </div>
          )}

          {view === 'today' && (
            <>
              <DayHero todayCount={counts.today} overdueCount={counts.overdue} />
              {caps}
              {openNotifications.length > 0 && notifCards}
              {todaySections.map((s) => renderSection(s, { retiringIds: retiringToday }))}

              {folded.length > 0 && (
                <div className={`fold${foldedOpen ? ' open' : ''}`}>
                  <button type="button" className="fold-head" onClick={() => { setFoldedOpen((v) => !v) }} aria-expanded={foldedOpen}>
                    <IcChevron size={12} />
                    <span>其余 {folded.length} 条</span>
                    <span className="fold-stat">展开查看</span>
                  </button>
                  <div className="fold-body">
                    <div className="fold-inner">
                      <div className="fold-pad">
                        {folded.map((t) => renderRow(t))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {visibleToday.length === 0 && (
                <div className="empty">
                  <h4>今天没有挂起的事</h4>
                  <p>说一句，我来记下</p>
                </div>
              )}
            </>
          )}

          {view === 'upcoming' && (
            <>
              <div className="heading"><h2>即将</h2><span className="hint">未来 7 天与更远</span></div>
              {caps}
              {upcomingSections.map((s) => renderSection(s, { retiringIds: retiringUpcoming }))}
              {visibleUpcoming.length === 0 && (
                <div className="empty">
                  <h4>没有即将到来的事</h4>
                  <p>未来 7 天这里会是空的。</p>
                </div>
              )}
            </>
          )}

          {view === 'done' && (
            <>
              <div className="heading"><h2>已完成</h2><span className="hint">{visibleDone.length} 件</span></div>
              {visibleDone.length === 0 ? (
                <div className="empty">
                  <h4>还没有完成的事</h4>
                  <p>完成的待办会出现在这里。</p>
                </div>
              ) : (
                <div className="sec">
                  {visibleDone.map((t) => (
                    <TodoRowView key={t.id} t={t} busy={false} completing={false} onComplete={noop} onAct={noop} onEdit={noop} onChat={noop} />
                  ))}
                </div>
              )}
            </>
          )}

          {view === 'goals' && (
            <>
              <div className="heading"><h2>目标与里程碑</h2><span className="hint">{activeGoals.length} 目标 · 平均 {avgGoalPct}% · 进度只读</span></div>
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
                <div className="empty">
                  <h4>暂无进行中的目标</h4>
                  <p>目标与里程碑会出现在这里（进度只读）。</p>
                </div>
              )}
            </>
          )}

          {view === 'ledger' && (
            <>
              <div className="heading">
                <h2>今日台账</h2>
                <span className="hint">{data.ledger.length} 条 · {data.ledgerSessions} 会话 · 点会话标签跳回</span>
              </div>
              {data.ledger.length === 0 ? (
                <div className="empty">
                  <h4>今天还没有记录</h4>
                  <p>所有动作都会写进台账。</p>
                </div>
              ) : (
                <div style={{ marginTop: 8 }}>
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
              )}
            </>
          )}
        </main>
      </div>

      {/* toast (5.1); completion toast carries 撤销 (5.4) */}
      {toast && (
        <div className="toast show" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" onClick={() => { void undoComplete(toast.undo as YoloTodoRow) }}>撤销</button>
          )}
        </div>
      )}
    </div>
  )
}

function TodoRowView({ t, busy, completing, retiring, onComplete, onAct, onEdit, onChat }: {
  t: YoloTodoRow
  busy: boolean
  completing: boolean
  retiring?: boolean
  onComplete: () => void
  onAct: (action: string, extra?: { due_at?: string }) => void
  onEdit: () => void
  onChat: () => void
}): JSX.Element {
  const open = isTodoOpen(t.status)
  const done = !open
  const isUrgent = t.priority === 'urgent'
  const showFlag = isUrgent || t.priority === 'high'
  const isRetiring = retiring === true
  // Keyboard navigation within a section: ↑/↓ move focus between rows.
  const navRow = (dir: 1 | -1): void => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.yolo-scope .sec .row[data-kb-row="1"]'))
    const idx = rows.indexOf(document.activeElement as HTMLElement)
    const next = rows[(idx + dir + rows.length) % rows.length]
    next?.focus()
  }
  const rowCls = [
    'row',
    t.overdue && open ? ' overdue' : '',
    t.status === 'in_progress' ? ' inprog' : '',
    completing ? ' retire' : '',
    isRetiring ? ' retiring' : '',
    done ? ' done-row' : '',
  ].join('')
  return (
    <div
      className={rowCls}
      data-kb-row={open && !isRetiring ? '1' : undefined}
      role="listitem"
      tabIndex={open && !isRetiring ? 0 : undefined}
      aria-label={open ? `任务：${t.title}` : `已完成：${t.title}`}
      onKeyDown={(e) => {
        if (isRetiring || !open) return
        // Only the ROW itself owns Space/Enter/E/↑/↓. When focus sits on a
        // child control (✓/+1d/编辑/聊一聊), let the key activate THAT control
        // — without this guard, Space on 「聊一聊」 completed the todo.
        if (e.target !== e.currentTarget) return
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onComplete() }
        else if (e.key.toLowerCase() === 'e') { e.preventDefault(); onEdit() }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); navRow(e.key === 'ArrowDown' ? 1 : -1) }
      }}
    >
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
          <span className="due">{done && t.completed_at ? fmtDone(t.completed_at) : fmtDue(t.due_at)}</span>
          {open && t.overdue && <span style={{ color: 'var(--y-danger)' }}>逾期</span>}
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
          {t.belief && t.belief.stale >= 2 && t.belief.stale > t.belief.good && (
            <>
              <span className="sep">·</span>
              <span className="stale-tag" title="这条待办多次被取消/搁置——考虑它是否真的需要跟进">常忘</span>
            </>
          )}
        </div>
      </div>
      {open && !isRetiring && (
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
            <button type="button" className="btn btn-ghost ef-btn" onClick={onCancel}>取消</button>
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
