// Single state source for the redesigned Trips. One refresh loop (every 20 s
// while the Trips screen is visible, plus on focus and after every save)
// instead of several independent pollers.
import { cleanTrip } from '../../shared/trips-model.js';
import { actor } from '../lib/session.js';

const REFRESH_MS = 20000;
let snapshot = null;
let loading = null;
let loadError = '';
const listeners = new Set();

function emit() { listeners.forEach((fn) => fn()); }

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Only the parts the Trips screens show. A background refresh that brings
// no change must not re-render (a re-render mid-tap can swallow the tap).
function signature(state) {
  return JSON.stringify([state?.tripLedger || [], state?.sharedJar?.availableCents ?? null]);
}
let lastSignature = '';

function adopt(state) {
  const hadError = !!loadError;
  if (state && typeof state === 'object') snapshot = state;
  loadError = '';
  const next = signature(snapshot);
  if (next === lastSignature && !hadError) return;
  lastSignature = next;
  emit();
}

export async function refresh() {
  if (!window.TwogetherAPI) return;
  if (loading) return loading;
  loading = (async () => {
    try { adopt(await window.TwogetherAPI.remoteState()); }
    catch (error) { loadError = error?.message || 'Could not load trips'; emit(); }
    finally { loading = null; }
  })();
  return loading;
}

export function ready() { return !!snapshot; }
export function error() { return loadError; }

export function trips() {
  return (snapshot?.tripLedger || []).map(cleanTrip).filter((t) => t.id && !t.deletedAt);
}

export function tripById(id) {
  return trips().find((t) => t.id === id) || null;
}

// What the Shared Jar has available, in whole cents, as worked out by the
// server (never derived here from the euro display balance).
export function jarAvailableCents() {
  const cents = snapshot?.sharedJar?.availableCents;
  return Number.isInteger(cents) ? cents : 0;
}

// Places used before, for one-tap suggestions when creating a trip.
export function pastPlaces() {
  const names = [
    ...trips().map((t) => t.place.city),
    ...(snapshot?.plans || []).map((p) => p?.meta?.city),
  ].map((x) => String(x || '').trim()).filter(Boolean);
  return [...new Set(names)].slice(0, 4);
}

// Runs a trip action. api.js already re-reads the shared state after a
// successful save and keeps it in window.__TWOGETHER_CACHED_STATE__.
export async function act(action, payload) {
  const result = await window.TwogetherAPI.post(action, payload, actor());
  adopt(window.__TWOGETHER_CACHED_STATE__ || snapshot);
  return result;
}

let started = false;
export function start(isVisible) {
  if (started) return;
  started = true;
  if (window.__TWOGETHER_CACHED_STATE__) adopt(window.__TWOGETHER_CACHED_STATE__);
  refresh();
  setInterval(() => { if (!document.hidden && isVisible()) refresh(); }, REFRESH_MS);
  window.addEventListener('focus', () => { if (isVisible()) refresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && isVisible()) refresh(); });
  document.addEventListener('twogether:identity-chosen', emit);
  // Any save anywhere in the app already re-reads the shared state.
  document.addEventListener('twogether:saved', () => adopt(window.__TWOGETHER_CACHED_STATE__ || snapshot));
}
