type SelfhostedDialogsOptions = {
  setStatus: (message: string, level?: 'info' | 'warning' | 'error') => void;
  getDefaultVaultPath: () => string;
  listVaults: () => Array<{ name?: string; path: string }>;
};

export function createSelfhostedDialogs(options: SelfhostedDialogsOptions) {
  const { setStatus, getDefaultVaultPath, listVaults } = options;
  let selectedCreateVaultParentPath = '';

  const unsupported = async (message: string) => {
    setStatus(message, 'warning');
    throw new Error(message);
  };

  function getCreateParentPath() {
    return selectedCreateVaultParentPath || getDefaultVaultPath();
  }

  function showNotice(NoticeCtor: any, message: string) {
    if (!NoticeCtor) {
      setStatus(message, 'warning');
      return;
    }
    try {
      // Browser-shimmed Obsidian sometimes passes a constructable notice class, other times a plain function.
      new NoticeCtor(message);
      return;
    } catch {}
    try {
      NoticeCtor(message);
      return;
    } catch {}
    setStatus(message, 'warning');
  }

  function chooseExistingVaultPath() {
    const vaults = listVaults();
    if (vaults.length === 0) return null;
    const promptBody = vaults
      .map((vault, index) => `${index + 1}. ${vault.name || vault.path.split('/').filter(Boolean).pop() || vault.path} (${vault.path})`)
      .join('\n');
    const rawChoice = window.prompt(`Open selfhosted vault\n\n${promptBody}\n\nEnter a number or full path:`, vaults[0].path);
    if (!rawChoice) return null;
    const numericChoice = Number(rawChoice);
    if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= vaults.length) {
      return vaults[numericChoice - 1].path;
    }
    return rawChoice;
  }

  return {
    async pickVaultDirectory() {
      const fallbackPath = getDefaultVaultPath();
      const chosenPath = window.prompt('Enter vault path under the selfhosted root', fallbackPath);
      if (!chosenPath) throw new Error('Vault selection was cancelled');
      return { path: chosenPath };
    },
    async chooseCreateVaultParent(_title?: string, applyPath?: (...args: any[]) => void) {
      const rootPath = getDefaultVaultPath();
      selectedCreateVaultParentPath = rootPath;
      if (typeof applyPath === 'function') applyPath(rootPath);
      setStatus(`New selfhosted vaults will be created under ${rootPath}.`, 'info');
      return rootPath;
    },
    async openDirectoryDialog(options?: any) {
      const fallbackPath = options?.defaultPath || chooseExistingVaultPath() || getDefaultVaultPath();
      const chosenPath = window.prompt(options?.title || 'Enter vault path under the selfhosted root', fallbackPath);
      if (!chosenPath) return { canceled: true, filePaths: [] };
      return { canceled: false, filePaths: [chosenPath] };
    },
    openDirectoryDialogSync() {
      const chosenPath = window.prompt('Enter vault path under the selfhosted root', chooseExistingVaultPath() || getDefaultVaultPath());
      return chosenPath ? [chosenPath] : undefined;
    },
    async openFolderAsVault(ipcRenderer: any, messages: any, NoticeCtor: any) {
      try {
        const chosenPath = chooseExistingVaultPath();
        if (!chosenPath) return false;
        const vault = { path: chosenPath };
        const result = ipcRenderer.sendSync('vault-open', vault.path, false);
        if (result === true) return true;
        showNotice(NoticeCtor, `${messages.msgErrorFailedToOpenVault()} ${result}.`);
        return false;
      } catch (error: any) {
        if (error?.message !== 'Vault selection was cancelled') showNotice(NoticeCtor, String(error.message || error));
        return false;
      }
    },
    async createLocalVault(ipcRenderer: any, messages: any, NoticeCtor: any, vaultName: string) {
      const parentPath = getCreateParentPath();
      const result = ipcRenderer.sendSync('vault-open', `${parentPath}/${vaultName}`, true);
      if (result === true) return true;
      showNotice(NoticeCtor, `${messages.msgFailedToCreateVault()} ${result}.`);
      return false;
    },
    getSelectedCreateVaultParentPath() {
      return getCreateParentPath();
    },
  };
}
