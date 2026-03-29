import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile, listPackage, statFile } from '@electron/asar';
import { defineConfig } from 'vite';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const obsidianAsarPath = path.resolve(projectDir, 'asar/obsidian.asar');

const STARTER_DIALOG_SNIPPET =
  'function a(a,e){var t=l.dialog.showOpenDialogSync({title:a,properties:["openDirectory","createDirectory","dontAddToRecent"],defaultPath:e});return t&&t.length>0?t[0]:null}';
const STARTER_DIALOG_PATCH =
  'function a(a,e){return window.__OBSIDIAN_WEB_SHIM__.showOpenDialogSyncCompat({title:a,properties:["openDirectory","createDirectory","dontAddToRecent"],defaultPath:e})}';
const STARTER_OPEN_FOLDER_SNIPPET =
  'addSetting((function(e){return e.setName(M.optionOpenFolderAsVault()).setDesc(M.optionOpenFolderAsVaultDescription()).addButton((function(e){return e.setButtonText(M.buttonOpen()).onClick((function(){var e=a(M.optionOpenFolderAsVault());if(e){var t=h.sendSync("vault-open",e,!1);!0===t?window.close():new pt("".concat(M.msgErrorFailedToOpenVault()," ").concat(t,"."))}}))}))}))';
const STARTER_OPEN_FOLDER_PATCH =
  'addSetting((function(e){return e.setName(M.optionOpenFolderAsVault()).setDesc(M.optionOpenFolderAsVaultDescription()).addButton((function(e){return e.setButtonText(M.buttonOpen()).onClick((function(){window.__OBSIDIAN_WEB_SHIM__.openFolderAsVault(h,M,pt)}))}))}))';
const STARTER_CREATE_VAULT_SNIPPET =
  'a.createEl("button",{cls:"mod-cta",text:M.buttonCreateVault()},(function(a){a.addEventListener("click",(function(){var a=w.getValue().trim();if(a)if(na.isWin&&a.endsWith("."))new pt(M.msgTrailingDotVaultName());else if(A){var e=A+"/"+a;try{var t=h.sendSync("vault-open",e,!0);if(!0===t)return C?(h.sendSync("vault-message",e,{action:"sync-setup",vault:JSON.stringify(C)}),X(y,H,"left")):h.sendSync("vault-message",e,{action:"vault-setup"}),void window.close();new pt("".concat(M.msgFailedToCreateVault()," ").concat(t,"."))}catch(a){console.error(a),new pt(M.msgFailedToCreateVaultAtLocation())}}else new pt(M.msgInvalidFolder());else new pt(M.msgEmptyVaultName())}))}))}))';
const STARTER_CREATE_VAULT_PATCH =
  'a.createEl("button",{cls:"mod-cta",text:M.buttonCreateVault()},(function(a){a.addEventListener("click",(function(){var a=w.getValue().trim();if(a)if(na.isWin&&a.endsWith("."))new pt(M.msgTrailingDotVaultName());else window.__OBSIDIAN_WEB_SHIM__.createLocalVault(h,M,pt,a,C);else new pt(M.msgEmptyVaultName())}))}))}))';
const STARTER_CREATE_BROWSE_SNIPPET =
  'addSetting((function(e){z=e.setName(M.optionNewVaultLocation()).setDesc(M.optionNewVaultLocationDescription()).addButton((function(e){return e.setButtonText(M.buttonBrowse()).onClick((function(){var e=a(M.optionNewVaultLocation());e&&S(e)}))}))}))';
const STARTER_CREATE_BROWSE_PATCH =
  'addSetting((function(e){z=e.setName(M.optionNewVaultLocation()).setDesc(M.optionNewVaultLocationDescription()).addButton((function(e){return e.setButtonText(M.buttonBrowse()).onClick((function(){window.__OBSIDIAN_WEB_SHIM__.chooseCreateVaultParent(M.optionNewVaultLocation(),S)}))}))}))';
const STARTER_CREATE_VAULT_PREVIEW_SNIPPET =
  'else if(A){var e=A+"/"+a;try{var t=h.sendSync("vault-open",e,!0);if(!0===t)return C?(h.sendSync("vault-message",e,{action:"sync-setup",vault:JSON.stringify(C)}),X(y,H,"left")):h.sendSync("vault-message",e,{action:"vault-setup"}),void window.close();new pt("".concat(M.msgFailedToCreateVault()," ").concat(t,"."))}catch(a){console.error(a),new pt(M.msgFailedToCreateVaultAtLocation())}}else new pt(M.msgInvalidFolder())';
const STARTER_CREATE_VAULT_PREVIEW_PATCH =
  'else if(A){var e=A+"/"+a;try{var t=h.sendSync("vault-open",e,!0);if(!0===t)return C?(h.sendSync("vault-message",e,{action:"sync-setup",vault:JSON.stringify(C)}),X(y,H,"left")):h.sendSync("vault-message",e,{action:"vault-setup"}),void window.close();new pt("".concat(M.msgFailedToCreateVault()," ").concat(t,"."))}catch(a){console.error(a),new pt(M.msgFailedToCreateVaultAtLocation())}}else new pt(M.msgInvalidFolder())';

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

function readAsarAsset(assetPath) {
  try {
    const metadata = statFile(obsidianAsarPath, assetPath);
    if (metadata?.files) return null;
    let source = extractFile(obsidianAsarPath, assetPath);
    if (assetPath === 'starter.js') {
        source = Buffer.from(
        source
          .toString('utf8')
          .replace(STARTER_DIALOG_SNIPPET, STARTER_DIALOG_PATCH)
          .replace(STARTER_OPEN_FOLDER_SNIPPET, STARTER_OPEN_FOLDER_PATCH)
          .replace(STARTER_CREATE_BROWSE_SNIPPET, STARTER_CREATE_BROWSE_PATCH)
          .replace(STARTER_CREATE_VAULT_SNIPPET, STARTER_CREATE_VAULT_PATCH),
        'utf8',
      );
    }
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
  plugins: [obsidianAsarPlugin()],
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
