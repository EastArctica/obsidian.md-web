import { Buffer } from 'buffer';
import path from 'path-browserify';
import { createElectronStub as createCoreElectronStub } from '../../core/electronStub.js';
import { createIpcRendererShim as createCoreIpcRendererShim } from '../../core/ipc/createIpcRendererShim.js';
import { registerCommonChannels } from '../../core/ipc/registerCommonChannels.ts';
import { registerVaultChannels } from '../../core/ipc/registerVaultChannels.ts';
import { createScriptLoader } from '../../core/runtime/loadScripts.js';
import { isBinaryLike as coreIsBinaryLike, isTextLikePath as coreIsTextLikePath, mimeTypeForPath as coreMimeTypeForPath, missingFileFallback as coreMissingFileFallback, normalizeEncoding as coreNormalizeEncoding, toUint8Array as coreToUint8Array } from '../../core/utils/binary.js';
import { buildVirtualVaultPath as coreBuildVirtualVaultPath, ensureParentDirs as coreEnsureParentDirs, normalizePath as coreNormalizePath, safeVaultName as coreSafeVaultName, splitRelativePath as coreSplitRelativePath } from '../../core/utils/path.js';
import { createStatusUi } from '../../core/utils/statusUi.js';
import { createBrowserVaultAdapter } from './vaultAdapter.js';
import { createBrowserDialogs } from './dialogs.ts';
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
let dialogs;

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

dialogs = createBrowserDialogs({
  buildVirtualVaultPath,
  browserVaultAdapterRef: () => browserVaultAdapter,
  chooseCreateVaultParentLabel: (label) => { selectedCreateVaultParentLabel = label; },
  createVaultId,
  getCurrentVault,
  getVaultRecordById,
  getVaultRecordByPath,
  hideVaultPickerGlow,
  launchMainApp,
  normalizePath,
  persistVaultHandle,
  refreshSelectedVaultCache,
  safeVaultName,
  setCurrentVault,
  setSelectedCreateVaultParentHandle: (handle) => { selectedCreateVaultParentHandle = handle; },
  getSelectedCreateVaultParentHandle: () => selectedCreateVaultParentHandle,
  setSelectedCreateVaultParentPath: (value) => { selectedCreateVaultParentPath = value; },
  setSelectedDirectoryHandle: (handle) => { selectedDirectoryHandle = handle; },
  showVaultPickerGlow,
  upsertVaultRecord,
});

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
  return dialogs.pickVaultDirectory();
}

async function openDirectoryDialog(options = {}) {
  return dialogs.openDirectoryDialog(options);
}

async function chooseCreateVaultParent(title, applyPath) {
  return dialogs.chooseCreateVaultParent(title, applyPath);
}

function openDirectoryDialogSync(options = {}) {
  return dialogs.openDirectoryDialogSync(options);
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

  registerVaultChannels({
    registerChannel,
    ipcChannelDocs,
    ipcRenderer: electronStub.ipcRenderer,
    vaultAdapter: browserVaultAdapter,
    buildVaultList,
  });
  registerCommonChannels({
    registerChannel,
    dispatchHostEvent,
    vaultAdapter: browserVaultAdapter,
    obsidianVersion: OBSIDIAN_VERSION,
    adblockLists: DEFAULT_ADBLOCK_LISTS,
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
  return dialogs.openFolderAsVault(ipcRenderer, messages, NoticeCtor);
}

async function createLocalVault(ipcRenderer, messages, NoticeCtor, vaultName, syncConfig) {
  return dialogs.createLocalVault(ipcRenderer, messages, NoticeCtor, vaultName, syncConfig);
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
