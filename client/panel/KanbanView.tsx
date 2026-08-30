// Assistant board content for Home / Plan / History. The shell owns product
// navigation and the single foreground context; this component renders one
// active page section inside an independently scrolling body. Filtering stays in shared
// pure functions (src/shared/filters.ts); every mutation goes through
// POST /yolo/actions so a click and a chat reply produce identical transitions
// + audit events.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { YoloDashboardData, YoloItemSource, YoloMilestoneRow, YoloTodoRow } from '../../src/contracts/dashboard.ts'
import type { YoloHistoryEvent } from '../../src/contracts/history.ts'
import { isTodoOpen } from '../../src/shared/dashboard.ts'
import { buildDashboardSurfaces } from '../../src/shared/dashboard-surfaces.ts'
import {
  applyKanbanFilter,
  focusCounts,
  sortForKanban,
  type FocusBucket,
  type KanbanFilter,
} from '../../src/shared/filters.ts'
import { localDateStr } from '../../src/shared/text.ts'
import { IcChat, IcCheck, IcDots, IcFlag, IcPin, IcPlusDay } from '../design/icons.tsx'
import type { ChatAnchor } from './ChatPane.tsx'
import { CaptureBar } from './CaptureBar.tsx'
import { HistoryView } from './HistoryView.tsx'
import {
  TaskActionPanel,
  TodaySurface,
} from './v2/index.ts'
import { formatDueLabel } from './due-label.ts'
import { useKanbanActions } from './kanban/use-kanban-actions.ts'
import type { BoardSurfaceKey } from './kanban/surfaces.ts'

export type { BoardSurfaceKey } from './kanban/surfaces.ts'

export interface KanbanViewProps {
  data: YoloDashboardData
  refresh: () => Promise<void>
  /** The persisted kanban filter (owned by the shell). */
  filter: KanbanFilter
  patchFilter: (patch: Partial<KanbanFilter>) => void
  /** Active product page section. */
  surface: BoardSurfaceKey
  /** Switch product page section (e.g. quick-add lands on Home). */
  onSurfaceChange: (surface: BoardSurfaceKey) => void
  /** Open the side chat anchored to a card (聊一聊). */
  onOpenChat: (anchor: ChatAnchor) => void
  /** Open a source preview in the shell's single foreground context. */
  onOpenSource?: (todo: YoloTodoRow, source: NonNullable<YoloTodoRow['source']>) => void
  onOpenChangeSource?: (change: YoloHistoryEvent, source: YoloItemSource) => void
  onOpenItemDetail?: (todo: YoloTodoRow) => void
}

interface EditorDraft {
  id: string
  scopeCwd?: string
  title: string
  due: string
  priority: string
  milestoneTitle: string
}

const DAY_MS = 86_400_000

const FOCUS_LABEL: Record<FocusBucket, string> = {
  overdue: '逾期',
  today: '今日',
  week: '未来7天',
  stale: '滞留',
}

function dayOf(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : ''
}

function nextDayStr(dueAt: string | null | undefined): string {
  const today = localDateStr()
  const dueDay = dayOf(dueAt)
  const date = new Date(`${dueDay > today ? dueDay : today}T00:00:00`)
  date.setDate(date.getDate() + 1)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Due text: 今天/明天/昨天 · 周X M/D within a week · M/D beyond (5.2). */
const fmtDue = formatDueLabel

/** Done-slot text「完成 HH:MM」for completed rows (5.4). */
function fmtDone(epochMs: number): string {
  const d = new Date(epochMs)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `完成 ${hh}:${mm}`
}

/** Days since the last touch, for the stale meta signal (4.4). */
function untouchedDays(t: YoloTodoRow): number {
  if (!t.updated_at) return 0
  return Math.floor((Date.now() - t.updated_at) / DAY_MS)
}

/** Position (0..100) of a milestone dot on its track, by target date. */
function dotPos(target: string | null | undefined): number {
  if (!target) return 50
  const today = localDateStr()
  const diff = (new Date(`${target.slice(0, 10)}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / DAY_MS
  return Math.max(4, Math.min(96, 50 + (diff / 90) * 46))
}

export function KanbanView({ data, refresh, filter, patchFilter, surface, onSurfaceChange, onOpenChat, onOpenSource, onOpenChangeSource, onOpenItemDetail }: KanbanViewProps): JSX.Element {
  const [editor, setEditor] = useState<EditorDraft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState<{ kind: 'goal' | 'milestone'; id: string; title: string } | null>(null)
  const [msPop, setMsPop] = useState<{ id: string; x: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const actions = useKanbanActions({
    data, refresh, filter, patchFilter, onSurfaceChange, onOpenChat, onOpenSource, onOpenItemDetail,
  })
  const {
    actionError, setActionError, busyKey, completing, toast, setToast,
    quickBusy, taskPanel, taskDraft, setTaskDraft, taskReceipt, taskUndo,
    judgmentExpanded, act, completeTodo, undoComplete, sendQuickAdd,
    closeTaskPanel, handleTodayIntent, handleTaskAction, saveTaskPanel, undoTaskReceipt,
  } = actions

  // Toast auto-retire (5.1): 2.4s; completion toasts hold the 4s undo window (5.4).
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => { setToast(null) }, toast.undo ? 4_000 : 2_400)
    return () => { window.clearTimeout(t) }
  }, [toast])

  // Each face scrolls independently: switching tabs starts at the top.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [surface])


  const counts = useMemo(() => focusCounts(data.todos), [data.todos])
  const surfaces = useMemo(() => buildDashboardSurfaces(data), [data])
  const milestoneTitles = useMemo(() => data.milestones.map((m) => m.title), [data.milestones])

  // Per-face filtered sets — the shared filter functions stay the source of
  // truth: the face only picks the preset the tab maps to.
  const visiblePlanToday = useMemo(
    () => sortForKanban(applyKanbanFilter(surfaces.plan.today, { ...filter, preset: 'all' })),
    [filter, surfaces.plan.today],
  )
  const visiblePlanUpcoming = useMemo(
    () => sortForKanban(applyKanbanFilter(surfaces.plan.upcoming, { ...filter, preset: 'all' })),
    [filter, surfaces.plan.upcoming],
  )
  const visiblePlanAll = useMemo(
    () => sortForKanban(applyKanbanFilter(surfaces.plan.all, { ...filter, preset: 'all' })),
    [filter, surfaces.plan.all],
  )

  const activeGoals = data.goals.filter((g) => g.status === 'active')
  const openMilestones = data.milestones.filter((m) => m.status === 'planned' || m.status === 'active')
  const avgGoalPct = Math.round(activeGoals.reduce((a, g) => a + g.progress, 0) / Math.max(activeGoals.length, 1))

  const patch = useCallback((p: Partial<KanbanFilter>) => { patchFilter(p) }, [patchFilter])

  const saveEditor = async (): Promise<void> => {
    if (!editor) return
    const ok = await act(`edit-${editor.id}`, {
      action: 'update',
      kind: 'todo',
      id: editor.id,
      scope_cwd: editor.scopeCwd,
      title: editor.title,
      due_at: editor.due || null,
      priority: editor.priority || null,
      milestone_title: editor.milestoneTitle || '',
    })
    if (ok) setEditor(null)
  }

  const rowActions = (t: YoloTodoRow): { onComplete: () => void; onAct: (action: string, extra?: { due_at?: string }) => void; onEdit: () => void; onChat: () => void; onSource?: () => void } => ({
    onComplete: () => { void completeTodo(t) },
    onAct: (action, extra) => { void act(t.id, { action, kind: 'todo', id: t.id, scope_cwd: t.scope_cwd ?? t.ws?.cwd, ...extra }) },
    onEdit: () => { setEditor({ id: t.id, scopeCwd: t.scope_cwd ?? t.ws?.cwd, title: t.title, due: dayOf(t.due_at), priority: t.priority ?? '', milestoneTitle: t.milestone_title ?? '' }) },
    onChat: () => {
      onOpenChat({
        title: t.title,
        detail: t.due_at ? `到期 ${t.due_at}` : null,
        todoId: t.id,
        scopeCwd: t.scope_cwd ?? t.ws?.cwd,
        source: t.source ? {
          type: t.source.type,
          label: t.source.label,
          sessionId: t.source.session_id,
          excerpt: t.source.excerpt,
        } : undefined,
      })
    },
    onSource: t.source ? () => { onOpenSource?.(t, t.source!) } : undefined,
  })

  const renderRow = (t: YoloTodoRow, opts: { retiring?: boolean } = {}): JSX.Element => (
    editor?.id === t.id ? (
      <TodoEditor
        key={t.id}
        draft={editor}
        milestones={milestoneTitles}
        busy={busyKey === `edit-${t.id}` || busyKey === `del-${t.id}`}
        confirming={confirmDelete === t.id}
        onChange={setEditor}
        onSave={() => { void saveEditor() }}
        onCancel={() => { setEditor(null); setConfirmDelete(null) }}
        onDelete={() => { setConfirmDelete(t.id) }}
        onConfirmDelete={async () => {
          const id = t.id
          setConfirmDelete(null)
          setEditor(null)
          await act(`del-${id}`, { action: 'cancel', kind: 'todo', id, scope_cwd: t.scope_cwd ?? t.ws?.cwd })
        }}
      />
    ) : (
      <TodoRowView
        key={t.id}
        t={t}
        busy={busyKey === t.id}
        completing={completing.has(t.id)}
        retiring={opts.retiring}
        {...rowActions(t)}
      />
    )
  )

  const caps = (
    <div className="caps" role="group" aria-label="聚焦筛选">
      {(Object.keys(FOCUS_LABEL) as FocusBucket[]).map((k) => (
        <button
          key={k}
          type="button"
          className={`cap${filter.focus === k ? ' on' : ''}`}
          aria-pressed={filter.focus === k}
          onClick={() => { patch({ focus: filter.focus === k ? null : k }) }}
        >
          {FOCUS_LABEL[k]} <span className="num">{counts[k]}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div
      id={`yolo-surface-${surface}`}
      role="tabpanel"
      aria-label="助手内容"
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <div className="p-body" ref={bodyRef} aria-hidden={taskPanel ? true : undefined}>
        <main className="p-main">
          {actionError && (
            <div className="err-line">
              <span>操作失败：{actionError}</span>
              <button type="button" className="nact" onClick={() => { setActionError(null) }}>关闭</button>
            </div>
          )}

          {surface === 'home' && (
            <>
              <TodaySurface
                data={data}
                busyTodoId={busyKey ?? undefined}
                judgmentExpanded={judgmentExpanded}
                renderQuickCapture={() => <CaptureBar busy={quickBusy} onSubmit={sendQuickAdd} />}
                onIntent={handleTodayIntent}
              />
            </>
          )}

          {surface === 'plan-today' && (
            <>
              <div className="heading"><h2>今天</h2><span className="hint">{visiblePlanToday.length} 件</span></div>
              {visiblePlanToday.length > 0 ? (
                <section className="sec today" aria-label={`今天 ${visiblePlanToday.length}`}>
                  {visiblePlanToday.map((todo) => renderRow(todo))}
                </section>
              ) : (
                <div className="empty"><h4>今天没有待处理安排</h4><p>逾期和今天到期的事项会出现在这里。</p></div>
              )}
            </>
          )}

          {surface === 'plan-upcoming' && (
            <>
              <div className="heading"><h2>接下来</h2><span className="hint">有明确日期的后续安排</span></div>
              {visiblePlanUpcoming.length > 0 ? (
                <section className="sec" aria-label={`接下来 ${visiblePlanUpcoming.length}`}>
                  {visiblePlanUpcoming.map((todo) => renderRow(todo))}
                </section>
              ) : (
                <div className="empty">
                  <h4>没有即将到来的事</h4>
                  <p>有明确后续日期的事项会出现在这里。</p>
                </div>
              )}
            </>
          )}

          {surface === 'plan-all' && (
            <>
              <div className="heading"><h2>全部计划</h2><span className="hint">{visiblePlanAll.length} 件开放事项</span></div>
              {caps}
              {visiblePlanAll.length > 0 ? (
                <section className="sec" aria-label={`全部计划 ${visiblePlanAll.length}`}>
                  {visiblePlanAll.map((todo) => renderRow(todo))}
                </section>
              ) : (
                <div className="empty"><h4>没有开放事项</h4><p>你记录的计划会保留在这里。</p></div>
              )}
            </>
          )}

          {surface === 'plan-goals' && (
            <>
              <div className="heading"><h2>目标与里程碑</h2><span className="hint">{activeGoals.length} 目标 · 平均 {avgGoalPct}% · 进度只读</span></div>
              {activeGoals.map((g) => (
                <GoalBlock
                  key={g.id}
                  goal={g}
                  milestones={data.milestones.filter((m) => m.title === g.milestone_title)}
                  renaming={renameDraft?.kind === 'goal' && renameDraft.id === g.id}
                  renameValue={renameDraft?.kind === 'goal' && renameDraft.id === g.id ? renameDraft.title : ''}
                  busy={busyKey === `goal-${g.id}`}
                  onRenameStart={() => { setRenameDraft({ kind: 'goal', id: g.id, title: g.title }) }}
                  onRenameChange={(v) => { setRenameDraft((d) => d ? { ...d, title: v } : d) }}
                  onRenameSave={async () => {
                    const d = renameDraft
                    setRenameDraft(null)
                    if (d && d.title.trim() && d.title !== g.title) await act(`goal-${g.id}`, { action: 'rename', kind: 'goal', id: g.id, title: d.title.trim(), scope_cwd: g.ws?.cwd })
                  }}
                  onRenameCancel={() => { setRenameDraft(null) }}
                  onAbandon={() => { void act(`goal-${g.id}`, { action: 'abandon', kind: 'goal', id: g.id, scope_cwd: g.ws?.cwd }) }}
                  onMsDot={(m, x) => { setMsPop(msPop?.id === m.id ? null : { id: m.id, x }) }}
                  msPopId={msPop?.id ?? null}
                />
              ))}
              {openMilestones.length > 0 && (
                <MilestoneTrack
                  milestones={openMilestones}
                  renaming={renameDraft?.kind === 'milestone' ? renameDraft : null}
                  busyKey={busyKey}
                  pop={msPop}
                  onDot={(m, x) => { setMsPop(msPop?.id === m.id ? null : { id: m.id, x }) }}
                  onRenameStart={(m) => { setRenameDraft({ kind: 'milestone', id: m.id, title: m.title }) }}
                  onRenameChange={(v) => { setRenameDraft((d) => d ? { ...d, title: v } : d) }}
                  onRenameSave={async (m) => {
                    const d = renameDraft
                    setRenameDraft(null)
                    if (d && d.title.trim() && d.title !== m.title) await act(`ms-${m.id}`, { action: 'rename', kind: 'milestone', id: m.id, title: d.title.trim(), scope_cwd: m.ws?.cwd })
                  }}
                  onRenameCancel={() => { setRenameDraft(null) }}
                  onStatus={(m, status) => { void act(`ms-${m.id}`, { action: 'set_status', kind: 'milestone', id: m.id, status, scope_cwd: m.ws?.cwd }) }}
                  onPopClose={() => { setMsPop(null) }}
                />
              )}
              {activeGoals.length === 0 && openMilestones.length === 0 && (
                <div className="empty">
                  <h4>暂无进行中的目标</h4>
                  <p>目标与里程碑会出现在这里（进度只读）。</p>
                </div>
              )}
            </>
          )}

          {(surface === 'history-timeline' || surface === 'history-items') && (
            <HistoryView
              mode={surface === 'history-timeline' ? 'timeline' : 'items'}
              dashboard={data}
              refreshDashboard={refresh}
              onOpenItemDetail={onOpenItemDetail}
              onOpenChangeSource={onOpenChangeSource}
            />
          )}
        </main>
      </div>

      {taskPanel && taskDraft ? (
        <TaskActionPanel
          item={taskPanel.item}
          reason={taskPanel.reason}
          evidence={taskPanel.evidence}
          source={taskPanel.source}
          draft={taskDraft}
          busy={busyKey?.startsWith('panel-') === true}
          learningReceipt={taskReceipt}
          judgmentFeedbackEnabled={taskPanel.binding !== undefined}
          onAction={handleTaskAction}
          onDraftChange={setTaskDraft}
          onSave={saveTaskPanel}
          onClose={closeTaskPanel}
          onOpenSource={() => {
            if (taskPanel.item.source) onOpenSource?.(taskPanel.item, taskPanel.item.source)
          }}
          onUndoReceipt={taskUndo ? undoTaskReceipt : undefined}
        />
      ) : null}

      {/* toast (5.1); completion toast carries 撤销 (5.4) */}
      {toast && (
        <div className="toast show" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" onClick={() => { void undoComplete(toast.undo as YoloTodoRow) }}>撤销</button>
          )}
        </div>
      )}
    </div>
  )
}

function TodoRowView({ t, busy, completing, retiring, onComplete, onAct, onEdit, onChat, onSource, onReopen }: {
  t: YoloTodoRow
  busy: boolean
  completing: boolean
  retiring?: boolean
  onComplete: () => void
  onAct: (action: string, extra?: { due_at?: string }) => void
  onEdit: () => void
  onChat: () => void
  onSource?: () => void
  onReopen?: () => void
}): JSX.Element {
  const open = isTodoOpen(t.status)
  const done = t.status === 'done' || t.status === 'completed'
  const terminal = !open
  const isUrgent = t.priority === 'urgent'
  const showFlag = isUrgent || t.priority === 'high'
  const isRetiring = retiring === true
  // Keyboard navigation within a section: ↑/↓ move focus between rows.
  const navRow = (dir: 1 | -1): void => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.yolo-scope .sec .row[data-kb-row="1"]'))
    const idx = rows.indexOf(document.activeElement as HTMLElement)
    const next = rows[(idx + dir + rows.length) % rows.length]
    next?.focus()
  }
  const rowCls = [
    'row',
    t.overdue && open ? ' overdue' : '',
    t.status === 'in_progress' ? ' inprog' : '',
    completing ? ' retire' : '',
    isRetiring ? ' retiring' : '',
    terminal ? ' done-row' : '',
  ].join('')
  return (
    <div
      className={rowCls}
      data-kb-row={open && !isRetiring ? '1' : undefined}
      role="listitem"
      tabIndex={open && !isRetiring ? 0 : undefined}
      aria-label={open ? `任务：${t.title}` : done ? `已完成：${t.title}` : `已取消：${t.title}`}
      onKeyDown={(e) => {
        if (isRetiring || !open) return
        // Only the ROW itself owns Space/Enter/E/↑/↓. When focus sits on a
        // child control (完成/推迟/编辑/聊一聊), let the key activate THAT control
        // — without this guard, Space on 「聊一聊」 completed the todo.
        if (e.target !== e.currentTarget) return
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onComplete() }
        else if (e.key.toLowerCase() === 'e') { e.preventDefault(); onEdit() }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); navRow(e.key === 'ArrowDown' ? 1 : -1) }
      }}
    >
      <button
        type="button"
        className={`ctl${terminal || completing ? ' done' : ''}`}
        onClick={() => { if (open) onComplete(); else onReopen?.() }}
        aria-label={open ? `完成：${t.title}` : `重新打开：${t.title}`}
        title={open ? '标记完成' : '重新打开'}
      >
        <IcCheck size={9} />
      </button>
      <div className="row-main">
        <div className="row-title" title={t.title}>
          {showFlag && <IcFlag size={12} className={isUrgent ? 'urgent' : undefined} />}
          <span className={`tt${terminal ? ' done' : ''}`}>{t.title}</span>
          {t.status === 'in_progress' && <span className="inprog-tag">进行中</span>}
        </div>
        <div className="row-meta">
          <span className="due">{done && t.completed_at ? fmtDone(t.completed_at) : t.status === 'cancelled' ? '已取消' : fmtDue(t.due_at)}</span>
          {open && t.overdue && <span style={{ color: 'var(--y-danger)' }}>逾期</span>}
          {open && t.stale && (
            <>
              <span className="sep">·</span>
              <span>{untouchedDays(t)} 天未动</span>
            </>
          )}
          {t.milestone_title && (
            <>
              <span className="sep">·</span>
              <span>{t.milestone_title}</span>
            </>
          )}
          {t.source && onSource ? (
            <button type="button" className="src" title="查看来源" data-yolo-focus-id={`row-source:${t.scope_cwd ?? t.ws?.cwd ?? ''}:${t.id}`} onClick={(event) => { event.stopPropagation(); onSource() }}>
              <IcPin size={11} />
              <span>{t.source.label}</span>
            </button>
          ) : t.session_label ? (
            <span className="src" title={t.session_label}><IcPin size={11} /><span>{t.session_label}</span></span>
          ) : null}
          {t.belief && t.belief.stale >= 2 && t.belief.stale > t.belief.good && (
            <>
              <span className="sep">·</span>
              <span className="stale-tag" title="这条待办多次被取消/搁置——考虑它是否真的需要跟进">常忘</span>
            </>
          )}
        </div>
      </div>
      {open && !isRetiring && (
        <div className="row-acts">
          <button type="button" className="act" disabled={busy} title="标记完成" aria-label="标记完成" onClick={onComplete}><IcCheck size={14} /></button>
          <button type="button" className="act" disabled={busy} title={`推迟到 ${nextDayStr(t.due_at)}`} aria-label="推迟一天" onClick={() => { onAct('postpone', { due_at: nextDayStr(t.due_at) }) }}><IcPlusDay size={14} /></button>
          <button type="button" className="act" disabled={busy} title="编辑" aria-label="编辑" onClick={onEdit}><IcDots size={14} /></button>
          <button type="button" className="act" disabled={busy} title="讨论这项安排" aria-label="讨论这项安排" onClick={onChat}><IcChat size={14} /></button>
        </div>
      )}
      {!open && onReopen ? (
        <div className="row-acts">
          <button type="button" className="nact" disabled={busy} onClick={onReopen}>重新打开</button>
        </div>
      ) : null}
    </div>
  )
}

function TodoEditor({ draft, milestones, busy, confirming, onChange, onSave, onCancel, onDelete, onConfirmDelete }: {
  draft: EditorDraft
  milestones: readonly string[]
  busy: boolean
  confirming: boolean
  onChange: (d: EditorDraft) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  onConfirmDelete: () => void
}): JSX.Element {
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
    }
  }
  return (
    <div className="row editing">
      <div className="edit-form" onKeyDown={onKey}>
        <textarea
          autoFocus
          className="ef-input ef-title"
          aria-label="任务标题"
          rows={2}
          value={draft.title}
          onChange={(e) => { onChange({ ...draft, title: e.target.value }) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              onSave()
            }
          }}
        />
        <input type="date" className="ef-input ef-date" aria-label="到期日" value={draft.due} onChange={(e) => { onChange({ ...draft, due: e.target.value }) }} />
        <select className="ef-sel" aria-label="优先级" value={draft.priority} onChange={(e) => { onChange({ ...draft, priority: e.target.value }) }}>
          <option value="">优先级</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="urgent">urgent</option>
        </select>
        <select className="ef-sel" aria-label="里程碑" value={draft.milestoneTitle} onChange={(e) => { onChange({ ...draft, milestoneTitle: e.target.value }) }}>
          <option value="">无里程碑</option>
          {milestones.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost ef-btn" disabled={busy} onClick={onSave}>保存</button>
        <button type="button" className="btn btn-ghost ef-btn" disabled={busy} onClick={onCancel}>取消</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-danger ef-btn" disabled={busy} onClick={onDelete}>取消事项…</button>
        {confirming && (
          <div className="confirm-strip" role="dialog" aria-label="确认取消事项">
            <span style={{ flex: 1 }}>取消后会移到“已取消”，可以重新打开。</span>
            <button type="button" className="btn btn-danger ef-btn" disabled={busy} onClick={onConfirmDelete}>确认取消</button>
            <button type="button" className="btn btn-ghost ef-btn" onClick={onCancel}>保留事项</button>
          </div>
        )}
      </div>
    </div>
  )
}

function GoalBlock({ goal, milestones, renaming, renameValue, busy, onRenameStart, onRenameChange, onRenameSave, onRenameCancel, onAbandon, onMsDot, msPopId }: {
  goal: YoloDashboardData['goals'][number]
  milestones: YoloMilestoneRow[]
  renaming: boolean
  renameValue: string
  busy: boolean
  onRenameStart: () => void
  onRenameChange: (v: string) => void
  onRenameSave: () => void
  onRenameCancel: () => void
  onAbandon: () => void
  onMsDot: (m: YoloMilestoneRow, x: number) => void
  msPopId: string | null
}): JSX.Element {
  const pct = Math.max(0, Math.min(100, goal.progress))
  return (
    <div className="goal">
      <div className="goal-head">
        {renaming ? (
          <input
            autoFocus
            className="goal-name-input"
            value={renameValue}
            onChange={(e) => { onRenameChange(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) onRenameSave()
              if (e.key === 'Escape') { e.stopPropagation(); onRenameCancel() }
            }}
          />
        ) : (
          <button type="button" className="goal-name" title="点击改名" onClick={onRenameStart}>{goal.title}</button>
        )}
        <span className="goal-pct">{pct}%</span>
        <button type="button" className="nact" disabled={busy} title="放弃该目标（进度来自对话陈述，只读）" onClick={onAbandon}>放弃</button>
      </div>
      <div className="goal-track">
        <div className="goal-fill" style={{ width: `${pct}%` }} />
        {milestones.map((m) => {
          const x = dotPos(m.target_date)
          return (
            <button
              key={m.id}
              type="button"
              className={`ms-dot${m.status === 'done' ? ' done' : m.status === 'active' ? ' active' : ''}${msPopId === m.id ? ' hl' : ''}`}
              style={{ left: `${x}%` }}
              title={m.title}
              onClick={() => { onMsDot(m, x) }}
            >
              <span className="ms-label"><b>{m.title}</b><i>{m.target_date ? m.target_date.slice(5, 10) : ''}</i></span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Shared time axis for open milestones that no active goal carries (5.5). */
function MilestoneTrack({ milestones, renaming, busyKey, pop, onDot, onRenameStart, onRenameChange, onRenameSave, onRenameCancel, onStatus, onPopClose }: {
  milestones: YoloMilestoneRow[]
  renaming: { id: string; title: string } | null
  busyKey: string | null
  pop: { id: string; x: number } | null
  onDot: (m: YoloMilestoneRow, x: number) => void
  onRenameStart: (m: YoloMilestoneRow) => void
  onRenameChange: (v: string) => void
  onRenameSave: (m: YoloMilestoneRow) => void
  onRenameCancel: () => void
  onStatus: (m: YoloMilestoneRow, status: string) => void
  onPopClose: () => void
}): JSX.Element {
  const target = milestones.find((m) => m.id === pop?.id)
  return (
    <div className="goal" style={{ borderBottom: 'none' }}>
      <div className="goal-head">
        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--y-text-3)' }}>里程碑</span>
      </div>
      <div className={`goal-track${target && pop ? ' has-pop' : ''}`}>
        {milestones.map((m) => {
          const x = dotPos(m.target_date)
          return (
            <button
              key={m.id}
              type="button"
              className={`ms-dot${m.status === 'done' ? ' done' : m.status === 'active' ? ' active' : ''}${pop?.id === m.id ? ' hl' : ''}`}
              style={{ left: `${x}%` }}
              title={m.title}
              onClick={() => { onDot(m, x) }}
            >
              <span className="ms-label"><b>{m.title}</b><i>{m.target_date ? m.target_date.slice(5, 10) : ''}</i></span>
            </button>
          )
        })}
        {target && pop && (
          <div className="ms-pop" role="dialog" aria-label={`编辑里程碑：${target.title}`} style={{ '--x': `${pop.x}%` } as React.CSSProperties}>
            {renaming?.id === target.id ? (
              <input
                autoFocus
                value={renaming.title}
                onChange={(e) => { onRenameChange(e.target.value) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) onRenameSave(target)
                  if (e.key === 'Escape') { e.stopPropagation(); onRenameCancel() }
                }}
              />
            ) : (
              <input
                value={target.title}
                title="点击改名"
                onFocus={() => { onRenameStart(target) }}
                onChange={() => { /* controlled rename starts on focus */ }}
                readOnly
              />
            )}
            <div className="ms-pop-row">
              {(['planned', 'active', 'done', 'abandoned'] as const).map((st) => (
                <button key={st} type="button" className={`ms-st${target.status === st ? ' on' : ''}`} disabled={busyKey === `ms-${target.id}`} onClick={() => { onStatus(target, st) }}>
                  {MS_STATUS_LABEL[st]}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost ef-btn" style={{ width: '100%', marginTop: 4 }} onClick={onPopClose}>关闭</button>
          </div>
        )}
      </div>
    </div>
  )
}

const MS_STATUS_LABEL: Record<string, string> = {
  planned: '计划',
  active: '进行',
  done: '完成',
  abandoned: '放弃',
}
