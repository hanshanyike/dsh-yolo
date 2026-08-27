/** Friendly rotating greetings shown beside the shared YOLO logo. */
export const YOLO_SURFACE_LABELS = [
  '一起把事情理顺',
  '今天也陪你稳稳推进',
  '有我帮你记着呢',
  '先理清一件，再往前走',
  '你的安排，我来帮你跟进',
] as const

export type YoloSurfaceLabel = (typeof YOLO_SURFACE_LABELS)[number]

/** Return the next greeting while keeping the rotation deterministic. */
export function nextYoloSurfaceLabel(current: string): YoloSurfaceLabel {
  const index = YOLO_SURFACE_LABELS.indexOf(current as YoloSurfaceLabel)
  return YOLO_SURFACE_LABELS[(index + 1 + YOLO_SURFACE_LABELS.length) % YOLO_SURFACE_LABELS.length]
}

export function yoloSurfaceTitle(label: string): string {
  return `YOLO · ${label}`
}
