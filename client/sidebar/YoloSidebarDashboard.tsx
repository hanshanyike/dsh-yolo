// YOLO global sidebar entry (browser) — root-level footer action. The button
// shows the unhandled-notification badge (TB-3) and opens the FULL-WIDTH YOLO
// panel (v0.3.0 A): session-width, 看板 Tab default + 侧栏对话 + 对话 Tab.
// The button keeps its own light 30s poll so the badge follows reminders even
// while the panel is closed.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { YoloDashboardData } from '../../src/shared/dashboard.ts'
import { YoloLogo } from '../YoloLogo.tsx'
import { YoloPanel } from '../panel/YoloPanel.tsx'

interface YoloSidebarDashboardProps {
  /** True when the sidebar is expanded (wide) — show the label; collapsed shows icon only. */
  wide?: boolean
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

export function YoloSidebarDashboard({ wide = true }: YoloSidebarDashboardProps): JSX.Element {
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
        title="YOLO 助手看板"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: wide ? 'flex-start' : 'center',
          gap: 8,
          width: '100%',
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid var(--border, #ddd)',
          background: open ? 'var(--background-hover, rgba(0,0,0,0.04))' : 'transparent',
          color: 'var(--foreground-secondary, #666)',
          cursor: 'pointer',
          fontSize: 13,
          whiteSpace: 'nowrap',
          position: 'relative',
        }}
      >
        <YoloLogo size={16} />
        {wide && <span>YOLO</span>}
        {unhandled > 0 && (
          <span
            style={{
              marginLeft: wide ? 'auto' : 0,
              minWidth: 16,
              height: 16,
              padding: '0 5px',
              borderRadius: 999,
              background: 'var(--accent, #2f6fed)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 600,
              lineHeight: '16px',
              textAlign: 'center',
            }}
          >
            {unhandled > 99 ? '99+' : unhandled}
          </span>
        )}
      </button>

      {open && anchorLeft !== undefined && (
        <div ref={panelRef} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10000 }}>
          <div style={{ pointerEvents: 'auto', position: 'absolute', inset: 0 }}>
            <YoloPanel left={anchorLeft} onClose={close} />
          </div>
        </div>
      )}
    </>
  )
}
