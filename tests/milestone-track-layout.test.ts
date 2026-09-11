import { describe, expect, it } from 'vitest'
import {
  layoutMilestoneTrack,
  milestoneAxisX,
  milestoneLabelTop,
  milestonePopoverTop,
  milestoneTrackMargin,
  MIN_DOT_GAP,
  TRACK_MAX_X,
  TRACK_MIN_X,
} from '../client/panel/milestone-track-layout.ts'

/** Local YYYY-MM-DD for today + `days`. */
function dateIn(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function rows(...specs: Array<[id: string, date: string | null]>): Array<{ id: string; target_date: string | null }> {
  return specs.map(([id, target_date]) => ({ id, target_date }))
}

describe('milestone axis position', () => {
  it('maps undated, missing and unparseable dates to the centre', () => {
    expect(milestoneAxisX(null)).toBe(50)
    expect(milestoneAxisX(undefined)).toBe(50)
    expect(milestoneAxisX('')).toBe(50)
    // A NaN diff used to leak into `left: NaN%`, which the browser drops.
    expect(milestoneAxisX('not-a-date')).toBe(50)
  })

  it('maps the ±90-day window onto the band edges', () => {
    expect(milestoneAxisX(dateIn(0))).toBeCloseTo(50, 5)
    expect(milestoneAxisX(dateIn(90))).toBeCloseTo(TRACK_MAX_X, 5)
    expect(milestoneAxisX(dateIn(-90))).toBeCloseTo(TRACK_MIN_X, 5)
    expect(milestoneAxisX(dateIn(365))).toBe(TRACK_MAX_X)
    expect(milestoneAxisX(dateIn(-365))).toBe(TRACK_MIN_X)
  })
})

describe('milestone track layout', () => {
  it('returns an empty layout for no milestones', () => {
    const layout = layoutMilestoneTrack([])
    expect(layout.size).toBe(0)
    expect(layout.maxRow).toBe(0)
  })

  it('keeps a lone milestone at its raw position on row 0', () => {
    const layout = layoutMilestoneTrack(rows(['a', null]))
    expect(layout.get('a')).toEqual({ x: 50, row: 0 })
    expect(layout.maxRow).toBe(0)
  })

  it('spreads two undated milestones symmetrically instead of stacking them', () => {
    const layout = layoutMilestoneTrack(rows(['a', null], ['b', null]))
    const a = layout.get('a')!
    const b = layout.get('b')!
    expect(a.x).toBeCloseTo(47.75, 5)
    expect(b.x).toBeCloseTo(52.25, 5)
    expect(a.row).not.toBe(b.row)
    expect(layout.maxRow).toBe(1)
  })

  it('separates the reported overlap: an undated pair plus a near-past date', () => {
    // The live dashboard shape this regression is about: two milestones with
    // no target date and one dated ~12 days ago all used to collide around
    // the centre with two of them exactly stacked at 50%.
    const layout = layoutMilestoneTrack(rows(['past', dateIn(-12)], ['alpha', null], ['beta', null]))
    const positions = [layout.get('past')!, layout.get('alpha')!, layout.get('beta')!]
    const sortedX = positions.map((slot) => slot.x).sort((l, r) => l - r)
    for (let i = 1; i < sortedX.length; i++) {
      expect(sortedX[i] - sortedX[i - 1]).toBeGreaterThanOrEqual(MIN_DOT_GAP - 1e-9)
    }
    // No two labels share a row while sitting within reading distance.
    for (const left of positions) {
      for (const right of positions) {
        if (left === right || left.row !== right.row) continue
        expect(Math.abs(left.x - right.x)).toBeGreaterThanOrEqual(26)
      }
    }
  })

  it('gives a same-date triple three distinct rows', () => {
    const layout = layoutMilestoneTrack(rows(['a', dateIn(0)], ['b', dateIn(0)], ['c', dateIn(0)]))
    expect(layout.get('a')!.x).toBeCloseTo(45.5, 5)
    expect(layout.get('b')!.x).toBeCloseTo(50, 5)
    expect(layout.get('c')!.x).toBeCloseTo(54.5, 5)
    expect(new Set([layout.get('a')!.row, layout.get('b')!.row, layout.get('c')!.row]).size).toBe(3)
    expect(layout.maxRow).toBe(2)
  })

  it('preserves raw positions when dates are far apart', () => {
    const layout = layoutMilestoneTrack(rows(['old', dateIn(-60)], ['now', dateIn(0)], ['new', dateIn(60)]))
    expect(layout.get('old')!.x).toBeCloseTo(milestoneAxisX(dateIn(-60)), 5)
    expect(layout.get('now')!.x).toBeCloseTo(50, 5)
    expect(layout.get('new')!.x).toBeCloseTo(milestoneAxisX(dateIn(60)), 5)
    expect([layout.get('old')!.row, layout.get('now')!.row, layout.get('new')!.row]).toEqual([0, 0, 0])
    expect(layout.maxRow).toBe(0)
  })

  it('shifts a right-edge cluster back inside the band as a block', () => {
    const layout = layoutMilestoneTrack(rows(
      ['a', dateIn(90)], ['b', dateIn(90)], ['c', dateIn(90)], ['d', dateIn(90)], ['e', dateIn(90)],
    ))
    const got = ['a', 'b', 'c', 'd', 'e'].map((id) => layout.get(id)!.x)
    expect(got[0]).toBeCloseTo(78, 5)
    expect(got[4]).toBeCloseTo(96, 5)
    expect(layout.maxRow).toBe(4)
  })

  it('falls back to an even spread when the set cannot fit by date', () => {
    // Five milestones at each band edge cannot keep their positions and stay
    // inside the track; the layout then gives up date fidelity for geometry.
    const edgeRows = rows(
      ['a1', dateIn(-90)], ['a2', dateIn(-90)], ['a3', dateIn(-90)], ['a4', dateIn(-90)], ['a5', dateIn(-90)],
      ['b1', dateIn(90)], ['b2', dateIn(90)], ['b3', dateIn(90)], ['b4', dateIn(90)], ['b5', dateIn(90)],
    )
    const layout = layoutMilestoneTrack(edgeRows)
    const sorted = [...layout.values()].map((slot) => slot.x).sort((l, r) => l - r)
    expect(sorted[0]).toBeGreaterThanOrEqual(TRACK_MIN_X)
    expect(sorted[sorted.length - 1]).toBeLessThanOrEqual(TRACK_MAX_X)
    const step = (TRACK_MAX_X - TRACK_MIN_X) / (sorted.length - 1)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(step - 1e-9)
    }
  })

  it('compresses the dot gap when very many milestones share one date', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `m${i}`, target_date: null }))
    const layout = layoutMilestoneTrack(many)
    const sorted = [...layout.values()].map((slot) => slot.x).sort((l, r) => l - r)
    expect(sorted[0]).toBeGreaterThanOrEqual(TRACK_MIN_X - 1e-9)
    expect(sorted[sorted.length - 1]).toBeLessThanOrEqual(TRACK_MAX_X + 1e-9)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(0)
    }
  })

  it('breaks same-position ties by id so the layout is deterministic', () => {
    const layout = layoutMilestoneTrack(rows(['b', null], ['a', null]))
    expect(layout.get('a')!.x).toBeLessThan(layout.get('b')!.x)
  })
})

describe('milestone track geometry helpers', () => {
  it('steps label rows by more than one two-line label height', () => {
    expect(milestoneLabelTop(0)).toBe(11)
    expect(milestoneLabelTop(1)).toBe(42)
    expect(milestoneLabelTop(2)).toBe(73)
    // A label is a two-line block (title + date) at 14px line-height = 28px;
    // the 31px pitch leaves no vertical overlap between adjacent rows.
    expect(milestoneLabelTop(1) - milestoneLabelTop(0)).toBeGreaterThanOrEqual(28)
    expect(milestoneTrackMargin(0)).toBe(45)
    expect(milestoneTrackMargin(1)).toBe(76)
    expect(milestoneTrackMargin(2)).toBe(107)
    expect(milestonePopoverTop(0)).toBe(49)
    expect(milestonePopoverTop(1)).toBe(80)
    expect(milestonePopoverTop(2)).toBe(111)
    // The popover opens below every label row.
    expect(milestonePopoverTop(2)).toBeGreaterThanOrEqual(milestoneLabelTop(2) + 28)
  })
})
