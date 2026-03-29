import { bootBrowserApp } from './targets/browser/index.js';

const target = import.meta.env.VITE_OBSIDIAN_TARGET || 'browser';

async function boot() {
  switch (target) {
    case 'browser':
      return bootBrowserApp();
    case 'selfhosted':
      throw new Error('Selfhosted target is not implemented yet');
    default:
      throw new Error(`Unknown Obsidian target: ${target}`);
  }
}

boot().catch((error) => {
  console.error(error);
  const statusEl = document.getElementById('shim-status');
  if (statusEl) statusEl.textContent = error.message || String(error);
});
