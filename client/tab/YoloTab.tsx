// YOLO dashboard tab (browser, M4b): renders the global view from the 'yolo'
// target snapshot — timeline, tasks, goals, milestones, preferences.

import type { YoloSnapshot } from '../../src/shared/dashboard.ts'
import { EMPTY_YOLO_SNAPSHOT } from '../tab/ViewBuilder.ts'

interface YoloTabProps {
  sessionId?: string
  /** Standard conversation snapshot hook supplied by the view ring renderer. */
  useSession?: <T>(selector: (snapshot: { views?: { get(target: string): YoloSnapshot | undefined } }) => T) => T
}

function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function YoloTab({ useSession }: YoloTabProps): JSX.Element {
  const snap = useSession
    ? useSession((s) => s.views?.get('yolo') ?? EMPTY_YOLO_SNAPSHOT)
    : EMPTY_YOLO_SNAPSHOT

  const openTodos = snap.todos.filter((t) => t.status !== 'done' && t.status !== 'completed')
  const dueTodos = openTodos.filter((t) => t.due_at).sort((a, b) => (a.due_at! < b.due_at! ? -1 : 1))
  const openGoals = snap.goals.filter((g) => g.status === 'active')
  const openMilestones = snap.milestones.filter((m) => m.status !== 'achieved' && m.status !== 'done')

  return (
    <div className="yolo-dashboard" style={{ padding: 16, fontFamily: 'var(--font, sans-serif)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>🎯 YOLO 看板</h2>
        {snap.at > 0 && (
          <span style={{ fontSize: 12, opacity: 0.55 }}>
            更新于 {fmtTime(snap.at)} · 作用域 {snap.scopeKey || '—'}
          </span>
        )}
      </div>

      {snap.at === 0 ? (
        <p style={{ opacity: 0.65, fontSize: 13 }}>
          暂无数据。完成一轮对话（或发送 <code>/yolo</code>）后，这里会展示从会话中提取的
          时间线 / 任务 / 目标 / 里程碑 / 偏好。
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {/* tasks */}
          <section className="yolo-panel" style={{ border: '1px solid var(--border, #ddd)', borderRadius: 10, padding: 12 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>📋 任务 ({openTodos.length})</h3>
            {dueTodos.length === 0 && openTodos.length === 0 && <p style={{ fontSize: 12, opacity: 0.6 }}>暂无待办</p>}
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
              {dueTodos.slice(0, 8).map((t) => (
                <li key={t.id}>
                  {t.title}{' '}
                  <span style={{ opacity: 0.6 }}>[截止 {t.due_at}]</span>
                  {t.priority && t.priority !== 'normal' && (
                    <span style={{ opacity: 0.7, color: '#c0392b' }}> [{t.priority}]</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* goals */}
          <section className="yolo-panel" style={{ border: '1px solid var(--border, #ddd)', borderRadius: 10, padding: 12 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>🎯 目标 ({openGoals.length})</h3>
            {openGoals.length === 0 && <p style={{ fontSize: 12, opacity: 0.6 }}>暂无进行中目标</p>}
            {openGoals.slice(0, 6).map((g) => (
              <div key={g.id} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>{g.title}</span>
                  <span style={{ opacity: 0.65 }}>{g.progress}%</span>
                </div>
                <div style={{ background: 'var(--border, #ddd)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.max(0, g.progress))}%`,
                      background: 'var(--accent, #2f6fed)',
                      borderRadius: 4,
                    }}
                  />
                </div>
              </div>
            ))}
          </section>

          {/* milestones */}
          <section className="yolo-panel" style={{ border: '1px solid var(--border, #ddd)', borderRadius: 10, padding: 12 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>🚩 里程碑 ({openMilestones.length})</h3>
            {openMilestones.length === 0 && <p style={{ fontSize: 12, opacity: 0.6 }}>暂无里程碑</p>}
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
              {openMilestones.slice(0, 6).map((m) => (
                <li key={m.id}>
                  {m.title}
                  {m.target_date && <span style={{ opacity: 0.6 }}> · {m.target_date}</span>}
                </li>
              ))}
            </ul>
          </section>

          {/* preferences */}
          <section className="yolo-panel" style={{ border: '1px solid var(--border, #ddd)', borderRadius: 10, padding: 12 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>💡 偏好 ({snap.preferences.length})</h3>
            {snap.preferences.length === 0 && <p style={{ fontSize: 12, opacity: 0.6 }}>暂无偏好</p>}
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
              {snap.preferences.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <strong>{p.key}</strong>: {p.value}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {/* timeline */}
      {snap.events.length > 0 && (
        <section style={{ marginTop: 14, border: '1px solid var(--border, #ddd)', borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>🕒 时间线</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
            {snap.events.slice(0, 12).map((e) => (
              <li key={e.id}>
                <span style={{ opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>{fmtTime(e.occurred_at)}</span>{' '}
                <span style={{ opacity: 0.65 }}>[{e.kind}]</span> {e.summary}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p style={{ marginTop: 12, fontSize: 12, opacity: 0.55 }}>
        YOLO 从每个会话自动提取重点信息，回合结束自动刷新本看板；发送 <code>/yolo</code> 可立即刷新。
      </p>
    </div>
  )
}
