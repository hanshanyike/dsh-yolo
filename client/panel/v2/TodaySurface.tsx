import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { YoloDashboardData } from '../../../src/shared/dashboard.ts'
import { AssistantJudgment } from './AssistantJudgment.tsx'
import type {
  JudgmentActionIntent,
  JudgmentSource,
  YoloTodoRowV2,
} from './model.ts'
import {
  buildTodaySurfaceModel,
  type BuildTodaySurfaceOptions,
  type TodayTaskRowView,
} from './today-surface-model.ts'
import { formatDueLabel } from '../due-label.ts'

export type TodaySurfaceIntent =
  | { type: 'quick_capture' }
  | { type: 'mark_judgment_seen'; judgmentId: string; scopeCwd: string; reasonVersion: string; evidenceFingerprint: string }
  | { type: 'judgment_action'; action: JudgmentActionIntent; todo: YoloTodoRowV2; scopeCwd: string; reasonVersion: string; evidenceFingerprint: string }
  | { type: 'expand_judgment' }
  | { type: 'collapse_judgment' }
  | { type: 'suppress_judgment'; judgmentId: string; scopeCwd: string; reasonVersion: string; evidenceFingerprint: string }
  | { type: 'feedback_judgment'; judgmentId: string; scopeCwd: string; reasonVersion: string; evidenceFingerprint: string }
  | { type: 'complete_todo'; todo: YoloTodoRowV2; scopeCwd: string }
  | { type: 'open_task'; todo: YoloTodoRowV2; scopeCwd: string }
  | { type: 'open_source'; source: JudgmentSource; todo: YoloTodoRowV2; scopeCwd: string }
  | { type: 'handle_notification'; notificationId: string; scopeCwd: string }
  | { type: 'open_ledger' }
  | { type: 'open_empty_chat' }
  | { type: 'review_changes' }
  | { type: 'discuss_closure' }

export interface TodaySurfaceProps extends BuildTodaySurfaceOptions {
  data: YoloDashboardData
  busyTodoId?: string
  renderQuickCapture?: () => ReactNode
  judgmentExpanded?: boolean
  onIntent: (intent: TodaySurfaceIntent) => void
}

export function todayTaskReasonText(reason: TodayTaskRowView['reason']): string {
  if (!reason) return ''
  return reason.evidence.length > 0
    ? `${reason.label} · ${reason.evidence.join('，')}`
    : reason.label
}

function TodayTaskRow({ row, busy, onIntent }: {
  row: TodayTaskRowView
  busy: boolean
  onIntent: (intent: TodaySurfaceIntent) => void
}): JSX.Element {
  const openTask = (): void => { onIntent({ type: 'open_task', todo: row.todo, scopeCwd: row.scopeCwd }) }
  const source = row.source
  const reasonText = todayTaskReasonText(row.reason)
  return (
    <li
      className="v2-today-row"
      data-yolo-todo-id={row.todo.id}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) {
          event.preventDefault()
          openTask()
        }
      }}
    >
      <input
        type="checkbox"
        checked={false}
        disabled={busy}
        aria-label={`完成：${row.todo.title}`}
        onChange={() => { onIntent({ type: 'complete_todo', todo: row.todo, scopeCwd: row.scopeCwd }) }}
      />
      <div className="v2-today-row-body">
        <strong>{row.todo.title}</strong>
        {row.reason ? (
          <p className="v2-today-row-reason" aria-label={reasonText}>
            <span>{row.reason.label}</span>
            {row.reason.evidence.length > 0 ? <> · {row.reason.evidence.join('，')}</> : null}
          </p>
        ) : null}
        {row.todo.reminder?.body ? <p className="v2-reminder-body">{row.todo.reminder.body}</p> : null}
        <div className="v2-today-row-meta">
          <button
            type="button"
            data-yolo-focus-id={`home-source:${row.scopeCwd}:${row.todo.id}`}
            onClick={() => { onIntent({ type: 'open_source', source, todo: row.todo, scopeCwd: row.scopeCwd }) }}
          >
            {source.label}
          </button>
          {row.todo.ws ? <span title={row.todo.ws.label}>{row.todo.ws.label}</span> : null}
          {row.todo.due_at ? <time dateTime={row.todo.due_at}>{formatDueLabel(row.todo.due_at)}</time> : null}
        </div>
      </div>
      <button type="button" disabled={busy} onClick={openTask}>处理</button>
      {row.todo.reminder?.unhandled && row.todo.reminder.id ? (
        <button type="button" disabled={busy} onClick={() => { onIntent({ type: 'handle_notification', notificationId: row.todo.reminder!.id!, scopeCwd: row.scopeCwd }) }}>知道了</button>
      ) : null}
    </li>
  )
}

function TaskSection({ id, title, rows, busyTodoId, onIntent }: {
  id: string
  title: string
  rows: readonly TodayTaskRowView[]
  busyTodoId?: string
  onIntent: (intent: TodaySurfaceIntent) => void
}): JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <section className="v2-task-section" aria-labelledby={id}>
      <div className="v2-task-section-head">
        <h2 id={id}>{title}</h2>
        <span>{rows.length} 件</span>
      </div>
      <ul className="v2-task-list">
        {rows.map((row) => (
          <TodayTaskRow
            key={row.key}
            row={row}
            busy={busyTodoId === row.todo.id}
            onIntent={onIntent}
          />
        ))}
      </ul>
    </section>
  )
}

export function TodaySurface({
  data,
  now,
  nearQuietHours,
  closureDismissed,
  busyTodoId,
  renderQuickCapture,
  judgmentExpanded = false,
  onIntent,
}: TodaySurfaceProps): JSX.Element {
  const model = buildTodaySurfaceModel(data, { now, nearQuietHours, closureDismissed })
  const [showAllSecondary, setShowAllSecondary] = useState(false)
  const secondaryPreviewLimit = 4
  const secondaryCount = model.attentionRows.length + model.todayRows.length + model.upcomingRows.length
  const highPressure = secondaryCount + (model.judgment ? 1 : 0) >= 5
  let remainingPreview = showAllSecondary ? secondaryCount : highPressure ? 0 : secondaryPreviewLimit
  const visibleAttention = model.attentionRows.slice(0, remainingPreview)
  remainingPreview -= visibleAttention.length
  const visibleToday = model.todayRows.slice(0, remainingPreview)
  remainingPreview -= visibleToday.length
  const visibleUpcoming = model.upcomingRows.slice(0, remainingPreview)
  const hiddenSecondaryCount = secondaryCount - visibleAttention.length - visibleToday.length - visibleUpcoming.length
  const judgment = model.judgment
  const displayedJudgment = judgment && judgmentExpanded
    ? { ...judgment, presentation: 'full' as const, reason: judgment.fullReason }
    : judgment
  const judgmentScopeCwd = model.judgmentScopeCwd ?? data.cwd
  const reportedJudgment = useRef<string | null>(null)

  useEffect(() => {
    if (!judgment || judgment.presentation !== 'full') return
    const key = `${judgment.id}\u0000${judgment.version}\u0000${judgment.evidenceFingerprint}`
    if (reportedJudgment.current === key) return
    reportedJudgment.current = key
    onIntent({
      type: 'mark_judgment_seen',
      judgmentId: judgment.id,
      scopeCwd: judgmentScopeCwd,
      reasonVersion: judgment.version,
      evidenceFingerprint: judgment.evidenceFingerprint,
    })
  }, [judgment, judgmentScopeCwd, onIntent])

  return (
    <main className="v2-today-surface" aria-labelledby="v2-today-title">
      <header>
        <p>{model.dateLabel}</p>
        <h1 id="v2-today-title">{model.headline}</h1>
        <p>{model.description}</p>
      </header>

      <section aria-label="快速记录">
        {renderQuickCapture
          ? renderQuickCapture()
          : <button type="button" onClick={() => { onIntent({ type: 'quick_capture' }) }}>快速记录</button>}
      </section>

      {model.partialMessage ? <p role="status" className="v2-today-partial">{model.partialMessage}</p> : null}

      {model.pristine ? (
        <section className="v2-today-empty" aria-labelledby="v2-empty-title">
          <div className="v2-empty-rail" aria-hidden="true">
            <span /><span /><span />
          </div>
          <div className="v2-empty-copy">
            <p className="v2-empty-kicker">管理工作与生活的助手</p>
            <h2 id="v2-empty-title">今天没有挂起的事</h2>
            <p>说一句要继续跟进的事，助手会把它留在轨道上；还没想清楚，也可以先聊聊。</p>
            <button type="button" onClick={() => { onIntent({ type: 'open_empty_chat' }) }}>和助手聊聊</button>
          </div>
        </section>
      ) : null}

      {judgment ? (
        <AssistantJudgment
          judgment={displayedJudgment ?? judgment}
          busy={busyTodoId === judgment.todo.id}
          partialData={false}
          onIntent={(action) => {
            onIntent({
              type: 'judgment_action', action, todo: judgment.todo, scopeCwd: judgmentScopeCwd,
              reasonVersion: judgment.version, evidenceFingerprint: judgment.evidenceFingerprint,
            })
          }}
          onExpand={() => { onIntent({ type: 'expand_judgment' }) }}
          onCollapse={judgmentExpanded ? () => { onIntent({ type: 'collapse_judgment' }) } : undefined}
          onIgnore={() => {
            onIntent({
              type: 'suppress_judgment', judgmentId: judgment.id, scopeCwd: judgmentScopeCwd,
              reasonVersion: judgment.version, evidenceFingerprint: judgment.evidenceFingerprint,
            })
          }}
          onFeedback={() => {
            onIntent({
              type: 'feedback_judgment', judgmentId: judgment.id, scopeCwd: judgmentScopeCwd,
              reasonVersion: judgment.version, evidenceFingerprint: judgment.evidenceFingerprint,
            })
          }}
          onOpenSource={(source) => { onIntent({ type: 'open_source', source, todo: judgment.todo, scopeCwd: judgmentScopeCwd }) }}
          onHandled={judgment.todo.reminder?.id ? () => { onIntent({ type: 'handle_notification', notificationId: judgment.todo.reminder!.id!, scopeCwd: judgmentScopeCwd }) } : undefined}
        />
      ) : null}

      <TaskSection id="v2-attention-title" title="需要处理" rows={visibleAttention} busyTodoId={busyTodoId} onIntent={onIntent} />
      <TaskSection id="v2-today-list-title" title="今天" rows={visibleToday} busyTodoId={busyTodoId} onIntent={onIntent} />
      <TaskSection id="v2-upcoming-title" title="接下来" rows={visibleUpcoming} busyTodoId={busyTodoId} onIntent={onIntent} />
      {hiddenSecondaryCount > 0 ? (
        <button type="button" className="v2-secondary-more" onClick={() => { setShowAllSecondary(true) }}>
          查看其余 {hiddenSecondaryCount} 项安排
        </button>
      ) : showAllSecondary && highPressure ? (
        <button type="button" className="v2-secondary-more" onClick={() => { setShowAllSecondary(false) }}>收起次要安排</button>
      ) : null}

      {!model.pristine ? (
        <section aria-labelledby="v2-progress-title">
          <h2 id="v2-progress-title">最近变化</h2>
          {model.recentChanges.length > 0 ? (
            <ul className="v2-recent-changes">
              {model.recentChanges.map((change) => <li key={change.id}>{change.summary}</li>)}
            </ul>
          ) : <p>还没有新的用户可见变化。</p>}
          <button type="button" onClick={() => { onIntent({ type: 'open_ledger' }) }}>
            已完成 {model.progress.completed} 项 · 变更 {model.progress.changes} 条 · 来自 {model.progress.sessions} 个会话
          </button>
        </section>
      ) : null}

      {model.showClosure ? (
        <section aria-labelledby="v2-closure-title">
          <h2 id="v2-closure-title">今天可以收束一下</h2>
          <p>回顾今天的变化，确认仍需要回应的事情。</p>
          <button type="button" onClick={() => { onIntent({ type: 'review_changes' }) }}>回顾变更</button>
          <button type="button" onClick={() => { onIntent({ type: 'discuss_closure' }) }}>和助手收束</button>
        </section>
      ) : null}
    </main>
  )
}
