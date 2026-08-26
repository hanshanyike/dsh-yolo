// Assistant board content for Home / Plan / History. The shell owns product
// navigation and the single foreground context; this component renders one
// active page section inside an independently scrolling body. Filtering stays in shared
// pure functions (src/shared/filters.ts); every mutation goes through
// POST /yolo/actions so a click and a chat reply produce identical transitions
// + audit events.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { YoloDashboardData, YoloItemSource, YoloLedgerEntry, YoloMilestoneRow, YoloTodoRow } from '../../src/shared/dashboard.ts'
import { isTodoOpen } from '../../src/shared/dashboard.ts'
import { buildDashboardSurfaces } from '../../src/shared/dashboard-surfaces.ts'
import type { YoloActionRequest, YoloUndoDescriptor } from '../../src/shared/actions.ts'
import {
  applyKanbanFilter,
  focusCounts,
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
import {
  TaskActionPanel,
  TodaySurface,
  type JudgmentEvidence,
  type JudgmentSource,
  type LearningReceiptData,
  type TaskActionIntent,
  type TaskEditDraft,
  type TodaySurfaceIntent,
  type YoloTodoRowV2,
} from './v2/index.ts'
import { postYoloAction, type ClientActionOutcome } from './v2/api.ts'
import { formatDueLabel } from './due-label.ts'

export interface KanbanViewProps {
  data: YoloDashboardData
  refresh: () => Promise<void>
  /** The persisted kanban filter (owned by the shell). */
  filter: KanbanFilter
  patchFilter: (patch: Partial<KanbanFilter>) => void
  /** Active product page section. */
  surface: BoardSurfaceKey
  /** Switch product page section (e.g. quick-add lands on Home). */
  onSurfaceChange: (surface: BoardSurfaceKey) => void
  /** Open the side chat anchored to a card (聊一聊). */
  onOpenChat: (anchor: ChatAnchor) => void
  /** Open a source preview in the shell's single foreground context. */
  onOpenSource?: (todo: YoloTodoRow, source: NonNullable<YoloTodoRow['source']>) => void
  onOpenChangeSource?: (change: YoloLedgerEntry, source: YoloItemSource) => void
  onOpenItemDetail?: (todo: YoloTodoRow) => void
  /** Increments when the header bell jumps to today's notification cards. */
  notifFocusTick?: number
}

export type BoardSurfaceKey =
  | 'home'
  | 'plan-today'
  | 'plan-upcoming'
  | 'plan-goals'
  | 'plan-all'
  | 'history-terminal'
  | 'history-changes'

interface EditorDraft {
  id: string
  scopeCwd?: string
  title: string
  due: string
  priority: string
  milestoneTitle: string
}

interface JudgmentBinding {
  id: string
  reasonVersion: string
  evidenceFingerprint: string
}

interface OpenTaskPanel {
  item: YoloTodoRowV2
  scopeCwd: string
  reason: string
  evidence: readonly JudgmentEvidence[]
  source?: JudgmentSource
  binding?: JudgmentBinding
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
  todo_reopened: '重新打开',
  reminder_fired: '提醒',
  brief_generated: '简报',
  goal_progress: '目标',
  goal_status: '目标',
  milestone_status: '里程碑',
  note: '记录',
  decision: '决策',
  milestone_reached: '里程碑',
  attention_seen: '已查看',
  attention_suppressed: '已忽略',
  attention_feedback: '反馈',
  action_denied: '未执行',
  todo_consolidated: '合并',
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

function draftForTodo(todo: YoloTodoRowV2): TaskEditDraft {
  const due = todo.due_at ?? ''
  const dueAt = due.length === 10 ? `${due}T09:00` : due.slice(0, 16)
  return {
    title: todo.title,
    dueAt,
    priority: todo.priority ?? 'medium',
    milestone: todo.milestone_title ?? '',
    detail: todo.detail ?? '',
  }
}

/** Due text: 今天/明天/昨天 · 周X M/D within a week · M/D beyond (5.2). */
const fmtDue = formatDueLabel

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
  if (kind === 'brief') return title.includes('早报') ? '早报' : title.includes('晚报') ? '晚报' : '简报'
  return '通知'
}

/** Legacy brief/reminder rows may contain emoji or a replacement glyph from
 * old Windows encoding. Icons belong to the component chrome, not user text. */
function cleanNotificationText(value: string): string {
  return value.replace(/^[\uFFFD⏰☀🌙]\s*/u, '')
}

const noop = (): void => {}

export function KanbanView({ data, refresh, filter, patchFilter, surface, onSurfaceChange, onOpenChat, onOpenSource, onOpenChangeSource, onOpenItemDetail, notifFocusTick = 0 }: KanbanViewProps): JSX.Element {
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [completing, setCompleting] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ text: string; undo?: YoloTodoRow } | null>(null)
  const [editor, setEditor] = useState<EditorDraft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [quickBusy, setQuickBusy] = useState(false)
  const [notifShowAll, setNotifShowAll] = useState(false)
  const [renameDraft, setRenameDraft] = useState<{ kind: 'goal' | 'milestone'; id: string; title: string } | null>(null)
  const [msPop, setMsPop] = useState<{ id: string; x: number } | null>(null)
  const [taskPanel, setTaskPanel] = useState<OpenTaskPanel | null>(null)
  const [taskDraft, setTaskDraft] = useState<TaskEditDraft | null>(null)
  const [taskReceipt, setTaskReceipt] = useState<LearningReceiptData | null>(null)
  const [taskUndo, setTaskUndo] = useState<YoloUndoDescriptor | null>(null)
  const [judgmentExpanded, setJudgmentExpanded] = useState(false)
  const [terminalView, setTerminalView] = useState<'completed' | 'cancelled'>('completed')
  // v0.3.2: completion/处理 animations — rows retire with a height collapse
  // before being removed, so nothing "jumps" out of the board.
  const [, setRetiring] = useState<YoloTodoRow[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)
  const taskReturnFocus = useRef<HTMLElement | null>(null)

  // Toast auto-retire (5.1): 2.4s; completion toasts hold the 4s undo window (5.4).
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => { setToast(null) }, toast.undo ? 4_000 : 2_400)
    return () => { window.clearTimeout(t) }
  }, [toast])

  // Each face scrolls independently: switching tabs starts at the top.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [surface])

  // The header bell jumps to today's notification cards.
  useEffect(() => {
    if (notifFocusTick > 0 && surface === 'home') notifRef.current?.scrollIntoView({ block: 'start' })
  }, [notifFocusTick, surface])

  // Map every board row to its owning workspace cwd so an action on an
  // all-workspaces row routes to that scope (the board is always scope=all).
  const wsCwdById = useMemo(() => {
    const m = new Map<string, string | null>()
    const add = (id: string, cwd: string | undefined): void => {
      if (!cwd) return
      const current = m.get(id)
      if (current === undefined || current === cwd) m.set(id, cwd)
      else m.set(id, null)
    }
    for (const t of data.todos) add(t.id, t.scope_cwd ?? t.ws?.cwd)
    for (const g of data.goals) add(g.id, g.ws?.cwd)
    for (const ms of data.milestones) add(ms.id, ms.ws?.cwd)
    for (const n of data.notifications) add(n.id, n.scope_cwd ?? n.ws?.cwd)
    return m
  }, [data])

  const act = useCallback(
    async (
      key: string,
      body: YoloActionRequest,
      options: { refresh?: boolean } = {},
    ): Promise<ClientActionOutcome | null> => {
      setBusyKey(key)
      setActionError(null)
      try {
        const payload = { ...body }
        const scopeCwd = wsCwdById.get(String(body.id))
        if (!payload.scope_cwd && scopeCwd) payload.scope_cwd = scopeCwd
        const outcome = await postYoloAction(payload)
        if (options.refresh !== false) await refresh()
        return outcome
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e))
        return null
      } finally {
        setBusyKey(null)
      }
    },
    [refresh, wsCwdById],
  )

  // Complete flow (5.4): optimistic fill + retire, POST, refresh, toast with undo.
  const completeTodo = useCallback(async (t: YoloTodoRow): Promise<void> => {
    setCompleting((s) => { const n = new Set(s); n.add(t.id); return n })
    const ok = await act(t.id, { action: 'complete', kind: 'todo', id: t.id, scope_cwd: t.scope_cwd ?? t.ws?.cwd })
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
    const ok = await act(`reopen-${t.id}`, { action: 'reopen', kind: 'todo', id: t.id, scope_cwd: t.scope_cwd ?? t.ws?.cwd })
    if (ok) {
      setRetiring((r) => r.filter((x) => x.id !== t.id))
      setToast({ text: `已撤销 · ${t.title}` })
    }
  }, [act])

  const counts = useMemo(() => focusCounts(data.todos), [data.todos])
  const surfaces = useMemo(() => buildDashboardSurfaces(data), [data])
  const milestoneTitles = useMemo(() => data.milestones.map((m) => m.title), [data.milestones])

  // Per-face filtered sets — the shared filter functions stay the source of
  // truth: the face only picks the preset the tab maps to.
  const visibleDone = useMemo(
    () => sortForKanban(applyKanbanFilter(data.todos, { ...filter, preset: 'done' })),
    [data.todos, filter],
  )
  const visibleCancelled = useMemo(
    () => sortForKanban(data.todos.filter((todo) => todo.status === 'cancelled')),
    [data.todos],
  )
  const visiblePlanToday = useMemo(
    () => sortForKanban(applyKanbanFilter(surfaces.plan.today, { ...filter, preset: 'all' })),
    [filter, surfaces.plan.today],
  )
  const visiblePlanUpcoming = useMemo(
    () => sortForKanban(applyKanbanFilter(surfaces.plan.upcoming, { ...filter, preset: 'all' })),
    [filter, surfaces.plan.upcoming],
  )
  const visiblePlanAll = useMemo(
    () => sortForKanban(applyKanbanFilter(surfaces.plan.all, { ...filter, preset: 'all' })),
    [filter, surfaces.plan.all],
  )

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
      scope_cwd: editor.scopeCwd,
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
      onSurfaceChange('home')
    }
    setQuickBusy(false)
    return ok !== null
  }, [act, quickBusy, onSurfaceChange])

  const openTaskPanel = useCallback((next: OpenTaskPanel): void => {
    taskReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setTaskPanel(next)
    setTaskDraft(draftForTodo(next.item))
    setTaskReceipt(null)
    setTaskUndo(null)
  }, [])

  const dismissTaskPanel = useCallback((restoreFocus: boolean): void => {
    setTaskPanel(null)
    setTaskDraft(null)
    setTaskReceipt(null)
    setTaskUndo(null)
    if (restoreFocus) window.setTimeout(() => { taskReturnFocus.current?.focus() }, 0)
  }, [])

  const closeTaskPanel = useCallback((): void => {
    dismissTaskPanel(true)
  }, [dismissTaskPanel])

  const openJudgmentPanel = useCallback((todo: YoloTodoRowV2, binding: JudgmentBinding): void => {
    if (onOpenItemDetail) {
      onOpenItemDetail(todo)
      return
    }
    const attention = data.attention?.find((row) =>
      (row.id === binding.id || row.todo_id === todo.id)
      && row.scope_cwd === (todo.scope_cwd ?? todo.ws?.cwd ?? data.cwd),
    )
    openTaskPanel({
      item: todo,
      scopeCwd: todo.scope_cwd ?? todo.ws?.cwd ?? data.cwd,
      reason: attention?.explanation ?? '根据当前事项状态，需要你确认下一步。',
      evidence: attention?.evidence ?? [],
      source: todo.source,
      binding,
    })
  }, [data, onOpenItemDetail, openTaskPanel])

  const handleTodayIntent = useCallback((intent: TodaySurfaceIntent): void => {
    if (intent.type === 'quick_capture') return
    if (intent.type === 'open_empty_chat') {
      onOpenChat({ title: '梳理今天', detail: '从今天想继续推进的一件事开始。' })
      return
    }
    if (intent.type === 'mark_judgment_seen') {
      void act(`seen-${intent.judgmentId}`, {
        action: 'seen', kind: 'attention', id: intent.judgmentId, scope_cwd: intent.scopeCwd,
        reason_version: intent.reasonVersion, evidence_fingerprint: intent.evidenceFingerprint,
      }, { refresh: false })
      return
    }
    if (intent.type === 'expand_judgment') {
      setJudgmentExpanded(true)
      return
    }
    if (intent.type === 'collapse_judgment') {
      setJudgmentExpanded(false)
      return
    }
    if (intent.type === 'complete_todo') {
      void completeTodo(intent.todo)
      return
    }
    if (intent.type === 'open_task') {
      if (onOpenItemDetail) {
        onOpenItemDetail(intent.todo)
        return
      }
      openTaskPanel({
        item: intent.todo,
        scopeCwd: intent.scopeCwd,
        reason: intent.todo.overdue ? '这项事情已经逾期。' : intent.todo.stale ? '这项事情已经一段时间没有变化。' : '这项事情安排在今天。',
        evidence: [],
        source: intent.todo.source,
      })
      return
    }
    if (intent.type === 'open_source') {
      if (intent.todo.source) onOpenSource?.(intent.todo, intent.todo.source)
      return
    }
    if (intent.type === 'open_ledger' || intent.type === 'review_changes') {
      onSurfaceChange('history-changes')
      return
    }
    if (intent.type === 'discuss_closure') {
      onOpenChat({ title: '今天的工作与生活收束', detail: '回顾今天的变化，确认仍需要回应的事情。' })
      return
    }
    if (intent.type === 'suppress_judgment') {
      void (async () => {
        const outcome = await act(`suppress-${intent.judgmentId}`, {
          action: 'suppress', kind: 'attention', id: intent.judgmentId, scope_cwd: intent.scopeCwd,
          reason_version: intent.reasonVersion, evidence_fingerprint: intent.evidenceFingerprint,
          suppressed_until: Date.now() + DAY_MS,
        })
        if (outcome?.learningReceipt) setToast({ text: outcome.learningReceipt.summary })
      })()
      return
    }
    if (intent.type === 'feedback_judgment') {
      const todo = data.todos.find((row) => row.id === data.attention?.[0]?.todo_id && (row.scope_cwd ?? row.ws?.cwd ?? data.cwd) === intent.scopeCwd)
      if (todo) {
        openJudgmentPanel(todo, {
          id: intent.judgmentId,
          reasonVersion: intent.reasonVersion,
          evidenceFingerprint: intent.evidenceFingerprint,
        })
      }
      return
    }
    if (intent.type === 'judgment_action') {
      const binding = {
        id: data.attention?.[0]?.id ?? intent.todo.id,
        reasonVersion: intent.reasonVersion,
        evidenceFingerprint: intent.evidenceFingerprint,
      }
      if (intent.action === 'complete') {
        void completeTodo(intent.todo)
      } else if (intent.action === 'postpone_tomorrow') {
        void (async () => {
          const outcome = await act(`postpone-${intent.todo.id}`, {
            action: 'postpone', kind: 'todo', id: intent.todo.id,
            due_at: nextDayStr(intent.todo.due_at), scope_cwd: intent.scopeCwd,
          })
          if (outcome?.learningReceipt) setToast({ text: outcome.learningReceipt.summary })
        })()
      } else if (intent.action === 'discuss') {
        onOpenChat({
          title: intent.todo.title,
          detail: data.attention?.[0]?.explanation ?? intent.todo.detail,
          todoId: intent.todo.id,
          scopeCwd: intent.scopeCwd,
          source: intent.todo.source,
        })
      } else {
        openJudgmentPanel(intent.todo, binding)
      }
    }
  }, [act, completeTodo, data, onOpenChat, onOpenItemDetail, onOpenSource, onSurfaceChange, openJudgmentPanel, openTaskPanel])

  const handleTaskAction = useCallback((intent: TaskActionIntent): void => {
    if (!taskPanel) return
    if (intent.type === 'discuss') {
      // The task dialog and anchored chat both own the right edge. Retire the
      // modal first, without its delayed focus restoration stealing focus from
      // ChatPane's autofocus input, so the chat is visible and interactive.
      dismissTaskPanel(false)
      onOpenChat({
        title: taskPanel.item.title,
        detail: taskPanel.reason,
        todoId: taskPanel.item.id,
        scopeCwd: taskPanel.scopeCwd,
        source: taskPanel.source,
      })
      return
    }
    void (async () => {
      let request: YoloActionRequest
      if (intent.type === 'postpone') {
        request = { action: 'postpone', kind: 'todo', id: taskPanel.item.id, due_at: intent.dueAt, scope_cwd: taskPanel.scopeCwd }
      } else if (intent.type === 'suppress' || intent.type === 'feedback') {
        if (!taskPanel.binding) {
          setActionError('当前事项没有可回应的助手判断，请刷新后重试。')
          return
        }
        request = {
          action: intent.type,
          kind: 'attention',
          id: taskPanel.binding.id,
          scope_cwd: taskPanel.scopeCwd,
          reason_version: taskPanel.binding.reasonVersion,
          evidence_fingerprint: taskPanel.binding.evidenceFingerprint,
          ...(intent.type === 'suppress'
            ? { suppressed_until: Date.now() + DAY_MS }
            : { feedback_reason: intent.reason }),
        }
      } else {
        request = { action: intent.type, kind: 'todo', id: taskPanel.item.id, scope_cwd: taskPanel.scopeCwd }
      }
      const outcome = await act(`panel-${taskPanel.item.id}`, request)
      if (!outcome) return
      setTaskReceipt(outcome.learningReceipt ?? null)
      setTaskUndo(outcome.undo ?? null)
      setTaskPanel((current) => current ? { ...current, item: { ...current.item, ...outcome.item } } : current)
    })()
  }, [act, dismissTaskPanel, onOpenChat, taskPanel])

  const saveTaskPanel = useCallback((): void => {
    if (!taskPanel || !taskDraft) return
    void (async () => {
      const outcome = await act(`panel-edit-${taskPanel.item.id}`, {
        action: 'update',
        kind: 'todo',
        id: taskPanel.item.id,
        scope_cwd: taskPanel.scopeCwd,
        title: taskDraft.title,
        due_at: taskDraft.dueAt || null,
        priority: taskDraft.priority,
        milestone_title: taskDraft.milestone,
        detail: taskDraft.detail,
      })
      if (!outcome) return
      setTaskPanel((current) => current ? { ...current, item: { ...current.item, ...outcome.item } } : current)
      setToast({ text: '已保存事项编辑' })
    })()
  }, [act, taskDraft, taskPanel])

  const undoTaskReceipt = useCallback((): void => {
    if (!taskPanel || !taskUndo) return
    if (taskUndo.expires_at !== undefined && taskUndo.expires_at < Date.now()) {
      setActionError('撤销窗口已结束；当前事项没有被再次修改。')
      setTaskUndo(null)
      return
    }
    void (async () => {
      const outcome = await act(`panel-undo-${taskPanel.item.id}`, {
        ...taskUndo,
        scope_cwd: taskPanel.scopeCwd,
      })
      if (!outcome) return
      setTaskReceipt(outcome.learningReceipt ?? null)
      setTaskUndo(null)
    })()
  }, [act, taskPanel, taskUndo])

  const rowActions = (t: YoloTodoRow): { onComplete: () => void; onAct: (action: string, extra?: { due_at?: string }) => void; onEdit: () => void; onChat: () => void; onSource?: () => void } => ({
    onComplete: () => { void completeTodo(t) },
    onAct: (action, extra) => { void act(t.id, { action, kind: 'todo', id: t.id, scope_cwd: t.scope_cwd ?? t.ws?.cwd, ...extra }) },
    onEdit: () => { setEditor({ id: t.id, scopeCwd: t.scope_cwd ?? t.ws?.cwd, title: t.title, due: dayOf(t.due_at), priority: t.priority ?? '', milestoneTitle: t.milestone_title ?? '' }) },
    onChat: () => {
      onOpenChat({
        title: t.title,
        detail: t.due_at ? `到期 ${t.due_at}` : null,
        todoId: t.id,
        scopeCwd: t.scope_cwd ?? t.ws?.cwd,
        source: t.source ? {
          type: t.source.type,
          label: t.source.label,
          sessionId: t.source.session_id,
          excerpt: t.source.excerpt,
        } : undefined,
      })
    },
    onSource: t.source ? () => { onOpenSource?.(t, t.source!) } : undefined,
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
          await act(`del-${id}`, { action: 'cancel', kind: 'todo', id, scope_cwd: t.scope_cwd ?? t.ws?.cwd })
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

  const caps = (
    <div className="caps" role="group" aria-label="聚焦筛选">
      {(Object.keys(FOCUS_LABEL) as FocusBucket[]).map((k) => (
        <button
          key={k}
          type="button"
          className={`cap${filter.focus === k ? ' on' : ''}`}
          aria-pressed={filter.focus === k}
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
              <div style={{ fontWeight: 500 }}>{cleanNotificationText(n.title)}</div>
              {n.body && <div style={{ color: 'var(--y-text-2)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{cleanNotificationText(n.body)}</div>}
            </div>
            <div className="notif-acts">
              {n.kind === 'reminder' && n.todo_id && (
                <>
                  <button type="button" className="nact" disabled={busyKey === `n-${n.id}`} onClick={() => { void act(`n-${n.id}`, { action: 'complete', kind: 'todo', id: n.todo_id!, scope_cwd: n.scope_cwd ?? n.ws?.cwd }) }}>
                    <IcCheck size={12} />完成
                  </button>
                  <button type="button" className="nact" disabled={busyKey === `n-${n.id}`} onClick={() => { void act(`n-${n.id}`, { action: 'postpone', kind: 'todo', id: n.todo_id!, due_at: nextDayStr(dueFor?.due_at ?? null), scope_cwd: n.scope_cwd ?? n.ws?.cwd }) }}>
                    <IcPlusDay size={12} />推迟 1 天
                  </button>
                  <button type="button" className="nact" disabled={busyKey === `n-${n.id}`} onClick={() => { void act(`n-${n.id}`, { action: 'remind_again', kind: 'todo', id: n.todo_id!, scope_cwd: n.scope_cwd ?? n.ws?.cwd }) }}>
                    <IcBell size={12} />再提醒
                  </button>
                </>
              )}
              <button type="button" className="nact nact--chat" onClick={() => {
                onOpenChat({
                  title: cleanNotificationText(n.title),
                  detail: n.body ?? null,
                  todoId: n.todo_id ?? undefined,
                  scopeCwd: n.scope_cwd ?? n.ws?.cwd,
                })
              }}>
                <IcChat size={12} />聊一聊
              </button>
              <button type="button" className="nact" disabled={busyKey === `n-${n.id}`} onClick={() => { void act(`n-${n.id}`, { action: 'handled', kind: 'notification', id: n.id, scope_cwd: n.scope_cwd ?? n.ws?.cwd }) }}>
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

  return (
    <div
      id={`yolo-surface-${surface}`}
      role="tabpanel"
      aria-label="助手内容"
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <div className="p-body" ref={bodyRef} aria-hidden={taskPanel ? true : undefined}>
        <main className="p-main">
          {actionError && (
            <div className="err-line">
              <span>操作失败：{actionError}</span>
              <button type="button" className="nact" onClick={() => { setActionError(null) }}>关闭</button>
            </div>
          )}

          {surface === 'home' && (
            <>
              <TodaySurface
                data={data}
                busyTodoId={busyKey ?? undefined}
                judgmentExpanded={judgmentExpanded}
                renderQuickCapture={() => <CaptureBar busy={quickBusy} onSubmit={sendQuickAdd} />}
                onIntent={handleTodayIntent}
              />
              {openNotifications.length > 0 && notifCards}
            </>
          )}

          {surface === 'plan-today' && (
            <>
              <div className="heading"><h2>今天</h2><span className="hint">{visiblePlanToday.length} 件</span></div>
              {visiblePlanToday.length > 0 ? (
                <section className="sec today" aria-label={`今天 ${visiblePlanToday.length}`}>
                  {visiblePlanToday.map((todo) => renderRow(todo))}
                </section>
              ) : (
                <div className="empty"><h4>今天没有待处理安排</h4><p>逾期和今天到期的事项会出现在这里。</p></div>
              )}
            </>
          )}

          {surface === 'plan-upcoming' && (
            <>
              <div className="heading"><h2>接下来</h2><span className="hint">有明确日期的后续安排</span></div>
              {visiblePlanUpcoming.length > 0 ? (
                <section className="sec" aria-label={`接下来 ${visiblePlanUpcoming.length}`}>
                  {visiblePlanUpcoming.map((todo) => renderRow(todo))}
                </section>
              ) : (
                <div className="empty">
                  <h4>没有即将到来的事</h4>
                  <p>有明确后续日期的事项会出现在这里。</p>
                </div>
              )}
            </>
          )}

          {surface === 'plan-all' && (
            <>
              <div className="heading"><h2>全部计划</h2><span className="hint">{visiblePlanAll.length} 件开放事项</span></div>
              {caps}
              {visiblePlanAll.length > 0 ? (
                <section className="sec" aria-label={`全部计划 ${visiblePlanAll.length}`}>
                  {visiblePlanAll.map((todo) => renderRow(todo))}
                </section>
              ) : (
                <div className="empty"><h4>没有开放事项</h4><p>你记录的计划会保留在这里。</p></div>
              )}
            </>
          )}

          {surface === 'history-terminal' && (
            <>
              <div className="heading"><h2>{terminalView === 'completed' ? '已完成' : '已取消'}</h2><span className="hint">{terminalView === 'completed' ? visibleDone.length : visibleCancelled.length} 件</span></div>
              <div className="caps" role="group" aria-label="终态事项筛选">
                <button type="button" className={`cap${terminalView === 'completed' ? ' on' : ''}`} onClick={() => { setTerminalView('completed') }}>已完成 <span className="num">{visibleDone.length}</span></button>
                <button type="button" className={`cap${terminalView === 'cancelled' ? ' on' : ''}`} onClick={() => { setTerminalView('cancelled') }}>已取消 <span className="num">{visibleCancelled.length}</span></button>
              </div>
              {(terminalView === 'completed' ? visibleDone : visibleCancelled).length === 0 ? (
                <div className="empty">
                  <h4>{terminalView === 'completed' ? '还没有完成的事' : '没有已取消事项'}</h4>
                  <p>{terminalView === 'completed' ? '完成的事项会出现在这里。' : '取消的事项会单独保留在这里。'}</p>
                </div>
              ) : (
                <div className="sec">
                  {(terminalView === 'completed' ? visibleDone : visibleCancelled).map((t) => (
                    <TodoRowView
                      key={`${t.scope_cwd ?? t.ws?.cwd ?? ''}:${t.id}`}
                      t={t}
                      busy={busyKey === `reopen-${t.id}`}
                      completing={false}
                      onComplete={noop}
                      onAct={noop}
                      onEdit={noop}
                      onChat={noop}
                      onSource={t.source ? () => { onOpenSource?.(t, t.source!) } : undefined}
                      onReopen={() => { void act(`reopen-${t.id}`, { action: 'reopen', kind: 'todo', id: t.id, scope_cwd: t.scope_cwd ?? t.ws?.cwd }) }}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {surface === 'plan-goals' && (
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
                    if (d && d.title.trim() && d.title !== g.title) await act(`goal-${g.id}`, { action: 'rename', kind: 'goal', id: g.id, title: d.title.trim(), scope_cwd: g.ws?.cwd })
                  }}
                  onRenameCancel={() => { setRenameDraft(null) }}
                  onAbandon={() => { void act(`goal-${g.id}`, { action: 'abandon', kind: 'goal', id: g.id, scope_cwd: g.ws?.cwd }) }}
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
                    if (d && d.title.trim() && d.title !== m.title) await act(`ms-${m.id}`, { action: 'rename', kind: 'milestone', id: m.id, title: d.title.trim(), scope_cwd: m.ws?.cwd })
                  }}
                  onRenameCancel={() => { setRenameDraft(null) }}
                  onStatus={(m, status) => { void act(`ms-${m.id}`, { action: 'set_status', kind: 'milestone', id: m.id, status, scope_cwd: m.ws?.cwd }) }}
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

          {surface === 'history-changes' && (
            <>
              <div className="heading">
                <h2>最近变化</h2>
                <span className="hint">{surfaces.history.recentChanges.length} 条用户可见变化</span>
              </div>
              {surfaces.history.recentChanges.length === 0 ? (
                <div className="empty">
                  <h4>还没有可展示的变化</h4>
                  <p>新增、改期、完成与取消会按时间保留在这里。</p>
                </div>
              ) : (
                <div style={{ marginTop: 8 }}>
                  {surfaces.history.recentChanges.map((e) => (
                    <div key={e.id} className={`lg-row${e.kind === 'todo_completed' ? ' is-done' : ''}`}>
                      <span className="lg-status" aria-hidden="true">
                        {e.kind === 'todo_completed' ? <IcCheck className="ic-ok" size={12} /> : null}
                      </span>
                      <span className="lg-time">{fmtTime(e.occurred_at)}</span>
                      <span className="lg-type">{LEDGER_KIND_LABEL[e.kind] ?? e.kind}</span>
                      <span className="lg-sum" title={e.summary}>{e.summary}</span>
                      {e.label && (e.session_id && onOpenChangeSource ? (
                        <button
                          type="button"
                          className="lg-src-btn"
                          title="查看来源"
                          onClick={() => { onOpenChangeSource(e, {
                            type: 'session', label: e.label, session_id: e.session_id, workspace: e.ws,
                          }) }}
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

      {taskPanel && taskDraft ? (
        <TaskActionPanel
          item={taskPanel.item}
          reason={taskPanel.reason}
          evidence={taskPanel.evidence}
          source={taskPanel.source}
          draft={taskDraft}
          busy={busyKey?.startsWith('panel-') === true}
          learningReceipt={taskReceipt}
          judgmentFeedbackEnabled={taskPanel.binding !== undefined}
          onAction={handleTaskAction}
          onDraftChange={setTaskDraft}
          onSave={saveTaskPanel}
          onClose={closeTaskPanel}
          onOpenSource={() => {
            if (taskPanel.item.source) onOpenSource?.(taskPanel.item, taskPanel.item.source)
          }}
          onUndoReceipt={taskUndo ? undoTaskReceipt : undefined}
        />
      ) : null}

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

function TodoRowView({ t, busy, completing, retiring, onComplete, onAct, onEdit, onChat, onSource, onReopen }: {
  t: YoloTodoRow
  busy: boolean
  completing: boolean
  retiring?: boolean
  onComplete: () => void
  onAct: (action: string, extra?: { due_at?: string }) => void
  onEdit: () => void
  onChat: () => void
  onSource?: () => void
  onReopen?: () => void
}): JSX.Element {
  const open = isTodoOpen(t.status)
  const done = t.status === 'done' || t.status === 'completed'
  const terminal = !open
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
    terminal ? ' done-row' : '',
  ].join('')
  return (
    <div
      className={rowCls}
      data-kb-row={open && !isRetiring ? '1' : undefined}
      role="listitem"
      tabIndex={open && !isRetiring ? 0 : undefined}
      aria-label={open ? `任务：${t.title}` : done ? `已完成：${t.title}` : `已取消：${t.title}`}
      onKeyDown={(e) => {
        if (isRetiring || !open) return
        // Only the ROW itself owns Space/Enter/E/↑/↓. When focus sits on a
        // child control (完成/推迟/编辑/聊一聊), let the key activate THAT control
        // — without this guard, Space on 「聊一聊」 completed the todo.
        if (e.target !== e.currentTarget) return
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onComplete() }
        else if (e.key.toLowerCase() === 'e') { e.preventDefault(); onEdit() }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); navRow(e.key === 'ArrowDown' ? 1 : -1) }
      }}
    >
      <button
        type="button"
        className={`ctl${terminal || completing ? ' done' : ''}`}
        onClick={() => { if (open) onComplete(); else onReopen?.() }}
        aria-label={open ? `完成：${t.title}` : `重新打开：${t.title}`}
        title={open ? '标记完成' : '重新打开'}
      >
        <IcCheck size={9} />
      </button>
      <div className="row-main">
        <div className="row-title" title={t.title}>
          {showFlag && <IcFlag size={12} className={isUrgent ? 'urgent' : undefined} />}
          <span className={`tt${terminal ? ' done' : ''}`}>{t.title}</span>
          {t.status === 'in_progress' && <span className="inprog-tag">进行中</span>}
        </div>
        <div className="row-meta">
          <span className="due">{done && t.completed_at ? fmtDone(t.completed_at) : t.status === 'cancelled' ? '已取消' : fmtDue(t.due_at)}</span>
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
          {t.source && onSource ? (
            <button type="button" className="src" title="查看来源" onClick={(event) => { event.stopPropagation(); onSource() }}>
              <IcPin size={11} />
              <span>{t.source.label}</span>
            </button>
          ) : t.session_label ? (
            <span className="src" title={t.session_label}><IcPin size={11} /><span>{t.session_label}</span></span>
          ) : null}
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
      {!open && onReopen ? (
        <div className="row-acts">
          <button type="button" className="nact" disabled={busy} onClick={onReopen}>重新打开</button>
        </div>
      ) : null}
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
        <textarea
          autoFocus
          className="ef-input ef-title"
          aria-label="任务标题"
          rows={2}
          value={draft.title}
          onChange={(e) => { onChange({ ...draft, title: e.target.value }) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              onSave()
            }
          }}
        />
        <input type="date" className="ef-input ef-date" aria-label="到期日" value={draft.due} onChange={(e) => { onChange({ ...draft, due: e.target.value }) }} />
        <select className="ef-sel" aria-label="优先级" value={draft.priority} onChange={(e) => { onChange({ ...draft, priority: e.target.value }) }}>
          <option value="">优先级</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="urgent">urgent</option>
        </select>
        <select className="ef-sel" aria-label="里程碑" value={draft.milestoneTitle} onChange={(e) => { onChange({ ...draft, milestoneTitle: e.target.value }) }}>
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
      <div className={`goal-track${target && pop ? ' has-pop' : ''}`}>
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
          <div className="ms-pop" role="dialog" aria-label={`编辑里程碑：${target.title}`} style={{ '--x': `${pop.x}%` } as React.CSSProperties}>
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
