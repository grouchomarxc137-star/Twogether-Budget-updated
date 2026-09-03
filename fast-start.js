(() => {
  'use strict';

  const ACTOR_KEY = 'twogether_actor_v1';
  const ACTORS = ['Principessa','Principe'];
  const API_URL = String(window.TOGETHER_BUDGET_CONFIG?.appsScriptUrl || '').trim();

  // Restore the remembered identity immediately so the page paints in the right theme
  // without waiting for the app runtime or backend.
  try {
    const saved = localStorage.getItem(ACTOR_KEY) || '';
    if (ACTORS.includes(saved)) {
      document.body.dataset.actor = saved;
      const badge = document.getElementById('loggedUserBadge');
      if (badge) {
        badge.textContent = saved;
        badge.classList.remove('hidden');
      }
      const modal = document.getElementById('identityModal');
      modal?.classList.remove('show');
      modal?.setAttribute('aria-hidden','true');
    }
  } catch {}

  // Do not let Apps Script JSONP requests keep the browser's initial reload open.
  // Queue only those script requests until the normal window load event has fired.
  const nativeAppend = document.head.appendChild.bind(document.head);
  let initialLoadDone = document.readyState === 'complete';
  const queuedBackendScripts = [];

  document.head.appendChild = function(node) {
    const src = node?.tagName === 'SCRIPT' ? String(node.src || '') : '';
    if (!initialLoadDone && API_URL && src.startsWith(API_URL)) {
      queuedBackendScripts.push(node);
      return node;
    }
    return nativeAppend(node);
  };

  function finishInitialLoad() {
    if (initialLoadDone) return;
    initialLoadDone = true;
    // Give the browser one frame to finish painting before background sync begins.
    requestAnimationFrame(() => {
      while (queuedBackendScripts.length) nativeAppend(queuedBackendScripts.shift());
    });
  }

  if (initialLoadDone) {
    queueMicrotask(() => {
      while (queuedBackendScripts.length) nativeAppend(queuedBackendScripts.shift());
    });
  } else {
    window.addEventListener('load', finishInitialLoad, {once:true});
  }

  // Crimson Pro stays the chosen font, but loading Google Fonts is now background work
  // and no longer blocks the page from finishing its reload.
  function loadFont() {
    if (document.getElementById('twogetherCrimsonFont')) return;
    const link = document.createElement('link');
    link.id = 'twogetherCrimsonFont';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;500;600;700&display=swap';
    nativeAppend(link);
  }

  if (document.readyState === 'complete') setTimeout(loadFont, 0);
  else window.addEventListener('load', () => setTimeout(loadFont, 0), {once:true});
})();
