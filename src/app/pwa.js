// PWA shell: installability only.
// Native notification controls were removed from the app UI.
import { $ } from '../lib/dom.js';

let deferredInstall = null;

export function installPwa() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  const top = $('.top-actions');
  if (!top) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    let b = $('#v33Install');
    if (!b) {
      b = document.createElement('button');
      b.id = 'v33Install';
      b.type = 'button';
      b.className = 'v33-app-action';
      b.textContent = 'Install app';
      top.prepend(b);
      b.addEventListener('click', async () => {
        if (!deferredInstall) return;
        deferredInstall.prompt();
        await deferredInstall.userChoice;
        deferredInstall = null;
        b.remove();
      });
    }
  });

  window.addEventListener('appinstalled', () => {
    $('#v33Install')?.remove();
    deferredInstall = null;
  });
}
