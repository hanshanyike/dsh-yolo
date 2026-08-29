// YOLO panel UI state — module-scope so closing the panel (unmount) and
// reopening keeps the route, foreground, filters and discussion episodes.
// Deliberately not persisted to storage: it is view state, not memory.
// Presentation itself is intentionally not persisted: it is always derived
// from current usable width. The board is always all-workspaces.

import type { KanbanFilter } from '../../src/shared/filters.ts'
import { DEFAULT_FILTER } from '../../src/shared/filters.ts'
import {
  DEFAULT_PANEL_NAVIGATION,
  type PanelForeground,
  type PanelNavigationState,
} from './navigation.ts'

export interface PanelUiState {
  filter: KanbanFilter
  /** Product-level route and its single foreground context. */
  navigation: PanelNavigationState
  /** Active item discussion episodes, keyed by scope + item id. */
  discussionThreads: Record<string, string>
}

const state: PanelUiState = {
  filter: { ...DEFAULT_FILTER },
  navigation: cloneNavigation(DEFAULT_PANEL_NAVIGATION),
  discussionThreads: {},
}

function cloneForeground(foreground: PanelForeground): PanelForeground {
  if (foreground.kind === 'none' || foreground.kind === 'assistant_chat') return { ...foreground }
  if (foreground.kind === 'notification_log') {
    return {
      ...foreground,
      returnTo: foreground.returnTo ? cloneForeground(foreground.returnTo) as typeof foreground.returnTo : undefined,
    }
  }
  if (foreground.kind === 'source_preview') {
    return {
      ...foreground,
      item: { ...foreground.item },
      source: {
        ...foreground.source,
        workspace: foreground.source.workspace ? { ...foreground.source.workspace } : undefined,
      },
      returnTo: foreground.returnTo
        ? { kind: 'item_detail', item: { ...foreground.returnTo.item } }
        : undefined,
    }
  }
  return { ...foreground, item: { ...foreground.item } }
}

function cloneNavigation(navigation: PanelNavigationState): PanelNavigationState {
  return {
    ...navigation,
    route: { ...navigation.route },
    foreground: cloneForeground(navigation.foreground),
  }
}

export function readPanelState(): PanelUiState {
  return {
    filter: { ...state.filter },
    navigation: cloneNavigation(state.navigation),
    discussionThreads: { ...state.discussionThreads },
  }
}

export function writePanelState(patch: Partial<PanelUiState>): void {
  if (patch.filter !== undefined) state.filter = { ...patch.filter }
  if (patch.navigation !== undefined) state.navigation = cloneNavigation(patch.navigation)
  if (patch.discussionThreads !== undefined) state.discussionThreads = { ...patch.discussionThreads }
}
