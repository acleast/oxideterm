// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getTerminalAutosuggestCandidates,
  type TerminalAutosuggestCandidate,
  type TerminalAutosuggestInputState,
} from '@/lib/terminal/autosuggest';

const COMPLETION_LIMIT = 8;

export function useTerminalCompletionOverlay(options: {
  enabled: boolean;
  isActive: boolean;
  getInputState: () => TerminalAutosuggestInputState;
  acceptCompletion: (text: string) => void;
  sendInput: (suffix: string) => void;
}) {
  const { enabled, isActive, getInputState, acceptCompletion, sendInput } = options;
  const [candidates, setCandidates] = useState<TerminalAutosuggestCandidate[]>([]);
  const [highlightedIndex, setHighlightedIndexState] = useState(0);
  const lastInputRef = useRef<TerminalAutosuggestInputState>(getInputState());

  const open = enabled && isActive && candidates.length > 0;

  const refresh = useCallback(() => {
    const input = getInputState();
    lastInputRef.current = input;

    if (!enabled || !isActive || !input.isCursorAtEnd) {
      setCandidates([]);
      setHighlightedIndexState(0);
      return;
    }

    const query = input.value.trimStart();
    if (!query) {
      setCandidates([]);
      setHighlightedIndexState(0);
      return;
    }

    const lowerQuery = query.toLowerCase();
    const nextCandidates = getTerminalAutosuggestCandidates(query, COMPLETION_LIMIT)
      .filter((candidate) => {
        const lowerCommand = candidate.command.toLowerCase();
        return lowerCommand.startsWith(lowerQuery) && lowerCommand !== lowerQuery;
      });
    setCandidates(nextCandidates);
    setHighlightedIndexState((current) => {
      if (nextCandidates.length === 0) return 0;
      return Math.min(current, nextCandidates.length - 1);
    });
  }, [enabled, getInputState, isActive]);

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
    setHighlightedIndexState(0);
  }, []);

  const moveHighlight = useCallback((delta: number) => {
    setHighlightedIndexState((current) => {
      if (candidates.length === 0) return 0;
      return (current + delta + candidates.length) % candidates.length;
    });
  }, [candidates.length]);

  const setHighlightedIndex = useCallback((index: number) => {
    setHighlightedIndexState(() => {
      if (candidates.length === 0) return 0;
      return Math.max(0, Math.min(index, candidates.length - 1));
    });
  }, [candidates.length]);

  const accept = useCallback((): boolean => {
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
