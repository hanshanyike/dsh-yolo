import { useCallback, useMemo, useRef, useState } from 'react'
import type { YoloActionRequest, YoloUndoDescriptor } from '../../../src/contracts/actions.ts'
import type { YoloDashboardData, YoloTodoRow } from '../../../src/contracts/dashboard.ts'
import type { KanbanFilter } from '../../../src/shared/filters.ts'
import { localDateStr } from '../../../src/shared/text.ts'
import type { ChatAnchor } from '../ChatPane.tsx'
import type { BoardSurfaceKey } from './surfaces.ts'
import { postYoloAction, type ClientActionOutcome } from '../v2/api.ts'
import type {
  JudgmentEvidence,
  JudgmentSource,
  LearningReceiptData,
  TaskActionIntent,
  TaskEditDraft,
  TodaySurfaceIntent,
  YoloTodoRowV2,
} from '../v2/index.ts'

const DAY_MS = 86_400_000

interface JudgmentBinding {
  id: string
  reasonVersion: string
  evidenceFingerprint: string
}

export interface OpenTaskPanel {
  item: YoloTodoRowV2
  scopeCwd: string
  reason: string
  evidence: readonly JudgmentEvidence[]
  source?: JudgmentSource
  binding?: JudgmentBinding
}

function dayOf(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : ''
}

function localDayStr(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function nextDayStr(dueAt: string | null | undefined): string {
  const today = localDateStr()
  const dueDay = dayOf(dueAt)
  const base = dueDay > today ? dueDay : today
  const date = new Date(`${base}T00:00:00`)
  date.setDate(date.getDate() + 1)
  return localDayStr(date)
}

function draftForTodo(todo: YoloTodoRowV2): TaskEditDraft {
  const due = todo.due_at ?? ''
  return {
    title: todo.title,
    dueAt: due.length === 10 ? `${due}T09:00` : due.slice(0, 16),
    priority: todo.priority ?? 'medium',
    milestone: todo.milestone_title ?? '',
    detail: todo.detail ?? '',
  }
}

export interface KanbanActionControllerOptions {
  data: YoloDashboardData
  refresh: () => Promise<void>
  filter: KanbanFilter
  patchFilter: (patch: Partial<KanbanFilter>) => void
  onSurfaceChange: (surface: BoardSurfaceKey) => void
  onOpenChat: (anchor: ChatAnchor) => void
  onOpenSource?: (todo: YoloTodoRow, source: NonNullable<YoloTodoRow['source']>) => void
  onOpenItemDetail?: (todo: YoloTodoRow) => void
}

export function buildActionScopeIndex(data: YoloDashboardData): ReadonlyMap<string, string | null> {
  const result = new Map<string, string | null>()
  const add = (id: string, cwd: string | undefined): void => {
    if (!cwd) return
    const current = result.get(id)
    if (current === undefined || current === cwd) result.set(id, cwd)
    else result.set(id, null)
  }
  for (const todo of data.todos) add(todo.id, todo.scope_cwd ?? todo.ws?.cwd)
  for (const goal of data.goals) add(goal.id, goal.ws?.cwd)
  for (const milestone of data.milestones) add(milestone.id, milestone.ws?.cwd)
  for (const notification of data.notifications) add(notification.id, notification.scope_cwd ?? notification.ws?.cwd)
  return result
}

export function withActionScope(
  body: YoloActionRequest,
  scopeIndex: ReadonlyMap<string, string | null>,
): YoloActionRequest {
  if (body.scope_cwd) return body
  const scopeCwd = scopeIndex.get(String(body.id))
  return scopeCwd ? { ...body, scope_cwd: scopeCwd } : body
}

export function useKanbanActions(options: KanbanActionControllerOptions) {
  const { data, refresh, onSurfaceChange, onOpenChat, onOpenSource, onOpenItemDetail } = options
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [completing, setCompleting] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ text: string; undo?: YoloTodoRow } | null>(null)
  const [quickBusy, setQuickBusy] = useState(false)
  const [taskPanel, setTaskPanel] = useState<OpenTaskPanel | null>(null)
  const [taskDraft, setTaskDraft] = useState<TaskEditDraft | null>(null)
  const [taskReceipt, setTaskReceipt] = useState<LearningReceiptData | null>(null)
  const [taskUndo, setTaskUndo] = useState<YoloUndoDescriptor | null>(null)
  const [judgmentExpanded, setJudgmentExpanded] = useState(false)
  const [, setRetiring] = useState<YoloTodoRow[]>([])
  const taskReturnFocus = useRef<HTMLElement | null>(null)

  const workspaceById = useMemo(() => buildActionScopeIndex(data), [data])

  const act = useCallback(async (
    key: string,
    body: YoloActionRequest,
    actionOptions: { refresh?: boolean } = {},
  ): Promise<ClientActionOutcome | null> => {
    setBusyKey(key)
    setActionError(null)
    try {
      const payload = withActionScope(body, workspaceById)
      const outcome = await postYoloAction(payload)
      if (actionOptions.refresh !== false) await refresh()
      return outcome
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
      return null
    } finally {
      setBusyKey(null)
    }
  }, [refresh, workspaceById])

  const completeTodo = useCallback(async (todo: YoloTodoRow): Promise<void> => {
    setCompleting((current) => new Set(current).add(todo.id))
    const outcome = await act(todo.id, {
      action: 'complete', kind: 'todo', id: todo.id, scope_cwd: todo.scope_cwd ?? todo.ws?.cwd,
    })
    setCompleting((current) => {
      const next = new Set(current)
      next.delete(todo.id)
      return next
    })
    if (outcome) {
      const snapshot = { ...todo }
      setRetiring((current) => [...current, snapshot])
      window.setTimeout(() => { setRetiring((current) => current.filter((row) => row.id !== snapshot.id)) }, 520)
      setToast({ text: `已完成 · ${todo.title}`, undo: todo })
    }
  }, [act])

  const undoComplete = useCallback(async (todo: YoloTodoRow): Promise<void> => {
    setToast(null)
    const outcome = await act(`reopen-${todo.id}`, {
      action: 'reopen', kind: 'todo', id: todo.id, scope_cwd: todo.scope_cwd ?? todo.ws?.cwd,
    })
    if (outcome) {
      setRetiring((current) => current.filter((row) => row.id !== todo.id))
      setToast({ text: `已撤销 · ${todo.title}` })
    }
  }, [act])

  const sendQuickAdd = useCallback(async (text: string): Promise<boolean> => {
    if (quickBusy) return false
    setQuickBusy(true)
    const outcome = await act('quick-add', { action: 'quick_add', kind: 'todo', title: text })
    if (outcome) {
      setToast({ text: '已记下 · 今日到期' })
      onSurfaceChange('home')
    }
    setQuickBusy(false)
    return outcome !== null
  }, [act, onSurfaceChange, quickBusy])

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

  const openJudgmentPanel = useCallback((todo: YoloTodoRowV2, binding: JudgmentBinding): void => {
    if (onOpenItemDetail) {
      onOpenItemDetail(todo)
      return
    }
    const attention = data.attention?.find((row) =>
      (row.id === binding.id || row.todo_id === todo.id)
      && row.scope_cwd === (todo.scope_cwd ?? todo.ws?.cwd ?? data.cwd))
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
    } else if (intent.type === 'mark_judgment_seen') {
      void act(`seen-${intent.judgmentId}`, {
        action: 'seen', kind: 'attention', id: intent.judgmentId, scope_cwd: intent.scopeCwd,
        reason_version: intent.reasonVersion, evidence_fingerprint: intent.evidenceFingerprint,
      }, { refresh: false })
    } else if (intent.type === 'expand_judgment') {
      setJudgmentExpanded(true)
    } else if (intent.type === 'collapse_judgment') {
      setJudgmentExpanded(false)
    } else if (intent.type === 'complete_todo') {
      void completeTodo(intent.todo)
    } else if (intent.type === 'open_task') {
      if (onOpenItemDetail) onOpenItemDetail(intent.todo)
      else openTaskPanel({
        item: intent.todo,
        scopeCwd: intent.scopeCwd,
        reason: intent.todo.overdue ? '这项事情已经逾期。' : intent.todo.stale ? '这项事情已经一段时间没有变化。' : '这项事情安排在今天。',
        evidence: [],
        source: intent.todo.source,
      })
    } else if (intent.type === 'open_source') {
      const rawTodo = data.todos.find((todo) => todo.id === intent.todo.id
        && (todo.scope_cwd ?? todo.ws?.cwd ?? data.cwd) === intent.scopeCwd)
      if (rawTodo?.source) onOpenSource?.(rawTodo, rawTodo.source)
    } else if (intent.type === 'handle_notification') {
      void act(`n-${intent.notificationId}`, {
        action: 'handled', kind: 'notification', id: intent.notificationId, scope_cwd: intent.scopeCwd,
      })
    } else if (intent.type === 'open_ledger' || intent.type === 'review_changes') {
      onSurfaceChange('history-timeline')
    } else if (intent.type === 'discuss_closure') {
      onOpenChat({ title: '今天的工作与生活收束', detail: '回顾今天的变化，确认仍需要回应的事情。' })
    } else if (intent.type === 'suppress_judgment') {
      void (async () => {
        const outcome = await act(`suppress-${intent.judgmentId}`, {
          action: 'suppress', kind: 'attention', id: intent.judgmentId, scope_cwd: intent.scopeCwd,
          reason_version: intent.reasonVersion, evidence_fingerprint: intent.evidenceFingerprint,
          suppressed_until: Date.now() + DAY_MS,
        })
        if (outcome?.learningReceipt) setToast({ text: outcome.learningReceipt.summary })
      })()
    } else if (intent.type === 'feedback_judgment') {
      const todo = data.todos.find((row) => row.id === data.attention?.[0]?.todo_id
        && (row.scope_cwd ?? row.ws?.cwd ?? data.cwd) === intent.scopeCwd)
      if (todo) openJudgmentPanel(todo, {
        id: intent.judgmentId,
        reasonVersion: intent.reasonVersion,
        evidenceFingerprint: intent.evidenceFingerprint,
      })
    } else if (intent.type === 'judgment_action') {
      const binding = {
        id: data.attention?.[0]?.id ?? intent.todo.id,
        reasonVersion: intent.reasonVersion,
        evidenceFingerprint: intent.evidenceFingerprint,
      }
      if (intent.action === 'complete') void completeTodo(intent.todo)
      else if (intent.action === 'postpone_tomorrow') {
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
      } else openJudgmentPanel(intent.todo, binding)
    }
  }, [act, completeTodo, data, onOpenChat, onOpenItemDetail, onOpenSource, onSurfaceChange, openJudgmentPanel, openTaskPanel])

  const handleTaskAction = useCallback((intent: TaskActionIntent): void => {
    if (!taskPanel) return
    if (intent.type === 'discuss') {
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
        request = intent.type === 'delete'
          ? { action: 'delete', kind: 'todo', id: taskPanel.item.id, scope_cwd: taskPanel.scopeCwd, confirmation: 'PERMANENT_DELETE' }
          : { action: intent.type, kind: 'todo', id: taskPanel.item.id, scope_cwd: taskPanel.scopeCwd }
      }
      const outcome = await act(`panel-${taskPanel.item.id}`, request)
      if (!outcome) return
      if (intent.type === 'delete') {
        dismissTaskPanel(false)
        setToast({ text: '事项已永久删除' })
        return
      }
      setTaskReceipt(outcome.learningReceipt ?? null)
      setTaskUndo(outcome.undo ?? null)
      setTaskPanel((current) => current ? { ...current, item: { ...current.item, ...outcome.item } } : current)
    })()
  }, [act, dismissTaskPanel, onOpenChat, taskPanel])

  const saveTaskPanel = useCallback((): void => {
    if (!taskPanel || !taskDraft) return
    void (async () => {
      const outcome = await act(`panel-edit-${taskPanel.item.id}`, {
        action: 'update', kind: 'todo', id: taskPanel.item.id, scope_cwd: taskPanel.scopeCwd,
        title: taskDraft.title, due_at: taskDraft.dueAt || null, priority: taskDraft.priority,
        milestone_title: taskDraft.milestone, detail: taskDraft.detail,
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
      const outcome = await act(`panel-undo-${taskPanel.item.id}`, { ...taskUndo, scope_cwd: taskPanel.scopeCwd })
      if (!outcome) return
      setTaskReceipt(outcome.learningReceipt ?? null)
      setTaskUndo(null)
    })()
  }, [act, taskPanel, taskUndo])

  return {
    actionError, setActionError, busyKey, completing, toast, setToast,
    quickBusy, taskPanel, taskDraft, setTaskDraft, taskReceipt, taskUndo,
    judgmentExpanded, act, completeTodo, undoComplete, sendQuickAdd,
    closeTaskPanel: () => { dismissTaskPanel(true) }, handleTodayIntent,
    handleTaskAction, saveTaskPanel, undoTaskReceipt,
  }
}
