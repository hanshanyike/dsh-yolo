import { describe, expect, it } from 'vitest'
import { YOLO_CSS } from '../client/design/tokens.ts'

const START = '/* ===== dashboard v2 surfaces ====='
const END = '/* narrow panel (4.3 Compact) */'

function v2Css(): string {
  const start = YOLO_CSS.indexOf(START)
  const end = YOLO_CSS.indexOf(END, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return YOLO_CSS.slice(start, end)
}

describe('dashboard v2 Mono style contract', () => {
  it('covers every v2 surface and its important semantic states', () => {
    const css = v2Css()
    const selectors = [
      '.v2-today-surface',
      '.v2-today-partial',
      '.v2-judgment--full',
      '.v2-judgment--compact',
      '.v2-judgment-partial',
      '.v2-judgment-source',
      '.v2-judgment-actions',
      '.v2-judgment-secondary',
      '.v2-judgment-impact',
      '.v2-today-row',
      '.v2-today-row-body',
      '.v2-today-row-reason',
      '.v2-today-row-meta',
      '.v2-task-section',
      '.v2-task-section-head',
      '.v2-task-list',
      '[aria-labelledby="v2-progress-title"]',
      '[aria-labelledby="v2-closure-title"]',
      '.v2-task-action-panel',
      '.v2-learning-receipt',
      '.v2-learning-receipt-actions',
    ]

    for (const selector of selectors) expect(css).toContain(selector)
  })

  it('uses only the host-backed neutral and business variables for component colors', () => {
    const css = v2Css()
    expect(css).toContain('var(--y-focus)')
    expect(css).toContain('var(--y-bg)')
    expect(css).toContain('var(--y-surface)')
    expect(css).toContain('var(--y-text-1)')
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|(?:linear|radial)-gradient\(/i)
    expect(css).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(css).not.toContain('[data-y-theme')
  })

  it('keeps body copy readable and interactive targets keyboard-visible', () => {
    const css = v2Css()
    const pixelFontSizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]))
    expect(pixelFontSizes.length).toBeGreaterThan(0)
    expect(pixelFontSizes.every((size) => size >= 13)).toBe(true)
    expect(css).toContain('min-height: 36px')
    expect(css).toContain('min-height: 32px')
    expect(css).toContain('button:focus-visible')
    expect(css).toContain('outline: 2px solid var(--y-focus)')
  })

  it('defines compact and fluid presentation layouts without a fixed viewport split', () => {
    const css = v2Css()
    expect(css).toContain('.yolo-scope.compact .v2-today-row')
    expect(css).toContain('.yolo-scope.compact .v2-task-action-panel')
    expect(css).toContain('.yolo-scope:not(.compact) .v2-today-surface > header')
    expect(css).not.toContain('@media (min-width: 480px)')
    expect(css).not.toContain('@media (min-width: 960px)')
    expect(css).toContain('.yolo-scope[data-presentation="split"] .v2-task-action-panel')
    expect(css).toContain('overflow-x: clip')
    expect(css).toMatch(/\.v2-today-row-reason[^}]*overflow-wrap:\s*anywhere/u)
    expect(css).toContain('minmax(0, 1fr)')
  })

  it('inherits the global reduced-motion gate for all v2 descendants', () => {
    expect(YOLO_CSS).toContain('@media (prefers-reduced-motion: reduce)')
    expect(YOLO_CSS).toContain('.yolo-scope, .yolo-scope *, .yolo-scope *::before, .yolo-scope *::after')
    expect(YOLO_CSS).toContain('animation: none !important; transition: none !important;')
  })
})
