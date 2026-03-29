export function createScriptLoader() {
  const loadedScripts = new Set();

  function appendScript(src) {
    return new Promise((resolve, reject) => {
      if (loadedScripts.has(src)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = () => {
        loadedScripts.add(src);
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(script);
    });
  }

  async function loadScriptQueue(queue, label, setStatus) {
    for (const src of queue) {
      setStatus(`${label} ${src}...`);
      await appendScript(src);
    }
  }

  return {
    appendScript,
    loadScriptQueue,
  };
}
