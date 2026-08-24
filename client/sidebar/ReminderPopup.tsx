import { useCallback, useEffect, useRef, useState } from 'react'
import { IcBell, IcClose } from '../design/icons.tsx'
import { detectYoloTheme, ensureYoloStyle } from '../design/style.ts'
import type { ReminderPopupCandidate } from './reminder-popup.ts'

export interface ReminderPopupProps {
  popup: ReminderPopupCandidate
  onOpen: () => void
  onDismiss: () => void
  durationMs?: number
}

function cleanText(value: string): string {
  return value.replace(/^[\uFFFD⏰☀🌙]\s*/u, '')
}

/** Non-modal reminder: it never steals focus and retires after ten active seconds. */
export function ReminderPopup({ popup, onOpen, onDismiss, durationMs = 10_000 }: ReminderPopupProps): JSX.Element {
  ensureYoloStyle()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => detectYoloTheme())
  const remainingRef = useRef(durationMs)
  const startedAtRef = useRef(0)
  const paused = hovered || focused || hidden

  useEffect(() => {
    remainingRef.current = durationMs
  }, [durationMs, popup.notification.id])

  useEffect(() => {
    const update = (): void => { setHidden(document.hidden) }
    document.addEventListener('visibilitychange', update)
    return () => { document.removeEventListener('visibilitychange', update) }
  }, [])

  useEffect(() => {
    const body = document.body
    const update = (): void => { setTheme(detectYoloTheme()) }
    const observer = new MutationObserver(update)
    observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style', 'class'] })
    return () => { observer.disconnect() }
  }, [])

  useEffect(() => {
    if (paused) return
    startedAtRef.current = Date.now()
    const timer = window.setTimeout(onDismiss, remainingRef.current)
    return () => {
      window.clearTimeout(timer)
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current))
    }
  }, [paused, onDismiss, popup.notification.id])

  const enter = useCallback(() => { setHovered(true) }, [])
  const leave = useCallback(() => { setHovered(false) }, [])
  const notification = popup.notification
  const label = notification.kind === 'brief' ? '助手简报' : '到期提醒'

  return (
    <section
      className="yolo-scope yolo-reminder-popup"
      data-y-theme={theme}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocusCapture={() => { setFocused(true) }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <button type="button" className="yolo-reminder-popup__body" onClick={onOpen} aria-label={`${label}：${cleanText(notification.title)}，打开助手看板`}>
        <span className="yolo-reminder-popup__icon"><IcBell size={15} /></span>
        <span className="yolo-reminder-popup__content">
          <span className="yolo-reminder-popup__kind">{label}</span>
          <strong>{cleanText(notification.title)}</strong>
          {notification.body && <span className="yolo-reminder-popup__detail">{cleanText(notification.body)}</span>}
          {popup.additional > 0 && <span className="yolo-reminder-popup__more">另有 {popup.additional} 条新提醒</span>}
        </span>
        <span className="yolo-reminder-popup__open">查看</span>
      </button>
      <button type="button" className="yolo-reminder-popup__close" onClick={onDismiss} aria-label="关闭提醒弹窗" title="关闭">
        <IcClose size={13} />
      </button>
    </section>
  )
}
