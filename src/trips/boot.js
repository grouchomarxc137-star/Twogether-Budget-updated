// Boots the Trip Wizard + Overview suite -- the migrated replacement for
// app.js's bootstrap (bindStatic + init). Wires trips/state.js's fetch
// events to trips/wizard.js and trips/overview.js's render functions
// (avoiding a circular import the same way shop/boot.js does), and to
// app/identity.js's identity-change event.
import { $, $$ } from '../lib/dom.js';
import { toast } from '../lib/toast.js';
import { initIdentity } from '../app/identity.js';
import { syncNow, startSyncLoop } from './state.js';
import { renderDataViews, closeTripModal, refreshModalIfOpen, preloadTripGalleryImages } from './overview.js';
import { resetWizard, renderWizard, refreshWizardIfIdle, bindRestartWizard } from './wizard.js';

function bindStatic() {
  bindRestartWizard();
  $$('[data-close-trip]').forEach((el) => el.addEventListener('click', closeTripModal));
  const brand = $('#brandMark');
  if (brand) { brand.removeAttribute('title'); brand.style.cursor = 'default'; }
}

function init() {
  document.addEventListener('twogether:saved', () => syncNow(false));
  document.addEventListener('twogether:trips-refreshed', async () => {
    await preloadTripGalleryImages();
    renderDataViews();
    refreshWizardIfIdle();
    refreshModalIfOpen();
  });
  document.addEventListener('twogether:trips-sync-error', (e) => toast(e.detail?.message || 'Could not sync', 'warn'));
  document.addEventListener('twogether:identity-chosen', () => {
    resetWizard();
    renderWizard();
    syncNow(true);
    startSyncLoop();
  });

  bindStatic();
  renderDataViews();
  initIdentity();
}

// app.js originally used the plain "always wait for the real event" pattern
// here (not the readyState==='loading' check some later files use, which
// actually runs immediately once parsing finishes -- that mismatch caused
// a real bug during the navigation.js migration). Matching it exactly
// rather than assuming a deviation is safe.
document.addEventListener('DOMContentLoaded', init);
