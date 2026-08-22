// YOLO reminder scheduler — time-triggered proactive delivery (v0.3.0 B).
// Due todos produce a NOTIFICATION CARD in storage (badge + kanban card) and,
// when a YOLO resident agent is available, a followup into that thread.
// WORK SESSIONS ARE NEVER TOUCHED (D7 / TB-1): the old latest-agent injection
// and the session-start replay were removed; pending_reminders stays in the
// schema for compatibility but nothing feeds it anymore.
// v0.3.0 D adds the brief tick: morning/evening cards, once per local day.

import type { Context } from '@deepseek-ai/cordis'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type Yolo from '../storage/index.ts'
import { DEFAULTS } from '../shared/constants.ts'
import { localDateStr, localHm } from '../shared/text.ts'
import { collectMorningFacts, collectEveningFacts, polishBrief, renderBriefMarkdown, type BriefKind } from './brief.ts'

/**
 * Delivery into the YOLO resident thread (best effort — the card is the
 * guaranteed surface, the followup only enriches the chat view).
 */
export type YoloDeliver = (cwd: string, text: string) => Promise<void>

/** Format a Date as local-time "YYYY-MM-DDTHH:mm:ss" (no timezone suffix). */
function localIso(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * Reminder text delivered into the YOLO thread. Human-readable ONLY — this
 * message is visible in the resident thread's history (对话 Tab / 侧栏对话),
 * so agent-facing handling rules live in the yolo-instructions system section
 * (memory/recall.ts) instead of being pasted into the chat.
 */
export function reminderText(title: string, dueAt?: string | null): string {
  return `⏰ YOLO 提醒：${title}${dueAt ? `（到期 ${dueAt}）` : ''}`
}

/** Write today's Markdown snapshot once per calendar day. Returns the path or null. */
export function maybeWriteDailySnapshot(yolo: Yolo, cwd: () => string): string | null {
  const today = localDateStr()
  if (yolo.lastSnapshotDate(cwd()) === today) return null
  const path = yolo.writeSnapshot(cwd(), today)
  yolo.setSnapshotDate(cwd(), today)
  return path
}

/**
 * Write a timestamped Markdown snapshot on a turn cadence ('every_10_turns').
 * The caller counts turns; this fires once per N turns with a unique filename.
 * Returns the path or null when the cadence has not been reached.
 */
export function maybeWriteTurnSnapshot(yolo: Yolo, cwd: () => string, turnCount: number, every = 10): string | null {
  if (turnCount <= 0 || turnCount % every !== 0) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return yolo.writeSnapshot(cwd(), `turn-${turnCount}-${stamp}`)
}

export interface TickResult {
  /** Due todos that produced a notification card this pass. */
  notified: number
}

/** One reminder pass — pure enough to unit test with a mocked yolo. */
export function runReminderTick(deps: {
  yolo: Yolo
  cwd: () => string
  aheadMs: number
  deliver?: YoloDeliver
}): TickResult {
  const cwd = deps.cwd()
  // due_at is stored either as a local date (YYYY-MM-DD, from rule capture) or a
  // full ISO datetime. Compare in LOCAL time so a date-only due date fires from
  // local midnight — toISOString() would lag by the UTC offset (up to 8h in UTC+8).
  const aheadIso = localIso(new Date(Date.now() + deps.aheadMs))
  const due = deps.yolo.listDueTodos(cwd, aheadIso)

  let notified = 0
  for (const t of due) {
    const text = reminderText(t.title, t.due_at)
    deps.yolo.addNotification(cwd, {
      kind: 'reminder',
      title: `⏰ ${t.title}`,
      body: t.due_at ? `到期 ${t.due_at}` : null,
      todo_id: t.id,
      scope_cwd: cwd,
    })
    deps.yolo.addEvent(cwd, {
      kind: 'reminder_fired',
      summary: `⏰ 提醒「${t.title}」`,
      detail: t.due_at ? `到期 ${t.due_at}` : null,
      source: 'tool',
    })
    if (deps.deliver) {
      void deps
        .deliver(cwd, text)
        .catch(() => {}) // the card is the guaranteed surface; chat delivery is best effort
    }
    deps.yolo.setTodoReminded(cwd, t.id)
    notified++
  }
  return { notified }
}

export interface BriefConfig {
  enabled: boolean
  morningTime: string
  eveningTime: string
  model: string
}

export interface BriefTickResult {
  morning: boolean
  evening: boolean
}

/** One brief pass: fire each due brief once per local day (v0.3.0 D).
 * A brief whose time already passed fires on the next tick (catch-up). */
export async function runBriefTick(deps: {
  yolo: Yolo
  cwd: () => string
  config: BriefConfig
  llm?: LlmRuntime
  provider?: string
  now?: () => Date
}): Promise<BriefTickResult> {
  const result: BriefTickResult = { morning: false, evening: false }
  if (!deps.config.enabled) return result
  const now = deps.now?.() ?? new Date()
  const hm = localHm(now)
  const today = localDateStr(now)
  const plan: { kind: BriefKind; time: string }[] = [
    { kind: 'morning', time: deps.config.morningTime },
    { kind: 'evening', time: deps.config.eveningTime },
  ]
  for (const { kind, time } of plan) {
    if (hm < time) continue
    const cwd = deps.cwd()
    if (deps.yolo.getBriefStamp(cwd, kind) === today) continue
    const facts =
      kind === 'morning' ? collectMorningFacts(deps.yolo, cwd, today) : collectEveningFacts(deps.yolo, cwd, today)
    const fallback = renderBriefMarkdown(kind, facts, today)
    const body = deps.llm
      ? await polishBrief(deps.llm, deps.provider ?? 'deepseek', deps.config.model, kind, facts, fallback)
      : fallback
    deps.yolo.addNotification(cwd, {
      kind: 'brief',
      title: kind === 'morning' ? `☀ 早报 · ${today}` : `🌙 晚报 · ${today}`,
      body,
      scope_cwd: cwd,
    })
    deps.yolo.addEvent(cwd, {
      kind: 'brief_generated',
      summary: kind === 'morning' ? `☀ 生成早报（${today}）` : `🌙 生成晚报（${today}）`,
      source: 'tool',
    })
    deps.yolo.setBriefStamp(cwd, kind, today)
    result[kind] = true
  }
  return result
}

export interface SchedulerDeps {
  yolo: Yolo
  cwd: () => string
  deliver?: YoloDeliver
  intervalMs?: number
  aheadMs?: number
  briefs?: {
    config: () => BriefConfig
    llm?: LlmRuntime
    provider?: string
  }
}

/** Create the scheduler (reminder tick + brief tick); returns a cleanup function. */
export function startReminderScheduler(ctx: Context, deps: SchedulerDeps): () => void {
  const intervalMs = deps.intervalMs ?? DEFAULTS.reminderCheckIntervalSec * 1000
  const aheadMs = deps.aheadMs ?? DEFAULTS.reminderAheadMin * 60_000

  const tick = (): void => {
    try {
      runReminderTick({ yolo: deps.yolo, cwd: deps.cwd, aheadMs, deliver: deps.deliver })
      maybeWriteDailySnapshot(deps.yolo, deps.cwd)
    } catch (e) {
      ctx.logger?.warn?.('[yolo-reminder] tick failed: %s', e instanceof Error ? e.message : String(e))
    }
  }

  // briefs run on a tighter loop so a configured minute lands on time (TD-1)
  const briefTick = (): void => {
    if (!deps.briefs) return
    void runBriefTick({
      yolo: deps.yolo,
      cwd: deps.cwd,
      config: deps.briefs.config(),
      llm: deps.briefs.llm,
      provider: deps.briefs.provider,
    }).catch((e: unknown) => {
      ctx.logger?.warn?.('[yolo-brief] tick failed: %s', e instanceof Error ? e.message : String(e))
    })
  }

  const timer = setInterval(tick, intervalMs)
  const briefTimer = deps.briefs ? setInterval(briefTick, DEFAULTS.briefCheckIntervalSec * 1000) : undefined
  return () => {
    clearInterval(timer)
    if (briefTimer) clearInterval(briefTimer)
  }
}
