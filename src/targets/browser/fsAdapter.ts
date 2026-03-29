import { Buffer } from 'buffer';
import path from 'path-browserify';

type BrowserFsAdapterOptions = {
  storagePrefix: string;
  virtualVaultRoot: string;
  sandboxVaultPath: string;
  normalizePath: (value: unknown) => string;
  ensureParentDirs: (filePath: string) => void;
  normalizeEncoding: (value: unknown) => string | null;
  isBinaryLike: (value: unknown) => boolean;
  toUint8Array: (value: unknown) => Uint8Array;
  isTextLikePath: (filePath: string) => boolean;
  missingFileFallback: (filePath: string, options?: unknown) => unknown;
  splitRelativePath: (relativePath: string) => string[];
  getCurrentVault: () => { path?: string } | null;
  getVaultEntries: () => Array<{ id: string; path: string }>;
  getSelectedDirectoryHandle: () => FileSystemDirectoryHandle | null;
  mimeTypeForPath: (filePath: string) => string;
};

export function createBrowserFsAdapter(options: BrowserFsAdapterOptions) {
  const {
    storagePrefix,
    virtualVaultRoot,
    sandboxVaultPath,
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
    getSelectedDirectoryHandle,
    mimeTypeForPath,
  } = options;

  const syncStore = new Map<string, string | Uint8Array>();
  const virtualDirs = new Set<string>(['/', virtualVaultRoot, sandboxVaultPath]);
  const vaultObjectUrls = new Map<string, { url: string; size: number; lastModified: number }>();
  let selectedDirectoryVersion = 0;

  function asArrayBufferView(value: unknown): Uint8Array {
    return Uint8Array.from(toUint8Array(value));
  }

  function hasStoredFile(filePath: string): boolean {
    const target = normalizePath(filePath);
    return syncStore.has(target) || localStorage.getItem(`${storagePrefix}${target}`) != null;
  }

  function getStoredFile(filePath: string): string | Uint8Array | null {
    const target = normalizePath(filePath);
    return syncStore.get(target) ?? localStorage.getItem(`${storagePrefix}${target}`);
  }

  function revokeVaultObjectUrl(filePath: string): void {
    const target = normalizePath(filePath);
    const current = vaultObjectUrls.get(target);
    if (current) {
      URL.revokeObjectURL(current.url);
      vaultObjectUrls.delete(target);
    }
  }

  function setStoredFile(filePath: string, value: unknown): void {
    const target = normalizePath(filePath);
    ensureParentDirs(target);
    if (isBinaryLike(value)) {
      const bytes = toUint8Array(value);
      syncStore.set(target, bytes);
      localStorage.removeItem(`${storagePrefix}${target}`);
    } else {
      const text = typeof value === 'string' ? value : String(value);
      syncStore.set(target, text);
      localStorage.setItem(`${storagePrefix}${target}`, text);
    }
  }

  function clearStoredFile(filePath: string): void {
    const target = normalizePath(filePath);
    syncStore.delete(target);
    localStorage.removeItem(`${storagePrefix}${target}`);
    revokeVaultObjectUrl(target);
  }

  function listStoredFiles(): string[] {
    const keys = new Set(syncStore.keys());
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(storagePrefix)) keys.add(key.slice(storagePrefix.length));
    }
    return [...keys].sort();
  }

  function resetVirtualFs(): void {
    syncStore.clear();
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(storagePrefix)) localStorage.removeItem(key);
    }
    virtualDirs.clear();
    for (const dir of ['/', virtualVaultRoot, sandboxVaultPath, ...getVaultEntries().map((entry) => entry.path)]) {
      virtualDirs.add(dir);
    }
  }

  function isVaultPath(filePath: string): boolean {
    const target = normalizePath(filePath);
    return getVaultEntries().some((entry) => target === entry.path || target.startsWith(`${entry.path}/`));
  }

  function isCurrentVaultPath(filePath: string): boolean {
    const target = normalizePath(filePath);
    const currentVault = getCurrentVault();
    if (!currentVault?.path) return false;
    return target === currentVault.path || target.startsWith(`${currentVault.path}/`);
  }

  function getVaultRelativePath(filePath: string): string | null {
    const target = normalizePath(filePath);
    const currentVault = getCurrentVault();
    if (!currentVault?.path) return null;
    if (target === currentVault.path) return '';
    if (!target.startsWith(`${currentVault.path}/`)) return null;
    return target.slice(currentVault.path.length + 1);
  }

  function isObsidianConfigJson(filePath: string): boolean {
    const target = normalizePath(filePath);
    return target.includes('/.obsidian/') && target.endsWith('.json');
  }

  function clearVaultCache(vaultPath: string): void {
    const prefix = `${normalizePath(vaultPath)}/`;
    for (const dir of [...virtualDirs]) {
      if (dir === vaultPath || dir.startsWith(prefix)) virtualDirs.delete(dir);
    }
    for (const key of [...syncStore.keys()]) {
      if (key.startsWith(prefix)) syncStore.delete(key);
    }
  }

  async function readHandleValue(fileHandle: FileSystemFileHandle, filePath: string, options?: unknown) {
    const file = await fileHandle.getFile();
    const encoding = normalizeEncoding(options);
    if (encoding === 'utf8' || encoding === 'utf-8') return file.text();
    if (file.type.startsWith('text/') || isTextLikePath(filePath)) return file.text();
    return new Uint8Array(await file.arrayBuffer());
  }

  async function getDirectoryHandleForRelativePath(relativePath: string, opts: { create?: boolean } = {}) {
    const selectedDirectoryHandle = getSelectedDirectoryHandle();
    if (!selectedDirectoryHandle) throw new Error('No selected directory handle');
    let handle = selectedDirectoryHandle;
    for (const part of splitRelativePath(relativePath)) {
      handle = await handle.getDirectoryHandle(part, { create: Boolean(opts.create) });
    }
    return handle;
  }

  async function getFileHandleForRelativePath(relativePath: string, opts: { create?: boolean; createParent?: boolean } = {}) {
    const parts = splitRelativePath(relativePath);
    const filename = parts.pop();
    if (!filename) throw new Error('Invalid file path');
    const parent = await getDirectoryHandleForRelativePath(parts.join('/'), { create: opts.createParent });
    return parent.getFileHandle(filename, { create: Boolean(opts.create) });
  }

  async function mirrorDirectoryHandle(handle: FileSystemDirectoryHandle, basePath: string, version: number) {
    if (version !== selectedDirectoryVersion) return;
    virtualDirs.add(basePath);
    for await (const [name, child] of (handle as any).entries()) {
      const childPath = `${basePath}/${name}`;
      if (child.kind === 'directory') {
        await mirrorDirectoryHandle(child, childPath, version);
        continue;
      }
      syncStore.set(childPath, await readHandleValue(child, childPath));
    }
  }

  async function refreshSelectedVaultCache() {
    const selectedDirectoryHandle = getSelectedDirectoryHandle();
    const currentVault = getCurrentVault();
    if (!selectedDirectoryHandle || !currentVault?.path) return;
    selectedDirectoryVersion += 1;
    const version = selectedDirectoryVersion;
    clearVaultCache(currentVault.path);
    virtualDirs.add(currentVault.path);
    await mirrorDirectoryHandle(selectedDirectoryHandle, currentVault.path, version);
  }

  async function getVaultFile(filePath: string) {
    const relativePath = getVaultRelativePath(filePath);
    if (relativePath == null || !getSelectedDirectoryHandle()) throw new Error('No selected vault file');
    const fileHandle = await getFileHandleForRelativePath(relativePath);
    return fileHandle.getFile();
  }

  async function writeRealVaultFile(filePath: string, value: unknown) {
    const relativePath = getVaultRelativePath(filePath);
    if (relativePath == null || !getSelectedDirectoryHandle()) return;
    const fileHandle = await getFileHandleForRelativePath(relativePath, { create: true, createParent: true });
    const writable = await fileHandle.createWritable();
    if (value instanceof Blob) await writable.write(value);
    else if (isBinaryLike(value)) await writable.write(asArrayBufferView(value) as unknown as ArrayBufferView<ArrayBuffer>);
    else await writable.write(typeof value === 'string' ? value : String(value));
    await writable.close();
    revokeVaultObjectUrl(filePath);
  }

  async function mkdirRealVaultPath(filePath: string) {
    const relativePath = getVaultRelativePath(filePath);
    if (relativePath == null || !getSelectedDirectoryHandle()) return;
    await getDirectoryHandleForRelativePath(relativePath, { create: true });
  }

  async function unlinkRealVaultPath(filePath: string) {
    const relativePath = getVaultRelativePath(filePath);
    if (relativePath == null || !getSelectedDirectoryHandle()) return;
    const parts = splitRelativePath(relativePath);
    const leaf = parts.pop();
    if (!leaf) return;
    try {
      const parent = await getDirectoryHandleForRelativePath(parts.join('/'));
      await parent.removeEntry(leaf, { recursive: true });
      revokeVaultObjectUrl(filePath);
    } catch (error: any) {
      if (error && error.name === 'NotFoundError') return;
      throw error;
    }
  }

  async function ensureVaultPathExists(vaultPath: string, create: boolean) {
    const normalized = normalizePath(vaultPath);
    const currentVault = getCurrentVault();
    if (create) {
      virtualDirs.add(normalized);
      if (getSelectedDirectoryHandle() && normalized === currentVault?.path) {
        await mkdirRealVaultPath(normalized);
      }
      return true;
    }
    if (normalized === currentVault?.path) return true;
    return virtualDirs.has(normalized) || hasStoredFile(normalized);
  }

  async function ensureVaultBootstrapFiles(vaultPath: string) {
    const obsidianDir = `${normalizePath(vaultPath)}/.obsidian`;
    virtualDirs.add(obsidianDir);
    if (!getSelectedDirectoryHandle() || !isCurrentVaultPath(obsidianDir)) return;
    try {
      await mkdirRealVaultPath(obsidianDir);
    } catch (error) {
      console.error(error);
    }
  }

  function getVaultAssetUrlSync(filePath: string): string | null {
    const target = normalizePath(filePath);
    const cached = vaultObjectUrls.get(target);
    if (cached) return cached.url;
    const value = getStoredFile(target);
    if (value == null) return null;
    const blob = typeof value === 'string'
      ? new Blob([value], { type: mimeTypeForPath(target) })
      : new Blob([asArrayBufferView(value) as unknown as BlobPart], { type: mimeTypeForPath(target) });
    const url = URL.createObjectURL(blob);
    vaultObjectUrls.set(target, { url, size: blob.size, lastModified: 0 });
    return url;
  }

  async function getVaultAssetUrl(filePath: string) {
    const target = normalizePath(filePath);
    const file = await getVaultFile(target);
    const cached = vaultObjectUrls.get(target);
    if (cached && cached.size === file.size && cached.lastModified === file.lastModified) {
      return cached.url;
    }
    revokeVaultObjectUrl(target);
    const url = URL.createObjectURL(file);
    vaultObjectUrls.set(target, { url, size: file.size, lastModified: file.lastModified });
    return url;
  }

  function extractVirtualVaultPath(value: unknown): string | null {
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
    const observedAttributes = ['src', 'href', 'poster'];
    const sweepDocument = () => {
      for (const element of document.querySelectorAll('[src],[href],[poster]')) {
        for (const attribute of observedAttributes) {
          if (element.hasAttribute(attribute)) void rewriteElement(element, attribute);
        }
      }
    };

    const rewriteElement = async (element: Element, attribute: string) => {
      const rawValue = element.getAttribute(attribute);
      const filePath = extractVirtualVaultPath(rawValue);
      if (!filePath || !isCurrentVaultPath(filePath) || !getSelectedDirectoryHandle()) return;
      try {
        const blobUrl = await getVaultAssetUrl(filePath);
        if (element.getAttribute(attribute) !== blobUrl) {
          element.setAttribute(attribute, blobUrl);
        }
      } catch (error: any) {
        if (error && error.name === 'NotFoundError') return;
        console.error(error);
      }
    };

    const patchUrlProperty = (prototype: any, property: string) => {
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
          if (!filePath || !isCurrentVaultPath(filePath) || !getSelectedDirectoryHandle()) {
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
            .catch((error: any) => {
              if (error && error.name === 'NotFoundError') return;
              console.error(error);
            });
        },
      });
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.target instanceof Element) {
          void rewriteElement(mutation.target, mutation.attributeName || 'src');
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
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as any)?.url;
      const filePath = extractVirtualVaultPath(url);
      if (filePath && isCurrentVaultPath(filePath) && getSelectedDirectoryHandle()) {
        try {
          const file = await getVaultFile(filePath);
          return new Response(file.stream(), {
            status: 200,
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
          });
        } catch (error: any) {
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
    const fsStub: any = {
      constants: { R_OK: 4, W_OK: 2 },
      existsSync(filePath: string) {
        const target = normalizePath(filePath);
        return virtualDirs.has(target) || hasStoredFile(target);
      },
      readFileSync(filePath: string, options?: unknown) {
        const value = getStoredFile(filePath);
        if (value != null) {
          const encoding = normalizeEncoding(options);
          if (typeof value === 'string') {
            if (encoding === 'utf8' || encoding === 'utf-8') return value;
            return Buffer.from(value, 'utf8');
          }
          const bytes = asArrayBufferView(value);
          if (encoding === 'utf8' || encoding === 'utf-8') return new TextDecoder().decode(bytes);
          return Buffer.from(bytes);
        }
        return missingFileFallback(filePath, options);
      },
      writeFileSync(filePath: string, value: unknown) {
        setStoredFile(filePath, value);
        if (isCurrentVaultPath(filePath) && getSelectedDirectoryHandle()) {
          void writeRealVaultFile(filePath, value).catch((error) => console.error(error));
        }
      },
      unlinkSync(filePath: string) {
        clearStoredFile(filePath);
        if (isCurrentVaultPath(filePath) && getSelectedDirectoryHandle()) {
          void unlinkRealVaultPath(filePath).catch((error) => console.error(error));
        }
      },
      readdirSync(filePath: string) {
        const target = normalizePath(filePath);
        const entries = new Set<string>();
        for (const dir of virtualDirs) {
          if (dir !== target && path.dirname(dir) === target) entries.add(path.basename(dir));
        }
        for (const key of new Set([...syncStore.keys(), ...Object.keys(localStorage)])) {
          const normalized = String(key).startsWith(storagePrefix) ? key.slice(storagePrefix.length) : key;
          if (path.dirname(normalized) === target) entries.add(path.basename(normalized));
        }
        return [...entries];
      },
      lstatSync(filePath: string) {
        return fsStub.statSync(filePath);
      },
      realpathSync(filePath: string) {
        return normalizePath(filePath);
      },
      mkdirSync(filePath: string) {
        virtualDirs.add(normalizePath(filePath));
        if (isCurrentVaultPath(filePath) && getSelectedDirectoryHandle()) {
          void mkdirRealVaultPath(filePath).catch((error) => console.error(error));
        }
      },
      rmSync() {},
      renameSync(fromPath: string, toPath: string) {
        const value = getStoredFile(fromPath);
        if (value != null) {
          setStoredFile(toPath, value);
          fsStub.unlinkSync(fromPath);
        }
      },
      copyFileSync(fromPath: string, toPath: string) {
        const value = getStoredFile(fromPath);
        if (value != null) setStoredFile(toPath, value);
      },
      statSync(filePath: string) {
        const target = normalizePath(filePath);
        if (virtualDirs.has(target)) {
          return { size: 0, birthtimeMs: Date.now(), mtimeMs: Date.now(), isDirectory: () => true, isFile: () => false };
        }
        if (!hasStoredFile(target)) {
          const error: any = new Error(`ENOENT: no such file or directory, stat '${target}'`);
          error.code = 'ENOENT';
          throw error;
        }
        const value = getStoredFile(target) ?? '';
        return {
          size: typeof value === 'string' ? value.length : asArrayBufferView(value).byteLength,
          birthtimeMs: Date.now(),
          mtimeMs: Date.now(),
          isDirectory: () => false,
          isFile: () => true,
        };
      },
      accessSync() {},
      watch() {
        const handlers = new Map<string, Function[]>();
        const watcher = {
          on(event: string, callback: Function) {
            const list = handlers.get(event) ?? [];
            list.push(callback);
            handlers.set(event, list);
            return watcher;
          },
          once(event: string, callback: Function) {
            const wrapped = (...args: unknown[]) => {
              watcher.removeListener(event, wrapped);
              callback(...args);
            };
            return watcher.on(event, wrapped);
          },
          removeListener(event: string, callback: Function) {
            const list = handlers.get(event) ?? [];
            handlers.set(event, list.filter((entry) => entry !== callback));
            return watcher;
          },
          removeAllListeners(event?: string) {
            if (typeof event === 'string') handlers.delete(event);
            else handlers.clear();
            return watcher;
          },
          emit(event: string, ...args: unknown[]) {
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
        async readFile(filePath: string, options?: unknown) {
          if (isCurrentVaultPath(filePath) && getSelectedDirectoryHandle()) {
            const relativePath = getVaultRelativePath(filePath);
            try {
              const fileHandle = await getFileHandleForRelativePath(relativePath || '');
              const value = await readHandleValue(fileHandle, filePath, options);
              syncStore.set(normalizePath(filePath), value as any);
            } catch (error: any) {
              if (error && error.name === 'NotFoundError') return missingFileFallback(filePath, options);
              throw error;
            }
          }
          return fsStub.readFileSync(filePath, options);
        },
        async writeFile(filePath: string, value: unknown) {
          fsStub.writeFileSync(filePath, value);
          if (isCurrentVaultPath(filePath) && getSelectedDirectoryHandle()) {
            await writeRealVaultFile(filePath, value);
          }
        },
        async readdir(filePath: string) {
          if (isCurrentVaultPath(filePath) && getSelectedDirectoryHandle()) {
            const dirHandle = await getDirectoryHandleForRelativePath(getVaultRelativePath(filePath) || '');
            const names: string[] = [];
            for await (const [name] of (dirHandle as any).entries()) names.push(name);
            return names;
          }
          return fsStub.readdirSync(filePath);
        },
        async mkdir(filePath: string) {
          fsStub.mkdirSync(filePath);
          if (isCurrentVaultPath(filePath) && getSelectedDirectoryHandle()) {
            await mkdirRealVaultPath(filePath);
          }
        },
        async access(filePath: string) {
          if (isCurrentVaultPath(filePath) && getSelectedDirectoryHandle()) {
            const relativePath = getVaultRelativePath(filePath);
            if (relativePath === '') return;
            try { await getFileHandleForRelativePath(relativePath || ''); return; } catch {}
            try { await getDirectoryHandleForRelativePath(relativePath || ''); return; } catch {}
          }
          if (!fsStub.existsSync(filePath)) {
            const error: any = new Error(`ENOENT: no such file or directory, access '${filePath}'`);
            error.code = 'ENOENT';
            throw error;
          }
        },
        async stat(filePath: string) {
          if (isCurrentVaultPath(filePath) && getSelectedDirectoryHandle()) {
            const relativePath = getVaultRelativePath(filePath);
            if (relativePath === '') return fsStub.statSync(filePath);
            try {
              const dirHandle = await getDirectoryHandleForRelativePath(relativePath || '');
              if (dirHandle) return fsStub.statSync(filePath);
            } catch {}
            try {
              const fileHandle = await getFileHandleForRelativePath(relativePath || '');
              const value = await readHandleValue(fileHandle, filePath);
              syncStore.set(normalizePath(filePath), value as any);
            } catch (error: any) {
              if (error && error.name === 'NotFoundError' && isObsidianConfigJson(filePath)) {
                syncStore.set(normalizePath(filePath), '{}');
                return fsStub.statSync(filePath);
              }
            }
          }
          return fsStub.statSync(filePath);
        },
        async lstat(filePath: string) { return fsStub.lstatSync(filePath); },
        async realpath(filePath: string) { return fsStub.realpathSync(filePath); },
        async utimes(filePath: string) {
          if (!fsStub.existsSync(filePath)) {
            const error: any = new Error(`ENOENT: no such file or directory, utime '${filePath}'`);
            error.code = 'ENOENT';
            throw error;
          }
        },
        async unlink(filePath: string) {
          fsStub.unlinkSync(filePath);
          if (isCurrentVaultPath(filePath) && getSelectedDirectoryHandle()) {
            await unlinkRealVaultPath(filePath);
          }
        },
        async rename(fromPath: string, toPath: string) {
          fsStub.renameSync(fromPath, toPath);
          if (isCurrentVaultPath(fromPath) && isCurrentVaultPath(toPath) && getSelectedDirectoryHandle()) {
            const value = getStoredFile(toPath);
            await writeRealVaultFile(toPath, value ?? '');
            await unlinkRealVaultPath(fromPath);
          }
        },
        async copyFile(fromPath: string, toPath: string) {
          fsStub.copyFileSync(fromPath, toPath);
          if (isCurrentVaultPath(toPath) && getSelectedDirectoryHandle()) {
            await writeRealVaultFile(toPath, getStoredFile(toPath) ?? '');
          }
        },
      },
    };

    fsStub.realpathSync.native = fsStub.realpathSync;
    return fsStub;
  }

  return {
    clearStoredFile,
    clearVaultCache,
    createFsStub,
    ensureVaultBootstrapFiles,
    ensureVaultPathExists,
    getStoredFile,
    getVaultFile,
    installVaultAssetUrlShims,
    isVaultPath,
    listStoredFiles,
    refreshSelectedVaultCache,
    resetVirtualFs,
    setStoredFile,
    syncStore,
    virtualDirs,
  };
}
