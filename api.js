(() => {
  'use strict';

  const baseUrl = String(window.TOGETHER_BUDGET_CONFIG?.backendUrl || '').replace(/\/$/, '');
  const CACHE_KEY = 'twogether_state_cache_v2';
  let queue = Promise.resolve();
  let warmCacheUsed = false;

  function remember(state) {
    if (!state) return;
    window.__TWOGETHER_CACHED_STATE__ = state;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch {}
  }

  async function request(path, options = {}, timeout = 15000) {
    if (!baseUrl) throw new Error('Backend URL missing');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(3000, Number(timeout) || 15000));
    try {
      const response = await fetch(baseUrl + path, { ...options, signal: controller.signal, cache: 'no-store' });
      const json = await response.json();
      if (!json?.ok) throw new Error(json?.error || 'Sync failed');
      return json;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Could not reach the shared data. Please retry.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function remoteState(options = {}) {
    const result = await request('/api/state', {}, options.timeout);
    remember(result.state);
    return result.state;
  }

  function state() {
    const cached = window.__TWOGETHER_CACHED_STATE__;
    if (!warmCacheUsed && cached) {
      warmCacheUsed = true;
      setTimeout(() => remoteState().catch(() => {}), 0);
      return Promise.resolve(cached);
    }
    return remoteState();
  }

  async function send(action, payload, actor) {
    if (!['Principessa', 'Principe'].includes(actor)) throw new Error('Choose your profile first');
    const devMaintenance = ['saveFinanceProfile'];
    if (document.body.classList.contains('dev-playground') && !devMaintenance.includes(action)) {
      throw new Error('Leave DEV to save normal shared trip or finance changes. DEV only permits explicit maintenance deletes.');
    }

    const result = await request('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, actor, payload: payload || {} }),
    }, 30000);
    document.dispatchEvent(new CustomEvent('twogether:saved'));
    return result;
  }

  window.TwogetherAPI = {
    state,
    remoteState,
    post(action, payload, actor) {
      const result = queue.then(() => send(action, payload, actor));
      queue = result.catch(() => {});
      return result;
    },
  };
})();
