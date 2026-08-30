import { useEffect, useRef, useState } from 'react'
import type { TodoIdentityFeedbackReason, TodoIdentityReceipt } from '../../../src/domain/types.ts'
import { LearningReceipt } from './LearningReceipt.tsx'
import {
  tomorrowLocalDate,
  type JudgmentEvidence,
  type JudgmentSource,
  type LearningReceiptData,
  type TaskActionIntent,
  type TaskEditDraft,
  type YoloTodoRowV2,
} from './model.ts'

export interface TaskActionPanelProps {
  item: YoloTodoRowV2
  reason: string
  evidence?: readonly JudgmentEvidence[]
  source?: JudgmentSource
  draft: TaskEditDraft
  busy?: boolean
  now?: Date
  learningReceipt?: LearningReceiptData | null
  judgmentFeedbackEnabled?: boolean
  identityReceipts?: readonly TodoIdentityReceipt[]
  identityLoading?: boolean
  identityError?: string | null
  mergeSuggestions?: readonly TodoMergeSuggestion[]
  onAction: (intent: TaskActionIntent) => void
  onDraftChange: (next: TaskEditDraft) => void
  onSave: () => void
  onClose: () => void
  onOpenSource?: (source: JudgmentSource) => void
  onUndoReceipt?: (receipt: LearningReceiptData) => void
  onOpenPreferences?: () => void
  onRejectIdentity?: (receipt: TodoIdentityReceipt, reason: TodoIdentityFeedbackReason) => void
  onConsolidate?: (sourceId: string, targetId: string) => void
  /** Focus presentation is modal; a wide dock remains non-modal. */
  modal?: boolean
}

export interface TodoMergeSuggestion {
  key: string
  other: YoloTodoRowV2
}

const TODO_STATUS_LABEL: Record<string, string> = {
  pending: '待处理', in_progress: '进行中', done: '已完成', completed: '已完成', cancelled: '已取消',
}

function mergeOutcome(target: YoloTodoRowV2, source: YoloTodoRowV2): string {
  const due = target.due_at ?? source.due_at ?? '无截止时间'
  const priority = target.priority ?? source.priority ?? '普通'
  return `状态：${TODO_STATUS_LABEL[target.status] ?? target.status}；截止：${due}；优先级：${priority}`
}

export function TaskActionPanel({
  item,
  reason,
  evidence = [],
  source,
  draft,
  busy = false,
  now = new Date(),
  learningReceipt,
  judgmentFeedbackEnabled = false,
  identityReceipts = [],
  identityLoading = false,
  identityError,
  mergeSuggestions = [],
  onAction,
  onDraftChange,
  onSave,
  onClose,
  onOpenSource,
  onUndoReceipt,
  onOpenPreferences,
  onRejectIdentity,
  onConsolidate,
  modal = true,
}: TaskActionPanelProps): JSX.Element {
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [identityCorrectionOpen, setIdentityCorrectionOpen] = useState<string | null>(null)
  const [mergePreviewOpen, setMergePreviewOpen] = useState<string | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const titleId = `task-action-title-${item.id}`
  const reasonId = `task-action-reason-${item.id}`
  const tomorrow = tomorrowLocalDate(now)
  const patchDraft = (patch: Partial<TaskEditDraft>): void => { onDraftChange({ ...draft, ...patch }) }

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus()
  }, [])

  return (
    <aside
      ref={dialogRef}
      className="v2-task-action-panel"
      role="dialog"
      aria-modal={modal ? true : undefined}
      aria-labelledby={titleId}
      aria-describedby={reasonId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
          return
        }
        if (event.key === 'Tab') {
          const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? []).filter((element) => !element.hidden)
          if (focusable.length === 0) return
          const first = focusable[0]!
          const last = focusable[focusable.length - 1]!
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
      }}
    >
      <header>
        <div>
          <h2 id={titleId}>{item.title}</h2>
          {item.ws ? <p>{item.ws.label}</p> : null}
        </div>
        <button type="button" aria-label="关闭事项处理面板" onClick={onClose}>关闭</button>
      </header>

      <section aria-labelledby={`${reasonId}-heading`}>
        <h3 id={`${reasonId}-heading`}>判断依据</h3>
        <p id={reasonId}>{reason}</p>
        {evidence.length > 0 ? (
          <ul>
            {evidence.slice(0, 3).map((itemEvidence) => (
              <li key={itemEvidence.code}>
                {itemEvidence.label}
                {itemEvidence.value !== undefined && itemEvidence.value !== null ? `：${String(itemEvidence.value)}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {source ? (
        <section aria-label="来源">
          <h3>来源</h3>
          {onOpenSource ? (
            <button type="button" data-yolo-focus-id={`detail-source:${item.scope_cwd}:${item.id}`} onClick={() => { onOpenSource(source) }}>
              {source.label}{source.workspace ? ` · ${source.workspace.label}` : ''}
            </button>
          ) : <p>{source.label}{source.workspace ? ` · ${source.workspace.label}` : ''}</p>}
          {source.excerpt ? <blockquote>{source.excerpt}</blockquote> : null}
        </section>
      ) : null}

      {identityLoading || identityError || identityReceipts.length > 0 ? (
        <section aria-label="自动关联记录" className="v2-identity-receipts">
          <h3>自动关联记录</h3>
          {identityLoading ? <p>正在读取关联记录…</p> : null}
          {identityError ? <p>关联记录暂时无法读取：{identityError}</p> : null}
          {identityReceipts.slice(0, 3).map((identityReceipt) => {
            const feedback = identityReceipt.feedback
            const title = identityReceipt.decision === 'UPDATE' && identityReceipt.application_status === 'updated'
              ? '已自动更新截止时间'
              : identityReceipt.application_status === 'no_change'
                ? '已识别为同一事项，未重复修改'
                : '已关联为同一事项'
            const correction = feedback?.undo_status === 'applied'
              ? '已纠正，并撤销本次自动改期。'
              : feedback?.undo_status === 'conflict'
                ? '已纠正；由于事项后来又被修改，保留当前截止时间。'
                : feedback ? '已纠正，并排除本次来源。' : null
            return (
              <article key={identityReceipt.operation_id}>
                <strong>{title}</strong>
                <p>{identityReceipt.input_excerpt}</p>
                <small>
                  {identityReceipt.confidence !== null && identityReceipt.confidence !== undefined
                    ? `置信度 ${Math.round(identityReceipt.confidence * 100)}%`
                    : '置信度未记录'}
                  {identityReceipt.reason ? ` · ${identityReceipt.reason}` : ''}
                </small>
                {correction ? <p className="v2-identity-corrected">{correction}</p> : null}
                {!feedback && onRejectIdentity ? (
                  identityCorrectionOpen === identityReceipt.operation_id ? (
                    <div role="group" aria-label="选择自动关联不准确的原因">
                      <button type="button" disabled={busy} onClick={() => { onRejectIdentity(identityReceipt, 'wrong_item'); setIdentityCorrectionOpen(null) }}>不是同一事项</button>
                      {identityReceipt.decision === 'UPDATE' ? (
                        <button type="button" disabled={busy} onClick={() => { onRejectIdentity(identityReceipt, 'wrong_change'); setIdentityCorrectionOpen(null) }}>不该修改时间</button>
                      ) : null}
                      <button type="button" disabled={busy} onClick={() => { onRejectIdentity(identityReceipt, 'other'); setIdentityCorrectionOpen(null) }}>其他原因</button>
                      <button type="button" disabled={busy} onClick={() => { setIdentityCorrectionOpen(null) }}>返回</button>
                    </div>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => { setIdentityCorrectionOpen(identityReceipt.operation_id) }}>关联错了</button>
                  )
                ) : null}
              </article>
            )
          })}
        </section>
      ) : null}

      {mergeSuggestions.length > 0 && onConsolidate ? (
        <section aria-label="重复事项合并建议" className="v2-merge-suggestions">
          <h3>可能重复</h3>
          <p>这里只给出建议，不会自动合并。确认前请先核对两项的状态和保留结果。</p>
          {mergeSuggestions.slice(0, 3).map((suggestion) => {
            const other = suggestion.other
            const previewing = mergePreviewOpen === suggestion.key
            const statusConflict = item.status !== other.status
            return (
              <article key={suggestion.key}>
                <strong>{other.title}</strong>
                <small>{TODO_STATUS_LABEL[other.status] ?? other.status}{other.due_at ? ` · 截止 ${other.due_at}` : ' · 无截止时间'}</small>
                {!previewing ? (
                  <button type="button" disabled={busy} onClick={() => { setMergePreviewOpen(suggestion.key) }}>预览合并</button>
                ) : (
                  <div className="v2-merge-preview">
                    {statusConflict ? <p className="v2-merge-warning">两项状态不同。你选择保留的事项决定合并后的业务状态。</p> : null}
                    <div>
                      <strong>保留当前事项</strong>
                      <small>{mergeOutcome(item, other)}</small>
                      <button type="button" disabled={busy} onClick={() => { onConsolidate(other.id, item.id); setMergePreviewOpen(null) }}>保留当前事项并合并</button>
                    </div>
                    <div>
                      <strong>保留另一事项</strong>
                      <small>{mergeOutcome(other, item)}</small>
                      <button type="button" disabled={busy} onClick={() => { onConsolidate(item.id, other.id); setMergePreviewOpen(null) }}>保留“{other.title}”并合并</button>
                    </div>
                    <p>被合并项会进入历史；未处理通知、待投递提醒和来源关系会跟随保留项。之后可在历史中撤销。</p>
                    <button type="button" disabled={busy} onClick={() => { setMergePreviewOpen(null) }}>取消预览</button>
                  </div>
                )}
              </article>
            )
          })}
        </section>
      ) : null}

      <section aria-label="快速处理">
        <h3>快速处理</h3>
        <div role="group" aria-label="主要处理">
          <button type="button" disabled={busy} onClick={() => { onAction({ type: 'complete' }) }}>标记完成</button>
          <button type="button" disabled={busy} onClick={() => { onAction({ type: 'postpone', dueAt: tomorrow }) }}>
            推迟到明天（{tomorrow}）
          </button>
          <button type="button" disabled={busy} onClick={() => { onAction({ type: 'discuss' }) }}>和助手讨论</button>
        </div>
        <div role="group" aria-label="其他处理">
          <button type="button" disabled={busy} onClick={() => { onAction({ type: 'remind_again' }) }}>再提醒一次</button>
          {judgmentFeedbackEnabled ? (
            <>
              <button type="button" disabled={busy} onClick={() => { onAction({ type: 'suppress' }) }}>暂时忽略本次判断</button>
              <button type="button" disabled={busy} aria-expanded={feedbackOpen} onClick={() => { setFeedbackOpen((open) => !open) }}>原因不对</button>
            </>
          ) : null}
        </div>
        {judgmentFeedbackEnabled && feedbackOpen ? (
          <fieldset className="v2-feedback-reasons" disabled={busy}>
            <legend>选择不准确的原因</legend>
            <button type="button" onClick={() => { onAction({ type: 'feedback', reason: 'wrong_time' }) }}>时间不合适</button>
            <button type="button" onClick={() => { onAction({ type: 'feedback', reason: 'not_important' }) }}>没那么重要</button>
            <button type="button" onClick={() => { onAction({ type: 'feedback', reason: 'wrong_goal' }) }}>目标关联不对</button>
            <button type="button" onClick={() => { onAction({ type: 'feedback', reason: 'stale_signal_unhelpful' }) }}>长期未动不是风险</button>
            <button type="button" onClick={() => { onAction({ type: 'feedback', reason: 'other' }) }}>其他原因</button>
          </fieldset>
        ) : null}
      </section>

      <section aria-label="助手将记录的变化">
        <h3>助手将记录的变化</h3>
        {learningReceipt ? (
          <LearningReceipt
            receipt={learningReceipt}
            onUndo={onUndoReceipt}
            onOpenPreferences={onOpenPreferences}
          />
        ) : <p>动作完成后仅展示服务端返回的学习回执；未返回回执时不会声称已学会。</p>}
      </section>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy) onSave()
        }}
      >
        <fieldset disabled={busy}>
          <legend>编辑事项</legend>
          <label>
            <span>标题</span>
            <input value={draft.title} onChange={(event) => { patchDraft({ title: event.target.value }) }} />
          </label>
          <label>
            <span>截止日期与时间</span>
            <input type="datetime-local" value={draft.dueAt} onChange={(event) => { patchDraft({ dueAt: event.target.value }) }} />
          </label>
          <label>
            <span>优先级</span>
            <select value={draft.priority} onChange={(event) => { patchDraft({ priority: event.target.value }) }}>
              <option value="low">低</option>
              <option value="medium">普通</option>
              <option value="high">高</option>
              <option value="urgent">紧急</option>
            </select>
          </label>
          <label>
            <span>里程碑</span>
            <input value={draft.milestone} onChange={(event) => { patchDraft({ milestone: event.target.value }) }} />
          </label>
          <label>
            <span>备注或上下文</span>
            <textarea value={draft.detail} onChange={(event) => { patchDraft({ detail: event.target.value }) }} />
          </label>
          <button type="submit">保存编辑</button>
        </fieldset>
      </form>

      <section aria-label="危险操作">
        <h3>危险操作</h3>
        {cancelConfirmOpen ? (
          <div role="group" aria-label="确认取消事项">
            <p>取消后事项会移到“已取消”，可以在那里重新打开。</p>
            <button type="button" disabled={busy} onClick={() => { onAction({ type: 'cancel' }); setCancelConfirmOpen(false) }}>确认取消</button>
            <button type="button" disabled={busy} onClick={() => { setCancelConfirmOpen(false) }}>保留事项</button>
          </div>
        ) : (
          <button type="button" disabled={busy} onClick={() => { setCancelConfirmOpen(true); setDeleteConfirmOpen(false) }}>取消事项</button>
        )}
        {deleteConfirmOpen ? (
          <div role="group" aria-label="确认永久删除事项" className="permanent-delete-confirm">
            <p>事项、来源证据、关联提醒、判断记录和搜索投影会被删除，且不能撤销。原始宿主会话与既有时间线不在本次范围内。</p>
            <label>
              <span>输入“永久删除”继续</span>
              <input value={deleteConfirmation} disabled={busy} autoComplete="off" onChange={(event) => { setDeleteConfirmation(event.target.value) }} />
            </label>
            <button
              type="button"
              disabled={busy || deleteConfirmation !== '永久删除'}
              onClick={() => { onAction({ type: 'delete' }); setDeleteConfirmOpen(false); setDeleteConfirmation('') }}
            >永久删除</button>
            <button type="button" disabled={busy} onClick={() => { setDeleteConfirmOpen(false); setDeleteConfirmation('') }}>保留事项</button>
          </div>
        ) : (
          <button type="button" className="permanent-delete" disabled={busy} onClick={() => { setDeleteConfirmOpen(true); setCancelConfirmOpen(false) }}>永久删除事项</button>
        )}
      </section>
    </aside>
  )
}
