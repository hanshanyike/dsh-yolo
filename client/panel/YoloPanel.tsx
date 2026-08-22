// YOLO full-width panel shell (v0.3.0 A, TA-1) — opens beside the sidebar at
// session width. Two tabs over the same data: 看板 (default, KanbanView +
// collapsible side chat) and 对话 (the resident thread's full view). Tab,
// filter and side-chat visibility live in panel/state.ts so a close/reopen
// keeps them (TA-6).

import { useCallback, useEffect, useState } from 'react'
import type { YoloDashboardData } from '../../src/shared/dashboard.ts'
import { YoloLogo } from '../YoloLogo.tsx'
import { ChatPane, type ChatAnchor } from './ChatPane.tsx'
import { KanbanView } from './KanbanView.tsx'
import { readPanelState, writePanelState, type PanelTab } from './state.ts'

export interface YoloPanelProps {
  /** Panel left edge (the sidebar's right edge) — spans to the viewport right. */
  left: number
  onClose: () => void
}

interface LoadState {
  loading: boolean
  error: string | null
  data: YoloDashboardData | null
}

const POLL_MS = 30_000

const TABS: { key: PanelTab; label: string }[] = [
  { key: 'kanban', label: '看板' },
  { key: 'chat', label: '对话' },
]

export function YoloPanel({ left, onClose }: YoloPanelProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ loading: false, error: null, data: null })
  const initial = readPanelState()
  const [tab, setTab] = useState<PanelTab>(initial.tab)
  const [sideChatOpen, setSideChatOpen] = useState(initial.sideChatOpen)
  const [anchor, setAnchor] = useState<ChatAnchor | null>(null)

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

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [load])

  // Persist view state so reopening keeps tab / side chat (TA-6).
  useEffect(() => { writePanelState({ tab }) }, [tab])
  useEffect(() => { writePanelState({ sideChatOpen }) }, [sideChatOpen])

  // Esc closes the side chat first (TA-3), then the panel itself.
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (sideChatOpen && tab === 'kanban') closeSideChat()
      else onClose()
    }
    document.addEventListener('keydown', listener)
    return () => { document.removeEventListener('keydown', listener) }
  })

  const openAnchoredChat = useCallback((a: ChatAnchor) => {
    setAnchor(a)
    setSideChatOpen(true)
  }, [])

  // TA-4: the plain 对话 toggle opens the side chat with board-wide context.
  const toggleSideChat = useCallback(() => {
    setAnchor(null)
    setSideChatOpen((v) => !v)
  }, [])

  const closeSideChat = useCallback(() => {
    setSideChatOpen(false)
    setAnchor(null)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        left,
        right: 0,
        top: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--background, #fff)',
        color: 'var(--foreground, #111)',
        borderLeft: '1px solid var(--border, #ddd)',
        boxShadow: '8px 0 32px rgba(0,0,0,0.12)',
        fontSize: 13,
        zIndex: 10000,
      }}
    >
      {/* header: tabs + actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 20px',
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

        <span style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => { setTab(t.key) }}
              style={{
                padding: '4px 14px',
                borderRadius: 8,
                border: 'none',
                background: tab === t.key ? 'rgba(47,111,237,0.12)' : 'transparent',
                color: tab === t.key ? 'var(--accent, #2f6fed)' : 'var(--foreground-secondary, #666)',
                fontWeight: tab === t.key ? 600 : 400,
                fontSize: 13,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          ))}
        </span>

        {/* the persistent chat toggle (design 4.2 #8) — kanban tab only */}
        {tab === 'kanban' && (
          <button
            type="button"
            onClick={toggleSideChat}
            title={sideChatOpen ? '收起侧栏对话 (Esc)' : '展开侧栏对话'}
            style={{
              padding: '4px 12px',
              borderRadius: 8,
              border: '1px solid var(--border, #ddd)',
              background: sideChatOpen ? 'rgba(47,111,237,0.08)' : 'transparent',
              color: sideChatOpen ? 'var(--accent, #2f6fed)' : 'inherit',
              fontSize: 12,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            💬 对话
          </button>
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
            onClick={onClose}
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

      {/* body: main area + side chat */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {state.error && (
            <p style={{ color: '#c0392b', margin: 0, padding: '14px 20px 0' }}>加载失败：{state.error}（插件未加载或服务未启动？）</p>
          )}
          {!state.error && state.data === null && !state.loading && (
            <p style={{ opacity: 0.6, padding: '14px 20px' }}>尚未加载数据。</p>
          )}
          {state.data !== null && (
            tab === 'kanban'
              ? <KanbanView data={state.data} refresh={load} onOpenChat={openAnchoredChat} />
              : <ChatPane variant="full" />
          )}
        </div>

        {tab === 'kanban' && sideChatOpen && (
          <aside
            style={{
              flex: 'none',
              width: 'min(400px, 40%)',
              borderLeft: '1px solid var(--border, #eee)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderBottom: '1px solid var(--border, #eee)',
                fontSize: 12,
                opacity: 0.8,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                侧栏对话{anchor ? ` · ${anchor.title}` : ' · 看板全局'}
              </span>
              <button
                type="button"
                onClick={closeSideChat}
                title="收起 (Esc)"
                style={{
                  padding: '2px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border, #ddd)',
                  background: 'transparent',
                  color: 'inherit',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ChatPane variant="side" anchor={anchor} />
            </div>
          </aside>
        )}
      </div>

      {/* footer */}
      <div
        style={{
          flex: 'none',
          padding: '8px 20px',
          borderTop: '1px solid var(--border, #eee)',
          fontSize: 11,
          opacity: 0.6,
        }}
      >
        YOLO 在每轮对话结束后用大模型语义提取记忆并自动去重；看板每 30 秒自动刷新。
        {state.data?.scopeKey ? ` 作用域 ${state.data.scopeKey}` : ''}
      </div>
    </div>
  )
}

function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
