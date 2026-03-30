import { createIpcRendererShim } from './ipc/createIpcRendererShim.js';

export function createElectronStub({ openDirectoryDialog, openDirectoryDialogSync }) {
  const ipcRenderer = createIpcRendererShim();
  let zoomFactor = 1;
  let zoomLevel = 0;
  const nativeThemeStub = {
    shouldUseDarkColors: true,
    on() { return nativeThemeStub; },
    once() { return nativeThemeStub; },
    removeListener() { return nativeThemeStub; },
    removeAllListeners() { return nativeThemeStub; },
  };
  const webContentsStub = {
    executeJavaScript() { return Promise.resolve(null); },
    getZoomFactor() { return zoomFactor; },
    setZoomFactor(value = 1) {
      zoomFactor = Number(value) || 1;
      zoomLevel = Math.log2(zoomFactor);
    },
    getZoomLevel() { return zoomLevel; },
    setZoomLevel(value = 0) {
      zoomLevel = Number(value) || 0;
      zoomFactor = 2 ** zoomLevel;
    },
    send(...args) { return ipcRenderer.send(...args); },
    on() {},
    once() {},
  };
  const remoteStub = {
    getCurrentWindow() {
      return {
        isDestroyed() { return false; },
        isFocused() { return document.hasFocus(); },
        isFullScreen() { return false; },
        isMaximized() { return false; },
        isMinimized() { return false; },
        minimize() {}, maximize() {}, unmaximize() {}, close() {}, focus() {}, show() {}, hide() {},
        setAlwaysOnTop() {}, setFullScreen() {}, setVibrancy() {}, setBackgroundColor() {},
        on() {}, once() {}, removeListener() {},
        webContents: webContentsStub,
      };
    },
    getCurrentWebContents() { return webContentsStub; },
    BrowserWindow: {
      getFocusedWindow() { return remoteStub.getCurrentWindow(); },
    },
    app: {
      getPath(name) { return name === 'userData' ? '/virtual-user-data' : '/'; },
      getVersion() { return '1.12.7'; },
    },
    dialog: {
      showMessageBox() { return Promise.resolve({ response: 0, checkboxChecked: false }); },
      showOpenDialog(options) {
        if (typeof window.showDirectoryPicker !== 'function') return Promise.resolve({ canceled: true, filePaths: [] });
        return openDirectoryDialog(options).catch((error) => {
          if (error && error.name === 'AbortError') return { canceled: true, filePaths: [] };
          throw error;
        });
      },
      showOpenDialogSync(options) { return openDirectoryDialogSync(options); },
      showErrorBox(title, message) { console.error('[remote.showErrorBox]', title, message); },
    },
    Menu: { buildFromTemplate(template) { return { template }; } },
    nativeTheme: nativeThemeStub,
    getGlobal() { return undefined; },
    require(id) { return window.require(id); },
  };

  return {
    ipcRenderer,
    remote: remoteStub,
    shell: {
      openExternal(url) { window.open(url, '_blank', 'noopener'); },
      openPath(filePath) { console.info('[electron.openPath]', filePath); return Promise.resolve(''); },
    },
    clipboard: {
      writeText(text) { navigator.clipboard?.writeText(text).catch(() => {}); },
      readText() { return ''; },
    },
    webFrame: {
      setZoomLevel(value) { webContentsStub.setZoomLevel(value); },
      getZoomLevel() { return webContentsStub.getZoomLevel(); },
    },
    nativeTheme: nativeThemeStub,
  };
}
