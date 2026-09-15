// The shared state core that Shop, Wishlist, Compare Lab and Social Signals
// all read/write. Extracted from v27.js, where all four features lived in
// one closure and reached into the same `sharedState`/`gameState` variables
// directly. Since those variables can no longer be shared via a JS closure
// once split into separate files, this module owns them and exposes
// accessors -- every other migrated module imports from here instead of
// keeping its own copy (the original problem: 6+ files each re-fetching
// their own copy of the same server state, with no guarantee they'd agree).
//
// award() used to call renderShop()/renderWishlist() directly, but those
// now live in separate modules that import THIS one -- calling them here
// would be a circular import. It dispatches a 'twogether:shop-award' DOM
// event instead, which shop.js and wishlist.js each listen for. This
// mirrors the 'twogether:saved' / 'twogether:v18-rendered' event pattern
// already used elsewhere in the app.
import { n } from '../lib/format.js';
import { actor, otherActor } from '../lib/session.js';
import { toast } from '../lib/toast.js';

const ACTORS = ['Principessa', 'Principe'];
const TEST_KEY = 'twogether_v27_test_principessa';

let sharedState = null;
let gameState = null;
let lastFetch = 0;
let refreshPending = null;

export const fmt = (v) => n(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function profile(name = actor()) {
  const g = gameState || sharedState?.game || {};
  return g?.[name] || { lovis: 0, twos: 0, purchases: [], theme: 'default', awards: {}, packing: {} };
}

export function financeProfile(name = actor()) {
  return sharedState?.financeProfiles?.[name] || {};
}

export function testState() {
  if (actor() !== 'Principessa') return { active: false, lovis: 0, twos: 0, unlocked: [], wishlistBought: [] };
  try {
    const t = JSON.parse(sessionStorage.getItem(TEST_KEY) || '{}');
    return {
      active: !!t.active, lovis: n(t.lovis), twos: n(t.twos),
      unlocked: Array.isArray(t.unlocked) ? t.unlocked : [],
      wishlistBought: Array.isArray(t.wishlistBought) ? t.wishlistBought : [],
    };
  } catch {
    return { active: false, lovis: 0, twos: 0, unlocked: [], wishlistBought: [] };
  }
}

export function saveTest(t) {
  if (actor() === 'Principessa') sessionStorage.setItem(TEST_KEY, JSON.stringify(t));
}

export function effective() {
  const p = profile(), t = testState();
  return {
    lovis: n(p.lovis) + (t.active ? t.lovis : 0),
    twos: n(p.twos) + (t.active ? t.twos : 0),
    purchases: [...new Set([...(p.purchases || []), ...(t.active ? t.unlocked : [])])],
    theme: p.theme || 'default',
    test: t,
  };
}

export function has(id) {
  return effective().purchases.includes(id);
}

export async function refresh(force = false) {
  if (refreshPending) return refreshPending;
  if (!force && sharedState && Date.now() - lastFetch < 12000) return sharedState;
  refreshPending = (async () => {
    try {
      sharedState = await (force ? window.TwogetherAPI.remoteState() : window.TwogetherAPI.state());
      gameState = sharedState?.game || gameState;
      lastFetch = Date.now();
      document.dispatchEvent(new CustomEvent('twogether:shop-refreshed'));
      return sharedState;
    } catch {
      return sharedState;
    }
  })();
  try { return await refreshPending; } finally { refreshPending = null; }
}

export async function post(action, payload = {}) {
  const r = await window.TwogetherAPI.post(action, payload, actor());
  if (r?.game) gameState = r.game;
  return r;
}

export async function award(kind, key, quiet = false) {
  try {
    const r = await post('shopAward', { kind, key });
    if (r?.awarded && !quiet) toast(`+${r.awarded} Lovis`);
    document.dispatchEvent(new CustomEvent('twogether:shop-award'));
    return r;
  } catch (e) {
    console.warn('Lovis reward:', e);
    return null;
  }
}

export function currentPlans() {
  const trips = sharedState?.trips || [];
  const map = new Map(trips.map((t) => [t.id, t]));
  return (sharedState?.plans || []).filter((p) => {
    const t = map.get(p.linkedTripId);
    return !(t?.confirmed?.Principessa && t?.confirmed?.Principe);
  });
}

export function nextTrip() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return currentPlans()
    .map((p) => ({ p, d: new Date((p.meta?.start || '') + 'T00:00:00') }))
    .filter((x) => !Number.isNaN(+x.d) && x.d >= today)
    .sort((a, b) => a.d - b.d)[0];
}

export function confirmedTrips() {
  return (sharedState?.trips || []).filter((t) => t?.confirmed?.Principessa && t?.confirmed?.Principe);
}

export function currentGame() {
  return gameState || sharedState?.game;
}

// Called when the logged-in actor changes, so the next refresh() doesn't
// serve a stale cached copy of the other person's data.
export function resetAndRefresh() {
  sharedState = null;
  gameState = null;
  lastFetch = 0;
  return refresh(true);
}

export function setCompareLab(lab) {
  if (!sharedState) return;
  sharedState.financeProfiles = sharedState.financeProfiles || {};
  sharedState.financeProfiles[actor()] = { ...financeProfile(), compareLab: lab };
}

export function ensureModal() {
  let m = document.querySelector('#v27Modal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'v27Modal';
  m.className = 'v27-modal';
  m.hidden = true;
  m.innerHTML = '<div class="v27-modal-backdrop" data-v27-close></div><section class="v27-modal-card" role="dialog" aria-modal="true" aria-label="Twogether"><button aria-label="Close dialog" data-v27-close class="v27-modal-close">×</button><div id="v27ModalBody"></div></section>';
  document.body.appendChild(m);
  m.addEventListener('click', (e) => { if (e.target.closest('[data-v27-close]')) m.hidden = true; });
  m.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); m.hidden = true; return; }
    if (e.key === 'Tab') {
      const nodes = [...m.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea,select,a[href]')].filter((x) => x.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  });
  return m;
}

function stableMeta(m = {}) {
  return [m.location || '', m.otherLocation || '', m.city || '', m.start || '', m.end || '']
    .map((v) => String(v).trim().toLowerCase()).join('|');
}

function logKey(action, payload = {}, result = {}, a = '') {
  if (action === 'savePlan') return `plan:${result.planId || stableMeta(payload.meta)}`;
  if (action === 'savePlanPartial' || action === 'savePlanSubmission') return `trip-log:${payload.planId || result.planId || ''}:${a}`;
  if (action === 'saveSubmission') return `trip-log:${payload.tripId || result.tripId || stableMeta(payload.submission || {})}:${a}`;
  if (action === 'saveSharedExpense') return `shared-log:${payload.planId || ''}:${payload.key || ''}:${a}`;
  if (action === 'saveFinanceMonth' && payload.monthData?.finalized !== true) return `finance:${a}:${payload.monthData?.month || ''}`;
  return '';
}

function expenseKeys(action, payload = {}, result = {}, a = '') {
  const keys = ['travel', 'accom', 'fuel', 'groceries', 'eat', 'tolls', 'other'], out = [];
  const add = (id, k, v) => { if (Number(String(v ?? '').replace(',', '.')) > 0) out.push(`${id}:${k}:${a}`); };
  if (action === 'saveSharedExpense') add(payload.planId || result.planId || '', payload.key, payload.total !== '' ? payload.total : payload.paid);
  if (action === 'savePlanPartial') { const id = payload.planId || result.planId || ''; keys.forEach((k) => payload.partial?.[k] !== undefined && add(id, k, payload.partial[k])); }
  if (action === 'savePlanSubmission') { const id = payload.planId || result.planId || result.tripId || ''; keys.forEach((k) => add(id, k, payload.submission?.[k])); }
  if (action === 'saveSubmission') { const id = payload.tripId || result.tripId || stableMeta(payload.submission || {}); keys.forEach((k) => add(id, k, payload.submission?.[k])); }
  return [...new Set(out)];
}

let wrapped = false;
export function wrapApi() {
  if (wrapped || !window.TwogetherAPI?.post) return;
  wrapped = true;
  const original = window.TwogetherAPI.post.bind(window.TwogetherAPI);
  window.TwogetherAPI.post = async (action, payload = {}, usedActor) => {
    const a = ACTORS.includes(usedActor) ? usedActor : actor();
    const result = await original(action, payload, usedActor);
    try {
      if (!String(action).startsWith('shop') && !['wishlistCheckout', 'saveCompareLab'].includes(action)) {
        const lk = logKey(action, payload, result, a);
        if (lk) await award('log', lk, true);
        for (const k of expenseKeys(action, payload, result, a)) await award('expense', k, true);
        if (action === 'confirmTrip') {
          const id = String(payload.id || result.tripId || '');
          if (id) await award('tripConfirm', `trip:${a}:${id}`, true);
          if (result.twosDelta) toast(`${result.twosDelta > 0 ? '+' : ''}${fmt(result.twosDelta)} Twos from this trip`);
        }
        if (action === 'saveFinanceMonth' && payload?.monthData?.finalized === true) {
          const m = String(payload.monthData.month || '');
          if (m) await award('financeConfirm', `month:${a}:${m}`, true);
          if (result.twosDelta) toast(`${result.twosDelta > 0 ? '+' : ''}${fmt(result.twosDelta)} Twos from ${m}`);
        }
      }
    } catch (e) {
      console.warn('shop rewards', e);
    }
    setTimeout(() => refresh(true), 120);
    return result;
  };
}

export { otherActor };
