import { Buffer } from 'buffer';

type SelfhostedFsAdapterOptions = {
  apiClient: ReturnType<typeof import('./apiClient').createSelfhostedApiClient>;
};

export function createSelfhostedFsAdapter(options: SelfhostedFsAdapterOptions) {
  const { apiClient } = options;
  const syncStore = new Map<string, string | Uint8Array>();
  const directoryEntries = new Map<string, string[]>();
  const statStore = new Map<string, { size: number; birthtimeMs: number; mtimeMs: number; isDirectory: boolean; isFile: boolean }>();

  function extractVaultPath(value: unknown) {
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
      const idx = decoded.indexOf('/vaults/');
      if (idx === -1) continue;
      return decoded.slice(idx).split('?')[0].split('#')[0];
    }
    return null;
  }

  function toAssetUrl(filePath: string) {
    return apiClient.getAssetUrl(filePath);
  }

  function createEnoentError(method: string, filePath: string) {
    const error: any = new Error(`ENOENT: no such file or directory, ${method} '${filePath}'`);
    error.code = 'ENOENT';
    return error;
  }

  function normalizeEncoding(value: any) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.encoding === 'string') return value.encoding;
    return null;
  }

  function toStoredValue(value: BodyInit) {
    if (typeof value === 'string') return value;
    if (value instanceof Blob) return value.arrayBuffer().then((buffer) => new Uint8Array(buffer));
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return String(value);
  }

  function cacheStat(filePath: string, stat: { size: number; birthtimeMs: number; mtimeMs: number; isDirectory: boolean; isFile: boolean }) {
    statStore.set(filePath, stat);
  }

  function deleteCachedPath(filePath: string) {
    syncStore.delete(filePath);
    statStore.delete(filePath);
    directoryEntries.delete(filePath);
  }

  function moveCachedPath(fromPath: string, toPath: string) {
    const directFile = syncStore.get(fromPath);
    if (directFile !== undefined) {
      syncStore.set(toPath, directFile);
      syncStore.delete(fromPath);
    }

    const directStat = statStore.get(fromPath);
    if (directStat) {
      statStore.set(toPath, directStat);
      statStore.delete(fromPath);
    }

    const directDirEntries = directoryEntries.get(fromPath);
    if (directDirEntries) {
      directoryEntries.set(toPath, directDirEntries);
      directoryEntries.delete(fromPath);
    }

    const childPrefix = `${fromPath}/`;
    for (const [key, value] of [...syncStore.entries()]) {
      if (key.startsWith(childPrefix)) {
        syncStore.set(`${toPath}${key.slice(fromPath.length)}`, value);
        syncStore.delete(key);
      }
    }
    for (const [key, value] of [...statStore.entries()]) {
      if (key.startsWith(childPrefix)) {
        statStore.set(`${toPath}${key.slice(fromPath.length)}`, value);
        statStore.delete(key);
      }
    }
    for (const [key, value] of [...directoryEntries.entries()]) {
      if (key.startsWith(childPrefix)) {
        directoryEntries.set(`${toPath}${key.slice(fromPath.length)}`, value);
        directoryEntries.delete(key);
      }
    }
  }

  function ensureParentDirectoryEntry(filePath: string) {
    const parent = filePath.split('/').slice(0, -1).join('/') || '/vaults';
    const base = filePath.split('/').pop();
    if (!base) return;
    const siblings = new Set(directoryEntries.get(parent) ?? []);
    siblings.add(base);
    directoryEntries.set(parent, [...siblings].sort());
  }

  function removeFromParentDirectoryEntry(filePath: string) {
    const parent = filePath.split('/').slice(0, -1).join('/') || '/vaults';
    const base = filePath.split('/').pop();
    if (!base) return;
    const siblings = new Set(directoryEntries.get(parent) ?? []);
    siblings.delete(base);
    directoryEntries.set(parent, [...siblings].sort());
  }

  function toNodeStyleStat(stat: { size: number; birthtimeMs: number; mtimeMs: number; isDirectory: boolean; isFile: boolean }) {
    return {
      size: stat.size,
      birthtimeMs: stat.birthtimeMs,
      mtimeMs: stat.mtimeMs,
      isDirectory: () => stat.isDirectory,
      isFile: () => stat.isFile,
    };
  }

  async function refreshSnapshot(rootPath: string) {
    const snapshot = await apiClient.snapshot(rootPath);
    directoryEntries.clear();
    statStore.clear();
    syncStore.clear();

    for (const directory of snapshot.directories) {
      directoryEntries.set(directory.path, directory.entries);
      cacheStat(directory.path, directory.stat);
    }

    for (const file of snapshot.files) {
      cacheStat(file.path, file.stat);
      if (file.encoding === 'utf8' && typeof file.content === 'string') {
        syncStore.set(file.path, file.content);
      }
    }
  }

  function notReadyError(method: string) {
    const error: any = new Error(`Selfhosted fs adapter method not implemented yet: ${method}`);
    error.code = 'ENOSYS';
    return error;
  }

  function isEnoent(error: any) {
    return error?.code === 'ENOENT' || error?.status === 404;
  }

  function createFsStub() {
    const fsStub: any = {
      constants: { R_OK: 4, W_OK: 2, COPYFILE_EXCL: 1 },
      existsSync(filePath: string) {
        return statStore.has(filePath) || syncStore.has(filePath);
      },
      readFileSync(filePath: string, options?: any) {
        const value = syncStore.get(filePath);
        if (value == null) throw createEnoentError('open', filePath);
        const encoding = normalizeEncoding(options);
        if (typeof value === 'string') return encoding === 'utf8' || encoding === 'utf-8' || encoding == null ? value : Buffer.from(value, 'utf8');
        return Buffer.from(value);
      },
      writeFileSync() {
        throw notReadyError('writeFileSync');
      },
      unlinkSync() {
        throw notReadyError('unlinkSync');
      },
      readdirSync(filePath: string) {
        if (!directoryEntries.has(filePath)) throw createEnoentError('scandir', filePath);
        return directoryEntries.get(filePath) ?? [];
      },
      lstatSync(filePath: string) {
        return fsStub.statSync(filePath);
      },
      realpathSync(filePath: string) {
        return filePath;
      },
      mkdirSync(filePath: string, _options?: any) {
        cacheStat(filePath, { size: 0, birthtimeMs: Date.now(), mtimeMs: Date.now(), isDirectory: true, isFile: false });
        if (!directoryEntries.has(filePath)) directoryEntries.set(filePath, []);
        ensureParentDirectoryEntry(filePath);
        void apiClient.mkdir(filePath).catch((error) => console.error(error));
      },
      rmdirSync(filePath: string) {
        fsStub.rmSync(filePath);
      },
      rmSync(filePath: string, _options?: any) {
        deleteCachedPath(filePath);
        removeFromParentDirectoryEntry(filePath);
        void apiClient.unlink(filePath).catch((error) => {
          if (!isEnoent(error)) console.error(error);
        });
      },
      renameSync(fromPath: string, toPath: string) {
        moveCachedPath(fromPath, toPath);
        removeFromParentDirectoryEntry(fromPath);
        ensureParentDirectoryEntry(toPath);
        void apiClient.rename(fromPath, toPath).catch((error) => console.error(error));
      },
      copyFileSync(fromPath: string, toPath: string, mode?: number) {
        if ((mode & fsStub.constants.COPYFILE_EXCL) && (syncStore.has(toPath) || statStore.has(toPath))) {
          const error: any = new Error(`EEXIST: file already exists, copyfile '${fromPath}' -> '${toPath}'`);
          error.code = 'EEXIST';
          throw error;
        }
        if (syncStore.has(fromPath)) syncStore.set(toPath, syncStore.get(fromPath) as any);
        if (statStore.has(fromPath)) statStore.set(toPath, { ...(statStore.get(fromPath) as any), mtimeMs: Date.now() });
        ensureParentDirectoryEntry(toPath);
        void apiClient.copyFile(fromPath, toPath).catch((error) => console.error(error));
      },
      statSync(filePath: string) {
        const stat = statStore.get(filePath);
        if (!stat) throw createEnoentError('stat', filePath);
        return toNodeStyleStat(stat);
      },
      accessSync(filePath: string) {
        if (!statStore.has(filePath) && !syncStore.has(filePath)) throw createEnoentError('access', filePath);
      },
      watch() {
        const watcher = {
          on() { return watcher; },
          once() { return watcher; },
          removeListener() { return watcher; },
          removeAllListeners() { return watcher; },
          close() { return watcher; },
        };
        return watcher;
      },
      promises: {
        async readFile(filePath: string, options?: any) {
          const encoding = normalizeEncoding(options);
          const data = await apiClient.readFile(filePath, { encoding });
          const stored = typeof data === 'string' ? data : new Uint8Array(data);
          syncStore.set(filePath, stored);
          return fsStub.readFileSync(filePath, options);
        },
        async writeFile(filePath: string, value: BodyInit) {
          await apiClient.writeFile(filePath, value);
          const stored = await toStoredValue(value);
          syncStore.set(filePath, stored as any);
          ensureParentDirectoryEntry(filePath);
        },
        async readdir(filePath: string) {
          const entries = await apiClient.readdir(filePath);
          directoryEntries.set(filePath, entries);
          return entries;
        },
        async mkdir(filePath: string, _options?: any) {
          await apiClient.mkdir(filePath);
          cacheStat(filePath, { size: 0, birthtimeMs: Date.now(), mtimeMs: Date.now(), isDirectory: true, isFile: false });
          if (!directoryEntries.has(filePath)) directoryEntries.set(filePath, []);
          ensureParentDirectoryEntry(filePath);
        },
        async access(filePath: string) {
          if (statStore.has(filePath) || syncStore.has(filePath)) return undefined;
          try {
            await apiClient.stat(filePath);
            return undefined;
          } catch (error) {
            if (isEnoent(error)) throw createEnoentError('access', filePath);
            throw error;
          }
        },
        async stat(filePath: string) {
          const stat = await apiClient.stat(filePath);
          cacheStat(filePath, stat);
          return toNodeStyleStat(stat);
        },
        async lstat(filePath: string) {
          return this.stat(filePath);
        },
        async realpath(filePath: string) {
          return filePath;
        },
        async utimes() {},
        async unlink(filePath: string) {
          try {
            await apiClient.unlink(filePath);
          } catch (error) {
            if (!isEnoent(error)) throw error;
          }
          deleteCachedPath(filePath);
          removeFromParentDirectoryEntry(filePath);
        },
        async rename(fromPath: string, toPath: string) {
          await apiClient.rename(fromPath, toPath);
          moveCachedPath(fromPath, toPath);
          removeFromParentDirectoryEntry(fromPath);
          ensureParentDirectoryEntry(toPath);
        },
        async copyFile(fromPath: string, toPath: string, mode?: number) {
          if ((mode & fsStub.constants.COPYFILE_EXCL) && (syncStore.has(toPath) || statStore.has(toPath))) {
            const error: any = new Error(`EEXIST: file already exists, copyfile '${fromPath}' -> '${toPath}'`);
            error.code = 'EEXIST';
            throw error;
          }
          await apiClient.copyFile(fromPath, toPath);
          if (syncStore.has(fromPath)) syncStore.set(toPath, syncStore.get(fromPath) as any);
          if (statStore.has(fromPath)) statStore.set(toPath, statStore.get(fromPath) as any);
          ensureParentDirectoryEntry(toPath);
        },
        async rm(filePath: string, _options?: any) {
          return this.unlink(filePath);
        },
        async rmdir(filePath: string, _options?: any) {
          return this.unlink(filePath);
        },
      },
    };

    fsStub.writeFileSync = (filePath: string, value: any) => {
      const encoding = normalizeEncoding(value);
      const data = typeof value === 'string' ? value : Buffer.isBuffer(value) ? new Uint8Array(value) : value;
      syncStore.set(filePath, data as any);
      cacheStat(filePath, {
        size: typeof data === 'string' ? Buffer.byteLength(data, encoding === 'utf8' || encoding === 'utf-8' ? 'utf8' : undefined) : Buffer.from(data).byteLength,
        birthtimeMs: Date.now(),
        mtimeMs: Date.now(),
        isDirectory: false,
        isFile: true,
      });
      ensureParentDirectoryEntry(filePath);
      const body = typeof data === 'string' ? data : Buffer.from(data);
      void apiClient.writeFile(filePath, body).catch((error) => console.error(error));
    };

    fsStub.unlinkSync = (filePath: string) => {
      deleteCachedPath(filePath);
      removeFromParentDirectoryEntry(filePath);
      void apiClient.unlink(filePath).catch((error) => {
        if (!isEnoent(error)) console.error(error);
      });
    };
    fsStub.realpathSync.native = fsStub.realpathSync;
    return fsStub;
  }

  function installResourceHandling() {
    const observedAttributes = ['src', 'href', 'poster'];

    const rewriteElement = (element: Element, attribute: string) => {
      const rawValue = element.getAttribute(attribute);
      const filePath = extractVaultPath(rawValue);
      if (!filePath) return;
      const assetUrl = toAssetUrl(filePath);
      if (rawValue !== assetUrl) {
        element.setAttribute(attribute, assetUrl);
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
          const filePath = extractVaultPath(value);
          if (!filePath) {
            descriptor.set.call(this, value);
            return;
          }
          descriptor.set.call(this, toAssetUrl(filePath));
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
              if (node.hasAttribute(attribute)) rewriteElement(node, attribute);
            }
            for (const descendant of node.querySelectorAll('[src],[href],[poster]')) {
              for (const attribute of observedAttributes) {
                if (descendant.hasAttribute(attribute)) rewriteElement(descendant, attribute);
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

    const sweepDocument = () => {
      for (const element of document.querySelectorAll('[src],[href],[poster]')) {
        for (const attribute of observedAttributes) {
          if (element.hasAttribute(attribute)) rewriteElement(element, attribute);
        }
      }
    };

    patchUrlProperty(HTMLImageElement.prototype, 'src');
    patchUrlProperty(HTMLAudioElement.prototype, 'src');
    patchUrlProperty(HTMLVideoElement.prototype, 'src');
    patchUrlProperty(HTMLSourceElement.prototype, 'src');
    patchUrlProperty(HTMLAnchorElement.prototype, 'href');
    patchUrlProperty(HTMLLinkElement.prototype, 'href');

    sweepDocument();
    window.setInterval(sweepDocument, 1000);
  }

  return {
    createFsStub,
    refreshSnapshot,
    installResourceHandling,
    syncStore,
  };
}
