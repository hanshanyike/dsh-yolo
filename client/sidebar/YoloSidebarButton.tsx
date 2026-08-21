// YOLO global sidebar button (browser) — root-level footer action.
// Minimal trigger with a live open-todo badge; opens a compact fixed-position
// popover on click. Session-independent: it fetches /yolo/dashboard directly.

import { useEffect, useRef, useState } from 'react'
import type { YoloDashboardData } from '../../src/shared/dashboard.ts'

interface YoloSidebarButtonProps {
  /** True when the sidebar is expanded (wide) — show the label; collapsed shows icon only. */
  wide?: boolean
}

interface LoadState {
  loading: boolean
  error: string | null
  data: YoloDashboardData | null
}

function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Dismiss the popover on clicks/touches outside the button and panel. */
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

export function YoloSidebarButton({ wide = true }: YoloSidebarButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<LoadState>({ loading: false, error: null, data: null })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | undefined>()

  // Load once on mount for badge counts; refresh every time the popover opens.
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      setState((s) => ({ ...s, loading: true, error: null }))
      try {
        const r = await fetch('/yolo/dashboard', { headers: { accept: 'application/json' } })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = (await r.json()) as YoloDashboardData
        if (!cancelled) setState({ loading: false, error: null, data })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e instanceof Error ? e.message : String(e), data: null })
      }
    }
    void load()
    return () => { cancelled = true }
  }, [open])

  // Position the fixed popover relative to the button.
  useEffect(() => {
    if (!open) {
      setAnchor(undefined)
      return
    }
    const place = (): void => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      // Align the popover's left edge with the button's left edge; sit just above it.
      setAnchor({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open])

  useDismissOnOutsidePointer(buttonRef, panelRef, open, () => { setOpen(false) })

  const openTodos = state.data?.todos.filter((t) => t.status !== 'done' && t.status !== 'completed') ?? []
  const dueTodos = openTodos.filter((t) => t.due_at).sort((a, b) => (a.due_at! < b.due_at! ? -1 : 1))
  const activeGoals = state.data?.goals.filter((g) => g.status === 'active') ?? []
  const openMilestones = state.data?.milestones.filter((m) => m.status !== 'achieved' && m.status !== 'done') ?? []
  const badgeCount = openTodos.length

  const hasAny = dueTodos.length > 0 || activeGoals.length > 0 || openMilestones.length > 0 || (state.data?.preferences.length ?? 0) > 0

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => { setOpen((v) => !v) }}
        title="YOLO 个人记忆看板"
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
        <span style={{ fontSize: 14 }}>🎯</span>
        {wide && <span>YOLO</span>}
        {badgeCount > 0 && (
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
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </button>

      {open && anchor !== undefined && (
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            left: anchor.left,
            bottom: anchor.bottom,
            minWidth: 260,
            maxWidth: 340,
            maxHeight: 'min(520px, 70vh)',
            overflowY: 'auto',
            background: 'var(--background, #fff)',
            color: 'var(--foreground, #111)',
            border: '1px solid var(--border, #ddd)',
            borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
            padding: 14,
            fontSize: 13,
            zIndex: 10000,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <strong style={{ fontSize: 14 }}>YOLO 看板</strong>
            {state.data && <span style={{ fontSize: 11, opacity: 0.55 }}>更新于 {fmtTime(state.data.at)}</span>}
          </div>

          {state.loading && <p style={{ opacity: 0.6, margin: 0 }}>加载中…</p>}
          {state.error && <p style={{ color: '#c0392b', margin: 0 }}>加载失败：{state.error}</p>}

          {!state.loading && !state.error && state.data === null && (
            <p style={{ opacity: 0.6, margin: 0 }}>尚未加载数据。</p>
          )}

          {!state.loading && !state.error && state.data !== null && !hasAny && (
            <p style={{ opacity: 0.6, margin: 0 }}>暂无任务、目标或里程碑。</p>
          )}

          {state.data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {dueTodos.length > 0 && (
                <section>
                  <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12, opacity: 0.8 }}>📋 待办任务 · {dueTodos.length}</div>
                  <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
                    {dueTodos.slice(0, 5).map((t) => (
                      <li key={t.id}>
                        {t.title}
                        {t.due_at && <span style={{ opacity: 0.55, marginLeft: 4 }}>({t.due_at})</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {activeGoals.length > 0 && (
                <section>
                  <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12, opacity: 0.8 }}>🎯 进行中目标 · {activeGoals.length}</div>
                  <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
                    {activeGoals.slice(0, 4).map((g) => (
                      <li key={g.id}>{g.title} <span style={{ opacity: 0.55 }}>{g.progress}%</span></li>
                    ))}
                  </ul>
                </section>
              )}

              {openMilestones.length > 0 && (
                <section>
                  <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12, opacity: 0.8 }}>🚩 里程碑 · {openMilestones.length}</div>
                  <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
                    {openMilestones.slice(0, 4).map((m) => (
                      <li key={m.id}>
                        {m.title}
                        {m.target_date && <span style={{ opacity: 0.55, marginLeft: 4 }}>({m.target_date})</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {state.data.preferences.length > 0 && (
                <section>
                  <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12, opacity: 0.8 }}>💡 偏好 · {state.data.preferences.length}</div>
                  <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
                    {state.data.preferences.slice(0, 4).map((p) => (
                      <li key={p.id}><strong>{p.key}</strong>: {p.value}</li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
