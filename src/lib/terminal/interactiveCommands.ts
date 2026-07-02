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
  return baseName.replace(/\.(?:cmd|exe)$/i, '').toLowerCase();
}

function firstExecutableToken(commandLine: string): string | null {
  const parsed = tokenizeCommandLine(commandLine.trim());
  for (const token of parsed.tokens) {
    const value = token.value.trim();
    if (!value || value === '&&' || value === '||' || value === ';' || value === '|') continue;
    if (ENV_ASSIGNMENT.test(value)) continue;

    const command = normalizeCommandName(value);
    if (COMMAND_WRAPPERS.has(command)) continue;
    if (command === 'env') continue;
    return command;
  }
  return null;
}

export function shouldSuppressTerminalAutosuggestForCommand(commandLine: string): boolean {
  const command = firstExecutableToken(commandLine);
  return command ? INTERACTIVE_COMMANDS.has(command) : false;
}
