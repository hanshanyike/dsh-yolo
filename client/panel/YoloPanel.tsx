// YOLO panel shell — Mono design system v2.1 (frontend-redesign.md ch.4).
// The panel is always the kanban; the chat is one surface in two sizes: a
// 340px side pane that expands full-screen and back (⤢/⤡). Esc unwinds
// fullscreen → side chat → closed. Narrow panels (<480px) open the chat
// full-screen directly instead of side-by-side. Filter + side-chat visibility
// persist across close/reopen via panel/state.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { YoloDashboardData } from '../../src/shared/dashboard.ts'
import { ensureYoloStyle, detectYoloTheme } from '../design/style.ts'
import { yoloTokens } from '../design/tokens.ts'
import { IcChat, IcClose, IcExpand, IcRefresh, IcShrink } from '../design/icons.tsx'
import { YoloLogo } from '../YoloLogo.tsx'
import { ChatPane, type ChatAnchor } from './ChatPane.tsx'
import { KanbanView } from './KanbanView.tsx'
import { readPanelState, writePanelState, type WorkspaceScope } from './state.ts'

export interface YoloPanelProps {
  /** Panel left edge (the sidebar's right edge) — spans to the viewport right. */
  left: number
  onClose: () => void
  /** Jump to a dsh session (ledger source badges); no-op when unavailable. */
  openSession?: (sessionId: string) => void
}

interface LoadState {
  loading: boolean
  error: string | null
  data: YoloDashboardData | null
}

const POLL_MS = 30_000

/** Data signature — the sweep line runs only when this actually changes (6.2). */
function dataSig(d: YoloDashboardData): string {
  return [
    d.at,
    d.todos.length,
    d.ledger.length,
    d.notifications.filter((n) => !n.handled).length,
    d.goals.map((g) => `${g.id}:${g.progress}:${g.status}`).join(','),
    d.milestones.map((m) => `${m.id}:${m.status}`).join(','),
  ].join('|')
}

export function YoloPanel({ left, onClose, openSession }: YoloPanelProps): JSX.Element {
  ensureYoloStyle()
  const theme = useMemo(() => detectYoloTheme(), [])

  const [state, setState] = useState<LoadState>({ loading: true, error: null, data: null })
  const initial = readPanelState()
  const [sideChatOpen, setSideChatOpen] = useState(initial.sideChatOpen)
  const [chatFullscreen, setChatFullscreen] = useState(false)
  const [anchor, setAnchor] = useState<ChatAnchor | null>(null)
  const [workspaceScope, setWorkspaceScope] = useState<WorkspaceScope>(initial.workspaceScope)
  const [sweepTick, setSweepTick] = useState(0)
  const lastSig = useRef<string | null>(null)

  // Panel width → Compact gear (<480px: chat opens full-screen, toolbar wraps).
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1000 : Math.max(0, window.innerWidth - left)))
  useEffect(() => {
    const on = (): void => { setWidth(Math.max(0, window.innerWidth - left)) }
    window.addEventListener('resize', on)
    return () => { window.removeEventListener('resize', on) }
  }, [left])
  const compact = width < yoloTokens.compactBreakpoint

  const load = useCallback(async (): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const r = await fetch(`/yolo/dashboard?scope=${workspaceScope}`, { headers: { accept: 'application/json' }, cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as YoloDashboardData
      const sig = dataSig(data)
      if (lastSig.current !== null && sig !== lastSig.current) setSweepTick((t) => t + 1)
      lastSig.current = sig
      setState({ loading: false, error: null, data })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }))
    }
  }, [workspaceScope])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [load])

  // Persist view state so reopening keeps the side chat (TA-6).
  useEffect(() => { writePanelState({ sideChatOpen }) }, [sideChatOpen])
  useEffect(() => { writePanelState({ workspaceScope }) }, [workspaceScope])

  // Esc unwinds the chat surface: fullscreen → side chat → closed panel.
  const closeSideChat = useCallback(() => {
    setSideChatOpen(false)
    setChatFullscreen(false)
    setAnchor(null)
  }, [])
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (chatFullscreen) setChatFullscreen(false)
      else if (sideChatOpen) closeSideChat()
      else onClose()
    }
    document.addEventListener('keydown', listener)
    return () => { document.removeEventListener('keydown', listener) }
  }, [chatFullscreen, sideChatOpen, closeSideChat, onClose])

  const openAnchoredChat = useCallback((a: ChatAnchor) => {
    setAnchor(a)
    setSideChatOpen(true)
  }, [])

  const toggleSideChat = useCallback(() => {
    setAnchor(null)
    setSideChatOpen((v) => !v)
  }, [])

  // One chat surface, two sizes; on compact panels the side pane IS fullscreen.
  const chatShowingFull = chatFullscreen || (sideChatOpen && compact)
  const showSideDock = sideChatOpen && !chatFullscreen && !compact

  const d = new Date()
  const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日 · 周${'日一二三四五六'[d.getDay()]}`

  return (
    <div
      className={`yolo-scope panel${compact ? ' compact' : ''}`}
      data-y-theme={theme}
      style={{ position: 'fixed', left, right: 0, top: 0, bottom: 0, zIndex: 10000 }}
    >
      {/* ① header 48px */}
      <header className="p-head">
        <div className="brand">
          <YoloLogo size={18} />
          <span className="brand-name">YOLO</span>
          <span className="p-date mono">{dateLabel}</span>
        </div>
        <div className="p-head-acts">
          <div className="wsswitch" role="group" aria-label="工作区范围">
            <button type="button" className={`wsbtn${workspaceScope === 'current' ? ' on' : ''}`} onClick={() => setWorkspaceScope('current')} title="只看当前工作区">当前</button>
            <button type="button" className={`wsbtn${workspaceScope === 'all' ? ' on' : ''}`} onClick={() => setWorkspaceScope('all')} title="汇总所有工作区（需在设置开启）">全部</button>
          </div>
          {!chatShowingFull && (
            <button type="button" className={`ctoggle${sideChatOpen ? ' on' : ''}`} onClick={toggleSideChat} title={sideChatOpen ? '收起侧栏对话 (Esc)' : '展开侧栏对话'}>
              <span className="tico"><IcChat size={13} /></span>对话
            </button>
          )}
          {chatShowingFull && (
            <button type="button" className="ctoggle" onClick={() => { setChatFullscreen(false) }} title="收起为侧栏 (Esc)">
              <span className="tico"><IcShrink size={13} /></span>侧栏
            </button>
          )}
          <button type="button" className={`hbtn${state.loading ? ' spin' : ''}`} onClick={() => { void load() }} title="立即刷新" aria-label="立即刷新">
            <IcRefresh size={15} />
          </button>
          <button type="button" className="hbtn" onClick={onClose} title="关闭 (Esc)" aria-label="关闭面板">
            <IcClose size={15} />
          </button>
        </div>
      </header>

      {/* body: full-screen chat takes over the panel; the board stays mounted
          (display:none) so its filter state survives the round-trip (4.2⑨). */}
      {chatShowingFull ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ChatPane variant="full" anchor={anchor} />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {state.error && state.data === null && (
              <div className="err-line">
                <span>看板加载失败：{state.error}</span>
                <button type="button" className="nact" onClick={() => { void load() }}>重试</button>
              </div>
            )}
            {state.data !== null && (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', ...(state.error ? { opacity: 0.6 } : {}) }}>
                <KanbanView data={state.data} refresh={load} onOpenChat={openAnchoredChat} openSession={openSession} sweepTick={sweepTick} />
              </div>
            )}
            {state.data === null && !state.error && (
              <div className="p-main" aria-hidden="true">
                <div className="skel-notif" />
                <div className="skel-head" />
                <div className="skel-row" /><div className="skel-row" /><div className="skel-row" />
                <div className="skel-head" />
                <div className="skel-row" /><div className="skel-row" />
              </div>
            )}
          </div>

          {showSideDock && (
            <aside className="dock">
              <div className="dock-head">
                <span className="dock-tag">锚定</span>
                <span className="dock-ctx" title={anchor?.title ?? '看板全局'}>{anchor?.title ?? '看板全局'}</span>
                <button type="button" className="dact" onClick={() => { setChatFullscreen(true) }} title="展开为全屏">
                  <span className="tico"><IcExpand size={11} /></span>全屏
                </button>
                <button type="button" className="hbtn" onClick={closeSideChat} title="收起 (Esc)" aria-label="收起侧栏对话">
                  <IcClose size={14} />
                </button>
              </div>
              <ChatPane variant="side" anchor={anchor} />
            </aside>
          )}
        </div>
      )}

      {/* ⑦ footer 28px */}
      <footer className="p-foot mono">
        看板每 30 秒自动刷新{state.data?.scope === 'all' ? ` · ${state.data.workspaceCount ?? 0} 个工作区` : state.data?.scopeKey ? ` · 作用域 ${state.data.scopeKey}` : ''}{state.data?.health ? ` · 记忆健康 召回${state.data.health.recallRunsToday}/${state.data.health.recallErrorsToday}错 重复${state.data.health.duplicateTodos.length}个` : ''}
      </footer>
    </div>
  )
}





