// YOLO global sidebar entry (browser) — root-level footer action. The button
// carries the unseen-notification signal as a mono dot badge (TB-3, no
// breathing) and opens the full-width YOLO panel: the kanban body plus the
// chat surface in its two sizes. The button keeps its own lightweight poll so
// the badge follows reminders even while the panel is closed.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { YoloBadgeData } from '../../src/contracts/badge.ts'
import { YoloLogo } from '../YoloLogo.tsx'
import { nextYoloSurfaceLabel, YOLO_SURFACE_LABELS, yoloSurfaceTitle } from '../brand.ts'
import { YoloPanel } from '../panel/YoloPanel.tsx'
import { ReminderPopup } from './ReminderPopup.tsx'
import {
  INITIAL_REMINDER_OBSERVATION,
  observeReminderBadge,
  type ReminderObservationState,
  type ReminderPopupCandidate,
} from './reminder-popup.ts'

interface YoloSidebarDashboardProps {
  /** True when the sidebar is expanded (wide) — show the label; collapsed shows icon only. */
  wide?: boolean
  /** Slot-injected: jump to a dsh session (ledger source badges). */
  openSession?: (sessionId: string) => void
  /** Slot-injected host theme runtime bridge (durable preference owner). */
  setTheme?: (theme: 'dark' | 'light') => void
}

const POLL_MS = 5_000

/** Dismiss the panel on clicks/touches outside the button and panel. */
function useDismissOnOutsidePointer(
  buttonRef: React.RefObject<HTMLElement>,
  panelRef: React.RefObject<HTMLElement>,
  open: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return
    const listener = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (!target) return
      if (buttonRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('.yolo-reminder-popup')) return
      onClose()
    }
    document.addEventListener('pointerdown', listener)
    return () => { document.removeEventListener('pointerdown', listener) }
  }, [open, onClose, buttonRef, panelRef])
}

export function YoloSidebarDashboard({ wide = true, openSession, setTheme }: YoloSidebarDashboardProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [unseen, setUnseen] = useState(0)
  const [notificationPartial, setNotificationPartial] = useState(false)
  const [popup, setPopup] = useState<ReminderPopupCandidate | null>(null)
  const [notificationRefreshRequest, setNotificationRefreshRequest] = useState(0)
  const [notificationOpenRequest, setNotificationOpenRequest] = useState<{
    sequence: number
    notification: ReminderPopupCandidate['notification']
  } | undefined>()
  const [surfaceLabel, setSurfaceLabel] = useState<string>(YOLO_SURFACE_LABELS[0])
  const surfaceOpenedRef = useRef(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(open)
  const observationRef = useRef<ReminderObservationState>(INITIAL_REMINDER_OBSERVATION)
  const badgeRequestRef = useRef<Promise<void> | null>(null)
  const badgeRevisionRef = useRef(0)
  const [anchorLeft, setAnchorLeft] = useState<number | undefined>()
  openRef.current = open

  // Lightweight badge/reminder feed, always on: reminders can arrive while
  // the panel is closed, without forcing a full dashboard projection.
  const loadBadge = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch('/yolo/badge', { headers: { accept: 'application/json' }, cache: 'no-store' })
      if (!r.ok) return
      const data = (await r.json()) as YoloBadgeData
      const revision = data.revision ?? Date.now()
      if (revision >= badgeRevisionRef.current) {
        badgeRevisionRef.current = revision
        setUnseen(data.unseen ?? data.unhandled ?? 0)
        setNotificationPartial(data.partial === true)
      }
      const observation = observeReminderBadge(observationRef.current, data)
      observationRef.current = observation.state
      if (observation.popup) {
        if (openRef.current) {
          setNotificationRefreshRequest((value) => value + 1)
        } else {
          setPopup(observation.popup)
        }
      }
    } catch {
      // host not serving yet — keep the last badge, try again next tick
    }
  }, [])

  const refreshBadge = useCallback((): Promise<void> => {
    if (badgeRequestRef.current) return badgeRequestRef.current
    const request = loadBadge().finally(() => {
      if (badgeRequestRef.current === request) badgeRequestRef.current = null
    })
    badgeRequestRef.current = request
    return request
  }, [loadBadge])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const tick = async (): Promise<void> => {
      await refreshBadge()
      if (!cancelled) timer = window.setTimeout(() => { void tick() }, POLL_MS)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [refreshBadge])

  // A foregrounded window should not wait for the next poll. refreshBadge is
  // serialized, so focus + visibility events cannot overlap or land out of order.
  useEffect(() => {
    const refreshWhenVisible = (): void => {
      if (!document.hidden) void refreshBadge()
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [refreshBadge])

  // Anchor the panel to the sidebar's right edge (the button spans the column).
  useEffect(() => {
    if (!open) {
      setAnchorLeft(undefined)
      return
    }
    const place = (): void => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      setAnchorLeft(rect.right)
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    let observed: Element | null = buttonRef.current
    // The host collapses its sidebar by resizing/moving ancestors while the
    // footer button itself may already be at its compact width. Observe the
    // short ancestor chain so the panel follows the final visible right edge,
    // not an intermediate position from the window resize event.
    for (let depth = 0; observed && depth < 8; depth++) {
      observer?.observe(observed)
      observed = observed.parentElement
    }
    window.addEventListener('resize', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [open, wide])

  const close = useCallback(() => {
    setOpen(false)
    setNotificationRefreshRequest(0)
    setNotificationOpenRequest(undefined)
  }, [])
  const openPanel = useCallback(() => {
    if (surfaceOpenedRef.current) setSurfaceLabel((current) => nextYoloSurfaceLabel(current))
    else surfaceOpenedRef.current = true
    setOpen(true)
  }, [])
  const dismissPopup = useCallback(() => { setPopup(null) }, [])
  const openPopupReminder = useCallback(() => {
    const notification = popup?.notification
    if (!notification) return
    setPopup(null)
    openPanel()
    setNotificationOpenRequest((current) => ({
      sequence: (current?.sequence ?? 0) + 1,
      notification,
    }))
  }, [openPanel, popup])
  const handleUnseenChange = useCallback((nextUnseen: number, revision: number): void => {
    if (revision < badgeRevisionRef.current) return
    badgeRevisionRef.current = revision
    setUnseen(nextUnseen)
  }, [])
  useDismissOnOutsidePointer(buttonRef, panelRef, open, close)

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (open) close()
          else {
            setPopup(null)
            openPanel()
          }
        }}
        title={unseen > 0
          ? `${yoloSurfaceTitle(surfaceLabel)} · ${notificationPartial ? '至少 ' : ''}${unseen} 条新通知${notificationPartial ? '，部分工作区不可用' : ''}`
          : yoloSurfaceTitle(surfaceLabel)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: wide ? 'flex-start' : 'center',
          gap: 10,
          width: '100%',
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid transparent',
          background: open ? 'var(--background-hover, rgba(0,0,0,0.05))' : 'transparent',
          color: 'var(--foreground-secondary, #666)',
          cursor: 'pointer',
          fontSize: 15,
          fontWeight: 650,
          letterSpacing: '.02em',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ position: 'relative', display: 'flex', flex: 'none' }}>
          <YoloLogo size={20} />
          {unseen > 0 && (
            <span
              aria-label={`${notificationPartial ? '至少 ' : ''}${unseen} 条新通知${notificationPartial ? '，部分工作区不可用' : ''}`}
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 6,
                height: 6,
                borderRadius: 999,
                background: 'var(--accent, #4176E6)',
                boxShadow: '0 0 0 1.5px var(--background, #FAFAFA)',
              }}
            />
          )}
        </span>
        {wide && <span>YOLO</span>}
      </button>

      {popup && (
        <ReminderPopup
          key={popup.notification.id}
          popup={popup}
          onOpen={openPopupReminder}
          onDismiss={dismissPopup}
        />
      )}

      {open && anchorLeft !== undefined && (
        // The overlay must START at the sidebar's right edge (anchorLeft), not
        // cover the whole viewport: a full-viewport pointer-events layer would
        // swallow clicks on the sidebar session rows, so switching to another
        // session while the panel is open was impossible without closing it
        // first. With the overlay left-anchored, sidebar clicks pass through to
        // the app shell AND useDismissOnOutsidePointer closes the panel — the
        // session switch lands and the panel steps aside in one gesture.
        <div ref={panelRef} style={{ position: 'fixed', left: anchorLeft, top: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 10000 }}>
          <div style={{ pointerEvents: 'auto', position: 'absolute', inset: 0 }}>
            <YoloPanel
              left={anchorLeft}
              onClose={close}
              openSession={openSession}
              notificationRefreshRequest={notificationRefreshRequest}
              notificationOpenRequest={notificationOpenRequest}
              onUnseenChange={handleUnseenChange}
              themeControl={setTheme ? { set: setTheme } : undefined}
              surfaceLabel={surfaceLabel}
            />
          </div>
        </div>
      )}
    </>
  )
}
