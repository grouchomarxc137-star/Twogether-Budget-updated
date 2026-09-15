// The "who's logging in" modal + top-bar badge. Extracted from app.js.
// Dispatches 'twogether:identity-chosen' instead of directly resetting the
// wizard or kicking off a sync -- those are trips/wizard.js's concerns, and
// having this module reach into wizard internals would go the wrong
// direction (the app shell shouldn't depend on one category's internals).
import { $, $$ } from '../lib/dom.js';
import { ACTORS, ACTOR_KEY, setActor } from '../lib/session.js';

export function showIdentity() {
  const modal = $('#identityModal');
  modal?.classList.add('show');
  modal?.setAttribute('aria-hidden', 'false');
}

export function chooseIdentity(name, { persist = true } = {}) {
  if (!ACTORS.includes(name)) return;
  setActor(name, { persist });
  const badge = $('#loggedUserBadge');
  if (badge) {
    badge.textContent = name;
    badge.classList.remove('hidden');
    badge.style.pointerEvents = 'none';
    badge.style.cursor = 'default';
  }
  $('#identityModal')?.classList.remove('show');
  $('#identityModal')?.setAttribute('aria-hidden', 'true');
  document.dispatchEvent(new CustomEvent('twogether:identity-chosen', { detail: { actor: name } }));
}

export function initIdentity() {
  $$('.identity-choice[data-actor]').forEach((btn) => btn.addEventListener('click', () => chooseIdentity(btn.dataset.actor)));
  let saved = '';
  try { saved = localStorage.getItem(ACTOR_KEY) || ''; } catch {}
  if (ACTORS.includes(saved)) chooseIdentity(saved, { persist: false });
  else showIdentity();
}
