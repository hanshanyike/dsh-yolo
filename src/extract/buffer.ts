// YOLO candidate buffer — per-session in-memory dedup store for rule captures.
// Candidates accumulate across messages; at turn end they are drained into storage.

import type { Candidate } from './rules.ts'

export class CandidateBuffer {
  private items = new Map<string, Candidate>()

  /** Add a candidate; later duplicates (same dedupKey) replace earlier ones. */
  add(candidate: Candidate): void {
    this.items.set(candidate.dedupKey, candidate)
  }

  /** Drain all buffered candidates (clears the buffer). */
  drain(): Candidate[] {
    const out = [...this.items.values()]
    this.items.clear()
    return out
  }

  get size(): number {
    return this.items.size
  }
}
