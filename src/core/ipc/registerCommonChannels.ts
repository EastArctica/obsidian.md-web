type RegisterChannel = (
  channel: string,
  resolver: (...args: any[]) => any,
  options?: { emitOnSend?: boolean; description?: string; args?: string[]; returns?: string },
) => void;

type RegisterCommonChannelsOptions = {
  registerChannel: RegisterChannel;
  dispatchHostEvent: (name: string, detail: any) => void;
  vaultAdapter: { getDefaultVaultPath: () => string; getSandboxVaultPath: () => string };
  obsidianVersion: string;
  adblockLists: string[];
};

export function registerCommonChannels(options: RegisterCommonChannelsOptions) {
  const { registerChannel, dispatchHostEvent, vaultAdapter, obsidianVersion, adblockLists } = options;

  registerChannel('version', () => obsidianVersion, { emitOnSend: true, description: 'Returns the app package version.', returns: 'string' });
  registerChannel('is-dev', () => undefined, { emitOnSend: true, description: 'Reports whether the desktop host is a dev build; intentionally returns undefined for now.', returns: 'undefined' });
  registerChannel('is-quitting', () => false, { emitOnSend: true, description: 'Reports whether the desktop host is in the middle of quitting.', returns: 'boolean' });
  registerChannel('desktop-dir', () => '/desktop', { emitOnSend: true, description: 'Returns the desktop directory path used by the host.', returns: 'string' });
  registerChannel('documents-dir', () => '/documents', { emitOnSend: true, description: 'Returns the documents directory path used by the host.', returns: 'string' });
  registerChannel('resources', () => '/', { emitOnSend: true, description: 'Returns the desktop resources/app path.', returns: 'string' });
  registerChannel('file-url', () => `${window.location.origin}/`, { emitOnSend: true, description: 'Returns the resource file URL prefix used by the desktop host.', returns: 'string' });
  registerChannel('get-sandbox-vault-path', () => vaultAdapter.getSandboxVaultPath(), { emitOnSend: true, description: 'Returns the sandbox vault path.', returns: 'string' });
  registerChannel('get-documents-path', () => '/documents', { emitOnSend: true, description: 'Legacy alias for documents-dir.', returns: 'string' });
  registerChannel('get-default-vault-path', () => vaultAdapter.getDefaultVaultPath(), { emitOnSend: true, description: 'Returns the host default vault path suggestion.', returns: 'string' });
  registerChannel('adblock-frequency', () => 4, { emitOnSend: true, description: 'Reads or updates the adblock refresh interval in days.', args: ['days'], returns: 'number' });
  registerChannel('adblock-lists', () => [...adblockLists], { emitOnSend: true, description: 'Reads or updates the adblock subscription URL list.', args: ['lists'], returns: 'string[]' });
  registerChannel('update', () => '', { emitOnSend: true, description: 'Returns the current update status string.', returns: 'string' });
  registerChannel('check-update', () => false, { emitOnSend: true, description: 'Triggers update checking and returns whether a check is in progress.', args: ['manual'], returns: 'boolean' });
  registerChannel('disable-update', () => undefined, { emitOnSend: true, description: 'Reads or toggles the stored auto-update disabled flag.', args: ['enabled'], returns: 'undefined' });
  registerChannel('disable-gpu', () => undefined, { emitOnSend: true, description: 'Reads or toggles the stored disable-gpu preference.', args: ['enabled'], returns: 'undefined' });
  registerChannel('insider-build', () => false, { emitOnSend: true, description: 'Reads or toggles insider build mode.', args: ['enabled'], returns: 'boolean' });
  registerChannel('cli', () => false, { emitOnSend: true, description: 'Reads or toggles the embedded CLI server feature.', args: ['enabled'], returns: 'boolean' });
  registerChannel('set-icon', () => undefined, { emitOnSend: true, description: 'Updates a tray/app/window icon reference in the desktop host.', args: ['iconName', 'value'], returns: 'undefined' });
  registerChannel('get-icon', () => undefined, { emitOnSend: true, description: 'Reads a previously stored icon value from the desktop host.', args: ['iconName'], returns: 'undefined' });
  registerChannel('copy-asar', () => false, { emitOnSend: true, description: 'Copies a downloaded asar into the user data update cache.', args: ['asarPath'], returns: 'boolean' });
  registerChannel('context-menu', () => undefined, { emitOnSend: true, description: 'Records the sender that most recently opened a context menu.', returns: 'undefined' });
  registerChannel('request-url', () => undefined, { emitOnSend: true, description: 'Desktop network bridge that performs a request and replies asynchronously over IPC.', args: ['replyChannel', 'requestOptions'], returns: 'undefined' });
  registerChannel('open-url', () => undefined, { emitOnSend: true, description: 'Requests the host to open or route a URL.', args: ['url'], returns: 'undefined' });
  registerChannel('trash', () => false, { emitOnSend: true, description: 'Moves a path to the OS trash.', args: ['path'], returns: 'boolean' });
  registerChannel('set-menu', () => undefined, { emitOnSend: true, description: 'Builds and installs an application menu from a serialized template.', args: ['menuSpec'], returns: 'undefined' });
  registerChannel('update-menu-items', () => undefined, { emitOnSend: true, description: 'Updates menu item enabled/checked state for the active window.', args: ['menuId', 'itemId', 'patch'], returns: 'undefined' });
  registerChannel('print-to-pdf', () => undefined, { emitOnSend: true, description: 'Asks the host webContents to print the current page to PDF.', args: ['options'], returns: 'undefined' });
  registerChannel('relaunch', (...args) => {
    dispatchHostEvent('obsidian-web:relaunch', { args });
    return undefined;
  }, { description: 'Requests an application relaunch and quit sequence.', returns: 'undefined' });
  registerChannel('frame', (...args) => {
    dispatchHostEvent('obsidian-web:frame', { args });
    return undefined;
  }, { description: 'Reads or updates the stored frame/titlebar preference.', args: ['frameValue'], returns: 'undefined' });
  registerChannel('sandbox', (...args) => {
    dispatchHostEvent('obsidian-web:sandbox', { args, path: vaultAdapter.getSandboxVaultPath() });
    return undefined;
  }, { description: 'Opens the built-in sandbox vault flow.', returns: 'undefined' });
  registerChannel('starter', (...args) => {
    dispatchHostEvent('obsidian-web:starter', { args });
    return undefined;
  }, { description: 'Opens the starter/create-or-open-vault UI.', returns: 'undefined' });
  registerChannel('help', (...args) => {
    dispatchHostEvent('obsidian-web:help', { args });
    return undefined;
  }, { description: 'Opens the help UI/window.', returns: 'undefined' });
}
