// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

/**
 * Split Pane Keyboard Shortcuts Hook
 * 
 * Handles keyboard shortcuts for terminal split pane operations:
 * - Cmd+Shift+E (Mac) / Ctrl+Shift+E (Win/Linux): Split horizontal
 * - Cmd+Shift+D (Mac) / Ctrl+Shift+D (Win/Linux): Split vertical
 * - Cmd+Option+Arrow (Mac) / Ctrl+Alt+Arrow (Win/Linux): Navigate between panes
 * - Cmd+Shift+W (Mac) / Ctrl+Shift+W (Win/Linux): Close current pane
 */

import { useCallback, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { useLocalTerminalStore } from '../store/localTerminalStore';
import { MAX_PANES_PER_TAB, type PaneNode, type SplitDirection } from '../types';

/**
 * Get all leaf pane IDs in order (left-to-right, top-to-bottom)
 */
function getAllLeafPaneIds(node: PaneNode): string[] {
  if (node.type === 'leaf') {
    return [node.id];
  }
  return node.children.flatMap(child => getAllLeafPaneIds(child));
}

function activePaneSessionId(tab: { sessionId?: string; activePaneId?: string; rootPane?: PaneNode | null }): string | null {
  if (!tab.rootPane) return tab.sessionId ?? null;
  const activePaneId = tab.activePaneId;
  if (!activePaneId) return null;

  const find = (node: PaneNode): string | null => {
    if (node.type === 'leaf') {
      return node.id === activePaneId ? node.sessionId : null;
    }
    for (const child of node.children) {
      const sessionId = find(child);
      if (sessionId) return sessionId;
    }
    return null;
  };

  return find(tab.rootPane);
}

/**
 * Hook that provides split pane action callbacks without keyboard handling.
 * Used by useKeybindingDispatcher to wire split actions to the registry.
 */
export function useSplitPaneActions() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const splitPane = useAppStore((s) => s.splitPane);
  const closePane = useAppStore((s) => s.closePane);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const getPaneCount = useAppStore((s) => s.getPaneCount);

  const createTerminal = useLocalTerminalStore((s) => s.createTerminal);
  const getTerminal = useLocalTerminalStore((s) => s.getTerminal);

  // Use ref to avoid stale closures
  const stateRef = useRef({ tabs, activeTabId });
  stateRef.current = { tabs, activeTabId };

  const handleSplit = useCallback(async (direction: SplitDirection) => {
    const { tabs, activeTabId } = stateRef.current;
    if (!activeTabId) return;
    
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (!currentTab) return;
    
    // Only allow split for terminal tabs
    if (currentTab.type !== 'terminal' && currentTab.type !== 'local_terminal') return;
    if (
      currentTab.type === 'local_terminal'
      && getTerminal(activePaneSessionId(currentTab) ?? '')?.transport?.type === 'serial'
    ) {
      return;
    }
    
    // Check pane limit
    const paneCount = getPaneCount(activeTabId);
    if (paneCount >= MAX_PANES_PER_TAB) {
      console.log(`[SplitPane] Max panes reached (${MAX_PANES_PER_TAB})`);
      return;
    }

    try {
      if (currentTab.type === 'local_terminal') {
        // Create new local terminal session
        const newSession = await createTerminal();
        splitPane(activeTabId, direction, newSession.id, 'local_terminal');
      } else if (currentTab.type === 'terminal') {
        // SSH terminal split - TODO: implement session cloning
        console.log('[SplitPane] SSH terminal split not yet implemented');
      }
    } catch (err) {
      console.error('[SplitPane] Failed to split pane:', err);
    }
  }, [splitPane, createTerminal, getPaneCount, getTerminal]);

  const handleClosePane = useCallback(() => {
    const { tabs, activeTabId } = stateRef.current;
    if (!activeTabId) return;
    
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (!currentTab?.activePaneId || !currentTab.rootPane) return;
    
    // Don't close the last pane
    const paneCount = getPaneCount(activeTabId);
    if (paneCount <= 1) {
      console.log('[SplitPane] Cannot close last pane');
      return;
    }
    
    closePane(activeTabId, currentTab.activePaneId);
  }, [closePane, getPaneCount]);

  const handleNavigate = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    const { tabs, activeTabId } = stateRef.current;
    if (!activeTabId) return;
    
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (!currentTab?.rootPane || !currentTab.activePaneId) return;
    
    const allPaneIds = getAllLeafPaneIds(currentTab.rootPane);
    if (allPaneIds.length <= 1) return;
    
    const currentIndex = allPaneIds.indexOf(currentTab.activePaneId);
    if (currentIndex === -1) return;
    
    let newIndex: number;
    
    // Simple navigation: left/up = previous, right/down = next
    if (direction === 'left' || direction === 'up') {
      newIndex = currentIndex > 0 ? currentIndex - 1 : allPaneIds.length - 1;
    } else {
      newIndex = currentIndex < allPaneIds.length - 1 ? currentIndex + 1 : 0;
    }
    
    const newPaneId = allPaneIds[newIndex];
    setActivePaneId(activeTabId, newPaneId);
  }, [setActivePaneId]);

  return { handleSplit, handleClosePane, handleNavigate, getPaneCount };
}
