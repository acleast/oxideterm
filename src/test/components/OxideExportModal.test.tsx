import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMutableSelectorStore } from '@/test/helpers/mockStore';

const translationMap: Record<string, string> = {
  'modals.export.title': 'Export Configuration',
  'modals.export.close': 'Close',
  'modals.export.select_connections': 'Select Connections',
  'modals.export.select_all': 'Select All',
  'modals.export.deselect_all': 'Deselect All',
  'modals.export.no_connections': 'No saved connections',
  'modals.export.section_forwards': 'Saved Port Forwards',
  'modals.export.forwards_owner_notice': 'Selected saved port forwards will be exported together with the connection configurations they belong to.',
  'modals.export.no_forwards': 'No saved port forwards',
  'modals.export.include_app_settings': 'Include Global Settings',
  'modals.export.include_app_settings_description': 'Include app settings',
  'modals.export.app_settings_sections_title': 'Application Settings Sections',
  'modals.export.app_settings_sections_hint': 'Choose sections',
  'modals.export.app_settings_include_env_vars': 'Include local terminal environment variables',
  'modals.export.app_settings_include_env_vars_description': 'May contain machine-specific or sensitive values.',
  'modals.export.app_settings_section_terminal_appearance': 'Terminal Appearance',
  'modals.export.app_settings_section_terminal_behavior': 'Terminal Behavior',
  'modals.export.app_settings_section_file_editor': 'File & Editor',
  'modals.export.app_settings_no_sections': 'No application settings sections selected',
  'modals.export.include_plugin_settings': 'Include Plugin Preferences',
  'modals.export.include_plugin_settings_description': 'Include plugin settings',
  'modals.export.include_quick_commands': 'Include Quick Commands',
  'modals.export.include_quick_commands_description': 'Quick commands warning',
  'modals.export.include_portable_secrets': 'Include Portable Secrets',
  'modals.export.include_portable_secrets_description': 'Include portable secrets',
  'modals.export.no_plugin_settings': 'No plugin preferences to export',
  'modals.export.summary_title': 'Export Summary',
  'modals.export.summary_portable_secrets': 'Portable secrets summary',
  'modals.export.summary_passwords': 'Password summary',
  'modals.export.summary_keys': 'Key summary',
  'modals.export.summary_agent': 'Agent summary',
  'modals.export.summary_key_passphrases': 'Key passphrase summary',
  'modals.export.summary_managed_keys': 'Managed key summary',
  'modals.export.summary_managed_key_passphrases': 'Managed key passphrase summary',
  'modals.export.warning_managed_keys_required': 'Managed keys are required',
  'modals.export.description': 'Description',
  'modals.export.description_placeholder': 'Description placeholder',
  'modals.export.credential_material_title': 'Credential material',
  'modals.export.include_passwords': 'Include saved server passwords',
  'modals.export.include_passwords_description': 'Include passwords description',
  'modals.export.embed_keys': 'Embed Private Keys',
  'modals.export.embed_keys_description': 'Embed keys description',
  'modals.export.include_key_passphrases': 'Include external key passphrases',
  'modals.export.include_key_passphrases_description': 'Include key passphrases description',
  'modals.export.include_managed_keys': 'Include managed keys',
  'modals.export.include_managed_keys_description': 'Include managed keys description',
  'modals.export.include_managed_key_passphrases': 'Include managed-key passphrases',
  'modals.export.include_managed_key_passphrases_description': 'Include managed-key passphrases description',
  'modals.export.content_summary_title': 'Selected Content',
  'modals.export.content_summary_connections': 'Connection content',
  'modals.export.content_summary_app_settings': 'Application settings content',
  'modals.export.content_summary_plugin_settings': 'Plugin settings content',
  'modals.export.content_summary_embed_keys': 'Embedded keys content',
  'modals.export.content_summary_passwords': 'Passwords content',
  'modals.export.content_summary_key_passphrases': 'Key passphrases content',
  'modals.export.content_summary_managed_keys': 'Managed keys content',
  'modals.export.content_summary_managed_key_passphrases': 'Managed key passphrases content',
  'modals.export.password': 'Password',
  'modals.export.password_placeholder': 'At least 6 characters; 12+ recommended with uppercase, lowercase, numbers, and symbols',
  'modals.export.confirm_password': 'Confirm Password',
  'modals.export.confirm_password_placeholder': 'Re-enter password',
  'modals.export.error_password_too_short': 'Password must be at least 6 characters long',
  'modals.export.error_password_mismatch': 'Passwords do not match',
  'modals.export.error_export_failed': 'Export failed',
  'modals.export.error_managed_keys_required': 'Managed-key export is disabled',
  'modals.export.password_strength_weak': 'Weak password, we recommend using 12+ characters with a mix of uppercase, lowercase, numbers, and symbols',
  'modals.export.password_strength_fair': 'Fair',
  'modals.export.password_strength_strong': 'Strong',
  'modals.export.security_notice': 'Security Notice',
  'modals.export.security_encryption': 'Encrypted',
  'modals.export.security_kdf': 'KDF',
  'modals.export.security_contains': 'Contains',
  'modals.export.security_settings': 'Settings',
  'modals.export.security_portable_secrets': 'Portable secrets setting',
  'modals.export.security_passwords_excluded': 'Passwords excluded',
  'modals.export.security_passwords_included': 'Passwords included',
  'modals.export.security_no_session': 'No session data',
  'modals.export.security_keep_safe': 'Keep safe',
  'modals.export.cancel': 'Cancel',
  'modals.export.export': 'Export',
  'modals.export.exporting': 'Exporting',
  'modals.export.stage_reading_keys': 'Reading keys',
  'modals.export.stage_encrypting': 'Encrypting',
  'modals.export.stage_writing': 'Writing file',
  'modals.export.stage_done': 'Done',
  'modals.export.section_plugin_by_id': 'Plugin row',
  'modals.export.content_summary_portable_secrets': 'Portable secrets content',
  'settings_view.general.title': 'General',
  'settings_view.appearance.title': 'Appearance',
  'settings_view.tabs.ai': 'AI',
  'settings_view.connections.title': 'Connection Defaults',
  'settings_view.local_terminal.title': 'Local Terminal',
  'common.yes': 'Yes',
  'common.no': 'No',
};

const exportOxideWithClientStateMock = vi.hoisted(() => vi.fn());
const listAllSavedForwardsMock = vi.hoisted(() => vi.fn());
const loadSavedConnectionsMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const collectPluginSettingsSnapshotMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());
const quickCommandsStoreState = vi.hoisted(() => ({
  commands: [{ id: 'qc-1', name: 'pwd', command: 'pwd', category: 'system', createdAt: 0, updatedAt: 0 }],
  hydrate: vi.fn().mockResolvedValue(undefined),
}));

const appStoreState = vi.hoisted(() => ({
  savedConnections: [] as Array<Record<string, unknown>>,
  loadSavedConnections: loadSavedConnectionsMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translationMap[key] ?? key,
  }),
}));

vi.mock('@/store/appStore', () => ({
  useAppStore: createMutableSelectorStore(appStoreState),
}));

vi.mock('@/store/settingsStore', () => ({
  getAllOxideAppSettingsExportSections: () => [
    'general',
    'terminalAppearance',
    'terminalBehavior',
    'appearance',
    'connections',
    'fileAndEditor',
    'ai',
  ],
  getDefaultOxideAppSettingsExportSections: () => [
    'general',
    'terminalAppearance',
    'terminalBehavior',
    'appearance',
    'connections',
    'fileAndEditor',
  ],
}));

vi.mock('@/store/quickCommandsStore', () => ({
  useQuickCommandsStore: (selector: (state: unknown) => unknown) => selector(quickCommandsStoreState),
}));

vi.mock('@/lib/oxideClientState', () => ({
  exportOxideWithClientState: exportOxideWithClientStateMock,
}));

vi.mock('@/lib/api', () => ({
  api: {
    listAllSavedForwards: listAllSavedForwardsMock,
  },
}));

vi.mock('@/lib/plugin/pluginSettingsManager', () => ({
  collectPluginSettingsSnapshot: collectPluginSettingsSnapshotMock,
  parseSettingStorageKey: (storageKey: string) => {
    const match = /^oxide-plugin-(.+)-setting-(.+)$/.exec(storageKey);
    if (!match) {
      return null;
    }

    return {
      pluginId: match[1],
      settingId: match[2],
    };
  },
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: saveMock,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: writeFileMock,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  DialogHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  DialogTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => <h2 className={className}>{children}</h2>,
  DialogClose: ({ children, className }: { children: React.ReactNode; className?: string }) => <button className={className}>{children}</button>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, type = 'button', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} onClick={onClick} disabled={disabled} {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor, className }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label htmlFor={htmlFor} className={className}>{children}</label>,
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void } & React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
}));

import { OxideExportModal } from '@/components/modals/OxideExportModal';

describe('OxideExportModal', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    appStoreState.savedConnections = [];
    collectPluginSettingsSnapshotMock.mockReturnValue([]);
    listAllSavedForwardsMock.mockResolvedValue([]);
    exportOxideWithClientStateMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    saveMock.mockResolvedValue('/tmp/test-export.oxide');
    writeFileMock.mockResolvedValue(undefined);
    invokeMock.mockResolvedValue({
      totalConnections: 0,
      missingKeys: [],
      connectionsWithKeys: 0,
      connectionsWithPasswords: 0,
      connectionsWithAgent: 0,
      totalKeyBytes: 0,
      canExport: true,
    });
    localStorage.clear();
  });

  it('allows app-settings-only export with a 6-character password', async () => {
    render(<OxideExportModal isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('At least 6 characters; 12+ recommended with uppercase, lowercase, numbers, and symbols'), {
      target: { value: '123456' },
    });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => {
      expect(exportOxideWithClientStateMock).toHaveBeenCalledWith(expect.objectContaining({
        connectionIds: [],
        password: '123456',
        includeAppSettings: true,
        selectedForwardIds: [],
      }));
    });
    expect(saveMock).toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalledWith('/tmp/test-export.oxide', new Uint8Array([1, 2, 3]));
  });

  it('includes owner connection ids when exporting selected saved forwards', async () => {
    appStoreState.savedConnections = [{
      id: 'saved-1',
      name: 'Prod',
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      group: null,
      created_at: '2026-04-10T00:00:00Z',
    }];
    listAllSavedForwardsMock.mockResolvedValue([{
      id: 'forward-1',
      session_id: '',
      owner_connection_id: 'saved-1',
      owner_connection_name: 'Prod',
      forward_type: 'local',
      bind_address: '127.0.0.1',
      bind_port: 8080,
      target_host: 'localhost',
      target_port: 80,
      auto_start: true,
      created_at: '2026-04-10T00:00:00Z',
      description: 'web',
    }]);

    render(<OxideExportModal isOpen onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Prod')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('At least 6 characters; 12+ recommended with uppercase, lowercase, numbers, and symbols'), {
      target: { value: '123456' },
    });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => {
      expect(exportOxideWithClientStateMock).toHaveBeenCalledWith(expect.objectContaining({
        connectionIds: ['saved-1'],
        selectedForwardIds: ['forward-1'],
      }));
    });
  });

  it('shows fine-grained export progress while the backend reports substeps', async () => {
    let resolveExport: ((value: Uint8Array) => void) | null = null;
    exportOxideWithClientStateMock.mockImplementationOnce((request: { onProgress?: (progress: { stage: string; current: number; total: number }) => void }) => new Promise((resolve) => {
      request.onProgress?.({ stage: 'deriving_key', current: 4, total: 9 });
      resolveExport = resolve;
    }));

    render(<OxideExportModal isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('At least 6 characters; 12+ recommended with uppercase, lowercase, numbers, and symbols'), {
      target: { value: '123456' },
    });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '44');
    });
    expect(screen.getAllByText('Encrypting').length).toBeGreaterThan(0);

    await act(async () => {
      resolveExport?.(new Uint8Array([1, 2, 3]));
    });
  });


  it('runs preflight once per selection change instead of looping on re-render', async () => {
    vi.useFakeTimers();

    appStoreState.savedConnections = [{
      id: 'saved-1',
      name: 'Prod',
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      group: null,
      created_at: '2026-04-10T00:00:00Z',
    }];

    render(<OxideExportModal isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Prod'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    const initialPreflightCalls = invokeMock.mock.calls.length;

    expect(initialPreflightCalls).toBeGreaterThan(0);
    expect(invokeMock).toHaveBeenCalledWith('preflight_export', {
      connectionIds: ['saved-1'],
      embedKeys: null,
      includePortableSecrets: null,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    const settledPreflightCalls = invokeMock.mock.calls.length;

    expect(settledPreflightCalls).toBeGreaterThanOrEqual(initialPreflightCalls);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(invokeMock).toHaveBeenCalledTimes(settledPreflightCalls);
  });

  it('blocks export when selected connections require managed keys and managed-key export is disabled', async () => {
    appStoreState.savedConnections = [{
      id: 'saved-1',
      name: 'Prod',
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      group: null,
      created_at: '2026-04-10T00:00:00Z',
    }];
    invokeMock.mockImplementation(async (_command, args) => ({
      totalConnections: 1,
      missingKeys: [],
      connectionsWithKeys: 1,
      connectionsWithPasswords: 0,
      connectionsWithAgent: 0,
      keyPassphraseCount: 0,
      managedKeyCount: 1,
      managedKeyPassphraseCount: 0,
      blockedManagedKeyConnections: args?.includeManagedKeys === false ? ['Prod'] : [],
      totalKeyBytes: 0,
      canExport: args?.includeManagedKeys !== false,
      portableSecretCount: 0,
    }));

    render(<OxideExportModal isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Prod'));
    fireEvent.click(screen.getByLabelText('Include managed keys'));

    await waitFor(() => {
      expect(screen.getByText('Managed keys are required')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('At least 6 characters; 12+ recommended with uppercase, lowercase, numbers, and symbols'), {
      target: { value: '123456' },
    });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => {
      expect(screen.getByText('Managed-key export is disabled')).toBeInTheDocument();
    });
    expect(exportOxideWithClientStateMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('blocks passwords shorter than 6 characters and shows strength hints', async () => {
    render(<OxideExportModal isOpen onClose={vi.fn()} />);

    const passwordInput = screen.getByPlaceholderText('At least 6 characters; 12+ recommended with uppercase, lowercase, numbers, and symbols');
    const confirmInput = screen.getByPlaceholderText('Re-enter password');

    fireEvent.change(passwordInput, { target: { value: '12345' } });
    expect(screen.getByText('Weak password, we recommend using 12+ characters with a mix of uppercase, lowercase, numbers, and symbols')).toBeInTheDocument();

    fireEvent.change(confirmInput, { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 6 characters long')).toBeInTheDocument();
    });
    expect(exportOxideWithClientStateMock).not.toHaveBeenCalled();

    fireEvent.change(passwordInput, { target: { value: 'password1' } });
    expect(screen.getByText('Fair')).toBeInTheDocument();

    fireEvent.change(passwordInput, { target: { value: 'StrongPass1!' } });
    expect(screen.getByText('Strong')).toBeInTheDocument();
  });
});
