// Boots the Shared Jar, Monthly Planner and Trip Prep together -- the
// migrated replacement for v33.js. Loaded at v33.js's old script position.
import { $ } from '../lib/dom.js';
import { freshState } from './planner-state.js';
import { renderSharedJar } from './shared-jar.js';
import { renderPlanner } from './planner.js';
import { decorateCurrentTrips, installPrepCapture } from '../trips/prep.js';

function attachEvents() {
  document.addEventListener('click', (e) => {
    const identity = e.target.closest?.('.identity-choice,#loggedUserBadge');
    if (identity) setTimeout(async () => { await freshState(); renderSharedJar(); renderPlanner(); decorateCurrentTrips(); }, 180);
  }, true);
  document.addEventListener('twogether:v18-rendered', () => { decorateCurrentTrips(); });
  document.addEventListener('twogether:finance-view', async (e) => {
    if (e.detail?.view === 'balances') { await freshState(); renderSharedJar(); }
    if (e.detail?.view === 'monthly') { await freshState(); renderPlanner(); }
  });
  document.addEventListener('twogether:saved', async () => { await freshState(); renderSharedJar(); decorateCurrentTrips(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') freshState().then(() => { renderSharedJar(); decorateCurrentTrips(); });
  });
}

async function init() {
  installPrepCapture();
  attachEvents();
  await freshState();
  renderSharedJar();
  decorateCurrentTrips();
  if ($('[data-fin-view="monthly"].active')) renderPlanner();
  document.dispatchEvent(new CustomEvent('twogether:v33-ready'));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
