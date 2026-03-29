export interface VaultAdapter {
  mode: 'browser' | 'selfhosted';
  init(): Promise<void>;
  getCurrentVault(): unknown;
  listVaults(): unknown[];
  listVirtualFs(): string[];
  resetVirtualFs(): void;
  getDefaultVaultPath(): string;
  getSandboxVaultPath(): string;
  getSelectedDirectoryHandle(): unknown;
  pickVaultDirectory(): Promise<unknown>;
  chooseCreateVaultParent(title: string, applyPath?: (...args: any[]) => void): Promise<unknown>;
  openDirectoryDialog(options?: unknown): Promise<unknown>;
  openDirectoryDialogSync(options?: unknown): unknown;
  openFolderAsVault(ipcRenderer: unknown, messages: unknown, NoticeCtor: unknown): Promise<boolean>;
  createLocalVault(
    ipcRenderer: unknown,
    messages: unknown,
    NoticeCtor: unknown,
    vaultName: string,
    syncConfig?: unknown,
  ): Promise<boolean>;
  openVault(vaultPath: string, create: boolean): Promise<boolean | string> | boolean | string;
  removeVault(vaultPath: string): boolean;
  moveVault(fromPath: string, toPath: string): string;
  prepareForLaunch(): Promise<void>;
}

export function defineVaultAdapter<T extends VaultAdapter>(adapter: T): T {
  return adapter;
}

export function createNotImplementedVaultAdapterError(mode: string): Error {
  return new Error(`${mode} vault adapter is not implemented yet`);
}
