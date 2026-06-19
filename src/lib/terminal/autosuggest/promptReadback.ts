// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import type { Terminal } from '@xterm/xterm';
import {
  getShellIntegrationCommandStart,
  getShellIntegrationStatus,
} from '@/lib/terminal/shellIntegration';
import type { TerminalAutosuggestInputState } from './types';

const PROMPT_COMMAND_PREFIX = /^[\s❯➜λ>$#%❮›»]+/u;
const PROMPT_MARKERS = ['$', '#', '%', '>', '❯', '➜', 'λ', '❮', '›', '»'];

function lineText(term: Terminal, row: number): string {
  return term.buffer.active.getLine(row)?.translateToString(true) ?? '';
}

function absoluteCursorRow(term: Terminal): number {
  return term.buffer.active.baseY + term.buffer.active.cursorY;
}

function readFromShellIntegrationStart(term: Terminal, paneId: string): TerminalAutosuggestInputState | null {
  const commandStart = getShellIntegrationCommandStart(paneId);
  if (!commandStart) return null;

  const cursorRow = absoluteCursorRow(term);
  if (cursorRow < commandStart.line) return null;

  const lines: string[] = [];
  for (let row = commandStart.line; row <= cursorRow; row += 1) {
    const text = lineText(term, row);
    if (row === commandStart.line) {
      lines.push(text.slice(Math.max(0, commandStart.col)));
    } else if (row === cursorRow) {
      lines.push(text.slice(0, term.buffer.active.cursorX));
    } else {
      lines.push(text);
    }
  }

  const value = lines.join('').trimEnd();
  return {
    value,
    cursorIndex: value.length,
    isCursorAtEnd: true,
  };
}

function readFromCurrentLine(term: Terminal, currentValue: string): TerminalAutosuggestInputState | null {
  const cursorRow = absoluteCursorRow(term);
  const textBeforeCursor = lineText(term, cursorRow).slice(0, term.buffer.active.cursorX);
  const trimmedCurrent = currentValue.trimStart();
  if (!trimmedCurrent || !textBeforeCursor.trim()) {
    return null;
  }

  const index = textBeforeCursor.lastIndexOf(trimmedCurrent);
  if (index >= 0) {
    const value = textBeforeCursor.slice(index).trimEnd();
    return {
      value,
      cursorIndex: value.length,
      isCursorAtEnd: true,
    };
  }

  const markerIndex = Math.max(...PROMPT_MARKERS.map((marker) => textBeforeCursor.lastIndexOf(marker)));
  if (markerIndex < 0 && !PROMPT_COMMAND_PREFIX.test(textBeforeCursor)) {
    return null;
  }

  const rawValue = markerIndex >= 0
    ? textBeforeCursor.slice(markerIndex + 1)
    : textBeforeCursor.replace(PROMPT_COMMAND_PREFIX, '');
  const value = rawValue.trimStart().trimEnd();
  return {
    value,
    cursorIndex: value.length,
    isCursorAtEnd: true,
  };
}

export function readTerminalPromptInput(
  term: Terminal,
  paneId: string,
  currentState: TerminalAutosuggestInputState,
): TerminalAutosuggestInputState | null {
  if (term.buffer.active.type === 'alternate' || term.modes.mouseTrackingMode !== 'none') {
    return null;
  }

  const shellIntegrationStatus = getShellIntegrationStatus(paneId);
  if (
    shellIntegrationStatus.detected
    && shellIntegrationStatus.state !== 'prompt'
    && shellIntegrationStatus.state !== 'command'
  ) {
    return null;
  }

  return readFromShellIntegrationStart(term, paneId) ?? readFromCurrentLine(term, currentState.value);
}
