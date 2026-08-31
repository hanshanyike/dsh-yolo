import type Yolo from '../../storage/index.ts'
import type { MilestoneStatus, Priority } from '../../domain/types.ts'
import type { ExtractedUpdate, ExtractionResult } from '../../contracts/extraction.ts'
import { shouldDropExtracted } from '../../shared/quality.ts'
import { todoEvidenceFingerprint } from '../../shared/todo-identity.ts'
import { buildKnownContext } from './known-context.ts'
import type { TodoIdentityApplicationPlan } from './todo-identity-policy.ts'

export interface ExtractionSource {
  sessionId: string
  turn: number
  excerpt: string | null
  operationId: string
  occurredAt: number
}

const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'urgent']
const MILESTONE_STATUSES: readonly MilestoneStatus[] = ['planned', 'active', 'done', 'abandoned']

function toPriority(value: string | null | undefined): Priority | null {
  return PRIORITIES.includes(value as Priority) ? (value as Priority) : null
}

function applyUpdates(yolo: Yolo, cwd: string, updates: readonly ExtractedUpdate[], source: ExtractionSource, includeTodos = true): void {
  for (const update of updates) {
    if (update.kind === 'todo') {
      if (!includeTodos) continue
      const args = { session_id: source.sessionId }
      let todo = null
      if (update.status === 'done') todo = yolo.applyTodoAction(cwd, { title: update.match_title }, 'complete', args)
      else if (update.status === 'cancelled') todo = yolo.applyTodoAction(cwd, { title: update.match_title }, 'cancel', args)
      else if (update.status === 'in_progress') todo = yolo.applyTodoAction(cwd, { title: update.match_title }, 'start', args)
      else if (update.due_at) todo = yolo.applyTodoAction(cwd, { title: update.match_title }, 'postpone', { due_at: update.due_at, ...args })
      if (todo) {
        yolo.addTodoEvidence(cwd, todo.id, {
          session_id: source.sessionId,
          turn_seq: source.turn,
          source_kind: source.excerpt ? 'human' : 'extraction',
          relation: update.status === 'done' ? 'completion_claim' : 'update',
          excerpt: source.excerpt,
          occurred_at: source.occurredAt,
          source_fingerprint: todoEvidenceFingerprint(source.operationId, todo.id),
        })
      }
    } else if (update.kind === 'goal' && typeof update.progress === 'number') {
      yolo.applyGoalProgress(cwd, { title: update.match_title }, update.progress, update.note ?? undefined, source.sessionId)
    } else if (update.kind === 'milestone' && update.status && MILESTONE_STATUSES.includes(update.status as MilestoneStatus)) {
      yolo.applyMilestoneStatus(cwd, { title: update.match_title }, update.status as MilestoneStatus, source.sessionId)
    }
  }
}

export interface TodoIdentityApplicationOutcome {
  plan: TodoIdentityApplicationPlan
  status: 'fallback' | 'blocked' | 'linked' | 'updated' | 'no_change'
  todo_id?: string
  evidence_created?: boolean
  evidence_id?: string
  due_before?: string | null
  due_after?: string | null
  reason?: string
}

function applyAuthorizedTodoIdentity(
  yolo: Yolo,
  cwd: string,
  result: ExtractionResult,
  source: ExtractionSource,
  identity: TodoIdentityApplicationPlan,
): TodoIdentityApplicationOutcome {
  const todoId = identity.candidate_id
  if (!todoId) return { plan: identity, status: 'blocked', reason: 'authorized_plan_missing_candidate' }
  const before = yolo.findTodo(cwd, { id: todoId })
  if (!before || before.record_status === 'merged' || (before.status !== 'pending' && before.status !== 'in_progress')) {
    return { plan: identity, status: 'blocked', todo_id: todoId, reason: 'candidate_changed_before_commit' }
  }

  let after = before
  let changed = false
  let relation: 'mention' | 'update' = 'mention'
  if (identity.decision === 'UPDATE') {
    const update = result.updates.find((row) => row.kind === 'todo')
    const extracted = result.todos[0]
    const dueAt = update?.due_at ?? extracted?.due_at
    if (dueAt) {
      after = yolo.applyTodoAction(cwd, { id: todoId }, 'postpone', {
        due_at: dueAt,
        session_id: source.sessionId,
      }) ?? before
      relation = 'update'
    }
    changed = after.due_at !== before.due_at
  }

  const evidence = yolo.addTodoEvidence(cwd, todoId, {
    session_id: source.sessionId,
    turn_seq: source.turn,
    source_kind: source.excerpt ? 'human' : 'extraction',
    relation,
    excerpt: source.excerpt,
    occurred_at: source.occurredAt,
    source_fingerprint: todoEvidenceFingerprint(source.operationId, todoId),
  })
  return {
    plan: identity,
    status: identity.decision === 'LINK' ? 'linked' : changed ? 'updated' : 'no_change',
    todo_id: todoId,
    evidence_created: evidence.created,
    evidence_id: evidence.evidence.id,
    ...(identity.decision === 'UPDATE' ? { due_before: before.due_at ?? null, due_after: after.due_at ?? null } : {}),
  }
}

/** Persist one accepted extraction result. The caller owns the surrounding
 * workspace UnitOfWork so state, provenance, log and receipt commit together. */
export function applyExtractionResult(
  yolo: Yolo,
  cwd: string,
  result: ExtractionResult,
  source: ExtractionSource,
  todoIdentity?: TodoIdentityApplicationPlan,
): TodoIdentityApplicationOutcome | undefined {
  for (const milestone of result.milestones) {
    if (!shouldDropExtracted('milestone', milestone.title)) {
      yolo.addMilestone(cwd, {
        title: milestone.title,
        target_date: milestone.target_date,
        description: milestone.description,
        source: 'llm',
      })
    }
  }
  const milestoneId = (title: string | null | undefined): string | null => title ? yolo.findMilestoneId(cwd, title) : null
  let identityOutcome: TodoIdentityApplicationOutcome | undefined
  const identityControlsTodos = todoIdentity?.mode === 'authorized' || todoIdentity?.mode === 'blocked'
  if (todoIdentity?.mode === 'authorized') {
    identityOutcome = applyAuthorizedTodoIdentity(yolo, cwd, result, source, todoIdentity)
  } else if (todoIdentity?.mode === 'blocked') {
    identityOutcome = { plan: todoIdentity, status: 'blocked', reason: todoIdentity.reason }
  }
  for (const item of identityControlsTodos ? [] : result.todos) {
    if (shouldDropExtracted('todo', item.title)) continue
    const { todo, created } = yolo.addTodo(cwd, {
      title: item.title,
      due_at: item.due_at,
      priority: toPriority(item.priority),
      milestone_id: milestoneId(item.milestone_title),
      source: 'llm',
      session_id: source.sessionId,
      source_excerpt: source.excerpt,
      source_turn: source.excerpt ? source.turn : null,
      evidence_operation_key: source.operationId,
      evidence_source_kind: source.excerpt ? 'human' : 'extraction',
      evidence_occurred_at: source.occurredAt,
    })
    if (created) {
      yolo.addEvent(cwd, {
        kind: 'todo_created',
        summary: `＋ 记录新待办「${item.title}」`,
        detail: item.due_at ? `截止 ${item.due_at}` : null,
        session_id: source.sessionId,
        source: 'llm',
        subject_type: 'todo',
        subject_id: todo.id,
        subject_title: todo.title,
        change: {
          status: { before: null, after: todo.status },
          ...(todo.due_at ? { due_at: { before: null, after: todo.due_at } } : {}),
        },
      })
    }
  }
  for (const goal of result.goals) {
    if (!shouldDropExtracted('goal', goal.title)) {
      const status = goal.management_intent === 'explicit' ? 'active' : 'candidate'
      const stored = yolo.addGoal(cwd, {
        title: goal.title,
        description: goal.description,
        milestone_id: milestoneId(goal.milestone_title),
        completion_criteria: goal.completion_hint,
        target_date: goal.target_date,
        status,
        source: 'llm',
        session_id: source.sessionId,
        source_excerpt: source.excerpt,
        source_turn: source.excerpt ? source.turn : null,
      })
      const linkedMilestoneId = milestoneId(goal.milestone_title)
      if (linkedMilestoneId) {
        const existed = yolo.listGoalMilestoneLinks(cwd, stored.id).some((link) => link.milestone_id === linkedMilestoneId)
        const link = yolo.linkGoalMilestone(cwd, stored.id, linkedMilestoneId)
        if (!existed) {
          yolo.addEvent(cwd, {
            kind: 'goal_linked',
            summary: `目标关联里程碑`,
            detail: JSON.stringify(link),
            session_id: source.sessionId,
            source: null,
            subject_type: 'goal', subject_id: stored.id, subject_title: stored.title,
            related_subject_type: 'milestone', related_subject_id: linkedMilestoneId,
            change: { relation: { before: null, after: 'milestone' } },
          })
        }
      }
      if (status === 'active' && stored.status === 'candidate') {
        const activated = yolo.setGoalStatus(cwd, stored.id, 'active')
        if (activated) {
          yolo.addEvent(cwd, {
            kind: 'goal_status',
            summary: `目标「${activated.title}」已确认持续跟进`,
            session_id: source.sessionId,
            source: null,
            subject_type: 'goal', subject_id: activated.id, subject_title: activated.title,
            change: { status: { before: 'candidate', after: 'active' } },
          })
        }
      }
    }
  }
  for (const preference of result.preferences) {
    if (!shouldDropExtracted('preference', preference.key, preference.value)) {
      yolo.addPreference(cwd, { key: preference.key, value: preference.value, session_id: source.sessionId })
    }
  }
  const recentSummaries = new Set(yolo.listEvents(cwd, 30).map((event) => event.summary))
  for (const event of result.events) {
    if (shouldDropExtracted('event', event.summary) || recentSummaries.has(event.summary)) continue
    recentSummaries.add(event.summary)
    yolo.addEvent(cwd, {
      kind: event.kind,
      summary: event.summary,
      occurred_at: event.occurred_at ? Date.parse(event.occurred_at) || undefined : undefined,
      session_id: source.sessionId,
      source: 'llm',
    })
  }
  if (result.session_summary) yolo.upsertSessionSummary(cwd, source.sessionId, result.session_summary)
  applyUpdates(yolo, cwd, result.updates, source, !identityControlsTodos && todoIdentity?.mode !== 'create')
  if (!identityOutcome && todoIdentity) {
    identityOutcome = {
      plan: todoIdentity,
      status: 'fallback',
      ...(todoIdentity.mode === 'create' ? { reason: 'create_uses_existing_extraction' } : {}),
    }
  }
  return identityOutcome
}

export function buildKnownMemoryContext(yolo: Yolo, cwd: string): string | null {
  try {
    return buildKnownContext({
      todos: yolo.listTodos(cwd).map((todo) => ({ title: todo.title, status: todo.status, due_at: todo.due_at })),
      goals: yolo.listGoals(cwd).map((goal) => ({ title: goal.title, progress: goal.progress })),
      milestones: yolo.listMilestones(cwd).map((milestone) => ({ title: milestone.title, status: milestone.status })),
      preferences: yolo.listPreferences(cwd).map((preference) => ({ key: preference.key, value: preference.value })),
      events: yolo.listEvents(cwd, 15).map((event) => event.summary),
    })
  } catch {
    return null
  }
}
