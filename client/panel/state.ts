// YOLO panel UI state (v0.3.0 A, TA-6) — module-scope so closing the panel
// (unmount) and reopening keeps the tab, filter and side-chat visibility.
// Deliberately not persisted to storage: it is view state, not memory.

import type { KanbanFilter } from '../../src/shared/filters.ts'
import { DEFAULT_FILTER } from '../../src/shared/filters.ts'

export type PanelTab = 'kanban' | 'chat'

export interface PanelUiState {
  tab: PanelTab
  filter: KanbanFilter
  sideChatOpen: boolean
}

const state: PanelUiState = {
  tab: 'kanban',
  filter: { ...DEFAULT_FILTER },
  sideChatOpen: false,
}

export function readPanelState(): PanelUiState {
  return { tab: state.tab, filter: { ...state.filter }, sideChatOpen: state.sideChatOpen }
}

export function writePanelState(patch: Partial<PanelUiState>): void {
  if (patch.tab !== undefined) state.tab = patch.tab
  if (patch.filter !== undefined) state.filter = { ...patch.filter }
  if (patch.sideChatOpen !== undefined) state.sideChatOpen = patch.sideChatOpen
}
