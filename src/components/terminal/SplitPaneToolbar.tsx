// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SplitSquareHorizontal, SplitSquareVertical } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/appStore';
import { useLocalTerminalStore } from '../../store/localTerminalStore';
import { MAX_PANES_PER_TAB, type PaneNode, type SplitDirection } from '../../types';

interface SplitPaneToolbarProps {
  tabId: string;
  className?: string;
}

function activePaneSessionId(rootPane: PaneNode | undefined, activePaneId: string | undefined): string | null {
  if (!rootPane || !activePaneId) return null;
  if (rootPane.type === 'leaf') {
    return rootPane.id === activePaneId ? rootPane.sessionId : null;
  }
  for (const child of rootPane.children) {
    const sessionId = activePaneSessionId(child, activePaneId);
    if (sessionId) return sessionId;
  }
  return null;
}

/**
 * SplitPaneToolbar - Floating toolbar for split pane operations
 * 
 * Displays at the top-right of the terminal container.
 * Shows split buttons when pane count < MAX_PANES_PER_TAB.
 */
export const SplitPaneToolbar: React.FC<SplitPaneToolbarProps> = ({
  tabId,
  className,
}) => {
  const { t } = useTranslation();
  const { splitPane, getPaneCount, tabs } = useAppStore();
  const { createTerminal, getTerminal } = useLocalTerminalStore();

  const paneCount = getPaneCount(tabId);
  const canSplit = paneCount < MAX_PANES_PER_TAB;

  // Find the current tab to determine its type
  const currentTab = tabs.find(tab => tab.id === tabId);
  const currentSessionId = currentTab
    ? activePaneSessionId(currentTab.rootPane, currentTab.activePaneId) ?? currentTab.sessionId
    : null;
  const isSerialTerminal = currentSessionId
    ? getTerminal(currentSessionId)?.transport?.type === 'serial'
    : false;

  const handleSplit = useCallback(async (direction: SplitDirection) => {
    if (!canSplit || !currentTab || isSerialTerminal) return;

    try {
      if (currentTab.type === 'local_terminal') {
        // For local terminals: Create a new local terminal session
        const newSession = await createTerminal();
        splitPane(tabId, direction, newSession.id, 'local_terminal');
      } else if (currentTab.type === 'terminal') {
        // For SSH terminals: Currently show a message
        // TODO: Implement SSH session duplication
        console.log('[SplitPane] SSH terminal split not yet implemented');
        // Future: Could open a dialog to select connection or duplicate current
      }
    } catch (error) {
      console.error('[SplitPane] Failed to create split pane:', error);
    }
  }, [canSplit, currentTab, createTerminal, isSerialTerminal, splitPane, tabId]);

  // Only show for terminal types
  if (!currentTab || (currentTab.type !== 'terminal' && currentTab.type !== 'local_terminal')) {
    return null;
  }

  // For SSH terminals, show disabled state with tooltip
  const isSshTerminal = currentTab.type === 'terminal';
  const splitDisabled = !canSplit || isSshTerminal || isSerialTerminal;

  return (
    <div
      className={cn(
        'absolute top-2 left-2 z-20',
        'flex items-center gap-1',
        'bg-theme-bg-panel/80 backdrop-blur-sm rounded-md',
        'border border-theme-border/50',
        'p-1',
        'opacity-0 hover:opacity-100 transition-opacity duration-200',
        // Show on hover of parent container
        'group-hover/terminal:opacity-70',
        className
      )}
    >
      {/* Split Horizontal */}
      <button
        onClick={() => handleSplit('horizontal')}
        disabled={splitDisabled}
        className={cn(
          'p-1.5 rounded-sm transition-colors',
          !splitDisabled
            ? 'text-theme-text-muted hover:text-theme-accent hover:bg-theme-bg-hover/50'
            : 'text-theme-text-muted/40 cursor-not-allowed'
        )}
        title={
          isSshTerminal
            ? t('terminal.pane.ssh_split_coming_soon', 'SSH terminal split coming soon')
            : isSerialTerminal
              ? t('terminal.pane.serial_split_disabled')
            : canSplit
              ? t('terminal.pane.split_horizontal')
              : t('terminal.pane.max_panes_reached', { max: MAX_PANES_PER_TAB })
        }
      >
        <SplitSquareHorizontal className="h-4 w-4" />
      </button>

      {/* Split Vertical */}
      <button
        onClick={() => handleSplit('vertical')}
        disabled={splitDisabled}
        className={cn(
          'p-1.5 rounded-sm transition-colors',
          !splitDisabled
            ? 'text-theme-text-muted hover:text-theme-accent hover:bg-theme-bg-hover/50'
            : 'text-theme-text-muted/40 cursor-not-allowed'
        )}
        title={
          isSshTerminal
            ? t('terminal.pane.ssh_split_coming_soon', 'SSH terminal split coming soon')
            : isSerialTerminal
              ? t('terminal.pane.serial_split_disabled')
            : canSplit
              ? t('terminal.pane.split_vertical')
              : t('terminal.pane.max_panes_reached', { max: MAX_PANES_PER_TAB })
        }
      >
        <SplitSquareVertical className="h-4 w-4" />
      </button>

      {/* Pane count indicator */}
      {paneCount > 1 && (
        <span className="text-xs text-theme-text-muted px-1">
          {paneCount}/{MAX_PANES_PER_TAB}
        </span>
      )}
    </div>
  );
};

export default SplitPaneToolbar;
