/**
 * @typedef {Object} VaultAdapter
 * @property {'browser'|'selfhosted'} mode
 * @property {() => Promise<void>} init
 * @property {() => any} getCurrentVault
 * @property {() => any[]} listVaults
 * @property {() => string[]} listVirtualFs
 * @property {() => void} resetVirtualFs
 * @property {() => string} getDefaultVaultPath
 * @property {() => string} getSandboxVaultPath
 * @property {() => any} getSelectedDirectoryHandle
 * @property {() => Promise<any>} pickVaultDirectory
 * @property {(title: string, applyPath?: Function) => Promise<any>} chooseCreateVaultParent
 * @property {(options?: any) => Promise<any>} openDirectoryDialog
 * @property {(options?: any) => any} openDirectoryDialogSync
 * @property {(ipcRenderer: any, messages: any, NoticeCtor: any) => Promise<boolean>} openFolderAsVault
 * @property {(ipcRenderer: any, messages: any, NoticeCtor: any, vaultName: string, syncConfig?: any) => Promise<boolean>} createLocalVault
 * @property {(vaultPath: string, create: boolean) => Promise<boolean|string>|boolean|string} openVault
 * @property {(vaultPath: string) => boolean} removeVault
 * @property {(fromPath: string, toPath: string) => string} moveVault
 * @property {() => Promise<void>} prepareForLaunch
 */

/**
 * @template {VaultAdapter} T
 * @param {T} adapter
 * @returns {T}
 */
export function defineVaultAdapter(adapter) {
  return adapter;
}

export function createNotImplementedVaultAdapterError(mode) {
  return new Error(`${mode} vault adapter is not implemented yet`);
}
