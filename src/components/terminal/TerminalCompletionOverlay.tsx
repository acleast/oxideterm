// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import React, { useMemo } from 'react';
import type {
  TerminalAutosuggestCandidate,
  TerminalAutosuggestPosition,
} from '@/lib/terminal/autosuggest';
import { cn } from '@/lib/utils';
import { getFontFamily } from '@/lib/fontFamily';
import { useSettingsStore } from '@/store/settingsStore';

interface TerminalCompletionOverlayProps {
  candidates: TerminalAutosuggestCandidate[];
  highlightedIndex: number;
  currentInput: string;
  position: TerminalAutosuggestPosition | null;
  onHoverIndex: (index: number) => void;
  onPick: () => void;
}

const SOURCE_LABELS: Record<TerminalAutosuggestCandidate['source'], string> = {
  runtime: 'h',
  'local-history': 'h',
  'ai-ledger': 'ai',
};

function clampPopupLeft(left: number, width: number): number {
  if (typeof window === 'undefined') return left;
  const margin = 8;
  return Math.max(margin, Math.min(left, window.innerWidth - width - margin));
}

function commandSuffix(command: string, currentInput: string): string {
  const query = currentInput.trimStart();
  if (!query || !command.startsWith(query)) return command;
  return command.slice(query.length);
}

export const TerminalCompletionOverlay: React.FC<TerminalCompletionOverlayProps> = ({
  candidates,
  highlightedIndex,
  currentInput,
  position,
  onHoverIndex,
  onPick,
}) => {
  const popupMetrics = useMemo(() => {
    const longest = candidates.reduce((max, candidate) => Math.max(max, candidate.command.length), 0);
    const width = Math.min(560, Math.max(220, longest * 9 + 74));
    return { width };
  }, [candidates]);

  // Match the terminal's configured font so the popup aligns with the prompt
  // text beneath it (character widths, ligatures, Nerd Font glyphs).
  const fontFamily = useSettingsStore(
    (state) =>
      getFontFamily(state.settings.terminal.fontFamily, state.settings.terminal.customFontFamily),
  );

  if (!position || candidates.length === 0) return null;

  const top = position.top + position.lineHeight;
  const left = clampPopupLeft(position.left, popupMetrics.width);

  return (
    <div
      role="listbox"
      aria-label="Command suggestions"
      className="fixed z-[120] overflow-hidden rounded-none border border-zinc-500/40 bg-[#171717]/95 shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur-[1px]"
      style={{
        left,
        top,
        width: popupMetrics.width,
        maxWidth: 'calc(100vw - 16px)',
        fontFamily,
      }}
    >
      {candidates.map((candidate, index) => {
        const highlighted = index === highlightedIndex;
        const suffix = commandSuffix(candidate.command, currentInput);
        const sourceLabel = SOURCE_LABELS[candidate.source];

        return (
          <button
            key={`${candidate.source}:${candidate.command}`}
            type="button"
            role="option"
            aria-selected={highlighted}
            className={cn(
              'grid h-[28px] w-full grid-cols-[20px_minmax(0,1fr)_32px] items-center border-0 p-0 text-left text-[15px] leading-none tracking-normal outline-none transition-colors',
              highlighted
                ? 'bg-[#0d3b66] text-white'
                : 'bg-transparent text-[#c8c8c8] hover:bg-[#24262d]',
            )}
            onMouseEnter={() => onHoverIndex(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick();
            }}
          >
            <span
              aria-hidden="true"
              className="flex h-full items-center justify-center text-[13px] leading-none text-[#5fb3ff]"
            >
              {highlighted ? '>' : ''}
            </span>
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre px-[4px]">
              <span className={highlighted ? 'text-white/70' : 'text-[#7a7a7a]'}>{currentInput}</span>
              {suffix && (
                <span className={highlighted ? 'text-white' : 'text-[#d8d8d8]'}>{suffix}</span>
              )}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'flex h-full items-center justify-center border-l border-black/30 text-[14px] font-semibold text-white',
                highlighted ? 'bg-[#f2858d]' : 'bg-[#ec7f88]/70',
              )}
            >
              {sourceLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
};
