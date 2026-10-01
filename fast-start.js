(() => {
  'use strict';

  const ACTOR_KEY = 'twogether_actor_v1';
  const CACHE_KEY = 'twogether_state_cache_v2';
  const ACTORS = ['Principessa', 'Principe'];
  const app = document.getElementById('app');
  let revealed = false;

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const cachedState = raw ? JSON.parse(raw) : null;
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
      modal?.setAttribute('aria-hidden', 'true');
    }
  } catch {}

  function loadFont() {
    const existing = document.getElementById('twogetherCrimsonFont');
    if (existing) return Promise.resolve();
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.id = 'twogetherCrimsonFont';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;500;600;700&display=swap';
      link.onload = resolve;
      link.onerror = resolve;
      document.head.appendChild(link);
    });
  }

  const fontReady = loadFont()
    .then(() => document.fonts?.ready || undefined)
    .catch(() => undefined);

  function revealApp() {
    if (!app || revealed) return;
    revealed = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => app.classList.remove('tw-starting'));
    });
  }

  function revealStable() {
    Promise.race([
      fontReady,
      new Promise((resolve) => setTimeout(resolve, 350)),
    ]).finally(revealApp);
  }

  document.addEventListener('twogether:startup-ready', revealStable, { once: true });

  // Never leave the app hidden if a network request or third-party asset stalls.
  window.addEventListener('load', () => setTimeout(revealStable, 850), { once: true });
  setTimeout(revealStable, 1400);
})();