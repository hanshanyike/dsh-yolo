import type Yolo from '../../storage/index.ts'
import type { Goal, HistorySubjectStats, HistorySubjectType, Milestone, TimelineEvent, Todo } from '../../domain/types.ts'
import { USER_VISIBLE_CHANGE_KINDS } from '../../shared/dashboard-surfaces.ts'
import type {
  YoloHistoryData,
  YoloHistoryEvent,
  YoloHistoryItem,
  YoloHistoryStatusFilter,
  YoloHistoryView,
} from '../../shared/history.ts'
import { workspaceIdentity } from '../../domain/scope.ts'
import { findKnownWorkspaceScope } from '../workspace-scope.ts'
import { disambiguateWorkspaceLabels, eventLabel, workspaceLabel } from './dashboard.ts'

export interface HistoryCursorData {
  openedAt: number
  offset: number
}

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 80
const VISIBLE_KINDS = [...USER_VISIBLE_CHANGE_KINDS]

function encodeCursor(cursor: HistoryCursorData): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function metasOf(yolo: Yolo, fallbackCwd: string): Array<{ cwd: string; scopeKey: string }> {
  const known = yolo.listWorkspaceMeta()
  if (known.length > 0) return known
  const resolved = yolo.resolve(fallbackCwd)
  return [{ cwd: fallbackCwd, scopeKey: resolved.scopeKey }]
}

function eventItem(
  event: TimelineEvent,
  cwd: string,
  scopeKey: string,
  label: string,
  sessions: Map<string, string>,
): YoloHistoryEvent {
  const subject = event.subject_type && event.subject_id
    ? { type: event.subject_type, id: event.subject_id, title: event.subject_title ?? '未命名事项' }
    : undefined
  const related = event.related_subject_type && event.related_subject_id
    ? { type: event.related_subject_type, id: event.related_subject_id, title: event.related_subject_title ?? '未命名事项' }
    : undefined
  return {
    id: event.id,
    kind: event.kind,
    summary: event.summary,
    detail: event.detail ?? null,
    occurred_at: event.occurred_at,
    label: eventLabel(event, sessions),
    session_id: event.session_id ?? null,
    ...(subject ? { subject } : {}),
    ...(related ? { related_subject: related } : {}),
    change: event.change ?? null,
    scope_cwd: cwd,
    ws: { slug: scopeKey, label, cwd },
  }
}

function compareEvent(left: YoloHistoryEvent, right: YoloHistoryEvent): number {
  return right.occurred_at - left.occurred_at
    || right.scope_cwd.localeCompare(left.scope_cwd)
    || right.id.localeCompare(left.id)
}

function statusMatches(item: YoloHistoryItem, status: YoloHistoryStatusFilter): boolean {
  const merged = item.record_status === 'merged'
  const completed = item.status === 'done' || item.status === 'completed' || item.status === 'achieved'
  const cancelled = item.status === 'cancelled' || item.status === 'abandoned'
  const ended = merged || completed || cancelled
  if (status === 'all') return true
  if (status === 'open') return !ended
  if (status === 'ended') return ended
  if (status === 'completed') return completed
  return cancelled
}

function statsKey(type: HistorySubjectType, id: string): string {
  return `${type}\u0000${id}`
}

function buildWorkspaceItems(
  cwd: string,
  scopeKey: string,
  label: string,
  todos: readonly Todo[],
  goals: readonly Goal[],
  milestones: readonly Milestone[],
  stats: readonly HistorySubjectStats[],
  latest: readonly TimelineEvent[],
): YoloHistoryItem[] {
  const statMap = new Map(stats.map((row) => [statsKey(row.subject_type, row.subject_id), row]))
  const latestMap = new Map(latest
    .filter((row) => row.subject_type && row.subject_id)
    .map((row) => [statsKey(row.subject_type!, row.subject_id!), row]))
  const ws = { slug: scopeKey, label, cwd }
  const common = (type: HistorySubjectType, id: string, title: string, status: string, updatedAt: number): Omit<YoloHistoryItem, 'record_status' | 'merged_into_id'> => {
    const stat = statMap.get(statsKey(type, id))
    const recent = latestMap.get(statsKey(type, id))
    return {
      type, id, title, status,
      last_changed_at: stat?.last_changed_at ?? updatedAt,
      change_count: stat?.change_count ?? 0,
      latest_summary: recent?.summary ?? null,
      scope_cwd: cwd,
      ws,
    }
  }
  return [
    ...todos.filter((row) => row.record_status !== 'rejected').map((row) => ({
      ...common('todo', row.id, row.title, row.status, row.updated_at),
      record_status: row.record_status ?? 'canonical',
      merged_into_id: row.merged_into_id ?? null,
    })),
    ...goals.map((row) => common('goal', row.id, row.title, row.status, row.updated_at)),
    ...milestones.map((row) => common('milestone', row.id, row.title, row.status, row.updated_at)),
  ]
}

/** Build the cursor-paginated product history across all known workspaces. */
export function buildHistoryData(
  yolo: Yolo,
  fallbackCwd: string,
  options: {
    view?: YoloHistoryView
    cursor?: HistoryCursorData
    limit?: number
    status?: YoloHistoryStatusFilter
    query?: string
    subjectType?: HistorySubjectType
    subjectId?: string
    subjectCwd?: string
  } = {},
): YoloHistoryData {
  const view = options.view ?? 'timeline'
  const openedAt = options.cursor?.openedAt ?? Date.now()
  const offset = options.cursor?.offset ?? 0
  const limit = Math.max(1, Math.min(MAX_LIMIT, options.limit ?? DEFAULT_LIMIT))
  const fetchLimit = offset + limit + 1
  const metas = metasOf(yolo, fallbackCwd)
  const labels = disambiguateWorkspaceLabels(metas)
  const errors: string[] = []
  const events: YoloHistoryEvent[] = []
  const items: YoloHistoryItem[] = []

  const selected = view === 'subject'
    ? (() => {
        if (!options.subjectCwd) throw new Error('scope_cwd is required for subject history')
        const meta = findKnownWorkspaceScope(options.subjectCwd, metas)
        if (!meta) throw new Error('unknown workspace scope')
        return [meta]
      })()
    : metas

  for (const meta of selected) {
    try {
      yolo.runInScope(meta.cwd, meta.scopeKey, () => {
        const label = labels.get(workspaceIdentity(meta.cwd)) ?? workspaceLabel(meta.cwd, meta.scopeKey)
        const sessions = new Map(yolo.listSessionSummaries(meta.cwd).map((row) => [row.session_id, row.summary]))
        if (view === 'timeline') {
          events.push(...yolo.listEventsUntil(meta.cwd, openedAt, fetchLimit, VISIBLE_KINDS)
            .map((event) => eventItem(event, meta.cwd, meta.scopeKey, label, sessions)))
          return
        }
        if (view === 'subject') {
          if (!options.subjectType || !options.subjectId) throw new Error('subject_type and subject_id are required')
          events.push(...yolo.listEventsForSubject(meta.cwd, options.subjectType, options.subjectId, openedAt, fetchLimit, VISIBLE_KINDS)
            .map((event) => eventItem(event, meta.cwd, meta.scopeKey, label, sessions)))
          return
        }
        const stats = yolo.listEventSubjectStats(meta.cwd, openedAt, VISIBLE_KINDS)
        const latest = yolo.listLatestEventsBySubject(meta.cwd, openedAt, VISIBLE_KINDS)
        items.push(...buildWorkspaceItems(
          meta.cwd, meta.scopeKey, label,
          yolo.listTodoRecords(meta.cwd), yolo.listGoals(meta.cwd), yolo.listMilestones(meta.cwd), stats, latest,
        ))
      })
    } catch (error) {
      errors.push(`${workspaceLabel(meta.cwd, meta.scopeKey)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (errors.length === selected.length) throw new Error(errors[0] ?? 'no workspace history could be read')
  events.sort(compareEvent)
  const status = options.status ?? 'all'
  const query = options.query?.trim().toLocaleLowerCase() ?? ''
  const filteredItems = items
    .filter((item) => statusMatches(item, status))
    .filter((item) => !query || item.title.toLocaleLowerCase().includes(query) || item.latest_summary?.toLocaleLowerCase().includes(query))
    .sort((left, right) => right.last_changed_at - left.last_changed_at
      || right.scope_cwd.localeCompare(left.scope_cwd)
      || right.id.localeCompare(left.id))
  const rows = view === 'items' ? filteredItems : events
  const page = rows.slice(offset, offset + limit)
  return {
    view,
    openedAt,
    events: view === 'items' ? [] : page as YoloHistoryEvent[],
    items: view === 'items' ? page as YoloHistoryItem[] : [],
    nextCursor: rows.length > offset + limit ? encodeCursor({ openedAt, offset: offset + page.length }) : null,
    partial: errors.length > 0,
    workspaceErrors: errors,
    revision: Date.now(),
  }
}
