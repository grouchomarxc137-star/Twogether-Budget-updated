// "Current Trips" cards (plans + standalone in-progress trips), trip-story
// gallery filtering, wizard-choice cosmetic patches, the partial-expense
// picker reorder, and trip-modal reconciliation warnings. Extracted from
// approved-v18.js -- the parts of it still live. Dropped while porting
// (confirmed dead via grep, no live file references them):
// - startNewTrip(): its [data-v18-new-trip] button listener is a
//   bubble-phase handler that can never fire -- shop.js's bindPlanButton()
//   is a document-level CAPTURE-phase listener on the same selector that
//   calls stopImmediatePropagation(), and capture always precedes bubble
//   regardless of script load order.
// - enhanceWishlist()/applyWishlistFilter()/enhanceWishlistModal()/
//   stripPrio()/encodePrio(): built for an older table-based wishlist
//   (targets .wishlist-table, #wishlistMiniModal) that v27's boutique-
//   style wishlist (now wishlist/wishlist.js) replaced; that markup no
//   longer exists anywhere live.
// - the #twDevToggle "Dev" button and window.TwogetherDevV18 reference
//   moved to app/session-switch.js along with the rest of session
//   control -- also confirmed non-functional (TwogetherDevV18 is never
//   defined by any loaded file) but kept for now, not this file's call.
import { $, $$ } from '../lib/dom.js';
import { esc, n, money, fmtDate } from '../lib/format.js';
import { actor } from '../lib/session.js';
import { toast } from '../lib/toast.js';

const MONEY_KEYS = ['travel', 'accom', 'fuel', 'groceries', 'eat', 'tolls', 'other'];
const PARTIAL_ORDER = ['travel', 'accom', 'fuel', 'groceries', 'eat', 'tolls', 'other'];
const LABELS = { travel: 'Flights / Train', accom: 'Accommodation', fuel: 'Fuel', groceries: 'Groceries', eat: 'Eating out', tolls: 'Tolls / Parking', other: 'Other' };

let remoteState = null;
let refreshing = false;
let overlayObserver = null;
let storyObserver = null;

function has(v) { return v !== '' && v != null; }
function isLocked(t) { return !!(t?.confirmed?.Principessa && t?.confirmed?.Principe); }
function tripMeta(t) { return t?.submissions?.[t?.createdBy] || t?.submissions?.Principessa || t?.submissions?.Principe || {}; }
function locationLabel(m) { return m?.location === 'Other' ? (m.otherLocation || 'Other') : (m?.location || '—'); }

function simplifyStaticCopy() {
  const compare = $('#compare .page-heading'); if (compare) { const eyebrow = $('.eyebrow', compare); if (eyebrow) eyebrow.textContent = ''; const p = $('p', compare); if (p) p.textContent = 'Compare your current costs with possible next steps.'; }
  const storyHeading = $('#log .trip-gallery-section .section-heading'); if (storyHeading) { $('.panel-kicker', storyHeading)?.replaceChildren(document.createTextNode('CONFIRMED')); const h = $('h2', storyHeading); if (h) h.textContent = 'Trip stories'; const p = $('p', storyHeading); if (p) p.textContent = 'Only trips confirmed by both of you appear here.'; }
}

function ensureCurrentTrips() {
  const gallery = $('#log .trip-gallery-section'); if (!gallery) return null;
  let section = $('#twCurrentTripsSection');
  if (!section) {
    section = document.createElement('section'); section.id = 'twCurrentTripsSection'; section.className = 'tw-current-trips-section';
    section.innerHTML = '<div class="tw-current-head"><div><span class="panel-kicker">NOW</span><h2 id="twCurrentTitle">Current Trips</h2><p>Trips being planned, logged or matched stay here.</p></div><button class="btn ghost" type="button" data-v18-new-trip>Plan a trip</button></div><div id="twCurrentTrips" class="tw-current-list"></div>';
    gallery.parentNode.insertBefore(section, gallery);
    section.addEventListener('click', (e) => {
      const card = e.target.closest('[data-current-plan],[data-current-trip]'); if (!card) return;
      if (card.dataset.currentPlan) {
        const id = card.dataset.currentPlan; const plan = remoteState?.plans?.find((p) => p.id === id); if (!plan) return;
        if (e.target.closest('[data-current-budget]')) return window.TwogetherWorkflow?.budget(id);
        if (e.target.closest('[data-current-expenses]')) return window.TwogetherWorkflow?.start(id);
        if (e.target.closest('[data-current-open],.tw-current-main')) return window.TwogetherOverview?.open(plan);
      } else {
        const id = card.dataset.currentTrip; if (e.target.closest('[data-current-open],.tw-current-main')) window.TwogetherApp?.open(id);
      }
    });
  }
  return section;
}

function expenseTotal(plan, trip) {
  const a = trip?.submissions?.Principessa || plan?.partials?.Principessa || {};
  const b = trip?.submissions?.Principe || plan?.partials?.Principe || {};
  return MONEY_KEYS.reduce((sum, key) => {
    const shared = plan?.sharedExpenses?.[key] || trip?.sharedExpenses?.[key];
    if (has(shared?.total)) return sum + n(shared.total);
    const av = has(a?.[key]) ? n(a[key]) : null, bv = has(b?.[key]) ? n(b[key]) : null;
    if (av != null && bv != null) return sum + Math.max(av, bv);
    return sum + (av ?? bv ?? 0);
  }, 0);
}

function planCard(plan, trip) {
  const meta = plan?.meta || {}; const a = actor(); const p = plan?.budgets?.Principessa, q = plan?.budgets?.Principe;
  const totalBudget = (has(p) ? n(p) : 0) + (has(q) ? n(q) : 0); const spent = expenseTotal(plan, trip);
  const status = trip || plan?.partials?.Principessa || plan?.partials?.Principe ? 'In progress' : (has(p) && has(q) ? 'Planned' : 'Waiting for budget');
  const ownLabel = a === 'Principe' ? 'Principe budget' : 'Principessa budget'; const ownBudget = a === 'Principe' ? q : p;
  return `<article class="tw-current-card" data-current-plan="${esc(plan.id)}"><button class="tw-current-main" type="button"><div class="tw-current-top"><span class="trip-country">${esc(locationLabel(meta))}</span><span class="tw-current-status">${esc(status)}</span></div><h3>${esc(meta.city || locationLabel(meta))}</h3><p>${fmtDate(meta.start)}–${fmtDate(meta.end)}</p><div class="tw-current-numbers"><div><span>${ownLabel}</span><strong>${has(ownBudget) ? money(ownBudget) : 'Not set'}</strong></div><div><span>Total budget</span><strong>${has(p) || has(q) ? money(totalBudget) : 'Not set'}</strong></div><div><span>Trip so far</span><strong>${money(spent)}</strong></div></div></button><div class="tw-current-actions"><button class="text-btn" type="button" data-current-budget>${has(plan?.budgets?.[a]) ? 'Edit my budget' : 'Add my budget'}</button><button class="btn ghost" type="button" data-current-expenses>${trip?.submissions?.[a] ? 'Edit expenses' : plan?.partials?.[a] ? 'Continue expenses' : 'Add expenses'}</button><button class="text-btn" type="button" data-current-open>Open trip</button></div></article>`;
}

function standaloneCard(trip) {
  const meta = tripMeta(trip); const spent = expenseTotal({}, trip);
  const ownLabel = actor() === 'Principe' ? 'Principe budget' : 'Principessa budget';
  return `<article class="tw-current-card" data-current-trip="${esc(trip.id)}"><button class="tw-current-main" type="button"><div class="tw-current-top"><span class="trip-country">${esc(locationLabel(meta))}</span><span class="tw-current-status">In progress</span></div><h3>${esc(meta.city || locationLabel(meta))}</h3><p>${fmtDate(meta.start)}–${fmtDate(meta.end)}</p><div class="tw-current-numbers"><div><span>${ownLabel}</span><strong>—</strong></div><div><span>Total budget</span><strong>${has(trip.budget) ? money(trip.budget) : 'Not set'}</strong></div><div><span>Trip so far</span><strong>${money(spent)}</strong></div></div></button><div class="tw-current-actions"><button class="text-btn" type="button" data-current-open>Open trip</button></div></article>`;
}

function renderCurrentTrips() {
  const section = ensureCurrentTrips(), root = $('#twCurrentTrips'); if (!section || !root || !remoteState) return;
  const trips = remoteState.trips || [], plans = remoteState.plans || []; const tripMap = new Map(trips.map((t) => [t.id, t])); const linked = new Set(plans.map((p) => p.linkedTripId).filter(Boolean));
  const activePlans = plans.filter((p) => !isLocked(tripMap.get(p.linkedTripId))).sort((a, b) => String(b?.meta?.start || b.updatedAt || '').localeCompare(String(a?.meta?.start || a.updatedAt || '')));
  const standalone = trips.filter((t) => !isLocked(t) && !linked.has(t.id)).sort((a, b) => String(tripMeta(b).start || b.updatedAt || '').localeCompare(String(tripMeta(a).start || a.updatedAt || '')));
  const count = activePlans.length + standalone.length; $('#twCurrentTitle').textContent = count === 1 ? 'Current Trip' : 'Current Trips';
  root.innerHTML = count ? activePlans.map((p) => planCard(p, tripMap.get(p.linkedTripId))).join('') + standalone.map(standaloneCard).join('') : '<div class="tw-current-empty"><strong>No current trips</strong><span>Start a trip when you are ready.</span></div>';
  document.dispatchEvent(new CustomEvent('twogether:v18-rendered'));
}

function filterTripStories() {
  const root = $('#tripGallery'); if (!root || !remoteState) return;
  const locked = new Set((remoteState.trips || []).filter(isLocked).map((t) => t.id)); let shown = 0;
  $$('[data-open-trip]', root).forEach((card) => { const yes = locked.has(card.dataset.openTrip); card.classList.toggle('tw-v18-hidden', !yes); if (yes) shown++; });
  root.querySelector('.tw-story-empty')?.remove();
  if (!shown) { const e = document.createElement('div'); e.className = 'empty-state gallery-empty tw-story-empty'; e.innerHTML = '<strong>No confirmed trips yet</strong><span>Completed trips move here after both of you confirm them.</span>'; root.appendChild(e); }
}

// Background images for confirmed Trip Story cards in #tripGallery -- a
// separate gallery from the Current Trips cards enhanceCardPhotos() already
// decorates above. Ported from v28.js's decorateTripStories().
function decorateTripStories() {
  const root = $('#tripGallery'); if (!root) return;
  $$('.trip-story-card', root).forEach((card) => {
    const country = ($('.trip-country', card)?.textContent || '').trim(), city = ($('h3', card)?.textContent || '').trim().toLowerCase();
    const image = CITY_IMAGES[city] || COUNTRY_IMAGES[country] || FALLBACK_IMAGE;
    card.style.setProperty('--v28-story-bg', `url("${image}")`);
    card.dataset.v28Background = '1';
  });
}

export async function refreshState(force = false) {
  if (refreshing || !window.TwogetherAPI) return; refreshing = true;
  try { remoteState = await window.TwogetherAPI.state(); renderCurrentTrips(); filterTripStories(); enhanceTripModal(); }
  catch (err) { if (force) toast(err.message || 'Could not refresh shared trips', 'warn'); }
  finally { refreshing = false; }
}

function enhanceTripChoices() {
  $$('.trip-pick').forEach((btn) => {
    if (btn.dataset.v18Choice === '1') return; const strong = btn.querySelector('strong'), icon = btn.querySelector('.pick-icon'); if (!strong) return; const text = strong.textContent.trim();
    if (/^Yes ·/i.test(text)) { strong.textContent = text.replace(/^Yes ·\s*/i, 'Log expenses · '); if (icon) icon.textContent = '→'; }
    if (/^No · this is a different trip/i.test(text)) { strong.textContent = 'Start a different trip'; if (icon) icon.textContent = '+'; }
    if (/Start a new trip/i.test(text) && icon) icon.textContent = '+'; if (/Add your version/i.test(text) && icon) icon.textContent = '→'; if (/Match the differences/i.test(text) && icon) icon.textContent = '='; btn.dataset.v18Choice = '1';
  });
}

function enhancePartialPicker() {
  const overlay = $('#workflowV5Overlay'); if (!overlay?.classList.contains('show')) return;
  const title = $('.v5-question h2', overlay)?.textContent?.trim(); if (title !== 'What do you want to log?') return;
  const stack = $('.v5-choice-stack', overlay); if (!stack || stack.dataset.v18Expanded === '1') return;
  const originals = $$('[data-v5-partial-key]', stack); if (!originals.length) return; const proxy = originals[0]; const saved = new Set($$('[data-v5-partial-saved]', overlay).map((b) => b.dataset.v5PartialSaved));
  stack.innerHTML = ''; stack.classList.add('v18-partial-picker');
  PARTIAL_ORDER.filter((k) => !saved.has(k)).forEach((key) => { const clone = proxy.cloneNode(true); clone.dataset.v5PartialKey = key; const strong = clone.querySelector('strong'), small = clone.querySelector('small'), icon = clone.querySelector('.pick-icon'); if (strong) strong.textContent = LABELS[key]; if (small) small.textContent = 'Add ' + LABELS[key].toLowerCase(); if (icon) icon.textContent = key === 'travel' ? '✈' : key === 'accom' ? '⌂' : key === 'fuel' ? '⛽' : '+'; clone.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); proxy.dataset.v5PartialKey = key; proxy.click(); }); stack.appendChild(clone); });
  stack.dataset.v18Expanded = '1'; const help = $('.v5-question>p', overlay); if (help) help.textContent = 'Choose any category now. Flights, accommodation and fuel are listed first.';
}

function parseMoney(text) {
  let s = String(text || '').replace(/[^0-9,.-]/g, ''); if (!s) return null; const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c >= 0 && d >= 0) { const dec = c > d ? ',' : '.', thou = dec === ',' ? '.' : ','; s = s.split(thou).join('').replace(dec, '.'); }
  else if (c >= 0) { const tail = s.length - c - 1; s = tail === 2 ? s.replace(',', '.') : s.replace(/,/g, ''); }
  else if (d >= 0) { const tail = s.length - d - 1; if (tail !== 2) s = s.replace(/\./g, ''); }
  const out = Number(s); return Number.isFinite(out) ? out : null;
}

function enhanceTripModal() {
  const root = $('#tripModalBody'); if (!root || !root.children.length) return;
  const differences = $$('.difference-row', root); const total = parseMoney(root.querySelector('.trip-modal-total strong')?.textContent || '');
  const paid = $$('.submission-card', root).map((card) => { const m = (card.querySelector(':scope > small')?.textContent || '').match(/Paid:\s*([^·]+)/i); return m ? parseMoney(m[1]) : null; }).filter((v) => v != null); const paidTotal = paid.length >= 2 ? paid.reduce((a, b) => a + b, 0) : null; const delta = total != null && paidTotal != null ? total - paidTotal : null;
  const sig = `${differences.length}|${total}|${paidTotal}|${delta}`; if (root.dataset.v18WarningSig === sig) return; root.dataset.v18WarningSig = sig; root.querySelectorAll('.tw-trip-warning').forEach((x) => x.remove());
  const anchor = root.querySelector('.difference-list') || root.querySelector('.submission-grid') || root.firstElementChild;
  if (differences.length) { const box = document.createElement('div'); box.className = 'tw-trip-warning soft'; box.innerHTML = `<strong>${differences.length} detail${differences.length === 1 ? '' : 's'} still differ</strong>The trip stays unmatched until every highlighted detail matches.`; anchor?.parentNode?.insertBefore(box, anchor); }
  if (delta != null && Math.abs(delta) > 0.01) { const box = document.createElement('div'); box.className = 'tw-trip-warning'; box.innerHTML = `<strong>Payment totals do not match the trip expenses</strong>${money(total)} of expenses are recorded, but ${money(paidTotal)} is assigned as paid. Difference: ${money(Math.abs(delta))}.`; const target = root.querySelector('.trip-budget-comparison') || root.querySelector('.budget-check') || anchor; target?.parentNode?.insertBefore(box, target?.nextSibling || null); }
}

// Card art (monogram/emoji placeholder, then a real destination photo).
// Extracted from refine-v19.js (creates the base .tw-trip-art structure)
// and trip-v21.js (the final word on enhancing it -- loads after
// refine-v19.js in the original dynamic-loader chain, so its output wins).
// Ported together since trip-v21's enhanceCards() only works on the
// .tw-trip-art element refine-v19's enhanceCard() creates first.
// Dropped: refine-v20.js's enhanceTripMedia() (an earlier, cruder version
// of the same card-image idea that trip-v21.js's version already
// supersedes in the original load order) and refine-v20.js's entire
// dev-tooling panel (gated behind window.TwogetherDevV18, confirmed never
// defined by any loaded file -- same dead reference as the Dev toggle in
// app/session-switch.js).
const COUNTRY_EMOJI = { Italy: '🇮🇹', Netherlands: '🇳🇱', Tunisia: '🇹🇳', Portugal: '🇵🇹', Spain: '🇪🇸', France: '🇫🇷', Germany: '🇩🇪', Belgium: '🇧🇪', 'United Kingdom': '🇬🇧', Other: '✦' };
function enhanceCardArt(card) {
  if (card.dataset.v19Aesthetic === '1') return;
  const main = $('.tw-current-main', card); if (!main) return;
  const country = $('.trip-country', card)?.textContent?.trim() || 'Trip', city = $('h3', card)?.textContent?.trim() || 'Trip';
  const art = document.createElement('div'); art.className = 'tw-trip-art'; art.setAttribute('aria-hidden', 'true');
  art.innerHTML = `<span class="tw-trip-emoji">${COUNTRY_EMOJI[country] || '✦'}</span><span class="tw-trip-monogram">${(city[0] || 'T').toUpperCase()}</span>`;
  card.insertBefore(art, main);
  const status = $('.tw-current-status', card);
  if (status) { const text = status.textContent.toLowerCase(); status.dataset.status = text.includes('progress') ? 'progress' : 'planned'; }
  card.dataset.v19Aesthetic = '1';
}
function ensureCardArt() { $$('#twCurrentTrips .tw-current-card').forEach(enhanceCardArt); }

const FLAGS = { Italy: '1f1ee-1f1f9', Netherlands: '1f1f3-1f1f1', Tunisia: '1f1f9-1f1f3', Portugal: '1f1f5-1f1f9', Spain: '1f1ea-1f1f8', France: '1f1eb-1f1f7', Germany: '1f1e9-1f1ea', Belgium: '1f1e7-1f1ea', 'United Kingdom': '1f1ec-1f1e7' };
const CITY_IMAGES = { ariana: 'https://upload.wikimedia.org/wikipedia/commons/8/83/Ariana_2_-_Tunisia.jpg', amsterdam: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?auto=format&fit=crop&w=900&q=82', lonato: 'https://images.unsplash.com/photo-1520175480921-4edfa2983e0f?auto=format&fit=crop&w=900&q=82', lisbon: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=82', lisboa: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=82', porto: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=82' };
const COUNTRY_IMAGES = { Italy: 'https://images.unsplash.com/photo-1520175480921-4edfa2983e0f?auto=format&fit=crop&w=900&q=82', Netherlands: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?auto=format&fit=crop&w=900&q=82', Portugal: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=82', Tunisia: 'https://upload.wikimedia.org/wikipedia/commons/8/83/Ariana_2_-_Tunisia.jpg', Spain: 'https://images.unsplash.com/photo-1509840841025-9088ba78a826?auto=format&fit=crop&w=900&q=82', France: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=900&q=82', Germany: 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=900&q=82', Belgium: 'https://images.unsplash.com/photo-1491557345352-5929e343eb89?auto=format&fit=crop&w=900&q=82' };
const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=82';
function enhanceCardPhotos() {
  $$('#twCurrentTrips .tw-current-card').forEach((card) => {
    const art = $('.tw-trip-art', card); if (!art) return;
    $('.tw-trip-monogram', art)?.remove();
    const country = ($('.trip-country', card)?.textContent || '').trim(), city = ($('h3', card)?.textContent || '').trim().toLowerCase();
    card.dataset.v21City = city; card.dataset.v21Country = country.toLowerCase();
    const image = CITY_IMAGES[city] || COUNTRY_IMAGES[country] || FALLBACK_IMAGE;
    const bg = `linear-gradient(180deg,rgba(255,255,255,.02),rgba(25,18,10,.20)),url("${image}")`;
    art.style.backgroundImage = bg; card.style.setProperty('--v27-trip-bg', bg); card.dataset.v27Background = '1';
    if (city === 'ariana' || country === 'Tunisia') art.title = 'Ariana, Tunisia — Wikimedia Commons';
    const flag = $('.tw-trip-emoji', art);
    if (flag && FLAGS[country] && !flag.querySelector('img')) flag.innerHTML = `<img alt="${country} flag" loading="lazy" decoding="async" src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${FLAGS[country]}.svg">`;
  });
}
function enhanceCardMedia() { ensureCardArt(); enhanceCardPhotos(); }

function installEnhancers() {
  const card = $('#wizardCard'); if (card) { overlayObserver = new MutationObserver(() => requestAnimationFrame(() => { enhanceTripChoices(); enhancePartialPicker(); })); overlayObserver.observe(card, { childList: true, subtree: true }); }
  const gallery = $('#tripGallery'); if (gallery) { storyObserver = new MutationObserver(() => requestAnimationFrame(() => { filterTripStories(); decorateTripStories(); })); storyObserver.observe(gallery, { childList: true, subtree: true }); }
  const tripModal = $('#tripModalBody'); if (tripModal) new MutationObserver(() => requestAnimationFrame(enhanceTripModal)).observe(tripModal, { childList: true, subtree: true });
}

export function initCurrentTrips() {
  simplifyStaticCopy(); ensureCurrentTrips(); installEnhancers(); enhanceTripChoices(); enhancePartialPicker();
  enhanceCardMedia(); decorateTripStories();
  document.addEventListener('twogether:v18-rendered', () => requestAnimationFrame(() => { enhanceCardMedia(); decorateTripStories(); }));
  setTimeout(() => refreshState(true), 180);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshState(false); });
  document.addEventListener('twogether:saved', () => setTimeout(() => refreshState(false), 120));
  window.addEventListener('focus', () => refreshState(false), { passive: true });
  window.TwogetherV18 = { refresh: refreshState, get state() { return remoteState; } };
}
