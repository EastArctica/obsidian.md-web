type BrowserDialogsOptions = {
  buildVirtualVaultPath: (name: string) => string;
  browserVaultAdapterRef: () => { getCurrentVault: () => any } | null;
  chooseCreateVaultParentLabel: (label: string) => void;
  createVaultId: () => string;
  getCurrentVault: () => any;
  getVaultRecordById: (id: string) => any;
  getVaultRecordByPath: (path: string) => any;
  hideVaultPickerGlow: () => void;
  launchMainApp: (vaultPath?: string) => Promise<void>;
  normalizePath: (value: unknown) => string;
  persistVaultHandle: (id: string, handle: FileSystemDirectoryHandle) => Promise<void>;
  refreshSelectedVaultCache: () => Promise<void>;
  safeVaultName: (name: string) => string;
  setCurrentVault: (vault: any) => void;
  setSelectedCreateVaultParentHandle: (handle: FileSystemDirectoryHandle | null) => void;
  getSelectedCreateVaultParentHandle: () => FileSystemDirectoryHandle | null;
  setSelectedCreateVaultParentPath: (path: string) => void;
  setSelectedDirectoryHandle: (handle: FileSystemDirectoryHandle | null) => void;
  showVaultPickerGlow: (message?: string) => void;
  upsertVaultRecord: (record: any) => any;
};

export function createBrowserDialogs(options: BrowserDialogsOptions) {
  const {
    buildVirtualVaultPath,
    chooseCreateVaultParentLabel,
    createVaultId,
    getCurrentVault,
    getVaultRecordById,
    getVaultRecordByPath,
    hideVaultPickerGlow,
    normalizePath,
    persistVaultHandle,
    refreshSelectedVaultCache,
    safeVaultName,
    setCurrentVault,
    setSelectedCreateVaultParentHandle,
    getSelectedCreateVaultParentHandle,
    setSelectedCreateVaultParentPath,
    setSelectedDirectoryHandle,
    showVaultPickerGlow,
    upsertVaultRecord,
  } = options;

  const browserWindow = window as Window & { showDirectoryPicker?: (options?: any) => Promise<FileSystemDirectoryHandle> };

  async function openDirectoryDialog(dialogOptions: any = {}) {
    showVaultPickerGlow(dialogOptions.title || 'Select the vault folder to continue...');
    try {
      const handle = await browserWindow.showDirectoryPicker?.({
        id: 'obsidian-web-vault',
        startIn: 'documents',
      });
      if (!handle) throw new Error('Directory picker is not supported in this browser');
      const vaultPath = buildVirtualVaultPath(handle.name);
      const existing = dialogOptions.vaultId ? getVaultRecordById(dialogOptions.vaultId) : getVaultRecordByPath(vaultPath);
      const vault = upsertVaultRecord({
        id: existing?.id || createVaultId(),
        name: handle.name || 'vault',
        path: vaultPath,
        ts: Date.now(),
        open: true,
      });
      setSelectedDirectoryHandle(handle);
      await persistVaultHandle(vault.id, handle);
      setCurrentVault(vault);
      await refreshSelectedVaultCache();

      window.dispatchEvent(
        new CustomEvent('obsidian-web:vault-picked', {
          detail: { handle, options: dialogOptions, vault: getCurrentVault() },
        }),
      );

      return {
        canceled: false,
        filePaths: [getCurrentVault().path],
      };
    } finally {
      hideVaultPickerGlow();
    }
  }

  async function pickVaultDirectory() {
    if (typeof browserWindow.showDirectoryPicker !== 'function') {
      throw new Error('Directory picker is not supported in this browser');
    }
    await openDirectoryDialog();
    return getCurrentVault();
  }

  async function chooseCreateVaultParent(title: string, applyPath?: (...args: any[]) => void) {
    showVaultPickerGlow(title || 'Select where to create the vault...');
    try {
      const handle = await browserWindow.showDirectoryPicker?.({
        id: 'obsidian-web-vault-parent',
        startIn: 'documents',
      });
      if (!handle) throw new Error('Directory picker is not supported in this browser');
      setSelectedCreateVaultParentHandle(handle);
      setSelectedCreateVaultParentPath(buildVirtualVaultPath(handle.name || 'vaults'));
      const label = safeVaultName(handle.name || 'vaults');
      chooseCreateVaultParentLabel(label);
      if (typeof applyPath === 'function') applyPath(label);
      return buildVirtualVaultPath(handle.name || 'vaults');
    } finally {
      hideVaultPickerGlow();
    }
  }

  function openDirectoryDialogSync(dialogOptions: any = {}) {
    const fallbackPath = normalizePath(dialogOptions.defaultPath) || getCurrentVault()?.path || '/obsidian-web';
    const chosenPath = window.prompt(dialogOptions.title || 'Choose vault folder', fallbackPath);
    if (chosenPath == null) return undefined;

    const normalizedPath = normalizePath(chosenPath) || fallbackPath;
    const existing = getVaultRecordByPath(normalizedPath);
    setCurrentVault(existing || upsertVaultRecord({
      id: existing?.id || createVaultId(),
      name: normalizedPath.split('/').filter(Boolean).pop(),
      path: normalizedPath,
      ts: Date.now(),
      open: true,
    }));
    setSelectedDirectoryHandle(null);
    window.dispatchEvent(
      new CustomEvent('obsidian-web:vault-picked', {
        detail: { handle: null, options: dialogOptions, vault: getCurrentVault(), syncFallback: true },
      }),
    );
    return [getCurrentVault().path];
  }

  async function openFolderAsVault(ipcRenderer: any, messages: any, NoticeCtor: any) {
    try {
      const vault = await pickVaultDirectory();
      const result = ipcRenderer.sendSync('vault-open', vault.path, false);
      if (result === true) return true;
      new NoticeCtor(`${messages.msgErrorFailedToOpenVault()} ${result}.`);
      return false;
    } catch (error: any) {
      if (error && error.name === 'AbortError') return false;
      console.error(error);
      if (NoticeCtor) new NoticeCtor(String(error.message || error));
      return false;
    }
  }

  async function createLocalVault(ipcRenderer: any, messages: any, NoticeCtor: any, vaultName: string, syncConfig: any) {
    try {
      if (!getSelectedCreateVaultParentHandle()) {
        await chooseCreateVaultParent(`Choose where to create '${vaultName}'...`);
      }
      const parentHandle = getSelectedCreateVaultParentHandle();
      if (!parentHandle) {
        if (NoticeCtor) new NoticeCtor(String(messages.msgInvalidFolder?.() || 'Invalid folder'));
        return false;
      }
      const handle = await parentHandle.getDirectoryHandle(vaultName, { create: true });
      const vaultPath = buildVirtualVaultPath(vaultName);
      const existing = getVaultRecordByPath(vaultPath);
      const vault = upsertVaultRecord({
        id: existing?.id || createVaultId(),
        name: vaultName,
        path: vaultPath,
        ts: Date.now(),
        open: true,
      });
      setSelectedDirectoryHandle(handle);
      await persistVaultHandle(vault.id, handle);
      setCurrentVault(vault);
      await refreshSelectedVaultCache();
      const result = ipcRenderer.sendSync('vault-open', vault.path, true);
      if (result === true) {
        if (syncConfig) {
          ipcRenderer.sendSync('vault-message', vault.path, { action: 'sync-setup', vault: JSON.stringify(syncConfig) });
        } else {
          ipcRenderer.sendSync('vault-message', vault.path, { action: 'vault-setup' });
        }
        setSelectedCreateVaultParentHandle(null);
        setSelectedCreateVaultParentPath('');
        chooseCreateVaultParentLabel('');
        return true;
      }
      new NoticeCtor(`${messages.msgFailedToCreateVault()} ${result}.`);
      return false;
    } catch (error: any) {
      if (error?.name === 'AbortError') return false;
      console.error(error);
      if (NoticeCtor) new NoticeCtor(String(messages.msgFailedToCreateVaultAtLocation?.() || error.message || error));
      return false;
    } finally {
      hideVaultPickerGlow();
    }
  }

  return {
    chooseCreateVaultParent,
    createLocalVault,
    openDirectoryDialog,
    openDirectoryDialogSync,
    openFolderAsVault,
    pickVaultDirectory,
  };
}
