// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import React, { useMemo } from 'react';
import type {
  TerminalAutosuggestCandidate,
  TerminalAutosuggestPosition,
} from '@/lib/terminal/autosuggest';

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
    const width = Math.min(560, Math.max(220, longest * 9 + 54));
    return { width };
  }, [candidates]);

  if (!position || candidates.length === 0) return null;

  const top = position.top + position.lineHeight;
  const left = clampPopupLeft(position.left, popupMetrics.width);

  return (
    <div
      role="listbox"
      aria-label="Command suggestions"
      className="fixed z-[120] overflow-hidden rounded-none border border-zinc-500/40 bg-[#171717]/95 font-mono shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur-[1px]"
      style={{
        left,
        top,
        width: popupMetrics.width,
        maxWidth: 'calc(100vw - 16px)',
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
            className={[
              'grid h-[28px] w-full grid-cols-[minmax(0,1fr)_32px] items-center border-0 bg-transparent p-0 text-left text-[15px] leading-none tracking-normal outline-none transition-colors',
              highlighted ? 'bg-[#2d303a]' : 'hover:bg-[#24262d]',
            ].join(' ')}
            onMouseEnter={() => onHoverIndex(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick();
            }}
          >
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre px-[6px] text-[#d8d8d8]">
              <span className="text-[#f0f0f0]">{currentInput}</span>
              {suffix && <span className="text-[#d8d8d8]">{suffix}</span>}
            </span>
            <span
              aria-hidden="true"
              className={[
                'flex h-full items-center justify-center border-l border-[#171717]/40 text-[14px] font-semibold text-white',
                highlighted ? 'bg-[#f2858d]' : 'bg-[#ec7f88]',
              ].join(' ')}
            >
              {sourceLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
};
