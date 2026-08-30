import { useCallback, useEffect, useMemo, useState } from 'react'
import type { YoloActionRequest, YoloUndoDescriptor } from '../../../src/contracts/actions.ts'
import type { TodoIdentityReceiptsResponse } from '../../../src/contracts/identity.ts'
import type { TodoIdentityFeedbackReason, TodoIdentityReceipt } from '../../../src/domain/types.ts'
import type { YoloDashboardData, YoloTodoRow } from '../../../src/contracts/dashboard.ts'
import type { ChatAnchor } from '../ChatPane.tsx'
import type { PanelForeground } from '../navigation.ts'
import { postYoloAction } from '../v2/api.ts'
import type { LearningReceiptData, TaskActionIntent, TaskEditDraft } from '../v2/model.ts'

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

export function useItemDetailController({
  data,
  foreground,
  refresh,
  openDiscussion,
}: {
  data: YoloDashboardData | null
  foreground: PanelForeground
  refresh: () => Promise<void>
  openDiscussion: (anchor: ChatAnchor) => void
}): {
  todo: YoloTodoRow | undefined
  draft: TaskEditDraft | null
  busy: boolean
  receipt: LearningReceiptData | null
  undo: YoloUndoDescriptor | null
  error: string | null
  identityReceipts: TodoIdentityReceipt[]
  identityLoading: boolean
  identityError: string | null
  attention: NonNullable<YoloDashboardData['attention']>[number] | undefined
  source: YoloTodoRow['source']
  setDraft: (draft: TaskEditDraft) => void
  prepare: (todo: YoloTodoRow) => void
  reset: () => void
  handleAction: (intent: TaskActionIntent) => void
  save: () => void
  undoReceipt: () => void
  rejectIdentity: (receipt: TodoIdentityReceipt, reason: TodoIdentityFeedbackReason) => void
  consolidate: (sourceId: string, targetId: string) => void
} {
  const [draft, setDraft] = useState<TaskEditDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<LearningReceiptData | null>(null)
  const [undo, setUndo] = useState<YoloUndoDescriptor | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [identityReceipts, setIdentityReceipts] = useState<TodoIdentityReceipt[]>([])
  const [identityLoading, setIdentityLoading] = useState(false)
  const [identityError, setIdentityError] = useState<string | null>(null)

  const todo = useMemo(() => {
    if (!data || !('item' in foreground)) return undefined
    const target = foreground.item
    return data.todos.find((row) => row.id === target.id
      && (row.scope_cwd ?? row.ws?.cwd ?? data.cwd) === target.scopeCwd)
  }, [data, foreground])

  const attention = useMemo(() => {
    if (!todo || !data) return undefined
    const scopeCwd = todo.scope_cwd ?? todo.ws?.cwd ?? data.cwd
    return data.attention?.find((row) => row.todo_id === todo.id && row.scope_cwd === scopeCwd)
  }, [data, todo])

  const reset = useCallback((): void => {
    setDraft(null)
    setReceipt(null)
    setUndo(null)
    setError(null)
    setIdentityReceipts([])
    setIdentityError(null)
  }, [])

  useEffect(() => {
    if (foreground.kind !== 'item_detail' || !todo) {
      setIdentityReceipts([])
      setIdentityError(null)
      setIdentityLoading(false)
      return
    }
    const controller = new AbortController()
    const scopeCwd = foreground.item.scopeCwd
    setIdentityLoading(true)
    setIdentityError(null)
    const params = new URLSearchParams({ todo_id: todo.id, scope_cwd: scopeCwd })
    void fetch(`/yolo/identity-receipts?${params.toString()}`, {
      headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as Partial<TodoIdentityReceiptsResponse> & { error?: string }
      if (!response.ok || !Array.isArray(body.receipts)) throw new Error(body.error ?? `HTTP ${response.status}`)
      if (!controller.signal.aborted) setIdentityReceipts(body.receipts)
    }).catch((reason) => {
      if (!controller.signal.aborted) setIdentityError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (!controller.signal.aborted) setIdentityLoading(false)
    })
    return () => { controller.abort() }
  }, [foreground, todo])

  const prepare = useCallback((nextTodo: YoloTodoRow): void => {
    setDraft(detailDraftFor(nextTodo))
    setReceipt(null)
    setUndo(null)
    setError(null)
  }, [])

  useEffect(() => {
    if (foreground.kind === 'item_detail' && todo && draft === null) {
      setDraft(detailDraftFor(todo))
    }
  }, [draft, foreground.kind, todo])

  const run = useCallback(async (request: YoloActionRequest): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await postYoloAction(request)
      setReceipt(outcome.learningReceipt ?? null)
      setUndo(outcome.undo ?? null)
      await refresh()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const handleAction = useCallback((intent: TaskActionIntent): void => {
    if (!todo || foreground.kind !== 'item_detail') return
    const scopeCwd = foreground.item.scopeCwd
    if (intent.type === 'discuss') {
      openDiscussion({ title: todo.title, detail: todo.detail, todoId: todo.id, scopeCwd })
      return
    }
    if (intent.type === 'suppress' || intent.type === 'feedback') {
      if (!attention) {
        setError('当前事项没有可回应的助手判断，请刷新后重试。')
        return
      }
      void run({
        action: intent.type,
        kind: 'attention',
        id: attention.id,
        scope_cwd: scopeCwd,
        reason_version: attention.reason_version,
        evidence_fingerprint: attention.evidence_fingerprint,
        ...(intent.type === 'suppress'
          ? { suppressed_until: Date.now() + 86_400_000 }
          : { feedback_reason: intent.reason }),
      })
      return
    }
    const request: YoloActionRequest = intent.type === 'postpone'
      ? { action: 'postpone', kind: 'todo', id: todo.id, scope_cwd: scopeCwd, due_at: intent.dueAt }
      : intent.type === 'delete'
        ? { action: 'delete', kind: 'todo', id: todo.id, scope_cwd: scopeCwd, confirmation: 'PERMANENT_DELETE' }
        : { action: intent.type, kind: 'todo', id: todo.id, scope_cwd: scopeCwd }
    void run(request)
  }, [attention, foreground, openDiscussion, run, todo])

  const save = useCallback((): void => {
    if (!todo || !draft || foreground.kind !== 'item_detail') return
    void run({
      action: 'update',
      kind: 'todo',
      id: todo.id,
      scope_cwd: foreground.item.scopeCwd,
      title: draft.title,
      due_at: draft.dueAt || null,
      priority: draft.priority,
      milestone_title: draft.milestone,
      detail: draft.detail,
    })
  }, [draft, foreground, run, todo])

  const undoReceipt = useCallback((): void => {
    if (!undo || foreground.kind !== 'item_detail') return
    if (undo.expires_at !== undefined && undo.expires_at < Date.now()) {
      setError('撤销窗口已结束；当前事项没有被再次修改。')
      setUndo(null)
      return
    }
    void run({ ...undo, scope_cwd: foreground.item.scopeCwd } as YoloActionRequest)
      .then(() => { setUndo(null) })
  }, [foreground, run, undo])

  const rejectIdentity = useCallback((identityReceipt: TodoIdentityReceipt, reason: TodoIdentityFeedbackReason): void => {
    if (!todo || foreground.kind !== 'item_detail' || identityReceipt.todo_id !== todo.id) return
    void run({
      action: 'identity_reject', kind: 'todo', id: todo.id, scope_cwd: foreground.item.scopeCwd,
      resolution_id: identityReceipt.resolution_id, identity_feedback_reason: reason,
      client_action_id: `identity-reject:${identityReceipt.operation_id}`,
    })
  }, [foreground, run, todo])

  const consolidate = useCallback((sourceId: string, targetId: string): void => {
    if (foreground.kind !== 'item_detail' || sourceId === targetId) return
    void run({
      action: 'consolidate', kind: 'todo', id: sourceId, into_id: targetId,
      scope_cwd: foreground.item.scopeCwd, confirmation: 'CONFIRM_CONSOLIDATE',
    })
  }, [foreground, run])

  return {
    todo,
    draft,
    busy,
    receipt,
    undo,
    error,
    identityReceipts,
    identityLoading,
    identityError,
    attention,
    source: todo?.source,
    setDraft,
    prepare,
    reset,
    handleAction,
    save,
    undoReceipt,
    rejectIdentity,
    consolidate,
  }
}
