// Host-native assistant shell. The host sidebar remains global navigation;
// YOLO owns Home / Plan / History and exactly one contextual foreground.
// Presentation is derived from usable width: focus replaces the board, while
// split adds one 340px context surface. Route, drafts, threads and requests do
// not change when presentation changes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { YoloDashboardData, YoloTodoRow } from '../../src/shared/dashboard.ts'
import type { YoloActionRequest, YoloUndoDescriptor } from '../../src/shared/actions.ts'
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
import { KanbanView, type BoardSurfaceKey } from './KanbanView.tsx'
import { MoreMenu } from './MoreMenu.tsx'
import { HistoryTabs, PageTabs, PlanTabs } from './PageTabs.tsx'
import { ForegroundContext, type SessionNavigationState } from './ForegroundContext.tsx'
import { readPanelState, writePanelState } from './state.ts'
import { buildTodaySurfaceModel } from './v2/today-surface-model.ts'
import { TaskActionPanel } from './v2/TaskActionPanel.tsx'
import type { LearningReceiptData, TaskActionIntent, TaskEditDraft } from './v2/model.ts'
import { postYoloAction } from './v2/api.ts'
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
  openSession?: (sessionId: string) => void | Promise<void>
  /** Increments when an external reminder signal asks to refresh and focus notifications. */
  notificationFocusRequest?: number
  /** Host-owned durable theme preference. Optional only for isolated renders. */
  themeControl?: { set: (theme: 'dark' | 'light') => void }
  /** Greeting selected by the sidebar for this panel opening. */
  surfaceLabel?: string
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

function detailDraftFor(todo: YoloTodoRow): TaskEditDraft {
  const due = todo.due_at ?? ''
  return {
    title: todo.title,
    dueAt: due.length === 10 ? `${due}T09:00` : due.slice(0, 16),
    priority: todo.priority ?? 'medium',
    milestone: todo.milestone_title ?? '',
    detail: todo.detail ?? '',
  }
}

export function YoloPanel({ left, onClose, openSession, notificationFocusRequest = 0, themeControl, surfaceLabel = '一起把事情理顺' }: YoloPanelProps): JSX.Element {
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
  const [detailDraft, setDetailDraft] = useState<TaskEditDraft | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [detailReceipt, setDetailReceipt] = useState<LearningReceiptData | null>(null)
  const [detailUndo, setDetailUndo] = useState<YoloUndoDescriptor | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [sweepTick, setSweepTick] = useState(0)
  const lastSig = useRef<string | null>(null)
  const previousNotificationFocusRequest = useRef<number | null>(null)
  const fltBtnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const chatToggleRef = useRef<HTMLButtonElement>(null)
  const chatOpenerRef = useRef<HTMLElement | null>(null)
  const contextRef = useRef<HTMLElement>(null)
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
    const returnTodoId = navigation.foreground.kind === 'none' ? undefined : navigation.foreground.kind === 'assistant_chat'
      ? undefined
      : navigation.foreground.item.id
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
    setDetailDraft(null)
    setDetailReceipt(null)
    setDetailUndo(null)
    setDetailError(null)
    focusChatOpener(returnFocusId, returnTodoId)
  }, [focusChatOpener, navigation.foreground, navigation.returnFocusId])

  const backForeground = useCallback((): void => {
    const returnFocusId = navigation.returnFocusId
    const returnTodoId = navigation.foreground.kind === 'none' || navigation.foreground.kind === 'assistant_chat'
      ? undefined
      : navigation.foreground.item.id
    setNavigation((current) => backFromForeground(current))
    setSessionNavigation({ status: 'idle' })
    if (navigation.foreground.kind === 'item_detail') {
      setDetailDraft(null)
      setDetailReceipt(null)
      setDetailUndo(null)
      setDetailError(null)
    }
    focusChatOpener(returnFocusId, returnTodoId)
  }, [focusChatOpener, navigation.foreground, navigation.returnFocusId])

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
    const threadKey = existing ?? `a-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    setDiscussionThreads((threads) => threads[key] === threadKey ? threads : { ...threads, [key]: threadKey })
    setNavigation((current) => openForeground(current, { kind: 'item_discussion', item, threadKey }, a.todoId ? `todo-${a.todoId}` : undefined))
  }, [discussionThreads, navigation.foreground, state.data?.cwd])

  const toggleAssistantChat = useCallback(() => {
    chatOpenerRef.current = chatToggleRef.current
    chatReturnTodoIdRef.current = undefined
    setNavigation((current) => current.foreground.kind === 'assistant_chat'
      ? { ...current, foreground: { kind: 'none' } }
      : openForeground(current, { kind: 'assistant_chat' }, 'yolo-assistant-chat'))
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
    setDetailDraft(detailDraftFor(todo))
    setDetailReceipt(null)
    setDetailUndo(null)
    setDetailError(null)
    setNavigation((current) => openForeground(current, { kind: 'item_detail', item }, `todo-${todo.id}`))
  }, [state.data?.cwd])

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
        history: (surfaces?.history.completed.length ?? 0) + (surfaces?.history.cancelled.length ?? 0),
      },
      partial: surfaces?.home.coverage.partial ?? false,
    }
  }, [state.data])

  const unhandled = state.data?.unhandled ?? 0
  const rangeActive = filter.rangeFrom !== null || filter.rangeTo !== null
  const milestoneTitles = useMemo(() => state.data?.milestones.map((m) => m.title) ?? [], [state.data])

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

  useEffect(() => {
    if (!state.data || !('item' in navigation.foreground) || navigation.foreground.item.entity !== 'todo') return
    const item = navigation.foreground.item
    const exists = state.data.todos.some((todo) => todo.id === item.id && (todo.scope_cwd ?? todo.ws?.cwd ?? state.data!.cwd) === item.scopeCwd)
    if (exists) return
    setNavigation((current) => ({ ...current, route: { page: 'home' }, foreground: { kind: 'none' } }))
    setDetailDraft(null)
    setDetailReceipt(null)
    setDetailUndo(null)
    setDetailError(null)
  }, [navigation.foreground, state.data])

  const foregroundTodo = useMemo(() => {
    if (!state.data || !('item' in navigation.foreground)) return undefined
    const target = navigation.foreground.item
    return state.data.todos.find((todo) => todo.id === target.id && (todo.scope_cwd ?? todo.ws?.cwd ?? state.data!.cwd) === target.scopeCwd)
  }, [navigation.foreground, state.data])
  const sourceForForeground = foregroundTodo?.source

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
  const detailAttention = useMemo(() => {
    if (!foregroundTodo || !state.data) return undefined
    const scopeCwd = foregroundTodo.scope_cwd ?? foregroundTodo.ws?.cwd ?? state.data.cwd
    return state.data.attention?.find((row) => row.todo_id === foregroundTodo.id && row.scope_cwd === scopeCwd)
  }, [foregroundTodo, state.data])
  const detailSource = sourceForForeground ? {
    type: sourceForForeground.type,
    label: sourceForForeground.label,
    sessionId: sourceForForeground.session_id,
    excerpt: sourceForForeground.excerpt,
    workspace: sourceForForeground.workspace,
  } : undefined

  useEffect(() => {
    if (navigation.foreground.kind === 'item_detail' && foregroundTodo && detailDraft === null) {
      setDetailDraft(detailDraftFor(foregroundTodo))
    }
  }, [detailDraft, foregroundTodo, navigation.foreground.kind])

  const runDetailAction = useCallback(async (request: YoloActionRequest): Promise<void> => {
    setDetailBusy(true)
    setDetailError(null)
    try {
      const outcome = await postYoloAction(request)
      setDetailReceipt(outcome.learningReceipt ?? null)
      setDetailUndo(outcome.undo ?? null)
      await load()
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : String(error))
    } finally {
      setDetailBusy(false)
    }
  }, [load])

  const handleDetailAction = useCallback((intent: TaskActionIntent): void => {
    if (!foregroundTodo || navigation.foreground.kind !== 'item_detail') return
    const scopeCwd = navigation.foreground.item.scopeCwd
    if (intent.type === 'discuss') {
      openAnchoredChat({ title: foregroundTodo.title, detail: foregroundTodo.detail, todoId: foregroundTodo.id, scopeCwd })
      return
    }
    if (intent.type === 'suppress' || intent.type === 'feedback') {
      if (!detailAttention) {
        setDetailError('当前事项没有可回应的助手判断，请刷新后重试。')
        return
      }
      void runDetailAction({
        action: intent.type,
        kind: 'attention',
        id: detailAttention.id,
        scope_cwd: scopeCwd,
        reason_version: detailAttention.reason_version,
        evidence_fingerprint: detailAttention.evidence_fingerprint,
        ...(intent.type === 'suppress'
          ? { suppressed_until: Date.now() + 86_400_000 }
          : { feedback_reason: intent.reason }),
      })
      return
    }
    const request: YoloActionRequest = intent.type === 'postpone'
      ? { action: 'postpone', kind: 'todo', id: foregroundTodo.id, scope_cwd: scopeCwd, due_at: intent.dueAt }
      : { action: intent.type, kind: 'todo', id: foregroundTodo.id, scope_cwd: scopeCwd }
    void runDetailAction(request)
  }, [detailAttention, foregroundTodo, navigation.foreground, openAnchoredChat, runDetailAction])

  const saveDetail = useCallback((): void => {
    if (!foregroundTodo || !detailDraft || navigation.foreground.kind !== 'item_detail') return
    void runDetailAction({
      action: 'update', kind: 'todo', id: foregroundTodo.id,
      scope_cwd: navigation.foreground.item.scopeCwd,
      title: detailDraft.title,
      due_at: detailDraft.dueAt || null,
      priority: detailDraft.priority,
      milestone_title: detailDraft.milestone,
      detail: detailDraft.detail,
    })
  }, [detailDraft, foregroundTodo, navigation.foreground, runDetailAction])

  const undoDetail = useCallback((): void => {
    if (!detailUndo || navigation.foreground.kind !== 'item_detail') return
    if (detailUndo.expires_at !== undefined && detailUndo.expires_at < Date.now()) {
      setDetailError('撤销窗口已结束；当前事项没有被再次修改。')
      setDetailUndo(null)
      return
    }
    void runDetailAction({ ...detailUndo, scope_cwd: navigation.foreground.item.scopeCwd } as YoloActionRequest)
      .then(() => { setDetailUndo(null) })
  }, [detailUndo, navigation.foreground, runDetailAction])

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
    ? <ChatPane variant={presentation === 'split' ? 'side' : 'full'} anchor={foreground.kind === 'item_discussion' ? chatAnchor : null} threadKey={chatThread} onDashboardRefresh={load} />
    : foreground.kind === 'item_detail' && foregroundTodo && detailDraft
      ? (
          <>
            {detailError ? <div className="err-line" role="alert">操作失败：{detailError}</div> : null}
            <TaskActionPanel
              item={{ ...foregroundTodo, source: detailSource }}
              reason={detailAttention?.explanation ?? '这是当前保存的事项信息。'}
              evidence={detailAttention?.evidence ?? []}
              source={detailSource}
              draft={detailDraft}
              busy={detailBusy}
              learningReceipt={detailReceipt}
              judgmentFeedbackEnabled={detailAttention !== undefined}
              modal={presentation === 'focus'}
              onAction={handleDetailAction}
              onDraftChange={setDetailDraft}
              onSave={saveDetail}
              onClose={closeForeground}
              onOpenSource={() => { if (sourceForForeground) openSourcePreview(foreground.item, sourceForForeground) }}
              onUndoReceipt={detailUndo ? undoDetail : undefined}
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
      : null

  return (
    <div
      className={`yolo-scope panel${compact ? ' compact' : ''}`}
      data-y-theme={theme}
      data-presentation={presentation}
      style={{ position: 'fixed', left, right: 0, top: 0, bottom: 0, zIndex: 10000 }}
    >
      <div className="panel-frame">
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
