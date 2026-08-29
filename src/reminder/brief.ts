// YOLO daily briefs (v0.3.0 D) — morning/evening notification cards.
// Facts are gathered deterministically from storage; one optional LLM call
// (same provider/model wiring as extraction, off-peak friendly) polishes them
// into a short markdown card body. Every failure falls back to the plain
// fact list — a brief must never fail to appear because the model call did.

import { BlockAssembler, type LlmRuntime, type Message } from '@deepseek-ai/dsh-llm'
import type Yolo from '../storage/index.ts'
import type { Todo, TimelineEvent } from '../storage/types.ts'
import { contentBlocksToText, dayBounds } from '../shared/text.ts'
import { compareDueAt, dueAtLocalDate, isTodoOverdue } from '../shared/due.ts'

export type BriefKind = 'morning' | 'evening'

const DAY_MS = 86_400_000

const isOpen = (t: Todo): boolean => t.status === 'pending' || t.status === 'in_progress'
const nowForDay = (today: string): Date => {
  const now = new Date()
  return dueAtLocalDate(now.toISOString()) === today ? now : new Date(`${today}T12:00:00`)
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

/** Keep a brief scannable without hiding the fact that more items exist. */
function compactTitles(todos: readonly Todo[], limit = 3): string {
  const shown = todos.slice(0, limit).map((todo) => todo.title).join('、')
  const rest = todos.length - Math.min(todos.length, limit)
  return rest > 0 ? `${shown}（另有 ${rest} 件）` : shown
}

function comparePriority(a: Todo, b: Todo): number {
  return (PRIORITY_RANK[a.priority ?? 'medium'] ?? 2) - (PRIORITY_RANK[b.priority ?? 'medium'] ?? 2)
}

function compareActionable(a: Todo, b: Todo, today: string, now: Date): number {
  const overdueDiff = Number(isTodoOverdue(a.due_at, a.status, now)) - Number(isTodoOverdue(b.due_at, b.status, now))
  if (overdueDiff !== 0) return -overdueDiff
  const dueTodayDiff = Number(dueAtLocalDate(a.due_at) === today) - Number(dueAtLocalDate(b.due_at) === today)
  if (dueTodayDiff !== 0) return -dueTodayDiff
  const priorityDiff = comparePriority(a, b)
  if (priorityDiff !== 0) return priorityDiff
  return compareDueAt(a.due_at, b.due_at)
}

function uniqueCwds(cwds: readonly string[]): string[] {
  return [...new Set(cwds.filter(Boolean))]
}

/** Morning brief facts: first decision + due today + overdue + recent changes. */
export function collectMorningFacts(yolo: Yolo, cwd: string, today: string, now = nowForDay(today)): string[] {
  return collectMorningFactsAcross(yolo, [cwd], today, now)
}

/** Aggregate morning facts across the same workspace set rendered by the
 * assistant dashboard. A daily brief is a product-level digest, not one card
 * per backing SQLite store. */
export function collectMorningFactsAcross(
  yolo: Yolo,
  cwds: readonly string[],
  today: string,
  now = nowForDay(today),
): string[] {
  const targets = uniqueCwds(cwds)
  const todos = targets.flatMap((cwd) => yolo.listTodos(cwd)).filter(isOpen)
  const dueToday = todos.filter((t) => dueAtLocalDate(t.due_at) === today)
  const overdue = todos.filter((t) => isTodoOverdue(t.due_at, t.status, now))
  const yStart = dayBounds(today).from - DAY_MS
  const leftovers = todos.filter(
    (t) => t.created_at >= yStart && t.created_at < yStart + DAY_MS && dueAtLocalDate(t.due_at) !== today,
  )
  const goalMoves = targets
    .flatMap((cwd) => yolo.listEventsBetween(cwd, yStart, yStart + DAY_MS))
    .filter((e) => e.kind === 'goal_progress' || e.kind === 'milestone_status')

  const facts: string[] = []
  const actionable = [...new Set([...overdue, ...dueToday])].sort((a, b) => compareActionable(a, b, today, now))
  const first = actionable[0]
  facts.push(
    first
      ? `优先处理：${first.title}（${isTodoOverdue(first.due_at, first.status, now) ? '已逾期' : '今天到期'}）`
      : '优先处理：今天没有明确到期事项',
  )
  facts.push(dueToday.length ? `今日到期 ${dueToday.length} 件：${compactTitles(dueToday)}` : '今日到期：无')
  facts.push(overdue.length ? `逾期 ${overdue.length} 件：${compactTitles(overdue)}` : '逾期：无')
  facts.push(leftovers.length ? `昨日新增未完成 ${leftovers.length} 件：${compactTitles(leftovers)}` : '昨日新增未完成：无')
  facts.push(
    goalMoves.length
      ? `目标进展 ${goalMoves.length} 条：${goalMoves.slice(0, 3).map((e) => e.summary).join('；')}${goalMoves.length > 3 ? `（另有 ${goalMoves.length - 3} 条）` : ''}`
      : '目标进展：无变化',
  )
  return facts
}

/** Evening brief facts: completed + newly recorded + carry-over + tomorrow. */
export function collectEveningFacts(yolo: Yolo, cwd: string, today: string): string[] {
  return collectEveningFactsAcross(yolo, [cwd], today)
}

/** Aggregate evening facts across all known workspaces into one digest. */
export function collectEveningFactsAcross(yolo: Yolo, cwds: readonly string[], today: string): string[] {
  const targets = uniqueCwds(cwds)
  const { from, to } = dayBounds(today)
  const events: TimelineEvent[] = targets.flatMap((cwd) => yolo.listEventsBetween(cwd, from, to))
  const done = events.filter((e) => e.kind === 'todo_completed')
  const added = events.filter((e) => e.kind === 'todo_created')
  const open = targets.flatMap((cwd) => yolo.listTodos(cwd)).filter(isOpen)
  const overdue = open.filter((todo) => isTodoOverdue(todo.due_at, todo.status, nowForDay(today)))
  const next = open
    .filter((t) => t.due_at && (dueAtLocalDate(t.due_at) ?? '') > today)
    .sort((a, b) => compareDueAt(a.due_at, b.due_at))
    .slice(0, 3)

  const facts: string[] = []
  facts.push(done.length ? `今日完成 ${done.length} 件：${done.slice(0, 3).map((e) => e.summary.replace(/^完成：/, '')).join('、')}${done.length > 3 ? `（另有 ${done.length - 3} 件）` : ''}` : '今日完成：无')
  facts.push(added.length ? `今日新增 ${added.length} 件：${added.slice(0, 3).map((e) => e.summary.replace(/^＋ (记录新待办|快速记一条)/, '')).join('、')}${added.length > 3 ? `（另有 ${added.length - 3} 件）` : ''}` : '今日新增：无')
  facts.push(
    open.length
      ? `未完成 ${open.length} 件${overdue.length ? `，其中逾期 ${overdue.length} 件` : ''}`
      : '没有挂着的事',
  )
  facts.push(next.length ? `明日优先：${next.map((t) => `${t.title}（${dueAtLocalDate(t.due_at) ?? t.due_at}）`).join('、')}` : '明日优先：暂无明确安排')
  return facts
}

/** Plain markdown fallback — always renderable, no model needed (TD-6).
 * The card already renders its title, so the body contains facts only. */
export function renderBriefMarkdown(kind: BriefKind, facts: readonly string[], today: string): string {
  void kind
  void today
  return facts.map((f) => `- ${f}`).join('\n')
}

/** One polish call; any failure returns the deterministic markdown unchanged. */
export async function polishBrief(
  llm: LlmRuntime | undefined,
  provider: string,
  model: string,
  kind: BriefKind,
  facts: readonly string[],
  fallback: string,
): Promise<string> {
  if (!llm) return fallback
  try {
    const stream = llm.stream({
      provider,
      model,
      system: `你是个人助理 YOLO 的简报撰写器。把给定事实整理成一份${kind === 'morning' ? '早晨开工' : '晚间收工'}简报：中文，markdown，不超过 6 行，只陈述事实、不编造、不加建议，不要重复卡片标题，直接从最重要的事实开始。`,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: facts.join('\n') }],
        },
      ] as Message[],
      temperature: 0.3,
      maxTokens: 512,
      purpose: 'session-title',
    })
    const assembler = new BlockAssembler()
    for await (const chunk of stream) {
      assembler.push(chunk)
    }
    const text = contentBlocksToText(assembler.blocks()).trim()
    return text || fallback
  } catch {
    return fallback
  }
}
