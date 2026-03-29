import { defineVaultAdapter } from '../../core/vaultAdapter';

type VaultRecord = {
  id: string;
  name?: string;
  path: string;
  ts: number;
  open?: boolean;
};

type CreateBrowserVaultRegistryOptions = {
  storageKey: string;
  normalizePath: (value: unknown) => string;
  onCurrentVaultPath?: (path: string) => void;
};

export function createBrowserVaultRegistry(options: CreateBrowserVaultRegistryOptions) {
  const { storageKey, normalizePath, onCurrentVaultPath } = options;

  function loadVaultRegistry(): Record<string, Omit<VaultRecord, 'id'>> {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  let vaultRegistry = loadVaultRegistry();
  let currentVault = getMostRecentVault();

  function saveVaultRegistry() {
    localStorage.setItem(storageKey, JSON.stringify(vaultRegistry));
  }

  function getVaultEntries(): VaultRecord[] {
    return Object.entries(vaultRegistry)
      .map(([id, record]) => ({ id, ...record }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }

  function getMostRecentVault(): VaultRecord | null {
    return getVaultEntries()[0] ?? null;
  }

  function createVaultId(): string {
    return (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
      .replace(/-/g, '')
      .slice(0, 16);
  }

  function upsertVaultRecord(record: VaultRecord): VaultRecord {
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

  function getVaultRecordByPath(vaultPath: string): VaultRecord | null {
    const normalized = normalizePath(vaultPath);
    return getVaultEntries().find((entry) => normalizePath(entry.path) === normalized) ?? null;
  }

  function getVaultRecordById(id: string): VaultRecord | null {
    const record = vaultRegistry[id];
    return record ? { id, ...record } : null;
  }

  function removeVaultRecord(id: string): void {
    const { [id]: _removed, ...rest } = vaultRegistry;
    vaultRegistry = rest;
    saveVaultRegistry();
  }

  function getCurrentVault(): VaultRecord | null {
    return currentVault ? { ...currentVault } : null;
  }

  function setCurrentVault(vault: VaultRecord | null): void {
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
    onCurrentVaultPath?.(currentVault.path);
  }

  return {
    createVaultId,
    getCurrentVault,
    getMostRecentVault,
    getVaultEntries,
    getVaultRecordById,
    getVaultRecordByPath,
    removeVaultRecord,
    setCurrentVault,
    upsertVaultRecord,
  };
}
