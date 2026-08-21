// YOLO global sidebar button (browser) — lives in the app sidebar footer,
// independent of any session. Clicking it fetches the live dashboard JSON
// from the host (/yolo/dashboard) and expands an inline summary panel.

import { useEffect, useState } from 'react'
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

export function YoloSidebarButton({ wide = true }: YoloSidebarButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<LoadState>({ loading: false, error: null, data: null })

  useEffect(() => {
    if (!open || state.data) return
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    fetch('/yolo/dashboard', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => { if (!cancelled) setState({ loading: false, error: null, data: data as YoloDashboardData }) })
      .catch((e: Error) => { if (!cancelled) setState({ loading: false, error: e.message, data: null }) })
    return () => { cancelled = true }
  }, [open, state.data])

  const openTodos = state.data?.todos.filter((t) => t.status !== 'done' && t.status !== 'completed') ?? []
  const dueTodos = openTodos.filter((t) => t.due_at).sort((a, b) => (a.due_at! < b.due_at! ? -1 : 1))
  const activeGoals = state.data?.goals.filter((g) => g.status === 'active') ?? []

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
          background: 'transparent',
          color: 'var(--foreground-secondary, #666)',
          cursor: 'pointer',
          fontSize: 13,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: 14 }}>🎯</span>
        {wide && <span>YOLO</span>}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            minWidth: 280,
            maxWidth: 360,
            maxHeight: 420,
            overflowY: 'auto',
            background: 'var(--background, #fff)',
            border: '1px solid var(--border, #ddd)',
            borderRadius: 10,
            boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
            padding: 12,
            fontSize: 13,
            zIndex: 1000,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>🎯 YOLO 看板</strong>
            {state.data && <span style={{ fontSize: 11, opacity: 0.55 }}>{fmtTime(state.data.at)}</span>}
          </div>

          {state.loading && <p style={{ opacity: 0.6, margin: 0 }}>加载中…</p>}
          {state.error && <p style={{ color: '#c0392b', margin: 0 }}>加载失败：{state.error}</p>}
          {!state.loading && !state.error && state.data === null && (
            <p style={{ opacity: 0.6, margin: 0 }}>暂无数据。开始对话后，这里会显示提取的任务 / 目标 / 偏好。</p>
          )}

          {state.data && (
            <>
              {dueTodos.length > 0 && (
                <>
                  <div style={{ fontWeight: 600, margin: '4px 0' }}>📋 任务 ({dueTodos.length})</div>
                  <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
                    {dueTodos.slice(0, 6).map((t) => (
                      <li key={t.id}>{t.title} <span style={{ opacity: 0.55 }}>[{t.due_at}]</span></li>
                    ))}
                  </ul>
                </>
              )}
              {activeGoals.length > 0 && (
                <>
                  <div style={{ fontWeight: 600, margin: '8px 0 4px' }}>🎯 目标</div>
                  <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
                    {activeGoals.slice(0, 4).map((g) => (
                      <li key={g.id}>{g.title} <span style={{ opacity: 0.55 }}>{g.progress}%</span></li>
                    ))}
                  </ul>
                </>
              )}
              {state.data.preferences.length > 0 && (
                <>
                  <div style={{ fontWeight: 600, margin: '8px 0 4px' }}>💡 偏好</div>
                  <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
                    {state.data.preferences.slice(0, 4).map((p) => (
                      <li key={p.id}>{p.key}: {p.value}</li>
                    ))}
                  </ul>
                </>
              )}
              {dueTodos.length === 0 && activeGoals.length === 0 && (
                <p style={{ opacity: 0.6, margin: 0 }}>暂无任务与目标，继续对话吧。</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
