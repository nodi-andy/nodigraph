// Installable-app plumbing: registers the service worker (sw.js at the site
// root, so its scope is the whole app) and, when the installed app was
// launched by opening a .yaml/.json file (manifest.webmanifest's
// file_handlers), hands that file to the same path the Import menu uses.
//
// Both are no-ops where the browser doesn't support them, and neither is
// awaited by bootstrap — a missing service worker must never block the
// editor from coming up.

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // file:// and other non-http origins can't register a worker.
  if (!/^https?:$/.test(window.location.protocol)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('nodigraph: service worker not registered:', err);
    });
  });
}

export function consumeLaunchFiles(onFile) {
  if (!('launchQueue' in window) || typeof window.launchQueue.setConsumer !== 'function') return;
  window.launchQueue.setConsumer(async (launchParams) => {
    if (!launchParams.files || launchParams.files.length === 0) return;
    try {
      const file = await launchParams.files[0].getFile();
      await onFile(file);
    } catch (err) {
      console.warn('nodigraph: could not open launched file:', err);
    }
  });
}
