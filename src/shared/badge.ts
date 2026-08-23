/** Lightweight sidebar badge payload. Deliberately independent from the full dashboard. */
export interface YoloBadgeData {
  unhandled: number
  /** True when at least one known workspace could not be counted. */
  partial?: boolean
}
