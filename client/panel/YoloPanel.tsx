// YOLO panel shell — v5「宿主原生」drawer (frontend-redesign-v5-native.md).
// YOLO is a first-class surface of the dsh host: a drawer from the sidebar's
// right edge with a horizontal tab bar (今日/即将/已完成/目标/台账), a
// capture-first command bar, and a chat surface in two sizes (side 340px dock
// ↔ full). Esc unwinds fullscreen → side chat → closed. Narrow panels (<480px)
// open the chat full-screen directly. Filter + side-chat visibility persist
// across close/reopen via panel/state.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { YoloDashboardData } from '../../src/shared/dashboard.ts'
import { isTodoOpen } from '../../src/shared/dashboard.ts'
import {
  DEFAULT_FILTER,
  focusCounts,
  hasDetailFilter,
  matchRangePreset,
  rangeLabel,
  rangeOfPreset,
  type KanbanFilter,
  type PresetTab,
  type RangePresetKind,
} from '../../src/shared/filters.ts'
import { ensureYoloStyle, detectYoloTheme } from '../design/style.ts'
import { yoloTokens } from '../design/tokens.ts'
import { IcBell, IcChat, IcCheck, IcChevron, IcClose, IcExpand, IcFilter, IcShrink } from '../design/icons.tsx'
import { YoloLogo } from '../YoloLogo.tsx'
import { ChatPane, type ChatAnchor } from './ChatPane.tsx'
import { KanbanView } from './KanbanView.tsx'
import { MoreMenu } from './MoreMenu.tsx'
import { ViewTabs, type ViewKey } from './ViewTabs.tsx'
import { readPanelState, writePanelState } from './state.ts'

export interface YoloPanelProps {
  /** Panel left edge (the sidebar's right edge) — spans to the viewport right. */
  left: number
  onClose: () => void
  /** Jump to a dsh session (ledger source badges); no-op when unavailable. */
  openSession?: (sessionId: string) => void
  /** Host-owned durable theme preference. Optional only for isolated renders. */
  themeControl?: { set: (theme: 'dark' | 'light') => void }
}

interface LoadState {
  loading: boolean
  error: string | null
  data: YoloDashboardData | null
}

/** Stable business signature; response time alone must not trigger the sweep. */
export function dashboardSignature(d: YoloDashboardData): string {
  return JSON.stringify({
    contract: d.ui_contract_version ?? 1,
    todos: d.todos.map((row) => [row.ws?.slug, row.id, row.status, row.due_at, row.priority, row.updated_at, row.completed_at]),
    attention: (d.attention ?? []).map((row) => [row.id, row.evidence_fingerprint, row.seen_at, row.suppressed_until]),
    notifications: d.notifications.map((row) => [row.ws?.slug, row.id, row.handled, row.created_at]),
    ledger: d.ledger.map((row) => [row.ws?.slug, row.id, row.kind, row.occurred_at]),
    goals: d.goals.map((row) => [row.ws?.slug, row.id, row.progress, row.status]),
    milestones: d.milestones.map((row) => [row.ws?.slug, row.id, row.status, row.target_date]),
    partial: d.summary?.partial ?? false,
    workspaceErrors: d.workspaceErrors ?? [],
  })
}

/** Map the persisted preset back to a view face; 'all' lands on 今日 (Today-first). */
function viewFromPreset(p: PresetTab): ViewKey {
  return p === 'today' ? 'today' : p === 'done' ? 'done' : 'today'
}

/** The view face a tab maps to as a filter preset (persisted across reopen). */
function presetForView(v: ViewKey): PresetTab {
  return v === 'today' ? 'today' : v === 'done' ? 'done' : 'all'
}

const VIEW_LABELS: Record<ViewKey, string> = {
  today: '今天',
  upcoming: '即将',
  done: '已完成',
  goals: '目标与里程碑',
  ledger: '今日台账',
}

export function YoloPanel({ left, onClose, openSession, themeControl }: YoloPanelProps): JSX.Element {
  ensureYoloStyle()
  const [theme, setTheme] = useState<'dark' | 'light'>(() => detectYoloTheme())

  const [state, setState] = useState<LoadState>({ loading: true, error: null, data: null })
  const initial = useMemo(() => readPanelState(), [])
  const [filter, setFilter] = useState<KanbanFilter>(initial.filter)
  const [view, setViewState] = useState<ViewKey>(() => viewFromPreset(initial.filter.preset))
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [notifFocusTick, setNotifFocusTick] = useState(0)
  const [sideChatOpen, setSideChatOpen] = useState(initial.sideChatOpen)
  const [chatFullscreen, setChatFullscreen] = useState(false)
  const [anchor, setAnchor] = useState<ChatAnchor | null>(null)
  // v0.3.2 聊一聊: a FRESH ephemeral thread per anchored chat. A new key per
  // anchored episode, reset on close/switch, so the pane never inherits the
  // resident thread's history; the unanchored 对话 keeps the resident thread.
  const [chatThread, setChatThread] = useState<string | undefined>(undefined)
  const [sweepTick, setSweepTick] = useState(0)
  const lastSig = useRef<string | null>(null)
  const fltBtnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Panel width → Compact gear (<480px: chat opens full-screen).
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1000 : Math.max(0, window.innerWidth - left)))
  useEffect(() => {
    const on = (): void => { setWidth(Math.max(0, window.innerWidth - left)) }
    window.addEventListener('resize', on)
    return () => { window.removeEventListener('resize', on) }
  }, [left])
  const compact = width < yoloTokens.compactBreakpoint

  // Follow host theme changes while the panel is mounted. The More menu uses
  // the same body attribute contract as the host theme presenter, so the
  // target-theme label and native control color-scheme stay in sync.
  useEffect(() => {
    const body = document.body
    const sync = (): void => { setTheme(body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light') }
    const observer = new MutationObserver(sync)
    observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => { observer.disconnect() }
  }, [])

  const toggleTheme = useCallback((): void => {
    const next = document.body.hasAttribute('data-ds-dark-theme') ? 'light' : 'dark'
    if (themeControl) themeControl.set(next)
    else document.body.toggleAttribute('data-ds-dark-theme', next === 'dark')
    setTheme(next)
  }, [themeControl])

  const load = useCallback(async (): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      // v0.3.3: always the all-workspaces board — no 当前/全部 toggle.
      const r = await fetch('/yolo/dashboard?scope=all', { headers: { accept: 'application/json' }, cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as YoloDashboardData
      const sig = dashboardSignature(data)
      if (lastSig.current !== null && sig !== lastSig.current) setSweepTick((t) => t + 1)
      lastSig.current = sig
      setState({ loading: false, error: null, data })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }))
    }
  }, [])

  // v0.3.3: load once on open + on demand; a manual refresh / action re-fetches.
  useEffect(() => { void load() }, [load])

  // Persist view state so reopening keeps the filter and side chat (TA-6).
  useEffect(() => { writePanelState({ filter }) }, [filter])
  useEffect(() => { writePanelState({ sideChatOpen }) }, [sideChatOpen])

  const patchFilter = useCallback((patch: Partial<KanbanFilter>): void => {
    setFilter((f) => ({ ...f, ...patch }))
  }, [])

  const setView = useCallback((v: ViewKey): void => {
    setViewState(v)
    const preset = presetForView(v)
    setFilter((f) => (f.preset === preset ? f : { ...f, preset }))
  }, [])

  // A ledger source jump should land the user back in that session: close the
  // panel so it is actually in view (the overlay otherwise stays covering it).
  const openSessionAndClose = useCallback((id: string): void => {
    openSession?.(id)
    onClose()
  }, [openSession, onClose])

  // Esc unwinds the chat surface: fullscreen → side chat → closed panel.
  const closeSideChat = useCallback(() => {
    setSideChatOpen(false)
    setChatFullscreen(false)
    setAnchor(null)
    setChatThread(undefined)
  }, [])
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (chatFullscreen) setChatFullscreen(false)
      else if (sideChatOpen) closeSideChat()
      else onClose()
    }
    document.addEventListener('keydown', listener)
    return () => { document.removeEventListener('keydown', listener) }
  }, [chatFullscreen, sideChatOpen, closeSideChat, onClose])

  // Filter menu: outside-pointer + Esc close (Esc must not unwind the panel).
  useEffect(() => {
    if (!filterMenuOpen) return
    const first = menuRef.current?.querySelector<HTMLElement>('[tabindex], button, input, select')
    first?.focus()
    const onPointer = (e: PointerEvent): void => {
      const t = e.target as Node | null
      if (!t) return
      if (menuRef.current?.contains(t)) return
      if (fltBtnRef.current?.contains(t)) return
      setFilterMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setFilterMenuOpen(false)
      window.setTimeout(() => { fltBtnRef.current?.focus() }, 0)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [filterMenuOpen])

  const openAnchoredChat = useCallback((a: ChatAnchor) => {
    setAnchor(a)
    setChatThread(`a-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
    setSideChatOpen(true)
  }, [])

  const toggleSideChat = useCallback(() => {
    setAnchor(null)
    setChatThread(undefined)
    setSideChatOpen((v) => !v)
  }, [])

  // One chat surface, two sizes; on compact panels the side pane IS fullscreen.
  const chatShowingFull = chatFullscreen || (sideChatOpen && compact)
  const showSideDock = sideChatOpen && !chatFullscreen && !compact

  // Tab counts — the board's live signals at a glance (raw bucket counts).
  const counts = useMemo(() => {
    const openCounts = state.data ? focusCounts(state.data.todos) : { overdue: 0, today: 0, week: 0, stale: 0 }
    const done = state.data ? state.data.todos.filter((t) => !isTodoOpen(t.status)).length : 0
    return {
      today: openCounts.today,
      upcoming: openCounts.week,
      done,
      goals: state.data?.goals.length ?? 0,
      ledger: state.data?.ledger.length ?? 0,
    }
  }, [state.data])

  const unhandled = state.data?.unhandled ?? 0
  const rangeActive = filter.rangeFrom !== null || filter.rangeTo !== null
  const milestoneTitles = useMemo(() => state.data?.milestones.map((m) => m.title) ?? [], [state.data])

  const d = new Date()
  const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日 · 周${'日一二三四五六'[d.getDay()]}`

  // The board column, extracted so the fullscreen-chat branch can keep it
  // mounted (display:none) instead of unmounting KanbanView and losing
  // editor drafts / the undo window / fold states (v0.3.3 review fix).
  const boardColumn = (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {state.error && state.data === null && (
        <div className="err-line">
          <span>看板加载失败：{state.error}</span>
          <button type="button" className="nact" onClick={() => { void load() }}>重试</button>
        </div>
      )}
      {state.data !== null && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', ...(state.error ? { opacity: 0.6 } : {}) }}>
          <KanbanView
            data={state.data}
            refresh={load}
            filter={filter}
            patchFilter={patchFilter}
            view={view}
            onViewChange={setView}
            onOpenChat={openAnchoredChat}
            openSession={openSessionAndClose}
            notifFocusTick={notifFocusTick}
          />
        </div>
      )}
      {state.data === null && !state.error && (
        <div className="p-main" aria-hidden="true">
          <div className="skel-notif" />
          <div className="skel-head" />
          <div className="skel-row" /><div className="skel-row" /><div className="skel-row" />
          <div className="skel-head" />
          <div className="skel-row" /><div className="skel-row" />
        </div>
      )}
    </div>
  )

  // Filters belong to the todo list context, not to the product-level header.
  // Goals and ledger do not consume the todo filter, so the toolbar disappears
  // on those auxiliary views instead of suggesting a false global scope.
  const listTools = view !== 'goals' && view !== 'ledger' ? (
    <div className="list-tools" aria-label="事项列表工具">
      {rangeActive && (
        <button type="button" className="range-chip" title="按时段筛选生效中，点击清除" onClick={() => { patchFilter({ rangeFrom: null, rangeTo: null }) }}>
          <b>{rangeLabel(filter.rangeFrom, filter.rangeTo)}</b><IcClose size={10} />
        </button>
      )}
      <div className="flt-wrap">
        <button
          ref={fltBtnRef}
          type="button"
          className={`flt${hasDetailFilter(filter) ? ' has-filters' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={filterMenuOpen}
          aria-controls="yolo-list-filter"
          onClick={() => { setFilterMenuOpen((value) => !value) }}
        >
          <IcFilter size={13} />筛选<span className="chev"><IcChevron size={10} /></span><span className="flt-dot" />
        </button>
        <div id="yolo-list-filter" ref={menuRef} className={`menu${filterMenuOpen ? ' open' : ''}`} role="dialog" aria-label="筛选事项" hidden={!filterMenuOpen}>
          <div className="menu-g">状态</div>
          <FilterRow label="仅逾期" on={filter.overdueOnly} onToggle={() => { patchFilter({ overdueOnly: !filter.overdueOnly }) }} />
          <FilterRow label="仅进行中" on={filter.inProgressOnly} onToggle={() => { patchFilter({ inProgressOnly: !filter.inProgressOnly }) }} />
          <FilterRow label="仅滞留" on={filter.staleOnly} onToggle={() => { patchFilter({ staleOnly: !filter.staleOnly }) }} />
          <div className="menu-g">时段（到期日）</div>
          <select
            className="msel"
            value={matchRangePreset(filter.rangeFrom, filter.rangeTo) ?? ''}
            aria-label="到期时段"
            onChange={(e) => {
              const value = e.target.value
              if (!value) patchFilter({ rangeFrom: null, rangeTo: null })
              else if (value !== 'custom') patchFilter(rangeOfPreset(value as RangePresetKind))
            }}
          >
            <option value="">不限</option>
            <option value="today">今天</option>
            <option value="thisWeek">本周</option>
            <option value="thisMonth">本月</option>
            {rangeActive && matchRangePreset(filter.rangeFrom, filter.rangeTo) === 'custom' && <option value="custom">自定义</option>}
          </select>
          <div className="range-inputs">
            <input type="date" className="mdate" value={filter.rangeFrom ?? ''} title="起（含当天）" aria-label="到期开始日期" onChange={(e) => { patchFilter({ rangeFrom: e.target.value || null }) }} />
            <span className="range-tilde">~</span>
            <input type="date" className="mdate" value={filter.rangeTo ?? ''} title="止（含当天）" aria-label="到期结束日期" onChange={(e) => { patchFilter({ rangeTo: e.target.value || null }) }} />
          </div>
          <div className="menu-g">里程碑</div>
          <select className="msel" value={filter.milestoneTitle ?? ''} aria-label="所属里程碑" onChange={(e) => { patchFilter({ milestoneTitle: e.target.value || null }) }}>
            <option value="">全部</option>
            {milestoneTitles.map((title) => (
              <option key={title} value={title}>{title}</option>
            ))}
          </select>
          <div className="menu-g">关键词</div>
          <input className="minput" value={filter.keyword ?? ''} aria-label="按标题关键词筛选" placeholder="标题包含…" onChange={(e) => { patchFilter({ keyword: e.target.value }) }} />
          {hasDetailFilter(filter) && (
            <div className="menu-clear">
              <button type="button" className="btn btn-ghost" onClick={() => { setFilter({ ...DEFAULT_FILTER, preset: filter.preset }) }}>清除全部筛选</button>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null

  return (
    <div
      className={`yolo-scope panel${compact ? ' compact' : ''}`}
      data-y-theme={theme}
      style={{ position: 'fixed', left, right: 0, top: 0, bottom: 0, zIndex: 10000 }}
    >
      {/* Product-level actions: chat → notifications → more → close. */}
      <header className="p-head">
        <div className="brand">
          <span className="mark"><YoloLogo size={18} /></span>
          <span className="brand-name">YOLO</span>
          <span className="surface-name brand-wide">{VIEW_LABELS[view]}</span>
          <span className="p-date mono">{dateLabel}</span>
        </div>
        <div className="p-head-acts">
          {!chatShowingFull && (
            <button type="button" className={`ctoggle head-primary${sideChatOpen ? ' on' : ''}`} onClick={toggleSideChat} title={sideChatOpen ? '收起对话 (Esc)' : '打开对话'}>
              <IcChat size={14} /><span>对话</span>
            </button>
          )}
          {chatShowingFull && (
            <button type="button" className="ctoggle head-primary" onClick={() => { setChatFullscreen(false) }} title="收起为侧栏 (Esc)">
              <IcShrink size={14} /><span>侧栏</span>
            </button>
          )}
          <button
            type="button"
            className="head-secondary bell"
            onClick={() => { setView('today'); setNotifFocusTick((t) => t + 1) }}
            title={unhandled > 0 ? `${unhandled} 条未处理提醒，点击查看` : '通知'}
            aria-label={unhandled > 0 ? `通知，${unhandled} 条未处理` : '通知，无未处理消息'}
          >
            <IcBell size={13} />
            <span>通知</span>
            {unhandled > 0 && <span className="bnum">{unhandled}</span>}
            {unhandled > 0 && <span className="bdot" />}
          </button>
          <MoreMenu
            view={view}
            loading={state.loading}
            theme={theme}
            onViewChange={setView}
            onOpenFilters={() => { setView('today'); setFilterMenuOpen(true) }}
            onRefresh={() => { void load() }}
            onToggleTheme={toggleTheme}
          />
          <button type="button" className="hbtn" onClick={onClose} title="关闭 (Esc)" aria-label="关闭面板">
            <IcClose size={15} />
          </button>
        </div>
        <span key={sweepTick} className={`sweep${sweepTick > 0 ? ' run' : ''}`} />
      </header>

      {/* ② horizontal view tabs — the face switcher (vertical nav is the host's) */}
      <ViewTabs view={view} counts={counts} onChange={setView} compact={compact} />
      {!chatShowingFull && listTools}

      {/* ③ body: full-screen chat takes over the panel while the board stays
          MOUNTED (display:none) so its editor drafts, the 4s undo window and
          fold/notification states survive the round-trip (4.2⑨) — the previous
          conditional render actually unmounted KanbanView and lost them. */}
      {chatShowingFull ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ display: 'none' }} aria-hidden="true">{boardColumn}</div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <ChatPane variant="full" anchor={anchor} threadKey={chatThread} />
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {boardColumn}

          {showSideDock && (
            <aside className="dock">
              <div className="dock-head">
                <span className="dock-tag">锚定</span>
                <span className="dock-ctx" title={anchor?.title ?? '看板全局'}>{anchor?.title ?? '看板全局'}</span>
                <button type="button" className="dact" onClick={() => { setChatFullscreen(true) }} title="展开为全屏">
                  <span className="tico"><IcExpand size={11} /></span>全屏
                </button>
                <button type="button" className="hbtn" onClick={closeSideChat} title="收起 (Esc)" aria-label="收起侧栏对话">
                  <IcClose size={14} />
                </button>
              </div>
              <ChatPane variant="side" anchor={anchor} threadKey={chatThread} />
            </aside>
          )}
        </div>
      )}
    </div>
  )
}

function FilterRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }): JSX.Element {
  return (
    <div className="mrow" onClick={onToggle} role="checkbox" aria-checked={on} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}>
      <span className={`ck${on ? ' on' : ''}`}><IcCheck size={10} /></span>
      {label}
    </div>
  )
}
