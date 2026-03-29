import { Buffer } from 'buffer';
import path from 'path-browserify';
import { createElectronStub as createCoreElectronStub } from '../../core/electronStub.js';
import { createIpcRendererShim as createCoreIpcRendererShim } from '../../core/ipc/createIpcRendererShim.js';
import { createScriptLoader } from '../../core/runtime/loadScripts.js';
import { isBinaryLike as coreIsBinaryLike, isTextLikePath as coreIsTextLikePath, mimeTypeForPath as coreMimeTypeForPath, missingFileFallback as coreMissingFileFallback, normalizeEncoding as coreNormalizeEncoding, toUint8Array as coreToUint8Array } from '../../core/utils/binary.js';
import { buildVirtualVaultPath as coreBuildVirtualVaultPath, ensureParentDirs as coreEnsureParentDirs, normalizePath as coreNormalizePath, safeVaultName as coreSafeVaultName, splitRelativePath as coreSplitRelativePath } from '../../core/utils/path.js';
import { createStatusUi } from '../../core/utils/statusUi.js';
import { createBrowserVaultAdapter } from './vaultAdapter.js';
import { createBrowserVaultRegistry } from './vaultRegistry.ts';
import { createBrowserHandleStore } from './handleStore.ts';
import { createBrowserFsAdapter } from './fsAdapter.ts';

const statusUi = createStatusUi();
const { setStatus: setStatusCore, showVaultPickerGlow: showVaultPickerGlowCore, hideVaultPickerGlow: hideVaultPickerGlowCore, clearStatus } = statusUi;
const scriptLoader = createScriptLoader();
const { appendScript: appendScriptCore, loadScriptQueue: loadScriptQueueCore } = scriptLoader;

const starterScriptQueue = [
  '/lib/i18next.min.js',
  '/enhance.js',
  '/i18n.js',
  '/starter.js',
];

const mainAppScriptQueue = [
  '/lib/codemirror/codemirror.js',
  '/lib/codemirror/overlay.js',
  '/lib/codemirror/markdown.js',
  '/lib/codemirror/cm-addons.js',
  '/lib/codemirror/vim.js',
  '/lib/codemirror/meta.min.js',
  '/lib/moment.min.js',
  '/lib/pixi.min.js',
  '/lib/i18next.min.js',
  '/lib/scrypt.js',
  '/lib/turndown.js',
  '/enhance.js',
  '/i18n.js',
  '/app.js',
];

const STORAGE_PREFIX = 'obsidian-web:vfs:';
const VAULTS_STORAGE_KEY = 'obsidian-web:vaults';
const VIRTUAL_VAULT_ROOT = '/obsidian-web';
const SANDBOX_VAULT_PATH = `${VIRTUAL_VAULT_ROOT}/Obsidian Sandbox`;
const VAULT_HANDLES_DB = 'obsidian-web';
const VAULT_HANDLES_STORE = 'vault-handles';
const OBSIDIAN_VERSION = '1.12.7';
const DEFAULT_ADBLOCK_LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
];
const MIME_BY_EXTENSION = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};
const vaultRegistryStore = createBrowserVaultRegistry({
  storageKey: VAULTS_STORAGE_KEY,
  normalizePath,
});
const handleStore = createBrowserHandleStore({
  dbName: VAULT_HANDLES_DB,
  storeName: VAULT_HANDLES_STORE,
});
let currentVault = vaultRegistryStore.getCurrentVault();
let selectedDirectoryHandle = null;
let selectedCreateVaultParentHandle = null;
let selectedCreateVaultParentPath = '';
let selectedCreateVaultParentLabel = '';
const vaultHandles = handleStore.handles;

function normalizePath(value) {
  return coreNormalizePath(value);
}

function getVaultEntries() {
  return vaultRegistryStore.getVaultEntries();
}

function getMostRecentVault() {
  return vaultRegistryStore.getMostRecentVault();
}

function createVaultId() {
  return (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
    .replace(/-/g, '')
    .slice(0, 16);
}

function safeVaultName(name) {
  return coreSafeVaultName(name);
}

function buildVirtualVaultPath(name) {
  return coreBuildVirtualVaultPath(VIRTUAL_VAULT_ROOT, name);
}

function upsertVaultRecord(record) {
  return vaultRegistryStore.upsertVaultRecord(record);
}

function getVaultRecordByPath(vaultPath) {
  return vaultRegistryStore.getVaultRecordByPath(vaultPath);
}

function getVaultRecordById(id) {
  return vaultRegistryStore.getVaultRecordById(id);
}

function removeVaultRecord(id) {
  return vaultRegistryStore.removeVaultRecord(id);
}

async function persistVaultHandle(id, handle) {
  return handleStore.persistVaultHandle(id, handle);
}

async function deleteVaultHandle(id) {
  return handleStore.deleteVaultHandle(id);
}

async function restoreVaultHandles() {
  return handleStore.restoreVaultHandles();
}

function isVaultPath(filePath) {
  return browserFsAdapter.isVaultPath(filePath);
}

function hasStoredFile(filePath) {
  return browserFsAdapter.getStoredFile(filePath) != null;
}

function ensureParentDirs(filePath) {
  return coreEnsureParentDirs(filePath, (dir) => virtualDirs.add(dir));
}

function setStatus(message, level = 'info') {
  return setStatusCore(message, level);
}

function showVaultPickerGlow(message = 'Select the vault folder to continue...') {
  return showVaultPickerGlowCore(message);
}

function hideVaultPickerGlow() {
  return hideVaultPickerGlowCore();
}

function mimeTypeForPath(filePath) {
  return coreMimeTypeForPath(filePath, MIME_BY_EXTENSION);
}

function installDomCompatShims() {
  if (typeof Event !== 'undefined' && !Event.prototype.detach) {
    Event.prototype.detach = function detach() {};
  }
  installVaultAssetUrlShims();
}

function normalizeEncoding(value) {
  return coreNormalizeEncoding(value);
}

function isBinaryLike(value) {
  return coreIsBinaryLike(value);
}

function toUint8Array(value) {
  return coreToUint8Array(value);
}

function isTextLikePath(filePath) {
  return coreIsTextLikePath(filePath);
}

function getStoredFile(filePath) {
  return browserFsAdapter.getStoredFile(filePath);
}

function setStoredFile(filePath, value) {
  return browserFsAdapter.setStoredFile(filePath, value);
}

function clearStoredFile(filePath) {
  return browserFsAdapter.clearStoredFile(filePath);
}

function revokeVaultObjectUrl(filePath) {
  return undefined;
}

function getVaultAssetUrlSync(filePath) {
  return null;
}

function listStoredFiles() {
  return browserFsAdapter.listStoredFiles();
}

function resetVirtualFs() {
  return browserFsAdapter.resetVirtualFs();
}

function getCurrentVault() {
  return currentVault ? { ...currentVault } : null;
}

function setCurrentVault(vault) {
  vaultRegistryStore.setCurrentVault(vault);
  currentVault = vaultRegistryStore.getCurrentVault();
}

const browserFsAdapter = createBrowserFsAdapter({
  storagePrefix: STORAGE_PREFIX,
  virtualVaultRoot: VIRTUAL_VAULT_ROOT,
  sandboxVaultPath: SANDBOX_VAULT_PATH,
  normalizePath,
  ensureParentDirs,
  normalizeEncoding,
  isBinaryLike,
  toUint8Array,
  isTextLikePath,
  missingFileFallback,
  splitRelativePath,
  getCurrentVault,
  getVaultEntries,
  getSelectedDirectoryHandle: () => selectedDirectoryHandle,
  mimeTypeForPath,
});
const { virtualDirs } = browserFsAdapter;

function isCurrentVaultPath(filePath) {
  const current = getCurrentVault();
  const target = normalizePath(filePath);
  return !!current?.path && (target === current.path || target.startsWith(`${current.path}/`));
}

function getVaultRelativePath(filePath) {
  const target = normalizePath(filePath);
  const current = getCurrentVault();
  if (!current?.path) return null;
  if (target === current.path) return '';
  if (!target.startsWith(`${current.path}/`)) return null;
  return target.slice(current.path.length + 1);
}

function isObsidianConfigJson(filePath) {
  const target = normalizePath(filePath);
  return target.includes('/.obsidian/') && target.endsWith('.json');
}

function missingFileFallback(filePath, options) {
  return coreMissingFileFallback(filePath, options, isObsidianConfigJson);
}

function splitRelativePath(relativePath) {
  return coreSplitRelativePath(relativePath);
}

function clearVaultCache(vaultPath) {
  return browserFsAdapter.clearVaultCache(vaultPath);
}

async function ensureVaultPathExists(vaultPath, create) {
  return browserFsAdapter.ensureVaultPathExists(vaultPath, create);
}

async function ensureVaultBootstrapFiles(vaultPath) {
  return browserFsAdapter.ensureVaultBootstrapFiles(vaultPath);
}

async function refreshSelectedVaultCache() {
  return browserFsAdapter.refreshSelectedVaultCache();
}

async function getVaultFile(filePath) {
  return browserFsAdapter.getVaultFile(filePath);
}

function installVaultAssetUrlShims() {
  return browserFsAdapter.installVaultAssetUrlShims();
}

function createFsStub() {
  return browserFsAdapter.createFsStub();
}

function buildVaultList() {
  return Object.fromEntries(
    getVaultEntries().map((entry) => [
      entry.id,
      {
        path: entry.path,
        ts: entry.ts,
        open: Boolean(currentVault && entry.id === currentVault.id),
      },
    ]),
  );
}

async function pickVaultDirectory() {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('Directory picker is not supported in this browser');
  }

  await openDirectoryDialog();
  return getCurrentVault();
}

async function openDirectoryDialog(options = {}) {
  showVaultPickerGlow(options.title || 'Select the vault folder to continue...');
  try {
    const handle = await window.showDirectoryPicker({
      id: 'obsidian-web-vault',
      startIn: 'documents',
    });
    const vaultPath = buildVirtualVaultPath(handle.name);
    const existing = options.vaultId ? getVaultRecordById(options.vaultId) : getVaultRecordByPath(vaultPath);
    const vault = upsertVaultRecord({
      id: existing?.id || createVaultId(),
      name: handle.name || 'vault',
      path: vaultPath,
      ts: Date.now(),
      open: true,
    });
    selectedDirectoryHandle = handle;
    await persistVaultHandle(vault.id, handle);
    setCurrentVault(vault);
    await refreshSelectedVaultCache();

    window.dispatchEvent(
      new CustomEvent('obsidian-web:vault-picked', {
        detail: {
          handle,
          options,
          vault: getCurrentVault(),
        },
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

async function chooseCreateVaultParent(title, applyPath) {
  showVaultPickerGlow(title || 'Select where to create the vault...');
  try {
    const handle = await window.showDirectoryPicker({
      id: 'obsidian-web-vault-parent',
      startIn: 'documents',
    });
    selectedCreateVaultParentHandle = handle;
    selectedCreateVaultParentPath = buildVirtualVaultPath(handle.name || 'vaults');
    selectedCreateVaultParentLabel = safeVaultName(handle.name || 'vaults');
    if (typeof applyPath === 'function') applyPath(selectedCreateVaultParentLabel);
    return selectedCreateVaultParentPath;
  } finally {
    hideVaultPickerGlow();
  }
}

function openDirectoryDialogSync(options = {}) {
  const fallbackPath = normalizePath(options.defaultPath) || getCurrentVault()?.path || VIRTUAL_VAULT_ROOT;
  const chosenPath = window.prompt(options.title || 'Choose vault folder', fallbackPath);

  if (chosenPath == null) return undefined;

  const normalizedPath = normalizePath(chosenPath) || fallbackPath;
  const existing = getVaultRecordByPath(normalizedPath);
  setCurrentVault(existing || upsertVaultRecord({
    id: existing?.id || createVaultId(),
    name: path.basename(normalizedPath),
    path: normalizedPath,
    ts: Date.now(),
    open: true,
  }));
  selectedDirectoryHandle = null;
  clearVaultCache(currentVault.path);
  virtualDirs.add(currentVault.path);
  window.dispatchEvent(
    new CustomEvent('obsidian-web:vault-picked', {
      detail: {
        handle: null,
        options,
        vault: getCurrentVault(),
        syncFallback: true,
      },
    }),
  );

  return [getCurrentVault().path];
}

function createIpcRendererShim() {
  return createCoreIpcRendererShim();
}

function createElectronStub() {
  return createCoreElectronStub({ openDirectoryDialog, openDirectoryDialogSync });
}

function createUrlStub() {
  return {
    URL,
    pathToFileURL(filePath) {
      const normalized = String(filePath).replace(/\\/g, '/');
      return new URL(normalized.startsWith('/') ? normalized : `/${normalized}`, window.location.origin);
    },
  };
}

function installShims() {
  installDomCompatShims();
  const fsStub = createFsStub();
  const electronStub = createElectronStub();
  const urlStub = createUrlStub();
  const ipcChannelDocs = {};

  const registerChannel = (channel, resolver, options = {}) => {
    const { emitOnSend = false, description = '', args = [], returns = 'undefined' } = options;

    ipcChannelDocs[channel] = {
      description,
      args,
      returns,
    };

    electronStub.ipcRenderer.handle(channel, ({ args }) => resolver(...args));
    electronStub.ipcRenderer.handleSendSync(channel, ({ args }) => resolver(...args));
    electronStub.ipcRenderer.handleSend(channel, ({ args, emit }) => {
      const result = resolver(...args);
      if (emitOnSend) emit(channel, result);
      return result;
    });
  };

  const dispatchHostEvent = (name, detail) => {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  };

  registerChannel('vault', () => browserVaultAdapter.getCurrentVault(), { emitOnSend: true, description: 'Returns the current vault associated with the active web contents.', returns: 'object|null' });
  registerChannel('vault-list', () => buildVaultList(), { emitOnSend: true, description: 'Returns the host-maintained vault registry keyed by vault id.', returns: 'object' });
  registerChannel('vault-open', (vaultPath, create) => browserVaultAdapter.openVault(vaultPath, create), { emitOnSend: true, description: 'Opens or creates a vault at a path and switches the active vault in the web shell.', args: ['path', 'create'], returns: 'boolean|string' });
  ipcChannelDocs['choose-vault'] = {
    description: 'Opens a browser directory picker and maps the selection to a virtual vault path.',
    args: [],
    returns: 'Promise<object>',
  };
  electronStub.ipcRenderer.handle('choose-vault', () => browserVaultAdapter.pickVaultDirectory());
  electronStub.ipcRenderer.handleSendSync('choose-vault', () => browserVaultAdapter.getCurrentVault());
  electronStub.ipcRenderer.handleSend('choose-vault', ({ emit }) => {
    emit('choose-vault', browserVaultAdapter.getCurrentVault());
    return browserVaultAdapter.getCurrentVault();
  });
  registerChannel('vault-remove', (vaultPath) => browserVaultAdapter.removeVault(vaultPath), { emitOnSend: true, description: 'Removes a vault from the registry when it is not open.', args: ['path'], returns: 'boolean' });
  registerChannel('vault-move', (fromPath, toPath) => browserVaultAdapter.moveVault(fromPath, toPath), { emitOnSend: true, description: 'Moves a vault on disk and updates its registered path.', args: ['fromPath', 'toPath'], returns: 'string' });
  registerChannel('vault-message', () => '', { emitOnSend: true, description: 'Broadcasts a message to a vault window.', args: ['path', 'message'], returns: 'string' });
  registerChannel('version', () => OBSIDIAN_VERSION, { emitOnSend: true, description: 'Returns the app package version.', returns: 'string' });
  registerChannel('is-dev', () => undefined, { emitOnSend: true, description: 'Reports whether the desktop host is a dev build; intentionally returns undefined for now.', returns: 'undefined' });
  registerChannel('is-quitting', () => false, { emitOnSend: true, description: 'Reports whether the desktop host is in the middle of quitting.', returns: 'boolean' });
  registerChannel('desktop-dir', () => '/desktop', { emitOnSend: true, description: 'Returns the desktop directory path used by the host.', returns: 'string' });
  registerChannel('documents-dir', () => '/documents', { emitOnSend: true, description: 'Returns the documents directory path used by the host.', returns: 'string' });
  registerChannel('resources', () => '/', { emitOnSend: true, description: 'Returns the desktop resources/app path.', returns: 'string' });
  registerChannel('file-url', () => `${window.location.origin}/`, { emitOnSend: true, description: 'Returns the resource file URL prefix used by the desktop host.', returns: 'string' });
  registerChannel('get-sandbox-vault-path', () => browserVaultAdapter.getSandboxVaultPath(), { emitOnSend: true, description: 'Returns the sandbox vault path.', returns: 'string' });
  registerChannel('get-documents-path', () => '/documents', { emitOnSend: true, description: 'Legacy alias for documents-dir.', returns: 'string' });
  registerChannel('get-default-vault-path', () => browserVaultAdapter.getDefaultVaultPath(), { emitOnSend: true, description: 'Returns the host default vault path suggestion.', returns: 'string' });
  registerChannel('adblock-frequency', () => 4, { emitOnSend: true, description: 'Reads or updates the adblock refresh interval in days.', args: ['days'], returns: 'number' });
  registerChannel('adblock-lists', () => [...DEFAULT_ADBLOCK_LISTS], { emitOnSend: true, description: 'Reads or updates the adblock subscription URL list.', args: ['lists'], returns: 'string[]' });
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
  }, {
    description: 'Requests an application relaunch and quit sequence.',
    returns: 'undefined',
  });
  registerChannel('frame', (...args) => {
    dispatchHostEvent('obsidian-web:frame', { args });
    return undefined;
  }, {
    description: 'Reads or updates the stored frame/titlebar preference.',
    args: ['frameValue'],
    returns: 'undefined',
  });
  registerChannel('sandbox', (...args) => {
    dispatchHostEvent('obsidian-web:sandbox', { args, path: SANDBOX_VAULT_PATH });
    return undefined;
  }, {
    description: 'Opens the built-in sandbox vault flow.',
    returns: 'undefined',
  });
  registerChannel('starter', (...args) => {
    dispatchHostEvent('obsidian-web:starter', { args });
    return undefined;
  }, {
    description: 'Opens the starter/create-or-open-vault UI.',
    returns: 'undefined',
  });
  registerChannel('help', (...args) => {
    dispatchHostEvent('obsidian-web:help', { args });
    return undefined;
  }, {
    description: 'Opens the help UI/window.',
    returns: 'undefined',
  });

  if (currentVault?.path) virtualDirs.add(currentVault.path);

  window.Buffer = Buffer;
  window.global = window;
  window.process = {
    env: {},
    platform: navigator.userAgent.includes('Windows') ? 'win32' : 'linux',
    arch: 'x64',
    versions: {
      electron: '32.0.0',
      node: '20.0.0',
    },
    cwd() {
      return '/';
    },
  };
  window.electron = electronStub;
  window.require = (id) => {
    switch (id) {
      case 'electron':
        return electronStub;
      case '@electron/remote':
        return electronStub.remote;
      case 'fs':
      case 'original-fs':
        return fsStub;
      case 'path':
        return path;
      case 'url':
        return urlStub;
      case 'os':
        return {
          homedir: () => '/',
          hostname: () => 'obsidian-web',
          tmpdir: () => '/tmp',
          platform: () => window.process.platform,
          release: () => '6.0.0-web',
          version: () => 'Web Kernel 1.0',
          EOL: '\n',
        };
      case 'buffer':
        return { Buffer };
      case 'btime':
        return {
          birthtimeMs: () => Date.now(),
        };
      case 'get-fonts':
        return {
          getFonts: async () => [],
        };
      default:
        throw new Error(`Unsupported window.require module: ${id}`);
    }
  };

  window.__OBSIDIAN_WEB_SHIM__ = {
    fsStub,
    electronStub,
    ipcChannels: ipcChannelDocs,
    ipcRenderer: electronStub.ipcRenderer,
    getCurrentVault: browserVaultAdapter.getCurrentVault,
    listVaults: browserVaultAdapter.listVaults,
    listVirtualFs: browserVaultAdapter.listVirtualFs,
    launchMainApp,
    chooseCreateVaultParent: browserVaultAdapter.chooseCreateVaultParent,
    createLocalVault: browserVaultAdapter.createLocalVault,
    openFolderAsVault: browserVaultAdapter.openFolderAsVault,
    pickVaultDirectory: browserVaultAdapter.pickVaultDirectory,
    resetVirtualFs: browserVaultAdapter.resetVirtualFs,
    selectedDirectoryHandle: browserVaultAdapter.getSelectedDirectoryHandle,
    vaultAdapter: browserVaultAdapter,
    showOpenDialogSyncCompat(options) {
      const result = electronStub.remote.dialog.showOpenDialogSync(options);
      return Array.isArray(result) && result.length > 0 ? result[0] : null;
    },
    syncStore: browserFsAdapter.syncStore,
  };
}

function appendScript(src) {
  return appendScriptCore(src);
}

async function loadScriptQueue(queue, label) {
  return loadScriptQueueCore(queue, label, setStatus);
}

async function launchMainApp(vaultPath = currentVault?.path) {
  const nextPath = normalizePath(vaultPath) || getCurrentVault()?.path;
  if (!nextPath) throw new Error('No vault selected');
  const existing = getVaultRecordByPath(nextPath);
  setCurrentVault(existing || { ...(getCurrentVault() || {}), path: nextPath });
  await browserVaultAdapter.prepareForLaunch();
  for (const element of document.querySelectorAll('.starter-screen, .modal-container, .prompt')) {
    element.remove();
  }
  document.body.classList.remove('starter');
  document.body.classList.add('app-container');
  setStatus('Loading extracted Obsidian app...');
  await loadScriptQueue(mainAppScriptQueue, 'Loading');
  clearStatus();
}

async function openFolderAsVault(ipcRenderer, messages, NoticeCtor) {
  try {
    const vault = await pickVaultDirectory();
    const result = ipcRenderer.sendSync('vault-open', vault.path, false);
    if (result === true) return true;
    new NoticeCtor(`${messages.msgErrorFailedToOpenVault()} ${result}.`);
    return false;
  } catch (error) {
    if (error && error.name === 'AbortError') return false;
    console.error(error);
    if (NoticeCtor) new NoticeCtor(String(error.message || error));
    return false;
  }
}

async function createLocalVault(ipcRenderer, messages, NoticeCtor, vaultName, syncConfig) {
  try {
    if (!selectedCreateVaultParentHandle) {
      await chooseCreateVaultParent(`Choose where to create '${vaultName}'...`);
    }
    const parentHandle = selectedCreateVaultParentHandle;
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
    selectedDirectoryHandle = handle;
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
      selectedCreateVaultParentHandle = null;
      selectedCreateVaultParentPath = '';
      selectedCreateVaultParentLabel = '';
      return true;
    }
    new NoticeCtor(`${messages.msgFailedToCreateVault()} ${result}.`);
    return false;
  } catch (error) {
    if (error?.name === 'AbortError') return false;
    console.error(error);
    if (NoticeCtor) new NoticeCtor(String(messages.msgFailedToCreateVaultAtLocation?.() || error.message || error));
    return false;
  } finally {
    hideVaultPickerGlow();
  }
}

const browserVaultAdapter = createBrowserVaultAdapter({
  getCurrentVault,
  getVaultEntries,
  listStoredFiles,
  resetVirtualFs,
  VIRTUAL_VAULT_ROOT,
  SANDBOX_VAULT_PATH,
  getSelectedDirectoryHandle: () => selectedDirectoryHandle,
  setSelectedDirectoryHandle: (handle) => { selectedDirectoryHandle = handle; },
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
  setCurrentVault,
  ensureVaultPathExists,
  refreshSelectedVaultCache,
  launchMainApp,
  deleteVaultHandle,
  removeVaultRecord,
  clearVaultCache,
  ensureVaultBootstrapFiles,
  restoreVaultHandles,
  getCurrentVaultState: () => currentVault,
});

export async function bootBrowserApp() {
  window.addEventListener('error', (event) => {
    console.error(event.error || event.message);
    setStatus(`Runtime error: ${event.message}`, 'error');
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error(event.reason);
    setStatus(`Unhandled rejection: ${String(event.reason)}`, 'error');
  });

  await browserVaultAdapter.init();
  installShims();
  setStatus('Loading extracted Obsidian starter screen...');

  await loadScriptQueue(starterScriptQueue, 'Loading');

  clearStatus();
}
