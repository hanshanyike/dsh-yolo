/** Stable product-page sections rendered by the assistant board. Goals are a
 * first-class page (their own entity), not a plan segment. */
export type BoardSurfaceKey =
  | 'home'
  | 'plan-all'
  | 'plan-today'
  | 'plan-upcoming'
  | 'plan-undated'
  | 'goals'
  | 'history-timeline'
  | 'history-items'
