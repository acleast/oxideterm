// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import { useTranslation } from 'react-i18next';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Download,
  GitBranch,
  LayoutGrid,
  List,
  Network,
  Plus,
  Search,
  Upload,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useAppStore } from '../../store/appStore';
import { BatchActionsMenu } from './BatchActionsMenu';
import type { ConnectionInfo } from '../../types';
import type { SessionManagerViewMode, SortDirection, SortField } from './useSessionManager';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

type ManagerToolbarProps = {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedIds: Set<string>;
  allConnections: ConnectionInfo[];
  groups: string[];
  onRefresh: () => Promise<void>;
  onClearSelection: () => void;
  onShowImport: () => void;
  onShowExport: () => void;
  viewMode: SessionManagerViewMode;
  onViewModeChange: (mode: SessionManagerViewMode) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  onToggleSort: (field: SortField) => void;
};

const SORT_FIELDS: SortField[] = [
  'name',
  'host',
  'port',
  'username',
  'auth_type',
  'group',
  'last_used_at',
];

const sortLabelKey = (field: SortField) => {
  if (field === 'last_used_at') return 'sessionManager.table.last_used';
  return `sessionManager.table.${field}`;
};

export const ManagerToolbar = ({
  searchQuery,
  onSearchChange,
  selectedIds,
  allConnections,
  groups,
  onRefresh,
  onClearSelection,
  onShowImport,
  onShowExport,
  viewMode,
  onViewModeChange,
  sortField,
  sortDirection,
  onToggleSort,
}: ManagerToolbarProps) => {
  const { t } = useTranslation();
  const toggleModal = useAppStore(s => s.toggleModal);
  const ViewIcon = viewMode === 'tree' ? GitBranch : viewMode === 'list' ? List : LayoutGrid;
  const SortIcon = sortDirection === 'asc' ? ArrowUpAZ : ArrowDownAZ;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-theme-border bg-theme-bg shrink-0 flex-wrap">
      {/* Search */}
      <div className="relative flex-1 min-w-[160px] max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-text-muted pointer-events-none" />
        <Input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('sessionManager.toolbar.search_placeholder')}
          className="pl-8 h-8 text-sm"
        />
      </div>

      {/* New Connection */}
      <Button
        size="sm"
        onClick={() => toggleModal('newConnection', true)}
        className="gap-1.5 shrink-0"
      >
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">{t('sessionManager.toolbar.new_connection')}</span>
      </Button>

      {/* Auto-Route */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => toggleModal('autoRoute', true)}
        className="gap-1.5 shrink-0"
        title={t('sessionManager.toolbar.auto_route')}
      >
        <Network className="h-4 w-4" />
        <span className="hidden sm:inline">{t('sessionManager.toolbar.auto_route')}</span>
      </Button>

      {/* Sort */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            title={t(sortLabelKey(sortField))}
          >
            <SortIcon className="h-4 w-4" />
            <span className="hidden md:inline">{t(sortLabelKey(sortField))}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[176px]">
          {SORT_FIELDS.map((field) => (
            <DropdownMenuItem
              key={field}
              className="gap-2"
              onClick={() => onToggleSort(field)}
            >
              <span className="w-4 text-center">
                {sortField === field ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </span>
              {t(sortLabelKey(field))}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* View mode */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            title={t('sessionManager.views.mode_label')}
          >
            <ViewIcon className="h-4 w-4" />
            <span className="hidden md:inline">{t(`sessionManager.views.${viewMode}`)}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]">
          <DropdownMenuRadioGroup
            value={viewMode}
            onValueChange={(value) => onViewModeChange(value as SessionManagerViewMode)}
          >
            <DropdownMenuRadioItem value="grid" className="gap-2">
              <LayoutGrid className="h-4 w-4" />
              {t('sessionManager.views.grid')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="list" className="gap-2">
              <List className="h-4 w-4" />
              {t('sessionManager.views.list')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="tree" className="gap-2">
              <GitBranch className="h-4 w-4" />
              {t('sessionManager.views.tree')}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Batch actions (only when items are selected) */}
      {selectedIds.size > 0 && (
        <BatchActionsMenu
          selectedIds={selectedIds}
          allConnections={allConnections}
          groups={groups}
          onRefresh={onRefresh}
          onClearSelection={onClearSelection}
        />
      )}

      <div className="flex-1 min-w-0" />

      {/* Import / Export */}
      <Button variant="ghost" size="sm" onClick={onShowImport} className="gap-1.5 shrink-0" title={t('sessionManager.toolbar.import')}>
        <Download className="h-4 w-4" />
        <span className="hidden md:inline">{t('sessionManager.toolbar.import')}</span>
      </Button>
      <Button variant="ghost" size="sm" onClick={onShowExport} className="gap-1.5 shrink-0" title={t('sessionManager.toolbar.export')}>
        <Upload className="h-4 w-4" />
        <span className="hidden md:inline">{t('sessionManager.toolbar.export')}</span>
      </Button>
    </div>
  );
};
