// Boots the Shared Jar and Trip Prep together.
// The old Planner-vs-Actual block is intentionally no longer rendered:
// finances.js already provides the saved/confirmed monthly overview with
// colored category cards, which is the monthly view we want to keep.
import { freshState } from './planner-state.js';
import { renderSharedJar } from './shared-jar.js';
import { decorateCurrentTrips, installPrepCapture } from '../trips/prep.js';

function removeLegacyPlanner() {
  document.querySelector('#v33FinancePlanner')?.remove();
}

function attachEvents() {
  document.addEventListener('click', (e) => {
    const identity = e.target.closest?.('.identity-choice,#loggedUserBadge');
    if (identity) setTimeout(async () => {
      await freshState();
      renderSharedJar();
      removeLegacyPlanner();
      decorateCurrentTrips();
    }, 180);
  }, true);
  document.addEventListener('twogether:v18-rendered', () => { decorateCurrentTrips(); });
  document.addEventListener('twogether:finance-view', async (e) => {
    if (e.detail?.view === 'balances') {
      await freshState();
      renderSharedJar();
    }
    if (e.detail?.view === 'monthly') removeLegacyPlanner();
  });
  document.addEventListener('twogether:saved', async () => {
    await freshState();
    renderSharedJar();
    decorateCurrentTrips();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') freshState().then(() => {
      renderSharedJar();
      removeLegacyPlanner();
      decorateCurrentTrips();
    });
  });
}

async function init() {
  installPrepCapture();
  attachEvents();
  await freshState();
  renderSharedJar();
  removeLegacyPlanner();
  decorateCurrentTrips();
  document.dispatchEvent(new CustomEvent('twogether:v33-ready'));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
