import type { YoloItemSource } from '../../src/shared/dashboard.ts'

export type BoardPage = 'home' | 'plan' | 'history'
export type PlanSection = 'today' | 'upcoming' | 'goals' | 'all'
export type HistorySection = 'completed' | 'changes'

export type BoardRoute =
  | { page: 'home' }
  | { page: 'plan'; section: PlanSection }
  | { page: 'history'; section: HistorySection; day?: string }

export interface PanelItemRef {
  id: string
  scopeCwd: string
  title: string
  entity?: 'todo' | 'change' | 'context'
}

export interface ItemDetailForeground {
  kind: 'item_detail'
  item: PanelItemRef
}

export type PanelForeground =
  | { kind: 'none' }
  | { kind: 'assistant_chat' }
  | { kind: 'item_discussion'; item: PanelItemRef; threadKey: string }
  | ItemDetailForeground
  | {
      kind: 'source_preview'
      item: PanelItemRef
      source: YoloItemSource
      returnTo?: ItemDetailForeground
      /** Focus target owned by the underlying detail after Source returns. */
      returnToFocusId?: string
    }

export type PresentationPreference = 'auto' | 'focus' | 'dock'
export type PanelPresentation = 'board_only' | 'focus' | 'split'

export interface PanelNavigationState {
  route: BoardRoute
  foreground: PanelForeground
  presentation: PresentationPreference
  returnFocusId?: string
}

export const DEFAULT_PANEL_NAVIGATION: PanelNavigationState = {
  route: { page: 'home' },
  foreground: { kind: 'none' },
  presentation: 'auto',
}

/** The split threshold is derived from usable surface minima, not a viewport contract. */
export const BOARD_MIN_WIDTH = 560
export const CONTEXT_WIDTH = 340
export const SURFACE_SEPARATOR_WIDTH = 1
export const SPLIT_MIN_WIDTH = BOARD_MIN_WIDTH + CONTEXT_WIDTH + SURFACE_SEPARATOR_WIDTH

export function derivePanelPresentation(
  availableWidth: number,
  foreground: PanelForeground,
  preference: PresentationPreference,
): PanelPresentation {
  if (foreground.kind === 'none') return 'board_only'
  if (preference === 'focus') return 'focus'
  const canSplit = availableWidth >= SPLIT_MIN_WIDTH
  if (preference === 'dock') return canSplit ? 'split' : 'focus'
  return canSplit ? 'split' : 'focus'
}

export function navigateBoard(state: PanelNavigationState, route: BoardRoute): PanelNavigationState {
  return { ...state, route }
}

/** Opening a context replaces the current foreground; contexts never stack in the DOM. */
export function openForeground(
  state: PanelNavigationState,
  foreground: Exclude<PanelForeground, { kind: 'none' }>,
  returnFocusId?: string,
): PanelNavigationState {
  return { ...state, foreground, returnFocusId }
}

export function backFromForeground(state: PanelNavigationState): PanelNavigationState {
  if (state.foreground.kind === 'source_preview' && state.foreground.returnTo) {
    return { ...state, foreground: state.foreground.returnTo, returnFocusId: state.foreground.returnToFocusId }
  }
  return { ...state, foreground: { kind: 'none' } }
}

export type PanelEscapeResult =
  | { action: 'state'; state: PanelNavigationState }
  | { action: 'close_panel' }

export function escapePanel(state: PanelNavigationState): PanelEscapeResult {
  if (state.foreground.kind !== 'none') return { action: 'state', state: backFromForeground(state) }
  return { action: 'close_panel' }
}

export function samePanelItem(left: PanelItemRef, right: PanelItemRef): boolean {
  return left.id === right.id && left.scopeCwd === right.scopeCwd
}
