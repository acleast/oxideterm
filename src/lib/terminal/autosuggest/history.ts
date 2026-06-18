// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import { getRecentAiCommandRecords } from '@/lib/ai/orchestrator/ledger';
import { isLikelySecretCommand } from './secrets';
import type { TerminalAutosuggestCandidate } from './types';

type HistoryEntry = {
  command: string;
  source: TerminalAutosuggestCandidate['source'];
  cwd: string | null;
  lastUsedAt: number;
  uses: number;
  sequence: number;
};

const MAX_HISTORY = 1000;
// Cap the on-disk runtime history independently. Runtime commands are the only
// source persisted (ai-ledger is re-seeded each session, local-history is read
// from shell files), so this bounds disk growth across sessions.
const MAX_PERSISTED_RUNTIME = 1000;
const PERSIST_DEBOUNCE_MS = 1500;
const PERSIST_FILENAME = 'autosuggest_runtime_history.json';
const entries = new Map<string, HistoryEntry>();
let sequenceCounter = 0;
// AI ledger is imported once per process lifetime; re-seeding every refresh
// tick would keep bumping sequence/lastUsedAt and distort ranking. Reset to
// false in clearTerminalAutosuggestHistory so a cleared store can re-seed.
let aiLedgerSeeded = false;
// Persisted runtime history: loaded once from disk on first use, debounced
// writes after each runtime record. `runtimeHistoryLoaded` guards the load so
// multiple panes don't race; `persistTimer` coalesces bursts of commands.
let runtimeHistoryLoaded = false;
let runtimeHistoryLoadPromise: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, ' ').trim();
}

function normalizeCwd(cwd: string | null | undefined): string | null {
  const normalized = cwd?.trim().replace(/\/+$/, '');
  return normalized || null;
}

function entryKey(command: string, cwd: string | null): string {
  return `${cwd ?? '*'}\0${command}`;
}

function putCommand(
  command: string,
  source: TerminalAutosuggestCandidate['source'],
  lastUsedAt = Date.now(),
  countUse = true,
  cwd?: string | null,
): void {
  const normalized = normalizeCommand(command);
  if (!normalized || normalized.length > 2000 || isLikelySecretCommand(normalized)) return;

  const normalizedCwd = normalizeCwd(cwd);
  const key = entryKey(normalized, normalizedCwd);
  const existing = entries.get(key);
  if (existing) {
    existing.lastUsedAt = Math.max(existing.lastUsedAt, lastUsedAt);
    existing.sequence = ++sequenceCounter;
    if (countUse) {
      existing.uses += 1;
    }
    return;
  }

  entries.set(key, {
    command: normalized,
    source,
    cwd: normalizedCwd,
    lastUsedAt,
    uses: 1,
    sequence: ++sequenceCounter,
  });
  if (entries.size > MAX_HISTORY) {
    const oldest = [...entries.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (oldest) entries.delete(entryKey(oldest.command, oldest.cwd));
  }
}

export function recordTerminalAutosuggestCommand(
  command: string,
  source: TerminalAutosuggestCandidate['source'] = 'runtime',
  cwd?: string | null,
): void {
  putCommand(command, source, Date.now(), true, cwd);
  // Only runtime commands are persisted across sessions; ai-ledger re-seeds
  // each launch and local-history is read from shell files on demand.
  if (source === 'runtime') {
    scheduleRuntimeHistoryPersist();
  }
}

export function importTerminalAutosuggestCommands(
  commands: Iterable<string>,
  source: TerminalAutosuggestCandidate['source'],
  cwd?: string | null,
): void {
  let offset = 0;
  for (const command of commands) {
    putCommand(command, source, Date.now() - offset, false, cwd);
    offset += 1;
  }
}

function seedFromAiLedger(): void {
  if (aiLedgerSeeded) return;
  for (const record of getRecentAiCommandRecords(80)) {
    putCommand(record.command, 'ai-ledger', record.finishedAt ?? record.startedAt, false);
  }
  aiLedgerSeeded = true;
}

function fuzzyScore(command: string, query: string): number {
  if (!query) return 0;
  if (command.startsWith(query)) return 1000 + query.length * 8;
  const lowerCommand = command.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (lowerCommand.startsWith(lowerQuery)) return 850 + query.length * 6;
  if (lowerCommand.includes(lowerQuery)) return 450 + query.length * 4;

  let qi = 0;
  let score = 0;
  for (let ci = 0; ci < lowerCommand.length && qi < lowerQuery.length; ci += 1) {
    if (lowerCommand[ci] === lowerQuery[qi]) {
      score += 20;
      qi += 1;
    }
  }
  return qi === lowerQuery.length ? score : 0;
}

export function getTerminalAutosuggestCandidates(
  query: string,
  limit = 8,
  cwd?: string | null,
): TerminalAutosuggestCandidate[] {
  const trimmed = query.trimStart();
  const normalizedCwd = normalizeCwd(cwd);

  seedFromAiLedger();
  const now = Date.now();
  const candidates: TerminalAutosuggestCandidate[] = [];
  for (const entry of entries.values()) {
    const cwdMatches = !entry.cwd || !normalizedCwd || entry.cwd === normalizedCwd;
    if (!cwdMatches) continue;

    const fuzzy = fuzzyScore(entry.command, trimmed);
    if (trimmed && (fuzzy <= 0 || entry.command === trimmed)) continue;
    const recency = Math.max(0, 200 - Math.floor((now - entry.lastUsedAt) / 60_000));
    const cwdBonus = normalizedCwd && entry.cwd === normalizedCwd ? 600 : 0;
    let score = (trimmed ? fuzzy + recency + entry.uses * 5 : recency + entry.uses * 5) + cwdBonus;

    // When the shell doesn't emit OSC 7 (e.g. Ubuntu's default bash), we have
    // no current cwd. cwdMatches then accepts every entry and cwdBonus is 0,
    // so ranking would fall back to recency + uses*5 alone — too weak to keep
    // high-frequency commands above a fresh one-shot. Boost uses weight and add
    // a 30-minute recency burst so recent + frequent commands surface. The
    // strict cwd-scoped path (Windows/macOS where OSC 7 is available) is left
    // untouched.
    if (!normalizedCwd) {
      const minutesAgo = Math.floor((now - entry.lastUsedAt) / 60_000);
      const recencyBurst = minutesAgo < 30 ? (30 - minutesAgo) * 8 : 0;
      score += entry.uses * 20 + recencyBurst;
    }
    score += entry.sequence / 1_000_000;
    candidates.push({
      command: entry.command,
      source: entry.source,
      cwd: entry.cwd,
      lastUsedAt: entry.lastUsedAt,
      score,
    });
  }

  const seenCommands = new Set<string>();
  const sorted = candidates
    .sort((a, b) => b.score - a.score || b.lastUsedAt - a.lastUsedAt || a.command.localeCompare(b.command));
  const unique: TerminalAutosuggestCandidate[] = [];
  for (const candidate of sorted) {
    if (seenCommands.has(candidate.command)) continue;
    seenCommands.add(candidate.command);
    unique.push(candidate);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function getTerminalAutosuggestion(input: string, cwd?: string | null): string | null {
  const query = input.trimStart();
  if (!query) return null;
  const leading = input.slice(0, input.length - query.length);
  const candidate = getTerminalAutosuggestCandidates(query, 1, cwd)[0];
  if (!candidate || !candidate.command.startsWith(query) || candidate.command === query) return null;
  return `${leading}${candidate.command}`.slice(input.length);
}

export function clearTerminalAutosuggestHistory(): void {
  entries.clear();
  sequenceCounter = 0;
  aiLedgerSeeded = false;
  // Cancel any pending write and wipe the persisted file so a cleared store
  // does not silently resurrect on next launch.
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  void persistRuntimeHistory([]);
}

/**
 * Load persisted runtime history from disk once per process. Safe to call from
 * any pane; concurrent callers share the same load promise. No-ops outside
 * Tauri (e.g. `pnpm dev`) where the filesystem APIs are unavailable.
 */
export function ensureRuntimeHistoryLoaded(): Promise<void> {
  if (runtimeHistoryLoaded) return Promise.resolve();
  if (runtimeHistoryLoadPromise) return runtimeHistoryLoadPromise;
  runtimeHistoryLoadPromise = loadRuntimeHistory().finally(() => {
    runtimeHistoryLoaded = true;
    runtimeHistoryLoadPromise = null;
  });
  return runtimeHistoryLoadPromise;
}

function scheduleRuntimeHistoryPersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistRuntimeHistory(collectPersistableRuntimeEntries());
  }, PERSIST_DEBOUNCE_MS);
}

function collectPersistableRuntimeEntries(): HistoryEntry[] {
  return [...entries.values()]
    .filter((entry) => entry.source === 'runtime')
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt || b.uses - a.uses)
    .slice(0, MAX_PERSISTED_RUNTIME);
}

async function resolvePersistPath(): Promise<string | null> {
  try {
    const pathApi = await import('@tauri-apps/api/path');
    const dir = await pathApi.appDataDir();
    return pathApi.join(dir, PERSIST_FILENAME);
  } catch {
    return null;
  }
}

async function loadRuntimeHistory(): Promise<void> {
  try {
    const filePath = await resolvePersistPath();
    if (!filePath) return;
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const raw = await readTextFile(filePath);
    const parsed = JSON.parse(raw) as Array<{
      command: string;
      cwd: string | null;
      lastUsedAt: number;
      uses: number;
    }>;
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (!item || typeof item.command !== 'string' || !item.command) continue;
      putCommand(item.command, 'runtime', item.lastUsedAt ?? Date.now(), false, item.cwd ?? null);
      // Restore use counts so frequency ranking survives restarts.
      const key = entryKey(normalizeCommand(item.command), normalizeCwd(item.cwd ?? null));
      const existing = entries.get(key);
      if (existing && typeof item.uses === 'number' && item.uses > existing.uses) {
        existing.uses = item.uses;
      }
    }
  } catch {
    // Missing/corrupt file on first run or non-Tauri env — nothing to restore.
  }
}

async function persistRuntimeHistory(items: HistoryEntry[]): Promise<void> {
  try {
    const filePath = await resolvePersistPath();
    if (!filePath) return;
    const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
    const { dirname } = await import('@tauri-apps/api/path');
    const dir = await dirname(filePath);
    try {
      await mkdir(dir, { recursive: true });
    } catch {
      // Directory likely already exists.
    }
    const payload = JSON.stringify(
      items.map((entry) => ({
        command: entry.command,
        cwd: entry.cwd,
        lastUsedAt: entry.lastUsedAt,
        uses: entry.uses,
      })),
    );
    await writeTextFile(filePath, payload);
  } catch {
    // Persistence is best-effort; never block command recording on disk errors.
  }
}
