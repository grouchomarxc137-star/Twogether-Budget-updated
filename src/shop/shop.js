// The Lovis/Twos rewards shop: catalog, purchases, theme unlocks, and the
// extras (Date Night Jar, Travel Passport, World Map, Trip Countdown,
// Packing List) that purchases unlock. Extracted from v27.js.
import { $, $$ } from '../lib/dom.js';
import { esc, n as num, money } from '../lib/format.js';
import { actor, otherActor as other } from '../lib/session.js';
import { toast } from '../lib/toast.js';
import {
  fmt, profile, testState, saveTest, effective, has, post, refresh,
  ensureModal, currentPlans, nextTrip, confirmedTrips,
} from './state.js';
import { sendHeart, openNote } from './signals.js';
import { renderWishlist } from '../wishlist/wishlist.js';

let layoutRetries = 0;

const CATALOG = [
  { id: 'date-night-jar', cost: 35, icon: '♡', title: 'Date Night Jar', desc: 'Unlock a playful jar of tiny date and connection prompts.' },
  { id: 'flying-heart', cost: 40, icon: '♥', title: 'Flying Heart', desc: 'Send a little heart that floats onto your partner’s page.' },
  { id: 'trip-countdown', cost: 50, icon: '⌛', title: 'Trip Countdown', desc: 'Show a soft live countdown to your next upcoming trip.' },
  { id: 'flying-note', cost: 55, icon: '✉', title: 'Flying Note', desc: 'Leave a short note that lands on your partner’s page.' },
  { id: 'theme-pack', cost: 60, icon: '☾', title: 'Cozy + Night Atelier', desc: 'Unlock two fuller Twogether appearances, not just a color swap.' },
  { id: 'packing-list', cost: 70, icon: '🧳', title: 'Packing List', desc: 'Add a personal packing checklist to each current trip.' },
  { id: 'travel-passport', cost: 80, icon: '◌', title: 'Travel Passport', desc: 'Collect elegant destination stamps from confirmed trips.' },
  { id: 'world-map', cost: 120, icon: '🌍', title: 'Twogether World Map', desc: 'Open a real map-style travel board with your confirmed places pinned.' },
];
const COUNTRY_POS = {
  Italy: [52, 38], Netherlands: [49, 31], Tunisia: [52, 48], Portugal: [42, 42], Spain: [45, 41],
  France: [47, 36], Germany: [52, 34], Belgium: [49, 33], 'United Kingdom': [45, 29],
};
const DATE_PROMPTS = [
  'Pick a €20 date together and make it feel fancy.', 'Choose a place neither of you has tried and rate it out of 10.',
  'Plan a no-phone coffee walk and each bring one question.', 'Choose one future trip and plan only the most fun 30 minutes of it.',
  'Cook something from a country you want to visit together.', 'Each pick one tiny thing under €10 for the other person.',
];

export function installShop() {
  let wishHub = $('#wishlistHub'), hub = $('#shopHub');
  if (!wishHub || !hub) {
    const tabs = $('.hub-tabs');
    if (!tabs) return;
    if (!wishHub) {
      wishHub = document.createElement('button');
      wishHub.id = 'wishlistHub'; wishHub.className = 'hub-tab'; wishHub.type = 'button'; wishHub.textContent = 'Wishlist';
      tabs.appendChild(wishHub);
      wishHub.addEventListener('click', showWishlist, true);
    }
    if (!hub) {
      hub = document.createElement('button');
      hub.id = 'shopHub'; hub.className = 'hub-tab shop-hub'; hub.type = 'button';
      hub.innerHTML = 'Shop <span id="shopWalletBadge" class="shop-token-badge"></span>';
      tabs.appendChild(hub);
      hub.addEventListener('click', showShop, true);
    }
  }
  if (!$('#shopView')) {
    const s = document.createElement('section');
    s.id = 'shopView'; s.className = 'sheet shop-page';
    $('.main')?.appendChild(s);
  }
}

function showWishlist(e) {
  e?.preventDefault?.(); e?.stopImmediatePropagation?.();
  $$('.sheet').forEach((x) => x.classList.remove('active'));
  $$('.hub-tab').forEach((x) => x.classList.remove('active'));
  $$('[data-fin-view]').forEach((x) => x.classList.toggle('active', x.dataset.finView === 'wishlist'));
  $('#tripSubnav')?.classList.add('hidden'); $('#financeSubnav')?.classList.add('hidden');
  $('#finances')?.classList.add('active'); $('#wishlistHub')?.classList.add('active');
  refresh(true).finally(renderWishlist);
}

function showShop(e) {
  e?.preventDefault?.(); e?.stopImmediatePropagation?.();
  $$('.sheet').forEach((x) => x.classList.remove('active'));
  $$('.hub-tab').forEach((x) => x.classList.remove('active'));
  $('#tripSubnav')?.classList.add('hidden'); $('#financeSubnav')?.classList.add('hidden');
  $('#shopView')?.classList.add('active'); $('#shopHub')?.classList.add('active');
  refresh(true).finally(renderShop);
}

export function renderBadge() {
  const b = $('#shopWalletBadge'), e = effective();
  if (b) b.textContent = `${fmt(e.lovis)} ♡`;
}

function scoreboardHtml() {
  const p = profile('Principessa'), q = profile('Principe'), max = Math.max(1, num(p.lovis), num(q.lovis));
  const lead = num(p.lovis) === num(q.lovis) ? 'Tied for now'
    : num(p.lovis) > num(q.lovis) ? `Principessa leads by ${fmt(num(p.lovis) - num(q.lovis))} Lovis`
    : `Principe leads by ${fmt(num(q.lovis) - num(p.lovis))} Lovis`;
  return `<section class="v27-score"><div class="v27-section-title"><div><span class="eyebrow">FRIENDLY COMPETITION</span><h2>Lovis race</h2></div><small>${lead}</small></div>${[['Principessa', p], ['Principe', q]].map(([name, v]) => `<div class="v27-score-row"><div><strong>${name}</strong><span>${fmt(v.lovis)} Lovis · ${fmt(v.twos)} Twos wishlist power</span></div><div class="v27-score-track"><i style="width:${Math.max(3, Math.round(num(v.lovis) / max * 100))}%"></i></div><b>${fmt(v.lovis)}</b></div>`).join('')}<p>Twos are not part of the race anymore; they represent real budget performance and are used in Wishlist checkout.</p></section>`;
}

function worldMapHtml() {
  const places = confirmedTrips()
    .map((t) => t?.submissions?.[t.createdBy] || t?.submissions?.Principessa || t?.submissions?.Principe || {})
    .filter((m) => COUNTRY_POS[m.location]);
  return `<div class="v27-world"><svg viewBox="0 0 1000 500" aria-hidden="true"><g><path d="M70 120 L160 70 250 95 300 155 260 220 180 225 130 185Z"/><path d="M250 240 L320 260 350 340 315 430 270 365 245 290Z"/><path d="M435 120 L520 105 555 145 520 180 455 170Z"/><path d="M480 185 L565 185 610 255 565 385 500 320 470 245Z"/><path d="M545 105 L720 85 885 150 840 235 700 225 630 180 560 165Z"/><path d="M760 315 L850 300 900 345 855 390 775 375Z"/></g></svg>${places.map((m) => { const [x, y] = COUNTRY_POS[m.location]; return `<button type="button" style="left:${x}%;top:${y}%" title="${esc(m.city || m.location)}"><i></i><span>${esc(m.city || m.location)}</span></button>`; }).join('')}<small>${places.length ? `${places.length} confirmed destination${places.length === 1 ? '' : 's'} pinned` : 'Confirmed trips will appear here.'}</small></div>`;
}

function passportHtml() {
  const trips = confirmedTrips();
  const seen = new Set(), stamps = [];
  trips.forEach((t) => {
    const m = t?.submissions?.[t.createdBy] || t?.submissions?.Principessa || t?.submissions?.Principe || {};
    const k = `${m.location}|${m.city}`;
    if (seen.has(k)) return;
    seen.add(k);
    stamps.push(`<div class="v27-stamp"><span>${esc(m.location || 'Trip')}</span><strong>${esc(m.city || m.location || 'Memory')}</strong><small>${esc(m.start || '')}</small></div>`);
  });
  return stamps.length ? `<div class="v27-stamps">${stamps.join('')}</div>` : '<p class="v27-empty">Your first confirmed trip creates the first stamp.</p>';
}

function extrasHtml() {
  let out = '';
  if (has('theme-pack')) out += `<section class="v27-shop-extra"><div class="v27-section-title"><div><span class="eyebrow">APPEARANCE</span><h2>Theme Atelier</h2></div></div><div class="v27-theme-switch"><button data-theme="default">Original</button><button data-theme="cozy">Cozy</button><button data-theme="night">Night</button></div></section>`;
  if (has('date-night-jar')) out += `<section class="v27-shop-extra"><div class="v27-section-title"><div><span class="eyebrow">US TIME</span><h2>Date Night Jar</h2></div><button type="button" data-date-prompt>Draw one</button></div><p id="v27DatePrompt" class="v27-date-prompt">Draw a prompt whenever you want a tiny idea together.</p></section>`;
  if (has('travel-passport')) out += `<section class="v27-shop-extra"><div class="v27-section-title"><div><span class="eyebrow">MEMORIES</span><h2>Travel Passport</h2></div></div>${passportHtml()}</section>`;
  if (has('world-map')) out += `<section class="v27-shop-extra"><div class="v27-section-title"><div><span class="eyebrow">TOGETHER</span><h2>World Map</h2></div></div>${worldMapHtml()}</section>`;
  return out;
}

function testPanel() {
  if (actor() !== 'Principessa') return '';
  const t = testState();
  return `<section class="v27-test"><div><span>Principessa Test Lab</span><strong>${t.active ? 'TEST MODE ACTIVE' : 'Preview rewards safely'}</strong><small>Session-only. Real Lovis, Twos and purchases stay untouched.</small></div><div>${t.active ? '<button data-test-add-lovis>+100 Lovis</button><button data-test-add-twos>+500 test Twos</button><button data-test-all>Preview all</button><button data-test-end>End test</button>' : '<button data-test-start>Start with 500 Lovis + 2,000 Twos</button>'}</div></section>`;
}

function socialHtml() {
  return `<section class="v27-social"><div><span class="eyebrow">SEND A LITTLE SOMETHING</span><h2>Thinking of ${other(actor())}?</h2><p>Hearts and notes land softly on their Twogether page.</p></div><div><button data-send-heart ${has('flying-heart') ? '' : 'disabled'}>♥ Send a heart${has('flying-heart') ? '' : ' · unlock first'}</button><button data-send-note ${has('flying-note') ? '' : 'disabled'}>✉ Flying note${has('flying-note') ? '' : ' · unlock first'}</button></div></section>`;
}

export function renderShop() {
  installShop();
  const root = $('#shopView');
  if (!root || !actor()) return;
  const e = effective();
  root.innerHTML = `<div class="v27-shop-shell"><section class="v27-shop-hero"><div><span class="eyebrow">TWOGETHER SHOP</span><h1>Use Lovis to make Twogether more fun</h1><p>Lovis reward actually using the site: logging, expenses, confirmations, comparisons and Wishlist goals. <strong>Twos are now separate</strong> and belong to Wishlist purchasing power.</p><div class="v27-reward-strip"><span><b>+5</b> log</span><span><b>+2</b> expense</span><span><b>+10</b> confirm trip</span><span><b>+15</b> confirm month</span><span><b>+4/+6</b> comparisons</span><span><b>+3/+5</b> Wishlist</span></div></div><div class="v27-wallet"><span>Lovis</span><strong>${fmt(e.lovis)}</strong><small>Shop currency</small><span>Twos</span><strong>${fmt(e.twos)}</strong><small>Wishlist power</small></div></section>${testPanel()}${scoreboardHtml()}${socialHtml()}<div class="v27-section-title"><div><span class="eyebrow">UNLOCKS</span><h2>Rewards</h2></div><small>Lovis only</small></div><div class="v27-shop-grid">${CATALOG.map((item) => { const owned = e.purchases.includes(item.id), can = e.lovis >= item.cost; return `<article class="v27-shop-item ${owned ? 'owned' : ''}"><div class="v27-shop-icon">${item.icon}</div><div><span>${item.cost} Lovis</span><h3>${item.title}</h3><p>${item.desc}</p></div><button data-buy="${item.id}" ${owned ? 'disabled' : ''}>${owned ? 'Unlocked' : can ? 'Unlock' : 'Need more'}</button></article>`; }).join('')}</div>${extrasHtml()}</div>`;
  bindShop(root);
  renderBadge();
  applyRewards();
}

function bindShop(root) {
  $$('[data-buy]', root).forEach((b) => b.onclick = () => buy(b.dataset.buy));
  $('[data-send-heart]', root)?.addEventListener('click', sendHeart);
  $('[data-send-note]', root)?.addEventListener('click', openNote);
  $$('[data-theme]', root).forEach((b) => b.onclick = () => setTheme(b.dataset.theme));
  $('[data-date-prompt]', root)?.addEventListener('click', () => {
    const p = DATE_PROMPTS[Math.floor(Math.random() * DATE_PROMPTS.length)];
    $('#v27DatePrompt').textContent = p;
  });
  const refreshAll = () => document.dispatchEvent(new CustomEvent('twogether:shop-refresh-all'));
  $('[data-test-start]', root)?.addEventListener('click', () => { saveTest({ active: true, lovis: 500, twos: 2000, unlocked: [], wishlistBought: [] }); refreshAll(); });
  $('[data-test-add-lovis]', root)?.addEventListener('click', () => { const t = testState(); t.lovis += 100; saveTest(t); refreshAll(); });
  $('[data-test-add-twos]', root)?.addEventListener('click', () => { const t = testState(); t.twos += 500; saveTest(t); refreshAll(); });
  $('[data-test-all]', root)?.addEventListener('click', () => { const t = testState(); t.unlocked = CATALOG.map((x) => x.id); saveTest(t); refreshAll(); });
  $('[data-test-end]', root)?.addEventListener('click', () => { sessionStorage.removeItem('twogether_v27_test_principessa'); refreshAll(); });
}

async function buy(id) {
  const item = CATALOG.find((x) => x.id === id);
  if (!item) return;
  const t = testState();
  if (t.active) {
    if (t.unlocked.includes(id)) return;
    if (t.lovis < item.cost) return toast('Not enough test Lovis', 'warn');
    t.lovis -= item.cost; t.unlocked.push(id); saveTest(t);
    document.dispatchEvent(new CustomEvent('twogether:shop-refresh-all'));
    return toast(`${item.title} preview unlocked`);
  }
  try {
    await post('shopPurchase', { id });
    document.dispatchEvent(new CustomEvent('twogether:shop-refresh-all'));
    toast(`${item.title} unlocked ♡`);
  } catch (e) {
    toast(e.message || 'Could not unlock', 'warn');
  }
}

async function setTheme(theme) {
  try {
    await post('shopSetTheme', { theme });
    applyRewards();
    renderShop();
  } catch (e) {
    toast(e.message, 'warn');
  }
}

export function applyRewards() {
  const e = effective();
  document.body.classList.toggle('v27-theme-cozy', e.purchases.includes('theme-pack') && e.theme === 'cozy');
  document.body.classList.toggle('v27-theme-night', e.purchases.includes('theme-pack') && e.theme === 'night');
  renderCountdown();
  syncPackingButtons();
}

function renderCountdown() {
  let el = $('#v27Countdown');
  if (!has('trip-countdown')) { el?.remove(); return; }
  const nt = nextTrip(), host = $('#twCurrentTripsSection');
  if (!nt || !host) return;
  if (!el) { el = document.createElement('div'); el.id = 'v27Countdown'; el.className = 'v27-countdown'; host.prepend(el); }
  const days = Math.max(0, Math.ceil((nt.d - new Date(new Date().toDateString())) / 86400000));
  el.innerHTML = `<span>Next trip</span><strong>${days === 0 ? 'Today' : days + ' day' + (days === 1 ? '' : 's')}</strong><small>${esc(nt.p.meta?.city || nt.p.meta?.location || 'Trip')}</small>`;
}

function syncPackingButtons() {
  $$('#twCurrentTrips .tw-current-card').forEach((card) => {
    const actions = $('.tw-current-actions', card);
    if (!actions) return;
    const old = $('[data-v27-pack]', actions);
    if (!has('packing-list')) { old?.remove(); return; }
    if (!old) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'text-btn'; b.dataset.v27Pack = card.dataset.currentPlan || card.dataset.currentTrip || ''; b.textContent = 'Packing';
      b.onclick = () => openPacking(b.dataset.v27Pack);
      actions.insertBefore(b, actions.lastElementChild);
    }
  });
}

function openPacking(id) {
  const list = [...(profile().packing?.[id] || [])];
  const m = ensureModal(), body = $('#v27ModalBody', m);
  body.innerHTML = `<span class="eyebrow">PACKING</span><h2>Pack for this trip</h2><div class="v27-pack-add"><input id="v27PackInput" placeholder="Add an item"><button id="v27PackAdd">Add</button></div><div id="v27PackList"></div>`;
  const draw = () => {
    $('#v27PackList').innerHTML = list.length ? list.map((x, i) => `<label class="v27-pack-row"><input type="checkbox" data-i="${i}" ${x.done ? 'checked' : ''}><span>${esc(x.text)}</span><button data-del="${i}">×</button></label>`).join('') : '<p class="v27-empty">Nothing packed yet.</p>';
    $$('[data-i]', $('#v27PackList')).forEach((c) => c.onchange = async () => { list[+c.dataset.i].done = c.checked; await post('shopSavePacking', { id, list }); });
    $$('[data-del]', $('#v27PackList')).forEach((b) => b.onclick = async () => { list.splice(+b.dataset.del, 1); await post('shopSavePacking', { id, list }); draw(); });
  };
  const add = async () => {
    const i = $('#v27PackInput'), v = i.value.trim();
    if (!v) return;
    list.push({ text: v, done: false });
    await post('shopSavePacking', { id, list });
    i.value = '';
    draw();
  };
  $('#v27PackAdd').onclick = add;
  draw();
  m.hidden = false;
}

export function ensureCurrentWorkspace() {
  const section = $('#twCurrentTripsSection'), grid = $('#log .hero-grid'), wizard = $('#wizardCard');
  if (!section || !grid || !wizard) {
    if (layoutRetries++ < 25) setTimeout(ensureCurrentWorkspace, 180);
    return;
  }
  layoutRetries = 0;
  grid.classList.add('v27-trip-workspace');
  if (section.parentNode !== grid) grid.appendChild(section);
  section.classList.add('v27-current-side');
  $$('#twCurrentTrips .tw-current-card').forEach((card) => {
    const art = $('.tw-trip-art', card);
    if (!art) return;
    const bg = getComputedStyle(art).backgroundImage || art.style.backgroundImage;
    if (bg && bg !== 'none') { card.style.setProperty('--v27-trip-bg', bg); card.dataset.v27Background = '1'; }
  });
  syncPackingButtons();
}

function planTrip() {
  const logTab = $('[data-sheet="log"]');
  if (logTab) logTab.click();
  setTimeout(() => {
    $('#restartWizard')?.click();
    $('#wizardCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 40);
}

export function bindPlanButton() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v18-new-trip],[data-v12-plan]');
    if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    planTrip();
  }, true);
}
