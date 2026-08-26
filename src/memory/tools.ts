// YOLO memory tools — model-visible access to the memory store.
// Registered on ctx.tools via dsh's defineTool DSL (M1; host-verified at M2/M3).

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type Yolo from '../storage/index.ts'
import type { MilestoneStatus, Priority, RowType, TodoStatus, GoalStatus } from '../storage/types.ts'
import { applyYoloAction } from '../shared/actions.ts'
import { sessionCwd, sessionId } from '../shared/session.ts'

/** Context augmented with the yolo service (register via inject ['yolo']). */
export interface YoloContext extends Context {
  yolo: Yolo
}

/** The calling agent's session, when the host attached one to this execution. */
function execSession(exec: unknown): unknown {
  return (exec as { agent?: { session?: unknown } } | undefined)?.agent?.session
}

/**
 * Resolve the cwd used for scope partitioning: the calling agent's session
 * workspace when the host attached one, else the host process cwd.
 */
const cwdOfExec = (exec: unknown): string => sessionCwd(execSession(exec)) ?? process.cwd()

/**
 * JSON-roundtrip a value so it satisfies the output.schema constraint.
 * NOTE: every tool's output.schema is `{ type: 'object' }` — the host validates
 * execute results against it and throws ToolOutputError on mismatch, so list
 * results must always be wrapped (e.g. `{ rows: [...] }`), never returned bare.
 */
const json = (v: unknown): Record<string, JsonValue> => JSON.parse(JSON.stringify(v)) as Record<string, JsonValue>

export function registerYoloTools(ctx: YoloContext): void {
  const y = ctx.yolo

  ctx.tools.register(
    defineTool({
      name: 'memory_search',
      description: 'Search the YOLO personal memory store: todos, milestones, goals, preferences and timeline events, with full-text matching. CJK: use >= 3 chars for best recall.',
      parameters: {
        query: { type: 'string', required: true, description: 'Search keywords.' },
        topK: { type: 'integer', description: 'Max results (default 5).' },
        kinds: { type: 'array', items: { type: 'string' }, description: 'Optional row-kind filter: todo|milestone|goal|preference|event.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
      },
      async execute(args, exec) {
        return json({ hits: y.search(cwdOfExec(exec), args.query ?? '', args.topK ?? 5, (args.kinds as RowType[] | undefined) ?? undefined) })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_write',
      description: 'Write a memory item into YOLO for TRACKING: a commitment (todo), plan (milestone/goal) or tracking rule (preference). Use when the user asks YOLO to remember/track something so it can remind and manage it. This is NOT a general diary — do not store facts, knowledge, or personal taste.',
      parameters: {
        kind: { type: 'string', required: true, description: 'todo|milestone|goal|preference|event' },
        title: { type: 'string', required: true, description: 'Item title / summary text.' },
        detail: { type: 'string', description: 'Optional detail (todos/milestones/goals/events).' },
        due_at: { type: 'string', description: 'ISO8601 due datetime for todos. Resolve relative dates from the authoritative current local clock in the YOLO system instructions, never from old conversation history.' },
        target_date: { type: 'string', description: 'YYYY-MM-DD target date for milestones.' },
        priority: { type: 'string', description: 'low|medium|high|urgent for todos.' },
        key: { type: 'string', description: 'Preference key: a tracking rule slug (e.g. reminder-ahead, working-hours).' },
        value: { type: 'string', description: 'Preference value (kind=preference): the tracking rule itself.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }],
      },
      async execute(args, exec) {
        const cwd = cwdOfExec(exec)
        switch (args.kind) {
          case 'todo': {
            const originSessionId = sessionId(execSession(exec))
            const { todo } = y.addTodo(cwd, {
              title: args.title,
              detail: args.detail,
              due_at: args.due_at,
              priority: (args.priority ?? undefined) as Priority | undefined,
              source: 'tool',
              session_id: originSessionId,
            })
            return json(todo)
          }
          case 'milestone':
            return json(y.addMilestone(cwd, { title: args.title, target_date: args.target_date, description: args.detail, source: 'tool' }))
          case 'goal':
            return json(y.addGoal(cwd, { title: args.title, description: args.detail }))
          case 'preference':
            return json(y.addPreference(cwd, { key: args.key ?? args.title, value: args.value ?? args.detail ?? '' }))
          case 'event':
            return json(y.addEvent(cwd, { kind: 'note', summary: args.title, detail: args.detail }))
          default:
            throw new Error(`unknown memory kind: ${String(args.kind)}`)
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_forget',
      description:
        'Soft-delete a memory item by id, routed through the audited YOLO action path: todo -> cancelled, milestone -> abandoned, goal -> abandoned (giving up the goal, not just clearing progress). Writes a timeline audit event; removes the item from search.',
      parameters: {
        kind: { type: 'string', required: true, description: 'todo|milestone|goal' },
        id: { type: 'string', required: true, description: 'Item id.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }],
      },
      async execute(args, exec) {
        const cwd = cwdOfExec(exec)
        // M9 P34: forget must land on the same audited domain actions as every
        // other entrance — bare setXxxStatus calls bypassed the event ledger.
        const session_id = sessionId(execSession(exec))
        if (args.kind === 'todo') {
          return json(applyYoloAction(y, cwd, { action: 'cancel', kind: 'todo', id: args.id, session_id }))
        }
        if (args.kind === 'milestone') {
          return json(applyYoloAction(y, cwd, { action: 'set_status', kind: 'milestone', id: args.id, status: 'abandoned', session_id }))
        }
        if (args.kind === 'goal') {
          return json(applyYoloAction(y, cwd, { action: 'abandon', kind: 'goal', id: args.id, session_id }))
        }
        return json({ ok: false, error: 'unsupported kind' })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'yolo_action',
      description:
        'Apply an action to a tracked YOLO plan item — this is how you honor the user\'s replies to YOLO reminders (已完成 / 推迟到明天 / 再提醒一次) and plan updates. ' +
        'Actions: todo → complete|start|cancel|postpone(requires due_at)|remind_again|consolidate(requires into_id|into_title — merges a duplicate into the keeper todo); goal → set_progress(requires progress); milestone → set_status(requires status). ' +
        'Pass the item id when known (YOLO reminder messages include it); otherwise title works via fuzzy match.',
      parameters: {
        action: { type: 'string', required: true, description: 'complete|start|cancel|postpone|remind_again|consolidate|set_progress|set_status' },
        kind: { type: 'string', required: true, description: 'todo|goal|milestone' },
        id: { type: 'string', description: 'Item id (preferred — YOLO reminders carry it).' },
        title: { type: 'string', description: 'Item title for fuzzy matching when id is unknown.' },
        into_id: { type: 'string', description: 'Consolidate only: id of the surviving target todo that absorbs the source.' },
        into_title: { type: 'string', description: 'Consolidate only: title of the surviving target todo (fuzzy match).' },
        due_at: { type: 'string', description: 'New absolute date YYYY-MM-DD (action=postpone).' },
        progress: { type: 'integer', description: 'Goal progress 0-100 (action=set_progress).' },
        status: { type: 'string', description: 'Milestone status planned|active|done|abandoned (action=set_status).' },
        note: { type: 'string', description: 'Optional note recorded on the timeline event.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }],
      },
      async execute(args, exec) {
        // shared validation + dispatch (same path as POST /yolo_actions);
        // the calling session is stamped on the audit event for traceability
        return json(applyYoloAction(y, cwdOfExec(exec), {
          action: args.action,
          kind: args.kind,
          id: args.id,
          title: args.title,
          into_id: args.into_id,
          into_title: args.into_title,
          due_at: args.due_at,
          progress: args.progress,
          status: args.status,
          note: args.note,
          session_id: sessionId(execSession(exec)),
        }))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'yolo_query',
      description: 'Query a YOLO dashboard view for the current workspace: timeline, todos, goals, milestones or preferences.',
      parameters: {
        view: { type: 'string', required: true, description: 'timeline|todos|goals|milestones|preferences' },
        status: { type: 'string', description: 'Optional status filter (todo: pending|in_progress|done|cancelled; goal: active|achieved; milestone: planned|active|done).' },
        limit: { type: 'integer', description: 'Max rows (default 50).' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
      },
      async execute(args, exec) {
        const cwd = cwdOfExec(exec)
        switch (args.view) {
          case 'timeline':
            return json({ rows: y.listEvents(cwd, args.limit ?? 50) })
          case 'todos':
            return json({ rows: y.listTodos(cwd, (args.status ?? undefined) as TodoStatus | undefined) })
          case 'goals':
            return json({ rows: y.listGoals(cwd, (args.status ?? undefined) as GoalStatus | undefined) })
          case 'milestones':
            return json({ rows: y.listMilestones(cwd, (args.status ?? undefined) as MilestoneStatus | undefined) })
          case 'preferences':
            return json({ rows: y.listPreferences(cwd) })
          default:
            throw new Error(`unknown view: ${String(args.view)}`)
        }
      },
    }),
  )
}
