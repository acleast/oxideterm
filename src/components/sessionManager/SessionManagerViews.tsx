// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Server,
  Trash2,
  Usb,
  Zap,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { ConnectionInfo, SerialProfile } from '../../types';
import type {
  FolderNode,
  SessionManagerViewMode,
  SortDirection,
  SortField,
} from './useSessionManager';

type SessionManagerViewsProps = {
  viewMode: SessionManagerViewMode;
  loading: boolean;
  connections: ConnectionInfo[];
  serialProfiles: SerialProfile[];
  searchQuery: string;
  sortField: SortField;
  sortDirection: SortDirection;
  selectedIds: Set<string>;
  folderTree: FolderNode[];
  expandedGroups: Set<string>;
  onToggleSelect: (id: string) => void;
  onConnect: (id: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (conn: ConnectionInfo) => void;
  onDelete: (conn: ConnectionInfo) => void;
  onTestConnection?: (conn: ConnectionInfo) => void;
  onOpenSerialProfile: (profile: SerialProfile) => void;
  onDeleteSerialProfile: (profile: SerialProfile) => void;
  onToggleExpand: (path: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onRequestCreateGroup: () => void;
};

type SessionManagerItem =
  | {
      kind: 'connection';
      id: string;
      name: string;
      subtitle: string;
      detail: string;
      group: string | null;
      lastUsed: string | null;
      sortHost: string;
      sortPort: number;
      sortUsername: string;
      sortAuth: string;
      color: string | null;
      connection: ConnectionInfo;
    }
  | {
      kind: 'serial';
      id: string;
      name: string;
      subtitle: string;
      detail: string;
      group: string | null;
      lastUsed: string | null;
      sortHost: string;
      sortPort: number;
      sortUsername: string;
      sortAuth: string;
      color: null;
      profile: SerialProfile;
    };

const RECENT_LIMIT = 8;

const itemGroup = (item: SessionManagerItem) => item.group?.trim() || null;

const directGroupItems = (items: SessionManagerItem[], group: string | null) => {
  return items.filter((item) => {
    const itemPath = itemGroup(item);
    if (!group) {
      return itemPath === null;
    }
    return itemPath === group;
  });
};

const groupSubtreeItems = (items: SessionManagerItem[], group: string) => {
  const childPrefix = `${group}/`;
  return items.filter((item) => {
    const itemPath = itemGroup(item);
    return itemPath === group || (itemPath?.startsWith(childPrefix) ?? false);
  });
};

const itemMatchesSearch = (item: SessionManagerItem, query: string) => {
  if (!query) {
    return true;
  }
  const haystack = [
    item.name,
    item.subtitle,
    item.detail,
    item.group ?? '',
  ].join('\n').toLowerCase();
  return haystack.includes(query);
};

const compareText = (left: string, right: string) => {
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
};

const sortValue = (item: SessionManagerItem, field: SortField): string | number => {
  switch (field) {
    case 'name':
      return item.name;
    case 'host':
      return item.sortHost;
    case 'port':
      return item.sortPort;
    case 'username':
      return item.sortUsername;
    case 'auth_type':
      return item.sortAuth;
    case 'group':
      return item.group ?? '';
    case 'last_used_at':
      return item.lastUsed ?? '';
  }
};

const sortSessionItems = (
  items: SessionManagerItem[],
  field: SortField,
  direction: SortDirection,
) => {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...items].sort((left, right) => {
    const leftValue = sortValue(left, field);
    const rightValue = sortValue(right, field);
    const primary = typeof leftValue === 'number' && typeof rightValue === 'number'
      ? leftValue - rightValue
      : compareText(String(leftValue), String(rightValue));
    if (primary !== 0) {
      return primary * multiplier;
    }
    // Keep ties stable and readable instead of reversing names with desc sorts.
    return compareText(left.name, right.name) || compareText(left.id, right.id);
  });
};

const formatRelativeLastUsed = (
  value: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
) => {
  if (!value) {
    return t('sessionManager.table.never_used');
  }
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return t('sessionManager.time.just_now');
  if (diffMins < 60) return t('sessionManager.time.minutes_ago', { count: diffMins });
  if (diffHours < 24) return t('sessionManager.time.hours_ago', { count: diffHours });
  if (diffDays < 7) return t('sessionManager.time.days_ago', { count: diffDays });
  return date.toLocaleDateString();
};

const buildSessionItems = (
  connections: ConnectionInfo[],
  serialProfiles: SerialProfile[],
  query: string,
  sortField: SortField,
  sortDirection: SortDirection,
) => {
  // All view modes consume this projection so field handling cannot diverge
  // between grid, list, and tree as more connection-like resources are added.
  const items: SessionManagerItem[] = [
    ...connections.map((connection): SessionManagerItem => ({
      kind: 'connection',
      id: connection.id,
      name: connection.name,
      subtitle: `${connection.username}@${connection.host}:${connection.port}`,
      detail: connection.tags.join(' '),
      group: connection.group,
      lastUsed: connection.last_used_at,
      sortHost: connection.host,
      sortPort: connection.port,
      sortUsername: connection.username,
      sortAuth: connection.auth_type,
      color: connection.color,
      connection,
    })),
    ...serialProfiles.map((profile): SessionManagerItem => ({
      kind: 'serial',
      id: profile.id,
      name: profile.name,
      subtitle: `${profile.portPath} · ${profile.baudRate}`,
      detail: profile.flowControl,
      group: profile.group ?? null,
      lastUsed: profile.lastUsedAt ?? null,
      sortHost: profile.portPath,
      sortPort: profile.baudRate,
      sortUsername: '',
      sortAuth: 'serial',
      color: null,
      profile,
    })),
  ];
  return sortSessionItems(
    items.filter((item) => itemMatchesSearch(item, query)),
    sortField,
    sortDirection,
  );
};

const ItemIcon = ({ item }: { item: SessionManagerItem }) => {
  if (item.kind === 'serial') {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300">
        <Usb className="h-5 w-5" />
      </div>
    );
  }
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300"
      style={item.color ? { backgroundColor: `${item.color}33`, color: item.color } : undefined}
    >
      <Server className="h-5 w-5" />
    </div>
  );
};

const ItemActions = ({
  item,
  onConnect,
  onEdit,
  onDuplicate,
  onDelete,
  onTestConnection,
  onOpenSerialProfile,
  onDeleteSerialProfile,
}: Pick<
  SessionManagerViewsProps,
  | 'onConnect'
  | 'onEdit'
  | 'onDuplicate'
  | 'onDelete'
  | 'onTestConnection'
  | 'onOpenSerialProfile'
  | 'onDeleteSerialProfile'
> & {
  item: SessionManagerItem;
}) => {
  const { t } = useTranslation();
  if (item.kind === 'serial') {
    return (
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenSerialProfile(item.profile)}>
          <Play className="h-4 w-4 text-green-400" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400" onClick={() => onDeleteSerialProfile(item.profile)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onConnect(item.connection.id)}>
        <Play className="h-4 w-4 text-green-400" />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(item.connection.id)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onTestConnection?.(item.connection)}>
            <Zap className="mr-2 h-4 w-4" />
            {t('sessionManager.actions.test_connection')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDuplicate(item.connection)}>
            <Copy className="mr-2 h-4 w-4" />
            {t('sessionManager.actions.duplicate')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-red-400 focus:text-red-400" onClick={() => onDelete(item.connection)}>
            <Trash2 className="mr-2 h-4 w-4" />
            {t('sessionManager.actions.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const ItemRow = ({
  item,
  selectedIds,
  onToggleSelect,
  actions,
  depth = 0,
}: {
  item: SessionManagerItem;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  actions: ReactNode;
  depth?: number;
}) => {
  const { t } = useTranslation();
  return (
    <div
      className="group flex min-w-0 items-center gap-3 border-b border-theme-border/50 px-3 py-2.5 hover:bg-theme-bg-hover"
      style={{ paddingLeft: `${depth * 24 + 12}px` }}
    >
      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
        {item.kind === 'connection' && (
          <Checkbox
            checked={selectedIds.has(item.id)}
            onCheckedChange={() => onToggleSelect(item.id)}
          />
        )}
      </div>
      <ItemIcon item={item} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-theme-text">{item.name}</div>
        <div className="truncate font-mono text-xs text-theme-text-muted">{item.subtitle}</div>
      </div>
      <div className="hidden min-w-[120px] shrink-0 truncate text-xs text-theme-text-muted md:block">
        {formatRelativeLastUsed(item.lastUsed, t)}
      </div>
      <div className="shrink-0">{actions}</div>
    </div>
  );
};

const EmptyState = () => {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-theme-text-muted">
      <Server className="h-12 w-12 opacity-30" />
      <div className="text-center">
        <p className="text-sm font-medium">{t('sessionManager.table.no_connections')}</p>
        <p className="mt-1 text-xs">{t('sessionManager.table.no_connections_hint')}</p>
      </div>
    </div>
  );
};

const ViewSection = ({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) => (
  <section className="space-y-3">
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-theme-text-muted">{title}</h3>
      {typeof count === 'number' && (
        <span className="text-xs text-theme-text-muted">{count}</span>
      )}
    </div>
    {children}
  </section>
);

const SessionGridView = ({
  items,
  folderTree,
  commonProps,
}: {
  items: SessionManagerItem[];
  folderTree: FolderNode[];
  commonProps: SessionManagerViewsProps;
}) => {
  const { t } = useTranslation();
  const recentItems = items
    .filter((item) => item.lastUsed)
    .sort((left, right) => (right.lastUsed ?? '').localeCompare(left.lastUsed ?? ''))
    .slice(0, RECENT_LIMIT);
  const groupedSections = folderTree
    .map((group) => ({
      group,
      items: groupSubtreeItems(items, group.fullPath),
    }))
    .filter((section) => section.items.length > 0);
  const ungroupedItems = directGroupItems(items, null);
  const hostItems = folderTree.length > 0 ? ungroupedItems : items;

  return (
    <div className="h-full overflow-auto px-4 py-4">
      <div className="space-y-8">
        {recentItems.length > 0 && (
          <ViewSection title={t('sessionManager.views.recent')} count={recentItems.length}>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
              {recentItems.map((item) => (
                <SessionCard key={`${item.kind}:${item.id}`} item={item} commonProps={commonProps} />
              ))}
            </div>
          </ViewSection>
        )}

        {groupedSections.map(({ group, items: groupItems }) => (
          <ViewSection key={group.fullPath} title={group.name} count={groupItems.length}>
            {/* Grid groups are containers for matching hosts, not separate host cards. */}
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
              {groupItems.map((item) => (
                <SessionCard key={`${item.kind}:${item.id}`} item={item} commonProps={commonProps} />
              ))}
            </div>
          </ViewSection>
        ))}

        {hostItems.length > 0 && (
          <ViewSection title={t('sessionManager.views.hosts')} count={hostItems.length}>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
              {hostItems.map((item) => (
                <SessionCard key={`${item.kind}:${item.id}`} item={item} commonProps={commonProps} />
              ))}
            </div>
          </ViewSection>
        )}
      </div>
    </div>
  );
};

const SessionCard = ({
  item,
  commonProps,
}: {
  item: SessionManagerItem;
  commonProps: SessionManagerViewsProps;
}) => (
  <div
    className="group relative flex min-w-0 items-center gap-3 rounded-xl border border-theme-border bg-theme-bg-secondary px-4 py-3 hover:bg-theme-bg-hover"
    onDoubleClick={() => item.kind === 'connection' ? commonProps.onConnect(item.id) : commonProps.onOpenSerialProfile(item.profile)}
  >
    {item.kind === 'connection' && (
      <div className="absolute left-2 top-2">
        <Checkbox
          checked={commonProps.selectedIds.has(item.id)}
          onCheckedChange={() => commonProps.onToggleSelect(item.id)}
        />
      </div>
    )}
    <ItemIcon item={item} />
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-semibold text-theme-text">{item.name}</div>
      <div className="truncate font-mono text-xs text-theme-text-muted">{item.subtitle}</div>
    </div>
    <ItemActions item={item} {...commonProps} />
  </div>
);

const SessionListView = ({
  items,
  commonProps,
}: {
  items: SessionManagerItem[];
  commonProps: SessionManagerViewsProps;
}) => {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto">
      <div className="border-b border-theme-border bg-theme-bg-secondary px-3 py-2 text-xs font-semibold text-theme-text-muted">
        {t('sessionManager.views.list_header')}
      </div>
      {items.map((item) => (
        <ItemRow
          key={`${item.kind}:${item.id}`}
          item={item}
          selectedIds={commonProps.selectedIds}
          onToggleSelect={commonProps.onToggleSelect}
          actions={<ItemActions item={item} {...commonProps} />}
        />
      ))}
    </div>
  );
};

const SessionTreeView = ({
  items,
  folderTree,
  commonProps,
}: {
  items: SessionManagerItem[];
  folderTree: FolderNode[];
  commonProps: SessionManagerViewsProps;
}) => {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto">
      <div className="flex items-center gap-2 border-b border-theme-border bg-theme-bg-secondary px-3 py-2 text-xs text-theme-text-muted">
        <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={commonProps.onExpandAll}>
          <ChevronDown className="h-3.5 w-3.5" />
          {t('sessionManager.views.expand_all')}
        </Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={commonProps.onCollapseAll}>
          <ChevronRight className="h-3.5 w-3.5" />
          {t('sessionManager.views.collapse_all')}
        </Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={commonProps.onRequestCreateGroup}>
          <Plus className="h-3.5 w-3.5" />
          {t('sessionManager.folder_tree.new_group')}
        </Button>
      </div>
      <div>
        {folderTree.map((node) => (
          <TreeGroupRow
            key={node.fullPath}
            node={node}
            depth={0}
            items={items}
            commonProps={commonProps}
          />
        ))}
        {directGroupItems(items, null).map((item) => (
          <ItemRow
            key={`${item.kind}:${item.id}`}
            item={item}
            selectedIds={commonProps.selectedIds}
            onToggleSelect={commonProps.onToggleSelect}
            actions={<ItemActions item={item} {...commonProps} />}
          />
        ))}
      </div>
    </div>
  );
};

const TreeGroupRow = ({
  node,
  depth,
  items,
  commonProps,
}: {
  node: FolderNode;
  depth: number;
  items: SessionManagerItem[];
  commonProps: SessionManagerViewsProps;
}) => {
  const expanded = commonProps.expandedGroups.has(node.fullPath);
  const groupItems = directGroupItems(items, node.fullPath);
  const hasChildren = node.children.length > 0 || groupItems.length > 0;

  return (
    <div>
      <button
        type="button"
        className={cn(
          'flex w-full min-w-0 items-center gap-2 border-b border-theme-border/40 px-3 py-2 text-left text-sm hover:bg-theme-bg-hover',
          !hasChildren && 'text-theme-text-muted'
        )}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={() => hasChildren && commonProps.onToggleExpand(node.fullPath)}
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        {expanded ? <FolderOpen className="h-4 w-4 shrink-0 text-yellow-500" /> : <Folder className="h-4 w-4 shrink-0 text-yellow-500" />}
        <span className="min-w-0 flex-1 truncate font-medium text-theme-text">{node.name}</span>
        <span className="rounded-full bg-theme-bg-sunken px-2 py-0.5 text-xs text-theme-text-muted">
          {node.connectionCount}
        </span>
      </button>
      {expanded && (
        <>
          {node.children.map((child) => (
            <TreeGroupRow
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              items={items}
              commonProps={commonProps}
            />
          ))}
          {groupItems.map((item) => (
            <ItemRow
              key={`${item.kind}:${item.id}`}
              item={item}
              depth={depth + 1}
              selectedIds={commonProps.selectedIds}
              onToggleSelect={commonProps.onToggleSelect}
              actions={<ItemActions item={item} {...commonProps} />}
            />
          ))}
        </>
      )}
    </div>
  );
};

export const SessionManagerViews = (props: SessionManagerViewsProps) => {
  const { t } = useTranslation();
  const query = props.searchQuery.trim().toLowerCase();
  const items = useMemo(
    () => buildSessionItems(
      props.connections,
      props.serialProfiles,
      query,
      props.sortField,
      props.sortDirection,
    ),
    [
      props.connections,
      props.serialProfiles,
      query,
      props.sortField,
      props.sortDirection,
    ],
  );

  if (props.loading) {
    return (
      <div className="flex h-full items-center justify-center text-theme-text-muted">
        <div className="animate-pulse">{t('common.loading', { defaultValue: 'Loading...' })}</div>
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState />;
  }

  if (props.viewMode === 'list') {
    return <SessionListView items={items} commonProps={props} />;
  }
  if (props.viewMode === 'tree') {
    return <SessionTreeView items={items} folderTree={props.folderTree} commonProps={props} />;
  }
  return <SessionGridView items={items} folderTree={props.folderTree} commonProps={props} />;
};
