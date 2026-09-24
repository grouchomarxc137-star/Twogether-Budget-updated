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

function lastTripView() {
  try { return localStorage.getItem(TRIP_VIEW_KEY) || 'log'; } catch { return 'log'; }
}

function lastFinanceView() {
  try { return localStorage.getItem(FIN_VIEW_KEY) || 'overview'; } catch { return 'overview'; }
}

function isInsideHub(name) {
  if (name === 'trips') {
    const activeSheet = $('.sheet.active');
    return !!activeSheet && ['log', 'monthly', 'compare'].includes(activeSheet.id);
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
    if (!['log', 'monthly', 'compare'].includes(last)) last = 'log';
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
    { key: 'trips', items: [['Log trip', () => $('.trip-subnav [data-sheet="log"]')], ['Monthly', () => $('.trip-subnav [data-sheet="monthly"]')], ['Compare', () => $('.trip-subnav [data-sheet="compare"]')]] },
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
let surfaceSwipe = { tracking:false, active:false, mode:'', startX:0, startY:0, lastX:0, lastY:0, surface:null, visual:null };

const SURFACE_SELECTORS = [
  '.tv2-confirm-layer',
  'dialog.finance-log-host[open]',
  '.tv2-layer',
  '.finance-mini-modal.show',
  '#v27Modal:not([hidden])',
  '#v33PrepModal.show',
  '#workflowBudgetModal.show',
  '#tripModal.show',
  'dialog[open]',
  '#workflowV5Overlay.show',
  '#twCurrentTrips.tv2-trip-view',
];

function surfaceVisible(el) {
  if (!el || el.id === 'identityModal' || el.closest?.('#identityModal')) return false;
  if (el.hidden || el.getAttribute?.('aria-hidden') === 'true') return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (el.matches?.('dialog') && !el.open) return false;
  return !!(el.getClientRects().length || el.matches?.('#twCurrentTrips.tv2-trip-view'));
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
  if (surface.matches('#v27Modal')) return surface.querySelector('.v27-modal-card');
  if (surface.matches('#v33PrepModal')) return surface.querySelector('.v33-prep-card');
  if (surface.matches('#workflowBudgetModal')) return surface.querySelector('.v5-budget-card');
  if (surface.matches('#tripModal')) return surface.querySelector('.trip-modal-card');
  if (surface.matches('.tv2-layer')) return surface.querySelector('.tv2-sheet');
  if (surface.matches('dialog.current-overview')) return surface.querySelector('.overview-trip-shell,.overview-shell') || surface.firstElementChild;
  if (surface.matches('#workflowV5Overlay')) return surface.querySelector('.v5-question') || surface;
  if (surface.matches('#twCurrentTrips.tv2-trip-view')) return surface;
  return surface.querySelector?.('[role="dialog"]') || surface.firstElementChild;
}

function surfaceUsesNativeSwipe(surface) {
  return !!surface?.matches?.('.finance-month-overview,#twCurrentTrips.tv2-trip-view');
}

function surfaceBackdrop(surface) {
  if (!surface) return null;
  if (surface.matches('.finance-mini-modal')) return surface.querySelector('.finance-mini-backdrop');
  if (surface.matches('#v27Modal')) return surface.querySelector('.v27-modal-backdrop');
  if (surface.matches('#v33PrepModal')) return surface.querySelector('.v33-prep-backdrop');
  if (surface.matches('#workflowBudgetModal')) return surface.querySelector('.v5-budget-backdrop');
  if (surface.matches('#tripModal')) return surface.querySelector('.trip-modal-backdrop');
  if (surface.matches('.tv2-confirm-layer')) return surface.querySelector('.tv2-confirm-backdrop');
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

function createSurfaceVisual(surface) {
  const target = surfaceVisualTarget(surface);
  const backdrop = surfaceBackdrop(surface);
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
  setTimeout(done,190);
}

function surfaceBackControl(surface) {
  if (!surface) return null;
  const exact = surface.querySelector(
    '[data-site-nav-back],[data-fin-mini-back],[data-fin-recurring-back],[data-category-back],[data-wizard-back],[data-other-back],[data-act="cancel-budget-editor"]'
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
    '[data-fin-log-close],[data-fin-mini-close],[data-v27-close],[data-prep-close],[data-v5-budget-close],[data-close-trip],[data-overview-close],[data-fin-month-close],[data-close],[data-confirm-cancel],[data-fin-month-confirm-cancel],[data-fin-recurring-confirm-cancel],[data-v5-close],button[aria-label*="close" i]'
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

function goSurfaceHome() {
  if (surfaceHomeBusy) return;
  surfaceHomeBusy = true;
  let count = 0;
  const closeNext = () => {
    const surface = topSurface();
    if (!surface || count++ >= 10) {
      surfaceHomeBusy = false;
      return;
    }
    if (!closeSurface(surface, true)) {
      surfaceHomeBusy = false;
      return;
    }
    setTimeout(closeNext, 0);
  };
  closeNext();
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
      '.finance-mini-close,.v27-modal-close,.v33-prep-close,.v5-budget-close,.trip-close,.tv2-x,[data-fin-log-close]'
    );
    const card = surfaceCard(surface);
    const outside = !!card && !card.contains(target);

    if (!explicitClose && !outside) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    goSurfaceHome();
  }, true);

  document.addEventListener('touchstart', (event) => {
    if (!isMobile() || event.touches.length !== 1 || surfaceHomeBusy) return;
    const surface = topSurface();
    if (!surface || surfaceUsesNativeSwipe(surface)) return;
    const touch = event.touches[0];
    const card = surfaceCard(surface);
    const scrollRoot = card || surface;
    const canRight = touch.clientX <= 46;
    const canDown = (scrollRoot.scrollTop || 0) <= 1;
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
        } else {
          resetSurfaceSwipe(false);
          return;
        }
      } else if (ay > ax * 1.15) {
        const scrollRoot = surfaceCard(surfaceSwipe.surface) || surfaceSwipe.surface;
        if (dy > 10 && (scrollRoot.scrollTop || 0) <= 1) {
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
      if (mode === 'right') goSurfaceBack(surface);
      else goSurfaceHome();
    });
  }, { passive:false, capture:true });

  document.addEventListener('touchcancel', () => resetSurfaceSwipe(true), { passive:true, capture:true });
}

export function initNavigation() {
  const tripHub = $('[data-hub="trips"]');
  const financeHub = $('[data-hub="finances"]');
  if (!tripHub || !financeHub) return;

  ensureNavigation();
  installDropdownRefinement();
  installSurfaceNavigation();
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
