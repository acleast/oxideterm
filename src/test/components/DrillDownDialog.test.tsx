import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMutableSelectorStore } from '@/test/helpers/mockStore';

const apiMocks = vi.hoisted(() => ({
  treeDrillDown: vi.fn(),
  connectTreeNode: vi.fn(),
  getSavedConnectionForConnect: vi.fn(),
  markConnectionUsed: vi.fn(),
}));

const sessionTreeState = vi.hoisted(() => ({
  fetchTree: vi.fn().mockResolvedValue(undefined),
  expandManualPresetUnderParent: vi.fn(),
  connectNodeWithAncestors: vi.fn(),
  getRawNode: vi.fn(),
}));

const appStoreState = vi.hoisted(() => ({
  savedConnections: [] as Array<Record<string, unknown>>,
  loadSavedConnections: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/api', () => ({ api: apiMocks }));
vi.mock('@/store/sessionTreeStore', () => ({
  useSessionTreeStore: createMutableSelectorStore(sessionTreeState),
}));
vi.mock('@/store/appStore', () => ({
  useAppStore: createMutableSelectorStore(appStoreState),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'modals.drill_down.description' && options?.host) {
        return `connect from <host>${String(options.host)}</host>`;
      }
      return key;
    },
  }),
}));

import { DrillDownDialog } from '@/components/modals/DrillDownDialog';

describe('DrillDownDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appStoreState.savedConnections = [];
    sessionTreeState.fetchTree.mockResolvedValue(undefined);
    sessionTreeState.expandManualPresetUnderParent.mockResolvedValue({
      targetNodeId: 'node-saved-target',
      pathNodeIds: ['parent-1', 'node-saved-target'],
      chainDepth: 2,
    });
    sessionTreeState.connectNodeWithAncestors.mockResolvedValue(['parent-1', 'node-saved-target']);
    sessionTreeState.getRawNode.mockReturnValue({ sshConnectionId: 'ssh-saved-target' });
    apiMocks.treeDrillDown.mockResolvedValue('node-child');
    apiMocks.connectTreeNode.mockResolvedValue({
      nodeId: 'node-child',
      sshConnectionId: 'ssh-child',
    });
    apiMocks.markConnectionUsed.mockResolvedValue(undefined);
  });

  it('submits agentForwarding when enabled', async () => {
    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <DrillDownDialog
        parentNodeId="parent-1"
        parentHost="parent.example.com"
        open
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByLabelText('modals.drill_down.target_host *'), {
      target: { value: 'child.example.com' },
    });
    fireEvent.change(screen.getByLabelText('modals.drill_down.username *'), {
      target: { value: 'alice' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'modals.new_connection.agent_forwarding' }));
    fireEvent.click(screen.getByRole('button', { name: 'modals.drill_down.connect' }));

    await waitFor(() => {
      expect(apiMocks.treeDrillDown).toHaveBeenCalledWith(
        expect.objectContaining({
          parentNodeId: 'parent-1',
          host: 'child.example.com',
          username: 'alice',
          agentForwarding: true,
        }),
      );
    });

    expect(apiMocks.connectTreeNode).toHaveBeenCalledWith({
      nodeId: 'node-child',
      cols: 0,
      rows: 0,
    });
    expect(onSuccess).toHaveBeenCalledWith('node-child', 'ssh-child');
  });

  it('connects a saved connection as a next hop under the current parent', async () => {
    const onSuccess = vi.fn();
    appStoreState.savedConnections = [{
      id: 'saved-1',
      name: 'Saved DB',
      host: 'db.internal',
      port: 22,
      username: 'deploy',
      proxy_chain: [{ host: 'jump.internal' }],
    }];
    apiMocks.getSavedConnectionForConnect.mockResolvedValue({
      host: 'db.internal',
      port: 22,
      username: 'deploy',
      auth_type: 'agent',
      name: 'Saved DB',
      agent_forwarding: false,
      post_connect_command: null,
      proxy_chain: [{
        host: 'jump.internal',
        port: 22,
        username: 'jump',
        auth_type: 'agent',
        agent_forwarding: true,
      }],
    });

    render(
      <DrillDownDialog
        parentNodeId="parent-1"
        parentHost="parent.example.com"
        open
        onOpenChange={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Saved DB/ }));

    await waitFor(() => {
      expect(sessionTreeState.expandManualPresetUnderParent).toHaveBeenCalledWith({
        parentNodeId: 'parent-1',
        savedConnectionId: 'saved-1',
        hops: [expect.objectContaining({
          host: 'jump.internal',
          username: 'jump',
          authType: 'agent',
          agentForwarding: true,
        })],
        target: expect.objectContaining({
          host: 'db.internal',
          username: 'deploy',
          authType: 'agent',
        }),
      });
    });

    expect(apiMocks.treeDrillDown).not.toHaveBeenCalled();
    expect(sessionTreeState.connectNodeWithAncestors).toHaveBeenCalledWith('node-saved-target');
    expect(apiMocks.markConnectionUsed).toHaveBeenCalledWith('saved-1');
    expect(onSuccess).toHaveBeenCalledWith('node-saved-target', 'ssh-saved-target');
  });
});
