// YOLO design-system runtime (frontend-redesign-v5-native.md) — injects the
// token stylesheet once per document and resolves the panel theme from the
// host. The tokens themselves are bridged straight to the host `--dsw-*`
// aliases (tokens.ts), so the theme flips automatically with the host; this
// module only resolves the `data-y-theme` attribute used for native control
// color-scheme (date inputs) and pinned by the E2E theme spec.

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
 * Theme resolution — three signals, most specific first:
 * 1. the host `--background` variable's luminance (the contract pinned by the
 *    E2E theme spec: the host's light/dark background drives the panel);
 * 2. the v5 host-native marker `body[data-ds-dark-theme]` (ui-theme flips the
 *    `--dsw-*` tokens with this attribute; the panel follows it);
 * 3. `prefers-color-scheme` as the final fallback.
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
  try {
    if (typeof document !== 'undefined' && document.body?.hasAttribute('data-ds-dark-theme')) return 'dark'
  } catch {
    // body not mounted yet — fall through
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}
