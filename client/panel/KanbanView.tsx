// YOLO kanban view (v0.3.0 A/C/E) — the panel's default Tab. Sections follow
// the design doc 4.2 top-to-bottom: filter bar → notification cards → focus
// pills → task rows (inline edit) → goals/milestones (collapsed) → day ledger
// → quick capture. All mutations go through POST /yolo/actions so a click and
// a chat reply produce identical transitions + audit events.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { YoloDashboardData, YoloTodoRow } from '../../src/shared/dashboard.ts'
import {
  applyKanbanFilter,
  focusCounts,
  hasDetailFilter,
  sortForKanban,
  type FocusBucket,
  type KanbanFilter,
  type PresetTab,
} from '../../src/shared/filters.ts'
import { DEFAULT_FILTER } from '../../src/shared/filters.ts'
import type { ChatAnchor } from './ChatPane.tsx'
import { readPanelState, writePanelState } from './state.ts'

export interface KanbanViewProps {
  data: YoloDashboardData
  refresh: () => Promise<void>
  /** Open the side chat anchored to a card (聊一聊). */
  onOpenChat: (anchor: ChatAnchor) => void
}

interface EditorDraft {
  id: string
  title: string
  due: string
  priority: string
  milestoneTitle: string
}

function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function dayOf(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : ''
}

function localDayStr(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function nextDayStr(dueAt: string | null | undefined): string {
  const today = localDayStr(new Date())
  const dueDay = dayOf(dueAt)
  const base = dueDay > today ? dueDay : today
  const d = new Date(`${base}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return localDayStr(d)
}

const LEDGER_KIND_LABEL: Record<string, string> = {
  todo_completed: '完成',
  todo_created: '新增',
  todo_started: '开始',
  todo_cancelled: '取消',
  todo_postponed: '推迟',
  todo_updated: '更新',
  todo_remind_again: '再提醒',
  reminder_fired: '提醒',
  brief_generated: '简报',
  goal_progress: '目标',
  goal_status: '目标',
  milestone_status: '里程碑',
  note: '记录',
  decision: '决策',
  milestone_reached: '里程碑',
}

const PRESETS: { key: PresetTab; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'all', label: '全部' },
  { key: 'done', label: '已完成' },
]

const FOCUS_LABEL: Record<FocusBucket, string> = {
  overdue: '逾期',
  today: '今日',
  week: '未来7天',
  stale: '滞留',
}

const btn: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: 6,
  border: '1px solid var(--border, #ddd)',
  background: 'transparent',
  color: 'inherit',
  fontSize: 11,
  lineHeight: '18px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const pill = (active: boolean): React.CSSProperties => ({
  padding: '2px 10px',
  borderRadius: 999,
  border: `1px solid ${active ? 'var(--accent, #2f6fed)' : 'var(--border, #ddd)'}`,
  background: active ? 'rgba(47,111,237,0.12)' : 'transparent',
  color: active ? 'var(--accent, #2f6fed)' : 'inherit',
  fontSize: 11,
  lineHeight: '18px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
})

const badge: React.CSSProperties = {
  display: 'inline-block',
  padding: '0 6px',
  borderRadius: 999,
  fontSize: 10,
  lineHeight: '16px',
  whiteSpace: 'nowrap',
  background: 'rgba(128,128,128,0.15)',
  color: 'var(--foreground-secondary, #888)',
}

export function KanbanView({ data, refresh, onOpenChat }: KanbanViewProps): JSX.Element {
  const initial = useMemo(() => readPanelState().filter, [])
  const [filter, setFilter] = useState<KanbanFilter>(initial)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorDraft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [quickAdd, setQuickAdd] = useState('')
  const [quickBusy, setQuickBusy] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState<{ kind: 'goal' | 'milestone'; id: string; title: string } | null>(null)

  useEffect(() => { writePanelState({ filter }) }, [filter])

  const act = useCallback(
    async (key: string, body: Record<string, unknown>): Promise<boolean> => {
      setBusyKey(key)
      setActionError(null)
      try {
        const r = await fetch('/yolo/actions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const res = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null
        if (!r.ok || !res?.ok) throw new Error(res?.error ?? `HTTP ${r.status}`)
        await refresh()
        return true
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setBusyKey(null)
      }
    },
    [refresh],
  )

  const counts = useMemo(() => focusCounts(data.todos), [data.todos])
  const visible = useMemo(() => sortForKanban(applyKanbanFilter(data.todos, filter)), [data.todos, filter])
  const milestoneTitles = useMemo(() => data.milestones.map((m) => m.title), [data.milestones])
  const openNotifications = data.notifications.filter((n) => !n.handled)
  const activeGoals = data.goals.filter((g) => g.status === 'active')
  const openMilestones = data.milestones.filter((m) => m.status === 'planned' || m.status === 'active')

  const patchFilter = (patch: Partial<KanbanFilter>): void => {
    setFilter((f) => ({ ...f, ...patch }))
  }

  const saveEditor = async (): Promise<void> => {
    if (!editor) return
    const ok = await act(`edit-${editor.id}`, {
      action: 'update',
      kind: 'todo',
      id: editor.id,
      title: editor.title,
      due_at: editor.due || null,
      priority: editor.priority || null,
      milestone_title: editor.milestoneTitle || '',
    })
    if (ok) setEditor(null)
  }

  const sendQuickAdd = async (): Promise<void> => {
    const text = quickAdd.trim()
    if (!text || quickBusy) return
    setQuickBusy(true)
    const ok = await act('quick-add', { action: 'quick_add', kind: 'todo', title: text })
    if (ok) setQuickAdd('')
    setQuickBusy(false)
  }

  return (
    <div style={{ minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 20px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {actionError && <p style={{ color: '#c0392b', margin: 0 }}>操作失败：{actionError}</p>}

        {/* 1. filter bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', position: 'relative' }}>
          {PRESETS.map((p) => (
            <button key={p.key} type="button" style={pill(filter.preset === p.key)} onClick={() => { patchFilter({ preset: p.key }) }}>
              {p.label}
            </button>
          ))}
          <button
            type="button"
            style={pill(filterMenuOpen || hasDetailFilter(filter))}
            onClick={() => { setFilterMenuOpen((v) => !v) }}
          >
            筛选 ▾
          </button>
          {hasDetailFilter(filter) && (
            <button type="button" style={btn} onClick={() => { setFilter({ ...DEFAULT_FILTER, preset: filter.preset }) }}>
              清除
            </button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.cwd}
          </span>

          {filterMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                zIndex: 20,
                minWidth: 230,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid var(--border, #ddd)',
                background: 'var(--background, #fff)',
                boxShadow: '0 8px 28px rgba(0,0,0,0.12)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                fontSize: 12,
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={filter.inProgressOnly} onChange={(e) => { patchFilter({ inProgressOnly: e.target.checked }) }} />
                仅进行中
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={filter.overdueOnly} onChange={(e) => { patchFilter({ overdueOnly: e.target.checked }) }} />
                仅逾期
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={filter.staleOnly} onChange={(e) => { patchFilter({ staleOnly: e.target.checked }) }} />
                仅滞留
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                里程碑
                <select
                  value={filter.milestoneTitle ?? ''}
                  onChange={(e) => { patchFilter({ milestoneTitle: e.target.value || null }) }}
                  style={{ flex: 1, minWidth: 0, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border, #ddd)', background: 'var(--background, #fff)', color: 'inherit' }}
                >
                  <option value="">全部</option>
                  {milestoneTitles.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                关键词
                <input
                  value={filter.keyword ?? ''}
                  placeholder="标题包含…"
                  onChange={(e) => { patchFilter({ keyword: e.target.value }) }}
                  style={{ flex: 1, minWidth: 0, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border, #ddd)', background: 'var(--background, #fff)', color: 'inherit' }}
                />
              </label>
            </div>
          )}
        </div>

        {/* 2. notification cards */}
        {openNotifications.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {openNotifications.slice(0, 4).map((n) => (
              <div
                key={n.id}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(47,111,237,0.35)',
                  background: 'rgba(47,111,237,0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
                  {n.body && (
                    <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.body.split('\n')[0]}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                  {n.kind === 'reminder' && n.todo_id && (
                    <>
                      <button type="button" style={btn} disabled={busyKey === `n-${n.id}`} onClick={() => { void act(`n-${n.id}`, { action: 'complete', kind: 'todo', id: n.todo_id }) }}>✓ 完成</button>
                      <button type="button" style={btn} disabled={busyKey === `n-${n.id}`} onClick={() => { void act(`n-${n.id}`, { action: 'postpone', kind: 'todo', id: n.todo_id, due_at: nextDayStr(null) }) }}>+1d</button>
                    </>
                  )}
                  <button type="button" style={btn} onClick={() => { onOpenChat({ title: n.title.replace(/^[⏰☀🌙]\s*/, ''), detail: n.body ?? null }) }}>
                    聊一聊
                  </button>
                  <button type="button" style={btn} disabled={busyKey === `n-${n.id}`} onClick={() => { void act(`n-${n.id}`, { action: 'handled', kind: 'notification', id: n.id }) }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 3. focus pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(Object.keys(FOCUS_LABEL) as FocusBucket[]).map((k) => (
            <button
              key={k}
              type="button"
              style={pill(filter.focus === k)}
              onClick={() => { patchFilter({ focus: filter.focus === k ? null : k }) }}
            >
              {FOCUS_LABEL[k]} {counts[k]}
            </button>
          ))}
        </div>

        {/* 4. task rows */}
        <section>
          <SectionTitle label={`任务 · ${visible.length}`} />
          {visible.length === 0 && <p style={{ opacity: 0.55, margin: '4px 0 0', fontSize: 12 }}>当前筛选下没有任务。</p>}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {visible.map((t) =>
              editor?.id === t.id ? (
                <TodoEditor
                  key={t.id}
                  draft={editor}
                  milestones={milestoneTitles}
                  busy={busyKey === `edit-${t.id}`}
                  onChange={setEditor}
                  onSave={() => { void saveEditor() }}
                  onCancel={() => { setEditor(null) }}
                  onDelete={() => { setConfirmDelete(t.id) }}
                />
              ) : (
                <TodoRowView
                  key={t.id}
                  t={t}
                  busy={busyKey === t.id}
                  onAct={(action, extra) => { void act(t.id, { action, kind: 'todo', id: t.id, ...extra }) }}
                  onEdit={() => { setEditor({ id: t.id, title: t.title, due: dayOf(t.due_at), priority: t.priority ?? '', milestoneTitle: t.milestone_title ?? '' }) }}
                  onChat={() => { onOpenChat({ title: t.title, detail: t.due_at ? `到期 ${t.due_at}` : null }) }}
                />
              ),
            )}
          </div>
          {confirmDelete && (
            <div
              style={{
                marginTop: 8,
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid rgba(192,57,43,0.4)',
                background: 'rgba(192,57,43,0.06)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13,
              }}
            >
              <span style={{ flex: 1 }}>确认删除这条待办？（写入审计事件，可追溯）</span>
              <button type="button" style={{ ...btn, borderColor: '#c0392b', color: '#c0392b' }} disabled={busyKey === `del-${confirmDelete}`} onClick={async () => {
                const id = confirmDelete
                setConfirmDelete(null)
                setEditor(null)
                await act(`del-${id}`, { action: 'cancel', kind: 'todo', id })
              }}>
                删除
              </button>
              <button type="button" style={btn} onClick={() => { setConfirmDelete(null) }}>取消</button>
            </div>
          )}
        </section>

        {/* 5. goals & milestones (collapsed) */}
        <section>
          <button
            type="button"
            onClick={() => { setPlanOpen((v) => !v) }}
            style={{ ...btn, fontSize: 12, fontWeight: 600, padding: '4px 10px', marginBottom: 6 }}
          >
            {planOpen ? '▾' : '▸'} 目标与里程碑 · {activeGoals.length + openMilestones.length}
          </button>
          {planOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 4 }}>
              {activeGoals.map((g) => (
                <div key={g.id}>
                  {renameDraft?.kind === 'goal' && renameDraft.id === g.id ? (
                    <RenameInput
                      value={renameDraft.title}
                      busy={busyKey === `goal-${g.id}`}
                      onChange={(v) => { setRenameDraft({ ...renameDraft, title: v }) }}
                      onSave={async () => {
                        const d = renameDraft
                        setRenameDraft(null)
                        if (d.title.trim() && d.title !== g.title) await act(`goal-${g.id}`, { action: 'rename', kind: 'goal', id: g.id, title: d.title.trim() })
                      }}
                      onCancel={() => { setRenameDraft(null) }}
                    />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        title="点击改名"
                        style={{ cursor: 'text', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        onClick={() => { setRenameDraft({ kind: 'goal', id: g.id, title: g.title }) }}
                      >
                        🎯 {g.title}
                        <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 6 }}>{g.progress}%（进度来自对话陈述，不可手改）</span>
                      </span>
                      <button type="button" style={btn} disabled={busyKey === `goal-${g.id}`} onClick={() => { void act(`goal-${g.id}`, { action: 'abandon', kind: 'goal', id: g.id }) }}>放弃</button>
                    </div>
                  )}
                  <div style={{ height: 4, borderRadius: 2, background: 'rgba(128,128,128,0.25)', marginTop: 4 }}>
                    <div style={{ width: `${Math.max(0, Math.min(100, g.progress))}%`, height: '100%', borderRadius: 2, background: 'var(--accent, #2f6fed)' }} />
                  </div>
                </div>
              ))}
              {openMilestones.map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {renameDraft?.kind === 'milestone' && renameDraft.id === m.id ? (
                    <RenameInput
                      value={renameDraft.title}
                      busy={busyKey === `ms-${m.id}`}
                      onChange={(v) => { setRenameDraft({ ...renameDraft, title: v }) }}
                      onSave={async () => {
                        const d = renameDraft
                        setRenameDraft(null)
                        if (d.title.trim() && d.title !== m.title) await act(`ms-${m.id}`, { action: 'rename', kind: 'milestone', id: m.id, title: d.title.trim() })
                      }}
                      onCancel={() => { setRenameDraft(null) }}
                    />
                  ) : (
                    <>
                      <span
                        title="点击改名"
                        style={{ cursor: 'text', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        onClick={() => { setRenameDraft({ kind: 'milestone', id: m.id, title: m.title }) }}
                      >
                        🚩 {m.title}
                        {m.target_date && <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 6 }}>({m.target_date})</span>}
                      </span>
                      <select
                        value={m.status}
                        disabled={busyKey === `ms-${m.id}`}
                        onChange={(e) => { void act(`ms-${m.id}`, { action: 'set_status', kind: 'milestone', id: m.id, status: e.target.value }) }}
                        style={{ padding: '2px 6px', borderRadius: 6, border: '1px solid var(--border, #ddd)', background: 'var(--background, #fff)', color: 'inherit', fontSize: 11 }}
                      >
                        <option value="planned">计划中</option>
                        <option value="active">进行中</option>
                        <option value="done">已完成</option>
                        <option value="abandoned">已放弃</option>
                      </select>
                    </>
                  )}
                </div>
              ))}
              {activeGoals.length === 0 && openMilestones.length === 0 && (
                <p style={{ opacity: 0.55, margin: 0, fontSize: 12 }}>暂无进行中的目标与里程碑。</p>
              )}
            </div>
          )}
        </section>

        {/* 6. day ledger */}
        <section>
          <SectionTitle label={`今日台账 · ${data.ledgerSessions} 会话 · ${data.ledger.length} 件事`} />
          {data.ledger.length === 0 && <p style={{ opacity: 0.55, margin: '4px 0 0', fontSize: 12 }}>今天还没有记录。</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.ledger.map((e) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12 }}>
                <span style={{ opacity: 0.5, flex: 'none', fontSize: 11 }}>{fmtTime(e.occurred_at)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ opacity: 0.55, marginRight: 4 }}>[{LEDGER_KIND_LABEL[e.kind] ?? e.kind}]</span>
                  {e.summary}
                </span>
                {e.label && <span style={{ ...badge, flex: 'none' }}>{e.label}</span>}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 7. quick capture */}
      <div style={{ flex: 'none', display: 'flex', gap: 8, padding: '10px 20px 14px', borderTop: '1px solid var(--border, #eee)' }}>
        <input
          value={quickAdd}
          placeholder="+ 快速记一条…（回车入库，今日到期，不经大模型）"
          onChange={(e) => { setQuickAdd(e.target.value) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void sendQuickAdd()
          }}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--border, #ddd)',
            background: 'var(--background, #fff)',
            color: 'inherit',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          type="button"
          disabled={!quickAdd.trim() || quickBusy}
          onClick={() => { void sendQuickAdd() }}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--accent, #2f6fed)',
            color: '#fff',
            fontSize: 13,
            cursor: !quickAdd.trim() || quickBusy ? 'default' : 'pointer',
            opacity: !quickAdd.trim() || quickBusy ? 0.5 : 1,
          }}
        >
          记下
        </button>
      </div>
    </div>
  )
}

function TodoRowView({ t, busy, onAct, onEdit, onChat }: {
  t: YoloTodoRow
  busy: boolean
  onAct: (action: string, extra?: { due_at?: string }) => void
  onEdit: () => void
  onChat: () => void
}): JSX.Element {
  const open = t.status !== 'done' && t.status !== 'completed' && t.status !== 'cancelled'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 8,
        borderBottom: '1px solid var(--border, rgba(128,128,128,0.12))',
      }}
    >
      <span style={{ opacity: open ? 0.35 : 0.8, flex: 'none', cursor: open ? 'pointer' : 'default', fontSize: 15 }} onClick={() => { if (open) onAct('complete') }}>
        {t.status === 'done' || t.status === 'completed' ? '☑' : '☐'}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textDecoration: open ? 'none' : 'line-through',
          opacity: open ? (t.overdue ? 1 : t.stale ? 0.6 : 1) : 0.55,
          color: open && t.overdue ? '#c0392b' : 'inherit',
        }}
        title={t.title}
      >
        {t.title}
        {t.status === 'in_progress' && <span style={{ ...badge, marginLeft: 6, background: 'rgba(47,111,237,0.15)', color: 'var(--accent, #2f6fed)' }}>进行中</span>}
        {t.due_at && (
          <span style={{ opacity: 0.55, marginLeft: 6, fontSize: 11 }}>
            {dayOf(t.due_at)} 截止{t.overdue ? ' · 逾期' : ''}
          </span>
        )}
        {t.stale && <span style={{ ...badge, marginLeft: 6 }}>滞留</span>}
        {t.priority && t.priority !== 'low' && <span style={{ opacity: 0.5, marginLeft: 4, fontSize: 11 }}>[{t.priority}]</span>}
        {t.milestone_title && <span style={{ opacity: 0.5, marginLeft: 4, fontSize: 11 }}>🚩{t.milestone_title}</span>}
        {t.session_label && <span style={{ ...badge, marginLeft: 6 }}>{t.session_label}</span>}
      </span>
      {open && (
        <span style={{ display: 'flex', gap: 3, flex: 'none' }}>
          <button type="button" style={btn} disabled={busy} title="标记完成" onClick={() => { onAct('complete') }}>✓</button>
          <button type="button" style={btn} disabled={busy} title={`推迟到 ${nextDayStr(t.due_at)}`} onClick={() => { onAct('postpone', { due_at: nextDayStr(t.due_at) }) }}>+1d</button>
          <button type="button" style={btn} disabled={busy} title="编辑" onClick={onEdit}>⋯</button>
          <button type="button" style={btn} disabled={busy} title="聊一聊" onClick={onChat}>💬</button>
        </span>
      )}
    </div>
  )
}

function TodoEditor({ draft, milestones, busy, onChange, onSave, onCancel, onDelete }: {
  draft: EditorDraft
  milestones: readonly string[]
  busy: boolean
  onChange: (d: EditorDraft) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
}): JSX.Element {
  const input: React.CSSProperties = {
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid var(--accent, #2f6fed)',
    background: 'var(--background, #fff)',
    color: 'inherit',
    fontSize: 12,
    outline: 'none',
    minWidth: 0,
  }
  return (
    <div style={{ padding: '8px', borderRadius: 8, background: 'rgba(47,111,237,0.05)', border: '1px solid rgba(47,111,237,0.25)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          autoFocus
          value={draft.title}
          onChange={(e) => { onChange({ ...draft, title: e.target.value }) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSave()
            if (e.key === 'Escape') onCancel()
          }}
          style={{ ...input, flex: 2, flexBasis: 200 }}
        />
        <input type="date" value={draft.due} onChange={(e) => { onChange({ ...draft, due: e.target.value }) }} style={input} />
        <select value={draft.priority} onChange={(e) => { onChange({ ...draft, priority: e.target.value }) }} style={input}>
          <option value="">优先级</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="urgent">urgent</option>
        </select>
        <select value={draft.milestoneTitle} onChange={(e) => { onChange({ ...draft, milestoneTitle: e.target.value }) }} style={{ ...input, flex: 1, flexBasis: 120 }}>
          <option value="">无里程碑</option>
          {milestones.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" style={{ ...btn, borderColor: 'var(--accent, #2f6fed)', color: 'var(--accent, #2f6fed)' }} disabled={busy} onClick={onSave}>保存</button>
        <button type="button" style={btn} disabled={busy} onClick={onCancel}>取消</button>
        <span style={{ flex: 1 }} />
        <button type="button" style={{ ...btn, borderColor: '#c0392b', color: '#c0392b' }} disabled={busy} onClick={onDelete}>删除…</button>
      </div>
    </div>
  )
}

function RenameInput({ value, busy, onChange, onSave, onCancel }: {
  value: string
  busy: boolean
  onChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <span style={{ display: 'flex', gap: 6, flex: 1, minWidth: 0 }}>
      <input
        autoFocus
        value={value}
        onChange={(e) => { onChange(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSave()
          if (e.key === 'Escape') onCancel()
        }}
        style={{ flex: 1, minWidth: 0, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--accent, #2f6fed)', background: 'var(--background, #fff)', color: 'inherit', fontSize: 12, outline: 'none' }}
      />
      <button type="button" style={btn} disabled={busy} onClick={onSave}>保存</button>
      <button type="button" style={btn} disabled={busy} onClick={onCancel}>取消</button>
    </span>
  )
}

function SectionTitle({ label }: { label: string }): JSX.Element {
  return <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12, opacity: 0.8 }}>{label}</div>
}
