import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { nextYoloSurfaceLabel, YOLO_SURFACE_LABELS } from '../client/brand.ts'
import {
  YOLO_LOGO_ATTENTION_ARC,
  YOLO_LOGO_BACKGROUND,
} from '../client/YoloLogo.tsx'

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

describe('YOLO brand mark', () => {
  it('keeps the public SVG and React component on the same brand geometry', () => {
    const svg = readFileSync(new URL('../docs/logo.svg', import.meta.url), 'utf8')

    expect(svg).toContain(`fill="${YOLO_LOGO_BACKGROUND}"`)
    expect(svg).toContain('circle cx="124" cy="132" r="62"')
    expect(svg).toContain('circle cx="204" cy="74" r="15"')
    expect(svg).toContain(`d="${YOLO_LOGO_ATTENTION_ARC}"`)
  })

  it('reuses the public logo in the social preview instead of redrawing it', () => {
    const preview = readFileSync(new URL('../docs/assets/readme/social-preview.svg', import.meta.url), 'utf8')

    expect(preview).toContain('href="../../logo.svg"')
  })
})
