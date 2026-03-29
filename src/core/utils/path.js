import path from 'path-browserify';

export function normalizePath(value) {
  const text = String(value || '').replace(/\\/g, '/');
  return text.length > 1 ? text.replace(/\/+$/, '') : text;
}

export function safeVaultName(name) {
  return String(name || 'vault').replace(/[\\/]/g, '-').trim() || 'vault';
}

export function buildVirtualVaultPath(root, name) {
  return `${root}/${safeVaultName(name)}`;
}

export function ensureParentDirs(filePath, addDir) {
  let current = normalizePath(path.dirname(normalizePath(filePath)));
  while (current && current !== '.' && current !== '/') {
    addDir(current);
    current = normalizePath(path.dirname(current));
  }
  if (current === '/') addDir('/');
}

export function splitRelativePath(relativePath) {
  return String(relativePath)
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}
