// Host-native assistant shell. The host sidebar remains global navigation;
// YOLO owns Home / Plan / History and exactly one contextual foreground.
// Presentation is derived from usable width: focus replaces the board, while
// split adds one 340px context surface. Route, drafts, threads and requests do
// not change when presentation changes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { YoloDashboardData, YoloTodoRow } from '../../src/contracts/dashboard.ts'
import type { YoloBadgeNotification } from '../../src/contracts/badge.ts'
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
import { IcBell, IcCheck, IcChevron, IcClose, IcFilter } from '../design/icons.tsx'
import { YoloLogo } from '../YoloLogo.tsx'
import { ChatPane, type ChatAnchor } from './ChatPane.tsx'
import { KanbanView } from './KanbanView.tsx'
import type { BoardSurfaceKey } from './kanban/surfaces.ts'
import { NotificationLog } from './NotificationLog.tsx'
import { MoreMenu } from './MoreMenu.tsx'
import { DataManagementDialog } from './DataManagementDialog.tsx'
import { HistoryTabs, PageTabs, PlanTabs } from './PageTabs.tsx'
import { ForegroundContext, type SessionNavigationState } from './ForegroundContext.tsx'
import { readPanelState, writePanelState } from './state.ts'
import { buildTodaySurfaceModel } from './v2/today-surface-model.ts'
import { TaskActionPanel } from './v2/TaskActionPanel.tsx'
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
import { useDashboardController } from './controllers/use-dashboard-controller.ts'
import { useNotificationNavigation } from './controllers/use-notification-navigation.ts'
import { useItemDetailController } from './controllers/use-item-detail-controller.ts'

export { dashboardSignature } from './controllers/use-dashboard-controller.ts'

export interface YoloPanelProps {
  /** Panel left edge (the sidebar's right edge) — spans to the viewport right. */
  left: number
  onClose: () => void
  /** Jump to a dsh session (ledger source badges); no-op when unavailable. */
  openSession?: (sessionId: string) => void | Promise<void>
  /** Increments when a new delivery asks the open panel to refresh without stealing foreground. */
  notificationRefreshRequest?: number
  /** Explicit popup click: navigate to its todo or notification record. */
  notificationOpenRequest?: { sequence: number; notification: YoloBadgeNotification }
  /** Keep the always-on sidebar badge in sync with notification-log actions. */
  onUnseenChange?: (unseen: number, revision: number) => void
  /** Host-owned durable theme preference. Optional only for isolated renders. */
  themeControl?: { set: (theme: 'dark' | 'light') => void }
  /** Greeting selected by the sidebar for this panel opening. */
  surfaceLabel?: string
}

const PAGE_LABELS: Record<BoardPage, string> = {
  home: '首页',
  plan: '计划',
  history: '历史',
}

function freshChatThreadKey(): string {
  return `a-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function YoloPanel({
  left,
  onClose,
  openSession,
  notificationRefreshRequest = 0,
  notificationOpenRequest,
  onUnseenChange,
  themeControl,
  surfaceLabel = '一起把事情理顺',
}: YoloPanelProps): JSX.Element {
  ensureYoloStyle()
  const [theme, setTheme] = useState<'dark' | 'light'>(() => detectYoloTheme())

  const { state, load, sweepTick, updateUnseen } = useDashboardController({
    notificationRefreshRequest,
    onUnseenChange,
  })
  const initial = useMemo(() => readPanelState(), [])
  const [filter, setFilter] = useState<KanbanFilter>(initial.filter)
  const [navigation, setNavigation] = useState<PanelNavigationState>(initial.navigation)
  const [discussionThreads, setDiscussionThreads] = useState<Record<string, string>>(initial.discussionThreads)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [dataManagementOpen, setDataManagementOpen] = useState(false)
  const [sessionNavigation, setSessionNavigation] = useState<SessionNavigationState>({ status: 'idle' })
  const fltBtnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const chatToggleRef = useRef<HTMLButtonElement>(null)
  const notificationButtonRef = useRef<HTMLButtonElement>(null)
  const chatOpenerRef = useRef<HTMLElement | null>(null)
  const contextRef = useRef<HTMLElement>(null)
  const openDiscussionRef = useRef<(anchor: ChatAnchor) => void>(() => {})
  const chatReturnTodoIdRef = useRef<string | undefined>(
    navigation.foreground.kind === 'item_discussion' ? navigation.foreground.item.id : undefined,
  )
  const openDetailDiscussion = useCallback((anchor: ChatAnchor): void => {
    openDiscussionRef.current(anchor)
  }, [])
  const detail = useItemDetailController({
    data: state.data,
    foreground: navigation.foreground,
    refresh: load,
    openDiscussion: openDetailDiscussion,
  })

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
        : { page: 'history', section: 'timeline' })
  }, [setRoute])

  const focusChatOpener = useCallback((returnFocusId = navigation.returnFocusId, todoId = chatReturnTodoIdRef.current): void => {
    window.setTimeout(() => {
      // Returning from source remounts the item panel, whose own initial
      // focus effect runs during the commit. Restore the invoking control on
      // the following frame so it remains the deterministic focus owner.
      window.requestAnimationFrame(() => {
        if (returnFocusId) {
          const exact = Array.from(document.querySelectorAll<HTMLElement>('[data-yolo-focus-id]'))
            .find((element) => element.dataset.yoloFocusId === returnFocusId)
          if (exact?.isConnected && exact.getClientRects().length > 0) {
            exact.focus()
            return
          }
        }
        const original = chatOpenerRef.current
        if (original?.isConnected && original.getClientRects().length > 0) {
          original.focus()
          return
        }
        if (todoId) {
          const row = Array.from(document.querySelectorAll<HTMLElement>('[data-yolo-todo-id]'))
            .find((element) => element.dataset.yoloTodoId === todoId)
          if (row) {
            row.focus()
            return
          }
        }
        chatToggleRef.current?.focus()
      })
    }, 0)
  }, [navigation.returnFocusId])

  const closeForeground = useCallback((): void => {
    const returnFocusId = navigation.returnFocusId
    const returnTodoId = 'item' in navigation.foreground ? navigation.foreground.item.id : undefined
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
    detail.reset()
    focusChatOpener(returnFocusId, returnTodoId)
  }, [detail, focusChatOpener, navigation.foreground, navigation.returnFocusId])

  const openDataManagement = useCallback((): void => {
    setFilterMenuOpen(false)
    setNavigation((current) => ({ ...current, foreground: { kind: 'none' }, returnFocusId: undefined }))
    setSessionNavigation({ status: 'idle' })
    detail.reset()
    setDataManagementOpen(true)
  }, [detail])
  const closeDataManagement = useCallback((): void => {
    setDataManagementOpen(false)
    window.setTimeout(() => {
      document.querySelector<HTMLElement>('.yolo-scope .more-trigger')?.focus()
    }, 0)
  }, [])

  const backForeground = useCallback((): void => {
    const returnFocusId = navigation.returnFocusId
    const returnTodoId = 'item' in navigation.foreground ? navigation.foreground.item.id : undefined
    setNavigation((current) => backFromForeground(current))
    setSessionNavigation({ status: 'idle' })
    if (navigation.foreground.kind === 'item_detail') {
      detail.reset()
    }
    focusChatOpener(returnFocusId, returnTodoId)
  }, [detail, focusChatOpener, navigation.foreground, navigation.returnFocusId])

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const result = escapePanel(navigation)
      if (result.action === 'state') {
        event.preventDefault()
        backForeground()
      } else onClose()
    }
    document.addEventListener('keydown', listener)
    return () => { document.removeEventListener('keydown', listener) }
  }, [backForeground, navigation, onClose])

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
      entity: a.todoId ? 'todo' : 'context',
    }
    const key = `${item.scopeCwd}\u0000${item.id}`
    const existing = navigation.foreground.kind === 'item_discussion' && samePanelItem(navigation.foreground.item, item)
      ? navigation.foreground.threadKey
      : discussionThreads[key]
    const threadKey = existing ?? freshChatThreadKey()
    setDiscussionThreads((threads) => threads[key] === threadKey ? threads : { ...threads, [key]: threadKey })
    setNavigation((current) => openForeground(current, { kind: 'item_discussion', item, threadKey }, a.todoId ? `todo-${a.todoId}` : undefined))
  }, [discussionThreads, navigation.foreground, state.data?.cwd])
  openDiscussionRef.current = openAnchoredChat

  const toggleAssistantChat = useCallback(() => {
    chatOpenerRef.current = chatToggleRef.current
    chatReturnTodoIdRef.current = undefined
    setNavigation((current) => current.foreground.kind === 'assistant_chat'
      ? { ...current, foreground: { kind: 'none' } }
      : openForeground(current, { kind: 'assistant_chat', threadKey: freshChatThreadKey() }, 'yolo-assistant-chat'))
  }, [])

  const openSourcePreview = useCallback((item: PanelItemRef, source: NonNullable<YoloDashboardData['todos'][number]['source']>): void => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    chatOpenerRef.current = opener
    chatReturnTodoIdRef.current = item.id
    setSessionNavigation({ status: 'idle' })
    setNavigation((current) => {
      const focusId = opener?.dataset.yoloFocusId
      return openForeground(current, {
        kind: 'source_preview', item, source,
        returnTo: current.foreground.kind === 'item_detail' ? current.foreground : undefined,
        returnToFocusId: current.foreground.kind === 'item_detail' ? current.returnFocusId : undefined,
      }, focusId)
    })
  }, [])

  const openItemDetail = useCallback((todo: YoloTodoRow): void => {
    const item: PanelItemRef = {
      id: todo.id,
      scopeCwd: todo.scope_cwd ?? todo.ws?.cwd ?? state.data?.cwd ?? '',
      title: todo.title,
      entity: 'todo',
    }
    chatOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    chatReturnTodoIdRef.current = todo.id
    detail.prepare(todo)
    setNavigation((current) => openForeground(current, { kind: 'item_detail', item }, `todo-${todo.id}`))
  }, [detail, state.data?.cwd])

  const openNotificationLog = useCallback((targetId?: string): void => {
    chatOpenerRef.current = notificationButtonRef.current
    chatReturnTodoIdRef.current = undefined
    setNavigation((current) => {
      if (current.foreground.kind === 'notification_log') {
        if (targetId && current.foreground.targetId !== targetId) {
          return { ...current, foreground: { ...current.foreground, targetId } }
        }
        return backFromForeground(current)
      }
      const returnTo = current.foreground.kind === 'none' ? undefined : current.foreground
      return openForeground(current, {
        kind: 'notification_log',
        targetId,
        returnTo,
        returnToFocusId: current.returnFocusId,
      }, 'yolo-notifications')
    })
  }, [])

  const openReminderTodo = useCallback((todo: YoloTodoRow): void => {
    setRoute({ page: 'home' })
    openItemDetail(todo)
  }, [openItemDetail, setRoute])

  useNotificationNavigation({
    request: notificationOpenRequest,
    data: state.data,
    updateUnseen,
    openReminderTodo,
    openNotificationLog,
  })

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

  useEffect(() => {
    if (presentation !== 'focus' || navigation.foreground.kind === 'none') return
    const root = contextRef.current
    if (!root) return
    const focusableElements = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(
      'input:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => {
      const style = window.getComputedStyle(element)
      return element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    })
    const focusFirst = window.setTimeout(() => {
      focusableElements()[0]?.focus()
    }, 0)
    const trap = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const focusable = focusableElements()
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    root.addEventListener('keydown', trap)
    return () => { window.clearTimeout(focusFirst); root.removeEventListener('keydown', trap) }
  }, [navigation.foreground.kind, presentation])

  // Tab counts — Today is the deduplicated set its default surface actually
  // carries; other tabs keep their domain-specific live counts.
  const countState = useMemo(() => {
    const surfaces = state.data ? buildDashboardSurfaces(state.data) : undefined
    const todayModel = state.data ? buildTodaySurfaceModel(state.data) : undefined
    return {
      counts: {
        home: todayModel?.openItemCount ?? 0,
        plan: surfaces?.plan.all.length ?? 0,
        history: null,
      },
      partial: surfaces?.home.coverage.partial ?? false,
    }
  }, [state.data])

  const unseen = state.data?.unseen ?? 0
  const notificationPartial = state.data?.summary?.partial === true
    || (state.data?.workspaceErrors?.length ?? 0) > 0
  const rangeActive = filter.rangeFrom !== null || filter.rangeTo !== null
  const milestoneTitles = useMemo(() => state.data?.milestones.map((m) => m.title) ?? [], [state.data])

  const surface: BoardSurfaceKey = navigation.route.page === 'home'
    ? 'home'
    : navigation.route.page === 'plan'
      ? `plan-${navigation.route.section}`
      : navigation.route.section === 'timeline' ? 'history-timeline' : 'history-items'

  const setSurface = useCallback((next: BoardSurfaceKey): void => {
    if (next === 'home') setRoute({ page: 'home' })
    else if (next.startsWith('plan-')) setRoute({ page: 'plan', section: next.slice(5) as 'today' | 'upcoming' | 'goals' | 'all' })
    else setRoute({ page: 'history', section: next === 'history-items' ? 'items' : 'timeline' })
  }, [setRoute])

  useEffect(() => {
    if (!state.data || !('item' in navigation.foreground) || navigation.foreground.item.entity !== 'todo') return
    const item = navigation.foreground.item
    const exists = state.data.todos.some((todo) => todo.id === item.id && (todo.scope_cwd ?? todo.ws?.cwd ?? state.data!.cwd) === item.scopeCwd)
    if (exists) return
    setNavigation((current) => ({ ...current, route: { page: 'home' }, foreground: { kind: 'none' } }))
    detail.reset()
  }, [detail, navigation.foreground, state.data])

  const foregroundTodo = detail.todo
  const sourceForForeground = detail.source
  const mergeSuggestions = useMemo(() => {
    if (!foregroundTodo || !state.data?.health?.duplicateTodos) return []
    const scopeCwd = foregroundTodo.scope_cwd ?? foregroundTodo.ws?.cwd ?? state.data.cwd
    const scopeKey = foregroundTodo.ws?.slug
    return state.data.health.duplicateTodos.flatMap((pair) => {
      if (pair.scopeKey && scopeKey && pair.scopeKey !== scopeKey) return []
      const otherId = pair.a === foregroundTodo.id ? pair.b : pair.b === foregroundTodo.id ? pair.a : null
      if (!otherId) return []
      const other = state.data!.todos.find((todo) => todo.id === otherId
        && (todo.scope_cwd ?? todo.ws?.cwd ?? state.data!.cwd) === scopeCwd)
      return other ? [{ key: `${scopeCwd}:${pair.a}:${pair.b}`, other }] : []
    })
  }, [foregroundTodo, state.data])

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

  const chatThread = navigation.foreground.kind === 'assistant_chat' || navigation.foreground.kind === 'item_discussion'
    ? navigation.foreground.threadKey
    : undefined
  const detailAttention = detail.attention
  const detailSource = sourceForForeground ? {
    type: sourceForForeground.type,
    label: sourceForForeground.label,
    sessionId: sourceForForeground.session_id,
    excerpt: sourceForForeground.excerpt,
    workspace: sourceForForeground.workspace,
  } : undefined

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
            onOpenItemDetail={openItemDetail}
            onOpenSource={(todo, source) => {
              openSourcePreview({
                id: todo.id,
                scopeCwd: todo.scope_cwd ?? todo.ws?.cwd ?? state.data!.cwd,
                title: todo.title,
                entity: 'todo',
              }, source)
            }}
            onOpenChangeSource={(change, source) => {
              openSourcePreview({
                id: change.id,
                scopeCwd: change.ws?.cwd ?? state.data!.cwd,
                title: change.summary,
                entity: 'change',
              }, source)
            }}
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
        : foreground.kind === 'source_preview'
          ? '来源'
          : foreground.kind === 'notification_log' ? '通知' : ''
  const contextContent = foreground.kind === 'assistant_chat' || foreground.kind === 'item_discussion'
    ? <ChatPane variant={presentation === 'split' ? 'side' : 'full'} anchor={foreground.kind === 'item_discussion' ? chatAnchor : null} threadKey={chatThread} onDashboardRefresh={load} />
    : foreground.kind === 'item_detail' && foregroundTodo && detail.draft
      ? (
          <>
            {detail.error ? <div className="err-line" role="alert">操作失败：{detail.error}</div> : null}
            <TaskActionPanel
              item={{ ...foregroundTodo, source: detailSource }}
              reason={detailAttention?.explanation ?? '这是当前保存的事项信息。'}
              evidence={detailAttention?.evidence ?? []}
              source={detailSource}
              draft={detail.draft}
              busy={detail.busy}
              learningReceipt={detail.receipt}
              judgmentFeedbackEnabled={detailAttention !== undefined}
              identityReceipts={detail.identityReceipts}
              identityLoading={detail.identityLoading}
              identityError={detail.identityError}
              mergeSuggestions={mergeSuggestions}
              modal={presentation === 'focus'}
              onAction={detail.handleAction}
              onDraftChange={detail.setDraft}
              onSave={detail.save}
              onClose={closeForeground}
              onOpenSource={() => { if (sourceForForeground) openSourcePreview(foreground.item, sourceForForeground) }}
              onUndoReceipt={detail.undo ? detail.undoReceipt : undefined}
              onRejectIdentity={detail.rejectIdentity}
              onConsolidate={detail.consolidate}
            />
          </>
        )
      : foreground.kind === 'source_preview'
      ? (
          <ForegroundContext
            foreground={foreground}
            sessionNavigation={sessionNavigation}
            onBack={backForeground}
            onClose={closeForeground}
            onDiscuss={(item) => { openAnchoredChat({ title: item.title, todoId: item.id, scopeCwd: item.scopeCwd }) }}
            onOpenSource={openSourcePreview}
            onOpenSession={navigateToSourceSession}
          />
        )
      : foreground.kind === 'notification_log'
        ? (
            <NotificationLog
              targetId={foreground.targetId}
              refreshRequest={notificationRefreshRequest}
              onClose={backForeground}
              onUnseenChange={updateUnseen}
              onOpenTodo={(notification) => {
                const todo = state.data?.todos.find((row) => row.id === notification.todo?.id
                  && (row.scope_cwd ?? row.ws?.cwd ?? state.data!.cwd) === notification.scope_cwd)
                if (!todo) return
                setRoute({ page: 'home' })
                openItemDetail(todo)
              }}
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
      <div className="panel-frame" aria-hidden={dataManagementOpen ? true : undefined}>
      <header className="p-head">
        <div className="brand">
          {presentation === 'focus' ? (
            <button type="button" className="hbtn" onClick={backForeground} aria-label={`返回${PAGE_LABELS[navigation.route.page]}`}>←</button>
          ) : <YoloLogo size={28} />}
          <span className="brand-name">YOLO</span>
          <span className="surface-name brand-wide">{presentation === 'focus' ? contextTitle : surfaceLabel}</span>
        </div>
        <div className="p-head-acts">
          {presentation === 'focus' && foreground.kind === 'item_discussion' ? (
            <button type="button" className="head-secondary" onClick={closeForeground}>结束讨论</button>
          ) : null}
          <button ref={chatToggleRef} type="button" className={`ctoggle head-primary${foreground.kind === 'assistant_chat' ? ' on' : ''}`} onClick={toggleAssistantChat} title="和助手聊聊">
            <span>和助手聊聊</span>
          </button>
          <button
            ref={notificationButtonRef}
            type="button"
            className={`head-secondary bell${foreground.kind === 'notification_log' ? ' on' : ''}`}
            aria-expanded={foreground.kind === 'notification_log'}
            aria-controls="yolo-notification-log"
            onClick={() => { openNotificationLog() }}
            title={unseen > 0
              ? notificationPartial ? `至少 ${unseen} 条新通知，部分工作区不可用` : `${unseen} 条新通知，点击查看`
              : notificationPartial ? '通知，部分工作区不可用' : '通知'}
            aria-label={unseen > 0
              ? notificationPartial ? `通知，至少 ${unseen} 条新通知，部分工作区不可用` : `通知，${unseen} 条新通知`
              : notificationPartial ? '通知，无新通知，部分工作区不可用' : '通知，无新通知'}
          >
            <IcBell size={13} /><span>通知</span>
            {unseen > 0 && <span className="bnum">{unseen > 99 ? '99+' : notificationPartial ? `${unseen}+` : unseen}</span>}
            {unseen > 0 && <span className="bdot" />}
          </button>
          <MoreMenu
            loading={state.loading}
            theme={theme}
            onOpenFilters={navigation.route.page === 'plan' ? () => { setFilterMenuOpen(true) } : undefined}
            onOpenDataManagement={openDataManagement}
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
              ref={contextRef}
              data-foreground={foreground.kind}
              className={presentation === 'split' ? 'dock' : undefined}
              role={presentation === 'focus' && foreground.kind !== 'item_detail' ? 'dialog' : undefined}
              aria-modal={presentation === 'focus' && foreground.kind !== 'item_detail' ? true : undefined}
              aria-label={contextTitle}
              style={presentation === 'split'
                ? undefined
                : { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
            >
              {presentation === 'split' && (foreground.kind === 'assistant_chat' || foreground.kind === 'item_discussion') ? (
                <div className="dock-head">
                  <span className="dock-tag">上下文</span><span className="dock-ctx" title={contextTitle}>{contextTitle}</span>
                  <button type="button" className="hbtn" onClick={closeForeground} title={foreground.kind === 'item_discussion' ? '结束讨论' : '关闭上下文'} aria-label={foreground.kind === 'item_discussion' ? '结束讨论' : '关闭上下文'}><IcClose size={14} /></button>
                </div>
              ) : null}
              {contextContent}
            </aside>
          ) : null}
        </div>
      </div>
      {dataManagementOpen && state.data ? (
        <DataManagementDialog
          data={state.data}
          onClose={closeDataManagement}
          onRefresh={load}
        />
      ) : null}
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
