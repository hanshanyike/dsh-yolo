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
/** Morning brief facts (4.4): due today + overdue + yesterday leftovers + goal moves. */
export function collectMorningFacts(yolo: Yolo, cwd: string, today: string, now = nowForDay(today)): string[] {
  const todos = yolo.listTodos(cwd).filter(isOpen)
  const dueToday = todos.filter((t) => dueAtLocalDate(t.due_at) === today)
  const overdue = todos.filter((t) => isTodoOverdue(t.due_at, t.status, now))
  const yStart = dayBounds(today).from - DAY_MS
  const leftovers = todos.filter(
    (t) => t.created_at >= yStart && t.created_at < yStart + DAY_MS && dueAtLocalDate(t.due_at) !== today,
  )
  const goalMoves = yolo
    .listEventsBetween(cwd, yStart, yStart + DAY_MS)
    .filter((e) => e.kind === 'goal_progress' || e.kind === 'milestone_status')

  const facts: string[] = []
  facts.push(dueToday.length ? `今日到期 ${dueToday.length} 件：${dueToday.map((t) => t.title).join('、')}` : '今日到期：无')
  facts.push(overdue.length ? `逾期 ${overdue.length} 件：${overdue.map((t) => t.title).join('、')}` : '逾期：无')
  facts.push(leftovers.length ? `昨日遗留 ${leftovers.length} 件：${leftovers.map((t) => t.title).join('、')}` : '昨日遗留：无')
  facts.push(
    goalMoves.length
      ? `目标进展 ${goalMoves.length} 条：${goalMoves.map((e) => e.summary).join('；')}`
      : '目标进展：无变化',
  )
  return facts
}

/** Evening brief facts (4.4): done today + newly recorded + still hanging. */
export function collectEveningFacts(yolo: Yolo, cwd: string, today: string): string[] {
  const { from, to } = dayBounds(today)
  const events: TimelineEvent[] = yolo.listEventsBetween(cwd, from, to)
  const done = events.filter((e) => e.kind === 'todo_completed')
  const added = events.filter((e) => e.kind === 'todo_created')
  const open = yolo.listTodos(cwd).filter(isOpen)
  const next = open
    .filter((t) => t.due_at)
    .sort((a, b) => compareDueAt(a.due_at, b.due_at))
    .slice(0, 3)

  const facts: string[] = []
  facts.push(done.length ? `今日完成 ${done.length} 件：${done.map((e) => e.summary.replace(/^完成：/, '')).join('、')}` : '今日完成：无')
  facts.push(added.length ? `新增记录 ${added.length} 件：${added.map((e) => e.summary.replace(/^＋ (记录新待办|快速记一条)/, '')).join('、')}` : '新增记录：无')
  facts.push(
    open.length
      ? `还挂着 ${open.length} 件` + (next.length ? `，最近的：${next.map((t) => `${t.title}（${dueAtLocalDate(t.due_at) ?? t.due_at}）`).join('、')}` : '')
      : '没有挂着的事',
  )
  return facts
}

/** Plain markdown fallback — always renderable, no model needed (TD-6). */
export function renderBriefMarkdown(kind: BriefKind, facts: readonly string[], today: string): string {
  const head = kind === 'morning' ? `早报 · ${today}` : `晚报 · ${today}`
  return [head, '', ...facts.map((f) => `- ${f}`)].join('\n')
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
      system: `你是个人助理 YOLO 的简报撰写器。把给定事实整理成一份${kind === 'morning' ? '早晨开工' : '晚间收工'}简报：中文，markdown，不超过 6 行，只陈述事实、不编造、不加建议，开头一行标题。`,
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
