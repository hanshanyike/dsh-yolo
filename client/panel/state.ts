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
import {
  DEFAULT_PANEL_NAVIGATION,
  type PanelForeground,
  type PanelNavigationState,
} from './navigation.ts'

export interface ActivePanelChat {
  anchor: ChatAnchor
  threadKey: string
}

export interface PanelUiState {
  filter: KanbanFilter
  /** Product-level route and its single foreground context. */
  navigation: PanelNavigationState
  /** @deprecated Kept only while the old shell is migrated to navigation.foreground. */
  sideChatOpen: boolean
  /** @deprecated Kept only while the old shell is migrated to navigation.foreground. */
  activeChat: ActivePanelChat | null
}

const state: PanelUiState = {
  filter: { ...DEFAULT_FILTER },
  navigation: cloneNavigation(DEFAULT_PANEL_NAVIGATION),
  sideChatOpen: false,
  activeChat: null,
}

function cloneForeground(foreground: PanelForeground): PanelForeground {
  if (foreground.kind === 'none' || foreground.kind === 'assistant_chat') return { ...foreground }
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
    sideChatOpen: state.sideChatOpen,
    activeChat: state.activeChat
      ? { threadKey: state.activeChat.threadKey, anchor: { ...state.activeChat.anchor, source: state.activeChat.anchor.source ? { ...state.activeChat.anchor.source } : undefined } }
      : null,
  }
}

export function writePanelState(patch: Partial<PanelUiState>): void {
  if (patch.filter !== undefined) state.filter = { ...patch.filter }
  if (patch.navigation !== undefined) state.navigation = cloneNavigation(patch.navigation)
  if (patch.sideChatOpen !== undefined) state.sideChatOpen = patch.sideChatOpen
  if (patch.activeChat !== undefined) {
    state.activeChat = patch.activeChat
      ? { threadKey: patch.activeChat.threadKey, anchor: { ...patch.activeChat.anchor, source: patch.activeChat.anchor.source ? { ...patch.activeChat.anchor.source } : undefined } }
      : null
  }
}
