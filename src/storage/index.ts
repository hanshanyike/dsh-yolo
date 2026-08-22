// YOLO storage service — the single source of truth, exposed as `ctx.yolo`.
//
// A Cordis Service (capability seam "Provider"): other plugins depend on it via
// `export const inject = ['yolo']` and call ctx.yolo.<method>(cwd, ...).
//
// Memory is partitioned by scope (workspace|user|global). Each scope has its own
// SQLite DB; we open lazily and cache per (mode+cwd).

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getMeta, openDb, setMeta, type DB } from './db.ts'
import { computeScopeKey, resolveDataDir, dbFileName } from './scope.ts'
import * as repo from './repository.ts'
import { ftsRecallSearch } from './search.ts'
import { renderSnapshot, writeSnapshot } from './snapshot.ts'
import type { DuplicateTodoPair } from './types.ts'
import type {
  Goal,
  GoalStatus,
  Milestone,
  MilestoneStatus,
  Notification,
  NotificationKind,
  PendingReminder,
  Preference,
  RowType,
  ScopeMode,
  SearchHit,
  SessionSummary,
  Source,
  TimelineEvent,
  Todo,
  TodoAction,
  TodoStatus,
  ExtractionLog,
  ExtractionStatus,
  RecallLog,
  ExtractionStrategy,
  EventKind,
  Priority,
} from './types.ts'

export interface ScopeHandle {
  db: DB
  scopeKey: string
  dataDir: string
}

// NOTE: dsh loader expects the plugin as the module's DEFAULT export
// (function, or object/class carrying an `apply` method). A bare named export
// makes the loader pass the module namespace object and fail with
// "invalid plugin, expect function or object with an apply method".
export default class Yolo extends Service {
  private scopes = new Map<string, ScopeHandle>()
  /** Workspace scopes the plugin has opened (cwd -> latest scopeKey) for cross-workspace aggregation. */
  private readonly knownWorkspaces = new Map<string, string>()

  constructor(ctx: Context) {
    super(ctx, 'yolo')
    // close cached DB handles when the owning fiber unloads (Windows-safe)
    ctx.effect(() => () => this.close())
  }

  /** Close every cached DB handle (idempotent). Called on dispose and in tests. */
  close(): void {
    for (const h of this.scopes.values()) {
      try {
        h.db.close()
      } catch {
        // already closed
      }
    }
    this.scopes.clear()
  }

  /** Resolve (and lazily open+cache) the DB handle for a scope. */
  resolve(cwd: string, mode: ScopeMode = 'workspace'): ScopeHandle {
    const scopeKey = computeScopeKey(cwd)
    const dataDir = resolveDataDir(mode, cwd)
    const dbPath = join(dataDir, dbFileName(scopeKey))
    let h = this.scopes.get(dbPath)
    if (!h) {
      mkdirSync(dataDir, { recursive: true })
      h = { db: openDb(dbPath), scopeKey, dataDir }
      this.scopes.set(dbPath, h)
      if (mode === 'workspace') this.knownWorkspaces.set(cwd, scopeKey)
    }
    return h
  }

  // ---- todos ----
  /** Upsert a todo; `created` tells the caller whether a new row landed
   * (drives the todo_created ledger event). */
  addTodo(
    cwd: string,
    data: { title: string; detail?: string | null; priority?: Priority | null; due_at?: string | null; milestone_id?: string | null; source?: Source; session_id?: string | null },
  ): { todo: Todo; created: boolean } {
    const h = this.resolve(cwd)
    const { row, created } = repo.upsertTodo(h.db, { ...data, scope_key: h.scopeKey })
    return { todo: row, created }
  }
  setTodoStatus(cwd: string, id: string, status: TodoStatus): void {
    repo.setTodoStatus(this.resolve(cwd).db, id, status)
  }
  listTodos(cwd: string, status?: TodoStatus): Todo[] {
    const h = this.resolve(cwd)
    return repo.listTodos(h.db, h.scopeKey, status)
  }
  listDueTodos(cwd: string, beforeIso: string): Todo[] {
    const h = this.resolve(cwd)
    return repo.listDueTodos(h.db, h.scopeKey, beforeIso)
  }
  setTodoReminded(cwd: string, id: string, ts?: number): void {
    repo.setTodoReminded(this.resolve(cwd).db, id, ts)
  }

  // ---- domain actions (M8 Organizer: state flow + event audit) ----
  // Shared entry point for extraction updates, the yolo_action tool and the
  // dashboard POST endpoint. `ref` prefers id, falls back to fuzzy title match.
  applyTodoAction(
    cwd: string,
    ref: { id?: string; title?: string },
    action: TodoAction,
    args?: { due_at?: string | null; session_id?: string | null },
  ): Todo | null {
    const h = this.resolve(cwd)
    const id = ref.id ?? (ref.title ? repo.findTodoByTitle(h.db, h.scopeKey, ref.title)?.id : undefined)
    if (!id) return null
    return repo.applyTodoAction(h.db, id, action, args)
  }
  /** Merge a duplicate todo into its keeper (M9 P35); one todo_consolidated event. */
  applyTodoConsolidate(
    cwd: string,
    sourceRef: { id?: string; title?: string },
    intoRef: { id?: string; title?: string },
    sessionId?: string | null,
  ): repo.TodoConsolidateResult {
    const h = this.resolve(cwd)
    return repo.applyTodoConsolidate(h.db, sourceRef, intoRef, sessionId, h.scopeKey)
  }
  applyGoalProgress(cwd: string, ref: { id?: string; title?: string }, progress: number, note?: string | null, sessionId?: string | null): Goal | null {
    const h = this.resolve(cwd)
    const id = ref.id ?? (ref.title ? repo.findGoalByTitle(h.db, h.scopeKey, ref.title)?.id : undefined)
    if (!id) return null
    return repo.applyGoalProgress(h.db, id, progress, note, sessionId)
  }
  applyMilestoneStatus(cwd: string, ref: { id?: string; title?: string }, status: MilestoneStatus, sessionId?: string | null): Milestone | null {
    const h = this.resolve(cwd)
    const id = ref.id ?? (ref.title ? repo.findMilestoneByTitle(h.db, h.scopeKey, ref.title)?.id : undefined)
    if (!id) return null
    return repo.applyMilestoneStatus(h.db, id, status, sessionId)
  }
  applyMilestoneRename(cwd: string, id: string, title: string, sessionId?: string | null): Milestone | null {
    return repo.applyMilestoneRename(this.resolve(cwd).db, id, title, sessionId)
  }
  /** Fuzzy title -> milestone id (M8 extraction linking); null when unmatched. */
  findMilestoneId(cwd: string, title: string): string | null {
    const h = this.resolve(cwd)
    return repo.findMilestoneByTitle(h.db, h.scopeKey, title)?.id ?? null
  }
  /** Inline-edit todo plan fields (v0.3.0 E); writes a todo_updated event. */
  applyTodoUpdate(
    cwd: string,
    id: string,
    patch: { title?: string; due_at?: string | null; priority?: Priority | null; milestone_id?: string | null },
    sessionId?: string | null,
  ): Todo | null {
    return repo.applyTodoUpdate(this.resolve(cwd).db, id, patch, sessionId)
  }

  // ---- milestones ----
  addMilestone(
    cwd: string,
    data: { title: string; target_date?: string | null; description?: string | null; source?: Source },
  ): Milestone {
    const h = this.resolve(cwd)
    return repo.upsertMilestone(h.db, { ...data, scope_key: h.scopeKey })
  }
  setMilestoneStatus(cwd: string, id: string, status: MilestoneStatus): void {
    repo.setMilestoneStatus(this.resolve(cwd).db, id, status)
  }
  listMilestones(cwd: string, status?: MilestoneStatus): Milestone[] {
    const h = this.resolve(cwd)
    return repo.listMilestones(h.db, h.scopeKey, status)
  }

  // ---- goals ----
  addGoal(
    cwd: string,
    data: { title: string; description?: string | null; milestone_id?: string | null },
  ): Goal {
    const h = this.resolve(cwd)
    return repo.upsertGoal(h.db, { ...data, scope_key: h.scopeKey })
  }
  setGoalProgress(cwd: string, id: string, progress: number): void {
    repo.setGoalProgress(this.resolve(cwd).db, id, progress)
  }
  listGoals(cwd: string, status?: GoalStatus): Goal[] {
    const h = this.resolve(cwd)
    return repo.listGoals(h.db, h.scopeKey, status)
  }
  applyGoalRename(cwd: string, id: string, title: string, sessionId?: string | null): Goal | null {
    return repo.applyGoalRename(this.resolve(cwd).db, id, title, sessionId)
  }
  applyGoalAbandon(cwd: string, id: string, sessionId?: string | null): Goal | null {
    return repo.applyGoalAbandon(this.resolve(cwd).db, id, sessionId)
  }

  // ---- preferences ----
  addPreference(cwd: string, data: { key: string; value: string }): Preference {
    const h = this.resolve(cwd)
    return repo.upsertPreference(h.db, { ...data, scope_key: h.scopeKey })
  }
  listPreferences(cwd: string): Preference[] {
    const h = this.resolve(cwd)
    return repo.listPreferences(h.db, h.scopeKey)
  }

  /** Workspace scopes opened so far (aggregation registry; cwd -> scopeKey). */
  listWorkspaceMeta(): Array<{ cwd: string; scopeKey: string }> {
    return [...this.knownWorkspaces.entries()].map(([cwd, scopeKey]) => ({ cwd, scopeKey }))
  }
  // ---- events ----
  addEvent(
    cwd: string,
    data: { kind: EventKind; summary: string; detail?: string | null; session_id?: string | null; source?: Source | null; occurred_at?: number },
  ): TimelineEvent | null {
    const h = this.resolve(cwd)
    return repo.addEvent(h.db, { ...data, scope_key: h.scopeKey })
  }
  listEvents(cwd: string, limit = 50): TimelineEvent[] {
    const h = this.resolve(cwd)
    return repo.listEvents(h.db, h.scopeKey, limit)
  }
  /** Events within [fromMs, toMs) — day ledger aggregation (v0.3.0 C). */
  listEventsBetween(cwd: string, fromMs: number, toMs: number): TimelineEvent[] {
    const h = this.resolve(cwd)
    return repo.listEventsBetween(h.db, h.scopeKey, fromMs, toMs)
  }

  // ---- session summaries (v0.3.0 C) ----
  upsertSessionSummary(cwd: string, sessionId: string, summary: string): void {
    const h = this.resolve(cwd)
    repo.upsertSessionSummary(h.db, { session_id: sessionId, summary, scope_key: h.scopeKey })
  }
  listSessionSummaries(cwd: string): SessionSummary[] {
    const h = this.resolve(cwd)
    return repo.listSessionSummaries(h.db, h.scopeKey)
  }

  // ---- notifications (v0.3.0 B/D cards + badge) ----
  addNotification(
    cwd: string,
    data: { kind: NotificationKind; title: string; body?: string | null; todo_id?: string | null; scope_cwd?: string | null },
  ): Notification {
    const h = this.resolve(cwd)
    return repo.addNotification(h.db, { ...data, scope_key: h.scopeKey })
  }
  listNotifications(cwd: string, limit = 20): Notification[] {
    const h = this.resolve(cwd)
    return repo.listNotifications(h.db, h.scopeKey, limit)
  }
  listUnhandledNotifications(cwd: string): Notification[] {
    const h = this.resolve(cwd)
    return repo.listUnhandledNotifications(h.db, h.scopeKey)
  }
  markNotificationHandled(cwd: string, id: string): boolean {
    const h = this.resolve(cwd)
    const before = repo.listUnhandledNotifications(h.db, h.scopeKey).length
    repo.markNotificationHandled(h.db, id)
    return repo.listUnhandledNotifications(h.db, h.scopeKey).length < before
  }

  // ---- brief day-stamps (v0.3.0 D: fire each brief once per local day) ----
  getBriefStamp(cwd: string, kind: 'morning' | 'evening'): string | undefined {
    return getMeta(this.resolve(cwd).db, `brief_${kind}_day`)
  }
  setBriefStamp(cwd: string, kind: 'morning' | 'evening', day: string): void {
    setMeta(this.resolve(cwd).db, `brief_${kind}_day`, day)
  }

  // ---- search ----
  search(cwd: string, query: string, topK = 5, kinds?: readonly RowType[]): SearchHit[] {
    const h = this.resolve(cwd)
    return ftsRecallSearch(h.db, query, topK, kinds)
  }

  // ---- extraction log ----
  logExtraction(
    cwd: string,
    data: { session_id: string; turn_seq: number; strategy: ExtractionStrategy; status: ExtractionStatus; error?: string | null; extracted_json?: string | null; token_in?: number | null; token_out?: number | null; duration_ms?: number | null },
  ): void {
    repo.logExtraction(this.resolve(cwd).db, data)
  }
  lastExtractionAt(cwd: string, sessionId: string, strategy: ExtractionStrategy): number | undefined {
    return repo.lastExtractionAt(this.resolve(cwd).db, sessionId, strategy)
  }
  /** LLM extraction runs since a timestamp — the daily-cap gate input (M9 P44). */
  countExtractionsSince(cwd: string, sinceMs: number): number {
    return repo.countExtractionsSince(this.resolve(cwd).db, sinceMs)
  }
  /** Semantic-recall rows since a timestamp — budget/health input (v0.3.0). */
  countRecallSince(cwd: string, sinceMs: number): number {
    return repo.countRecallSince(this.resolve(cwd).db, sinceMs)
  }
  /** Semantic-recall rows of a status since a timestamp (health hit-rate feed). */
  countRecallStatusSince(cwd: string, status: string, sinceMs: number): number {
    return repo.countRecallStatusSince(this.resolve(cwd).db, status, sinceMs)
  }
  /** Most recent semantic-recall observations (health/visibility feed). */
  listRecentRecall(cwd: string, limit = 50): RecallLog[] {
    const h = this.resolve(cwd)
    return repo.listRecentRecall(h.db, h.scopeKey, limit)
  }
  /** Log a semantic-recall observation (expansions/rerank/injection). */
  logRecall(
    cwd: string,
    data: {
      session_id?: string | null
      query: string
      expansions?: string | null
      kept_keys?: string | null
      drop_reasons?: string | null
      rerank_outcome?: string | null
      latency_ms?: number | null
      source: 'user' | 'system'
      status: 'ok' | 'empty' | 'error'
      error?: string | null
    },
  ): void {
    const h = this.resolve(cwd)
    repo.logRecall(h.db, { ...data, scope_key: h.scopeKey })
  }
  /** Drop expired recall_log rows (light cadence). */
  pruneRecallLog(cwd: string, retentionDays: number): number {
    return repo.pruneRecallLog(this.resolve(cwd).db, retentionDays)
  }
  /** LLM extraction runs that errored since a timestamp (health feed). */
  countExtractionErrorsSince(cwd: string, sinceMs: number): number {
    return repo.countExtractionErrorsSince(this.resolve(cwd).db, sinceMs)
  }
  /** Timeline events of a kind since a timestamp (e.g. action_denied). */
  countEventKindSince(cwd: string, kind: string, sinceMs: number): number {
    return repo.countEventKindSince(this.resolve(cwd).db, kind, sinceMs)
  }
  /** Open-todo duplicate candidate pairs within a scope (needs user confirmation to merge). */
  listDuplicateTodos(cwd: string): DuplicateTodoPair[] {
    const h = this.resolve(cwd)
    return repo.listDuplicateTodos(h.db, h.scopeKey)
  }

  // ---- pending reminders ----
  queueReminder(
    cwd: string,
    data: { todo_id?: string | null; milestone_id?: string | null; fire_at: number; payload: string; session_hint?: string | null },
  ): void {
    const h = this.resolve(cwd)
    repo.queuePendingReminder(h.db, { ...data, scope_key: h.scopeKey })
  }
  listPendingReminders(cwd: string, beforeMs = Date.now()): PendingReminder[] {
    const h = this.resolve(cwd)
    return repo.listPendingReminders(h.db, h.scopeKey, beforeMs)
  }
  deletePendingReminder(cwd: string, id: string): void {
    repo.deletePendingReminder(this.resolve(cwd).db, id)
  }

  // ---- snapshot ----
  renderSnapshot(cwd: string, cwdHint?: string): string {
    const h = this.resolve(cwd)
    return renderSnapshot(h.db, h.scopeKey, cwdHint)
  }
  writeSnapshot(cwd: string, dateStr?: string): string {
    const h = this.resolve(cwd)
    return writeSnapshot(h.db, h.scopeKey, h.dataDir, cwd, dateStr)
  }
  /** Date of the last daily snapshot (YYYY-MM-DD), for snapshot scheduling (M5). */
  lastSnapshotDate(cwd: string): string | undefined {
    return getMeta(this.resolve(cwd).db, 'last_snapshot_date')
  }
  setSnapshotDate(cwd: string, date: string): void {
    setMeta(this.resolve(cwd).db, 'last_snapshot_date', date)
  }
}

export type { ExtractionLog }




