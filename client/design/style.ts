// Mono design-system runtime (frontend-redesign.md 3.6 + ch.7) — injects the
// token stylesheet once per document and resolves the panel theme from the
// host. Three-layer variable architecture: L1 host vars → L2 `.yolo-scope`
// semantic tokens → L3 components consume only `var(--y-*)`.

import { YOLO_CSS } from './tokens.ts'

const STYLE_ID = 'yolo-design-system'

/** Idempotently mount the design system stylesheet into <head>. */
export function ensureYoloStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = YOLO_CSS
  document.head.appendChild(el)
}

/** Relative luminance of a CSS color string, or null when unparseable. */
function luminance(color: string): number | null {
  const s = color.trim()
  let r = 0, g = 0, b = 0
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    r = parseInt(h.slice(0, 2), 16) / 255
    g = parseInt(h.slice(2, 4), 16) / 255
    b = parseInt(h.slice(4, 6), 16) / 255
  } else {
    const rgb = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
    if (!rgb) return null
    r = Number(rgb[1]) / 255
    g = Number(rgb[2]) / 255
    b = Number(rgb[3]) / 255
  }
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/**
 * Theme resolution (ch.7): read the host's `--background`; luminance < 0.5 →
 * dark. Falls back to prefers-color-scheme when the host var is absent.
 */
export function detectYoloTheme(): 'dark' | 'light' {
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--background')
    if (bg) {
      const lum = luminance(bg)
      if (lum !== null) return lum < 0.5 ? 'dark' : 'light'
    }
  } catch {
    // non-browser — caller decides
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}
