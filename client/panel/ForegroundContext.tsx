import type { YoloItemSource } from '../../src/shared/dashboard.ts'
import type { ItemDetailForeground, PanelForeground, PanelItemRef } from './navigation.ts'

export type SourcePreviewForeground = Extract<PanelForeground, { kind: 'source_preview' }>
export type SupportedForeground = ItemDetailForeground | SourcePreviewForeground

export type SessionNavigationState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'error'; message: string }

export interface SourcePreviewModel {
  typeLabel: string
  workspaceLabel: string
  workspaceCwd?: string
  sessionId?: string
  excerpt?: string
  turn?: number
  createdAt?: number
  canOpenSession: boolean
  degradation?: string
}

export interface ItemDetailModel {
  title: string
  workspaceCwd: string
  hasSource: boolean
}

export interface SourceSessionActionModel {
  visible: boolean
  disabled: boolean
  label: '打开原会话' | '正在打开原会话…' | '重试打开原会话'
}

const SOURCE_EXCERPT_LIMIT = 400

function boundedExcerpt(value: string | null | undefined): string | undefined {
  const text = value?.replace(/\s+/gu, ' ').trim() ?? ''
  return text ? Array.from(text).slice(0, SOURCE_EXCERPT_LIMIT).join('') : undefined
}

/** Convert provenance into an honest display model. A session id alone does
 * not make manual/tool/legacy rows jumpable, and absent timestamps stay absent. */
export function buildSourcePreviewModel(item: PanelItemRef, source: YoloItemSource): SourcePreviewModel {
  const workspaceLabel = source.workspace?.label || item.scopeCwd
  const common = {
    workspaceLabel,
    ...(source.workspace?.cwd ? { workspaceCwd: source.workspace.cwd } : {}),
  }
  if (source.type === 'session') {
    const sessionId = source.session_id?.trim() || undefined
    const excerpt = boundedExcerpt(source.excerpt)
    return {
      ...common,
      typeLabel: '来源会话',
      ...(sessionId ? { sessionId } : {}),
      ...(excerpt ? { excerpt } : {}),
      ...(typeof source.turn === 'number' && Number.isInteger(source.turn) ? { turn: source.turn } : {}),
      ...(typeof source.created_at === 'number' && Number.isFinite(source.created_at) ? { createdAt: source.created_at } : {}),
      canOpenSession: sessionId !== undefined,
      ...(!excerpt ? { degradation: '此事项创建时未保存来源摘录。' } : {}),
    }
  }
  if (source.type === 'manual') {
    return { ...common, typeLabel: '手动记录', canOpenSession: false, degradation: '这项安排由你直接记录，没有关联会话。' }
  }
  if (source.type === 'tool') {
    return { ...common, typeLabel: '助手操作', canOpenSession: false, degradation: '这项安排由助手操作创建，没有可打开的来源会话。' }
  }
  return { ...common, typeLabel: '早期记录', canOpenSession: false, degradation: '早期记录未保存可定位的来源信息。' }
}

export function buildItemDetailModel(
  foreground: ItemDetailForeground,
  source: YoloItemSource | undefined,
): ItemDetailModel {
  return {
    title: foreground.item.title,
    workspaceCwd: foreground.item.scopeCwd,
    hasSource: source !== undefined,
  }
}

export function buildSourceSessionAction(
  source: SourcePreviewModel,
  navigation: SessionNavigationState,
): SourceSessionActionModel {
  return {
    visible: source.canOpenSession && source.sessionId !== undefined,
    disabled: navigation.status === 'pending',
    label: navigation.status === 'pending'
      ? '正在打开原会话…'
      : navigation.status === 'error'
        ? '重试打开原会话'
        : '打开原会话',
  }
}

export interface ForegroundContextProps {
  foreground: SupportedForeground
  /** Resolved source for item_detail; source_preview carries its own immutable source. */
  itemSource?: YoloItemSource
  sessionNavigation?: SessionNavigationState
  onBack: () => void
  onClose: () => void
  onDiscuss: (item: PanelItemRef) => void
  onOpenSource: (item: PanelItemRef, source: YoloItemSource) => void
  /** The owner catches navigation failures and feeds them back through sessionNavigation. */
  onOpenSession: (sessionId: string) => void
}

const paneStyle = {
  height: '100%',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--y-surface)',
  color: 'var(--y-text-1)',
} as const

const headerStyle = {
  minHeight: 54,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 16px',
  borderBottom: '1px solid var(--y-line)',
} as const

const bodyStyle = { flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 18px' } as const
const subtleStyle = { color: 'var(--y-text-3)', fontSize: 12, lineHeight: 1.55 } as const
const buttonStyle = {
  minHeight: 34,
  padding: '0 11px',
  border: '1px solid var(--y-line-strong)',
  borderRadius: 'var(--y-r-sm)',
  background: 'var(--y-surface-2)',
  color: 'var(--y-text-1)',
  cursor: 'pointer',
} as const

function PaneHeader({ title, onBack, onClose }: { title: string; onBack: () => void; onClose: () => void }): JSX.Element {
  return (
    <header style={headerStyle}>
      <button type="button" style={buttonStyle} onClick={onBack} aria-label="返回上一层">← 返回</button>
      <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</strong>
      <button type="button" style={buttonStyle} onClick={onClose} aria-label="关闭上下文">关闭</button>
    </header>
  )
}

function SourcePreview({
  foreground,
  navigation,
  onBack,
  onClose,
  onDiscuss,
  onOpenSession,
}: {
  foreground: SourcePreviewForeground
  navigation: SessionNavigationState
  onBack: () => void
  onClose: () => void
  onDiscuss: (item: PanelItemRef) => void
  onOpenSession: (sessionId: string) => void
}): JSX.Element {
  const model = buildSourcePreviewModel(foreground.item, foreground.source)
  const action = buildSourceSessionAction(model, navigation)
  return (
    <section style={paneStyle} aria-label={`来源：${foreground.item.title}`}>
      <PaneHeader title="来源" onBack={onBack} onClose={onClose} />
      <div style={bodyStyle}>
        <p style={{ ...subtleStyle, margin: 0 }}>{model.typeLabel}</p>
        <h2 style={{ margin: '5px 0 18px', fontSize: 20, lineHeight: 1.35 }}>{foreground.item.title}</h2>

        <dl style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', gap: '9px 12px', margin: 0 }}>
          <dt style={subtleStyle}>工作区</dt>
          <dd style={{ margin: 0, overflowWrap: 'anywhere' }} title={model.workspaceCwd}>{model.workspaceLabel}</dd>
          {model.sessionId ? <><dt style={subtleStyle}>会话 ID</dt><dd style={{ margin: 0, fontFamily: 'var(--y-font-mono)', fontSize: 12, overflowWrap: 'anywhere' }}>{model.sessionId}</dd></> : null}
          {model.createdAt !== undefined ? <><dt style={subtleStyle}>记录时间</dt><dd style={{ margin: 0 }}>{new Date(model.createdAt).toLocaleString()}</dd></> : null}
          {model.turn !== undefined ? <><dt style={subtleStyle}>会话轮次</dt><dd style={{ margin: 0 }}>{model.turn} <span style={subtleStyle}>（定位元数据）</span></dd></> : null}
        </dl>

        {model.excerpt ? (
          <div style={{ marginTop: 22 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>来源摘录</h3>
            <blockquote style={{ margin: 0, padding: '12px 14px', borderLeft: '2px solid var(--y-focus)', background: 'var(--y-surface-2)', lineHeight: 1.65, overflowWrap: 'anywhere' }}>
              {model.excerpt}
            </blockquote>
          </div>
        ) : null}
        {model.degradation ? <p style={{ ...subtleStyle, marginTop: 18 }}>{model.degradation}</p> : null}

        {navigation.status === 'error' ? (
          <div role="alert" style={{ marginTop: 16, padding: '10px 12px', border: '1px solid var(--y-danger, #b84a4a)', borderRadius: 'var(--y-r-sm)', lineHeight: 1.5 }}>
            打开原会话失败：{navigation.message}
          </div>
        ) : null}
      </div>
      <footer style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--y-line)' }}>
        {action.visible && model.sessionId ? (
          <button type="button" style={{ ...buttonStyle, fontWeight: 700 }} disabled={action.disabled} aria-busy={action.disabled} onClick={() => { onOpenSession(model.sessionId!) }}>
            {action.label}
          </button>
        ) : null}
        <button type="button" style={buttonStyle} onClick={() => { onDiscuss(foreground.item) }}>讨论这项安排</button>
      </footer>
    </section>
  )
}

function ItemDetail({
  foreground,
  source,
  onBack,
  onClose,
  onDiscuss,
  onOpenSource,
}: {
  foreground: ItemDetailForeground
  source?: YoloItemSource
  onBack: () => void
  onClose: () => void
  onDiscuss: (item: PanelItemRef) => void
  onOpenSource: (item: PanelItemRef, source: YoloItemSource) => void
}): JSX.Element {
  const model = buildItemDetailModel(foreground, source)
  return (
    <section style={paneStyle} aria-label={`事项详情：${model.title}`}>
      <PaneHeader title="事项详情" onBack={onBack} onClose={onClose} />
      <div style={bodyStyle}>
        <p style={{ ...subtleStyle, margin: 0 }}>当前安排</p>
        <h2 style={{ margin: '5px 0 20px', fontSize: 20, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{model.title}</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', gap: '9px 12px', margin: 0 }}>
          <dt style={subtleStyle}>工作区</dt>
          <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{model.workspaceCwd}</dd>
        </dl>
        {source ? (
          <button type="button" style={{ ...buttonStyle, width: '100%', marginTop: 22, textAlign: 'left' }} onClick={() => { onOpenSource(foreground.item, source) }}>
            查看来源 · {source.label}
          </button>
        ) : (
          <p style={{ ...subtleStyle, marginTop: 22 }}>当前数据没有可展示的来源信息。</p>
        )}
      </div>
      <footer style={{ padding: '12px 16px', borderTop: '1px solid var(--y-line)' }}>
        <button type="button" style={{ ...buttonStyle, fontWeight: 700 }} onClick={() => { onDiscuss(foreground.item) }}>讨论这项安排</button>
      </footer>
    </section>
  )
}

/** One foreground slot: callers replace its value instead of stacking drawers. */
export function ForegroundContext(props: ForegroundContextProps): JSX.Element {
  if (props.foreground.kind === 'source_preview') {
    return (
      <SourcePreview
        foreground={props.foreground}
        navigation={props.sessionNavigation ?? { status: 'idle' }}
        onBack={props.onBack}
        onClose={props.onClose}
        onDiscuss={props.onDiscuss}
        onOpenSession={props.onOpenSession}
      />
    )
  }
  return (
    <ItemDetail
      foreground={props.foreground}
      source={props.itemSource}
      onBack={props.onBack}
      onClose={props.onClose}
      onDiscuss={props.onDiscuss}
      onOpenSource={props.onOpenSource}
    />
  )
}
