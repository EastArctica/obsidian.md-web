import { Buffer } from 'buffer';
import path from 'path-browserify';
import { createElectronStub as createCoreElectronStub } from '../../core/electronStub.js';
import { createIpcRendererShim as createCoreIpcRendererShim } from '../../core/ipc/createIpcRendererShim.js';
import { createScriptLoader } from '../../core/runtime/loadScripts.js';
import { isBinaryLike as coreIsBinaryLike, isTextLikePath as coreIsTextLikePath, mimeTypeForPath as coreMimeTypeForPath, missingFileFallback as coreMissingFileFallback, normalizeEncoding as coreNormalizeEncoding, toUint8Array as coreToUint8Array } from '../../core/utils/binary.js';
import { buildVirtualVaultPath as coreBuildVirtualVaultPath, ensureParentDirs as coreEnsureParentDirs, normalizePath as coreNormalizePath, safeVaultName as coreSafeVaultName, splitRelativePath as coreSplitRelativePath } from '../../core/utils/path.js';
import { createStatusUi } from '../../core/utils/statusUi.js';

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

const syncStore = new Map();
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
const virtualDirs = new Set(['/', VIRTUAL_VAULT_ROOT, SANDBOX_VAULT_PATH]);
const vaultObjectUrls = new Map();
let vaultRegistry = loadVaultRegistry();
let currentVault = getMostRecentVault();
let selectedDirectoryHandle = null;
let selectedDirectoryVersion = 0;
let selectedCreateVaultParentHandle = null;
let selectedCreateVaultParentPath = '';
let selectedCreateVaultParentLabel = '';
const vaultHandles = new Map();
let vaultHandleDbPromise = null;

function normalizePath(value) {
  return coreNormalizePath(value);
}

function loadVaultRegistry() {
  try {
    const raw = localStorage.getItem(VAULTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveVaultRegistry() {
  localStorage.setItem(VAULTS_STORAGE_KEY, JSON.stringify(vaultRegistry));
}

function getVaultEntries() {
  return Object.entries(vaultRegistry)
    .map(([id, record]) => ({ id, ...record }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

function getMostRecentVault() {
  return getVaultEntries()[0] ?? null;
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
  const next = {
    ...vaultRegistry[record.id],
    ...record,
    ts: record.ts ?? Date.now(),
  };
  vaultRegistry = {
    ...vaultRegistry,
    [record.id]: next,
  };
  saveVaultRegistry();
  return { id: record.id, ...next };
}

function getVaultRecordByPath(vaultPath) {
  const normalized = normalizePath(vaultPath);
  return getVaultEntries().find((entry) => normalizePath(entry.path) === normalized) ?? null;
}

function getVaultRecordById(id) {
  const record = vaultRegistry[id];
  return record ? { id, ...record } : null;
}

function removeVaultRecord(id) {
  const { [id]: _removed, ...rest } = vaultRegistry;
  vaultRegistry = rest;
  saveVaultRegistry();
}

function openVaultHandleDb() {
  if (vaultHandleDbPromise) return vaultHandleDbPromise;
  vaultHandleDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(VAULT_HANDLES_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(VAULT_HANDLES_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return vaultHandleDbPromise;
}

async function persistVaultHandle(id, handle) {
  vaultHandles.set(id, handle);
  const db = await openVaultHandleDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT_HANDLES_STORE, 'readwrite');
    tx.objectStore(VAULT_HANDLES_STORE).put(handle, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteVaultHandle(id) {
  vaultHandles.delete(id);
  const db = await openVaultHandleDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT_HANDLES_STORE, 'readwrite');
    tx.objectStore(VAULT_HANDLES_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function restoreVaultHandles() {
  const db = await openVaultHandleDb();
  const ids = await new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT_HANDLES_STORE, 'readonly');
    const request = tx.objectStore(VAULT_HANDLES_STORE).getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await Promise.all(ids.map(async (id) => {
    const handle = await new Promise((resolve, reject) => {
      const tx = db.transaction(VAULT_HANDLES_STORE, 'readonly');
      const request = tx.objectStore(VAULT_HANDLES_STORE).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (handle) vaultHandles.set(id, handle);
  }));
}

function isVaultPath(filePath) {
  const target = normalizePath(filePath);
  return getVaultEntries().some((entry) => target === entry.path || target.startsWith(`${entry.path}/`));
}

function hasStoredFile(filePath) {
  const target = normalizePath(filePath);
  return syncStore.has(target) || localStorage.getItem(`${STORAGE_PREFIX}${target}`) != null;
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
  const target = normalizePath(filePath);
  return syncStore.get(target) ?? localStorage.getItem(`${STORAGE_PREFIX}${target}`);
}

function setStoredFile(filePath, value) {
  const target = normalizePath(filePath);
  ensureParentDirs(target);
  if (isBinaryLike(value)) {
    const bytes = toUint8Array(value);
    syncStore.set(target, bytes);
    localStorage.removeItem(`${STORAGE_PREFIX}${target}`);
  } else {
    const text = typeof value === 'string' ? value : String(value);
    syncStore.set(target, text);
    localStorage.setItem(`${STORAGE_PREFIX}${target}`, text);
  }
}

function clearStoredFile(filePath) {
  const target = normalizePath(filePath);
  syncStore.delete(target);
  localStorage.removeItem(`${STORAGE_PREFIX}${target}`);
  revokeVaultObjectUrl(target);
}

function revokeVaultObjectUrl(filePath) {
  const target = normalizePath(filePath);
  const current = vaultObjectUrls.get(target);
  if (current) {
    URL.revokeObjectURL(current.url);
    vaultObjectUrls.delete(target);
  }
}

function getVaultAssetUrlSync(filePath) {
  const target = normalizePath(filePath);
  const cached = vaultObjectUrls.get(target);
  if (cached) return cached.url;
  const value = getStoredFile(target);
  if (value == null) return null;
  const blob = typeof value === 'string'
    ? new Blob([value], { type: mimeTypeForPath(target) })
    : new Blob([toUint8Array(value)], { type: mimeTypeForPath(target) });
  const url = URL.createObjectURL(blob);
  vaultObjectUrls.set(target, {
    url,
    size: blob.size,
    lastModified: 0,
  });
  return url;
}

function listStoredFiles() {
  const keys = new Set(syncStore.keys());
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(STORAGE_PREFIX)) keys.add(key.slice(STORAGE_PREFIX.length));
  }
  return [...keys].sort();
}

function resetVirtualFs() {
  syncStore.clear();
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
  }
  virtualDirs.clear();
  for (const dir of ['/', VIRTUAL_VAULT_ROOT, SANDBOX_VAULT_PATH, ...getVaultEntries().map((entry) => entry.path)]) {
    virtualDirs.add(dir);
  }
}

function getCurrentVault() {
  return currentVault ? { ...currentVault } : null;
}

function setCurrentVault(vault) {
  if (!vault) {
    currentVault = null;
    return;
  }
  currentVault = {
    ...currentVault,
    ...vault,
  };
  upsertVaultRecord({
    id: currentVault.id,
    path: currentVault.path,
    name: currentVault.name,
    ts: Date.now(),
    open: true,
  });
  virtualDirs.add(currentVault.path);
}

function isCurrentVaultPath(filePath) {
  const target = normalizePath(filePath);
  if (!currentVault?.path) return false;
  return target === currentVault.path || target.startsWith(`${currentVault.path}/`);
}

function getVaultRelativePath(filePath) {
  const target = normalizePath(filePath);
  if (!currentVault?.path) return null;
  if (target === currentVault.path) return '';
  if (!target.startsWith(`${currentVault.path}/`)) return null;
  return target.slice(currentVault.path.length + 1);
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
  const prefix = `${normalizePath(vaultPath)}/`;
  for (const dir of [...virtualDirs]) {
    if (dir === vaultPath || dir.startsWith(prefix)) virtualDirs.delete(dir);
  }
  for (const key of [...syncStore.keys()]) {
    if (key.startsWith(prefix)) syncStore.delete(key);
  }
}

async function ensureVaultPathExists(vaultPath, create) {
  const normalized = normalizePath(vaultPath);
  if (create) {
    virtualDirs.add(normalized);
    if (selectedDirectoryHandle && normalized === currentVault.path) {
      await mkdirRealVaultPath(normalized);
    }
    return true;
  }

  if (normalized === currentVault.path) return true;
  return virtualDirs.has(normalized) || hasStoredFile(normalized);
}

async function ensureVaultBootstrapFiles(vaultPath) {
  const obsidianDir = `${normalizePath(vaultPath)}/.obsidian`;
  virtualDirs.add(obsidianDir);
  if (!selectedDirectoryHandle || !isCurrentVaultPath(obsidianDir)) return;
  try {
    await mkdirRealVaultPath(obsidianDir);
  } catch (error) {
    console.error(error);
  }
}

async function readHandleValue(fileHandle, filePath, options) {
  const file = await fileHandle.getFile();
  const encoding = normalizeEncoding(options);
  if (encoding === 'utf8' || encoding === 'utf-8') return file.text();
  if (file.type.startsWith('text/') || isTextLikePath(filePath)) return file.text();
  return new Uint8Array(await file.arrayBuffer());
}

async function getDirectoryHandleForRelativePath(relativePath, options = {}) {
  if (!selectedDirectoryHandle) throw new Error('No selected directory handle');
  let handle = selectedDirectoryHandle;
  for (const part of splitRelativePath(relativePath)) {
    handle = await handle.getDirectoryHandle(part, { create: Boolean(options.create) });
  }
  return handle;
}

async function getFileHandleForRelativePath(relativePath, options = {}) {
  const parts = splitRelativePath(relativePath);
  const filename = parts.pop();
  if (!filename) throw new Error('Invalid file path');
  const parent = await getDirectoryHandleForRelativePath(parts.join('/'), { create: options.createParent });
  return parent.getFileHandle(filename, { create: Boolean(options.create) });
}

async function mirrorDirectoryHandle(handle, basePath, version) {
  if (version !== selectedDirectoryVersion) return;
  virtualDirs.add(basePath);
  for await (const [name, child] of handle.entries()) {
    const childPath = `${basePath}/${name}`;
    if (child.kind === 'directory') {
      await mirrorDirectoryHandle(child, childPath, version);
      continue;
    }
    syncStore.set(childPath, await readHandleValue(child, childPath));
  }
}

async function refreshSelectedVaultCache() {
  if (!selectedDirectoryHandle) return;
  selectedDirectoryVersion += 1;
  const version = selectedDirectoryVersion;
  clearVaultCache(currentVault.path);
  virtualDirs.add(currentVault.path);
  await mirrorDirectoryHandle(selectedDirectoryHandle, currentVault.path, version);
}

async function writeRealVaultFile(filePath, value) {
  const relativePath = getVaultRelativePath(filePath);
  if (relativePath == null || !selectedDirectoryHandle) return;
  const fileHandle = await getFileHandleForRelativePath(relativePath, { create: true, createParent: true });
  const writable = await fileHandle.createWritable();
  if (value instanceof Blob) await writable.write(value);
  else if (isBinaryLike(value)) await writable.write(toUint8Array(value));
  else await writable.write(typeof value === 'string' ? value : String(value));
  await writable.close();
  revokeVaultObjectUrl(filePath);
}

async function mkdirRealVaultPath(filePath) {
  const relativePath = getVaultRelativePath(filePath);
  if (relativePath == null || !selectedDirectoryHandle) return;
  await getDirectoryHandleForRelativePath(relativePath, { create: true });
}

async function unlinkRealVaultPath(filePath) {
  const relativePath = getVaultRelativePath(filePath);
  if (relativePath == null || !selectedDirectoryHandle) return;
  const parts = splitRelativePath(relativePath);
  const leaf = parts.pop();
  if (!leaf) return;
  try {
    const parent = await getDirectoryHandleForRelativePath(parts.join('/'));
    await parent.removeEntry(leaf, { recursive: true });
    revokeVaultObjectUrl(filePath);
  } catch (error) {
    if (error && error.name === 'NotFoundError') return;
    throw error;
  }
}

async function getVaultFile(filePath) {
  const relativePath = getVaultRelativePath(filePath);
  if (relativePath == null || !selectedDirectoryHandle) throw new Error('No selected vault file');
  const fileHandle = await getFileHandleForRelativePath(relativePath);
  return fileHandle.getFile();
}

async function getVaultAssetUrl(filePath) {
  const target = normalizePath(filePath);
  const file = await getVaultFile(target);
  const cached = vaultObjectUrls.get(target);
  if (cached && cached.size === file.size && cached.lastModified === file.lastModified) {
    return cached.url;
  }
  revokeVaultObjectUrl(target);
  const url = URL.createObjectURL(file);
  vaultObjectUrls.set(target, {
    url,
    size: file.size,
    lastModified: file.lastModified,
  });
  return url;
}

function extractVirtualVaultPath(value) {
  const text = String(value || '');
  if (!text || text.startsWith('blob:') || text.startsWith('data:')) return null;
  const candidates = [text];
  try {
    const first = new URL(text, window.location.href);
    candidates.push(first.pathname);
    const nested = decodeURIComponent(first.pathname).replace(/^\//, '');
    if (/^https?:/i.test(nested)) {
      const second = new URL(nested);
      candidates.push(second.pathname);
    }
  } catch {}

  for (const candidate of candidates) {
    const decoded = decodeURIComponent(candidate);
    const idx = decoded.indexOf('/obsidian-web/');
    if (idx === -1) continue;
    const sliced = decoded.slice(idx).split('?')[0].split('#')[0];
    return normalizePath(sliced);
  }

  return null;
}

function installVaultAssetUrlShims() {
  const sweepDocument = () => {
    for (const element of document.querySelectorAll('[src],[href],[poster]')) {
      for (const attribute of observedAttributes) {
        if (element.hasAttribute(attribute)) void rewriteElement(element, attribute);
      }
    }
  };

  const rewriteElement = async (element, attribute) => {
    const rawValue = element.getAttribute(attribute);
    const filePath = extractVirtualVaultPath(rawValue);
    if (!filePath || !isCurrentVaultPath(filePath) || !selectedDirectoryHandle) return;
    try {
      const blobUrl = await getVaultAssetUrl(filePath);
      if (element.getAttribute(attribute) !== blobUrl) {
        element.setAttribute(attribute, blobUrl);
      }
    } catch (error) {
      if (error && error.name === 'NotFoundError') return;
      console.error(error);
    }
  };

  const patchUrlProperty = (prototype, property) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    if (!descriptor?.set || !descriptor?.get) return;
    Object.defineProperty(prototype, property, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        const filePath = extractVirtualVaultPath(value);
        if (!filePath || !isCurrentVaultPath(filePath) || !selectedDirectoryHandle) {
          descriptor.set.call(this, value);
          return;
        }

        const syncUrl = getVaultAssetUrlSync(filePath);
        if (syncUrl) {
          descriptor.set.call(this, syncUrl);
          return;
        }
        void getVaultAssetUrl(filePath)
          .then((blobUrl) => {
            descriptor.set.call(this, blobUrl);
          })
          .catch((error) => {
            if (error && error.name === 'NotFoundError') return;
            console.error(error);
          });
      },
    });
  };

  const observedAttributes = ['src', 'href', 'poster'];
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof Element) {
        void rewriteElement(mutation.target, mutation.attributeName);
      }
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          for (const attribute of observedAttributes) {
            if (node.hasAttribute(attribute)) void rewriteElement(node, attribute);
          }
          for (const descendant of node.querySelectorAll('[src],[href],[poster]')) {
            for (const attribute of observedAttributes) {
              if (descendant.hasAttribute(attribute)) void rewriteElement(descendant, attribute);
            }
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: observedAttributes,
  });

  sweepDocument();
  window.setInterval(sweepDocument, 1000);

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    const filePath = extractVirtualVaultPath(url);
    if (filePath && isCurrentVaultPath(filePath) && selectedDirectoryHandle) {
      try {
        const file = await getVaultFile(filePath);
        return new Response(file.stream(), {
          status: 200,
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
        });
      } catch (error) {
        if (error && error.name === 'NotFoundError') return new Response(null, { status: 404 });
        throw error;
      }
    }
    return nativeFetch(input, init);
  };

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function patchedSetAttribute(name, value) {
    return originalSetAttribute.call(this, name, value);
  };

  patchUrlProperty(HTMLImageElement.prototype, 'src');
  patchUrlProperty(HTMLAudioElement.prototype, 'src');
  patchUrlProperty(HTMLVideoElement.prototype, 'src');
  patchUrlProperty(HTMLSourceElement.prototype, 'src');
  patchUrlProperty(HTMLAnchorElement.prototype, 'href');
  patchUrlProperty(HTMLLinkElement.prototype, 'href');
}

function createFsStub() {
  const fsStub = {
    constants: {
      R_OK: 4,
      W_OK: 2,
    },
    existsSync(filePath) {
      const target = normalizePath(filePath);
      return virtualDirs.has(target) || hasStoredFile(target);
    },
    readFileSync(filePath, options) {
      const value = getStoredFile(filePath);
      if (value != null) {
        const encoding = normalizeEncoding(options);
        if (typeof value === 'string') {
          if (encoding === 'utf8' || encoding === 'utf-8') return value;
          return Buffer.from(value, 'utf8');
        }
        const bytes = toUint8Array(value);
        if (encoding === 'utf8' || encoding === 'utf-8') return new TextDecoder().decode(bytes);
        return Buffer.from(bytes);
      }
      return missingFileFallback(filePath, options);
    },
    writeFileSync(filePath, value) {
      setStoredFile(filePath, value);
      if (isCurrentVaultPath(filePath) && selectedDirectoryHandle) {
        void writeRealVaultFile(filePath, value).catch((error) => console.error(error));
      }
    },
    unlinkSync(filePath) {
      clearStoredFile(filePath);
      if (isCurrentVaultPath(filePath) && selectedDirectoryHandle) {
        void unlinkRealVaultPath(filePath).catch((error) => console.error(error));
      }
    },
    readdirSync(filePath) {
      const target = normalizePath(filePath);
      const entries = new Set();

      for (const dir of virtualDirs) {
        if (dir !== target && path.dirname(dir) === target) entries.add(path.basename(dir));
      }

      for (const key of new Set([...syncStore.keys(), ...Object.keys(localStorage)])) {
        const normalized = String(key).startsWith(STORAGE_PREFIX) ? key.slice(STORAGE_PREFIX.length) : key;
        if (path.dirname(normalized) === target) entries.add(path.basename(normalized));
      }

      return [...entries];
    },
    lstatSync(filePath) {
      return fsStub.statSync(filePath);
    },
    realpathSync(filePath) {
      return normalizePath(filePath);
    },
    mkdirSync(filePath) {
      virtualDirs.add(normalizePath(filePath));
      if (isCurrentVaultPath(filePath) && selectedDirectoryHandle) {
        void mkdirRealVaultPath(filePath).catch((error) => console.error(error));
      }
    },
    rmSync() {},
    renameSync(fromPath, toPath) {
      const value = getStoredFile(fromPath);
      if (value != null) {
        setStoredFile(toPath, value);
        fsStub.unlinkSync(fromPath);
      }
    },
    copyFileSync(fromPath, toPath) {
      const value = getStoredFile(fromPath);
      if (value != null) setStoredFile(toPath, value);
    },
    statSync(filePath) {
      const target = normalizePath(filePath);
      if (virtualDirs.has(target)) {
        return {
          size: 0,
          birthtimeMs: Date.now(),
          mtimeMs: Date.now(),
          isDirectory: () => true,
          isFile: () => false,
        };
      }
      if (!hasStoredFile(target)) {
        const error = new Error(`ENOENT: no such file or directory, stat '${target}'`);
        error.code = 'ENOENT';
        throw error;
      }
      const value = getStoredFile(target) ?? '';
      return {
        size: typeof value === 'string' ? value.length : toUint8Array(value).byteLength,
        birthtimeMs: Date.now(),
        mtimeMs: Date.now(),
        isDirectory: () => false,
        isFile: () => true,
      };
    },
    accessSync() {},
    watch() {
      const handlers = new Map();
      const watcher = {
        on(event, callback) {
          const list = handlers.get(event) ?? [];
          list.push(callback);
          handlers.set(event, list);
          return watcher;
        },
        once(event, callback) {
          const wrapped = (...args) => {
            watcher.removeListener(event, wrapped);
            callback(...args);
          };
          return watcher.on(event, wrapped);
        },
        removeListener(event, callback) {
          const list = handlers.get(event) ?? [];
          handlers.set(
            event,
            list.filter((entry) => entry !== callback),
          );
          return watcher;
        },
        removeAllListeners(event) {
          if (typeof event === 'string') handlers.delete(event);
          else handlers.clear();
          return watcher;
        },
        emit(event, ...args) {
          const list = handlers.get(event) ?? [];
          for (const handler of list) handler(...args);
          return watcher;
        },
        close() {
          handlers.clear();
          return watcher;
        },
      };
      return watcher;
    },
    promises: {
      async readFile(filePath, options) {
        if (isCurrentVaultPath(filePath) && selectedDirectoryHandle) {
          const relativePath = getVaultRelativePath(filePath);
          try {
            const fileHandle = await getFileHandleForRelativePath(relativePath);
            const value = await readHandleValue(fileHandle, filePath, options);
            syncStore.set(normalizePath(filePath), value);
          } catch (error) {
            if (error && error.name === 'NotFoundError') return missingFileFallback(filePath, options);
            throw error;
          }
        }
        return fsStub.readFileSync(filePath, options);
      },
      async writeFile(filePath, value) {
        fsStub.writeFileSync(filePath, value);
        if (isCurrentVaultPath(filePath) && selectedDirectoryHandle) {
          await writeRealVaultFile(filePath, value);
        }
      },
      async readdir(filePath) {
        if (isCurrentVaultPath(filePath) && selectedDirectoryHandle) {
          const dirHandle = await getDirectoryHandleForRelativePath(getVaultRelativePath(filePath));
          const names = [];
          for await (const [name] of dirHandle.entries()) names.push(name);
          return names;
        }
        return fsStub.readdirSync(filePath);
      },
      async mkdir(filePath) {
        fsStub.mkdirSync(filePath);
        if (isCurrentVaultPath(filePath) && selectedDirectoryHandle) {
          await mkdirRealVaultPath(filePath);
        }
      },
      async access(filePath) {
        if (isCurrentVaultPath(filePath) && selectedDirectoryHandle) {
          const relativePath = getVaultRelativePath(filePath);
          if (relativePath === '') return;
          try {
            await getFileHandleForRelativePath(relativePath);
            return;
          } catch {}
          try {
            await getDirectoryHandleForRelativePath(relativePath);
            return;
          } catch {}
        }
        if (!fsStub.existsSync(filePath)) {
          const error = new Error(`ENOENT: no such file or directory, access '${filePath}'`);
          error.code = 'ENOENT';
          throw error;
        }
      },
      async stat(filePath) {
        if (isCurrentVaultPath(filePath) && selectedDirectoryHandle) {
          const relativePath = getVaultRelativePath(filePath);
          if (relativePath === '') return fsStub.statSync(filePath);
          try {
            const dirHandle = await getDirectoryHandleForRelativePath(relativePath);
            if (dirHandle) return fsStub.statSync(filePath);
          } catch {}
          try {
            const fileHandle = await getFileHandleForRelativePath(relativePath);
            const value = await readHandleValue(fileHandle, filePath);
            syncStore.set(normalizePath(filePath), value);
          } catch (error) {
            if (error && error.name === 'NotFoundError' && isObsidianConfigJson(filePath)) {
              syncStore.set(normalizePath(filePath), '{}');
              return fsStub.statSync(filePath);
            }
          }
        }
        return fsStub.statSync(filePath);
      },
      async lstat(filePath) {
        return fsStub.lstatSync(filePath);
      },
      async realpath(filePath) {
        return fsStub.realpathSync(filePath);
      },
      async utimes(filePath) {
        if (!fsStub.existsSync(filePath)) {
          const error = new Error(`ENOENT: no such file or directory, utime '${filePath}'`);
          error.code = 'ENOENT';
          throw error;
        }
      },
      async unlink(filePath) {
        fsStub.unlinkSync(filePath);
        if (isCurrentVaultPath(filePath) && selectedDirectoryHandle) {
          await unlinkRealVaultPath(filePath);
        }
      },
      async rename(fromPath, toPath) {
        fsStub.renameSync(fromPath, toPath);
        if (isCurrentVaultPath(fromPath) && isCurrentVaultPath(toPath) && selectedDirectoryHandle) {
          const value = getStoredFile(toPath);
          await writeRealVaultFile(toPath, value ?? '');
          await unlinkRealVaultPath(fromPath);
        }
      },
      async copyFile(fromPath, toPath) {
        fsStub.copyFileSync(fromPath, toPath);
        if (isCurrentVaultPath(toPath) && selectedDirectoryHandle) {
          await writeRealVaultFile(toPath, getStoredFile(toPath) ?? '');
        }
      },
    },
  };

  fsStub.realpathSync.native = fsStub.realpathSync;

  return fsStub;
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
    syncStore,
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

const browserVaultAdapter = {
  mode: 'browser',
  async init() {
    await restoreVaultHandles().catch((error) => console.error(error));
    if (currentVault?.id && vaultHandles.has(currentVault.id)) {
      selectedDirectoryHandle = vaultHandles.get(currentVault.id);
    }
  },
  getCurrentVault,
  listVaults: getVaultEntries,
  listVirtualFs: listStoredFiles,
  resetVirtualFs,
  getDefaultVaultPath() {
    return getCurrentVault()?.path || VIRTUAL_VAULT_ROOT;
  },
  getSandboxVaultPath() {
    return SANDBOX_VAULT_PATH;
  },
  getSelectedDirectoryHandle() {
    return selectedDirectoryHandle;
  },
  pickVaultDirectory,
  chooseCreateVaultParent,
  openDirectoryDialog,
  openDirectoryDialogSync,
  openFolderAsVault,
  createLocalVault,
  async openVault(vaultPath, create) {
    const normalized = normalizePath(vaultPath) || getCurrentVault()?.path;
    if (!normalized) return 'folder not found';
    const existing = getVaultRecordByPath(normalized);
    if (!existing && !create) {
      void openDirectoryDialog({ title: 'Select the vault folder to reopen' })
        .then(() => launchMainApp(getCurrentVault()?.path))
        .catch((error) => {
          if (error?.name !== 'AbortError') console.error(error);
        });
      return true;
    }
    if (existing && !vaultHandles.has(existing.id) && !create) {
      void openDirectoryDialog({
        title: `Locate vault: ${existing.name || path.basename(existing.path)}`,
        vaultId: existing.id,
      })
        .then(() => launchMainApp(getCurrentVault()?.path))
        .catch((error) => {
          if (error?.name !== 'AbortError') console.error(error);
        });
      return true;
    }
    const nextVault = existing || upsertVaultRecord({
      id: createVaultId(),
      name: path.basename(normalized),
      path: normalized,
      ts: Date.now(),
      open: true,
    });
    if (create) virtualDirs.add(normalized);
    selectedDirectoryHandle = vaultHandles.get(nextVault.id) ?? null;
    setCurrentVault(nextVault);
    void ensureVaultPathExists(normalized, create).catch((error) => console.error(error));
    if (selectedDirectoryHandle) {
      void refreshSelectedVaultCache().catch((error) => console.error(error));
    }
    if (document.body.classList.contains('starter')) {
      void launchMainApp(normalized).catch((error) => console.error(error));
    }
    return true;
  },
  removeVault(vaultPath) {
    const existing = getVaultRecordByPath(vaultPath);
    if (!existing) return false;
    if (currentVault?.id === existing.id) setCurrentVault(null);
    void deleteVaultHandle(existing.id).catch((error) => console.error(error));
    removeVaultRecord(existing.id);
    clearVaultCache(existing.path);
    return true;
  },
  moveVault(fromPath, toPath) {
    const existing = getVaultRecordByPath(fromPath);
    if (!existing) return 'folder not found';
    const updated = upsertVaultRecord({
      ...existing,
      path: normalizePath(toPath),
      ts: Date.now(),
    });
    if (currentVault?.id === existing.id) setCurrentVault(updated);
    return '';
  },
  async prepareForLaunch() {
    if (selectedDirectoryHandle) {
      await refreshSelectedVaultCache();
    }
    await ensureVaultBootstrapFiles(currentVault.path);
  },
};

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
