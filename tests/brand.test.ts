import { describe, expect, it } from 'vitest'
import { nextYoloSurfaceLabel, YOLO_SURFACE_LABELS } from '../client/brand.ts'

describe('YOLO surface greetings', () => {
  it('rotates through every greeting and wraps to the first one', () => {
    let current: (typeof YOLO_SURFACE_LABELS)[number] = YOLO_SURFACE_LABELS[0]
    const seen: (typeof YOLO_SURFACE_LABELS)[number][] = [current]
    for (let i = 1; i < YOLO_SURFACE_LABELS.length; i++) {
      current = nextYoloSurfaceLabel(current)
      seen.push(current)
    }

    expect(seen).toEqual([...YOLO_SURFACE_LABELS])
    expect(nextYoloSurfaceLabel(current)).toBe(YOLO_SURFACE_LABELS[0])
  })
})
