// The trips/plans state fetch that trips/wizard.js and trips/overview.js
// both read from. Extracted from app.js. Note: this is a separate polling
// loop from workflow.js's own sharedState fetch and shop/state.js's --
// three different modules independently poll the same backend endpoint.
// Preserved as-is for this migration (each ported faithfully, not merged)
// rather than expanding scope further; worth a future cleanup pass.
import { DEFAULT_COMPARE } from './data.js';

const CONFIG = window.TOGETHER_BUDGET_CONFIG || {};
const API_URL = String(CONFIG.appsScriptUrl || '').trim();
export const SYNC_MS = 3500;

let state = normalizeState({});
let backendV3 = false;
let syncBusy = false;
let syncTimer = null;
let lastServerStamp = '';

export function getState() {
  return state;
}

export function isBackendV3() {
  return backendV3;
}

export function normalizeState(s) {
  return {
    version: Number(s?.version || 1),
    trips: Array.isArray(s?.trips) ? s.trips.map((t) => ({
      ...t,
      submissions: { Principessa: t?.submissions?.Principessa || null, Principe: t?.submissions?.Principe || null },
      confirmed: { Principessa: !!t?.confirmed?.Principessa, Principe: !!t?.confirmed?.Principe },
      budget: t?.budget ?? '',
    })) : [],
    compare: { ...DEFAULT_COMPARE, ...(s?.compare || {}) },
    audit: Array.isArray(s?.audit) ? s.audit.slice(-2) : [],
    updatedAt: s?.updatedAt || '',
  };
}

function jsonp(params = {}) {
  return new Promise((resolve, reject) => {
    if (!API_URL) return reject(new Error('Backend URL missing'));
    const cb = '__twogether_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    const timer = setTimeout(() => done(new Error('Sync timed out')), 12000);
    function done(err, data) {
      clearTimeout(timer);
      try { delete window[cb]; } catch {}
      script.remove();
      err ? reject(err) : resolve(data);
    }
    window[cb] = (data) => done(null, data);
    const q = new URLSearchParams({ ...params, callback: cb, _: Date.now().toString() });
    script.src = API_URL + (API_URL.includes('?') ? '&' : '?') + q.toString();
    script.onerror = () => done(new Error('Could not reach Apps Script'));
    document.head.appendChild(script);
  });
}

export async function postAction(action, payload, actor) {
  const result = await window.TwogetherAPI.post(action, payload, actor);
  await syncNow(true);
  return result;
}

export async function syncNow(showErrors = false) {
  if (!API_URL || syncBusy) return;
  syncBusy = true;
  try {
    const res = await jsonp({ action: 'state' });
    if (!res?.ok) throw new Error(res?.error || 'Sync failed');
    const next = normalizeState(res.state);
    const stamp = next.updatedAt || JSON.stringify({ trips: next.trips, compare: next.compare, audit: next.audit });
    backendV3 = next.version >= 3;
    const notice = document.querySelector('#backendUpgrade');
    if (notice) {
      notice.classList.toggle('hidden', backendV3);
      if (!backendV3) {
        notice.innerHTML = '<strong>Backend update needed.</strong><span>Redeploy the latest <code>backend/Code.gs</code> to enable editing/confirmation and trip budgets.</span>';
      }
    }

    if (stamp !== lastServerStamp) {
      state = next;
      lastServerStamp = stamp;
      document.dispatchEvent(new CustomEvent('twogether:trips-refreshed'));
    }
  } catch (err) {
    if (showErrors) document.dispatchEvent(new CustomEvent('twogether:trips-sync-error', { detail: { message: err.message || 'Could not sync' } }));
  } finally {
    syncBusy = false;
  }
}

export function startSyncLoop() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => syncNow(false), SYNC_MS);
}
