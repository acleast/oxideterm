// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import { useCallback, useEffect, useRef } from 'react';
import {
  ensureRuntimeHistoryLoaded,
  importTerminalAutosuggestCommands,
  loadLocalShellHistoryCommands,
  recordTerminalAutosuggestCommand,
  TerminalAutosuggestInputTracker,
} from '@/lib/terminal/autosuggest';
import type { TerminalAutosuggestInputState } from '@/lib/terminal/autosuggest';
import { getCwd } from '@/lib/terminalRegistry';

type TerminalKind = 'terminal' | 'local_terminal';

export function useTerminalAutosuggestRecorder(options: {
  terminalKind: TerminalKind;
  localShellHistory: boolean;
  paneId: string;
}) {
  const { terminalKind, localShellHistory, paneId } = options;
  const trackerRef = useRef(new TerminalAutosuggestInputTracker());

  const observeInput = useCallback((data: string) => {
    const result = trackerRef.current.applyData(data);
    if (result.completedCommand) {
      recordTerminalAutosuggestCommand(result.completedCommand, 'runtime', getCwd(paneId));
    }
    return result;
  }, [paneId]);

  const resetInput = useCallback(() => {
    trackerRef.current.reset();
  }, []);

  // Expose the live input state for the native completion overlay. The tracker
  // mirrors what the user has typed into the prompt (best-effort: backspace,
  // Ctrl+U/K/A/E, arrows, Enter reset, ESC reset are all handled). Read this
  // on each `changed` tick to refresh candidates without a separate data path.
  const getInputState = useCallback((): TerminalAutosuggestInputState => {
    return trackerRef.current.getState();
  }, []);

  // After the overlay accepts a completion we send the remaining bytes to the
  // PTY via sendInput — which bypasses `term.onData`, so the tracker would
  // otherwise never learn the command grew. Sync it explicitly here.
  const acceptCompletion = useCallback((text: string) => {
    trackerRef.current.accept(text);
  }, []);

  useEffect(() => {
    // Restore persisted runtime history once per process so commands from
    // previous sessions (including SSH sessions, which have no local shell
    // file to read) resurface. ensureRuntimeHistoryLoaded is idempotent.
    void ensureRuntimeHistoryLoaded();

    if (terminalKind !== 'local_terminal' || !localShellHistory) return;
    let cancelled = false;
    void loadLocalShellHistoryCommands().then((commands) => {
      if (!cancelled) {
        importTerminalAutosuggestCommands(commands, 'local-history');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [localShellHistory, paneId, terminalKind]);

  return { observeInput, resetInput, getInputState, acceptCompletion };
}
