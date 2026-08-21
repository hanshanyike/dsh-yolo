// YOLO global sidebar dashboard (browser) — root-level footer action.
// The button shows a live open-todo badge; clicking opens a full-height
// dashboard drawer beside the sidebar (NOT the old compact floating popover):
// five sections, counts, manual refresh, and a 30s poll while open.
// Session-independent: it fetches /yolo/dashboard directly.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { YoloDashboardData } from '../../src/shared/dashboard.ts'
import { YoloLogo } from '../YoloLogo.tsx'

interface YoloSidebarDashboardProps {
  /** True when the sidebar is expanded (wide) — show the label; collapsed shows icon only. */
  wide?: boolean
}

interface LoadState {
  loading: boolean
  error: string | null
  data: YoloDashboardData | null
}

const POLL_MS = 30_000

function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.length > 10 ? iso.slice(0, 10) : iso
}

/** Dismiss the drawer on clicks/touches outside the button and panel. */
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

/** Close on Escape while open. */
function useDismissOnEscape(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', listener)
    return () => { document.removeEventListener('keydown', listener) }
  }, [open, onClose])
}

export function YoloSidebarDashboard({ wide = true }: YoloSidebarDashboardProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<LoadState>({ loading: false, error: null, data: null })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [anchorLeft, setAnchorLeft] = useState<number | undefined>()

  const load = useCallback(async (): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const r = await fetch('/yolo/dashboard', { headers: { accept: 'application/json' }, cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as YoloDashboardData
      setState({ loading: false, error: null, data })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }))
    }
  }, [])

  // Load once on mount for the badge count; refresh whenever the drawer opens.
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (open) void load()
  }, [open, load])

  // Poll while the drawer is open so live sessions keep the dashboard fresh.
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [open, load])

  // Anchor the drawer to the sidebar's right edge (the button spans the column).
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
  useDismissOnEscape(open, close)

  const openTodos = state.data?.todos.filter((t) => t.status !== 'done' && t.status !== 'completed') ?? []
  const dueTodos = openTodos.filter((t) => t.due_at).sort((a, b) => (a.due_at! < b.due_at! ? -1 : 1))
  const otherTodos = openTodos.filter((t) => !t.due_at)
  const activeGoals = state.data?.goals.filter((g) => g.status === 'active') ?? []
  const openMilestones = state.data?.milestones.filter((m) => m.status !== 'achieved' && m.status !== 'done') ?? []
  const preferences = state.data?.preferences ?? []
  const events = state.data?.events ?? []
  const badgeCount = openTodos.length
  const hasAny = dueTodos.length > 0 || otherTodos.length > 0 || activeGoals.length > 0 || openMilestones.length > 0 || preferences.length > 0 || events.length > 0

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

      {open && anchorLeft !== undefined && (
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            left: anchorLeft,
            top: 0,
            bottom: 0,
            width: `min(440px, calc(100vw - ${Math.round(anchorLeft)}px))`,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--background, #fff)',
            color: 'var(--foreground, #111)',
            borderLeft: '1px solid var(--border, #ddd)',
            borderRight: '1px solid var(--border, #ddd)',
            boxShadow: '8px 0 32px rgba(0,0,0,0.12)',
            fontSize: 13,
            zIndex: 10000,
          }}
        >
          {/* header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 16px',
              borderBottom: '1px solid var(--border, #eee)',
              flex: 'none',
            }}
          >
            <YoloLogo size={20} />
            <strong style={{ fontSize: 15 }}>YOLO 助手看板</strong>
            {state.data && (
              <span style={{ fontSize: 11, opacity: 0.55, whiteSpace: 'nowrap' }}>
                更新于 {fmtTime(state.data.at)}
              </span>
            )}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={() => { void load() }}
                title="立即刷新"
                style={{
                  padding: '3px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border, #ddd)',
                  background: 'transparent',
                  color: 'inherit',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {state.loading ? '刷新中…' : '↻ 刷新'}
              </button>
              <button
                type="button"
                onClick={close}
                title="关闭 (Esc)"
                style={{
                  padding: '3px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border, #ddd)',
                  background: 'transparent',
                  color: 'inherit',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </span>
          </div>

          {/* body */}
          <div style={{ overflowY: 'auto', padding: '14px 16px', flex: 1 }}>
            {state.error && (
              <p style={{ color: '#c0392b', margin: '0 0 10px' }}>加载失败：{state.error}（插件未加载或服务未启动？）</p>
            )}

            {!state.error && state.data === null && !state.loading && (
              <p style={{ opacity: 0.6, margin: 0 }}>尚未加载数据。</p>
            )}

            {!state.error && state.data !== null && !hasAny && (
              <div style={{ opacity: 0.7, lineHeight: 1.8 }}>
                <p style={{ margin: '0 0 6px' }}>暂无安排。完成一轮对话后，YOLO 会自动从中接进你的计划：</p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  <li>📋 待办任务（含截止时间与优先级）</li>
                  <li>🎯 长期目标 · 🚩 里程碑</li>
                  <li>💡 你的偏好（语言、代码风格、工作习惯）</li>
                  <li>🕒 决策与时间线事件</li>
                </ul>
                <p style={{ margin: '8px 0 0' }}>看板在打开期间每 30 秒自动刷新，也可点「↻ 刷新」。</p>
              </div>
            )}

            {state.data !== null && hasAny && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {(dueTodos.length > 0 || otherTodos.length > 0) && (
                  <section>
                    <SectionTitle emoji="📋" label={`待办任务 · ${openTodos.length}`} />
                    <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
                      {dueTodos.slice(0, 12).map((t) => (
                        <li key={t.id}>
                          {t.title}
                          {t.due_at && <span style={{ opacity: 0.55, marginLeft: 4 }}>({fmtDate(t.due_at)} 截止)</span>}
                          {t.priority && t.priority !== 'low' && (
                            <span style={{ opacity: 0.55, marginLeft: 4 }}>[{t.priority}]</span>
                          )}
                        </li>
                      ))}
                      {otherTodos.slice(0, 4).map((t) => (
                        <li key={t.id}>{t.title}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {activeGoals.length > 0 && (
                  <section>
                    <SectionTitle emoji="🎯" label={`进行中目标 · ${activeGoals.length}`} />
                    <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
                      {activeGoals.slice(0, 8).map((g) => (
                        <li key={g.id}>
                          {g.title}
                          {typeof g.progress === 'number' && g.progress > 0 && (
                            <span style={{ opacity: 0.55, marginLeft: 4 }}>{g.progress}%</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {openMilestones.length > 0 && (
                  <section>
                    <SectionTitle emoji="🚩" label={`里程碑 · ${openMilestones.length}`} />
                    <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
                      {openMilestones.slice(0, 8).map((m) => (
                        <li key={m.id}>
                          {m.title}
                          {m.target_date && <span style={{ opacity: 0.55, marginLeft: 4 }}>({fmtDate(m.target_date)})</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {preferences.length > 0 && (
                  <section>
                    <SectionTitle emoji="💡" label={`偏好 · ${preferences.length}`} />
                    <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
                      {preferences.slice(0, 10).map((p) => (
                        <li key={p.id}><strong>{p.key}</strong>: {p.value}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {events.length > 0 && (
                  <section>
                    <SectionTitle emoji="🕒" label={`时间线 · ${events.length}`} />
                    <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
                      {events.slice(0, 15).map((e) => (
                        <li key={e.id}>
                          <span style={{ opacity: 0.55, marginRight: 4 }}>{fmtTime(e.occurred_at)}</span>
                          {e.summary}
                          {e.kind === 'decision' && <span style={{ opacity: 0.45, marginLeft: 4 }}>[决策]</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </div>

          {/* footer */}
          <div
            style={{
              flex: 'none',
              padding: '8px 16px',
              borderTop: '1px solid var(--border, #eee)',
              fontSize: 11,
              opacity: 0.6,
            }}
          >
            YOLO 在每轮对话结束后用大模型语义提取记忆并自动去重；看板打开期间每 30 秒自动刷新。
            {state.data?.scopeKey ? ` 作用域 ${state.data.scopeKey}` : ''}
          </div>
        </div>
      )}
    </>
  )
}

function SectionTitle({ emoji, label }: { emoji: string; label: string }): JSX.Element {
  return (
    <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12, opacity: 0.8 }}>
      {emoji} {label}
    </div>
  )
}
