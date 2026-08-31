import { useCallback, useEffect, useMemo, useState } from 'react'
import type { YoloDashboardData, YoloItemSource, YoloTodoRow } from '../../src/contracts/dashboard.ts'
import type {
  YoloHistoryEvent,
  YoloHistoryItem,
  YoloHistoryStatusFilter,
} from '../../src/contracts/history.ts'
import type { HistoryChangeValue } from '../../src/contracts/history.ts'
import { IcChevron, IcPin } from '../design/icons.tsx'
import { fetchHistory } from './history-api.ts'
import { postYoloAction } from './v2/api.ts'

export type HistoryMode = 'timeline' | 'items'

interface HistoryViewProps {
  mode: HistoryMode
  /** null means all time; a date means one local calendar day. */
  day: string | null
  onDayChange: (day: string | null) => void
  dashboard: YoloDashboardData
  refreshDashboard: () => Promise<void>
  onOpenItemDetail?: (todo: YoloTodoRow) => void
  onOpenChangeSource?: (change: YoloHistoryEvent, source: YoloItemSource) => void
}

const KIND_LABEL: Record<string, string> = {
  todo_created: '新增', todo_started: '开始', todo_completed: '完成', todo_cancelled: '取消',
  todo_postponed: '改期', todo_remind_again: '再提醒', todo_updated: '更新', todo_reopened: '重新打开',
  todo_consolidated: '合并', todo_consolidation_undone: '撤销合并', todo_deleted: '删除', goal_progress: '目标进度', goal_status: '目标状态',
  goal_updated: '目标更新', milestone_status: '里程碑状态', milestone_updated: '里程碑更新',
  decision: '决定', milestone_reached: '里程碑达成',
}

const FIELD_LABEL: Record<string, string> = {
  title: '标题', detail: '备注', due_at: '截止时间', priority: '优先级', status: '状态',
  progress: '进度', milestone_id: '里程碑', record_status: '记录状态',
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待处理', in_progress: '进行中', done: '已完成', completed: '已完成', cancelled: '已取消',
  active: '进行中', achieved: '已达成', abandoned: '已放弃', planned: '计划中', merged: '已合并',
}

const TYPE_LABEL = { todo: '事项', goal: '目标', milestone: '里程碑' } as const

function valueText(field: string, value: HistoryChangeValue): string {
  if (value === null || value === '') return '无'
  if (field === 'status' || field === 'record_status') return STATUS_LABEL[String(value)] ?? String(value)
  if (field === 'progress') return `${value}%`
  return String(value)
}

function localDay(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dayLabel(day: string): string {
  const today = localDay(Date.now())
  const yesterday = localDay(Date.now() - 86_400_000)
  if (day === today) return '今天'
  if (day === yesterday) return '昨天'
  const date = new Date(`${day}T00:00:00`)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function timeLabel(ms: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(ms)
}

function dateTimeLabel(ms: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(ms)
}

function historyUrl(
  mode: HistoryMode,
  status: YoloHistoryStatusFilter,
  query: string,
  day: string | null,
  cursor?: string,
): string {
  const params = new URLSearchParams({ view: mode, status })
  if (query.trim()) params.set('q', query.trim())
  if (day) params.set('day', day)
  if (cursor) params.set('cursor', cursor)
  return `/yolo/history?${params.toString()}`
}

function EventRows({
  events,
  onOpenChangeSource,
}: {
  events: readonly YoloHistoryEvent[]
  onOpenChangeSource?: HistoryViewProps['onOpenChangeSource']
}): JSX.Element {
  return (
    <ol className="history-events">
      {events.map((event) => (
        <li key={`${event.scope_cwd}\u0000${event.id}`} className="history-event">
          <div className="history-event__rail"><span /><time>{timeLabel(event.occurred_at)}</time></div>
          <div className="history-event__body">
            <div className="history-event__head">
              <span className="history-event__kind">{KIND_LABEL[event.kind] ?? event.kind}</span>
              <span className="history-event__workspace" title={event.scope_cwd}>{event.ws.label}</span>
            </div>
            <strong>{event.summary}</strong>
            {event.change && Object.keys(event.change).length > 0 ? (
              <dl className="history-event__changes">
                {Object.entries(event.change).map(([field, change]) => (
                  <div key={field}>
                    <dt>{FIELD_LABEL[field] ?? field}</dt>
                    <dd><span>{valueText(field, change.before)}</span><b aria-hidden="true">→</b><span>{valueText(field, change.after)}</span></dd>
                  </div>
                ))}
              </dl>
            ) : event.detail ? <p>{event.detail}</p> : null}
            <div className="history-event__foot">
              {event.subject ? <span>{TYPE_LABEL[event.subject.type]} · {event.subject.title}</span> : <span>早期记录 · 未关联事项</span>}
              {event.related_subject ? <span>关联到：{event.related_subject.title}</span> : null}
              {event.session_id && onOpenChangeSource ? (
                <button type="button" onClick={() => { onOpenChangeSource(event, {
                  type: 'session', label: event.label, session_id: event.session_id, workspace: event.ws,
                }) }}><IcPin size={10} />{event.label}</button>
              ) : <span><IcPin size={10} />{event.label}</span>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function SubjectHistory({ item, day, onOpenChangeSource }: {
  item: YoloHistoryItem
  day: string | null
  onOpenChangeSource?: HistoryViewProps['onOpenChangeSource']
}): JSX.Element {
  const [events, setEvents] = useState<YoloHistoryEvent[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (cursor?: string) => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      view: 'subject', subject_type: item.type, subject_id: item.id, scope_cwd: item.scope_cwd,
    })
    if (day) params.set('day', day)
    if (cursor) params.set('cursor', cursor)
    try {
      const data = await fetchHistory(`/yolo/history?${params.toString()}`)
      setEvents((current) => cursor ? [...current, ...data.events] : data.events)
      setNextCursor(data.nextCursor)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [day, item.id, item.scope_cwd, item.type])

  useEffect(() => { void load() }, [load])

  if (loading && events.length === 0) return <p className="history-inline-state">正在加载这项事情的变化…</p>
  if (error && events.length === 0) return <p className="history-inline-state is-error">{error}</p>
  if (events.length === 0) return <p className="history-inline-state">这是早期事项，暂时没有可可靠关联的变化。</p>
  return (
    <div className="history-subject-events">
      <EventRows events={events} onOpenChangeSource={onOpenChangeSource} />
      {error ? <p className="history-inline-state is-error">{error}</p> : null}
      {nextCursor ? <button type="button" className="history-more" disabled={loading} onClick={() => { void load(nextCursor) }}>{loading ? '正在加载…' : '继续加载'}</button> : null}
    </div>
  )
}

function ItemRow({
  item,
  day,
  dashboard,
  refreshDashboard,
  onOpenItemDetail,
  onOpenChangeSource,
  onChanged,
}: {
  item: YoloHistoryItem
  day: string | null
  dashboard: YoloDashboardData
  refreshDashboard: () => Promise<void>
  onOpenItemDetail?: HistoryViewProps['onOpenItemDetail']
  onOpenChangeSource?: HistoryViewProps['onOpenChangeSource']
  onChanged: () => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentTodo = item.type === 'todo'
    ? dashboard.todos.find((todo) => todo.id === item.id && (todo.scope_cwd ?? todo.ws?.cwd ?? dashboard.cwd) === item.scope_cwd)
    : undefined
  const canReopen = item.type === 'todo' && item.record_status !== 'merged'
    && ['done', 'completed', 'cancelled'].includes(item.status)
  const canUndoMerge = item.type === 'todo' && item.record_status === 'merged' && item.merge_undo_available === true
  const displayStatus = item.record_status === 'merged' ? '已合并' : STATUS_LABEL[item.status] ?? item.status

  const reopen = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await postYoloAction({ action: 'reopen', kind: 'todo', id: item.id, scope_cwd: item.scope_cwd })
      await refreshDashboard()
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const undoMerge = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await postYoloAction({ action: 'undo_consolidate', kind: 'todo', id: item.id, scope_cwd: item.scope_cwd })
      await refreshDashboard()
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="history-item" aria-label={`${displayStatus}：${item.title}`}>
      <div className="history-item__main">
        <button type="button" className="history-item__toggle" aria-expanded={expanded} onClick={() => { setExpanded((value) => !value) }}>
          <IcChevron size={11} className={expanded ? 'up' : ''} />
          <span>
            <strong>{item.title}</strong>
            <small>{TYPE_LABEL[item.type]} · {displayStatus} · {item.ws.label}</small>
          </span>
        </button>
        <div className="history-item__summary">
          <span>{item.change_count > 0 ? `${item.change_count} 次变化` : '早期事项'}</span>
          <time>{dateTimeLabel(item.last_changed_at)}</time>
          {item.latest_summary ? <p>{item.latest_summary}</p> : null}
        </div>
        <div className="history-item__actions">
          {currentTodo && onOpenItemDetail ? <button type="button" onClick={() => { onOpenItemDetail(currentTodo) }}>查看事项</button> : null}
          {canReopen ? <button type="button" disabled={busy} onClick={() => { void reopen() }}>{busy ? '处理中…' : '重新打开'}</button> : null}
          {canUndoMerge ? <button type="button" disabled={busy} onClick={() => { void undoMerge() }}>{busy ? '处理中…' : '撤销合并'}</button> : null}
        </div>
      </div>
      {error ? <p className="history-inline-state is-error" role="alert">{error}</p> : null}
      {expanded ? <SubjectHistory item={item} day={day} onOpenChangeSource={onOpenChangeSource} /> : null}
    </li>
  )
}

export function HistoryView({ mode, day, onDayChange, dashboard, refreshDashboard, onOpenItemDetail, onOpenChangeSource }: HistoryViewProps): JSX.Element {
  const today = localDay(Date.now())
  const [status, setStatus] = useState<YoloHistoryStatusFilter>('all')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [events, setEvents] = useState<YoloHistoryEvent[]>([])
  const [items, setItems] = useState<YoloHistoryItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partial, setPartial] = useState<string[]>([])
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(queryInput.trim()) }, 220)
    return () => { window.clearTimeout(timer) }
  }, [queryInput])

  const load = useCallback(async (cursor?: string) => {
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const data = await fetchHistory(historyUrl(mode, mode === 'items' ? status : 'all', mode === 'items' ? query : '', day, cursor))
      setEvents((current) => cursor ? [...current, ...data.events] : data.events)
      setItems((current) => cursor ? [...current, ...data.items] : data.items)
      setNextCursor(data.nextCursor)
      setPartial(data.workspaceErrors)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      if (!cursor) { setEvents([]); setItems([]) }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [day, mode, query, status])

  useEffect(() => { void load() }, [load, reload])

  const groups = useMemo(() => {
    const map = new Map<string, YoloHistoryEvent[]>()
    for (const event of events) {
      const day = localDay(event.occurred_at)
      const current = map.get(day) ?? []
      current.push(event)
      map.set(day, current)
    }
    return [...map.entries()]
  }, [events])

  return (
    <section className="history-view" aria-label={mode === 'timeline' ? '按时间查看历史' : '按事项查看历史'}>
      <header className="history-view__header">
        <div><h2>{mode === 'timeline' ? '时间线' : '事项变化'}</h2><p>{mode === 'timeline' ? '按发生时间回顾用户可理解的变化。' : '查看每件事情如何走到当前状态。'}</p></div>
        <div className="history-view__filters">
          <label><span>时间</span><input type="date" value={day ?? ''} onChange={(event) => { onDayChange(event.target.value || null) }} aria-label="历史日期" /></label>
          <button type="button" className="history-time-toggle" onClick={() => { onDayChange(day === null || day !== today ? today : null) }}>
            {day === null ? '只看今天' : day === today ? '全部时间' : '今天'}
          </button>
          {mode === 'items' ? <input type="search" value={queryInput} onChange={(event) => { setQueryInput(event.target.value) }} aria-label="搜索历史事项" placeholder="搜索事项…" /> : null}
        </div>
      </header>
      {mode === 'items' ? (
        <div className="caps history-status" role="group" aria-label="历史事项状态">
          {([
            ['all', '全部'], ['open', '进行中'], ['ended', '已结束'], ['completed', '已完成'], ['cancelled', '已取消'],
          ] as Array<[YoloHistoryStatusFilter, string]>).map(([key, label]) => (
            <button key={key} type="button" className={`cap${status === key ? ' on' : ''}`} aria-pressed={status === key} onClick={() => { setStatus(key) }}>{label}</button>
          ))}
        </div>
      ) : null}
      {partial.length > 0 ? <p className="history-partial" role="status">部分工作区暂时不可用：{partial.join('；')}</p> : null}
      {error ? <div className="history-error" role="alert"><span>{error}</span><button type="button" onClick={() => { void load() }}>重试</button></div> : null}
      {loading ? <div className="history-loading" aria-label="正在加载历史"><span /><span /><span /></div> : mode === 'timeline' ? (
        groups.length === 0 ? <div className="empty"><h4>还没有可展示的变化</h4><p>新增、改期、完成与取消会按时间保留在这里。</p></div> : groups.map(([day, rows]) => (
          <section key={day} className="history-day" aria-labelledby={`history-day-${day}`}>
            <h3 id={`history-day-${day}`}>{dayLabel(day)}<span>{day}</span></h3>
            <EventRows events={rows} onOpenChangeSource={onOpenChangeSource} />
          </section>
        ))
      ) : items.length === 0 ? (
        <div className="empty"><h4>没有符合条件的事项</h4><p>可以调整状态筛选或搜索关键词。</p></div>
      ) : (
        <ol className="history-items">
          {items.map((item) => <ItemRow
            key={`${item.scope_cwd}\u0000${item.type}\u0000${item.id}`}
            item={item}
            day={day}
            dashboard={dashboard}
            refreshDashboard={refreshDashboard}
            onOpenItemDetail={onOpenItemDetail}
            onOpenChangeSource={onOpenChangeSource}
            onChanged={() => { setReload((value) => value + 1) }}
          />)}
        </ol>
      )}
      {nextCursor ? <button type="button" className="history-more" disabled={loadingMore} onClick={() => { void load(nextCursor) }}>{loadingMore ? '正在加载…' : '加载更多'}</button> : null}
    </section>
  )
}
