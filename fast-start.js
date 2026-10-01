(() => {
  'use strict';

  const ACTOR_KEY = 'twogether_actor_v1';
  const CACHE_KEY = 'twogether_state_cache_v2';
  const ACTORS = ['Principessa', 'Principe'];
  const app = document.getElementById('app');
  const splash = document.getElementById('twStartupSplash');
  const startedAt = performance.now();
  const MIN_SPLASH_MS = 470;
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
    if (document.getElementById('twogetherCrimsonFont')) return;
    const link = document.createElement('link');
    link.id = 'twogetherCrimsonFont';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }

  function finishReveal() {
    if (!app || revealed) return;
    revealed = true;
    requestAnimationFrame(() => {
      app.classList.remove('tw-starting');
      splash?.classList.add('is-leaving');
      setTimeout(() => splash?.remove(), 420);
    });
  }

  function revealApp() {
    if (revealed) return;
    const remaining = Math.max(0, MIN_SPLASH_MS - (performance.now() - startedAt));
    if (remaining > 0) setTimeout(finishReveal, remaining);
    else finishReveal();
  }

  loadFont();
  document.addEventListener('twogether:startup-ready', revealApp, { once: true });

  // Keep the opening polished even if data or an external image stalls.
  window.addEventListener('load', () => setTimeout(revealApp, 520), { once: true });
  setTimeout(revealApp, 1150);
})();