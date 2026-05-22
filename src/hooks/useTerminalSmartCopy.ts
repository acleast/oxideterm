// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import type { Terminal } from '@xterm/xterm';
import { matchAction } from '@/lib/keybindingRegistry';
import { platform } from '@/lib/platform';
import { writeSystemClipboardText } from '@/lib/clipboardSupport';

type Disposable = { dispose: () => void };
type SelectionDisposable = { dispose: () => void };

type TerminalSmartCopyOptions = {
  isActive: () => boolean;
  isEnabled: () => boolean;
  isCopyOnSelectEnabled?: () => boolean;
  isMiddleClickPasteEnabled?: () => boolean;
  onPasteShortcut?: () => void;
  onKeyEvent?: (event: KeyboardEvent) => boolean;
  container?: HTMLElement | null;
};

const COPY_ON_SELECT_DEBOUNCE_MS = 120;
const NBSP_RE = /\u00a0/g;

function isSmartCopyShortcut(event: KeyboardEvent): boolean {
  if (event.type !== 'keydown') return false;
  if (!(platform.isWindows || platform.isLinux)) return false;
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  return event.key.toLowerCase() === 'c';
}


function fallbackCopySelection(): void {
  if (typeof document.execCommand !== 'function') {
    console.warn('[Terminal] Clipboard fallback is unavailable in this environment');
    return;
  }

  try {
    const copied = document.execCommand('copy');
    if (!copied) {
      console.warn('[Terminal] Fallback copy did not report success');
    }
  } catch (error) {
    console.warn('[Terminal] Fallback copy failed:', error);
  }
}

export function getTerminalSelectionForClipboard(term: Terminal): string {
  const fallbackSelection = term.getSelection();
  const range = term.getSelectionPosition?.();
  if (!range) return fallbackSelection;

  const buffer = term.buffer?.active;
  if (!buffer || range.start.y > range.end.y) return fallbackSelection;

  const parts: string[] = [];
  for (let row = range.start.y; row <= range.end.y; row += 1) {
    const line = buffer.getLine(row);
    if (!line) return fallbackSelection;

    const startColumn = row === range.start.y ? range.start.x : 0;
    const endColumn = row === range.end.y ? range.end.x : undefined;
    const text = line.translateToString(true, startColumn, endColumn).replace(NBSP_RE, ' ');

    if (row !== range.start.y && line.isWrapped && parts.length > 0) {
      parts[parts.length - 1] += text;
    } else {
      parts.push(text);
    }
  }

  return parts.join(platform.isWindows ? '\r\n' : '\n');
}

function copyText(text: string): void {
  if (!text) return;

  void writeSystemClipboardText(text).then((written) => {
    if (!written) {
      fallbackCopySelection();
    }
  });
}

function consumeKeyboardEvent(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function consumeMouseEvent(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function installCopyOnSelect(
  term: Terminal,
  options: TerminalSmartCopyOptions,
): Disposable {
  if (!options.isCopyOnSelectEnabled) {
    return { dispose: () => undefined };
  }

  let copyTimer: number | null = null;
  const clearCopyTimer = () => {
    if (copyTimer !== null) {
      window.clearTimeout(copyTimer);
      copyTimer = null;
    }
  };

  const selectionDisposable: SelectionDisposable | undefined = term.onSelectionChange?.(() => {
    if (!options.isActive() || !options.isCopyOnSelectEnabled?.()) {
      clearCopyTimer();
      return;
    }

    const selection = term.getSelection();
    if (!selection) {
      clearCopyTimer();
      return;
    }

    clearCopyTimer();
    copyTimer = window.setTimeout(() => {
      copyTimer = null;
      const currentSelection = getTerminalSelectionForClipboard(term);
      if (!currentSelection || !options.isActive() || !options.isCopyOnSelectEnabled?.()) {
        return;
      }
      copyText(currentSelection);
    }, COPY_ON_SELECT_DEBOUNCE_MS);
  });

  return {
    dispose: () => {
      clearCopyTimer();
      selectionDisposable?.dispose();
    },
  };
}

function installMiddleClickPaste(
  term: Terminal,
  options: TerminalSmartCopyOptions,
): Disposable {
  const container = options.container;
  if (!container || !options.isMiddleClickPasteEnabled || !options.onPasteShortcut) {
    return { dispose: () => undefined };
  }

  const handleMouseUp = (event: MouseEvent) => {
    if (event.button !== 1) {
      return;
    }
    if (!options.isActive() || !options.isMiddleClickPasteEnabled?.()) {
      return;
    }
    if (term.modes.mouseTrackingMode !== 'none') {
      return;
    }

    consumeMouseEvent(event);
    options.onPasteShortcut?.();
  };

  container.addEventListener('mouseup', handleMouseUp);
  return {
    dispose: () => {
      container.removeEventListener('mouseup', handleMouseUp);
    },
  };
}

function installCopyEventNormalization(
  term: Terminal,
  options: TerminalSmartCopyOptions,
): Disposable {
  const container = options.container;
  if (!container) {
    return { dispose: () => undefined };
  }

  const handleCopy = (event: ClipboardEvent) => {
    if (!options.isActive() || !term.hasSelection()) {
      return;
    }

    const selection = getTerminalSelectionForClipboard(term);
    if (!selection || !event.clipboardData) {
      return;
    }

    event.clipboardData.setData('text/plain', selection);
    event.preventDefault();
    event.stopPropagation();
  };

  container.addEventListener('copy', handleCopy);
  return {
    dispose: () => {
      container.removeEventListener('copy', handleCopy);
    },
  };
}

export function attachTerminalSmartCopy(
  term: Terminal,
  options: TerminalSmartCopyOptions,
): Disposable {
  // xterm currently supports a single custom key handler per terminal.
  // We install smart copy once during terminal setup and remove it during the
  // same component cleanup path, so restoring the default pass-through handler
  // is safe as long as no other feature attaches a second custom handler.
  term.attachCustomKeyEventHandler((event) => {
    if (!options.isActive()) {
      return true;
    }

    if (options.onKeyEvent && !options.onKeyEvent(event)) {
      return false;
    }

    if (options.isEnabled() && isSmartCopyShortcut(event)) {
      if (!term.hasSelection()) {
        return true;
      }

      const selection = getTerminalSelectionForClipboard(term);
      if (!selection) {
        return true;
      }

      consumeKeyboardEvent(event);
      copyText(selection);
      return false;
    }

    if (options.onPasteShortcut && matchAction(event, 'terminal') === 'terminal.paste') {
      consumeKeyboardEvent(event);
      // Only the initial keydown should trigger paste. Matching keyup events
      // still need to be consumed so the native paste path does not run later.
      if (event.type === 'keydown' && !event.repeat) {
        options.onPasteShortcut();
      }
      return false;
    }

    return true;
  });

  const copyOnSelectDisposable = installCopyOnSelect(term, options);
  const middleClickPasteDisposable = installMiddleClickPaste(term, options);
  const copyEventDisposable = installCopyEventNormalization(term, options);

  return {
    dispose: () => {
      copyOnSelectDisposable.dispose();
      middleClickPasteDisposable.dispose();
      copyEventDisposable.dispose();
      term.attachCustomKeyEventHandler(() => true);
    },
  };
}
