import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FolderTree } from '@/components/sessionManager/FolderTree';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('FolderTree', () => {
  it('shows a visible create-group button and triggers the callback', async () => {
    const onRequestCreateGroup = vi.fn();

    render(
      <div className="h-[400px] w-[240px]">
        <FolderTree
          folderTree={[]}
          selectedGroup={null}
          expandedGroups={new Set()}
          totalCount={4}
          ungroupedCount={1}
          onSelectGroup={vi.fn()}
          onToggleExpand={vi.fn()}
          onRequestCreateGroup={onRequestCreateGroup}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'sessionManager.folder_tree.new_group' }));

    await waitFor(() => {
      expect(onRequestCreateGroup).toHaveBeenCalled();
    });
  });

  it('opens the context menu and triggers create group from the folder tree area', async () => {
    const onRequestCreateGroup = vi.fn();

    render(
      <div className="h-[400px] w-[240px]">
        <FolderTree
          folderTree={[]}
          selectedGroup={null}
          expandedGroups={new Set()}
          totalCount={4}
          ungroupedCount={1}
          onSelectGroup={vi.fn()}
          onToggleExpand={vi.fn()}
          onRequestCreateGroup={onRequestCreateGroup}
        />
      </div>,
    );

    fireEvent.contextMenu(screen.getByText('sessionManager.folder_tree.all_connections'));

    const menuItem = await screen.findByRole('menuitem', { name: 'sessionManager.folder_tree.new_group' });
    fireEvent.click(menuItem);

    await waitFor(() => {
      expect(onRequestCreateGroup).toHaveBeenCalled();
    });
  });

  it('renders nested groups when a parent folder is expanded', () => {
    const onSelectGroup = vi.fn();
    const onToggleExpand = vi.fn();

    render(
      <div className="h-[400px] w-[240px]">
        <FolderTree
          folderTree={[{
            name: 'Production',
            fullPath: 'Production',
            connectionCount: 2,
            children: [{
              name: 'Core',
              fullPath: 'Production/Core',
              connectionCount: 1,
              children: [],
            }],
          }]}
          selectedGroup={null}
          expandedGroups={new Set(['Production'])}
          totalCount={2}
          ungroupedCount={0}
          onSelectGroup={onSelectGroup}
          onToggleExpand={onToggleExpand}
          onRequestCreateGroup={vi.fn()}
        />
      </div>,
    );

    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText('Core')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Core'));

    expect(onSelectGroup).toHaveBeenCalledWith('Production/Core');
    expect(onToggleExpand).not.toHaveBeenCalled();
  });
});
