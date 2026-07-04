// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import type { Terminal } from '@xterm/xterm';
import {
  getShellIntegrationCommandStart,
  getShellIntegrationStatus,
} from '@/lib/terminal/shellIntegration';
import type { TerminalAutosuggestInputState } from './types';

const PROMPT_MARKERS = ['$', '#', '%', '>', '❯', '➜', 'λ', '❮', '›', '»'];
const STRONG_PROMPT_MARKERS = ['$', '#', '%', '❯', '➜', 'λ', '❮', '›', '»'];
const SHELL_PROMPT_MARKERS = ['$', '#', '%'];
const SHELL_CONTEXT_RE = /[@:~\/\\\]\)]/u;

type PromptReadbackOptions = {
  allowEmptyPrompt?: boolean;
  requireStrongPromptMarker?: boolean;
  requireShellPromptMarker?: boolean;
};

function hasRequiredPromptMarker(text: string, options: PromptReadbackOptions): boolean {
  return findPromptMarkerIndex(text, options) >= 0;
}

function allowedPromptMarkers(options: PromptReadbackOptions): string[] {
  if (options.requireShellPromptMarker) return SHELL_PROMPT_MARKERS;
  if (options.requireStrongPromptMarker) return STRONG_PROMPT_MARKERS;
  return PROMPT_MARKERS;
}

function findPromptMarkerIndex(text: string, options: PromptReadbackOptions): number {
  const trimmedEnd = text.trimEnd();
  if (!trimmedEnd) return -1;

  const marker = [...trimmedEnd].at(-1);
  if (!marker || !allowedPromptMarkers(options).includes(marker)) return -1;

  const index = text.lastIndexOf(marker);
  if (options.requireShellPromptMarker && !looksLikeShellPromptPrefix(trimmedEnd.slice(0, -marker.length))) {
    return -1;
  }
  return index;
}

function looksLikeShellPromptPrefix(prefixBeforeMarker: string): boolean {
  const prefix = prefixBeforeMarker.trim();
  if (!prefix) return true;
  if (prefix.length > 120) return false;
  return SHELL_CONTEXT_RE.test(prefix);
}

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

function readFromCurrentLine(
  term: Terminal,
  currentValue: string,
  options: PromptReadbackOptions = {},
): TerminalAutosuggestInputState | null {
  const cursorRow = absoluteCursorRow(term);
  const textBeforeCursor = lineText(term, cursorRow).slice(0, term.buffer.active.cursorX);
  const trimmedCurrent = currentValue.trimStart();
  if (!textBeforeCursor.trim()) {
    return null;
  }
  if (!trimmedCurrent && !options.allowEmptyPrompt) {
    return null;
  }

  if (trimmedCurrent) {
    const index = textBeforeCursor.lastIndexOf(trimmedCurrent);
    if (index >= 0) {
      const promptPrefix = textBeforeCursor.slice(0, index);
      if (!hasRequiredPromptMarker(promptPrefix, options)) {
        return null;
      }
      const value = textBeforeCursor.slice(index).trimEnd();
      return {
        value,
        cursorIndex: value.length,
        isCursorAtEnd: true,
      };
    }
  }

  const promptMarkerIndex = findPromptMarkerIndex(textBeforeCursor, options);
  if (promptMarkerIndex < 0) {
    return null;
  }

  const rawValue = textBeforeCursor.slice(promptMarkerIndex + 1);
  const value = rawValue.trimStart().trimEnd();
  if (!value && !options.allowEmptyPrompt) {
    return null;
  }
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
  options: PromptReadbackOptions = {},
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

  return readFromShellIntegrationStart(term, paneId) ?? readFromCurrentLine(term, currentState.value, options);
}
