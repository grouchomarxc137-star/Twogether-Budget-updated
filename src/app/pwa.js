// PWA shell: installability and native notification permission only; no
// third-party push service. Extracted from v33.js -- this piece was genuinely
// self-contained (only touches .top-actions/#toast, no shared v27/v33 state).
import { $ } from '../lib/dom.js';

let deferredInstall = null;

function syncNotificationButton() {
  const b = $('#v33Notify');
  if (!b) return;
  const p = Notification.permission;
  b.textContent = p === 'granted' ? 'Notifications on' : p === 'denied' ? 'Notifications blocked' : 'Enable notifications';
  b.classList.toggle('is-on', p === 'granted');
}

export function installPwa() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  const top = $('.top-actions');
  if (!top) return;

  let notify = $('#v33Notify');
  if (!notify && 'Notification' in window) {
    notify = document.createElement('button');
    notify.id = 'v33Notify';
    notify.type = 'button';
    notify.className = 'v33-app-action';
    top.prepend(notify);
    syncNotificationButton();
    notify.addEventListener('click', async () => {
      if (Notification.permission === 'default') await Notification.requestPermission();
      syncNotificationButton();
    });
  }

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
