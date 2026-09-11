import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  YoloNotificationDismissOutcome,
  YoloNotificationLogData,
  YoloNotificationLogItem,
  YoloNotificationSeenOutcome,
} from '../../src/contracts/notifications.ts'
import { IcBell, IcChevron, IcClose } from '../design/icons.tsx'
import { hostSkewHint } from './host-skew.ts'

export interface NotificationLogProps {
  targetId?: string
  refreshRequest?: number
  onClose: () => void
  onOpenTodo: (item: YoloNotificationLogItem) => void
  onUnseenChange: (unseen: number, revision: number) => void
}

function cleanText(value: string): string {
  return value.replace(/^[\uFFFD⏰☀🌙]\s*/u, '')
}

function cleanBriefBody(body: string | null | undefined, title: string): string {
  const text = cleanText(body ?? '').trim()
  if (!text) return ''
  const lines = text.split('\n')
  if (lines[0]?.trim() === title.trim()) lines.shift()
  return lines.join('\n').trim()
}

function localDay(ms: number): string {
  const date = new Date(ms)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`
  const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`
  if (key === todayKey) return '今天'
  if (key === yesterdayKey) return '昨天'
  return '更早'
}

function localTime(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function kindLabel(item: YoloNotificationLogItem): string {
  if (item.kind === 'reminder') return item.todo_id ? '到期提醒' : '独立提醒'
  if (item.title.includes('早报')) return '早报'
  if (item.title.includes('晚报')) return '晚报'
  return '简报'
}

function groupItems(items: readonly YoloNotificationLogItem[]): Array<{ label: string; items: YoloNotificationLogItem[] }> {
  const groups: Array<{ label: string; items: YoloNotificationLogItem[] }> = []
  for (const item of items) {
    const label = localDay(item.created_at)
    const current = groups.at(-1)
    if (current?.label === label) current.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

async function markBaselineSeen(openedAt: number): Promise<YoloNotificationSeenOutcome> {
  const response = await fetch('/yolo/notifications/seen', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ opened_at: openedAt }),
  })
  if (!response.ok) throw new Error(hostSkewHint(response.status) ?? `HTTP ${response.status}`)
  return await response.json() as YoloNotificationSeenOutcome
}

/** Remove one delivery, or the whole record, through the same endpoint. */
async function postDismiss(body: { notification?: { id: string; scope_cwd: string }; all?: boolean }): Promise<YoloNotificationDismissOutcome> {
  const response = await fetch('/yolo/notifications/dismiss', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  // 405 is the stale-host signature: the running server half never registered
  // this subpath, so the answer explains the restart instead of a bare code.
  if (!response.ok) throw new Error(hostSkewHint(response.status) ?? `HTTP ${response.status}`)
  return await response.json() as YoloNotificationDismissOutcome
}

export function NotificationLog({ targetId, refreshRequest = 0, onClose, onOpenTodo, onUnseenChange }: NotificationLogProps): JSX.Element {
  const [items, setItems] = useState<YoloNotificationLogItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partialMessage, setPartialMessage] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [pendingDismiss, setPendingDismiss] = useState<Set<string>>(new Set())
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const baselineMarkedRef = useRef<number | null>(null)
  const previousRefreshRef = useRef(0)

  const loadPage = useCallback(async (cursor?: string): Promise<void> => {
    const more = cursor !== undefined
    if (more) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const query = new URLSearchParams({ limit: '20' })
      if (cursor) query.set('cursor', cursor)
      const response = await fetch(`/yolo/notifications?${query.toString()}`, {
        headers: { accept: 'application/json' }, cache: 'no-store',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json() as YoloNotificationLogData
      setItems((current) => {
        const rows = more ? [...current] : []
        const seen = new Set(rows.map((item) => `${item.scope_cwd}\u0000${item.id}`))
        for (const item of data.items) {
          const key = `${item.scope_cwd}\u0000${item.id}`
          if (!seen.has(key)) { seen.add(key); rows.push(item) }
        }
        return rows
      })
      setNextCursor(data.nextCursor)
      setPartialMessage(data.partial ? `部分工作区暂不可用：${data.workspaceErrors.join('；')}` : null)
      onUnseenChange(data.unseen, data.revision)
      if (!more && baselineMarkedRef.current !== data.openedAt) {
        baselineMarkedRef.current = data.openedAt
        try {
          const outcome = await markBaselineSeen(data.openedAt)
          setItems((current) => current.map((item) => (
            item.created_at <= data.openedAt ? { ...item, seen: true } : item
          )))
          onUnseenChange(outcome.unseen, outcome.revision)
        } catch (markError) {
          setError(`通知已加载，但未读状态更新失败：${markError instanceof Error ? markError.message : String(markError)}`)
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [onUnseenChange])

  const dismissOne = useCallback(async (item: YoloNotificationLogItem): Promise<void> => {
    const key = `${item.scope_cwd}\u0000${item.id}`
    setPendingDismiss((current) => new Set(current).add(key))
    setError(null)
    try {
      const outcome = await postDismiss({ notification: { id: item.id, scope_cwd: item.scope_cwd } })
      setItems((current) => current.filter((row) => !(row.id === item.id && row.scope_cwd === item.scope_cwd)))
      setExpanded((current) => {
        if (!current.has(key)) return current
        const next = new Set(current)
        next.delete(key)
        return next
      })
      onUnseenChange(outcome.unseen, outcome.revision)
    } catch (dismissError) {
      setError(`删除通知失败：${dismissError instanceof Error ? dismissError.message : String(dismissError)}`)
    } finally {
      setPendingDismiss((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }, [onUnseenChange])

  const clearAll = useCallback(async (): Promise<void> => {
    setClearing(true)
    setError(null)
    try {
      const outcome = await postDismiss({ all: true })
      setItems([])
      setNextCursor(null)
      setExpanded(new Set())
      setConfirmClear(false)
      onUnseenChange(outcome.unseen, outcome.revision)
    } catch (clearError) {
      setError(`清除通知失败：${clearError instanceof Error ? clearError.message : String(clearError)}`)
    } finally {
      setClearing(false)
    }
  }, [onUnseenChange])

  useEffect(() => { void loadPage() }, [loadPage])
  useEffect(() => {
    if (refreshRequest <= 0 || refreshRequest === previousRefreshRef.current) return
    previousRefreshRef.current = refreshRequest
    void loadPage()
  }, [loadPage, refreshRequest])
  useEffect(() => { titleRef.current?.focus() }, [])
  useEffect(() => {
    if (!targetId || items.length === 0) return
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-notification-id]'))
      .find((element) => element.dataset.notificationId === targetId)
    target?.scrollIntoView({ block: 'center' })
    target?.focus()
  }, [items, targetId])

  const groups = groupItems(items)
  return (
    <section id="yolo-notification-log" className="notification-log" aria-labelledby="notification-log-title">
      <header className="notification-log__head">
        <div>
          <h2 id="notification-log-title" ref={titleRef} tabIndex={-1}>通知</h2>
          <p>最近到达的提醒和简报</p>
        </div>
        <button type="button" className="nact" onClick={() => { void loadPage() }}>刷新</button>
        {items.length > 0 || confirmClear ? (
          <button
            type="button"
            className="nact notification-log__clear"
            disabled={clearing}
            aria-expanded={confirmClear}
            aria-controls="yolo-notification-clear-confirm"
            onClick={() => { setConfirmClear((current) => !current) }}
          >
            一键清除
          </button>
        ) : null}
        <button type="button" className="hbtn" onClick={onClose} aria-label="关闭通知记录" title="关闭">
          <IcClose size={14} />
        </button>
      </header>

      {confirmClear ? (
        <div id="yolo-notification-clear-confirm" className="notification-log__confirm" role="alertdialog" aria-label="确认清除全部通知">
          <span>清除全部通知？清除后无法恢复。</span>
          <button type="button" className="nact" disabled={clearing} onClick={() => { setConfirmClear(false) }}>取消</button>
          <button type="button" className="nact danger" disabled={clearing} aria-busy={clearing} onClick={() => { void clearAll() }}>
            {clearing ? '正在清除…' : '确认清除'}
          </button>
        </div>
      ) : null}

      {partialMessage ? <p className="notification-log__partial" role="status">{partialMessage}</p> : null}
      {error ? (
        <div className="notification-log__error" role="alert">
          <span>{error}</span>
          <button type="button" className="nact" onClick={() => { void loadPage() }}>重试</button>
        </div>
      ) : null}

      <div className="notification-log__body">
        {loading && items.length === 0 ? (
          <div className="notification-log__skeleton" aria-label="正在加载通知"><span /><span /><span /></div>
        ) : groups.length === 0 ? (
          <div className="notification-log__empty">
            <IcBell size={18} />
            <h3>还没有通知</h3>
            <p>新的到期提醒和简报会保留在这里。</p>
          </div>
        ) : groups.map((group) => (
          <section key={group.label} className="notification-log__group" aria-labelledby={`notification-group-${group.label}`}>
            <h3 id={`notification-group-${group.label}`}>{group.label}</h3>
            <ol>
              {group.items.map((item) => {
                const title = cleanText(item.title)
                const body = item.kind === 'brief' ? cleanBriefBody(item.body, title) : cleanText(item.body ?? '')
                const isExpanded = expanded.has(`${item.scope_cwd}\u0000${item.id}`)
                const key = `${item.scope_cwd}\u0000${item.id}`
                return (
                  <li
                    key={key}
                    className={`notification-log__item${item.seen ? '' : ' is-new'}`}
                    data-notification-id={item.id}
                    tabIndex={targetId === item.id ? 0 : -1}
                  >
                    <div className="notification-log__meta">
                      <span><IcBell size={12} />{kindLabel(item)}</span>
                      {!item.seen ? <b>新</b> : null}
                      <time dateTime={new Date(item.created_at).toISOString()}>{localTime(item.created_at)}</time>
                      <button
                        type="button"
                        className="notification-log__dismiss"
                        data-notification-dismiss={item.id}
                        disabled={pendingDismiss.has(key)}
                        aria-label={`删除通知：${title}`}
                        title="删除这条通知"
                        onClick={() => { void dismissOne(item) }}
                      >
                        <IcClose size={12} />
                      </button>
                    </div>
                    <strong>{title}</strong>
                    {body ? <p className={isExpanded ? 'is-expanded' : ''}>{body}</p> : null}
                    <div className="notification-log__foot">
                      <span title={item.ws.cwd}>{item.ws.label}</span>
                      {item.todo ? <span>{item.todo.status === 'done' || item.todo.status === 'completed' ? '事项已完成' : item.todo.status === 'cancelled' ? '事项已取消' : '事项仍开放'}</span> : item.todo_id ? <span>原事项已不可用</span> : null}
                      <span className="notification-log__actions">
                        {item.kind === 'brief' && body ? (
                          <button type="button" className="nact" onClick={() => {
                            setExpanded((current) => {
                              const next = new Set(current)
                              if (next.has(key)) next.delete(key)
                              else next.add(key)
                              return next
                            })
                          }}>
                            {isExpanded ? '收起' : '展开'} <IcChevron size={10} className={isExpanded ? 'up' : ''} />
                          </button>
                        ) : null}
                        {item.todo ? <button type="button" className="nact" onClick={() => { onOpenTodo(item) }}>查看事项</button> : null}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
        {nextCursor ? (
          <button type="button" className="notification-log__more" disabled={loadingMore} onClick={() => { void loadPage(nextCursor) }}>
            {loadingMore ? '正在加载…' : '加载更多'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
