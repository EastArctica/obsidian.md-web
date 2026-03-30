export type SelfhostedVaultRecord = {
  id: string;
  name: string;
  path: string;
  ts: number;
  open?: boolean;
};

export type SelfhostedApiClientOptions = {
  baseUrl?: string;
};

export type SelfhostedConfig = {
  rootPath: string;
  absoluteRootPath: string;
  mode: 'selfhosted';
};

export type SelfhostedOpenVaultResponse = {
  ok: boolean;
  error?: string;
  code?: string;
  vault?: SelfhostedVaultRecord;
};

export type SelfhostedSnapshot = {
  directories: Array<{
    path: string;
    entries: string[];
    stat: { size: number; birthtimeMs: number; mtimeMs: number; isDirectory: boolean; isFile: boolean };
  }>;
  files: Array<{
    path: string;
    stat: { size: number; birthtimeMs: number; mtimeMs: number; isDirectory: boolean; isFile: boolean };
    encoding: string | null;
    content: string | null;
  }>;
};

export function createSelfhostedApiClient(options: SelfhostedApiClientOptions = {}) {
  const baseUrl = options.baseUrl || '/api';

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`${baseUrl}${path}`, init);
    if (!response.ok) {
      let payload: any = null;
      try {
        payload = await response.json();
      } catch {}
      const error: any = new Error(payload?.error || `Selfhosted API request failed: ${response.status} ${response.statusText}`);
      error.status = response.status;
      if (payload?.code) error.code = payload.code;
      throw error;
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return response.json();
    return response.text();
  }

  return {
    async getConfig(): Promise<SelfhostedConfig> {
      return request('/selfhosted/config');
    },
    async listVaults(): Promise<SelfhostedVaultRecord[]> {
      return request('/vaults');
    },
    async openVault(path: string, create: boolean): Promise<SelfhostedOpenVaultResponse> {
      return request('/vaults/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, create }),
      });
    },
    async createVault(name: string, parentPath?: string): Promise<SelfhostedOpenVaultResponse> {
      return request('/vaults/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentPath }),
      });
    },
    async removeVault(path: string): Promise<{ ok: boolean }> {
      return request('/vaults/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
    },
    async moveVault(fromPath: string, toPath: string): Promise<SelfhostedOpenVaultResponse> {
      return request('/vaults/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromPath, toPath }),
      });
    },
    async readFile(path: string, options?: { encoding?: string | null }) {
      const response = await fetch(`${baseUrl}/fs/read?path=${encodeURIComponent(path)}`);
      if (!response.ok) {
        let payload: any = null;
        try {
          payload = await response.json();
        } catch {}
        const error: any = new Error(payload?.error || `Failed to read file: ${path}`);
        if (payload?.code) error.code = payload.code;
        error.status = response.status;
        throw error;
      }
      const encoding = options?.encoding;
      if (encoding === 'utf8' || encoding === 'utf-8') {
        return response.text();
      }
      return response.arrayBuffer();
    },
    async readdir(path: string): Promise<string[]> {
      return request(`/fs/readdir?path=${encodeURIComponent(path)}`);
    },
    async stat(path: string): Promise<{ size: number; birthtimeMs: number; mtimeMs: number; isDirectory: boolean; isFile: boolean }> {
      return request(`/fs/stat?path=${encodeURIComponent(path)}`);
    },
    async snapshot(path: string): Promise<SelfhostedSnapshot> {
      return request(`/fs/snapshot?path=${encodeURIComponent(path)}`);
    },
    async writeFile(path: string, body: BodyInit) {
      const response = await fetch(`${baseUrl}/fs/write?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        body,
      });
      if (!response.ok) {
        let payload: any = null;
        try {
          payload = await response.json();
        } catch {}
        const error: any = new Error(payload?.error || `Failed to write file: ${path}`);
        if (payload?.code) error.code = payload.code;
        throw error;
      }
    },
    async mkdir(path: string) {
      return request('/fs/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
    },
    async unlink(path: string) {
      const response = await fetch(`${baseUrl}/fs/remove?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        let payload: any = null;
        try {
          payload = await response.json();
        } catch {}
        const error: any = new Error(payload?.error || `Failed to remove file: ${path}`);
        if (payload?.code) error.code = payload.code;
        throw error;
      }
    },
    async rename(fromPath: string, toPath: string) {
      return request('/fs/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromPath, toPath }),
      });
    },
    async copyFile(fromPath: string, toPath: string) {
      return request('/fs/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromPath, toPath }),
      });
    },
    getAssetUrl(path: string) {
      return `/vault-assets?path=${encodeURIComponent(path)}`;
    },
  };
}
