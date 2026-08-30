import { useCallback, useEffect, useRef, useState } from 'react'
import type { YoloDashboardData } from '../../../src/contracts/dashboard.ts'

export interface DashboardLoadState {
  loading: boolean
  error: string | null
  data: YoloDashboardData | null
}

export interface DashboardControllerOptions {
  notificationRefreshRequest: number
  onUnseenChange?: (unseen: number, revision: number) => void
}

/** Stable business signature; response time alone must not trigger the sweep. */
export function dashboardSignature(data: YoloDashboardData): string {
  return JSON.stringify({
    contract: data.ui_contract_version ?? 1,
    todos: data.todos.map((row) => [row.ws?.slug, row.id, row.status, row.due_at, row.priority, row.updated_at, row.completed_at]),
    attention: (data.attention ?? []).map((row) => [row.id, row.evidence_fingerprint, row.seen_at, row.suppressed_until]),
    notifications: data.notifications.map((row) => [row.ws?.slug, row.id, row.handled, row.created_at]),
    ledger: data.ledger.map((row) => [row.ws?.slug, row.id, row.kind, row.occurred_at]),
    goals: data.goals.map((row) => [row.ws?.slug, row.id, row.progress, row.status]),
    milestones: data.milestones.map((row) => [row.ws?.slug, row.id, row.status, row.target_date]),
    partial: data.summary?.partial ?? false,
    workspaceErrors: data.workspaceErrors ?? [],
  })
}

export function useDashboardController({
  notificationRefreshRequest,
  onUnseenChange,
}: DashboardControllerOptions): {
  state: DashboardLoadState
  load: () => Promise<void>
  sweepTick: number
  updateUnseen: (unseen: number, revision: number) => void
} {
  const [state, setState] = useState<DashboardLoadState>({ loading: true, error: null, data: null })
  const [sweepTick, setSweepTick] = useState(0)
  const lastSignature = useRef<string | null>(null)
  const previousRefreshRequest = useRef<number | null>(null)
  const unseenRevision = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const response = await fetch('/yolo/dashboard?scope=all', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as YoloDashboardData
      const signature = dashboardSignature(data)
      if (lastSignature.current !== null && signature !== lastSignature.current) {
        setSweepTick((tick) => tick + 1)
      }
      lastSignature.current = signature

      if (data.unseen !== undefined) {
        if (data.at >= unseenRevision.current) {
          unseenRevision.current = data.at
          onUnseenChange?.(data.unseen, data.at)
        } else {
          setState((current) => {
            if (current.data?.unseen !== undefined) data.unseen = current.data.unseen
            return { loading: false, error: null, data }
          })
          return
        }
      }
      setState({ loading: false, error: null, data })
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }, [onUnseenChange])

  const updateUnseen = useCallback((unseen: number, revision: number): void => {
    if (revision < unseenRevision.current) return
    unseenRevision.current = revision
    setState((current) => current.data
      ? { ...current, data: { ...current.data, unseen } }
      : current)
    onUnseenChange?.(unseen, revision)
  }, [onUnseenChange])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const shouldRefresh = notificationRefreshRequest > 0
      && previousRefreshRequest.current !== notificationRefreshRequest
    previousRefreshRequest.current = notificationRefreshRequest
    if (shouldRefresh) void load()
  }, [load, notificationRefreshRequest])

  return { state, load, sweepTick, updateUnseen }
}
