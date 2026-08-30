import type Yolo from '../../storage/index.ts'
import { localDateStr } from '../../shared/text.ts'

export function maybeWriteDailySnapshot(yolo: Yolo, cwd: () => string): string | null {
  const today = localDateStr()
  if (yolo.lastSnapshotDate(cwd()) === today) return null
  const path = yolo.writeSnapshot(cwd(), today)
  yolo.setSnapshotDate(cwd(), today)
  return path
}

export function maybeWriteTurnSnapshot(yolo: Yolo, cwd: () => string, turnCount: number, every = 10): string | null {
  if (turnCount <= 0 || turnCount % every !== 0) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return yolo.writeSnapshot(cwd(), `turn-${turnCount}-${stamp}`)
}
