// YOLO dashboard tab (browser) — the conversation view entry point.
// Full data binding (timeline / tasks / goals / milestones / preferences via
// host projection or yolo_query) lands in the M4b follow-up; this renders the
// dashboard shell.

export function YoloTab(): JSX.Element {
  return (
    <div className="yolo-dashboard" style={{ padding: 16 }}>
      <h2 style={{ margin: '0 0 12px' }}>🎯 YOLO 看板</h2>
      <p style={{ margin: '0 0 12px', opacity: 0.75 }}>
        全局视图：时间线 / 任务 / 目标 / 里程碑 / 偏好。数据绑定将在看板数据通道接入后显示。
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div className="yolo-panel" style={{ border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: 12 }}>
          <strong>时间线</strong>
          <p style={{ fontSize: 12, opacity: 0.6 }}>近期决策与事件</p>
        </div>
        <div className="yolo-panel" style={{ border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: 12 }}>
          <strong>任务</strong>
          <p style={{ fontSize: 12, opacity: 0.6 }}>待办与截止日期</p>
        </div>
        <div className="yolo-panel" style={{ border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: 12 }}>
          <strong>目标</strong>
          <p style={{ fontSize: 12, opacity: 0.6 }}>目标与进度</p>
        </div>
        <div className="yolo-panel" style={{ border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: 12 }}>
          <strong>里程碑</strong>
          <p style={{ fontSize: 12, opacity: 0.6 }}>阶段与截止</p>
        </div>
      </div>
    </div>
  )
}
