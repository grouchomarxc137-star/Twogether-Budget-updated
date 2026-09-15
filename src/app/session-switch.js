// Makes the top-bar badge clickable to swap between Principessa/Principe
// once already logged in (distinct from app/identity.js's initial "who's
// logging in" modal), plus the Dev-mode toggle button. Extracted from
// approved-v18.js.
//
// The Dev toggle is confirmed non-functional: it reads window.TwogetherDevV18,
// which no currently-loaded file defines (grep across the live file set
// found zero definitions) -- it's leftover wiring for a dev/inspector tool
// that isn't part of the shipped app. Kept anyway since removing visible
// UI is a product decision, not this migration's call; flagged here for
// a future cleanup pass.
import { $ } from '../lib/dom.js';
import { actor, otherActor } from '../lib/session.js';
import { refreshState } from '../trips/current-trips.js';

let actorObserver = null;

function syncBadge() {
  const badge = $('#loggedUserBadge'); const a = actor(); const inDev = !!window.TwogetherDevV18?.active;
  const dev = $('#twDevToggle'); if (dev) dev.hidden = !a;
  if (!badge || !a) return;
  badge.style.pointerEvents = 'auto'; badge.style.cursor = 'pointer'; badge.setAttribute('role', 'button'); badge.setAttribute('tabindex', '0');
  if (inDev) { badge.textContent = 'DEV'; badge.title = 'Leave DEV and return to ' + a; badge.setAttribute('aria-label', 'DEV mode. Return to ' + a); if (dev) dev.textContent = 'Exit DEV'; }
  else { badge.textContent = a; badge.title = 'Switch to ' + otherActor(a); badge.setAttribute('aria-label', 'Logged in as ' + a + '. Switch to ' + otherActor(a)); if (dev) dev.textContent = 'Dev'; }
}

function switchActor() {
  if (window.TwogetherDevV18?.active) { window.TwogetherDevV18.exit(); return; }
  const next = otherActor(actor()); const choice = $(`.identity-choice[data-actor="${next}"]`); if (!choice) return;
  choice.click(); setTimeout(() => { syncBadge(); refreshState(true); }, 120);
}

function ensureSessionControls() {
  const top = $('.top-actions'); if (!top) return;
  let dev = $('#twDevToggle');
  if (!dev) { dev = document.createElement('button'); dev.id = 'twDevToggle'; dev.type = 'button'; dev.className = 'tw-dev-toggle'; dev.textContent = 'Dev'; top.appendChild(dev); dev.addEventListener('click', () => { if (window.TwogetherDevV18?.active) window.TwogetherDevV18.exit(); else window.TwogetherDevV18?.enter(); }); }
  syncBadge();
}

function installSessionEvents() {
  document.addEventListener('click', (e) => { if (e.target.closest?.('#loggedUserBadge')) { e.preventDefault(); e.stopImmediatePropagation(); switchActor(); } }, true);
  document.addEventListener('keydown', (e) => { if (e.target?.id === 'loggedUserBadge' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); switchActor(); } }, true);
  if (actorObserver) actorObserver.disconnect();
  actorObserver = new MutationObserver(() => { syncBadge(); setTimeout(() => refreshState(true), 60); });
  actorObserver.observe(document.body, { attributes: true, attributeFilter: ['data-actor'] });
}

export function initSessionSwitch() {
  ensureSessionControls();
  installSessionEvents();
  document.addEventListener('twogether:dev-changed', syncBadge);
}
