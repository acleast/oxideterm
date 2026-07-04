// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import { tokenizeCommandLine } from './completion/tokenizer';

const INTERACTIVE_COMMANDS = new Set([
  'btop',
  'claude',
  'codex',
  'emacs',
  'emacsclient',
  'fzf',
  'htop',
  'info',
  'less',
  'lf',
  'man',
  'more',
  'nano',
  'nvim',
  'nvimdiff',
  'ranger',
  'top',
  'vi',
  'view',
  'vim',
  'vimdiff',
  'yazi',
]);

const COMMAND_WRAPPERS = new Set(['command', 'doas', 'exec', 'noglob', 'nohup', 'sudo', 'time']);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

function normalizeCommandName(value: string): string {
  const baseName = value.split('/').pop() ?? value;
  return baseName.replace(/\.(?:bat|cmd|com|exe|ps1)$/i, '').toLowerCase();
}

function isCommandSeparator(value: string): boolean {
  return value === '&&' || value === '||' || value === ';' || value === '|';
}

function executableTokens(commandLine: string): string[] {
  const parsed = tokenizeCommandLine(commandLine.trim());
  const commands: string[] = [];
  let expectCommand = true;

  for (const token of parsed.tokens) {
    const value = token.value.trim();
    if (!value) continue;
    if (isCommandSeparator(value)) {
      expectCommand = true;
      continue;
    }
    if (!expectCommand) continue;
    if (ENV_ASSIGNMENT.test(value)) continue;

    const command = normalizeCommandName(value);
    if (COMMAND_WRAPPERS.has(command)) continue;
    if (command === 'env') continue;
    commands.push(command);
    expectCommand = false;
  }

  return commands;
}

function splitShellCommandSegments(commandLine: string): string[] {
  const segments: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  const pushSegment = (end: number) => {
    const segment = commandLine.slice(start, end).trim();
    if (segment) segments.push(segment);
  };

  for (let index = 0; index < commandLine.length; index += 1) {
    const char = commandLine[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    const next = commandLine[index + 1];
    if ((char === '&' && next === '&') || (char === '|' && next === '|')) {
      pushSegment(index);
      index += 1;
      start = index + 1;
      continue;
    }

    if (char === ';' || char === '|') {
      pushSegment(index);
      start = index + 1;
    }
  }

  pushSegment(commandLine.length);
  return segments;
}

function commandLineExecutables(commandLine: string): string[] {
  return [...new Set(splitShellCommandSegments(commandLine).flatMap((segment) => executableTokens(segment)))];
}

export function shouldSuppressTerminalAutosuggestForCommand(commandLine: string): boolean {
  return commandLineExecutables(commandLine).some((command) => INTERACTIVE_COMMANDS.has(command));
}
