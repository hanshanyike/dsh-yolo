// YOLO session-header action (browser, M4b): a compact chip beside the session
// title. Clicking it refreshes the dashboard by emitting '/yolo' into the
// composer state (no host RPC channel exists in rc.8 for plugin button actions,
// so it surfaces the refresh affordance textually).

interface HeaderButtonProps {
  sessionId?: string
  /** Optional injected store to show the last snapshot time. */
  lastAt?: number
}

export function HeaderButton(_props: HeaderButtonProps): JSX.Element {
  return (
    <span
      title="YOLO 看板数据 — 发送 /yolo 刷新，或切换到对话顶部的 YOLO 标签页查看"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        border: '1px solid var(--border, #ddd)',
        color: 'var(--foreground-secondary, #666)',
        background: 'var(--background-secondary, transparent)',
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      🎯 YOLO
    </span>
  )
}
