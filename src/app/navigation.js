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

let cardViewCurrent = null;
let cardViewTrail = [];
let cardViewRestoringKey = '';

export function rememberCardView(key, reopen) {
  const normalizedKey = String(key || '');
  if (!normalizedKey || typeof reopen !== 'function') return;
  const entry = { key: normalizedKey, reopen };
  if (cardViewRestoringKey === normalizedKey) {
    cardViewRestoringKey = '';
    cardViewCurrent = entry;
    return;
  }
  if (cardViewCurrent?.key === normalizedKey) {
    cardViewCurrent = entry;
    return;
  }
  if (cardViewCurrent) {
    cardViewTrail = cardViewTrail.filter((item) => item.key !== cardViewCurrent.key);
    cardViewTrail.push(cardViewCurrent);
    if (cardViewTrail.length > 24) cardViewTrail.shift();
  }
  cardViewCurrent = entry;
}

export function dismissCardView(key = '') {
  const normalizedKey = String(key || '');
  if (normalizedKey && cardViewCurrent?.key !== normalizedKey) return;
  cardViewCurrent = null;
  cardViewTrail = [];
  cardViewRestoringKey = '';
}

export function backFromCardView(key, fallback) {
  const normalizedKey = String(key || '');
  if (!cardViewCurrent || (normalizedKey && cardViewCurrent.key !== normalizedKey)) {
    if (typeof fallback === 'function') fallback();
    return false;
  }
  const remaining = [...cardViewTrail];
  const previous = remaining.pop() || null;
  cardViewCurrent = null;
  cardViewTrail = remaining;
  if (typeof fallback === 'function') fallback();
  if (!previous) return false;
  cardViewRestoringKey = previous.key;
  setTimeout(() => {
    try { previous.reopen(); }
    finally {
      if (cardViewRestoringKey === previous.key) cardViewRestoringKey = '';
    }
  }, 0);
  return true;
}

export function returnToLastCard(fallback) {
  const previous = cardViewCurrent;
  if (typeof fallback === 'function') fallback();
  if (!previous) return false;
  setTimeout(() => previous.reopen(), 0);
  return true;
}

function setHub(name) {
  document.querySelectorAll('[data-hub]').forEach((btn) => btn.classList.toggle('active', btn.dataset.hub === name));
  $('#wishlistHub')?.classList.remove('active');
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

export function openTripSubview(view = 'log') {
  activateTrip(view);
}

export function openFinanceSubview(view = 'overview') {
  activateFinanceView(view);
}

function lastTripView() {
  try { return localStorage.getItem(TRIP_VIEW_KEY) || 'log'; } catch { return 'log'; }
}

function lastFinanceView() {
  try { return localStorage.getItem(FIN_VIEW_KEY) || 'overview'; } catch { return 'overview'; }
}

function isInsideHub(name) {
  if (name === 'trips') {
    const activeSheet = $('.sheet.active');
    return !!activeSheet && ['log', 'stay-tracker', 'monthly', 'compare'].includes(activeSheet.id);
  }
  if (name === 'finances') {
    const financeSheet = $('#finances');
    const activeView = $('[data-fin-view].active', financeSheet || document);
    return !!financeSheet?.classList.contains('active') && activeView?.dataset.finView !== 'wishlist';
  }
  return false;
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
    $('#wishlistHub')?.classList.remove('active');
    $('#tripSubnav')?.classList.remove('hidden'); $('#financeSubnav')?.classList.add('hidden');
    let last = lastTripView();
    if (!['log', 'stay-tracker', 'monthly', 'compare'].includes(last)) last = 'log';
    const target = $(`#tripSubnav .tab[data-sheet="${last}"]`) || $('#tripSubnav .tab[data-sheet="log"]');
    if (target) target.click();
    else $$('.sheet').forEach((x) => x.classList.toggle('active', x.id === 'log'));
    return;
  }
  trip?.classList.remove('active'); fin?.classList.add('active');
  $('#wishlistHub')?.classList.remove('active');
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
    { key: 'trips', items: [['Log trip', () => $('.trip-subnav [data-sheet="log"]')], ['Our Stays', () => $('.trip-subnav [data-sheet="stay-tracker"]')], ['Monthly', () => $('.trip-subnav [data-sheet="monthly"]')], ['Compare', () => $('.trip-subnav [data-sheet="compare"]')]] },
    { key: 'finances', items: [['Log Finances', () => $('.finance-subnav [data-fin-subview="monthly"]')], ['Monthly', () => $('.finance-subnav [data-fin-subview="overview"]')], ['Wallet', () => $('.finance-subnav [data-fin-subview="balances"]')], ['Test scenarios', () => $('.finance-subnav [data-fin-subview="scenarios"]')]] },
  ];
  defs.forEach((def) => {
    const main = $(`[data-hub="${def.key}"]`, hub); if (!main) return;
    const wrap = document.createElement('div'); wrap.className = 'tw-nav-wrap tw-v18-nav-wrap'; main.parentNode.insertBefore(wrap, main); wrap.appendChild(main); main.setAttribute('aria-haspopup', 'menu'); main.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div'); menu.className = 'tw-nav-menu'; menu.setAttribute('role', 'menu');
    def.items.forEach(([label, getTarget]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeAfterAction();
        getTarget()?.click();
      });
      menu.appendChild(b);
    });
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
function fadeClose(w) {
  if (!w) return;
  cancelTimers(w);
  setExpanded(w, false);
  if (!w.classList.contains('v22-open')) return hardClose(w);
  w.classList.add('v22-fade');
  const duration = isMobile() ? 85 : 135;
  const t = setTimeout(() => {
    w.classList.remove('v22-open', 'v22-fade', 'menu-open', 'nav-visible');
    fadeTimers.delete(w);
  }, duration);
  fadeTimers.set(w, t);
}
function closeOthers(except, fade = true) { $$('.tw-nav-wrap').forEach((w) => { if (w !== except) (fade ? fadeClose(w) : hardClose(w)); }); }
function openWrap(w) { if (!w || suppressHover) return; cancelTimers(w); closeOthers(w, true); w.classList.remove('v22-fade', 'menu-open', 'nav-visible'); w.classList.add('v22-open'); setExpanded(w, true); }
function scheduleClose(w) { if (!w || pinned === w) return; cancelTimers(w); const t = setTimeout(() => { if (pinned !== w) fadeClose(w); closeTimers.delete(w); }, 170); closeTimers.set(w, t); }
function unpinAndFadeAll() { pinned = null; $$('.tw-nav-wrap').forEach(fadeClose); }
function closeAfterAction() {
  if (isMobile()) {
    pinned = null;
    document.querySelectorAll('.tw-nav-wrap').forEach(hardClose);
    return;
  }
  unpinAndFadeAll();
}
function closeForScroll() {
  suppressHover = true;
  if (isMobile()) {
    pinned = null;
    document.querySelectorAll('.tw-nav-wrap').forEach(hardClose);
    return;
  }
  unpinAndFadeAll();
}
function installDropdownRefinement() {
  const wraps = $$('.tw-nav-wrap'); if (!wraps.length) return;
  wraps.forEach((w) => {
    if (w.dataset.v22Nav === '3') return; w.dataset.v22Nav = '3';
    const hub = w.querySelector('[data-hub]'), menu = w.querySelector('.tw-nav-menu');
    w.addEventListener('pointerenter', () => {
      if (isMobile() || pinned !== w) return;
      cancelTimers(w);
      openWrap(w);
    });
    w.addEventListener('pointerleave', () => { if (!isMobile()) scheduleClose(w); });
    menu?.addEventListener('pointerenter', () => { if (!isMobile() && pinned === w) { cancelTimers(w); openWrap(w); } });
    menu?.addEventListener('pointerleave', () => { if (!isMobile()) scheduleClose(w); });
    hub?.addEventListener('click', () => {
      const alreadyInside = isInsideHub(hub.dataset.hub);
      if (!alreadyInside) {
        suppressHover = true;
        pinned = null;
        closeOthers(w, false);
        hardClose(w);
        return;
      }
      suppressHover = false;
      if (pinned === w) {
        pinned = null;
        hardClose(w);
        return;
      }
      if (isMobile()) {
        const old = pinned; pinned = w;
        if (old && old !== w) fadeClose(old);
        openWrap(w);
        return;
      }
      const old = pinned; pinned = w;
      if (old && old !== w) fadeClose(old);
      openWrap(w);
    }, true);
    menu?.addEventListener('click', () => { suppressHover = false; closeAfterAction(); });
  });
  if (navInstalled) return; navInstalled = true;
  let scrollQueued = false;
  const onScroll = () => { if (scrollQueued) return; scrollQueued = true; requestAnimationFrame(() => { scrollQueued = false; closeForScroll(); }); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('wheel', closeForScroll, { passive: true, capture: true });
  document.addEventListener('touchmove', () => { if (isMobile()) closeForScroll(); }, { passive: true, capture: true });
  document.addEventListener('pointermove', (e) => {
    if (isMobile()) return;
    const moved = !lastPointer || Math.hypot(e.clientX - lastPointer.x, e.clientY - lastPointer.y) > 2;
    lastPointer = { x: e.clientX, y: e.clientY };
    if (suppressHover && moved) suppressHover = false;
  }, { passive: true, capture: true });
  document.addEventListener('pointerdown', (e) => { suppressHover = false; if (!e.target.closest?.('.tw-nav-wrap')) closeAfterAction(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { suppressHover = false; unpinAndFadeAll(); } }, true);
}


let surfaceNavigationInstalled = false;
let surfaceHomeBusy = false;
let surfaceActionDispatching = false;
let surfacePageScrollLock = null;
let surfaceScrollObserver = null;
let surfaceScrollSyncQueued = false;
let surfaceSwipe = { tracking:false, active:false, mode:'', startX:0, startY:0, lastX:0, lastY:0, surface:null, visual:null };

const SURFACE_SELECTORS = [
  '.tv2-confirm-layer',
  'dialog.finance-log-host[open]',
  '.tv2-layer',
  '.stay-modal',
  '.finance-mini-modal.show',
  '.tw-notification-layer.show',
  '#v27Modal:not([hidden])',
  '#v33PrepModal.show',
  '#workflowBudgetModal.show',
  '#tripModal.show',
  'dialog[open]',
  '#workflowV5Overlay.show',
  '#twCurrentTrips.tv2-trip-view',
];

const SCROLL_LOCK_SELECTORS = [
  ...SURFACE_SELECTORS,
  '.identity-modal[aria-hidden="false"]',
  '[role="dialog"][aria-modal="true"]',
];

function surfaceVisible(el) {
  if (!el || el.id === 'identityModal' || el.closest?.('#identityModal')) return false;
  if (el.hidden || el.getAttribute?.('aria-hidden') === 'true') return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (el.matches?.('dialog') && !el.open) return false;
  return !!(el.getClientRects().length || el.matches?.('#twCurrentTrips.tv2-trip-view'));
}

function hasBlockingSurface() {
  const seen = new Set();
  for (const selector of SCROLL_LOCK_SELECTORS) {
    const nodes = document.querySelectorAll(selector);
    for (const el of nodes) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (surfaceVisible(el)) return true;
    }
  }
  return false;
}

function featureOwnsFixedPageLock() {
  const body = document.body;
  return body.classList.contains('finance-month-page-locked') ||
    body.classList.contains('tv2-trip-focus');
}

function setSurfacePageScrollLock(locked) {
  const body = document.body;
  const html = document.documentElement;
  if (!body || !html) return;

  if (locked) {
    if (surfacePageScrollLock || featureOwnsFixedPageLock()) return;
    const scrollY = window.scrollY || html.scrollTop || body.scrollTop || 0;
    surfacePageScrollLock = { scrollY };
    body.style.setProperty('--tw-card-scroll-top','-'+scrollY+'px');
    html.classList.add('tw-card-scroll-locked');
    body.classList.add('tw-card-scroll-locked');
    return;
  }

  if (!surfacePageScrollLock) return;
  const { scrollY } = surfacePageScrollLock;
  surfacePageScrollLock = null;
  html.classList.remove('tw-card-scroll-locked');
  body.classList.remove('tw-card-scroll-locked');
  body.style.removeProperty('--tw-card-scroll-top');
  if (!featureOwnsFixedPageLock()) {
    window.scrollTo({ top:scrollY, left:0, behavior:'auto' });
  }
}

function syncSurfacePageScrollLock() {
  surfaceScrollSyncQueued = false;
  const shouldLock = hasBlockingSurface();
  if (shouldLock && featureOwnsFixedPageLock()) {
    if (surfacePageScrollLock) setSurfacePageScrollLock(false);
    return;
  }
  setSurfacePageScrollLock(shouldLock);
}

function queueSurfacePageScrollSync() {
  if (surfaceScrollSyncQueued) return;
  surfaceScrollSyncQueued = true;
  requestAnimationFrame(syncSurfacePageScrollLock);
}

function installSurfacePageScrollLock() {
  if (surfaceScrollObserver) return;
  surfaceScrollObserver = new MutationObserver(queueSurfacePageScrollSync);
  surfaceScrollObserver.observe(document.documentElement,{
    subtree:true,
    childList:true,
    attributes:true,
    attributeFilter:['class','hidden','open','aria-hidden'],
  });
  queueSurfacePageScrollSync();
}

function surfaceZ(el) {
  const value = Number.parseInt(getComputedStyle(el).zIndex, 10);
  return Number.isFinite(value) ? value : 0;
}

function topSurface() {
  const seen = new Set();
  const found = [];
  SURFACE_SELECTORS.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      if (!seen.has(el) && surfaceVisible(el)) {
        seen.add(el);
        found.push(el);
      }
    });
  });
  if (!found.length) return null;
  return found.reduce((top, candidate) => {
    if (!top) return candidate;
    if (top.contains(candidate)) return candidate;
    if (candidate.contains(top)) return top;
    const topZ = surfaceZ(top), candidateZ = surfaceZ(candidate);
    if (candidateZ !== topZ) return candidateZ > topZ ? candidate : top;
    return (top.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) ? candidate : top;
  }, null);
}

function surfaceCard(surface) {
  if (!surface) return null;
  if (surface.matches('.tv2-confirm-layer')) return surface.querySelector('.tv2-confirm-card');
  if (surface.matches('.finance-mini-modal')) return surface.querySelector('.finance-mini-card');
  if (surface.matches('.tw-notification-layer')) return surface.querySelector('.tw-notification-card');
  if (surface.matches('#v27Modal')) return surface.querySelector('.v27-modal-card');
  if (surface.matches('#v33PrepModal')) return surface.querySelector('.v33-prep-card');
  if (surface.matches('#workflowBudgetModal')) return surface.querySelector('.v5-budget-card');
  if (surface.matches('#tripModal')) return surface.querySelector('.trip-modal-card');
  if (surface.matches('.tv2-layer')) return surface.querySelector('.tv2-sheet');
  if (surface.matches('.stay-modal')) return surface.querySelector('.stay-modal-sheet');
  if (surface.matches('dialog.current-overview')) return surface.querySelector('.overview-trip-shell,.overview-shell') || surface.firstElementChild;
  if (surface.matches('#workflowV5Overlay')) return surface.querySelector('.v5-question') || surface;
  if (surface.matches('#twCurrentTrips.tv2-trip-view')) return surface;
  return surface.querySelector?.('[role="dialog"]') || surface.firstElementChild;
}

function surfaceUsesNativeSwipe(surface) {
  return !!surface?.matches?.('.finance-month-overview,#twCurrentTrips.tv2-trip-view');
}

function surfaceDownReturnsToPrevious(surface) {
  return !!surface?.matches?.('dialog.finance-log-host,.tv2-expense-layer,.stay-modal.has-back');
}

function surfaceBlocksGlobalDown(surface) {
  const card = surfaceCard(surface);
  const recurrentChecklist = card?.classList?.contains('tv2-recurrent-sheet');
  const mainChecklist = card?.classList?.contains('tv2-checklist-sheet') && !recurrentChecklist;
  return !!(surface?.matches?.('.tv2-layer') && (recurrentChecklist || mainChecklist));
}

function surfaceBackdrop(surface) {
  if (!surface) return null;
  if (surface.matches('.finance-mini-modal')) return surface.querySelector('.finance-mini-backdrop');
  if (surface.matches('.tw-notification-layer')) return surface.querySelector('.tw-notification-backdrop');
  if (surface.matches('#v27Modal')) return surface.querySelector('.v27-modal-backdrop');
  if (surface.matches('#v33PrepModal')) return surface.querySelector('.v33-prep-backdrop');
  if (surface.matches('#workflowBudgetModal')) return surface.querySelector('.v5-budget-backdrop');
  if (surface.matches('#tripModal')) return surface.querySelector('.trip-modal-backdrop');
  if (surface.matches('.tv2-confirm-layer')) return surface.querySelector('.tv2-confirm-backdrop');
  if (surface.matches('.stay-modal')) return surface.querySelector('.stay-modal-backdrop');
  if (surface.matches('.tv2-layer,dialog.finance-log-host')) return surface.querySelector('.tv2-backdrop');
  return null;
}

function surfaceVisualTarget(surface) {
  if (!surface) return null;
  if (surface.matches('dialog.current-overview')) return surface;
  if (surface.matches('#workflowV5Overlay')) return surface;
  return surfaceCard(surface) || surface;
}

function rememberInlineStyle(el, properties) {
  if (!el) return null;
  const values = {};
  properties.forEach((name) => {
    values[name] = {
      value: el.style.getPropertyValue(name),
      priority: el.style.getPropertyPriority(name),
    };
  });
  return values;
}

function restoreInlineStyle(el, values) {
  if (!el || !values) return;
  Object.entries(values).forEach(([name, entry]) => {
    if (entry.value) el.style.setProperty(name, entry.value, entry.priority || '');
    else el.style.removeProperty(name);
  });
}

function surfaceKeepsParentOnBack(surface) {
  return !!(surface?.matches?.('.finance-mini-modal.is-recurring-manager') && surface._twogetherKeepSurfaceOnBack === true);
}

function surfaceBackVisualTarget(surface) {
  if (!surfaceKeepsParentOnBack(surface)) return null;
  return surface.querySelector('#financeMiniBody .finance-recurring-tv2 > .tv2-page')
    || surface.querySelector('#financeMiniBody > *')
    || surfaceCard(surface);
}

function createSurfaceVisual(surface, keepParent = false) {
  const target = keepParent ? surfaceBackVisualTarget(surface) : surfaceVisualTarget(surface);
  const backdrop = keepParent ? null : surfaceBackdrop(surface);
  if (!target) return null;
  const computedTransform = getComputedStyle(target).transform;
  return {
    target,
    backdrop,
    baseTransform: computedTransform && computedTransform !== 'none' ? computedTransform : '',
    targetStyle: rememberInlineStyle(target, ['transform','transition','opacity','will-change']),
    backdropStyle: rememberInlineStyle(backdrop, ['transition','opacity']),
  };
}

function surfaceSwipeTransform(visual, mode, distance) {
  const move = mode === 'right'
    ? 'translate3d('+distance+'px,0,0)'
    : 'translate3d(0,'+distance+'px,0)';
  return visual.baseTransform ? visual.baseTransform+' '+move : move;
}

function paintSurfaceSwipe(visual, mode, distance) {
  if (!visual?.target?.isConnected) return;
  const viewport = mode === 'right' ? window.innerWidth : window.innerHeight;
  visual.target.style.setProperty('transition','none','important');
  visual.target.style.setProperty('will-change','transform, opacity','important');
  visual.target.style.setProperty('transform',surfaceSwipeTransform(visual,mode,distance),'important');
  visual.target.style.setProperty('opacity',String(Math.max(.82,1-distance/(viewport*2.2))),'important');
  if (visual.backdrop?.isConnected) {
    visual.backdrop.style.setProperty('transition','none','important');
    visual.backdrop.style.setProperty('opacity',String(Math.max(.45,1-distance/(viewport*.95))),'important');
  }
}

function resetSurfaceVisual(visual, animate = true) {
  if (!visual?.target?.isConnected) return;
  if (!animate) {
    restoreInlineStyle(visual.target,visual.targetStyle);
    restoreInlineStyle(visual.backdrop,visual.backdropStyle);
    return;
  }
  const target = visual.target;
  const backdrop = visual.backdrop;
  target.style.setProperty('transition','transform .2s cubic-bezier(.22,.8,.28,1), opacity .18s ease','important');
  target.style.setProperty('transform',visual.baseTransform || 'none','important');
  target.style.setProperty('opacity','1','important');
  if (backdrop?.isConnected) {
    backdrop.style.setProperty('transition','opacity .18s ease','important');
    backdrop.style.setProperty('opacity','1','important');
  }
  setTimeout(() => {
    if (target.isConnected) restoreInlineStyle(target,visual.targetStyle);
    if (backdrop?.isConnected) restoreInlineStyle(backdrop,visual.backdropStyle);
  },220);
}

function finishSurfaceVisual(visual, mode, done) {
  if (!visual?.target?.isConnected) {
    done();
    return;
  }
  const target = visual.target;
  const backdrop = visual.backdrop;
  const distance = mode === 'right' ? window.innerWidth : window.innerHeight;
  target.style.setProperty('transition','transform .22s cubic-bezier(.22,.8,.28,1), opacity .18s ease','important');
  target.style.setProperty('transform',surfaceSwipeTransform(visual,mode,distance),'important');
  target.style.setProperty('opacity','.72','important');
  if (backdrop?.isConnected) {
    backdrop.style.setProperty('transition','opacity .18s ease','important');
    backdrop.style.setProperty('opacity','0','important');
  }
  setTimeout(() => {
    done();
    if (target.isConnected) restoreInlineStyle(target,visual.targetStyle);
    if (backdrop?.isConnected) restoreInlineStyle(backdrop,visual.backdropStyle);
  },190);
}

function surfaceBackControl(surface) {
  if (!surface) return null;
  const exact = surface.querySelector(
    '[data-site-nav-back],[data-fin-mini-back],[data-fin-recurring-back],[data-category-back],[data-overview-back],[data-wizard-back],[data-other-back],[data-act="cancel-budget-editor"]'
  );
  if (exact) return exact;
  return [...surface.querySelectorAll('button')].find((button) => {
    if (!button.getClientRects().length) return false;
    const text = String(button.textContent || '').trim();
    return text.startsWith('‹') || /^Back\b/i.test(text);
  }) || null;
}

function surfaceCloseControl(surface) {
  if (!surface) return null;
  if (surface.matches('#twCurrentTrips.tv2-trip-view')) return surface.querySelector('[data-act="home"]');
  return surface.querySelector(
    '[data-fin-log-close],[data-fin-mini-close],[data-tw-notification-close],[data-v27-close],[data-prep-close],[data-v5-budget-close],[data-close-trip],[data-overview-close],[data-fin-month-close],[data-close],[data-confirm-cancel],[data-fin-month-confirm-cancel],[data-fin-recurring-confirm-cancel],[data-v5-close],button[aria-label*="close" i]'
  );
}

function closeSurface(surface, home = false) {
  if (!surface) return false;
  const custom = home ? surface._twogetherHome : surface._twogetherBack;
  if (typeof custom === 'function') {
    custom();
    return true;
  }
  if (!home) {
    const back = surfaceBackControl(surface);
    if (back) {
      surfaceActionDispatching = true;
      try { back.click(); } finally { surfaceActionDispatching = false; }
      return true;
    }
  }
  const close = surfaceCloseControl(surface);
  if (close) {
    surfaceActionDispatching = true;
    try { close.click(); } finally { surfaceActionDispatching = false; }
    return true;
  }
  if (surface.matches('dialog') && typeof surface.close === 'function') {
    const cancel = new Event('cancel', { cancelable:true });
    surface.dispatchEvent(cancel);
    if (surface.open) surface.close();
    return true;
  }
  return false;
}

function goSurfaceBack(surface = topSurface()) {
  if (!surface || surfaceHomeBusy) return;
  closeSurface(surface, false);
}

function goSurfaceHome(surface = topSurface()) {
  if (!surface || surfaceHomeBusy) return;
  surfaceHomeBusy = true;
  try {
    closeSurface(surface, true);
  } finally {
    setTimeout(() => { surfaceHomeBusy = false; }, 0);
  }
}

function resetSurfaceSwipe(resetVisual = false) {
  const visual = surfaceSwipe.visual;
  surfaceSwipe = { tracking:false, active:false, mode:'', startX:0, startY:0, lastX:0, lastY:0, surface:null, visual:null };
  if (resetVisual && visual) resetSurfaceVisual(visual,true);
}

function installSurfaceNavigation() {
  if (surfaceNavigationInstalled) return;
  surfaceNavigationInstalled = true;

  document.addEventListener('click', (event) => {
    if (surfaceActionDispatching) return;
    const surface = topSurface();
    if (!surface) return;
    const target = event.target;
    if (!(target instanceof Element) || !surface.contains(target) && target !== surface) return;

    const explicitClose = target.closest(
      '.finance-mini-close,.tw-notification-close,.v27-modal-close,.v33-prep-close,.v5-budget-close,.trip-close,.tv2-x,[data-fin-log-close]'
    );
    const card = surfaceCard(surface);
    const outside = !!card && !card.contains(target);

    if (!explicitClose && !outside) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Dismiss only the visible top layer. The screen beneath must stay untouched.
    goSurfaceHome(surface);
  }, true);

  document.addEventListener('touchstart', (event) => {
    if (!isMobile() || event.touches.length !== 1 || surfaceHomeBusy) return;
    const surface = topSurface();
    if (!surface || surfaceUsesNativeSwipe(surface)) return;
    const touch = event.touches[0];
    const card = surfaceCard(surface);
    const scrollRoot = card || surface;
    const canRight = touch.clientX <= 46;
    const canDown = !surfaceBlocksGlobalDown(surface) && (scrollRoot.scrollTop || 0) <= 1;
    if (!canRight && !canDown) return;
    surfaceSwipe = {
      tracking:true,
      active:false,
      mode:'',
      startX:touch.clientX,
      startY:touch.clientY,
      lastX:touch.clientX,
      lastY:touch.clientY,
      surface,
      visual:createSurfaceVisual(surface),
    };
  }, { passive:true, capture:true });

  document.addEventListener('touchmove', (event) => {
    if (!surfaceSwipe.tracking || event.touches.length !== 1) return;
    if (!surfaceSwipe.surface?.isConnected) {
      resetSurfaceSwipe(false);
      return;
    }
    const touch = event.touches[0];
    const dx = touch.clientX - surfaceSwipe.startX;
    const dy = touch.clientY - surfaceSwipe.startY;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    surfaceSwipe.lastX = touch.clientX;
    surfaceSwipe.lastY = touch.clientY;

    if (!surfaceSwipe.active) {
      if (ax < 9 && ay < 9) return;
      if (ax > ay * 1.25) {
        if (dx > 10 && surfaceSwipe.startX <= 46) {
          surfaceSwipe.active = true;
          surfaceSwipe.mode = 'right';
          // A swipe dismissal moves the whole top layer, never an underlying card.
        } else {
          resetSurfaceSwipe(false);
          return;
        }
      } else if (ay > ax * 1.15) {
        const scrollRoot = surfaceCard(surfaceSwipe.surface) || surfaceSwipe.surface;
        if (!surfaceBlocksGlobalDown(surfaceSwipe.surface) && dy > 10 && (scrollRoot.scrollTop || 0) <= 1) {
          surfaceSwipe.active = true;
          surfaceSwipe.mode = 'down';
        } else {
          resetSurfaceSwipe(false);
          return;
        }
      } else {
        return;
      }
    }

    if (!surfaceSwipe.active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const distance = surfaceSwipe.mode === 'right'
      ? Math.max(0,Math.min(dx,window.innerWidth*.82))
      : Math.max(0,Math.min(dy,window.innerHeight*.72));
    paintSurfaceSwipe(surfaceSwipe.visual,surfaceSwipe.mode,distance);
  }, { passive:false, capture:true });

  document.addEventListener('touchend', (event) => {
    if (!surfaceSwipe.tracking) return;
    const { active, mode, startX, startY, lastX, lastY, surface, visual } = surfaceSwipe;
    const dx = lastX - startX;
    const dy = lastY - startY;
    const complete = active && (
      (mode === 'right' && dx >= Math.min(92, window.innerWidth * .24)) ||
      (mode === 'down' && dy >= Math.min(110, window.innerHeight * .16))
    );
    surfaceSwipe = { tracking:false, active:false, mode:'', startX:0, startY:0, lastX:0, lastY:0, surface:null, visual:null };
    if (!complete) {
      if (active && visual) resetSurfaceVisual(visual,true);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    finishSurfaceVisual(visual,mode,() => {
      // Recurrent Items is nested inside My Checklist. An edge-swipe back
      // must return to that checklist, not dismiss the whole Trips surface.
      if (mode === 'right' && surface?.matches?.('.tv2-layer') &&
          surface.querySelector?.('.tv2-recurrent-sheet') &&
          typeof surface._twogetherBack === 'function') {
        goSurfaceBack(surface);
      } else {
        goSurfaceHome(surface);
      }
    });
  }, { passive:false, capture:true });

  document.addEventListener('touchcancel', () => resetSurfaceSwipe(true), { passive:true, capture:true });
}

let edgeSubnavInstalled = false;
let edgeSubnav = {
  timer:null,
  tracking:false,
  selecting:false,
  touchId:null,
  startX:0,
  startY:0,
  lastX:0,
  lastY:0,
  moved:false,
  choices:[],
  selectedIndex:-1,
  overlay:null,
};

function edgeSubnavHaptic(pattern = 14) {
  try {
    if (typeof navigator.vibrate === 'function') return navigator.vibrate(pattern) !== false;
  } catch {}
  return false;
}

function currentEdgeSection() {
  if ($('#wishlistHub')?.classList.contains('active')) return null;

  const finance = $('#finances');
  const financeView = $('[data-fin-view].active', finance || document);
  if (finance?.classList.contains('active') && financeView?.dataset.finView !== 'wishlist') {
    const items = [
      ['Log Finances', $('#financeSubnav [data-fin-subview="monthly"]'), financeView?.dataset.finView === 'monthly'],
      ['Monthly', $('#financeSubnav [data-fin-subview="overview"]'), financeView?.dataset.finView === 'overview'],
      ['Wallet', $('#financeSubnav [data-fin-subview="balances"]'), financeView?.dataset.finView === 'balances'],
      ['Test scenarios', $('#financeSubnav [data-fin-subview="scenarios"]'), financeView?.dataset.finView === 'scenarios'],
    ].filter((item) => item[1]);
    return { label:'My finances', items };
  }

  const activeSheet = $('.sheet.active');
  if (activeSheet && ['log','stay-tracker','monthly','compare'].includes(activeSheet.id)) {
    const items = [
      ['Trips', $('#tripSubnav [data-sheet="log"]'), activeSheet.id === 'log'],
      ['Our Stays', $('#tripSubnav [data-sheet="stay-tracker"]'), activeSheet.id === 'stay-tracker'],
      ['Monthly', $('#tripSubnav [data-sheet="monthly"]'), activeSheet.id === 'monthly'],
      ['Compare', $('#tripSubnav [data-sheet="compare"]'), activeSheet.id === 'compare'],
    ].filter((item) => item[1]);
    return { label:'Trips', items };
  }

  return null;
}

function ensureEdgeSubnavOverlay() {
  let overlay = document.getElementById('twEdgeSubnav');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'twEdgeSubnav';
  overlay.className = 'tw-edge-subnav';
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden','true');
  document.body.appendChild(overlay);
  return overlay;
}

function renderEdgeSubnav(section) {
  const overlay = ensureEdgeSubnavOverlay();
  overlay.innerHTML =
    '<div class="tw-edge-subnav-title">' + section.label + '</div>' +
    '<div class="tw-edge-subnav-list">' +
      section.items.map(([label, _target, current], index) =>
        '<div class="tw-edge-subnav-item' + (current ? ' is-current' : '') + '" data-edge-subnav-index="' + index + '">' +
          '<span>' + label + '</span><i aria-hidden="true"></i>' +
        '</div>'
      ).join('') +
    '</div>' +
    '<small>Release to open</small>';
  return overlay;
}

function positionEdgeSubnav(startY) {
  const overlay = edgeSubnav.overlay;
  if (!overlay) return;
  overlay.style.top = '0px';
  overlay.hidden = false;
  overlay.setAttribute('aria-hidden','false');
  overlay.classList.add('show');
  const height = overlay.getBoundingClientRect().height || 220;
  const top = Math.max(58, Math.min(window.innerHeight - height - 18, startY - 16));
  overlay.style.top = top + 'px';
}

function edgeSubnavIndexAt(y) {
  const overlay = edgeSubnav.overlay;
  if (!overlay) return -1;
  const rows = [...overlay.querySelectorAll('[data-edge-subnav-index]')];
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (y >= rect.top && y <= rect.bottom) return Number(row.dataset.edgeSubnavIndex);
  }
  if (!rows.length) return -1;
  let nearest = -1, distance = Infinity;
  rows.forEach((row) => {
    const rect = row.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const d = Math.abs(y - center);
    if (d < distance) { distance = d; nearest = Number(row.dataset.edgeSubnavIndex); }
  });
  return distance <= 30 ? nearest : -1;
}

function previewEdgeSubnav(index) {
  if (index < 0 || index === edgeSubnav.selectedIndex || !edgeSubnav.overlay) return;
  edgeSubnav.selectedIndex = index;
  edgeSubnav.overlay.querySelectorAll('[data-edge-subnav-index]').forEach((row) => {
    row.classList.toggle('is-preview', Number(row.dataset.edgeSubnavIndex) === index);
  });
  edgeSubnavHaptic(16);
}

function hideEdgeSubnav() {
  const overlay = edgeSubnav.overlay || document.getElementById('twEdgeSubnav');
  if (!overlay) return;
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden','true');
  overlay.hidden = true;
  overlay.style.top = '';
}

function resetEdgeSubnav() {
  if (edgeSubnav.timer) clearTimeout(edgeSubnav.timer);
  edgeSubnav.timer = null;
  edgeSubnav.tracking = false;
  edgeSubnav.selecting = false;
  edgeSubnav.touchId = null;
  edgeSubnav.startX = 0;
  edgeSubnav.startY = 0;
  edgeSubnav.lastX = 0;
  edgeSubnav.lastY = 0;
  edgeSubnav.moved = false;
  edgeSubnav.choices = [];
  edgeSubnav.selectedIndex = -1;
  hideEdgeSubnav();
}

function touchById(list, id) {
  return [...(list || [])].find((touch) => touch.identifier === id) || null;
}

function installEdgeSubnavSelector() {
  if (edgeSubnavInstalled) return;
  edgeSubnavInstalled = true;

  document.addEventListener('contextmenu', (event) => {
    if (edgeSubnav.tracking || edgeSubnav.selecting) event.preventDefault();
  }, true);

  document.addEventListener('touchstart', (event) => {
    if (!isMobile() || edgeSubnav.tracking || event.touches.length !== 1 || hasBlockingSurface()) return;
    if (event.target?.closest?.('#twNotificationButton,.tw-notification-button')) return;
    const touch = event.touches[0];
    if (touch.clientX < window.innerWidth - 28) return;

    const section = currentEdgeSection();
    if (!section?.items?.length) return;

    resetEdgeSubnav();
    edgeSubnav.tracking = true;
    edgeSubnav.touchId = touch.identifier;
    edgeSubnav.startX = touch.clientX;
    edgeSubnav.startY = touch.clientY;
    edgeSubnav.lastX = touch.clientX;
    edgeSubnav.lastY = touch.clientY;
    edgeSubnav.choices = section.items;
    edgeSubnav.overlay = renderEdgeSubnav(section);

    edgeSubnav.timer = setTimeout(() => {
      if (!edgeSubnav.tracking) return;
      edgeSubnav.timer = null;
      edgeSubnav.selecting = true;
      edgeSubnav.moved = false;
      positionEdgeSubnav(edgeSubnav.startY);
      document.documentElement.classList.add('tw-edge-subnav-active');
      document.body.classList.add('tw-edge-subnav-active');
      edgeSubnavHaptic([20,16,12]);
    }, 360);
  }, { passive:true, capture:true });

  document.addEventListener('touchmove', (event) => {
    if (!edgeSubnav.tracking) return;
    const touch = touchById(event.touches, edgeSubnav.touchId);
    if (!touch) return;
    edgeSubnav.lastX = touch.clientX;
    edgeSubnav.lastY = touch.clientY;

    if (!edgeSubnav.selecting) {
      if (Math.hypot(touch.clientX - edgeSubnav.startX, touch.clientY - edgeSubnav.startY) > 11) resetEdgeSubnav();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    if (Math.abs(touch.clientY - edgeSubnav.startY) >= 6) edgeSubnav.moved = true;
    if (edgeSubnav.moved) previewEdgeSubnav(edgeSubnavIndexAt(touch.clientY));
  }, { passive:false, capture:true });

  document.addEventListener('touchend', (event) => {
    if (!edgeSubnav.tracking) return;
    const touch = touchById(event.changedTouches, edgeSubnav.touchId);
    if (!touch) return;

    if (!edgeSubnav.selecting) {
      resetEdgeSubnav();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    const index = edgeSubnav.moved ? edgeSubnavIndexAt(touch.clientY) : -1;
    const choice = index >= 0 ? edgeSubnav.choices[index] : null;
    const target = choice?.[1] || null;
    edgeSubnavHaptic(target ? 22 : 8);

    document.documentElement.classList.remove('tw-edge-subnav-active');
    document.body.classList.remove('tw-edge-subnav-active');
    resetEdgeSubnav();
    if (target) target.click();
  }, { passive:false, capture:true });

  document.addEventListener('touchcancel', () => {
    if (!edgeSubnav.tracking) return;
    document.documentElement.classList.remove('tw-edge-subnav-active');
    document.body.classList.remove('tw-edge-subnav-active');
    resetEdgeSubnav();
  }, { passive:true, capture:true });
}

let edgeHubInstalled = false;
let edgeHub = {
  timer:null,
  tracking:false,
  selecting:false,
  touchId:null,
  startX:0,
  startY:0,
  lastX:0,
  lastY:0,
  moved:false,
  choices:[],
  selectedIndex:-1,
  overlay:null,
};

function currentMainAreaChoices() {
  const trip = $('[data-hub="trips"]');
  const finance = $('[data-hub="finances"]');
  const wishlist = $('#wishlistHub');
  return [
    ['Trips', trip, !!trip?.classList.contains('active')],
    ['My finances', finance, !!finance?.classList.contains('active')],
    ['Wishlist', wishlist, !!wishlist?.classList.contains('active')],
  ].filter((item) => item[1]);
}

function ensureEdgeHubOverlay() {
  let overlay = document.getElementById('twEdgeHub');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'twEdgeHub';
  overlay.className = 'tw-edge-hub';
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden','true');
  document.body.appendChild(overlay);
  return overlay;
}

function renderEdgeHub(choices) {
  const overlay = ensureEdgeHubOverlay();
  overlay.innerHTML =
    '<div class="tw-edge-hub-list">' +
      choices.map(([label, _target, current], index) =>
        '<div class="tw-edge-hub-item' + (current ? ' is-current' : '') + '" data-edge-hub-index="' + index + '">' +
          '<i aria-hidden="true"></i><span>' + label + '</span>' +
        '</div>'
      ).join('') +
    '</div>' +
    '<small>Release to open</small>';
  return overlay;
}

function positionEdgeHub(startY) {
  const overlay = edgeHub.overlay;
  if (!overlay) return;
  overlay.style.top = '0px';
  overlay.hidden = false;
  overlay.setAttribute('aria-hidden','false');
  overlay.classList.add('show');
  const height = overlay.getBoundingClientRect().height || 78;
  const top = Math.max(58, Math.min(window.innerHeight - height - 18, startY - height / 2));
  overlay.style.top = top + 'px';
}

function edgeHubIndexAt(x) {
  const overlay = edgeHub.overlay;
  if (!overlay) return -1;
  const items = [...overlay.querySelectorAll('[data-edge-hub-index]')];
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right) return Number(item.dataset.edgeHubIndex);
  }
  if (!items.length) return -1;
  let nearest = -1, distance = Infinity;
  items.forEach((item) => {
    const rect = item.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const d = Math.abs(x - center);
    if (d < distance) { distance = d; nearest = Number(item.dataset.edgeHubIndex); }
  });
  return distance <= 28 ? nearest : -1;
}

function previewEdgeHub(index) {
  if (index < 0 || index === edgeHub.selectedIndex || !edgeHub.overlay) return;
  edgeHub.selectedIndex = index;
  edgeHub.overlay.querySelectorAll('[data-edge-hub-index]').forEach((item) => {
    item.classList.toggle('is-preview', Number(item.dataset.edgeHubIndex) === index);
  });
  edgeSubnavHaptic(16);
}

function hideEdgeHub() {
  const overlay = edgeHub.overlay || document.getElementById('twEdgeHub');
  if (!overlay) return;
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden','true');
  overlay.hidden = true;
  overlay.style.top = '';
}

function resetEdgeHub() {
  if (edgeHub.timer) clearTimeout(edgeHub.timer);
  edgeHub.timer = null;
  edgeHub.tracking = false;
  edgeHub.selecting = false;
  edgeHub.touchId = null;
  edgeHub.startX = 0;
  edgeHub.startY = 0;
  edgeHub.lastX = 0;
  edgeHub.lastY = 0;
  edgeHub.moved = false;
  edgeHub.choices = [];
  edgeHub.selectedIndex = -1;
  hideEdgeHub();
}

function installEdgeHubSelector() {
  if (edgeHubInstalled) return;
  edgeHubInstalled = true;

  document.addEventListener('contextmenu', (event) => {
    if (edgeHub.tracking || edgeHub.selecting) event.preventDefault();
  }, true);

  document.addEventListener('touchstart', (event) => {
    if (!isMobile() || edgeHub.tracking || event.touches.length !== 1 || hasBlockingSurface()) return;
    const touch = event.touches[0];
    if (touch.clientX > 28) return;

    const choices = currentMainAreaChoices();
    if (choices.length < 2) return;

    resetEdgeHub();
    edgeHub.tracking = true;
    edgeHub.touchId = touch.identifier;
    edgeHub.startX = touch.clientX;
    edgeHub.startY = touch.clientY;
    edgeHub.lastX = touch.clientX;
    edgeHub.lastY = touch.clientY;
    edgeHub.choices = choices;
    edgeHub.overlay = renderEdgeHub(choices);

    edgeHub.timer = setTimeout(() => {
      if (!edgeHub.tracking) return;
      edgeHub.timer = null;
      edgeHub.selecting = true;
      edgeHub.moved = false;
      positionEdgeHub(edgeHub.startY);
      document.documentElement.classList.add('tw-edge-hub-active');
      document.body.classList.add('tw-edge-hub-active');
      edgeSubnavHaptic([20,16,12]);
    }, 360);
  }, { passive:true, capture:true });

  document.addEventListener('touchmove', (event) => {
    if (!edgeHub.tracking) return;
    const touch = touchById(event.touches, edgeHub.touchId);
    if (!touch) return;
    edgeHub.lastX = touch.clientX;
    edgeHub.lastY = touch.clientY;

    if (!edgeHub.selecting) {
      if (Math.hypot(touch.clientX - edgeHub.startX, touch.clientY - edgeHub.startY) > 11) resetEdgeHub();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    if (touch.clientX - edgeHub.startX >= 6) edgeHub.moved = true;
    if (edgeHub.moved) previewEdgeHub(edgeHubIndexAt(touch.clientX));
  }, { passive:false, capture:true });

  document.addEventListener('touchend', (event) => {
    if (!edgeHub.tracking) return;
    const touch = touchById(event.changedTouches, edgeHub.touchId);
    if (!touch) return;

    if (!edgeHub.selecting) {
      resetEdgeHub();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    const index = edgeHub.moved ? edgeHubIndexAt(touch.clientX) : -1;
    const choice = index >= 0 ? edgeHub.choices[index] : null;
    const target = choice?.[1] || null;
    edgeSubnavHaptic(target ? 22 : 8);

    document.documentElement.classList.remove('tw-edge-hub-active');
    document.body.classList.remove('tw-edge-hub-active');
    resetEdgeHub();
    if (target && !target.classList.contains('active')) target.click();
  }, { passive:false, capture:true });

  document.addEventListener('touchcancel', () => {
    if (!edgeHub.tracking) return;
    document.documentElement.classList.remove('tw-edge-hub-active');
    document.body.classList.remove('tw-edge-hub-active');
    resetEdgeHub();
  }, { passive:true, capture:true });
}

export function initNavigation() {
  const tripHub = $('[data-hub="trips"]');
  const financeHub = $('[data-hub="finances"]');
  if (!tripHub || !financeHub) return;

  ensureNavigation();
  installDropdownRefinement();
  installEdgeSubnavSelector();
  installEdgeHubSelector();
  installSurfaceNavigation();
  installSurfacePageScrollLock();
  document.addEventListener('twogether:v18-rendered', installDropdownRefinement);
  document.querySelectorAll('.tab').forEach((tab) => {
    if (tab.dataset.hub) return;
    tab.addEventListener('click', () => openSheet(tab.dataset.sheet));
  });

  tripHub.addEventListener('click', () => {
    if (isInsideHub('trips')) return;
    activateTrip('log');
  });

  financeHub.addEventListener('click', () => {
    if (isInsideHub('finances')) return;
    activateFinanceView('monthly');
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
    if (tab && tab !== financeHub) {
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
