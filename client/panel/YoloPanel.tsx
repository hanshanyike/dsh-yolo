// YOLO panel shell — v5「宿主原生」drawer (frontend-redesign-v5-native.md).
// YOLO is a first-class surface of the dsh host: a drawer from the sidebar's
// right edge with a horizontal tab bar (今日/即将/已完成/目标/台账), a
// capture-first command bar, and a chat surface in two sizes (side 340px dock
// ↔ full). Esc unwinds fullscreen → side chat → closed. Narrow panels (<480px)
// open the chat full-screen directly. Filter + side-chat visibility persist
// across close/reopen via panel/state.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { YoloDashboardData } from '../../src/shared/dashboard.ts'
import { buildDashboardSurfaces } from '../../src/shared/dashboard-surfaces.ts'
import {
  DEFAULT_FILTER,
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
import { IcBell, IcChat, IcCheck, IcChevron, IcClose, IcFilter } from '../design/icons.tsx'
import { YoloLogo } from '../YoloLogo.tsx'
import { ChatPane, type ChatAnchor } from './ChatPane.tsx'
import { KanbanView, type BoardSurfaceKey } from './KanbanView.tsx'
import { MoreMenu } from './MoreMenu.tsx'
import { HistoryTabs, PageTabs, PlanTabs } from './PageTabs.tsx'
import { ForegroundContext, type SessionNavigationState } from './ForegroundContext.tsx'
import { readPanelState, writePanelState } from './state.ts'
import { buildTodaySurfaceModel } from './v2/today-surface-model.ts'
import {
  backFromForeground,
  derivePanelPresentation,
  escapePanel,
  openForeground,
  samePanelItem,
  type BoardPage,
  type BoardRoute,
  type PanelItemRef,
  type PanelNavigationState,
} from './navigation.ts'

export interface YoloPanelProps {
  /** Panel left edge (the sidebar's right edge) — spans to the viewport right. */
  left: number
  onClose: () => void
  /** Jump to a dsh session (ledger source badges); no-op when unavailable. */
  openSession?: (sessionId: string) => void
  /** Increments when an external reminder signal asks to refresh and focus notifications. */
  notificationFocusRequest?: number
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

const PAGE_LABELS: Record<BoardPage, string> = {
  home: '首页',
  plan: '计划',
  history: '历史',
}

export function YoloPanel({ left, onClose, openSession, notificationFocusRequest = 0, themeControl }: YoloPanelProps): JSX.Element {
  ensureYoloStyle()
  const [theme, setTheme] = useState<'dark' | 'light'>(() => detectYoloTheme())

  const [state, setState] = useState<LoadState>({ loading: true, error: null, data: null })
  const initial = useMemo(() => readPanelState(), [])
  const [filter, setFilter] = useState<KanbanFilter>(initial.filter)
  const [navigation, setNavigation] = useState<PanelNavigationState>(initial.navigation)
  const [discussionThreads, setDiscussionThreads] = useState<Record<string, string>>(initial.discussionThreads)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [notifFocusTick, setNotifFocusTick] = useState(0)
  const [sessionNavigation, setSessionNavigation] = useState<SessionNavigationState>({ status: 'idle' })
  const [sweepTick, setSweepTick] = useState(0)
  const lastSig = useRef<string | null>(null)
  const previousNotificationFocusRequest = useRef<number | null>(null)
  const fltBtnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const chatToggleRef = useRef<HTMLButtonElement>(null)
  const chatOpenerRef = useRef<HTMLElement | null>(null)
  const chatReturnTodoIdRef = useRef<string | undefined>(
    navigation.foreground.kind === 'item_discussion' ? navigation.foreground.item.id : undefined,
  )

  // Panel width → Compact gear (<480px: chat opens full-screen).
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1000 : Math.max(0, window.innerWidth - left)))
  useEffect(() => {
    const on = (): void => { setWidth(Math.max(0, window.innerWidth - left)) }
    window.addEventListener('resize', on)
    return () => { window.removeEventListener('resize', on) }
  }, [left])
  const compact = width < yoloTokens.compactBreakpoint
  const presentation = derivePanelPresentation(width, navigation.foreground, navigation.presentation)

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

  // Persist view state so reopening keeps the filter and side chat (TA-6).
  useEffect(() => { writePanelState({ filter }) }, [filter])
  useEffect(() => { writePanelState({ navigation }) }, [navigation])
  useEffect(() => { writePanelState({ discussionThreads }) }, [discussionThreads])

  const patchFilter = useCallback((patch: Partial<KanbanFilter>): void => {
    setFilter((f) => ({ ...f, ...patch }))
  }, [])

  const setRoute = useCallback((route: BoardRoute): void => {
    setNavigation((current) => ({ ...current, route }))
    if (route.page === 'plan') {
      const preset: PresetTab = route.section === 'today' ? 'today' : 'all'
      setFilter((current) => current.preset === preset ? current : { ...current, preset })
    }
  }, [])

  const setPage = useCallback((page: BoardPage): void => {
    setRoute(page === 'home'
      ? { page: 'home' }
      : page === 'plan'
        ? { page: 'plan', section: 'today' }
        : { page: 'history', section: 'completed' })
  }, [setRoute])

  // One request owns both refresh and focus. Waiting for load prevents a tick
  // against an old board whose notification section has not mounted yet.
  useEffect(() => {
    const shouldFocus = notificationFocusRequest > 0 && previousNotificationFocusRequest.current !== notificationFocusRequest
    previousNotificationFocusRequest.current = notificationFocusRequest
    if (shouldFocus) setRoute({ page: 'home' })
    let active = true
    void load().then(() => {
      if (active && shouldFocus) setNotifFocusTick((tick) => tick + 1)
    })
    return () => { active = false }
  }, [load, notificationFocusRequest, setRoute])

  const focusChatOpener = useCallback((): void => {
    window.setTimeout(() => {
      const original = chatOpenerRef.current
      if (original?.isConnected) {
        original.focus()
        return
      }
      const todoId = chatReturnTodoIdRef.current
      if (todoId) {
        const row = Array.from(document.querySelectorAll<HTMLElement>('[data-yolo-todo-id]'))
          .find((element) => element.dataset.yoloTodoId === todoId)
        if (row) {
          row.focus()
          return
        }
      }
      chatToggleRef.current?.focus()
    }, 0)
  }, [])

  const closeForeground = useCallback((): void => {
    setNavigation((current) => {
      if (current.foreground.kind === 'item_discussion') {
        const key = `${current.foreground.item.scopeCwd}\u0000${current.foreground.item.id}`
        setDiscussionThreads((threads) => {
          const next = { ...threads }
          delete next[key]
          return next
        })
      }
      return { ...current, foreground: { kind: 'none' } }
    })
    setSessionNavigation({ status: 'idle' })
    focusChatOpener()
  }, [focusChatOpener])

  const backForeground = useCallback((): void => {
    setNavigation((current) => backFromForeground(current))
    setSessionNavigation({ status: 'idle' })
    focusChatOpener()
  }, [focusChatOpener])

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const result = escapePanel(navigation)
      if (result.action === 'state') {
        event.preventDefault()
        setNavigation(result.state)
        setSessionNavigation({ status: 'idle' })
        focusChatOpener()
      } else onClose()
    }
    document.addEventListener('keydown', listener)
    return () => { document.removeEventListener('keydown', listener) }
  }, [focusChatOpener, navigation, onClose])

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
    chatOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    chatReturnTodoIdRef.current = a.todoId
    const item: PanelItemRef = {
      id: a.todoId ?? `context-${Date.now().toString(36)}`,
      scopeCwd: a.scopeCwd ?? state.data?.cwd ?? '',
      title: a.title,
    }
    setNavigation((current) => {
      const key = `${item.scopeCwd}\u0000${item.id}`
      const existing = current.foreground.kind === 'item_discussion' && samePanelItem(current.foreground.item, item)
        ? current.foreground.threadKey
        : discussionThreads[key]
      const threadKey = existing ?? `a-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      setDiscussionThreads((threads) => threads[key] === threadKey ? threads : { ...threads, [key]: threadKey })
      return openForeground(current, { kind: 'item_discussion', item, threadKey }, a.todoId ? `todo-${a.todoId}` : undefined)
    })
  }, [discussionThreads, state.data?.cwd])

  const toggleAssistantChat = useCallback(() => {
    chatOpenerRef.current = chatToggleRef.current
    chatReturnTodoIdRef.current = undefined
    setNavigation((current) => current.foreground.kind === 'assistant_chat'
      ? { ...current, foreground: { kind: 'none' } }
      : openForeground(current, { kind: 'assistant_chat' }, 'yolo-assistant-chat'))
  }, [])

  const openSourcePreview = useCallback((item: PanelItemRef, source: NonNullable<YoloDashboardData['todos'][number]['source']>): void => {
    setSessionNavigation({ status: 'idle' })
    setNavigation((current) => openForeground(current, {
      kind: 'source_preview', item, source,
      returnTo: current.foreground.kind === 'item_detail' ? current.foreground : undefined,
    }))
  }, [])

  const navigateToSourceSession = useCallback((sessionId: string): void => {
    if (!openSession) {
      setSessionNavigation({ status: 'error', message: '当前宿主不支持打开会话。' })
      return
    }
    setSessionNavigation({ status: 'pending' })
    Promise.resolve().then(() => { openSession(sessionId) }).then(() => {
      setSessionNavigation({ status: 'idle' })
      onClose()
    }).catch((error: unknown) => {
      setSessionNavigation({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }, [onClose, openSession])

  // Tab counts — Today is the deduplicated set its default surface actually
  // carries; other tabs keep their domain-specific live counts.
  const countState = useMemo(() => {
    const surfaces = state.data ? buildDashboardSurfaces(state.data) : undefined
    const todayModel = state.data ? buildTodaySurfaceModel(state.data) : undefined
    return {
      counts: {
        home: todayModel?.openItemCount ?? 0,
        plan: surfaces?.plan.all.length ?? 0,
        history: (surfaces?.history.completed.length ?? 0) + (surfaces?.history.cancelled.length ?? 0),
      },
      partial: surfaces?.home.coverage.partial ?? false,
    }
  }, [state.data])

  const unhandled = state.data?.unhandled ?? 0
  const rangeActive = filter.rangeFrom !== null || filter.rangeTo !== null
  const milestoneTitles = useMemo(() => state.data?.milestones.map((m) => m.title) ?? [], [state.data])

  const d = new Date()
  const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日 · 周${'日一二三四五六'[d.getDay()]}`

  const surface: BoardSurfaceKey = navigation.route.page === 'home'
    ? 'home'
    : navigation.route.page === 'plan'
      ? `plan-${navigation.route.section}`
      : navigation.route.section === 'completed' ? 'history-terminal' : 'history-changes'

  const setSurface = useCallback((next: BoardSurfaceKey): void => {
    if (next === 'home') setRoute({ page: 'home' })
    else if (next.startsWith('plan-')) setRoute({ page: 'plan', section: next.slice(5) as 'today' | 'upcoming' | 'goals' | 'all' })
    else setRoute({ page: 'history', section: next === 'history-changes' ? 'changes' : 'completed' })
  }, [setRoute])

  const sourceForForeground = useMemo(() => {
    if (!state.data || !('item' in navigation.foreground)) return undefined
    const target = navigation.foreground.item
    return state.data.todos.find((todo) => todo.id === target.id && (todo.scope_cwd ?? todo.ws?.cwd ?? state.data!.cwd) === target.scopeCwd)?.source
  }, [navigation.foreground, state.data])

  const chatAnchor = useMemo<ChatAnchor | null>(() => {
    if (navigation.foreground.kind !== 'item_discussion') return null
    return {
      title: navigation.foreground.item.title,
      todoId: navigation.foreground.item.id,
      scopeCwd: navigation.foreground.item.scopeCwd,
      source: sourceForForeground ? {
        type: sourceForForeground.type,
        label: sourceForForeground.label,
        sessionId: sourceForForeground.session_id,
        excerpt: sourceForForeground.excerpt,
      } : undefined,
    }
  }, [navigation.foreground, sourceForForeground])

  const chatThread = navigation.foreground.kind === 'item_discussion' ? navigation.foreground.threadKey : undefined

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
      {state.error && state.data !== null && (
        <div className="err-line" role="status">
          <span>刷新失败，当前内容可能不是最新：{state.error}</span>
          <button type="button" className="nact" onClick={() => { void load() }}>重试</button>
        </div>
      )}
      {state.data !== null && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <KanbanView
            data={state.data}
            refresh={load}
            filter={filter}
            patchFilter={patchFilter}
            surface={surface}
            onSurfaceChange={setSurface}
            onOpenChat={openAnchoredChat}
            onOpenSource={(todo, source) => {
              openSourcePreview({
                id: todo.id,
                scopeCwd: todo.scope_cwd ?? todo.ws?.cwd ?? state.data!.cwd,
                title: todo.title,
              }, source)
            }}
            onOpenChangeSource={(change, source) => {
              openSourcePreview({
                id: change.id,
                scopeCwd: change.ws?.cwd ?? state.data!.cwd,
                title: change.summary,
              }, source)
            }}
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
  const listTools = navigation.route.page === 'plan' && navigation.route.section !== 'goals' ? (
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
          aria-label={`筛选事项${hasDetailFilter(filter) ? '，已启用筛选条件' : '，未启用筛选条件'}`}
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

  const foreground = navigation.foreground
  const contextTitle = foreground.kind === 'assistant_chat'
    ? '助手对话'
    : foreground.kind === 'item_discussion'
      ? foreground.item.title
      : foreground.kind === 'item_detail'
        ? '事项详情'
        : foreground.kind === 'source_preview' ? '来源' : ''
  const contextContent = foreground.kind === 'assistant_chat' || foreground.kind === 'item_discussion'
    ? <ChatPane variant={presentation === 'split' ? 'side' : 'full'} anchor={foreground.kind === 'item_discussion' ? chatAnchor : null} threadKey={chatThread} />
    : foreground.kind === 'item_detail' || foreground.kind === 'source_preview'
      ? (
          <ForegroundContext
            foreground={foreground}
            itemSource={sourceForForeground}
            sessionNavigation={sessionNavigation}
            onBack={backForeground}
            onClose={closeForeground}
            onDiscuss={(item) => { openAnchoredChat({ title: item.title, todoId: item.id, scopeCwd: item.scopeCwd }) }}
            onOpenSource={openSourcePreview}
            onOpenSession={navigateToSourceSession}
          />
        )
      : null

  return (
    <div
      className={`yolo-scope panel${compact ? ' compact' : ''}`}
      data-y-theme={theme}
      data-presentation={presentation}
      style={{ position: 'fixed', left, right: 0, top: 0, bottom: 0, zIndex: 10000 }}
    >
      <header className="p-head">
        <div className="brand">
          {presentation === 'focus' ? (
            <button type="button" className="hbtn" onClick={backForeground} aria-label={`返回${PAGE_LABELS[navigation.route.page]}`}>←</button>
          ) : <span className="mark"><YoloLogo size={18} /></span>}
          <span className="brand-name">YOLO</span>
          <span className="surface-name brand-wide">{presentation === 'focus' ? contextTitle : PAGE_LABELS[navigation.route.page]}</span>
          <span className="p-date mono">{dateLabel}</span>
        </div>
        <div className="p-head-acts">
          <button ref={chatToggleRef} type="button" className={`ctoggle head-primary${foreground.kind === 'assistant_chat' ? ' on' : ''}`} onClick={toggleAssistantChat} title="和助手聊聊">
            <IcChat size={14} /><span>和助手聊聊</span>
          </button>
          <button
            type="button"
            className="head-secondary bell"
            onClick={() => { setRoute({ page: 'home' }); setNotifFocusTick((tick) => tick + 1) }}
            title={unhandled > 0 ? `${unhandled} 条未处理提醒，点击查看` : '通知'}
            aria-label={unhandled > 0 ? `通知，${unhandled} 条未处理` : '通知，无未处理消息'}
          >
            <IcBell size={13} /><span>通知</span>
            {unhandled > 0 && <span className="bnum">{unhandled}</span>}
            {unhandled > 0 && <span className="bdot" />}
          </button>
          <MoreMenu
            loading={state.loading}
            theme={theme}
            onOpenFilters={navigation.route.page === 'plan' ? () => { setFilterMenuOpen(true) } : undefined}
            onRefresh={() => { void load() }}
            onToggleTheme={toggleTheme}
          />
          <button type="button" className="hbtn" onClick={onClose} title="关闭 (Esc)" aria-label="关闭面板"><IcClose size={15} /></button>
        </div>
        <span key={sweepTick} className={`sweep${sweepTick > 0 ? ' run' : ''}`} />
      </header>

      {presentation !== 'focus' ? (
        <>
          <PageTabs page={navigation.route.page} counts={countState.counts} partial={countState.partial} onChange={setPage} />
          {navigation.route.page === 'plan' ? <PlanTabs section={navigation.route.section} onChange={(section) => { setRoute({ page: 'plan', section }) }} /> : null}
          {navigation.route.page === 'history' ? <HistoryTabs section={navigation.route.section} onChange={(section) => { setRoute({ page: 'history', section }) }} /> : null}
          {listTools}
        </>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, display: presentation === 'focus' ? 'none' : 'flex' }} aria-hidden={presentation === 'focus' ? true : undefined}>
          {boardColumn}
        </div>
        {foreground.kind !== 'none' ? (
          <aside
            className={presentation === 'split' ? 'dock' : undefined}
            role={presentation === 'focus' ? 'dialog' : undefined}
            aria-modal={presentation === 'focus' ? true : undefined}
            aria-label={contextTitle}
            style={presentation === 'split'
              ? undefined
              : { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
          >
            {presentation === 'split' && (foreground.kind === 'assistant_chat' || foreground.kind === 'item_discussion') ? (
              <div className="dock-head">
                <span className="dock-tag">上下文</span><span className="dock-ctx" title={contextTitle}>{contextTitle}</span>
                <button type="button" className="hbtn" onClick={closeForeground} title="关闭上下文" aria-label="关闭上下文"><IcClose size={14} /></button>
              </div>
            ) : null}
            {contextContent}
          </aside>
        ) : null}
      </div>
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
