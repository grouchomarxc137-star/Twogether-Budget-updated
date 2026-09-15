// Shared state core for the Shared Jar, Monthly Planner and Trip Prep --
// its own independent remoteState() fetch, kept separate from trips/state.js,
// budget-state.js and shop/state.js rather than merged (an existing pattern
// in this app: each patch-chain keeps its own copy of shared server state).
// Extracted from v33.js.
import { actor } from '../lib/session.js';
import { toast } from '../lib/toast.js';

let appState = null;

export async function freshState() {
  try {
    appState = await window.TwogetherAPI.remoteState();
    return appState;
  } catch (e) {
    toast(e.message || 'Could not load shared data', 'warn');
    return appState;
  }
}

export function currentState() {
  return appState || window.__TWOGETHER_CACHED_STATE__ || null;
}

export function planById(id) {
  return currentState()?.plans?.find((p) => p.id === id) || null;
}

export function financeRecord(month) {
  return currentState()?.finances?.[actor()]?.find((r) => r.month === month) || null;
}

export function profile() {
  return currentState()?.financeProfiles?.[actor()] || {};
}
