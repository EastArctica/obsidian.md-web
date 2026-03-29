import { createStatusUi } from '../../core/utils/statusUi.js';
import { createSelfhostedVaultAdapter } from './vaultAdapter.js';

const statusUi = createStatusUi();
const selfhostedVaultAdapter = createSelfhostedVaultAdapter();

export async function bootSelfhostedApp() {
  window.__OBSIDIAN_WEB_SHIM__ = {
    target: 'selfhosted',
    vaultAdapter: selfhostedVaultAdapter,
  };

  statusUi.setStatus('Selfhosted target scaffolding is present, but the server-backed adapter is not implemented yet.', 'warning');
  await selfhostedVaultAdapter.init();
  throw new Error('Selfhosted target is not implemented yet');
}
