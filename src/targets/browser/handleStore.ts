type CreateBrowserHandleStoreOptions = {
  dbName: string;
  storeName: string;
};

export function createBrowserHandleStore(options: CreateBrowserHandleStoreOptions) {
  const { dbName, storeName } = options;
  const vaultHandles = new Map<string, FileSystemDirectoryHandle>();
  let vaultHandleDbPromise: Promise<IDBDatabase> | null = null;

  function openVaultHandleDb(): Promise<IDBDatabase> {
    if (vaultHandleDbPromise) return vaultHandleDbPromise;
    vaultHandleDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return vaultHandleDbPromise;
  }

  async function persistVaultHandle(id: string, handle: FileSystemDirectoryHandle): Promise<void> {
    vaultHandles.set(id, handle);
    const db = await openVaultHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(handle, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deleteVaultHandle(id: string): Promise<void> {
    vaultHandles.delete(id);
    const db = await openVaultHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function restoreVaultHandles(): Promise<void> {
    const db = await openVaultHandleDb();
    const ids = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await Promise.all(ids.map(async (id) => {
      const handle = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (handle) vaultHandles.set(String(id), handle);
    }));
  }

  return {
    deleteVaultHandle,
    getHandle(id: string) {
      return vaultHandles.get(id) ?? null;
    },
    handles: vaultHandles,
    persistVaultHandle,
    restoreVaultHandles,
  };
}
