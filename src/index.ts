// YOLO package entry — the npm-export identity of dsh-plugin-yolo.
//
// The YOLO bundle itself is NOT a single plugin: it is five cooperating Cordis
// plugins (storage service + four consumers) plus a browser client, each with
// its own entry wired in cordis.bundle.yml:
//   ./dist/src/storage  ./dist/src/memory  ./dist/src/extract
//   ./dist/src/reminder ./dist/src/ui      ./client (browser bundle)
//
// This module exists so `import 'dsh-plugin-yolo'` has a stable identity and a
// load marker for boot verification. See docs/architecture.md for the layout.

import type { Context } from '@deepseek-ai/cordis'

export const name = 'yolo'
export const inject: string[] = []

export function apply(ctx: Context): void {
  try {
    ctx.logger?.info?.('[yolo] plugin loaded')
  } catch {
    // logger may be unavailable in some host contexts; fall through to console
  }
  // Unconditional marker so the host terminal always shows the load event
  // regardless of logger wiring.
  console.log('[yolo] plugin loaded')
}
