// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import type { SavedPrivilegeCredential } from '@/types';

export type PrivilegePromptMatch =
  | {
      kind: 'sudo_password';
      username?: string;
      promptText: string;
    }
  | {
      kind: 'su_password';
      targetUser?: string;
      promptText: string;
    }
  | {
      kind: 'custom_prompt';
      credentialId: string;
      promptText: string;
    };

export type MatchedPrivilegeCredential = {
  prompt: PrivilegePromptMatch;
  credential: SavedPrivilegeCredential;
};

const MAX_PROMPT_TAIL_CHARS = 4_096;
const PASSWORD_RESULT_RE = /\b(password|密码)\b.*\b(accepted|changed|updated|success|failed|incorrect|denied)\b/i;
const SUDO_PROMPT_RE = /^\s*(?:\[sudo\]\s*)?password\s+for\s+([^:\n]+):\s*$/i;
const LOCALIZED_SUDO_PROMPT_RE = /^\s*\[sudo\]\s*(.+?)\s*的密码[:：]\s*$/;
const SU_PREFIX_PROMPT_RE = /^\s*su:\s*password:\s*$/i;
const GENERIC_PASSWORD_PROMPT_RE = /^\s*(?:password|密码)[:：]\s*$/i;

export function detectPrivilegePrompt(text: string): PrivilegePromptMatch | undefined {
  const tail = text.slice(-MAX_PROMPT_TAIL_CHARS);
  const line = tail
    .split('\n')
    .map(value => value.trim())
    .filter(Boolean)
    .at(-1);

  if (!line || PASSWORD_RESULT_RE.test(line)) {
    return undefined;
  }

  const sudoMatch = SUDO_PROMPT_RE.exec(line);
  if (sudoMatch) {
    return {
      kind: 'sudo_password',
      username: sudoMatch[1]?.trim(),
      promptText: line,
    };
  }

  const localizedSudoMatch = LOCALIZED_SUDO_PROMPT_RE.exec(line);
  if (localizedSudoMatch) {
    return {
      kind: 'sudo_password',
      username: localizedSudoMatch[1]?.trim(),
      promptText: line,
    };
  }

  if (SU_PREFIX_PROMPT_RE.test(line)) {
    return {
      kind: 'su_password',
      promptText: line,
    };
  }

  if (GENERIC_PASSWORD_PROMPT_RE.test(line) && recentCommandLooksLikePrivilegeRequest(tail)) {
    return {
      kind: 'su_password',
      promptText: line,
    };
  }

  return undefined;
}

export function findPrivilegeCredentialForPrompt(
  text: string,
  credentials: SavedPrivilegeCredential[],
): MatchedPrivilegeCredential | undefined {
  return findPrivilegeCredentialsForPrompt(text, credentials)[0];
}

export function findPrivilegeCredentialsForPrompt(
  text: string,
  credentials: SavedPrivilegeCredential[],
): MatchedPrivilegeCredential[] {
  const prompt = detectPrivilegePrompt(text);
  if (!prompt) return [];

  const matches = credentials.filter((candidate) => {
    if (!candidate.enabled) return false;
    if (prompt.kind === 'custom_prompt') {
      return candidate.id === prompt.credentialId;
    }
    if (candidate.kind !== prompt.kind && candidate.kind !== 'custom_prompt') {
      return false;
    }
    if (candidate.kind === 'custom_prompt') {
      return promptMatchesCustomPatterns(prompt.promptText, candidate.prompt_patterns);
    }
    if (candidate.username_hint && 'username' in prompt) {
      return candidate.username_hint === prompt.username;
    }
    return true;
  });

  return matches.map((credential) => ({ prompt, credential }));
}

function recentCommandLooksLikePrivilegeRequest(tail: string): boolean {
  return tail
    .split('\n')
    .slice(-6, -1)
    .some((line) => {
      const trimmed = line.trim();
      return /(?:^|\s)(sudo|su)(?:\s|$)/.test(trimmed);
    });
}

function promptMatchesCustomPatterns(promptText: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const normalized = promptText.toLowerCase();
  return patterns.some((pattern) => {
    const value = pattern.trim().toLowerCase();
    return value.length > 0 && normalized.includes(value);
  });
}
