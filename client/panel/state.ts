// YOLO panel UI state (v0.3.0 A, TA-6) — module-scope so closing the panel
// (unmount) and reopening keeps the filter and side-chat visibility.
// Deliberately not persisted to storage: it is view state, not memory.
// v0.3.1: the 看板/对话 tabs merged into one chat surface (side pane that can
// expand full-screen), so `tab` is gone; `chatFullscreen` is session state
// (Esc unwinds full → side → closed) and is not persisted.
// v0.3.3: the board is always all-workspaces, so `workspaceScope` is gone.

import type { KanbanFilter } from '../../src/shared/filters.ts'
import { DEFAULT_FILTER } from '../../src/shared/filters.ts'
import type { ChatAnchor } from './ChatPane.tsx'

export interface ActivePanelChat {
  anchor: ChatAnchor
  threadKey: string
}

export interface PanelUiState {
  filter: KanbanFilter
  sideChatOpen: boolean
  activeChat: ActivePanelChat | null
}

const state: PanelUiState = {
  filter: { ...DEFAULT_FILTER },
  sideChatOpen: false,
  activeChat: null,
}

export function readPanelState(): PanelUiState {
  return {
    filter: { ...state.filter },
    sideChatOpen: state.sideChatOpen,
    activeChat: state.activeChat
      ? { threadKey: state.activeChat.threadKey, anchor: { ...state.activeChat.anchor, source: state.activeChat.anchor.source ? { ...state.activeChat.anchor.source } : undefined } }
      : null,
  }
}

export function writePanelState(patch: Partial<PanelUiState>): void {
  if (patch.filter !== undefined) state.filter = { ...patch.filter }
  if (patch.sideChatOpen !== undefined) state.sideChatOpen = patch.sideChatOpen
  if (patch.activeChat !== undefined) {
    state.activeChat = patch.activeChat
      ? { threadKey: patch.activeChat.threadKey, anchor: { ...patch.activeChat.anchor, source: patch.activeChat.anchor.source ? { ...patch.activeChat.anchor.source } : undefined } }
      : null
  }
}
