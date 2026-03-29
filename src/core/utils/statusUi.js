export function createStatusUi() {
  let statusEl = document.getElementById('shim-status');

  function setStatus(message, level = 'info') {
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'shim-status';
      statusEl.className = 'shim-status';
      document.body.appendChild(statusEl);
    }
    statusEl.textContent = message;
    statusEl.classList.toggle('is-warning', level === 'warning');
    statusEl.classList.toggle('is-error', level === 'error');
  }

  function showVaultPickerGlow(message = 'Select the vault folder to continue...') {
    document.body.classList.add('vault-picker-glow');
    setStatus(message, 'warning');
  }

  function hideVaultPickerGlow() {
    document.body.classList.remove('vault-picker-glow');
  }

  function clearStatus() {
    if (statusEl) statusEl.remove();
    statusEl = null;
  }

  return {
    setStatus,
    showVaultPickerGlow,
    hideVaultPickerGlow,
    clearStatus,
  };
}
