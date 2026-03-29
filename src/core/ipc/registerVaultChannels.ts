type RegisterChannel = (
  channel: string,
  resolver: (...args: any[]) => any,
  options?: { emitOnSend?: boolean; description?: string; args?: string[]; returns?: string },
) => void;

type RegisterVaultChannelsOptions = {
  registerChannel: RegisterChannel;
  ipcChannelDocs: Record<string, { description: string; args: string[]; returns: string }>;
  ipcRenderer: any;
  vaultAdapter: {
    getCurrentVault: () => any;
    getDefaultVaultPath: () => string;
    getSandboxVaultPath: () => string;
    openVault: (vaultPath: string, create: boolean) => any;
    removeVault: (vaultPath: string) => boolean;
    moveVault: (fromPath: string, toPath: string) => string;
    pickVaultDirectory: () => Promise<any>;
  };
  buildVaultList: () => Record<string, { path: string; ts: number; open: boolean }>;
};

export function registerVaultChannels(options: RegisterVaultChannelsOptions) {
  const { registerChannel, ipcChannelDocs, ipcRenderer, vaultAdapter, buildVaultList } = options;

  registerChannel('vault', () => vaultAdapter.getCurrentVault(), {
    emitOnSend: true,
    description: 'Returns the current vault associated with the active web contents.',
    returns: 'object|null',
  });
  registerChannel('vault-list', () => buildVaultList(), {
    emitOnSend: true,
    description: 'Returns the host-maintained vault registry keyed by vault id.',
    returns: 'object',
  });
  registerChannel('vault-open', (vaultPath, create) => vaultAdapter.openVault(vaultPath, create), {
    emitOnSend: true,
    description: 'Opens or creates a vault at a path and switches the active vault in the web shell.',
    args: ['path', 'create'],
    returns: 'boolean|string',
  });
  ipcChannelDocs['choose-vault'] = {
    description: 'Opens a browser directory picker and maps the selection to a virtual vault path.',
    args: [],
    returns: 'Promise<object>',
  };
  ipcRenderer.handle('choose-vault', () => vaultAdapter.pickVaultDirectory());
  ipcRenderer.handleSendSync('choose-vault', () => vaultAdapter.getCurrentVault());
  ipcRenderer.handleSend('choose-vault', ({ emit }: any) => {
    emit('choose-vault', vaultAdapter.getCurrentVault());
    return vaultAdapter.getCurrentVault();
  });
  registerChannel('vault-remove', (vaultPath) => vaultAdapter.removeVault(vaultPath), {
    emitOnSend: true,
    description: 'Removes a vault from the registry when it is not open.',
    args: ['path'],
    returns: 'boolean',
  });
  registerChannel('vault-move', (fromPath, toPath) => vaultAdapter.moveVault(fromPath, toPath), {
    emitOnSend: true,
    description: 'Moves a vault on disk and updates its registered path.',
    args: ['fromPath', 'toPath'],
    returns: 'string',
  });
  registerChannel('vault-message', () => '', {
    emitOnSend: true,
    description: 'Broadcasts a message to a vault window.',
    args: ['path', 'message'],
    returns: 'string',
  });
}
