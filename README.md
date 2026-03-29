# Obsidian Vite web shell

This is a lightweight Vite wrapper around the Obsidian asar bundle.

Project layout:
- `asar/obsidian.asar` is the runtime renderer asset source.
- `asar/app.asar` is kept alongside it so the project is self-contained.

Current entry behavior:
- The web shell now boots into Obsidian's extracted `starter.js` flow by default instead of trying to launch the full main app immediately.

What it does:
- Serves Obsidian assets dynamically from `./asar/obsidian.asar` through a Vite plugin.
- Preserves the original renderer load order from `index.html`.
- Installs browser-side shims for a small subset of Electron and Node APIs.
- Includes a basic `@electron/remote` shim mapped through `window.require('@electron/remote')`.
- Applies a minimal in-memory patch to `starter.js` so the folder dialog path is routed through the web shim instead of mutating files on disk.
- Starts from a slim `src/bootstrap.js` entrypoint that now delegates to `src/targets/browser/index.js` or `src/targets/selfhosted/index.js`, with shared helpers under `src/core/`.

What it does not do yet:
- Replace the real desktop main process.
- Provide native filesystem, IPC, or Electron window behavior.
- Make the full app production-ready in a browser.
- The planned `selfhosted` target now has a scaffolded target entry and vault adapter shell, but the server-backed implementation is still not wired up.

Known follow-up:
- Recent vault metadata is now persisted, and directory handles are restored from IndexedDB when the browser allows it; sync fallback vault paths chosen through `prompt(...)` still do not have a real handle behind them.
- `is-dev` is currently stubbed to always return `undefined` to match your observed behavior; this may need revisiting if Obsidian starts branching on a strict boolean.

Built-in IPC stubs:
- `vault`, `vault-list`, `version`, `insider-build`, `is-quitting`, `get-sandbox-vault-path`, `adblock-frequency`, `adblock-lists`, `update`, `check-update`, `cli`, `documents-dir`, `desktop-dir`, `get-icon`, `copy-asar`
- `vault-open` now reuses the persisted vault registry and returns `folder not found` only when a non-created vault path is unknown
- `disable-update`, `disable-gpu`, `set-icon`, `relaunch`, `frame`, `sandbox`, `starter`, and `help` are stubbed; the action-oriented ones dispatch browser events like `obsidian-web:starter` for later wiring
- A broader extracted-backend channel inventory is exposed at `window.__OBSIDIAN_WEB_SHIM__.ipcChannels`, including descriptions, argument names, and nominal return shapes for currently stubbed host channels

Commands:
- `npm install`
- `npm run dev`
- `npm run build`
- `npm run typecheck`

The shim state is exposed at `window.__OBSIDIAN_WEB_SHIM__` for debugging.
- `window.__OBSIDIAN_WEB_SHIM__.listVirtualFs()` shows persisted virtual files.
- `window.__OBSIDIAN_WEB_SHIM__.listVaults()` shows the persisted recent-vault registry.
- `window.__OBSIDIAN_WEB_SHIM__.pickVaultDirectory()` can be called manually to use the real browser directory picker.
- When `vault-open` is triggered for a recent vault without a restored browser handle, the shim now re-prompts with the browser folder picker and shows a temporary page glow while waiting.
- The starter screen's `Create local vault` flow is patched in-memory to use the browser folder picker and then create/open the selected vault inside the web shim.
- The `Browse` button on the create-vault screen now uses the browser folder picker, updates the visible location field with a user-facing folder label, and the final `Create` action creates the named vault inside that selected parent folder.
- `@electron/remote.dialog.showOpenDialog(...)` uses the browser directory picker; `showOpenDialogSync(...)` uses a synchronous prompt fallback because browsers do not provide a true synchronous directory picker.
- `window.__OBSIDIAN_WEB_SHIM__.showOpenDialogSyncCompat(options)` is the compat hook used by the in-memory `starter.js` patch.
- `window.__OBSIDIAN_WEB_SHIM__.resetVirtualFs()` clears persisted virtual files/directories back to the default vault roots.

IPC hooks:
- `window.__OBSIDIAN_WEB_SHIM__.ipcRenderer.handle(channel, handler)` for `invoke`
- `window.__OBSIDIAN_WEB_SHIM__.ipcRenderer.handleSend(channel, handler)` for `send`
- `window.__OBSIDIAN_WEB_SHIM__.ipcRenderer.handleSendSync(channel, handler)` for `sendSync`
- `window.__OBSIDIAN_WEB_SHIM__.ipcRenderer.emit(channel, ...args)` to simulate main-process events
- `window.__OBSIDIAN_WEB_SHIM__.ipcRenderer.getEventLog()` to inspect traffic
