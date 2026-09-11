/**
 * Collision-free layout for the shared milestone time axis.
 *
 * Dots sit on the axis by target date, but raw date positions can coincide:
 * milestones without a target date all map to the centre, same-day milestones
 * map to the same point, and a ±90-day window compresses near dates into a
 * few pixels. Before this module the track rendered every dot at its raw
 * position and alternated labels between just two rows by DOM parity, so a
 * cluster stacked dots on top of each other and printed labels one over
 * another — unreachable dots, unreadable text.
 *
 * The layout keeps date fidelity where dates are far apart and only spends
 * pixels where they collide: the dot gap shrinks only when the whole set
 * cannot fit the band, clustered dots re-lay symmetrically around their
 * centroid, and each label takes the lowest row whose previous occupant is
 * far enough away horizontally — rows step by a full label height (a label
 * is a two-line block), so labels never print over each other.
 *
 * Pure and DOM-free so tests own every branch; the component only reads the
 * returned slots and converts them into inline styles.
 */

import { localDateStr } from '../../src/shared/text.ts'

const DAY_MS = 86_400_000

/** Usable axis span; dots clamp inside so half of one never leaves the track. */
export const TRACK_MIN_X = 4
export const TRACK_MAX_X = 96

/** Minimum horizontal distance between neighbouring dots, in axis percent. */
export const MIN_DOT_GAP = 4.5

/** Same-row labels need this much horizontal separation to stay readable. */
const LABEL_GAP = 26

/** Where an undated milestone sits: the middle of the axis. */
const NO_DATE_X = 50

/** One milestone's resolved position: axis percent plus label row. */
export interface MilestoneTrackSlot {
  /** Horizontal position in the [TRACK_MIN_X, TRACK_MAX_X] band, as percent. */
  x: number
  /** Label row, 0 first; grows only as collisions demand. */
  row: number
}

/** Raw axis position of one milestone by target date (undated → centre). */
export function milestoneAxisX(target: string | null | undefined): number {
  if (!target) return NO_DATE_X
  const today = localDateStr()
  const diff = (new Date(`${target.slice(0, 10)}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / DAY_MS
  // An unparseable date is not a position: treat it like an undated milestone
  // instead of leaking NaN into a `left: NaN%` style the browser must drop.
  if (!Number.isFinite(diff)) return NO_DATE_X
  return Math.max(TRACK_MIN_X, Math.min(TRACK_MAX_X, 50 + (diff / 90) * 46))
}

/** A milestone-like row; the layout only needs identity plus target date. */
export interface MilestoneLike {
  id: string
  target_date?: string | null
}

/**
 * Lay out the axis for a set of milestones.
 *
 * @param milestones - rows to place; order does not matter.
 * @returns each milestone id → its slot, with `maxRow` attached for the
 *   track's reserved label height and the popover's vertical offset.
 */
export function layoutMilestoneTrack<T extends MilestoneLike>(
  milestones: readonly T[],
): Map<string, MilestoneTrackSlot> & { maxRow: number } {
  const slots = new Map<string, MilestoneTrackSlot>() as Map<string, MilestoneTrackSlot> & { maxRow: number }

  // 1. raw positions, ordered by (x, id) so ties resolve stably.
  const ordered = milestones
    .map((m) => ({ id: m.id, raw: milestoneAxisX(m.target_date) }))
    .sort((a, b) => a.raw - b.raw || a.id.localeCompare(b.id))

  // With more milestones than the band can separate at the full gap, compress
  // the gap so the whole set still fits — dots stay pairwise distinct.
  const band = TRACK_MAX_X - TRACK_MIN_X
  const gap = ordered.length > 1 ? Math.min(MIN_DOT_GAP, band / (ordered.length - 1)) : MIN_DOT_GAP

  // 2. cluster: consecutive raw positions closer than the dot gap (measured
  //    against the cluster's latest member, so near dates chain transitively)
  //    must displace each other and share one symmetric spread.
  const clusters: Array<Array<{ id: string; raw: number }>> = []
  for (const item of ordered) {
    const current = clusters.at(-1)
    const last = current?.at(-1)
    if (current && last && item.raw - last.raw <= MIN_DOT_GAP) current.push(item)
    else clusters.push([item])
  }

  // 3. symmetric spread: each cluster fans out around its raw centroid, so an
  //    undated pair straddles the centre instead of drifting to one side.
  const placed: Array<{ id: string; x: number }> = []
  for (const cluster of clusters) {
    const centroid = cluster.reduce((sum, item) => sum + item.raw, 0) / cluster.length
    cluster.forEach((item, index) => {
      placed.push({ id: item.id, x: centroid + (index - (cluster.length - 1) / 2) * gap })
    })
  }

  // 4. Fit the laid-out dots into the band. The forward pass guarantees the
  //    gap; an edge cluster can still stick out. A single-side overhang
  //    shifts the whole set inward (gap-preserving, locality-preserving).
  //    When both sides overhang the set spans more than the band, so no
  //    date-faithful arrangement exists — fall back to an even spread, which
  //    is always inside the band and always gapped. Only dense multi-edge
  //    clusters ever hit that fallback.
  for (let i = 1; i < placed.length; i++) {
    placed[i].x = Math.max(placed[i].x, placed[i - 1].x + gap)
  }
  const firstX = placed[0]?.x
  const lastX = placed.at(-1)?.x
  if (firstX !== undefined && lastX !== undefined) {
    if (lastX > TRACK_MAX_X) {
      for (const slot of placed) slot.x -= lastX - TRACK_MAX_X
      if (placed[0].x < TRACK_MIN_X) {
        const step = placed.length > 1 ? band / (placed.length - 1) : 0
        placed.forEach((slot, index) => {
          slot.x = TRACK_MIN_X + index * step
        })
      }
    } else if (firstX < TRACK_MIN_X) {
      for (const slot of placed) slot.x += TRACK_MIN_X - firstX
    }
  }

  // 5. label rows: greedy lowest row whose previous occupant is far enough
  //    away; when every row is taken, open a new one instead of stacking.
  const rowLastX: number[] = []
  let maxRow = 0
  for (const slot of placed) {
    let row = rowLastX.findIndex((lastX) => Math.abs(slot.x - lastX) >= LABEL_GAP)
    if (row === -1) {
      row = rowLastX.length
      rowLastX.push(slot.x)
    } else {
      rowLastX[row] = slot.x
    }
    maxRow = Math.max(maxRow, row)
    slots.set(slot.id, { x: slot.x, row })
  }

  slots.maxRow = maxRow
  return slots
}

/** Label geometry: a label is two lines (block title + date) at 14px each,
 *  so rows must step by more than one label's height or same-column labels
 *  on adjacent rows print over each other. */
const LABEL_HEIGHT = 28
const ROW_PITCH = 31

/** Pixel top of a label row (relative to the track line). */
export function milestoneLabelTop(row: number): number {
  return 11 + row * ROW_PITCH
}

/** Track bottom margin reserving room for every label row. */
export function milestoneTrackMargin(maxRow: number): number {
  return 11 + maxRow * ROW_PITCH + LABEL_HEIGHT + 6
}

/** Popover top, clearing the tallest label row. */
export function milestonePopoverTop(maxRow: number): number {
  return 11 + maxRow * ROW_PITCH + LABEL_HEIGHT + 10
}
