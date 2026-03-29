export function createIpcRendererShim() {
  const listeners = new Map();
  const invokeHandlers = new Map();
  const sendHandlers = new Map();
  const sendSyncHandlers = new Map();
  const eventLog = [];

  function createEvent() {
    return {
      sender: ipcRenderer,
      returnValue: null,
    };
  }

  function record(kind, channel, args) {
    eventLog.push({ kind, channel, args, timestamp: Date.now() });
  }

  function add(channel, callback, once = false) {
    const list = listeners.get(channel) ?? [];
    list.push({ callback, once });
    listeners.set(channel, list);
  }

  function emit(channel, ...args) {
    const list = listeners.get(channel) ?? [];
    const event = createEvent();
    listeners.set(
      channel,
      list.filter((entry) => {
        entry.callback(event, ...args);
        return !entry.once;
      }),
    );
    return event.returnValue;
  }

  function clearListeners(channel) {
    if (typeof channel === 'string') listeners.delete(channel);
    else listeners.clear();
    return ipcRenderer;
  }

  function removeHandler(channel, type = 'all') {
    if (type === 'all' || type === 'invoke') invokeHandlers.delete(channel);
    if (type === 'all' || type === 'send') sendHandlers.delete(channel);
    if (type === 'all' || type === 'sendSync') sendSyncHandlers.delete(channel);
    return ipcRenderer;
  }

  const ipcRenderer = {
    on(channel, callback) {
      add(channel, callback, false);
      return ipcRenderer;
    },
    once(channel, callback) {
      add(channel, callback, true);
      return ipcRenderer;
    },
    removeListener(channel, callback) {
      const list = listeners.get(channel) ?? [];
      listeners.set(channel, list.filter((entry) => entry.callback !== callback));
      return ipcRenderer;
    },
    removeAllListeners(channel) {
      return clearListeners(channel);
    },
    off(channel, callback) {
      return ipcRenderer.removeListener(channel, callback);
    },
    send(channel, ...args) {
      record('send', channel, args);
      console.info('[electron.send]', channel, ...args);
      const handler = sendHandlers.get(channel);
      if (handler) return handler({ channel, args, ipcRenderer, emit });
      if (channel === 'request-url' && typeof args[0] === 'string') {
        queueMicrotask(() => emit(args[0], null, { body: '', error: null }));
      }
      return undefined;
    },
    sendSync(channel, ...args) {
      record('sendSync', channel, args);
      console.info('[electron.sendSync]', channel, ...args);
      const handler = sendSyncHandlers.get(channel);
      if (handler) return handler({ channel, args, ipcRenderer, emit });
      switch (channel) {
        case 'is-dev':
          return true;
        case 'file-url':
          return `${window.location.origin}/`;
        case 'get-user-data-path':
          return '/virtual-user-data';
        default:
          return null;
      }
    },
    invoke(channel, ...args) {
      record('invoke', channel, args);
      console.info('[electron.invoke]', channel, ...args);
      const handler = invokeHandlers.get(channel);
      if (handler) return Promise.resolve(handler({ channel, args, ipcRenderer, emit }));
      return Promise.resolve(null);
    },
    emit,
    handle(channel, handler) {
      invokeHandlers.set(channel, handler);
      return ipcRenderer;
    },
    handleSend(channel, handler) {
      sendHandlers.set(channel, handler);
      return ipcRenderer;
    },
    handleSendSync(channel, handler) {
      sendSyncHandlers.set(channel, handler);
      return ipcRenderer;
    },
    removeHandler(channel, type) {
      return removeHandler(channel, type);
    },
    getEventLog() {
      return [...eventLog];
    },
    clearEventLog() {
      eventLog.length = 0;
      return ipcRenderer;
    },
  };

  return ipcRenderer;
}
