(() => {
  'use strict';

  const ACTOR_KEY = 'twogether_actor_v1';
  const CACHE_KEY = 'twogether_state_cache_v1';
  const ACTORS = ['Principessa','Principe'];
  const API_URL = String(window.TOGETHER_BUDGET_CONFIG?.appsScriptUrl || '').trim();
  const app = document.getElementById('app');

  if (app) {
    app.style.visibility = 'hidden';
    app.style.opacity = '0';
  }

  let cachedState = null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    cachedState = raw ? JSON.parse(raw) : null;
    if (cachedState) window.__TWOGETHER_CACHED_STATE__ = cachedState;
  } catch {}

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

  const nativeAppend = document.head.appendChild.bind(document.head);
  let initialLoadDone = document.readyState === 'complete';
  const queuedBackendScripts = [];

  function callbackName(src) {
    try { return new URL(src).searchParams.get('callback') || ''; }
    catch { return ''; }
  }

  function rememberResponse(data) {
    if (!data?.ok || !data.state) return;
    cachedState = data.state;
    window.__TWOGETHER_CACHED_STATE__ = data.state;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data.state)); } catch {}
  }

  function wrapCallback(name) {
    if (!name || typeof window[name] !== 'function' || window[name].__twogetherWrapped) return;
    const original = window[name];
    const wrapped = data => {
      rememberResponse(data);
      return original(data);
    };
    wrapped.__twogetherWrapped = true;
    window[name] = wrapped;
  }

  document.head.appendChild = function(node) {
    const src = node?.tagName === 'SCRIPT' ? String(node.src || '') : '';
    if (API_URL && src.startsWith(API_URL)) {
      const cb = callbackName(src);
      wrapCallback(cb);

      if (!initialLoadDone && cachedState && cb && typeof window[cb] === 'function') {
        queueMicrotask(() => {
          if (typeof window[cb] === 'function') window[cb]({ok:true,state:cachedState});
        });
        return node;
      }

      if (!initialLoadDone) {
        queuedBackendScripts.push(node);
        return node;
      }
    }
    return nativeAppend(node);
  };

  function releaseQueuedRequests() {
    while (queuedBackendScripts.length) {
      const node = queuedBackendScripts.shift();
      const cb = callbackName(String(node.src || ''));
      wrapCallback(cb);
      nativeAppend(node);
    }
  }

  function revealApp() {
    if (!app) return;
    app.style.transition = 'opacity .12s ease';
    app.style.visibility = 'visible';
    app.style.opacity = '1';
  }

  function finishInitialLoad() {
    if (initialLoadDone) return;
    initialLoadDone = true;
    requestAnimationFrame(() => {
      releaseQueuedRequests();
      setTimeout(revealApp, 0);
    });
  }

  if (initialLoadDone) {
    queueMicrotask(() => {
      releaseQueuedRequests();
      revealApp();
    });
  } else {
    window.addEventListener('load', finishInitialLoad, {once:true});
    window.addEventListener('DOMContentLoaded', () => setTimeout(revealApp, 0), {once:true});
  }

  function loadFont() {
    if (document.getElementById('twogetherCrimsonFont')) return;
    const link = document.createElement('link');
    link.id = 'twogetherCrimsonFont';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;500;600;700&display=swap';
    nativeAppend(link);
  }

  if (document.readyState === 'complete') {
    setTimeout(loadFont, 0);

  } else {
    window.addEventListener('load', () => setTimeout(loadFont, 0), {once:true});

  }
})();

