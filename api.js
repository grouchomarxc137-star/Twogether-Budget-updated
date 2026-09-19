// Talks to the Node/Express + SQLite backend in server/ over plain fetch().
// In dev, the frontend (Vite, :5180) and the API server (Express, :4310) run
// as two processes -- see scripts/dev.js -- so API_BASE points across origins
// and server/src/index.js's CORS config allows it. In production, server/
// serves both the built frontend and the API from one process, so API_BASE
// is empty and every request is same-origin.
const ACTORS = ['Principessa', 'Principe'];
const CACHE_KEY = 'twogether_state_cache_v2';
const API_BASE = import.meta.env?.DEV ? 'http://localhost:4310' : '';

let queue = Promise.resolve();
let warmCacheUsed = false;

function remember(state) {
  if (!state) return;
  window.__TWOGETHER_CACHED_STATE__ = state;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch {}
}

async function remoteState() {
  const res = await fetch(`${API_BASE}/api/state`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Could not load shared data');
  remember(json.state);
  return json.state;
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
    body: JSON.stringify({ action, actor, payload: payload || {} }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Could not save the change');
  await remoteState();
  document.dispatchEvent(new CustomEvent('twogether:saved'));
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
