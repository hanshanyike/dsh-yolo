// YOLO plugin entry (M0 milestone — minimal proof of load).
//
// M0 goal: be loadable by a deepseek-harness host via `--patch ./cordis.dev.yml`
// and print a marker line, proving the plugin pipeline works end-to-end.
//
// Full functionality (storage service, extraction, memory tools, reminders, UI)
// is added in M1–M5 as separate cooperating plugins within this bundle.
// See ../../plans and docs/architecture.md for the bundle layout.

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
  // regardless of logger wiring. This is the M0 verification signal.
  console.log('[yolo] plugin loaded')
}
