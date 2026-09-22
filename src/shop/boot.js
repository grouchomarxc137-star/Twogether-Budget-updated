// Boots the shared rewards state that Wishlist and Compare still use.
// The standalone Shop page/navigation was removed; keeping this bridge
// preserves Wishlist, Compare, existing rewards, and current-trip behavior.
import { $, $$ } from '../lib/dom.js';
import * as shopState from './state.js';
import { applyRewards, ensureCurrentWorkspace, bindPlanButton } from './shop.js';
import { showIncoming } from './signals.js';
import { renderCompareLab } from '../trips/compare-lab.js';
import { renderWishlist, wishes } from '../wishlist/wishlist.js';

function showWishlist(e) {
  e?.preventDefault?.();
  e?.stopImmediatePropagation?.();
  $$('.sheet').forEach((x) => x.classList.remove('active'));
  $$('.hub-tab').forEach((x) => x.classList.remove('active'));
  $$('[data-fin-view]').forEach((x) => x.classList.toggle('active', x.dataset.finView === 'wishlist'));
  $('#tripSubnav')?.classList.add('hidden');
  $('#financeSubnav')?.classList.add('hidden');
  $('#finances')?.classList.add('active');
  $('#wishlistHub')?.classList.add('active');
  shopState.refresh(true).finally(renderWishlist);
}

function installWishlistHub() {
  if ($('#wishlistHub')) return;
  const tabs = $('.hub-tabs');
  if (!tabs) return;
  const hub = document.createElement('button');
  hub.id = 'wishlistHub';
  hub.className = 'hub-tab';
  hub.type = 'button';
  hub.textContent = 'Wishlist';
  hub.addEventListener('click', showWishlist, true);
  tabs.appendChild(hub);
}

function renderAll() {
  renderWishlist();
  renderCompareLab();
  ensureCurrentWorkspace();
  applyRewards();
}

function initSharedSuite() {
  installWishlistHub();
  shopState.wrapApi();
  bindPlanButton();
  shopState.refresh(false).finally(renderAll);

  let refreshTimer = null;
  ['twogether:state-refreshed', 'twogether:saved'].forEach((ev) => document.addEventListener(ev, () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => shopState.refresh(true), 150);
  }));
  document.addEventListener('twogether:v18-rendered', () => requestAnimationFrame(ensureCurrentWorkspace));
  document.addEventListener('twogether:shop-refreshed', () => { renderAll(); showIncoming(); });
  document.addEventListener('twogether:shop-award', () => { renderWishlist(); applyRewards(); });
  document.addEventListener('twogether:shop-refresh-all', renderAll);
  window.addEventListener('focus', () => shopState.refresh(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') shopState.refresh(true); });
  new MutationObserver(() => shopState.resetAndRefresh()).observe(document.body, { attributes: true, attributeFilter: ['data-actor'] });
  setTimeout(ensureCurrentWorkspace, 200);
  setTimeout(ensureCurrentWorkspace, 900);

  window.TwogetherV27 = {
    refresh: shopState.refresh,
    renderAll,
    getState: () => ({ game: shopState.currentGame(), profile: shopState.profile(), test: shopState.testState(), wishes: wishes() }),
  };
}

initSharedSuite();
