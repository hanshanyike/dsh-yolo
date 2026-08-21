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
import { ftsSearch } from './search.ts'
import { renderSnapshot, writeSnapshot } from './snapshot.ts'
import type {
  Goal,
  GoalStatus,
  Milestone,
  MilestoneStatus,
  PendingReminder,
  Preference,
  RowType,
  ScopeMode,
  SearchHit,
  Source,
  TimelineEvent,
  Todo,
  TodoAction,
  TodoStatus,
  ExtractionLog,
  ExtractionStatus,
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
    }
    return h
  }

  // ---- todos ----
  addTodo(
    cwd: string,
    data: { title: string; detail?: string | null; priority?: Priority | null; due_at?: string | null; milestone_id?: string | null; source?: Source },
  ): Todo {
    const h = this.resolve(cwd)
    return repo.upsertTodo(h.db, { ...data, scope_key: h.scopeKey })
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
  /** Fuzzy title -> milestone id (M8 extraction linking); null when unmatched. */
  findMilestoneId(cwd: string, title: string): string | null {
    const h = this.resolve(cwd)
    return repo.findMilestoneByTitle(h.db, h.scopeKey, title)?.id ?? null
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

  // ---- preferences ----
  addPreference(cwd: string, data: { key: string; value: string }): Preference {
    const h = this.resolve(cwd)
    return repo.upsertPreference(h.db, { ...data, scope_key: h.scopeKey })
  }
  listPreferences(cwd: string): Preference[] {
    const h = this.resolve(cwd)
    return repo.listPreferences(h.db, h.scopeKey)
  }

  // ---- events ----
  addEvent(
    cwd: string,
    data: { kind: EventKind; summary: string; detail?: string | null; session_id?: string | null; occurred_at?: number },
  ): TimelineEvent | null {
    const h = this.resolve(cwd)
    return repo.addEvent(h.db, { ...data, scope_key: h.scopeKey })
  }
  listEvents(cwd: string, limit = 50): TimelineEvent[] {
    const h = this.resolve(cwd)
    return repo.listEvents(h.db, h.scopeKey, limit)
  }

  // ---- search ----
  search(cwd: string, query: string, topK = 5, kinds?: readonly RowType[]): SearchHit[] {
    const h = this.resolve(cwd)
    return ftsSearch(h.db, query, topK, kinds)
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
