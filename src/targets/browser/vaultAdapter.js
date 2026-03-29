import path from 'path-browserify';
import { defineVaultAdapter } from '../../core/vaultAdapter.ts';

export function createBrowserVaultAdapter(deps) {
  const {
    getCurrentVault,
    getVaultEntries,
    listStoredFiles,
    resetVirtualFs,
    VIRTUAL_VAULT_ROOT,
    SANDBOX_VAULT_PATH,
    getSelectedDirectoryHandle,
    pickVaultDirectory,
    chooseCreateVaultParent,
    openDirectoryDialog,
    openDirectoryDialogSync,
    openFolderAsVault,
    createLocalVault,
    normalizePath,
    getVaultRecordByPath,
    createVaultId,
    upsertVaultRecord,
    virtualDirs,
    vaultHandles,
    setSelectedDirectoryHandle,
    setCurrentVault,
    ensureVaultPathExists,
    refreshSelectedVaultCache,
    launchMainApp,
    deleteVaultHandle,
    removeVaultRecord,
    clearVaultCache,
    ensureVaultBootstrapFiles,
    getCurrentVaultState,
  } = deps;

  return defineVaultAdapter({
    mode: 'browser',
    async init() {
      await deps.restoreVaultHandles().catch((error) => console.error(error));
      const currentVault = getCurrentVaultState();
      if (currentVault?.id && vaultHandles.has(currentVault.id)) {
        setSelectedDirectoryHandle(vaultHandles.get(currentVault.id));
      }
    },
    getCurrentVault,
    listVaults: getVaultEntries,
    listVirtualFs: listStoredFiles,
    resetVirtualFs,
    getDefaultVaultPath() {
      return getCurrentVault()?.path || VIRTUAL_VAULT_ROOT;
    },
    getSandboxVaultPath() {
      return SANDBOX_VAULT_PATH;
    },
    getSelectedDirectoryHandle,
    pickVaultDirectory,
    chooseCreateVaultParent,
    openDirectoryDialog,
    openDirectoryDialogSync,
    openFolderAsVault,
    createLocalVault,
    openVault(vaultPath, create) {
      const normalized = normalizePath(vaultPath) || getCurrentVault()?.path;
      if (!normalized) return 'folder not found';
      const existing = getVaultRecordByPath(normalized);
      if (!existing && !create) {
        void openDirectoryDialog({ title: 'Select the vault folder to reopen' })
          .then(() => launchMainApp(getCurrentVault()?.path))
          .catch((error) => {
            if (error?.name !== 'AbortError') console.error(error);
          });
        return true;
      }
      if (existing && !vaultHandles.has(existing.id) && !create) {
        void openDirectoryDialog({
          title: `Locate vault: ${existing.name || path.basename(existing.path)}`,
          vaultId: existing.id,
        })
          .then(() => launchMainApp(getCurrentVault()?.path))
          .catch((error) => {
            if (error?.name !== 'AbortError') console.error(error);
          });
        return true;
      }
      const nextVault = existing || upsertVaultRecord({
        id: createVaultId(),
        name: path.basename(normalized),
        path: normalized,
        ts: Date.now(),
        open: true,
      });
      if (create) virtualDirs.add(normalized);
      setSelectedDirectoryHandle(vaultHandles.get(nextVault.id) ?? null);
      setCurrentVault(nextVault);
      void ensureVaultPathExists(normalized, create).catch((error) => console.error(error));
      if (getSelectedDirectoryHandle()) {
        void refreshSelectedVaultCache().catch((error) => console.error(error));
      }
      if (document.body.classList.contains('starter')) {
        void launchMainApp(normalized).catch((error) => console.error(error));
      }
      return true;
    },
    removeVault(vaultPath) {
      const existing = getVaultRecordByPath(vaultPath);
      if (!existing) return false;
      if (getCurrentVaultState()?.id === existing.id) setCurrentVault(null);
      void deleteVaultHandle(existing.id).catch((error) => console.error(error));
      removeVaultRecord(existing.id);
      clearVaultCache(existing.path);
      return true;
    },
    moveVault(fromPath, toPath) {
      const existing = getVaultRecordByPath(fromPath);
      if (!existing) return 'folder not found';
      const updated = upsertVaultRecord({
        ...existing,
        path: normalizePath(toPath),
        ts: Date.now(),
      });
      if (getCurrentVaultState()?.id === existing.id) setCurrentVault(updated);
      return '';
    },
    async prepareForLaunch() {
      if (getSelectedDirectoryHandle()) {
        await refreshSelectedVaultCache();
      }
      await ensureVaultBootstrapFiles(getCurrentVaultState().path);
    },
  });
}
