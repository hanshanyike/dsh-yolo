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
import { compareDueAt, isDueAtReached } from '../shared/due.ts'
import { isTodoOpen } from '../shared/dashboard.ts'
import { collectMorningFactsAcross, collectEveningFactsAcross, polishBrief, renderBriefMarkdown, type BriefKind } from './brief.ts'

/**
 * Delivery into the YOLO resident thread (best effort — the card is the
 * guaranteed surface, the followup only enriches the chat view).
 */
export type YoloDeliver = (cwd: string, text: string) => Promise<void>

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

/** True when a "HH:MM" clock time is inside a quiet window that may wrap
 *  midnight (e.g. 22:00–08:00). Used to defer reminders outside the user's
 *  active hours — the "绝不打扰" red line, engineering it in. */
export function inQuietWindow(hm: string, start: string, end: string): boolean {
  if (!start || !end || start === end) return false
  if (start <= end) return hm >= start && hm < end // same-day, e.g. 12:00–14:00
  return hm >= start || hm < end // wraps midnight, e.g. 22:00–08:00
}

/** Quiet-hours config consumed by a reminder pass. */
export interface QuietHours {
  enabled: boolean
  start: string
  end: string
  now?: () => Date
}

/** One reminder pass — pure enough to unit test with a mocked yolo. */
export function runReminderTick(deps: {
  yolo: Yolo
  cwd: () => string
  aheadMs: number
  now?: () => Date
  quiet?: QuietHours
  deliver?: YoloDeliver
}): TickResult {
  const cwd = deps.cwd()
  const now = deps.now?.() ?? new Date()
  const due = deps.yolo.listTodos(cwd)
    .filter((todo) => isTodoOpen(todo.status) && todo.last_reminded_at == null && isDueAtReached(todo.due_at, now, deps.aheadMs))
    .sort((a, b) => compareDueAt(a.due_at, b.due_at))

  // Outside the user's active hours, hold the reminder (do NOT mark it
  // reminded) so it fires on the first tick after the window — the promise
  // "到点就提醒" is kept without ever pinging at an inappropriate time.
  const q = deps.quiet
  const quietNow = deps.quiet ? localHm(q!.now?.() ?? now) : ''
  const hold = !!q?.enabled && inQuietWindow(quietNow, q!.start, q!.end)

  let notified = 0
  for (const t of due) {
    if (hold) continue
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
  /** Workspaces represented by this one product-level brief. The notification
   * is stored in `cwd()`, while facts and daily stamps cover this whole set. */
  workspaces?: readonly string[]
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
  const ownerCwd = deps.cwd()
  const cwds = [...new Set((deps.workspaces?.length ? deps.workspaces : [ownerCwd]).filter(Boolean))]
  const plan: { kind: BriefKind; time: string }[] = [
    { kind: 'morning', time: deps.config.morningTime },
    { kind: 'evening', time: deps.config.eveningTime },
  ]
  for (const { kind, time } of plan) {
    if (hm < time) continue
    // v0.3.1: the dashboard aggregates workspaces, therefore the brief is one
    // aggregate card. A stamp in any member is enough to recognize a legacy or
    // already-generated card; successful generation stamps every member so a
    // later change of the active workspace cannot generate a duplicate.
    if (cwds.some((cwd) => deps.yolo.getBriefStamp(cwd, kind) === today)) continue
    const facts =
      kind === 'morning'
        ? collectMorningFactsAcross(deps.yolo, cwds, today, now)
        : collectEveningFactsAcross(deps.yolo, cwds, today)
    const fallback = renderBriefMarkdown(kind, facts, today)
    const body = deps.llm
      ? await polishBrief(deps.llm, deps.provider ?? 'deepseek', deps.config.model, kind, facts, fallback)
      : fallback
    deps.yolo.addNotification(ownerCwd, {
      kind: 'brief',
      title: kind === 'morning' ? `早报 · ${today}` : `晚报 · ${today}`,
      body,
      scope_cwd: ownerCwd,
    })
    deps.yolo.addEvent(ownerCwd, {
      kind: 'brief_generated',
      summary: kind === 'morning' ? `生成早报（${today}）` : `生成晚报（${today}）`,
      source: 'tool',
    })
    for (const cwd of cwds) deps.yolo.setBriefStamp(cwd, kind, today)
    result[kind] = true
  }
  return result
}

/** Scheduler-facing view of the settings `reminder` section, normalized. */
export interface ReminderRuntime {
  intervalMs: number
  aheadMs: number
  enabled: boolean
}

/**
 * Normalize the settings `reminder` section; missing or invalid fields fall
 * back to DEFAULTS so a hand-edited settings file cannot stall the scheduler.
 *
 * `aheadMin` semantics: how many minutes BEFORE the due time a todo is
 * considered "due for a reminder" (a lead window). `0` (the default) means
 * "fire at/after the due time" — the promise is *到点就触发*. Any positive value
 * opts into an early lead reminder (e.g. 60 = remind as soon as we are within
 * an hour of the due time). It never short-circuits an imminent relative
 * reminder such as "5 分钟后提醒我" unless the user explicitly raised it.
 */
export function resolveReminderRuntime(
  rem?: { checkIntervalSec?: number; aheadMin?: number; enabled?: boolean },
): ReminderRuntime {
  const intervalSec =
    typeof rem?.checkIntervalSec === 'number' && rem.checkIntervalSec > 0
      ? rem.checkIntervalSec
      : DEFAULTS.reminderCheckIntervalSec
  const aheadMin =
    typeof rem?.aheadMin === 'number' && rem.aheadMin >= 0 ? rem.aheadMin : DEFAULTS.reminderAheadMin
  return { intervalMs: intervalSec * 1000, aheadMs: aheadMin * 60_000, enabled: rem?.enabled !== false }
}

export interface SchedulerDeps {
  yolo: Yolo
  cwd: () => string
  deliver?: YoloDeliver
  intervalMs?: number
  /** Read fresh each tick so Settings edits land without a plugin reload.
   * Lead window in ms; the default 0 fires at/after the due time (到点就触发). */
  aheadMs?: () => number
  /** Reminder kill-switch (default true) — false idles only the due scan. */
  reminderEnabled?: () => boolean
  /** Daily snapshot cadence gate, read fresh each tick. */
  dailySnapshotsEnabled?: () => boolean
  /** Quiet-hours gate: read fresh each tick so edits apply without a reload. */
  quiet?: () => QuietHours
  /** Every known workspace to scan each tick (v0.3.3 review fix). The board
   * aggregates ALL workspaces, so reminders/briefs/snapshots must too —
   * scanning only the latest cwd silently dropped due todos everywhere else.
   * Read fresh each tick; defaults to [{ cwd }] when absent or empty. */
  workspaces?: () => ReadonlyArray<{ cwd: string }>
  briefs?: {
    config: () => BriefConfig
    llm?: LlmRuntime
    provider?: string
  }
}

/** Per-tick scan targets: every known workspace, falling back to the single
 * tracked cwd (the shape all pre-existing single-workspace callers get). */
function targetsOf(deps: SchedulerDeps): ReadonlyArray<{ cwd: string }> {
  const ws = deps.workspaces?.() ?? []
  const candidates = ws.length > 0 ? ws : [{ cwd: deps.cwd() }]
  const seen = new Set<string>()
  return candidates.filter(({ cwd }) => {
    const key = process.platform === 'win32' ? cwd.toLowerCase() : cwd
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Create the scheduler (reminder tick + brief tick); returns a cleanup function. */
export function startReminderScheduler(ctx: Context, deps: SchedulerDeps): () => void {
  const intervalMs = deps.intervalMs ?? DEFAULTS.reminderCheckIntervalSec * 1000
  const aheadMs = (): number => deps.aheadMs?.() ?? DEFAULTS.reminderAheadMin * 60_000

  const tick = (): void => {
    // One failing workspace (corrupt/locked DB) must not block the others.
    for (const t of targetsOf(deps)) {
      try {
        // reminder.enabled=false idles ONLY the due scan; snapshots keep their cadence
        if (deps.reminderEnabled?.() ?? true) {
          runReminderTick({
            yolo: deps.yolo,
            cwd: () => t.cwd,
            aheadMs: aheadMs(),
            quiet: deps.quiet?.(),
            deliver: deps.deliver,
          })
        }
        if (deps.dailySnapshotsEnabled?.() ?? true) maybeWriteDailySnapshot(deps.yolo, () => t.cwd)
      } catch (e) {
        ctx.logger?.warn?.('[yolo-reminder] tick failed (%s): %s', t.cwd, e instanceof Error ? e.message : String(e))
      }
    }
  }

  // Briefs are product-level aggregates. Running once per workspace creates
  // duplicate morning/evening cards because the dashboard merges all stores.
  const briefTick = (): void => {
    if (!deps.briefs) return
    const targets = targetsOf(deps)
    const tracked = deps.cwd()
    // Before the first work session, `cwd()` falls back to the host process
    // directory, which need not be a registered workspace. Never open a ghost
    // store merely to own the aggregate card: prefer the tracked workspace only
    // when it is one of the scan targets, otherwise use the first real target.
    const owner = targets.find((target) => (
      process.platform === 'win32'
        ? target.cwd.toLowerCase() === tracked.toLowerCase()
        : target.cwd === tracked
    ))?.cwd ?? targets[0]!.cwd
    void runBriefTick({
      yolo: deps.yolo,
      cwd: () => owner,
      workspaces: targets.map((target) => target.cwd),
      config: deps.briefs.config(),
      llm: deps.briefs.llm,
      provider: deps.briefs.provider,
    }).catch((e: unknown) => {
      ctx.logger?.warn?.('[yolo-brief] tick failed (%s): %s', owner, e instanceof Error ? e.message : String(e))
    })
  }

  const timer = setInterval(tick, intervalMs)
  const briefTimer = deps.briefs ? setInterval(briefTick, DEFAULTS.briefCheckIntervalSec * 1000) : undefined
  return () => {
    clearInterval(timer)
    if (briefTimer) clearInterval(briefTimer)
  }
}
