import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.canvas', '.svg', '.css', '.js', '.ts', '.html', '.xml', '.yml', '.yaml']);
const MIME_BY_EXTENSION = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.md': 'text/markdown; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function isNotFoundError(error) {
  return error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function createStatPayload(stats) {
  return {
    size: stats.size,
    birthtimeMs: stats.birthtimeMs,
    mtimeMs: stats.mtimeMs,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
  };
}

async function exists(fullPath) {
  try {
    await fsp.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

async function findVaults(rootPath) {
  const found = [];

  async function walk(dirPath) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const hasObsidian = entries.some((entry) => entry.isDirectory() && entry.name === '.obsidian');
    if (hasObsidian) {
      found.push(dirPath);
      return;
    }
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => walk(path.join(dirPath, entry.name))));
  }

  await walk(rootPath);
  return found;
}

function isTextLikePath(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function buildSnapshot(rootPath, toLogicalPath) {
  const directories = [];
  const files = [];

  async function walk(dirPath) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const logicalDirPath = toLogicalPath(dirPath);
    directories.push({
      path: logicalDirPath,
      entries: entries.map((entry) => entry.name),
      stat: createStatPayload(await fsp.stat(dirPath)),
    });

    await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        return;
      }

      const stat = await fsp.stat(fullPath);
      const logicalPath = toLogicalPath(fullPath);
      const text = isTextLikePath(fullPath) ? await fsp.readFile(fullPath, 'utf8') : null;
      files.push({
        path: logicalPath,
        stat: createStatPayload(stat),
        encoding: text == null ? null : 'utf8',
        content: text,
      });
    }));
  }

  await walk(rootPath);
  return { directories, files };
}

export function createSelfhostedApiPlugin({ projectDir }) {
  const rootPath = path.resolve(process.env.OBSIDIAN_VAULT_ROOT || path.join(projectDir, 'vaults'));
  fs.mkdirSync(rootPath, { recursive: true });

  function toLogicalPath(fullPath) {
    const relative = path.relative(rootPath, fullPath).replace(/\\/g, '/');
    return `/vaults${relative ? `/${relative}` : ''}`;
  }

  function resolveVaultPath(inputPath = '/vaults') {
    const normalized = String(inputPath || '/vaults').replace(/\\/g, '/');
    const withoutPrefix = normalized.startsWith('/vaults') ? normalized.slice('/vaults'.length) : normalized;
    const relative = path.posix.normalize(withoutPrefix).replace(/^\/+/, '');
    if (relative.startsWith('..')) throw new Error('Path escapes vault root');
    const fullPath = path.resolve(rootPath, relative);
    const rootWithSep = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`;
    if (fullPath !== rootPath && !fullPath.startsWith(rootWithSep)) {
      throw new Error('Path escapes vault root');
    }
    return { fullPath, logicalPath: toLogicalPath(fullPath) };
  }

  function normalizeVaultRecord(fullPath) {
    const name = path.basename(fullPath);
    const stats = fs.statSync(fullPath);
    return {
      id: toLogicalPath(fullPath),
      name,
      path: toLogicalPath(fullPath),
      ts: stats.mtimeMs,
      open: false,
    };
  }

  async function handle(req, res, next) {
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      if (url.pathname === '/api/selfhosted/config') {
        return json(res, 200, {
          rootPath: '/vaults',
          absoluteRootPath: rootPath,
          mode: 'selfhosted',
        });
      }

      if (url.pathname === '/api/vaults' && req.method === 'GET') {
        const vaultPaths = await findVaults(rootPath);
        return json(res, 200, vaultPaths.map(normalizeVaultRecord));
      }

      if (url.pathname === '/api/vaults/open' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const { fullPath } = resolveVaultPath(body.path);
        if (!(await exists(fullPath))) {
          if (!body.create) return json(res, 404, { ok: false, error: 'folder not found' });
          await fsp.mkdir(fullPath, { recursive: true });
          await fsp.mkdir(path.join(fullPath, '.obsidian'), { recursive: true });
        }
        return json(res, 200, { ok: true, vault: normalizeVaultRecord(fullPath) });
      }

      if (url.pathname === '/api/vaults/create' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const parent = resolveVaultPath(body.parentPath || '/vaults');
        const fullPath = path.join(parent.fullPath, body.name);
        await fsp.mkdir(fullPath, { recursive: true });
        await fsp.mkdir(path.join(fullPath, '.obsidian'), { recursive: true });
        return json(res, 200, { ok: true, vault: normalizeVaultRecord(fullPath) });
      }

      if (url.pathname === '/api/vaults/remove' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const { fullPath } = resolveVaultPath(body.path);
        await fsp.rm(fullPath, { recursive: true, force: true });
        return json(res, 200, { ok: true });
      }

      if (url.pathname === '/api/vaults/move' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const fromPath = resolveVaultPath(body.fromPath);
        const toPath = resolveVaultPath(body.toPath);
        await fsp.mkdir(path.dirname(toPath.fullPath), { recursive: true });
        await fsp.rename(fromPath.fullPath, toPath.fullPath);
        return json(res, 200, { ok: true, vault: normalizeVaultRecord(toPath.fullPath) });
      }

      if (url.pathname === '/api/fs/read' && req.method === 'GET') {
        const { fullPath } = resolveVaultPath(url.searchParams.get('path') || '/vaults');
        const data = await fsp.readFile(fullPath);
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME_BY_EXTENSION[path.extname(fullPath).toLowerCase()] || 'application/octet-stream');
        return res.end(data);
      }

      if (url.pathname === '/api/fs/snapshot' && req.method === 'GET') {
        const { fullPath } = resolveVaultPath(url.searchParams.get('path') || '/vaults');
        return json(res, 200, await buildSnapshot(fullPath, toLogicalPath));
      }

      if (url.pathname === '/api/fs/readdir' && req.method === 'GET') {
        const { fullPath } = resolveVaultPath(url.searchParams.get('path') || '/vaults');
        const entries = await fsp.readdir(fullPath);
        return json(res, 200, entries);
      }

      if (url.pathname === '/api/fs/stat' && req.method === 'GET') {
        const { fullPath } = resolveVaultPath(url.searchParams.get('path') || '/vaults');
        const stats = await fsp.stat(fullPath);
        return json(res, 200, createStatPayload(stats));
      }

      if (url.pathname === '/api/fs/write' && req.method === 'PUT') {
        const { fullPath } = resolveVaultPath(url.searchParams.get('path') || '/vaults');
        await fsp.mkdir(path.dirname(fullPath), { recursive: true });
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        await fsp.writeFile(fullPath, Buffer.concat(chunks));
        return json(res, 200, { ok: true });
      }

      if (url.pathname === '/api/fs/mkdir' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const { fullPath } = resolveVaultPath(body.path);
        await fsp.mkdir(fullPath, { recursive: true });
        return json(res, 200, { ok: true });
      }

      if (url.pathname === '/api/fs/remove' && req.method === 'DELETE') {
        const { fullPath } = resolveVaultPath(url.searchParams.get('path') || '/vaults');
        await fsp.rm(fullPath, { recursive: true, force: true });
        return json(res, 200, { ok: true });
      }

      if (url.pathname === '/api/fs/rename' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const fromPath = resolveVaultPath(body.fromPath);
        const toPath = resolveVaultPath(body.toPath);
        await fsp.mkdir(path.dirname(toPath.fullPath), { recursive: true });
        await fsp.rename(fromPath.fullPath, toPath.fullPath);
        return json(res, 200, { ok: true });
      }

      if (url.pathname === '/api/fs/copy' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const fromPath = resolveVaultPath(body.fromPath);
        const toPath = resolveVaultPath(body.toPath);
        await fsp.mkdir(path.dirname(toPath.fullPath), { recursive: true });
        await fsp.copyFile(fromPath.fullPath, toPath.fullPath);
        return json(res, 200, { ok: true });
      }

      if (url.pathname === '/vault-assets' && req.method === 'GET') {
        const { fullPath } = resolveVaultPath(url.searchParams.get('path') || '/vaults');
        const stream = fs.createReadStream(fullPath);
        stream.on('error', next);
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME_BY_EXTENSION[path.extname(fullPath).toLowerCase()] || 'application/octet-stream');
        return stream.pipe(res);
      }

      return next();
    } catch (error) {
      if (isNotFoundError(error)) {
        return json(res, 404, {
          ok: false,
          code: 'ENOENT',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    name: 'selfhosted-api',
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}
