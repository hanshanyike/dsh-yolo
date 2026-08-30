import { useEffect, useMemo, useRef, useState } from 'react'
import type { YoloDashboardData, YoloTodoRow } from '../../src/contracts/dashboard.ts'
import { dueAtLocalDate } from '../../src/shared/due.ts'
import { localDateStr } from '../../src/shared/text.ts'
import {
  selectTodosInRange,
  type TodoRangeAction,
  type TodoRangeField,
  type TodoRangeSelector,
} from '../../src/shared/todo-range.ts'
import { postYoloAction } from './v2/api.ts'

interface DataManagementDialogProps {
  data: YoloDashboardData
  onClose: () => void
  onRefresh: () => Promise<void>
}

type WorkspaceScope = 'current' | 'all'

function workspaceIdentity(cwd: string): string {
  return cwd.replaceAll('\\', '/').replace(/\/+$/u, '').toLocaleLowerCase()
}

function ownerCwd(todo: YoloTodoRow, fallback: string): string {
  return todo.scope_cwd ?? todo.ws?.cwd ?? fallback
}

function currentWorkspaceRows(data: YoloDashboardData): YoloTodoRow[] {
  const current = workspaceIdentity(data.cwd)
  return data.todos.filter((todo) => workspaceIdentity(ownerCwd(todo, data.cwd)) === current)
}

function workspaceLabel(todo: YoloTodoRow, fallback: string): string {
  return todo.ws?.label ?? ownerCwd(todo, fallback).replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? '当前工作区'
}

export function DataManagementDialog({ data, onClose, onRefresh }: DataManagementDialogProps): JSX.Element {
  const today = localDateStr()
  const [action, setAction] = useState<TodoRangeAction>('bulk_cancel')
  const [field, setField] = useState<TodoRangeField>('due_at')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [scope, setScope] = useState<WorkspaceScope>('current')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const selector: TodoRangeSelector = { field, from, to }
  const dateValid = from !== '' && to !== '' && from <= to

  const scopeRows = useMemo(
    () => scope === 'all' ? data.todos : currentWorkspaceRows(data),
    [data, scope],
  )
  const candidates = useMemo(
    () => dateValid ? selectTodosInRange(scopeRows, selector, action) : [],
    [action, dateValid, field, from, scopeRows, to],
  )
  const undated = useMemo(
    () => field === 'due_at'
      ? scopeRows.filter((todo) => dueAtLocalDate(todo.due_at) === undefined).length
      : 0,
    [field, scopeRows],
  )
  const workspaceCount = new Set(candidates.map((todo) => workspaceIdentity(ownerCwd(todo, data.cwd)))).size
  const scopeCoverageValid = scope !== 'all' || (data.workspaceErrors?.length ?? 0) === 0
  const canSubmit = candidates.length > 0
    && dateValid
    && scopeCoverageValid
    && !busy
    && (action !== 'bulk_delete' || confirmation === '永久删除')

  useEffect(() => {
    const first = rootRef.current?.querySelector<HTMLElement>('button, input, select')
    first?.focus()
  }, [])

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    setResult(null)
    const groups = new Map<string, YoloTodoRow[]>()
    for (const todo of candidates) {
      const cwd = ownerCwd(todo, data.cwd)
      const rows = groups.get(cwd) ?? []
      rows.push(todo)
      groups.set(cwd, rows)
    }
    let affected = 0
    const failures: string[] = []
    for (const [cwd] of groups) {
      try {
        const outcome = await postYoloAction({
          action,
          kind: 'todo',
          scope_cwd: cwd,
          range_field: field,
          range_from: from,
          range_to: to,
          ...(action === 'bulk_delete' ? { confirmation: 'PERMANENT_DELETE' } : {}),
        })
        affected += Number(outcome.item.affected ?? 0)
      } catch (caught) {
        failures.push(`${cwd}：${caught instanceof Error ? caught.message : String(caught)}`)
      }
    }
    await onRefresh().catch((caught) => {
      failures.push(`刷新失败：${caught instanceof Error ? caught.message : String(caught)}`)
    })
    setBusy(false)
    if (failures.length > 0) {
      setError(`已处理 ${affected} 项；${failures.join('；')}`)
      return
    }
    setResult(action === 'bulk_cancel' ? `已取消 ${affected} 项。` : `已永久删除 ${affected} 项。`)
    setConfirmation('')
  }

  return (
    <div className="data-manager-backdrop" role="presentation">
      <div
        ref={rootRef}
        className="data-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-manager-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation()
            onClose()
            return
          }
          if (event.key !== 'Tab') return
          const focusable = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? []).filter((element) => !element.hidden)
          if (focusable.length === 0) return
          const first = focusable[0]!
          const last = focusable[focusable.length - 1]!
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <header>
          <div>
            <span className="eyebrow">数据管理</span>
            <h2 id="data-manager-title">按日期处理事项</h2>
          </div>
          <button type="button" disabled={busy} onClick={onClose} aria-label="关闭数据管理">关闭</button>
        </header>

        <div className="data-manager-body">
          <fieldset className="data-manager-modes" disabled={busy}>
            <legend>处理方式</legend>
            <label className={action === 'bulk_cancel' ? 'on' : undefined}>
              <input type="radio" name="range-action" checked={action === 'bulk_cancel'} onChange={() => { setAction('bulk_cancel'); setResult(null) }} />
              <span><b>取消事项</b><small>移到“已取消”，保留审计，可逐条重新打开</small></span>
            </label>
            <label className={action === 'bulk_delete' ? 'on danger' : 'danger'}>
              <input type="radio" name="range-action" checked={action === 'bulk_delete'} onChange={() => { setAction('bulk_delete'); setResult(null) }} />
              <span><b>永久删除</b><small>移除事项及直接关联数据，不可撤销</small></span>
            </label>
          </fieldset>

          <div className="data-manager-grid">
            <label>
              <span>日期依据</span>
              <select value={field} disabled={busy} onChange={(event) => { setField(event.target.value as TodoRangeField); setResult(null) }}>
                <option value="due_at">截止日期</option>
                <option value="created_at">创建日期</option>
              </select>
            </label>
            <label>
              <span>工作区范围</span>
              <select value={scope} disabled={busy} onChange={(event) => { setScope(event.target.value as WorkspaceScope); setResult(null) }}>
                <option value="current">当前工作区</option>
                <option value="all">全部已知工作区</option>
              </select>
            </label>
            <label>
              <span>开始日期（含）</span>
              <input type="date" value={from} disabled={busy} onChange={(event) => { setFrom(event.target.value); setResult(null) }} />
            </label>
            <label>
              <span>结束日期（含）</span>
              <input type="date" value={to} disabled={busy} onChange={(event) => { setTo(event.target.value); setResult(null) }} />
            </label>
          </div>

          <section className="data-manager-preview" aria-live="polite">
            <div>
              <h3>执行前预览</h3>
              <strong>{dateValid ? candidates.length : 0} 项</strong>
            </div>
            {!dateValid ? <p className="data-manager-error">结束日期不能早于开始日期。</p> : null}
            {!scopeCoverageValid ? <p className="data-manager-error">部分工作区当前不可用，不能执行“全部工作区”批量操作。请恢复后重试，或改为当前工作区。</p> : null}
            {dateValid && candidates.length > 0 ? (
              <>
                <p>涉及 {workspaceCount} 个工作区。{field === 'due_at' && undated > 0 ? `另有 ${undated} 项没有截止日期，不在本次范围内。` : ''}</p>
                <ul>
                  {candidates.slice(0, 12).map((todo) => (
                    <li key={`${ownerCwd(todo, data.cwd)}:${todo.id}`}>
                      <span>{todo.title}</span><small>{workspaceLabel(todo, data.cwd)}</small>
                    </li>
                  ))}
                </ul>
                {candidates.length > 12 ? <p>另有 {candidates.length - 12} 项未在预览中展开。</p> : null}
              </>
            ) : dateValid ? <p>当前条件下没有可处理的事项。</p> : null}
          </section>

          {action === 'bulk_delete' ? (
            <section className="data-manager-confirm danger">
              <h3>永久删除确认</h3>
              <p>事项、来源证据、关联提醒、判断记录和搜索投影会被删除；原始宿主会话与既有时间线不在本次范围内。</p>
              <label>
                <span>输入“永久删除”继续</span>
                <input value={confirmation} disabled={busy} autoComplete="off" onChange={(event) => { setConfirmation(event.target.value) }} />
              </label>
            </section>
          ) : null}

          {error ? <p className="data-manager-error" role="alert">{error}</p> : null}
          {result ? <p className="data-manager-result" role="status">{result}</p> : null}
        </div>

        <footer>
          <button type="button" disabled={busy} onClick={onClose}>返回</button>
          <button
            type="button"
            className={action === 'bulk_delete' ? 'danger' : 'primary'}
            disabled={!canSubmit}
            aria-busy={busy}
            onClick={() => { void submit() }}
          >
            {busy ? '正在处理…' : action === 'bulk_cancel' ? `确认取消 ${candidates.length} 项` : `永久删除 ${candidates.length} 项`}
          </button>
        </footer>
      </div>
    </div>
  )
}
