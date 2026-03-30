import { Buffer } from 'buffer';
import path from 'path-browserify';
import { createElectronStub } from '../../core/electronStub.js';
import { registerCommonChannels } from '../../core/ipc/registerCommonChannels.ts';
import { registerVaultChannels } from '../../core/ipc/registerVaultChannels.ts';
import { createScriptLoader } from '../../core/runtime/loadScripts.js';
import { createStatusUi } from '../../core/utils/statusUi.js';
import { createSelfhostedApiClient } from './apiClient.ts';
import { createSelfhostedDialogs } from './dialogs.ts';
import { createSelfhostedFsAdapter } from './fsAdapter.ts';
import { createSelfhostedVaultAdapter } from './vaultAdapter.ts';

const OBSIDIAN_VERSION = '1.12.7';
const DEFAULT_ADBLOCK_LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
];
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
const PENDING_VAULT_KEY = 'obsidian-web:pending-vault';

const statusUi = createStatusUi();
const { setStatus, clearStatus } = statusUi;
const scriptLoader = createScriptLoader();
const apiClient = createSelfhostedApiClient();
let launchMainApp = async () => {
  throw new Error('Selfhosted launchMainApp is not initialized yet');
};
function requestVaultSwitch(vaultPath) {
  if (!vaultPath) return;
  sessionStorage.setItem(PENDING_VAULT_KEY, vaultPath);
  window.location.reload();
}
function goToStarterPage() {
  sessionStorage.removeItem(PENDING_VAULT_KEY);
  window.location.reload();
}
let selfhostedVaultAdapter;
const dialogs = createSelfhostedDialogs({
  setStatus,
  getDefaultVaultPath: () => selfhostedVaultAdapter?.getDefaultVaultPath?.() || '/vaults',
  listVaults: () => selfhostedVaultAdapter?.listVaults?.() || [],
});
const fsAdapter = createSelfhostedFsAdapter({ apiClient });
selfhostedVaultAdapter = createSelfhostedVaultAdapter({ apiClient, dialogs, fsAdapter, launchMainApp: (...args) => launchMainApp(...args), requestVaultSwitch, setStatus });

function createUrlStub() {
  return {
    URL,
    pathToFileURL(filePath) {
      const normalized = String(filePath).replace(/\\/g, '/');
      return new URL(normalized.startsWith('/') ? normalized : `/${normalized}`, window.location.origin);
    },
  };
}

function installDomCompatShims() {
  const DRAG_PIXEL_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
  if (typeof Event !== 'undefined' && !Event.prototype.detach) {
    Event.prototype.detach = function detach() {};
  }
  if (typeof Event !== 'undefined' && !('doc' in Event.prototype)) {
    Object.defineProperty(Event.prototype, 'doc', {
      configurable: true,
      get() {
        return this.view?.document || document;
      },
    });
  }
  if (typeof Event !== 'undefined' && !('win' in Event.prototype)) {
    Object.defineProperty(Event.prototype, 'win', {
      configurable: true,
      get() {
        return this.view || window;
      },
    });
  }
  if (typeof Event !== 'undefined' && !('targetNode' in Event.prototype)) {
    Object.defineProperty(Event.prototype, 'targetNode', {
      configurable: true,
      get() {
        return this.target;
      },
    });
  }
  if (typeof Element !== 'undefined' && !Element.prototype.__obsidianPatchedAppend) {
    const originalAppend = Element.prototype.append;
    Object.defineProperty(Element.prototype, '__obsidianPatchedAppend', { value: true });
    Element.prototype.append = function patchedAppend(...nodes) {
      for (const node of nodes) {
        if (node instanceof HTMLImageElement && node.src === DRAG_PIXEL_SRC) {
          node.width = 1;
          node.height = 1;
          node.style.position = 'fixed';
          node.style.left = '-9999px';
          node.style.top = '-9999px';
          node.style.width = '1px';
          node.style.height = '1px';
          node.style.opacity = '0';
          node.style.pointerEvents = 'none';
          node.style.zIndex = '-1';
        }
      }
      return originalAppend.apply(this, nodes);
    };
  }
}

function installShims() {
  installDomCompatShims();
  fsAdapter.installResourceHandling();
  const fsStub = fsAdapter.createFsStub();
  const electronStub = createElectronStub({
    openDirectoryDialog: dialogs.openDirectoryDialog,
    openDirectoryDialogSync: dialogs.openDirectoryDialogSync,
  });
  const urlStub = createUrlStub();
  const ipcChannelDocs = {};

  const registerChannel = (channel, resolver, options = {}) => {
    const { emitOnSend = false, description = '', args = [], returns = 'undefined' } = options;
    ipcChannelDocs[channel] = { description, args, returns };

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
    vaultAdapter: selfhostedVaultAdapter,
    buildVaultList: () => Object.fromEntries(
      selfhostedVaultAdapter.listVaults().map((entry) => [entry.id, { path: entry.path, ts: entry.ts, open: entry.id === selfhostedVaultAdapter.getCurrentVault()?.id }]),
    ),
  });
  registerCommonChannels({
    registerChannel,
    dispatchHostEvent,
    vaultAdapter: selfhostedVaultAdapter,
    obsidianVersion: OBSIDIAN_VERSION,
    adblockLists: DEFAULT_ADBLOCK_LISTS,
    onStarter: goToStarterPage,
  });

  window.Buffer = Buffer;
  window.global = window;
  window.process = {
    env: {},
    platform: navigator.userAgent.includes('Windows') ? 'win32' : 'linux',
    arch: 'x64',
    versions: { electron: '32.0.0', node: '20.0.0' },
    cwd() { return '/'; },
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
          hostname: () => 'obsidian-selfhosted',
          tmpdir: () => '/tmp',
          platform: () => window.process.platform,
          release: () => '6.0.0-selfhosted',
          version: () => 'Selfhosted Kernel 1.0',
          EOL: '\n',
        };
      case 'buffer':
        return { Buffer };
      case 'btime':
        return { birthtimeMs: () => Date.now() };
      case 'get-fonts':
        return { getFonts: async () => [] };
      default:
        throw new Error(`Unsupported window.require module: ${id}`);
    }
  };

  window.__OBSIDIAN_WEB_SHIM__ = {
    target: 'selfhosted',
    apiClient,
    fsStub,
    electronStub,
    ipcChannels: ipcChannelDocs,
    ipcRenderer: electronStub.ipcRenderer,
    getCurrentVault: selfhostedVaultAdapter.getCurrentVault,
    listVaults: selfhostedVaultAdapter.listVaults,
    vaultAdapter: selfhostedVaultAdapter,
    chooseCreateVaultParent: selfhostedVaultAdapter.chooseCreateVaultParent,
    createLocalVault: selfhostedVaultAdapter.createLocalVault,
    openFolderAsVault: selfhostedVaultAdapter.openFolderAsVault,
    openDirectoryDialog: selfhostedVaultAdapter.openDirectoryDialog,
    openDirectoryDialogSync: selfhostedVaultAdapter.openDirectoryDialogSync,
    showOpenDialogSyncCompat(options) {
      const result = electronStub.remote.dialog.showOpenDialogSync(options);
      return Array.isArray(result) && result.length > 0 ? result[0] : null;
    },
    syncStore: fsAdapter.syncStore,
  };
}

export async function bootSelfhostedApp() {
  window.addEventListener('error', (event) => {
    console.error(event.error || event.message);
    setStatus(`Runtime error: ${event.message}`, 'error');
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error(event.reason);
    setStatus(`Unhandled rejection: ${String(event.reason)}`, 'error');
  });

  await selfhostedVaultAdapter.init();
  installShims();
  launchMainApp = async (vaultPath = selfhostedVaultAdapter.getCurrentVault()?.path) => {
    if (vaultPath) {
      const currentVault = selfhostedVaultAdapter.listVaults().find((vault) => vault.path === vaultPath);
      if (currentVault) {
        // currentVault is updated asynchronously in the adapter; no-op placeholder for now.
      }
    }
    await selfhostedVaultAdapter.prepareForLaunch();
    for (const element of document.querySelectorAll('.starter-screen, .modal-container, .prompt')) {
      element.remove();
    }
    document.body.classList.remove('starter');
    document.body.classList.add('app-container');
    setStatus('Loading extracted Obsidian app...');
    await scriptLoader.loadScriptQueue(mainAppScriptQueue, 'Loading', setStatus);
    clearStatus();
  };
  const pendingVaultPath = sessionStorage.getItem(PENDING_VAULT_KEY);
  if (pendingVaultPath) {
    sessionStorage.removeItem(PENDING_VAULT_KEY);
    const result = selfhostedVaultAdapter.openVault(pendingVaultPath, false);
    if (result === true) return;
  }
  setStatus('Loading Obsidian starter screen in selfhosted scaffolding mode...');
  await scriptLoader.loadScriptQueue(starterScriptQueue, 'Loading', setStatus);
  clearStatus();
}
