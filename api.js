// Talks to the Node/Express + SQLite backend in server/ over plain fetch().
// In dev, the frontend (Vite, :5180) and the API server (Express, :4310) run
// as two processes -- see scripts/dev.js -- so API_BASE points across origins
// and server/src/index.js's CORS config allows it. In production, server/
// serves both the built frontend and the API from one process, so API_BASE
// is empty and every request is same-origin.
const ACTORS = ['Principessa', 'Principe'];
const CACHE_KEY = 'twogether_state_cache_v2';
const API_BASE = import.meta.env?.DEV ? 'http://localhost:4310' : '';
const CLIENT_ID = globalThis.crypto?.randomUUID?.() || ('tw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
const LIVE_SAFETY_MS = 4000;

let queue = Promise.resolve();
let warmCacheUsed = false;
let lastStateStamp = String(window.__TWOGETHER_CACHED_STATE__?.updatedAt || '');
let liveSource = null;
let liveRefreshPromise = null;
let liveRefreshQueued = false;
let liveSafetyTimer = null;

function remember(state) {
  if (!state) return;
  window.__TWOGETHER_CACHED_STATE__ = state;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch {}
}

function dispatchSharedRefresh(remote = false) {
  document.dispatchEvent(new CustomEvent('twogether:saved', { detail: { remote } }));
}

async function fetchRemoteState(notify = true) {
  const previousStamp = lastStateStamp;
  const res = await fetch(`${API_BASE}/api/state`, { cache: 'no-store' });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Could not load shared data');
  const nextStamp = String(json.state?.updatedAt || '');
  remember(json.state);
  if (nextStamp) lastStateStamp = nextStamp;
  if (notify && previousStamp && nextStamp && nextStamp !== previousStamp) dispatchSharedRefresh(true);
  return json.state;
}

async function remoteState() {
  return fetchRemoteState(true);
}

async function syncFromLiveSignal() {
  if (document.visibilityState === 'hidden') return;
  if (liveRefreshPromise) {
    liveRefreshQueued = true;
    return liveRefreshPromise;
  }
  liveRefreshPromise = (async () => {
    do {
      liveRefreshQueued = false;
      await fetchRemoteState(true);
    } while (liveRefreshQueued);
  })();
  try { await liveRefreshPromise; } finally { liveRefreshPromise = null; }
}

function startLiveSync() {
  if (liveSafetyTimer) return;
  if ('EventSource' in window) {
    try {
      liveSource = new EventSource(`${API_BASE}/api/events?client=${encodeURIComponent(CLIENT_ID)}`);
      liveSource.addEventListener('state', () => { syncFromLiveSignal().catch(() => {}); });
    } catch {}
  }
  liveSafetyTimer = setInterval(() => {
    if (document.visibilityState !== 'hidden') syncFromLiveSignal().catch(() => {});
  }, LIVE_SAFETY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncFromLiveSignal().catch(() => {});
  });
}

async function state() {
  const cached = window.__TWOGETHER_CACHED_STATE__;
  if (!warmCacheUsed && cached) {
    warmCacheUsed = true;
    setTimeout(() => remoteState().catch(() => {}), 0);
    return cached;
  }
  return remoteState();
}

async function send(action, payload, actor) {
  if (!ACTORS.includes(actor)) throw new Error('Choose your profile first');
  const devMaintenance = ['saveFinanceProfile', 'updateSharedJarBalance'];
  if (document.body.classList.contains('dev-playground') && !devMaintenance.includes(action)) {
    throw new Error('Leave DEV to save normal shared trip or finance changes. DEV only permits explicit maintenance deletes.');
  }
  const res = await fetch(`${API_BASE}/api/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, actor, payload: payload || {}, clientId: CLIENT_ID }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Could not save the change');
  await fetchRemoteState(false);
  dispatchSharedRefresh(false);
  return json;
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

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startLiveSync, { once: true });
else startLiveSync();
