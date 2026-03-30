import { createNotImplementedVaultAdapterError, defineVaultAdapter } from '../../core/vaultAdapter';
import type { SelfhostedVaultRecord } from './apiClient';

type CreateSelfhostedVaultAdapterOptions = {
  apiClient: ReturnType<typeof import('./apiClient').createSelfhostedApiClient>;
  dialogs: ReturnType<typeof import('./dialogs').createSelfhostedDialogs>;
  fsAdapter: ReturnType<typeof import('./fsAdapter').createSelfhostedFsAdapter>;
  launchMainApp: (vaultPath?: string) => Promise<void>;
  requestVaultSwitch: (vaultPath: string) => void;
  setStatus: (message: string, level?: 'info' | 'warning' | 'error') => void;
};

export function createSelfhostedVaultAdapter(options: CreateSelfhostedVaultAdapterOptions) {
  const { apiClient, dialogs, fsAdapter, launchMainApp, requestVaultSwitch, setStatus } = options;

  let currentVault: SelfhostedVaultRecord | null = null;
  let vaults: SelfhostedVaultRecord[] = [];
  let initError: Error | null = null;
  let config: import('./apiClient').SelfhostedConfig | null = null;

  async function refreshVaults() {
    vaults = await apiClient.listVaults();
    if (currentVault) {
      currentVault = vaults.find((vault) => vault.id === currentVault?.id || vault.path === currentVault?.path) ?? currentVault;
    }
  }

  async function launchIfStarter(vaultPath: string) {
    if (document.body.classList.contains('starter')) {
      await launchMainApp(vaultPath);
    } else {
      requestVaultSwitch(vaultPath);
    }
  }

  function backendNotReadyError(cause?: unknown) {
    const error = createNotImplementedVaultAdapterError('Selfhosted');
    if (cause) (error as Error & { cause?: unknown }).cause = cause;
    return error;
  }

  return defineVaultAdapter({
    mode: 'selfhosted',
    async init() {
      try {
        await refreshVaults();
        config = await apiClient.getConfig();
        initError = null;
      } catch (error) {
        initError = backendNotReadyError(error);
        setStatus('Selfhosted backend is not available yet. The target scaffolding loaded successfully.', 'warning');
      }
    },
    getCurrentVault() {
      return currentVault;
    },
    listVaults() {
      return [...vaults];
    },
    listVirtualFs() {
      return [];
    },
    resetVirtualFs() {},
    getDefaultVaultPath() {
      return config?.rootPath || '/vaults';
    },
    getSandboxVaultPath() {
      return '/sandbox';
    },
    getSelectedDirectoryHandle() {
      return null;
    },
    pickVaultDirectory: dialogs.pickVaultDirectory,
    chooseCreateVaultParent: dialogs.chooseCreateVaultParent,
    openDirectoryDialog: dialogs.openDirectoryDialog,
    openDirectoryDialogSync: dialogs.openDirectoryDialogSync,
    openFolderAsVault: dialogs.openFolderAsVault,
    createLocalVault: dialogs.createLocalVault,
    openVault(vaultPath, create) {
      const existing = vaults.find((vault) => vault.path === vaultPath) ?? null;
      if (!existing && !create) return 'folder not found';
      if (existing) currentVault = existing;
      else if (create) {
        currentVault = {
          id: vaultPath,
          name: vaultPath.split('/').filter(Boolean).pop() || 'vault',
          path: vaultPath,
          ts: Date.now(),
          open: true,
        };
      }
      void apiClient.openVault(vaultPath, create)
        .then(async (response) => {
          if (!response.ok || !response.vault) {
            if (response.error) setStatus(response.error, 'error');
            return;
          }
          currentVault = response.vault;
          await refreshVaults();
          await fsAdapter.refreshSnapshot(response.vault.path);
          await launchIfStarter(response.vault.path);
        })
        .catch((error) => console.error(error));
      return true;
    },
    removeVault(vaultPath) {
      void apiClient.removeVault(vaultPath).catch((error) => console.error(error));
      const existing = vaults.find((vault) => vault.path === vaultPath) ?? null;
      if (!existing) return false;
      vaults = vaults.filter((vault) => vault.path !== vaultPath);
      if (currentVault?.path === vaultPath) currentVault = null;
      return true;
    },
    moveVault(fromPath, toPath) {
      void apiClient.moveVault(fromPath, toPath)
        .then((response) => {
          if (response.ok && response.vault) {
            const idx = vaults.findIndex((vault) => vault.path === fromPath);
            if (idx !== -1) vaults[idx] = response.vault;
            if (currentVault?.id === response.vault.id) currentVault = response.vault;
          }
        })
        .catch((error) => console.error(error));
      const existing = vaults.find((vault) => vault.path === fromPath);
      if (!existing) return 'folder not found';
      existing.path = toPath;
      if (currentVault?.id === existing.id) currentVault = existing;
      return '';
    },
    async prepareForLaunch() {
      if (initError) throw initError;
      if (currentVault) {
        await refreshVaults();
        await fsAdapter.refreshSnapshot(currentVault.path);
      }
      return undefined;
    },
  });
}
