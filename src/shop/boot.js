// Boots the Shop/Wishlist/Compare Lab/Social Signals suite -- the migrated
// replacement for v27.js. Loaded from its own <script type="module"> at the
// exact document position v27.js used to occupy (before v28.js-v33.js),
// not bundled into the shared main.js (which loads last): v28.js's and
// v29.js's own load-time init() calls read window.TwogetherV27
// synchronously (not just from click handlers), so this needs to exist
// before their scripts run, matching the original script order.
import * as shopState from './state.js';
import { installShop, renderShop, renderBadge, applyRewards, ensureCurrentWorkspace, bindPlanButton } from './shop.js';
import { showIncoming } from './signals.js';
import { renderCompareLab } from '../trips/compare-lab.js';
import { renderWishlist, wishes } from '../wishlist/wishlist.js';

function renderAll() {
  renderBadge();
  renderShop();
  renderWishlist();
  renderCompareLab();
  ensureCurrentWorkspace();
  applyRewards();
}

function initShopSuite() {
  installShop();
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
  document.addEventListener('twogether:shop-award', () => { renderShop(); renderWishlist(); });
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

initShopSuite();
