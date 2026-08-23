import { useEffect, useRef, type ReactNode } from 'react'
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

export type TodaySurfaceIntent =
  | { type: 'quick_capture' }
  | { type: 'mark_judgment_seen'; judgmentId: string; scopeCwd: string; reasonVersion: string; evidenceFingerprint: string }
  | { type: 'judgment_action'; action: JudgmentActionIntent; todo: YoloTodoRowV2; scopeCwd: string; reasonVersion: string; evidenceFingerprint: string }
  | { type: 'expand_judgment' }
  | { type: 'suppress_judgment'; judgmentId: string; scopeCwd: string; reasonVersion: string; evidenceFingerprint: string }
  | { type: 'feedback_judgment'; judgmentId: string; scopeCwd: string; reasonVersion: string; evidenceFingerprint: string }
  | { type: 'complete_todo'; todo: YoloTodoRowV2; scopeCwd: string }
  | { type: 'open_task'; todo: YoloTodoRowV2; scopeCwd: string }
  | { type: 'open_source'; source: JudgmentSource; todo: YoloTodoRowV2; scopeCwd: string }
  | { type: 'open_ledger' }
  | { type: 'review_changes' }
  | { type: 'discuss_closure' }

export interface TodaySurfaceProps extends BuildTodaySurfaceOptions {
  data: YoloDashboardData
  busyTodoId?: string
  renderQuickCapture?: () => ReactNode
  judgmentExpanded?: boolean
  onIntent: (intent: TodaySurfaceIntent) => void
}

function TodayTaskRow({ row, busy, onIntent }: {
  row: TodayTaskRowView
  busy: boolean
  onIntent: (intent: TodaySurfaceIntent) => void
}): JSX.Element {
  const openTask = (): void => { onIntent({ type: 'open_task', todo: row.todo, scopeCwd: row.scopeCwd }) }
  const source = row.source
  return (
    <li
      className="v2-today-row"
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
          <p><span>{row.reason.label}</span> · {row.reason.explanation}</p>
        ) : null}
        <div className="v2-today-row-meta">
          {source.sessionId ? (
            <button
              type="button"
              onClick={() => { onIntent({ type: 'open_source', source, todo: row.todo, scopeCwd: row.scopeCwd }) }}
            >
              {source.label}
            </button>
          ) : <span>{source.label}</span>}
          {row.todo.ws ? <span>{row.todo.ws.label}</span> : null}
          {row.todo.due_at ? <time dateTime={row.todo.due_at}>{row.todo.due_at}</time> : null}
        </div>
      </div>
      <button type="button" disabled={busy} onClick={openTask}>处理</button>
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
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <ul>
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
        <h1 id="v2-today-title">今天</h1>
        <p>{model.description}</p>
      </header>

      <section aria-label="快速记录">
        {renderQuickCapture
          ? renderQuickCapture()
          : <button type="button" onClick={() => { onIntent({ type: 'quick_capture' }) }}>快速记录</button>}
      </section>

      {model.partialMessage ? <p role="status" className="v2-today-partial">{model.partialMessage}</p> : null}

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
        />
      ) : null}

      <TaskSection id="v2-attention-title" title="需要关注" rows={model.attentionRows} busyTodoId={busyTodoId} onIntent={onIntent} />
      <TaskSection id="v2-today-list-title" title="今天" rows={model.todayRows} busyTodoId={busyTodoId} onIntent={onIntent} />

      <section aria-labelledby="v2-progress-title">
        <h2 id="v2-progress-title">今天进展</h2>
        <button type="button" onClick={() => { onIntent({ type: 'open_ledger' }) }}>
          已完成 {model.progress.completed} 项 · 变更 {model.progress.changes} 条 · 来自 {model.progress.sessions} 个会话
        </button>
      </section>

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
