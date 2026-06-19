import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/orchestrator/ledger', () => ({
  getRecentAiCommandRecords: () => [],
}));

import {
  clearTerminalAutosuggestHistory,
  getTerminalAutosuggestCandidates,
  getTerminalAutosuggestion,
  isLikelySecretCommand,
  recordTerminalAutosuggestCommand,
  TerminalAutosuggestInputTracker,
} from '@/lib/terminal/autosuggest';
import { readTerminalPromptInput } from '@/lib/terminal/autosuggest/promptReadback';
import {
  cleanupShellIntegration,
  createShellIntegrationController,
} from '@/lib/terminal/shellIntegration';

const fakeSecret = (...parts: string[]) => parts.join('');

describe('terminal autosuggest', () => {
  beforeEach(() => {
    clearTerminalAutosuggestHistory();
    cleanupShellIntegration('pane-1');
  });

  it('tracks editable command input and records completed commands', () => {
    const tracker = new TerminalAutosuggestInputTracker();

    expect(tracker.applyData('git st')).toMatchObject({ changed: true });
    expect(tracker.getState()).toMatchObject({
      value: 'git st',
      cursorIndex: 6,
      isCursorAtEnd: true,
    });

    tracker.applyData('atus');
    expect(tracker.getState().value).toBe('git status');

    const result = tracker.applyData('\r');
    expect(result.completedCommand).toBe('git status');
    expect(tracker.getState().value).toBe('');
  });

  it('ignores up and down arrow escape sequences in the input tracker', () => {
    const tracker = new TerminalAutosuggestInputTracker();

    tracker.applyData('git st');
    expect(tracker.applyData('\x1b[A')).toMatchObject({ changed: false });
    expect(tracker.applyData('\x1b[B')).toMatchObject({ changed: false });

    expect(tracker.getState()).toMatchObject({
      value: 'git st',
      cursorIndex: 6,
      isCursorAtEnd: true,
    });
  });

  it('syncs tracker state from terminal prompt readback after shell completion rewrites the line', () => {
    const tracker = new TerminalAutosuggestInputTracker();
    tracker.applyData('cd co');

    const term = createMockTerminal({
      line: 'tester@host:~/work$ cd code/',
      cursorX: 'tester@host:~/work$ cd code/'.length,
    });
    const promptInput = readTerminalPromptInput(term, 'pane-1', tracker.getState());

    expect(promptInput).toMatchObject({
      value: 'cd code/',
      cursorIndex: 8,
      isCursorAtEnd: true,
    });
    tracker.sync(promptInput!.value, promptInput!.cursorIndex);
    expect(tracker.getState().value).toBe('cd code/');
  });

  it('does not read terminal output as prompt input while shell integration is in output state', () => {
    const tracker = new TerminalAutosuggestInputTracker();
    tracker.applyData('cd co');
    const term = createMockTerminal({
      line: 'code',
      cursorX: 'code'.length,
    });
    const controller = createShellIntegrationController({
      term,
      paneId: 'pane-1',
      sessionId: 'session-1',
    });

    controller.handleOsc633('A');
    controller.handleOsc633('B');
    controller.handleOsc633('E;cd%20code/');

    expect(readTerminalPromptInput(term, 'pane-1', tracker.getState())).toBeNull();
  });

  it('only offers suffix ghost text for prefix matches', () => {
    recordTerminalAutosuggestCommand('git status');
    recordTerminalAutosuggestCommand('git stash list');

    expect(getTerminalAutosuggestion('git sta')).toBeTruthy();
    expect(getTerminalAutosuggestion('git status')).toBeNull();
  });

  it('deduplicates and ranks recent command history', () => {
    recordTerminalAutosuggestCommand('pnpm test');
    recordTerminalAutosuggestCommand('pnpm test');
    recordTerminalAutosuggestCommand('pnpm exec tsc --noEmit');

    const matches = getTerminalAutosuggestCandidates('pnpm', 10);
    expect(matches.map((match) => match.command)).toEqual([
      'pnpm test',
      'pnpm exec tsc --noEmit',
    ]);
  });

  it('keeps cwd-scoped runtime commands out of other directories', () => {
    recordTerminalAutosuggestCommand('pnpm dev', 'runtime', '/work/app-a');
    recordTerminalAutosuggestCommand('pnpm build', 'runtime', '/work/app-b');
    recordTerminalAutosuggestCommand('pnpm install', 'local-history');

    expect(getTerminalAutosuggestCandidates('pnpm', 10, '/work/app-a').map((match) => match.command)).toEqual([
      'pnpm dev',
      'pnpm install',
    ]);
    expect(getTerminalAutosuggestCandidates('pnpm', 10, '/work/app-b').map((match) => match.command)).toEqual([
      'pnpm build',
      'pnpm install',
    ]);
  });

  it('prefers cwd-specific history over global history for the same command', () => {
    recordTerminalAutosuggestCommand('make test', 'local-history');
    recordTerminalAutosuggestCommand('make test', 'runtime', '/work/project');

    const [match] = getTerminalAutosuggestCandidates('make', 10, '/work/project');

    expect(match).toMatchObject({
      command: 'make test',
      cwd: '/work/project',
    });
  });

  it('returns recent history when the query is empty', () => {
    recordTerminalAutosuggestCommand('git status');
    recordTerminalAutosuggestCommand('ls -la');

    const matches = getTerminalAutosuggestCandidates('', 10);
    expect(matches.map((match) => match.command)).toEqual([
      'ls -la',
      'git status',
    ]);
  });

  it('filters likely secret commands from suggestions', () => {
    recordTerminalAutosuggestCommand('curl -H "Authorization: Bearer abc" https://example.com');
    recordTerminalAutosuggestCommand('export ' + fakeSecret('OPENAI', '_API', '_KEY') + '=' + fakeSecret('sk', '-test'));
    recordTerminalAutosuggestCommand('ls -la');

    expect(isLikelySecretCommand('cmd --password hunter2')).toBe(true);
    expect(getTerminalAutosuggestCandidates('curl')).toEqual([]);
    expect(getTerminalAutosuggestCandidates('export')).toEqual([]);
    expect(getTerminalAutosuggestion('ls')).toBe(' -la');
  });
});

function createMockTerminal(options: { line: string; cursorX?: number }) {
  const activeBuffer = {
    type: 'normal',
    baseY: 0,
    cursorY: 0,
    cursorX: options.cursorX ?? options.line.length,
    getLine: vi.fn(() => ({
      translateToString: () => options.line,
    })),
  };
  const marker = {
    line: 0,
    isDisposed: false,
    dispose: vi.fn(),
    onDispose: vi.fn(),
  };

  return {
    cols: 120,
    rows: 24,
    buffer: { active: activeBuffer },
    modes: { mouseTrackingMode: 'none' },
    registerMarker: vi.fn(() => marker),
    registerDecoration: vi.fn(() => ({
      dispose: vi.fn(),
      onRender: vi.fn(),
    })),
  } as never;
}
