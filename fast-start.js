(() => {
  'use strict';

  const ACTOR_KEY = 'twogether_actor_v1';
  const CACHE_KEY = 'twogether_state_cache_v2';
  const ACTORS = ['Principessa', 'Principe'];
  const app = document.getElementById('app');

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

  function revealApp() {
    if (!app || document.body.dataset.authenticated !== 'true') return;
    app.style.transition = 'opacity .12s ease';
    app.style.visibility = 'visible';
    app.style.opacity = '1';
  }

  function loadFont() {
    if (document.getElementById('twogetherCrimsonFont')) return;
    const link = document.createElement('link');
    link.id = 'twogetherCrimsonFont';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => requestAnimationFrame(revealApp), { once: true });
    window.addEventListener('load', () => setTimeout(loadFont, 0), { once: true });
  } else {
    requestAnimationFrame(revealApp);
    setTimeout(loadFont, 0);
  }
})();
