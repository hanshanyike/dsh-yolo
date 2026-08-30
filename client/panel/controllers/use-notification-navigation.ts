import { useEffect, useRef } from 'react'
import type { YoloBadgeNotification } from '../../../src/contracts/badge.ts'
import type { YoloDashboardData, YoloTodoRow } from '../../../src/contracts/dashboard.ts'

export interface NotificationOpenRequest {
  sequence: number
  notification: YoloBadgeNotification
}

export function findReminderTodo(
  data: YoloDashboardData,
  notification: YoloBadgeNotification,
): YoloTodoRow | undefined {
  if (notification.kind !== 'reminder' || !notification.todo_id) return undefined
  return data.todos.find((row) => row.id === notification.todo_id
    && (row.scope_cwd ?? row.ws?.cwd ?? data.cwd) === notification.scope_cwd)
}

export function useNotificationNavigation({
  request,
  data,
  updateUnseen,
  openReminderTodo,
  openNotificationLog,
}: {
  request?: NotificationOpenRequest
  data: YoloDashboardData | null
  updateUnseen: (unseen: number, revision: number) => void
  openReminderTodo: (todo: YoloTodoRow) => void
  openNotificationLog: (targetId?: string) => void
}): void {
  const previousSequence = useRef<number | null>(null)

  useEffect(() => {
    if (!request || !data || previousSequence.current === request.sequence) return
    previousSequence.current = request.sequence
    const notification = request.notification

    void fetch('/yolo/notifications/seen', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ notification: { id: notification.id, scope_cwd: notification.scope_cwd } }),
    }).then(async (response) => {
      if (!response.ok) return
      const outcome = await response.json() as { unseen: number; revision: number }
      updateUnseen(outcome.unseen, outcome.revision)
    }).catch(() => {})

    const reminderTodo = findReminderTodo(data, notification)
    if (reminderTodo) {
      openReminderTodo(reminderTodo)
      return
    }
    openNotificationLog(notification.id)
  }, [data, openNotificationLog, openReminderTodo, request, updateUnseen])
}
