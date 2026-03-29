export function createSelfhostedVaultAdapter() {
  const notImplemented = () => {
    throw new Error('Selfhosted vault adapter is not implemented yet');
  };

  return {
    mode: 'selfhosted',
    async init() {},
    getCurrentVault() {
      return null;
    },
    listVaults() {
      return [];
    },
    listVirtualFs() {
      return [];
    },
    resetVirtualFs() {},
    getDefaultVaultPath() {
      return '/vaults';
    },
    getSandboxVaultPath() {
      return '/sandbox';
    },
    getSelectedDirectoryHandle() {
      return null;
    },
    pickVaultDirectory: notImplemented,
    chooseCreateVaultParent: notImplemented,
    openDirectoryDialog: notImplemented,
    openDirectoryDialogSync: notImplemented,
    openFolderAsVault: notImplemented,
    createLocalVault: notImplemented,
    openVault: notImplemented,
    removeVault: notImplemented,
    moveVault: notImplemented,
    prepareForLaunch: notImplemented,
  };
}
