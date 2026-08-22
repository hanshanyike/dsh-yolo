// YOLO global sidebar entry (browser) — root-level footer action. The button
// carries the unhandled-notification signal as a mono dot badge (TB-3, no
// breathing) and opens the full-width YOLO panel: the kanban body plus the
// chat surface in its two sizes. The button keeps its own light 30s poll so
// the badge follows reminders even while the panel is closed.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { YoloDashboardData } from '../../src/shared/dashboard.ts'
import { YoloLogo } from '../YoloLogo.tsx'
import { YoloPanel } from '../panel/YoloPanel.tsx'

interface YoloSidebarDashboardProps {
  /** True when the sidebar is expanded (wide) — show the label; collapsed shows icon only. */
  wide?: boolean
  /** Slot-injected: jump to a dsh session (ledger source badges). */
  openSession?: (sessionId: string) => void
}

const POLL_MS = 30_000

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
      onClose()
    }
    document.addEventListener('pointerdown', listener)
    return () => { document.removeEventListener('pointerdown', listener) }
  }, [open, onClose, buttonRef, panelRef])
}

export function YoloSidebarDashboard({ wide = true, openSession }: YoloSidebarDashboardProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [unhandled, setUnhandled] = useState(0)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [anchorLeft, setAnchorLeft] = useState<number | undefined>()

  // badge feed: light dashboard poll, always on (TB-3 — reminders arrive while
  // the panel is closed and must surface on the badge).
  const loadBadge = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch('/yolo/dashboard', { headers: { accept: 'application/json' }, cache: 'no-store' })
      if (!r.ok) return
      const data = (await r.json()) as YoloDashboardData
      setUnhandled(data.unhandled ?? 0)
    } catch {
      // host not serving yet — keep the last badge, try again next tick
    }
  }, [])

  useEffect(() => {
    void loadBadge()
    const timer = window.setInterval(() => { void loadBadge() }, POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [loadBadge])

  // While the panel is open, sync the badge faster: it shares the dashboard.
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => { void loadBadge() }, 5_000)
    return () => { window.clearInterval(timer) }
  }, [open, loadBadge])

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
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open])

  const close = useCallback(() => { setOpen(false) }, [])
  useDismissOnOutsidePointer(buttonRef, panelRef, open, close)

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => { setOpen((v) => !v) }}
        title={unhandled > 0 ? `YOLO 助手看板 · ${unhandled} 条未处理提醒` : 'YOLO 助手看板'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: wide ? 'flex-start' : 'center',
          gap: 8,
          width: '100%',
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid transparent',
          background: open ? 'var(--background-hover, rgba(0,0,0,0.05))' : 'transparent',
          color: 'var(--foreground-secondary, #666)',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '.02em',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ position: 'relative', display: 'flex', flex: 'none' }}>
          <YoloLogo size={16} />
          {unhandled > 0 && (
            <span
              aria-label={`${unhandled} 条未处理提醒`}
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 6,
                height: 6,
                borderRadius: 999,
                background: 'var(--accent, #5B5BD6)',
                boxShadow: '0 0 0 1.5px var(--background, #FAFAFA)',
              }}
            />
          )}
        </span>
        {wide && <span>YOLO</span>}
      </button>

      {open && anchorLeft !== undefined && (
        <div ref={panelRef} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10000 }}>
          <div style={{ pointerEvents: 'auto', position: 'absolute', inset: 0 }}>
            <YoloPanel left={anchorLeft} onClose={close} openSession={openSession} />
          </div>
        </div>
      )}
    </>
  )
}
