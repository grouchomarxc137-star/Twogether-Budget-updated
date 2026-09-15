// Consolidates hub/subview tab-switching. Previously split across two files
// that raced each other on the same click: navigation.js (desktop hub +
// subview persistence) and v32.js's mobileHubClick/activateMobileHub, which
// used a capture-phase listener + stopImmediatePropagation() to fully
// override navigation.js's own handler on phones. Both paths are ported
// here unchanged (the mobile path kept exactly as v32.js wrote it, including
// its extra class toggling) -- merged into one file instead of one file
// silently overriding another.
import { $, $$ } from '../lib/dom.js';

const TRIP_VIEW_KEY = 'twogether_trip_subview_v1';
const FIN_VIEW_KEY = 'twogether_fin_subview_v1';

const isMobile = () => window.matchMedia?.('(max-width: 760px)')?.matches || false;

function setHub(name) {
  $$('[data-hub]').forEach((btn) => btn.classList.toggle('active', btn.dataset.hub === name));
  $('#tripSubnav')?.classList.toggle('hidden', name !== 'trips');
  $('#financeSubnav')?.classList.toggle('hidden', name !== 'finances');
}

function ensureFinanceSheet() {
  const finance = $('#finances');
  if (!finance) return;
  $$('.sheet').forEach((sheet) => sheet.classList.toggle('active', sheet === finance));
}

function activateTrip(sheet) {
  const target = $(`.trip-subnav .tab[data-sheet="${sheet}"]`) || $('.trip-subnav .tab[data-sheet="log"]');
  if (target) {
    try { localStorage.setItem(TRIP_VIEW_KEY, target.dataset.sheet || 'log'); } catch {}
    setHub('trips');
    target.click();
  }
}

function activateFinanceView(view) {
  const valid = ['overview', 'monthly', 'balances', 'scenarios', 'wishlist'];
  const chosen = valid.includes(view) ? view : 'overview';
  setHub('finances');
  ensureFinanceSheet();
  $$('[data-fin-subview]').forEach((btn) => btn.classList.toggle('active', btn.dataset.finSubview === chosen));
  $$('[data-fin-view]').forEach((el) => el.classList.toggle('active', el.dataset.finView === chosen));
  try { localStorage.setItem(FIN_VIEW_KEY, chosen); } catch {}
  document.dispatchEvent(new CustomEvent('twogether:finance-view', { detail: { view: chosen } }));
}

function lastTripView() {
  try { return localStorage.getItem(TRIP_VIEW_KEY) || 'log'; } catch { return 'log'; }
}

function lastFinanceView() {
  try { return localStorage.getItem(FIN_VIEW_KEY) || 'overview'; } catch { return 'overview'; }
}

// Moved from app.js's bindStatic(): the foundational "show this one .sheet,
// highlight this one .tab" toggle that everything else (including this
// file's own setHub/activateTrip/activateFinanceView) ultimately triggers
// by calling .click() on the right element. Also called directly by
// trips/wizard.js for programmatic navigation (e.g. jumping to the Log
// sheet when editing a trip from its modal).
export function openSheet(id) {
  $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.sheet === id));
  $$('.sheet').forEach((x) => x.classList.toggle('active', x.id === id));
}

// On phones the hover/pinned dropdown menu (added by approved-v18.js) isn't
// reachable by touch, so tapping a hub button needs to jump straight into
// its last-used subview instead of relying on the dropdown. Ported verbatim
// from v32.js's activateMobileHub, including its extra, seemingly-redundant
// class toggling -- kept as-is since the reason it was added isn't fully
// clear from the code alone, and preserving exact behavior matters more
// than tidying it up here.
function activateMobileHub(name) {
  const trip = $('[data-hub="trips"]'), fin = $('[data-hub="finances"]');
  if (name === 'trips') {
    trip?.classList.add('active'); fin?.classList.remove('active');
    $('#wishlistHub')?.classList.remove('active'); $('#shopHub')?.classList.remove('active');
    $('#tripSubnav')?.classList.remove('hidden'); $('#financeSubnav')?.classList.add('hidden');
    let last = lastTripView();
    if (!['log', 'monthly', 'compare'].includes(last)) last = 'log';
    const target = $(`#tripSubnav .tab[data-sheet="${last}"]`) || $('#tripSubnav .tab[data-sheet="log"]');
    if (target) target.click();
    else $$('.sheet').forEach((x) => x.classList.toggle('active', x.id === 'log'));
    return;
  }
  trip?.classList.remove('active'); fin?.classList.add('active');
  $('#wishlistHub')?.classList.remove('active'); $('#shopHub')?.classList.remove('active');
  $('#tripSubnav')?.classList.add('hidden'); $('#financeSubnav')?.classList.remove('hidden');
  let last = lastFinanceView();
  if (!['overview', 'monthly', 'balances', 'scenarios'].includes(last)) last = 'overview';
  const target = $(`#financeSubnav [data-fin-subview="${last}"]`) || $('#financeSubnav [data-fin-subview="overview"]');
  if (target) target.click();
  else $$('.sheet').forEach((x) => x.classList.toggle('active', x.id === 'finances'));
}

// The desktop hover/pinned dropdown menu wrapping each hub button.
// Extracted from approved-v18.js's ensureNavigation(). Originally ran
// later (approved-v18.js loaded after this file), but only touches
// always-present static markup (.hub-tabs, [data-hub]), same as the rest
// of this module -- calling it from initNavigation() instead of
// separately is safe and avoids a second entry point for the same file.
function ensureNavigation() {
  if ($('.tw-v18-nav-wrap')) return;
  const hub = $('.hub-tabs'); if (!hub) return;
  const defs = [
    { key: 'trips', items: [['Log trip', () => $('.trip-subnav [data-sheet="log"]')], ['Monthly', () => $('.trip-subnav [data-sheet="monthly"]')], ['Compare', () => $('.trip-subnav [data-sheet="compare"]')]] },
    { key: 'finances', items: [['Overview', () => $('.finance-subnav [data-fin-subview="overview"]')], ['Monthly finances', () => $('.finance-subnav [data-fin-subview="monthly"]')], ['Balances & loans', () => $('.finance-subnav [data-fin-subview="balances"]')], ['Test scenarios', () => $('.finance-subnav [data-fin-subview="scenarios"]')]] },
  ];
  defs.forEach((def) => {
    const main = $(`[data-hub="${def.key}"]`, hub); if (!main) return;
    const wrap = document.createElement('div'); wrap.className = 'tw-nav-wrap tw-v18-nav-wrap'; main.parentNode.insertBefore(wrap, main); wrap.appendChild(main); main.setAttribute('aria-haspopup', 'menu'); main.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div'); menu.className = 'tw-nav-menu'; menu.setAttribute('role', 'menu');
    def.items.forEach(([label, getTarget]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('role', 'menuitem'); b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); getTarget()?.click(); }); menu.appendChild(b); });
    wrap.appendChild(menu);
  });
}

// Pin/hover/fade refinement on top of ensureNavigation()'s dropdown --
// click to pin a menu open, close on scroll/outside-click, fade
// transitions. Extracted from refine-v22.js (the final version in the
// original dynamic-loader chain; refine-v20.js's earlier, cruder
// fixNavigation()/unpinTracked() attempt at the same idea is superseded
// by this one and not ported). Dropped: refine-v22.js's enhanceWishlist()/
// cleanPriorityMetadata() -- same confirmed-dead .wishlist-table targeting
// as approved-v18.js's wishlist enhancers.
let pinned = null, navInstalled = false, suppressHover = false, lastPointer = null;
const closeTimers = new WeakMap(), fadeTimers = new WeakMap();
function cancelTimers(w) { const a = closeTimers.get(w), b = fadeTimers.get(w); if (a) clearTimeout(a); if (b) clearTimeout(b); closeTimers.delete(w); fadeTimers.delete(w); }
function setExpanded(w, on) { w?.querySelector('[data-hub]')?.setAttribute('aria-expanded', on ? 'true' : 'false'); }
function hardClose(w) { if (!w) return; cancelTimers(w); w.classList.remove('v22-open', 'v22-fade', 'menu-open', 'nav-visible'); setExpanded(w, false); }
function fadeClose(w) { if (!w) return; cancelTimers(w); setExpanded(w, false); if (!w.classList.contains('v22-open')) return hardClose(w); w.classList.add('v22-fade'); const t = setTimeout(() => { w.classList.remove('v22-open', 'v22-fade', 'menu-open', 'nav-visible'); fadeTimers.delete(w); }, 135); fadeTimers.set(w, t); }
function closeOthers(except, fade = true) { $$('.tw-nav-wrap').forEach((w) => { if (w !== except) (fade ? fadeClose(w) : hardClose(w)); }); }
function openWrap(w) { if (!w || suppressHover) return; cancelTimers(w); closeOthers(w, true); w.classList.remove('v22-fade', 'menu-open', 'nav-visible'); w.classList.add('v22-open'); setExpanded(w, true); }
function scheduleClose(w) { if (!w || pinned === w) return; cancelTimers(w); const t = setTimeout(() => { if (pinned !== w) fadeClose(w); closeTimers.delete(w); }, 170); closeTimers.set(w, t); }
function unpinAndFadeAll() { pinned = null; $$('.tw-nav-wrap').forEach(fadeClose); }
function closeForScroll() { suppressHover = true; unpinAndFadeAll(); }
function installDropdownRefinement() {
  const wraps = $$('.tw-nav-wrap'); if (!wraps.length) return;
  wraps.forEach((w) => {
    if (w.dataset.v22Nav === '3') return; w.dataset.v22Nav = '3';
    const hub = w.querySelector('[data-hub]'), menu = w.querySelector('.tw-nav-menu');
    w.addEventListener('pointerenter', () => { cancelTimers(w); if (suppressHover) return; if (pinned && pinned !== w) { const old = pinned; pinned = null; fadeClose(old); } openWrap(w); });
    w.addEventListener('pointerleave', () => scheduleClose(w));
    menu?.addEventListener('pointerenter', () => { cancelTimers(w); if (!suppressHover) openWrap(w); });
    menu?.addEventListener('pointerleave', () => scheduleClose(w));
    hub?.addEventListener('click', () => { suppressHover = false; if (pinned === w) { pinned = null; openWrap(w); scheduleClose(w); } else { const old = pinned; pinned = w; if (old && old !== w) fadeClose(old); openWrap(w); } }, true);
    menu?.addEventListener('click', () => { suppressHover = false; unpinAndFadeAll(); });
  });
  if (navInstalled) return; navInstalled = true;
  let scrollQueued = false;
  const onScroll = () => { if (scrollQueued) return; scrollQueued = true; requestAnimationFrame(() => { scrollQueued = false; closeForScroll(); }); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('wheel', closeForScroll, { passive: true, capture: true });
  document.addEventListener('pointermove', (e) => { const moved = !lastPointer || Math.hypot(e.clientX - lastPointer.x, e.clientY - lastPointer.y) > 2; lastPointer = { x: e.clientX, y: e.clientY }; if (suppressHover && moved) { suppressHover = false; const w = e.target.closest?.('.tw-nav-wrap'); if (w) openWrap(w); } }, { passive: true, capture: true });
  document.addEventListener('pointerdown', (e) => { suppressHover = false; if (!e.target.closest?.('.tw-nav-wrap')) unpinAndFadeAll(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { suppressHover = false; unpinAndFadeAll(); } }, true);
}

export function initNavigation() {
  const tripHub = $('[data-hub="trips"]');
  const financeHub = $('[data-hub="finances"]');
  if (!tripHub || !financeHub) return;

  ensureNavigation();
  installDropdownRefinement();
  document.addEventListener('twogether:v18-rendered', installDropdownRefinement);
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => openSheet(tab.dataset.sheet)));

  tripHub.addEventListener('click', () => {
    if (isMobile()) { activateMobileHub('trips'); return; }
    activateTrip(lastTripView());
  });

  financeHub.addEventListener('click', () => {
    if (isMobile()) { activateMobileHub('finances'); return; }
    setHub('finances');
    ensureFinanceSheet();
    setTimeout(() => activateFinanceView(lastFinanceView()), 0);
  });

  $$('.trip-subnav .tab').forEach((btn) => btn.addEventListener('click', () => {
    setHub('trips');
    try { localStorage.setItem(TRIP_VIEW_KEY, btn.dataset.sheet || 'log'); } catch {}
  }));

  $$('[data-fin-subview]').forEach((btn) => btn.addEventListener('click', () => {
    ensureFinanceSheet();
    activateFinanceView(btn.dataset.finSubview);
  }));

  document.addEventListener('click', (e) => {
    const tab = e.target.closest?.('.tab[data-sheet="finances"]');
    if (tab) {
      setHub('finances');
      ensureFinanceSheet();
      setTimeout(() => activateFinanceView(tab.dataset.finSubview || lastFinanceView()), 0);
    }
  }, true);

  setHub('trips');
  activateFinanceView('overview');
  setHub('trips');
  activateTrip(lastTripView());
}
