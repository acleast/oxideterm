import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/orchestrator/ledger', () => ({
  getRecentAiCommandRecords: () => [],
}));

vi.mock('@/lib/terminalRegistry', () => ({
  getCwd: vi.fn(() => '/work/app'),
}));

import { useTerminalCompletionOverlay } from '@/hooks/useTerminalCompletionOverlay';
import {
  clearTerminalAutosuggestHistory,
  recordTerminalAutosuggestCommand,
  type TerminalAutosuggestInputState,
} from '@/lib/terminal/autosuggest';

function inputState(value: string): TerminalAutosuggestInputState {
  return {
    value,
    cursorIndex: value.length,
    isCursorAtEnd: true,
  };
}

describe('useTerminalCompletionOverlay', () => {
  beforeEach(() => {
    clearTerminalAutosuggestHistory();
    recordTerminalAutosuggestCommand('git status');
  });

  it('does not open from tracked input when the terminal line is not a shell prompt', async () => {
    const { result } = renderHook(() => useTerminalCompletionOverlay({
      enabled: true,
      isActive: true,
      isShellMode: true,
      paneId: 'pane-1',
      getInputState: () => inputState('git'),
      getPromptInputState: () => null,
      acceptCompletion: vi.fn(),
      sendInput: vi.fn(),
    }));

    await waitFor(() => {
      expect(result.current.open).toBe(false);
      expect(result.current.candidates).toEqual([]);
    });
  });

  it('opens and accepts only while prompt input is available', async () => {
    const sendInput = vi.fn();
    const acceptCompletion = vi.fn();
    let promptInput: TerminalAutosuggestInputState | null = inputState('git');

    const { result } = renderHook(() => useTerminalCompletionOverlay({
      enabled: true,
      isActive: true,
      isShellMode: true,
      paneId: 'pane-1',
      getInputState: () => inputState('git'),
      getPromptInputState: () => promptInput,
      acceptCompletion,
      sendInput,
    }));

    await waitFor(() => expect(result.current.open).toBe(true));

    act(() => {
      result.current.moveHighlight(1);
    });
    act(() => {
      expect(result.current.accept()).toBe(true);
    });
    expect(sendInput).toHaveBeenCalledWith(' status');
    expect(acceptCompletion).toHaveBeenCalledWith(' status');

    promptInput = null;
    act(() => {
      result.current.refresh();
    });
    expect(result.current.open).toBe(false);
  });
});
