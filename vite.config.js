import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile, listPackage, statFile } from '@electron/asar';
import { defineConfig } from 'vite';
import { createSelfhostedApiPlugin } from './server/selfhostedApi.js';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const obsidianAsarPath = path.resolve(projectDir, 'asar/obsidian.asar');

const PLAINTEXT_PATCHES = [
  {
    name: 'starter dialog compat',
    target: /^starter\.js$/,
    find: /function ([A-Za-z_$][A-Za-z0-9_$]*)\(([A-Za-z_$][A-Za-z0-9_$]*),([A-Za-z_$][A-Za-z0-9_$]*)\){var ([A-Za-z_$][A-Za-z0-9_$]*)=([A-Za-z_$][A-Za-z0-9_$]*)\.dialog\.showOpenDialogSync\({title:\2,properties:\["openDirectory","createDirectory","dontAddToRecent"\],defaultPath:\3}\);return \4&&\4\.length>0\?\4\[0\]:null}/,
    replace: (_substring, fn, a1, a2, _v1, _v2) => {
      return `function ${fn}(${a1},${a2}){return window.__OBSIDIAN_WEB_SHIM__.showOpenDialogSyncCompat({title:${a1},properties:["openDirectory","createDirectory","dontAddToRecent"],defaultPath:${a2}})}`;
    }
  },
  {
    name: 'starter open folder flow',
    target: /^starter\.js$/,
    find: /addSetting\(\(function\(([A-Za-z_$][A-Za-z0-9_$]*)\){return \1\.setName\(([A-Za-z_$][A-Za-z0-9_$]*)\.optionOpenFolderAsVault\(\)\)\.setDesc\(\2\.optionOpenFolderAsVaultDescription\(\)\)\.addButton\(\(function\(([A-Za-z_$][A-Za-z0-9_$]*)\){return \3\.setButtonText\(\2\.buttonOpen\(\)\)\.onClick\(\(function\(\){var ([A-Za-z_$][A-Za-z0-9_$]*)=([A-Za-z_$][A-Za-z0-9_$]*)\(\2\.optionOpenFolderAsVault\(\)\);if\(\4\){var ([A-Za-z_$][A-Za-z0-9_$]*)=([A-Za-z_$][A-Za-z0-9_$]*)\.sendSync\("vault-open",\4,!1\);!0===\6\?window\.close\(\):new ([A-Za-z_$][A-Za-z0-9_$]*)\(""\.concat\(\2\.msgErrorFailedToOpenVault\(\)," "\)\.concat\(\6,"\."\)\)}}\)\)}\)\)}\)\)/,
    replace: (_substring, e, M, anon1_e, _anon2_a1, _v1, _fn1, h, _v3, pt) =>
      `addSetting((function(${e}){return ${e}.setName(${M}.optionOpenFolderAsVault()).setDesc(${M}.optionOpenFolderAsVaultDescription()).addButton((function(${anon1_e}){return ${anon1_e}.setButtonText(${M}.buttonOpen()).onClick((function(){window.__OBSIDIAN_WEB_SHIM__.openFolderAsVault(${h},${M},${pt})}))}))}))`,
  },
  {
    name: 'starter create browse flow',
    target: /^starter\.js$/,
    find: /addSetting\(\(function\(([A-Za-z_$][A-Za-z0-9_$]*)\){([A-Za-z_$][A-Za-z0-9_$]*)=\1\.setName\(([A-Za-z_$][A-Za-z0-9_$]*)\.optionNewVaultLocation\(\)\)\.setDesc\(\3\.optionNewVaultLocationDescription\(\)\)\.addButton\(\(function\(([A-Za-z_$][A-Za-z0-9_$]*)\){return \4\.setButtonText\(\3\.buttonBrowse\(\)\)\.onClick\(\(function\(\){var ([A-Za-z_$][A-Za-z0-9_$]*)=([A-Za-z_$][A-Za-z0-9_$]*)\(\3\.optionNewVaultLocation\(\)\);\5&&([A-Za-z_$][A-Za-z0-9_$]*)\(\5\)}\)\)}\)\)}\)\)/,
    replace: (_substring, e, _z, M, anon1_e, _anon2_e, _fn_a, S) =>
      `addSetting((function(${e}){z=${e}.setName(${M}.optionNewVaultLocation()).setDesc(${M}.optionNewVaultLocationDescription()).addButton((function(${anon1_e}){return ${anon1_e}.setButtonText(${M}.buttonBrowse()).onClick((function(){window.__OBSIDIAN_WEB_SHIM__.chooseCreateVaultParent(${M}.optionNewVaultLocation(),${S})}))}))}))`,
  },
  {
    name: 'starter create vault flow',
    target: /^starter\.js$/,
    find: /([A-Za-z_$][A-Za-z0-9_$]*)\.createEl\("button",{cls:"mod-cta",text:([A-Za-z_$][A-Za-z0-9_$]*)\.buttonCreateVault\(\)},\(function\(([A-Za-z_$][A-Za-z0-9_$]*)\){\3\.addEventListener\("click",\(function\(\){var ([A-Za-z_$][A-Za-z0-9_$]*)=([A-Za-z_$][A-Za-z0-9_$]*)\.getValue\(\)\.trim\(\);if\(\4\)if\(([A-Za-z_$][A-Za-z0-9_$]*)\.isWin&&\4\.endsWith\("\."\)\)new ([A-Za-z_$][A-Za-z0-9_$]*)\(\2\.msgTrailingDotVaultName\(\)\);else if\(([A-Za-z_$][A-Za-z0-9_$]*)\){var ([A-Za-z_$][A-Za-z0-9_$]*)=\8\+"\/"\+\4;try{var ([A-Za-z_$][A-Za-z0-9_$]*)=([A-Za-z_$][A-Za-z0-9_$]*)\.sendSync\("vault-open",\9,!0\);if\(!0===\10\)return ([A-Za-z_$][A-Za-z0-9_$]*)\?\(\11\.sendSync\("vault-message",\9,{action:"sync-setup",vault:JSON\.stringify\(\12\)}\),([A-Za-z_$][A-Za-z0-9_$]*)\(([A-Za-z_$][A-Za-z0-9_$]*),([A-Za-z_$][A-Za-z0-9_$]*),"left"\)\):\11\.sendSync\("vault-message",\9,{action:"vault-setup"}\),void window\.close\(\);new \7\(""\.concat\(\2\.msgFailedToCreateVault\(\)," "\)\.concat\(\10,"\."\)\)}catch\(([A-Za-z_$][A-Za-z0-9_$]*)\){console\.error\(\16\),new \7\(\2\.msgFailedToCreateVaultAtLocation\(\)\)}}else new \7\(\2\.msgInvalidFolder\(\)\);else new \7\(\2\.msgEmptyVaultName\(\)\)}\)\)}\)\)}\)\)/,
    replace: (_substring, a, M, a_1, a_2, w, na, pt, A, e, t, h, C, X, y, H, a_3) =>
      `${a}.createEl("button",{cls:"mod-cta",text:${M}.buttonCreateVault()},(function(${a_1}){${a_1}.addEventListener("click",(function(){var ${a_2}=${w}.getValue().trim();if(${a_2})if(${na}.isWin&&${a_2}.endsWith("."))new ${pt}(${M}.msgTrailingDotVaultName());else window.__OBSIDIAN_WEB_SHIM__.createLocalVault(${h},${M},${pt},${a_2},${C});else new ${pt}(${M}.msgEmptyVaultName())}))}))}))`,
  },
];

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function normalizeAssetPath(url) {
  const pathname = decodeURIComponent(url.split('?')[0].split('#')[0]);
  if (!pathname.startsWith('/')) return null;
  if (pathname === '/' || pathname.startsWith('/src/') || pathname.startsWith('/@')) return null;
  return pathname.slice(1);
}

function applyPlaintextPatches(assetPath, sourceText) {
  let nextSource = sourceText;

  for (const patch of PLAINTEXT_PATCHES) {
    const matchesTarget = typeof patch.target === 'string' ? patch.target === assetPath : patch.target.test(assetPath);
    if (!matchesTarget) continue;

    const updated = nextSource.replace(patch.find, patch.replace);
    if (updated === nextSource) {
      throw new Error(`Failed to apply plaintext patch: ${patch.name}`);
    }
    nextSource = updated;
  }

  return nextSource;
}

function readAsarAsset(assetPath) {
  try {
    const metadata = statFile(obsidianAsarPath, assetPath);
    if (metadata?.files) return null;
    let source = extractFile(obsidianAsarPath, assetPath);
    const sourceText = source.toString('utf8');
    const patchedText = applyPlaintextPatches(assetPath, sourceText);
    if (patchedText !== sourceText) source = Buffer.from(patchedText, 'utf8');
    return source;
  } catch {
    return null;
  }
}

function contentTypeFor(assetPath) {
  return CONTENT_TYPES[path.extname(assetPath).toLowerCase()] || 'application/octet-stream';
}

function obsidianAsarPlugin() {
  return {
    name: 'obsidian-asar-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const assetPath = normalizeAssetPath(req.url || '/');
        if (!assetPath) return next();
        const source = readAsarAsset(assetPath);
        if (!source) return next();
        res.setHeader('Content-Type', contentTypeFor(assetPath));
        res.end(source);
      });
    },
    generateBundle() {
      for (const entry of listPackage(obsidianAsarPath)) {
        const assetPath = entry.replace(/^\//, '');
        if (!assetPath) continue;
        if (assetPath === 'index.html') continue;
        let metadata;
        try {
          metadata = statFile(obsidianAsarPath, assetPath);
        } catch {
          continue;
        }
        if (metadata?.files) continue;
        const source = readAsarAsset(assetPath);
        if (!source) continue;
        this.emitFile({
          type: 'asset',
          fileName: assetPath,
          source,
        });
      }
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [obsidianAsarPlugin(), createSelfhostedApiPlugin({ projectDir })],
  server: {
    fs: {
      allow: [projectDir],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
