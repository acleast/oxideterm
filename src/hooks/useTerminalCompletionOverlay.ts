// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getTerminalAutosuggestCandidates,
  type TerminalAutosuggestCandidate,
  type TerminalAutosuggestInputState,
} from '@/lib/terminal/autosuggest';
import { getCwd } from '@/lib/terminalRegistry';

const COMPLETION_LIMIT = 8;
// Sentinel for "no candidate selected". The popup opens unselected so that
// Tab/Enter fall through to the shell's own completion until the user opts in
// by pressing ArrowUp/ArrowDown (or hovering). A value of -1 means no row is
// highlighted and accept() is a no-op.
const NO_SELECTION = -1;

export function useTerminalCompletionOverlay(options: {
  enabled: boolean;
  isActive: boolean;
  paneId: string;
  getInputState: () => TerminalAutosuggestInputState;
  acceptCompletion: (text: string) => void;
  sendInput: (suffix: string) => void;
}) {
  const { enabled, isActive, paneId, getInputState, acceptCompletion, sendInput } = options;
  const [candidates, setCandidates] = useState<TerminalAutosuggestCandidate[]>([]);
  const [highlightedIndex, setHighlightedIndexState] = useState<number>(NO_SELECTION);
  const lastInputRef = useRef<TerminalAutosuggestInputState>(getInputState());
  // Mirror of `candidates` read inside the 80ms refresh tick to detect whether
  // the list actually changed (avoids clobbering the user's highlight selection
  // on every idle poll). Kept in a ref so refresh stays independent of the
  // candidates state closure.
  const candidatesRef = useRef<TerminalAutosuggestCandidate[]>([]);

  const open = enabled && isActive && candidates.length > 0;

  const refresh = useCallback(() => {
    const input = getInputState();
    lastInputRef.current = input;
    const cwd = getCwd(paneId);

    if (!enabled || !isActive || !input.isCursorAtEnd) {
      setCandidates([]);
      candidatesRef.current = [];
      setHighlightedIndexState(NO_SELECTION);
      return;
    }

    const query = input.value.trimStart();
    if (!query) {
      setCandidates([]);
      candidatesRef.current = [];
      setHighlightedIndexState(NO_SELECTION);
      return;
    }

    const lowerQuery = query.toLowerCase();
    const nextCandidates = getTerminalAutosuggestCandidates(query, COMPLETION_LIMIT, cwd)
      .filter((candidate) => {
        const lowerCommand = candidate.command.toLowerCase();
        return lowerCommand.startsWith(lowerQuery) && lowerCommand !== lowerQuery;
      });

    // Detect whether the candidate set actually changed since the last refresh.
    // The 80ms polling tick fires even while the user is idle, so resetting the
    // highlight on every tick would wipe a selection the user just made with
    // the arrow keys. Only reset to unselected when the list genuinely changes.
    const prevCommands = candidatesRef.current;
    const changed =
      prevCommands.length !== nextCandidates.length ||
      nextCandidates.some((candidate, index) => candidate.command !== prevCommands[index]?.command);

    setCandidates(nextCandidates);
    candidatesRef.current = nextCandidates;
    if (changed) {
      setHighlightedIndexState(NO_SELECTION);
    } else {
      // Same list: keep the current selection, clamping if it now falls out of
      // range (e.g. the list shrank between ticks).
      setHighlightedIndexState((current) => {
        if (nextCandidates.length === 0) return NO_SELECTION;
        if (current === NO_SELECTION) return NO_SELECTION;
        return Math.min(current, nextCandidates.length - 1);
      });
    }
  }, [enabled, getInputState, isActive, paneId]);

  useEffect(() => {
    refresh();
    if (!enabled || !isActive) return;

    const interval = window.setInterval(refresh, 80);
    return () => {
      window.clearInterval(interval);
    };
  }, [enabled, isActive, refresh]);

  const close = useCallback(() => {
    setCandidates([]);
    candidatesRef.current = [];
    setHighlightedIndexState(NO_SELECTION);
  }, []);

  const moveHighlight = useCallback((delta: number) => {
    setHighlightedIndexState((current) => {
      if (candidates.length === 0) return NO_SELECTION;
      // From the unselected state, ArrowDown selects the first row and
      // ArrowUp selects the last — mirroring typical menu behavior.
      if (current === NO_SELECTION) {
        return delta > 0 ? 0 : candidates.length - 1;
      }
      return (current + delta + candidates.length) % candidates.length;
    });
  }, [candidates.length]);

  const setHighlightedIndex = useCallback((index: number) => {
    setHighlightedIndexState(() => {
      if (candidates.length === 0) return NO_SELECTION;
      return Math.max(0, Math.min(index, candidates.length - 1));
    });
  }, [candidates.length]);

  const accept = useCallback((): boolean => {
    if (highlightedIndex === NO_SELECTION) return false;
    const input = getInputState();
    const candidate = candidates[highlightedIndex];
    if (!candidate || !input.isCursorAtEnd) return false;

    const query = input.value.trimStart();
    if (!query || !candidate.command.startsWith(query)) return false;

    const suffix = candidate.command.slice(query.length);
    if (!suffix) return false;

    sendInput(suffix);
    acceptCompletion(suffix);
    close();
    return true;
  }, [acceptCompletion, candidates, close, getInputState, highlightedIndex, sendInput]);

  return useMemo(() => ({
    accept,
    candidates,
    close,
    highlightedIndex,
    moveHighlight,
    open,
    refresh,
    setHighlightedIndex,
  }), [
    accept,
    candidates,
    close,
    highlightedIndex,
    moveHighlight,
    open,
    refresh,
    setHighlightedIndex,
  ]);
}
