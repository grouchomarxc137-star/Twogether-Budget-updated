// Consolidates the shared-state sync/save client. Ported verbatim from the
// original api.js (the only one of the three duplicate JSONP implementations
// that also handles caching, timeout recovery, actor validation, the
// dev-playground guard and backend version gating — app.js's and
// workflow.js's own `jsonp()` copies were simpler, incomplete duplicates of
// this one and are dropped in favor of this single client).

const url = String(window.TOGETHER_BUDGET_CONFIG?.appsScriptUrl || '');
const CACHE_KEY = 'twogether_state_cache_v1';
const REQUIRED_BACKEND_VERSION = 18;

let queue = Promise.resolve();
let warmCacheUsed = false;
let knownVersion = 0;

function remember(state) {
  if (!state) return;
  knownVersion = Number(state.version) || knownVersion;
  window.__TWOGETHER_CACHED_STATE__ = state;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch {}
}

export function remoteState(options = {}) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error('Backend URL missing'));
    const timeout = Math.max(3000, Number(options.timeout) || 15000);
    const cb = '__tw_api_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let settled = false;
    const timer = setTimeout(() => done(new Error('Could not reach the shared data. Please retry.')), timeout);
    function done(err, data) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { delete window[cb]; } catch {}
      script.remove();
      if (err) return reject(err);
      remember(data);
      resolve(data);
    }
    window[cb] = (r) => r?.ok ? done(null, r.state) : done(new Error(r?.error || 'Sync failed'));
    script.onerror = () => done(new Error('Could not reach the shared data.'));
    script.src = url + '?action=state&callback=' + cb + '&_=' + Date.now();
    document.head.appendChild(script);
  });
}

export function state() {
  const cached = window.__TWOGETHER_CACHED_STATE__;
  if (!warmCacheUsed && cached) {
    warmCacheUsed = true;
    knownVersion = Number(cached.version) || knownVersion;
    setTimeout(() => remoteState().catch(() => {}), 0);
    return Promise.resolve(cached);
  }
  return remoteState();
}

function sameMoney(a, b) {
  if (a === '' || a == null || b === '' || b == null) return String(a ?? '') === String(b ?? '');
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 0.005;
}

function recoverPlanSave(action, payload, actor, current) {
  if (action !== 'savePlan' || !current) return null;
  const plans = Array.isArray(current.plans) ? current.plans : [];
  const id = String(payload?.id || '').trim();
  let plan = id ? plans.find((p) => p?.id === id) : null;
  if (!plan) {
    const meta = payload?.meta || {};
    const cutoff = Date.now() - 120000;
    plan = [...plans].reverse().find((p) => {
      const pm = p?.meta || {};
      const stamped = Date.parse(p?.updatedAt || p?.createdAt || '');
      return p?.createdBy === actor && (!Number.isFinite(stamped) || stamped >= cutoff) &&
        String(pm.location || '') === String(meta.location || '') &&
        String(pm.otherLocation || '') === String(meta.otherLocation || '') &&
        String(pm.city || '') === String(meta.city || '') &&
        String(pm.start || '') === String(meta.start || '') &&
        String(pm.end || '') === String(meta.end || '');
    }) || null;
  }
  if (!plan) return null;
  if (payload?.budget !== undefined && !sameMoney(plan?.budgets?.[actor], payload.budget)) return null;
  return { ok: true, planId: plan.id, recovered: true };
}

async function recoverTimedOutSave(action, payload, actor) {
  try {
    const current = await remoteState({ timeout: 12000 });
    return recoverPlanSave(action, payload, actor, current);
  } catch {
    return null;
  }
}

async function send(action, payload, actor) {
  if (!['Principessa', 'Principe'].includes(actor)) throw Error('Choose your profile first');
  const devMaintenance = ['deleteTrip', 'deleteFinanceMonth', 'saveFinanceProfile'];
  if (document.body.classList.contains('dev-playground') && !devMaintenance.includes(action)) {
    throw Error('Leave DEV to save normal shared trip or finance changes. DEV only permits explicit maintenance deletes.');
  }

  const cachedVersion = Number(window.__TWOGETHER_CACHED_STATE__?.version || knownVersion || 0);
  if (cachedVersion && cachedVersion < REQUIRED_BACKEND_VERSION) {
    throw Error('Apps Script update required: deploy backend/Code.gs (v18) before saving.');
  }

  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const frame = document.createElement('iframe');
    const form = document.createElement('form');
    let settled = false, recovering = false;
    frame.name = 'tw_save_' + requestId;
    frame.hidden = true;
    frame.title = 'Saving shared data';
    document.body.appendChild(frame);

    const cleanup = () => { window.removeEventListener('message', receive); frame.remove(); form.remove(); };
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      err ? reject(err) : resolve(result);
    };
    const timer = setTimeout(async () => {
      if (settled || recovering) return;
      recovering = true;
      window.removeEventListener('message', receive);
      const recovered = await recoverTimedOutSave(action, payload || {}, actor);
      if (recovered) {
        document.dispatchEvent(new CustomEvent('twogether:saved'));
        return finish(null, recovered);
      }
      finish(new Error('Save confirmation timed out. Nothing was confirmed as saved, so please retry once.'));
    }, 30000);

    function receive(e) {
      if (settled || recovering) return;
      let host;
      try { host = new URL(e.origin).hostname; } catch { return; }
      if (!(host === 'script.google.com' || host === 'script.googleusercontent.com' ||
        host.endsWith('.script.googleusercontent.com') || host.endsWith('-script.googleusercontent.com'))) return;
      if (e.data?.type !== 'twogether:saved' || e.data.requestId !== requestId) return;
      if (!e.data.result?.ok) {
        const message = e.data.result?.error || 'Save failed';
        if (/unknown action/i.test(message) && (!cachedVersion || cachedVersion < REQUIRED_BACKEND_VERSION)) {
          return finish(new Error('Apps Script update required: deploy the latest backend/Code.gs before saving.'));
        }
        return finish(new Error(message));
      }
      document.dispatchEvent(new CustomEvent('twogether:saved'));
      finish(null, e.data.result);
    }
    window.addEventListener('message', receive);
    form.method = 'POST';
    form.action = url;
    form.target = frame.name;
    form.hidden = true;
    for (const [key, value] of Object.entries({ action, actor, requestId, payload: JSON.stringify(payload || {}) })) {
      const input = document.createElement('input');
      input.name = key;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  });
}

export function post(action, payload, actor) {
  const result = queue.then(() => send(action, payload, actor));
  queue = result.catch(() => {});
  return result;
}

// Legacy bridge: files not yet migrated to ES modules still call
// window.TwogetherAPI.* directly. Keep this until every consumer imports
// from lib/api.js instead.
window.TwogetherAPI = { state, remoteState, post };
