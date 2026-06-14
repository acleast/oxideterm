// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Loader2, ArrowDownRight, Info, Server } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { api } from '../../lib/api';
import type { SavedConnectionForConnect, SavedConnectionProxyHopForConnect } from '../../lib/api';
import { findUnsupportedProxyHopAuth } from '../../lib/proxyHopSupport';
import { requiresSavedConnectionPasswordPrompt } from '../../lib/testConnectionRequest';
import { useAppStore } from '../../store/appStore';
import { useSessionTreeStore } from '../../store/sessionTreeStore';
import type { ConnectionInfo, HopInfo } from '../../types';

interface DrillDownDialogProps {
  /** 父节点 ID */
  parentNodeId: string;
  /** 父节点主机名（用于显示） */
  parentHost: string;
  /** 对话框是否打开 */
  open: boolean;
  /** 关闭对话框回调 */
  onOpenChange: (open: boolean) => void;
  /** 成功后回调 */
  onSuccess?: (nodeId: string, sshConnectionId: string) => void;
}

export const DrillDownDialog: React.FC<DrillDownDialogProps> = ({
  parentNodeId,
  parentHost,
  open,
  onOpenChange,
  onSuccess,
}) => {
  const { t } = useTranslation();
  // 表单状态
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<'password' | 'key' | 'agent'>('agent');
  const [password, setPassword] = useState('');
  const [keyPath, setKeyPath] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [agentForwarding, setAgentForwarding] = useState(false);
  
  // 加载状态
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const savedConnections = useAppStore(state => state.savedConnections);
  const loadSavedConnections = useAppStore(state => state.loadSavedConnections);
  const { fetchTree, expandManualPresetUnderParent, connectNodeWithAncestors } = useSessionTreeStore();

  useEffect(() => {
    if (open) {
      void loadSavedConnections();
    }
  }, [loadSavedConnections, open]);

  const handleAuthTypeChange = (value: string) => {
    if (value === 'password' || value === 'key' || value === 'agent') {
      setAuthType(value);
    }
  };

  const handleBrowseKey = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: t('modals.drill_down.auth_key'),
        defaultPath: '~/.ssh'
      });
      if (selected && typeof selected === 'string') {
        setKeyPath(selected);
      }
    } catch (e) {
      console.error('Failed to open file dialog:', e);
    }
  };

  const resetForm = () => {
    setHost('');
    setPort('22');
    setUsername('');
    setAuthType('agent');
    setPassword('');
    setKeyPath('');
    setPassphrase('');
    setAgentForwarding(false);
    setError(null);
    setIsConnecting(false);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleDrillDown = async () => {
    if (!host || !username) return;

    setIsConnecting(true);
    setError(null);

    try {
      // 1. 调用 tree_drill_down 在树中添加子节点
      const nodeId = await api.treeDrillDown({
        parentNodeId,
        host,
        port: parseInt(port) || 22,
        username,
        authType,
        password: authType === 'password' ? password : undefined,
        keyPath: authType === 'key' ? keyPath : undefined,
        passphrase: authType === 'key' && passphrase ? passphrase : undefined,
        agentForwarding,
      });

      // 2. 调用 connect_tree_node 建立实际连接
      const result = await api.connectTreeNode({
        nodeId,
        cols: 0,
        rows: 0,
      });

      // 3. 刷新树
      await fetchTree();

      // 4. 调用成功回调
      onSuccess?.(result.nodeId, result.sshConnectionId);

      // 5. 关闭对话框
      handleClose();
    } catch (err) {
      console.error('Drill down failed:', err);
      setError(err instanceof Error ? err.message : String(err));
      // 刷新树以显示失败状态
      await fetchTree();
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSavedNextHop = async (connectionId: string) => {
    setIsConnecting(true);
    setError(null);

    try {
      const savedConnection = await api.getSavedConnectionForConnect(connectionId);
      if (requiresSavedConnectionPasswordPrompt(savedConnection)) {
        throw new Error(t('modals.drill_down.saved_next_hop_missing_credentials'));
      }

      const unsupportedProxyHop = findUnsupportedProxyHopAuth(savedConnection.proxy_chain);
      if (unsupportedProxyHop) {
        throw new Error(t('modals.drill_down.saved_next_hop_unsupported_proxy_auth', {
          hop: unsupportedProxyHop.hopIndex,
          authType: unsupportedProxyHop.authType,
        }));
      }

      const target = savedConnectionToHopInfo(savedConnection);
      const hops = savedConnection.proxy_chain.map(savedProxyHopToHopInfo);
      const expansion = await expandManualPresetUnderParent({
        parentNodeId,
        savedConnectionId: connectionId,
        hops,
        target,
      });

      await connectNodeWithAncestors(expansion.targetNodeId);
      await fetchTree();
      const targetNode = useSessionTreeStore.getState().getRawNode(expansion.targetNodeId);
      const sshConnectionId = targetNode?.sshConnectionId;
      if (!sshConnectionId) {
        throw new Error(t('modals.drill_down.saved_next_hop_materialize_failed'));
      }

      await api.markConnectionUsed(connectionId);
      onSuccess?.(expansion.targetNodeId, sshConnectionId);
      handleClose();
    } catch (err) {
      console.error('Saved next hop failed:', err);
      setError(err instanceof Error ? err.message : String(err));
      await fetchTree();
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowDownRight className="w-5 h-5 text-blue-400" />
            {t('modals.drill_down.title')}
          </DialogTitle>
          <p className="text-sm text-theme-text-muted mt-1">
            {t('modals.drill_down.description', { host: parentHost }).split('<host>').map((part, i) => 
              i === 0 ? <span key={i}>{part}</span> : <span key={i}><span className="text-white font-mono">{part.split('</host>')[0]}</span>{part.split('</host>')[1]}</span>
            )}
          </p>
        </DialogHeader>

        <div className="space-y-4 p-4">
          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md text-sm text-red-400">
              {error}
            </div>
          )}

          <SavedNextHopPicker
            connections={savedConnections}
            disabled={isConnecting}
            parentHost={parentHost}
            onSelect={handleSavedNextHop}
            t={t}
          />

          {/* Host & Port */}
          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-3 space-y-2">
              <Label htmlFor="drill-host">{t('modals.drill_down.target_host')} *</Label>
              <Input
                id="drill-host"
                placeholder={t('modals.drill_down.target_host_placeholder')}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                disabled={isConnecting}
              />
            </div>
            <div className="col-span-1 space-y-2">
              <Label htmlFor="drill-port">{t('modals.drill_down.port')}</Label>
              <Input
                id="drill-port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                disabled={isConnecting}
              />
            </div>
          </div>

          {/* Username */}
          <div className="space-y-2">
            <Label htmlFor="drill-username">{t('modals.drill_down.username')} *</Label>
            <Input
              id="drill-username"
              placeholder={t('modals.drill_down.username_placeholder')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isConnecting}
            />
          </div>

          {/* Authentication */}
          <div className="space-y-2">
            <Label>{t('modals.drill_down.auth_method')}</Label>
            <Tabs
              value={authType}
              onValueChange={handleAuthTypeChange}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="agent" disabled={isConnecting}>{t('modals.drill_down.auth_agent')}</TabsTrigger>
                <TabsTrigger value="key" disabled={isConnecting}>{t('modals.drill_down.auth_key')}</TabsTrigger>
                <TabsTrigger value="password" disabled={isConnecting}>{t('modals.drill_down.auth_password')}</TabsTrigger>
              </TabsList>

                <TabsContent value="agent">
                <div className="text-sm text-theme-text-muted pt-2 space-y-2">
                  <p>{t('modals.drill_down.agent_desc')}</p>
                  <p className="text-xs text-theme-text-muted">
                    {t('modals.drill_down.agent_hint')}
                  </p>
                </div>
                </TabsContent>

              <TabsContent value="key">
                <div className="space-y-2 pt-2">
                  <Label htmlFor="drill-keypath">{t('modals.drill_down.key_path')}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="drill-keypath"
                      value={keyPath}
                      onChange={(e) => setKeyPath(e.target.value)}
                      placeholder={t('modals.drill_down.key_path_placeholder')}
                      disabled={isConnecting}
                    />
                    <Button 
                      variant="outline" 
                      onClick={handleBrowseKey} 
                      type="button"
                      disabled={isConnecting}
                    >
                      {t('modals.drill_down.browse')}
                    </Button>
                  </div>
                  <div className="space-y-1 pt-1">
                    <Label htmlFor="drill-passphrase" className="text-sm font-normal">{t('modals.drill_down.passphrase')}</Label>
                    <Input
                      id="drill-passphrase"
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      disabled={isConnecting}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="password">
                <div className="space-y-2 pt-2">
                  <Label htmlFor="drill-password">{t('modals.drill_down.password')}</Label>
                  <Input
                    id="drill-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isConnecting}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="drill-agent-fwd"
              checked={agentForwarding}
              onCheckedChange={(checked) => setAgentForwarding(!!checked)}
              disabled={isConnecting}
            />
            <Label htmlFor="drill-agent-fwd" className="font-normal">
              {t('modals.new_connection.agent_forwarding')}
            </Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 cursor-help text-yellow-500" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[280px]">
                  <p className="text-xs">{t('modals.new_connection.agent_forwarding_hint')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isConnecting}>
            {t('modals.drill_down.cancel')}
          </Button>
          <Button 
            onClick={handleDrillDown} 
            disabled={!host || !username || isConnecting}
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('modals.drill_down.connecting')}
              </>
            ) : (
              <>
                <ArrowDownRight className="w-4 h-4 mr-2" />
                {t('modals.drill_down.connect')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

type SavedConnectionEndpoint = Pick<
  SavedConnectionForConnect,
  'host' | 'port' | 'username' | 'password' | 'key_path' | 'cert_path' | 'managed_key_id' | 'passphrase' | 'agent_forwarding'
> & {
  auth_type: string;
};

function mapPresetAuthType(authType: string): NonNullable<HopInfo['authType']> {
  if (
    authType === 'password' ||
    authType === 'key' ||
    authType === 'default_key' ||
    authType === 'managed_key' ||
    authType === 'agent' ||
    authType === 'certificate'
  ) {
    return authType;
  }
  return 'key';
}

function savedEndpointToHopInfo(endpoint: SavedConnectionEndpoint): HopInfo {
  return {
    host: endpoint.host,
    port: endpoint.port,
    username: endpoint.username,
    authType: mapPresetAuthType(endpoint.auth_type),
    password: endpoint.password,
    keyPath: endpoint.key_path,
    certPath: endpoint.cert_path,
    managedKeyId: endpoint.managed_key_id,
    passphrase: endpoint.passphrase,
    agentForwarding: endpoint.agent_forwarding,
  };
}

function savedConnectionToHopInfo(connection: SavedConnectionForConnect): HopInfo {
  return savedEndpointToHopInfo(connection);
}

function savedProxyHopToHopInfo(hop: SavedConnectionProxyHopForConnect): HopInfo {
  return savedEndpointToHopInfo(hop);
}

function SavedNextHopPicker({
  connections,
  disabled,
  parentHost,
  onSelect,
  t,
}: {
  connections: ConnectionInfo[];
  disabled: boolean;
  parentHost: string;
  onSelect: (connectionId: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div className="space-y-2 rounded-md border border-theme-border/80 bg-theme-bg-card/60 p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-theme-text">
          {t('modals.drill_down.saved_next_hop_title')}
        </p>
        <p className="text-xs text-theme-text-muted">
          {t('modals.drill_down.saved_next_hop_description', { host: parentHost })}
        </p>
      </div>

      {connections.length === 0 ? (
        <p className="text-xs text-theme-text-muted">
          {t('modals.drill_down.saved_next_hop_empty')}
        </p>
      ) : (
        <div className="max-h-44 space-y-1 overflow-y-auto">
          {connections.map(connection => (
            <button
              key={connection.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(connection.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-theme-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Server className="h-3.5 w-3.5 shrink-0 text-theme-text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-theme-text">
                  {connection.name}
                </span>
                <span className="block truncate text-[10px] text-theme-text-muted">
                  {connection.username}@{connection.host}:{connection.port}
                </span>
              </span>
              {!!connection.proxy_chain?.length && (
                <span className="shrink-0 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">
                  {t('modals.drill_down.saved_next_hop_proxy_chain_badge', {
                    count: connection.proxy_chain.length,
                  })}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
