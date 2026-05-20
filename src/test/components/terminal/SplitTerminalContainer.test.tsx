import { describe, expect, it } from 'vitest';

import { getPaneLayoutKey } from '@/components/terminal/SplitTerminalContainer';
import type { PaneNode } from '@/types';

describe('getPaneLayoutKey', () => {
  it('changes when a nested split pane is removed', () => {
    const before: PaneNode = {
      type: 'group',
      id: 'root',
      direction: 'horizontal',
      children: [
        { type: 'leaf', id: 'pane-1', sessionId: 'local-1', terminalType: 'local_terminal' },
        {
          type: 'group',
          id: 'nested',
          direction: 'vertical',
          children: [
            { type: 'leaf', id: 'pane-2', sessionId: 'local-2', terminalType: 'local_terminal' },
            { type: 'leaf', id: 'pane-3', sessionId: 'local-3', terminalType: 'local_terminal' },
          ],
        },
      ],
    };
    const after: PaneNode = {
      type: 'group',
      id: 'root',
      direction: 'horizontal',
      children: [
        { type: 'leaf', id: 'pane-1', sessionId: 'local-1', terminalType: 'local_terminal' },
        { type: 'leaf', id: 'pane-3', sessionId: 'local-3', terminalType: 'local_terminal' },
      ],
    };

    expect(getPaneLayoutKey(after)).not.toBe(getPaneLayoutKey(before));
  });
});
