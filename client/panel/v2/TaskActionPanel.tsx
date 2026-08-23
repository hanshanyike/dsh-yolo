import { useEffect, useRef, useState } from 'react'
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
  onAction: (intent: TaskActionIntent) => void
  onDraftChange: (next: TaskEditDraft) => void
  onSave: () => void
  onClose: () => void
  onOpenSource?: (source: JudgmentSource) => void
  onUndoReceipt?: (receipt: LearningReceiptData) => void
  onOpenPreferences?: () => void
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
  onAction,
  onDraftChange,
  onSave,
  onClose,
  onOpenSource,
  onUndoReceipt,
  onOpenPreferences,
}: TaskActionPanelProps): JSX.Element {
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
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
      aria-modal="true"
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
          {source.sessionId && onOpenSource ? (
            <button type="button" onClick={() => { onOpenSource(source) }}>
              {source.label}{source.workspace ? ` · ${source.workspace.label}` : ''}
            </button>
          ) : <p>{source.label}{source.workspace ? ` · ${source.workspace.label}` : ''}</p>}
          {source.excerpt ? <blockquote>{source.excerpt}</blockquote> : null}
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
          <button type="button" disabled={busy} onClick={() => { setCancelConfirmOpen(true) }}>取消事项</button>
        )}
      </section>
    </aside>
  )
}
