import { actor, esc, money } from './budget-state.js';

const API_BASE = import.meta.env?.DEV ? 'http://localhost:4310' : '';
const ROOT_ID = 'stayTrackerRoot';
const VIEW_KEY = 'twogether_stay_tracker_plan_v1';
const AREA_KEY = 'twogether_stay_tracker_area_v1';
const GARDA_TOWNS = ['manerba','moniga','padenghe','desenzano','lonato','sirmione','peschiera','garda'];

let state = null;
let selectedPlanId = '';
let selectedArea = 'lake-garda';
let loading = false;
let results = [];
let checkedAt = '';
let lastError = '';
let filterState = { parking:true, washingMachine:false, maxTotal:'' };

function root() { return document.getElementById(ROOT_ID); }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function clean(value) { return String(value == null ? '' : value).trim(); }
function planLabel(plan) {
  const meta = plan?.meta || {};
  const place = meta.city || (meta.location === 'Other' ? meta.otherLocation : meta.location) || 'Trip';
  return `${place} · ${dateRange(meta.start, meta.end)}`;
}
function dateRange(start, end) {
  const fmt = (value) => {
    if (!value) return 'No date';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short' }).format(date);
  };
  return `${fmt(start)} – ${fmt(end)}`;
}
function nights(start, end) {
  const a = Date.parse(`${start}T00:00:00Z`), b = Date.parse(`${end}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(1, Math.round((b - a) / 86400000)) : 0;
}
function availablePlans() {
  const plans = Array.isArray(state?.plans) ? state.plans : [];
  return plans.filter((plan) => plan?.meta?.start && plan?.meta?.end)
    .sort((a,b) => String(a.meta.start).localeCompare(String(b.meta.start)));
}
function selectedPlan() { return availablePlans().find((plan) => plan.id === selectedPlanId) || availablePlans()[0] || null; }
function inferArea(plan) {
  const city = clean(plan?.meta?.city).toLowerCase();
  if (city.includes('bergamo')) return 'bergamo';
  if (GARDA_TOWNS.some((town) => city.includes(town))) return 'lake-garda';
  return clean(plan?.stayTracker?.area) || selectedArea || 'lake-garda';
}
function isItalyWithoutCity(plan) {
  return clean(plan?.meta?.location).toLowerCase() === 'italy' && !clean(plan?.meta?.city);
}
function historyFor(plan, id) {
  const history = Array.isArray(plan?.stayTracker?.history) ? plan.stayTracker.history : [];
  return history.filter((item) => String(item.accommodationId) === String(id)).sort((a,b) => String(a.checkedAt).localeCompare(String(b.checkedAt)));
}
function previousSnapshot(plan, id) {
  const history = historyFor(plan, id);
  if (!history.length) return null;
  const last = history[history.length - 1];
  if (checkedAt && String(last.checkedAt || '') === String(checkedAt)) return history[history.length - 2] || null;
  return last;
}
function statusFor(plan, item) {
  const previous = previousSnapshot(plan, item.id);
  if (!previous || !Number(previous.price)) return { cls:'first', text:'First tracked price' };
  const diff = Math.round((Number(item.price) - Number(previous.price)) * 100) / 100;
  if (Math.abs(diff) < .01) return { cls:'same', text:'Same as last check' };
  if (diff < 0) return { cls:'down', text:`↓ ${money(Math.abs(diff))} since last check` };
  return { cls:'up', text:`↑ ${money(diff)} since last check` };
}
function checkedLabel() {
  if (!checkedAt) return '';
  const date = new Date(checkedAt);
  if (Number.isNaN(date.getTime())) return '';
  return `Checked ${new Intl.DateTimeFormat('en-GB', { hour:'2-digit', minute:'2-digit', day:'numeric', month:'short' }).format(date)}`;
}
function tripAreaCopy(plan) {
  const city = clean(plan?.meta?.city);
  if (city) return city;
  return selectedArea === 'bergamo' ? 'Bergamo area' : 'Lake Garda · Manerba to Peschiera';
}
function renderEmpty() {
  const el = root(); if (!el) return;
  el.innerHTML = '<div class="stay-empty"><span>⌂</span><h2>Add trip dates first</h2><p>Stay Tracker appears once a trip has arrival and return dates.</p></div>';
}
function render() {
  const el = root(); if (!el) return;
  const plans = availablePlans();
  if (!plans.length) return renderEmpty();
  const plan = selectedPlan();
  if (!selectedPlanId || !plans.some((item) => item.id === selectedPlanId)) selectedPlanId = plan.id;
  const meta = plan.meta || {};
  const areaChoice = isItalyWithoutCity(plan);
  const tripNights = nights(meta.start, meta.end);
  const oldPlan = plan;
  el.innerHTML = `
    <div class="stay-page">
      <header class="stay-head">
        <div><span class="eyebrow">LIVE ACCOMMODATION</span><h1>Stay Tracker</h1><p>Real Booking.com availability and prices for your trip dates. We save each check so price changes become visible.</p></div>
        <span class="stay-live-badge">${checkedLabel() || 'Ready to check live'}</span>
      </header>
      <section class="stay-trip-card">
        <div class="stay-trip-main"><label>Trip</label><select id="stayTripSelect">${plans.map((item) => `<option value="${esc(item.id)}" ${item.id===selectedPlanId?'selected':''}>${esc(planLabel(item))}</option>`).join('')}</select></div>
        <div class="stay-trip-meta"><span>${esc(dateRange(meta.start, meta.end))}</span><b>${tripNights} ${tripNights===1?'night':'nights'}</b></div>
      </section>
      ${areaChoice ? `<section class="stay-area-choice"><div><strong>Where should we look?</strong><span>You only chose Italy, so pick the area for this search.</span></div><div class="stay-area-buttons"><button type="button" data-stay-area="lake-garda" class="${selectedArea==='lake-garda'?'active':''}">Lake Garda</button><button type="button" data-stay-area="bergamo" class="${selectedArea==='bergamo'?'active':''}">Bergamo</button></div><small>${selectedArea==='lake-garda'?'Manerba · Moniga · Padenghe · Desenzano · Lonato · Sirmione · Peschiera':'Bergamo and nearby towns'}</small></section>` : ''}
      <section class="stay-filter-card">
        <div class="stay-filter-title"><div><strong>${esc(tripAreaCopy(plan))}</strong><span>2 guests · 1 place</span></div><button id="staySearchButton" type="button" ${loading?'disabled':''}>${loading?'Checking…':'Check live prices'}</button></div>
        <div class="stay-filters">
          <label class="stay-check"><input id="stayParking" type="checkbox" ${filterState.parking?'checked':''}><span>🚗 Parking</span></label>
          <label class="stay-check"><input id="stayWashing" type="checkbox" ${filterState.washingMachine?'checked':''}><span>▣ Washing machine</span></label>
          <label class="stay-price"><span>Max total</span><div><b>€</b><input id="stayMaxTotal" inputmode="numeric" placeholder="Any" value="${esc(filterState.maxTotal)}"></div></label>
        </div>
        <p class="stay-source-note">Prices come from Booking.com’s live availability for these exact dates. “Also on Airbnb” only appears for a property we have separately verified.</p>
      </section>
      ${lastError ? `<div class="stay-error"><strong>Couldn’t check live stays</strong><span>${esc(lastError)}</span></div>` : ''}
      ${loading ? `<div class="stay-loading"><i></i><span>Checking real availability around ${esc(tripAreaCopy(plan))}…</span></div>` : ''}
      ${!loading && results.length ? `<div class="stay-results-head"><div><strong>${results.length} live ${results.length===1?'stay':'stays'}</strong><span>${checkedLabel()}</span></div><small>Lowest total first</small></div><div class="stay-grid">${results.map((item) => stayCard(oldPlan,item,tripNights)).join('')}</div>` : ''}
      ${!loading && checkedAt && !results.length && !lastError ? '<div class="stay-empty"><span>⌕</span><h2>No matching stays found</h2><p>Try removing one requirement or changing the maximum price.</p></div>' : ''}
    </div>`;
  bind();
}
function stayCard(plan, item, tripNights) {
  const change = statusFor(plan, item);
  const amenities = [item.parking ? 'Parking' : '', item.washingMachine ? 'Washing machine' : ''].filter(Boolean);
  const location = clean(item.city) || (selectedArea === 'bergamo' ? 'Bergamo area' : 'Lake Garda area');
  const rating = item.rating ? `★ ${Number(item.rating).toFixed(1)}${item.reviewCount ? ` · ${item.reviewCount} reviews` : ''}` : '';
  return `<article class="stay-card">
    <div class="stay-photo ${item.image?'':'is-placeholder'}" ${item.image?`style="background-image:url(&quot;${esc(item.image)}&quot;)"`:''}><span class="stay-source">Booking.com</span>${item.alsoOnAirbnb ? '<span class="stay-airbnb">Also on Airbnb</span>' : ''}</div>
    <div class="stay-card-body">
      <div class="stay-card-title"><div><h2>${esc(item.name)}</h2><p>${esc(location)}${rating ? ` · ${esc(rating)}` : ''}</p></div><strong>${money(item.price)}</strong></div>
      <div class="stay-card-price"><span>${money(item.nightly)} / night · ${tripNights} ${tripNights===1?'night':'nights'}</span><b class="${change.cls}">${esc(change.text)}</b></div>
      ${amenities.length ? `<div class="stay-amenities">${amenities.map((name)=>`<span>✓ ${esc(name)}</span>`).join('')}</div>` : ''}
      <div class="stay-card-actions"><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">View on Booking.com</a>${item.alsoOnAirbnb && item.airbnbUrl ? `<a class="secondary" href="${esc(item.airbnbUrl)}" target="_blank" rel="noopener noreferrer">Airbnb</a>` : ''}</div>
    </div>
  </article>`;
}
function bind() {
  document.getElementById('stayTripSelect')?.addEventListener('change', (event) => {
    selectedPlanId = event.target.value;
    try { localStorage.setItem(VIEW_KEY, selectedPlanId); } catch {}
    selectedArea = inferArea(selectedPlan());
    results = []; checkedAt = ''; lastError = '';
    render();
  });
  document.querySelectorAll('[data-stay-area]').forEach((button) => button.addEventListener('click', () => {
    selectedArea = button.dataset.stayArea;
    try { localStorage.setItem(AREA_KEY, selectedArea); } catch {}
    results = []; checkedAt = ''; lastError = '';
    render();
  }));
  document.getElementById('staySearchButton')?.addEventListener('click', runSearch);
}
async function runSearch() {
  if (loading) return;
  const plan = selectedPlan();
  if (!plan) return;
  filterState = {
    parking: document.getElementById('stayParking')?.checked === true,
    washingMachine: document.getElementById('stayWashing')?.checked === true,
    maxTotal: document.getElementById('stayMaxTotal')?.value || '',
  };
  const parking = filterState.parking;
  const washingMachine = filterState.washingMachine;
  const maxTotal = Math.max(0, Number(filterState.maxTotal || 0));
  loading = true; lastError = ''; results = [];
  render();
  try {
    const response = await fetch(`${API_BASE}/api/stays/search`, {
      method:'POST', headers:{'Content-Type':'application/json'}, cache:'no-store',
      body:JSON.stringify({ planId:plan.id, area:selectedArea, filters:{ parking, washingMachine, maxTotal } }),
    });
    const json = await response.json();
    if (!response.ok || !json?.ok) throw new Error(json?.error || 'Live Booking.com search failed.');
    results = Array.isArray(json.results) ? json.results : [];
    checkedAt = json.checkedAt || new Date().toISOString();
    const who = actor();
    if (who && results.length) {
      window.TwogetherAPI.post('saveStayTrackerSnapshot', {
        planId:plan.id, area:selectedArea,
        results:results.map((item)=>({ accommodationId:item.id, name:item.name, price:item.price, currency:item.currency, url:item.url, checkedAt })),
      }, who).catch(() => {});
    }
  } catch (error) {
    lastError = error?.message || 'Could not check live Booking.com prices.';
  } finally {
    loading = false;
    render();
  }
}
async function refreshState() {
  try {
    state = await window.TwogetherAPI.remoteState();
    const plans = availablePlans();
    const stored = (() => { try { return localStorage.getItem(VIEW_KEY) || ''; } catch { return ''; } })();
    if (!selectedPlanId) selectedPlanId = plans.some((plan) => plan.id === stored) ? stored : (plans.find((plan)=>plan.meta.end >= todayIso())?.id || plans[0]?.id || '');
    const storedArea = (() => { try { return localStorage.getItem(AREA_KEY) || ''; } catch { return ''; } })();
    selectedArea = storedArea || inferArea(selectedPlan());
    render();
  } catch {
    state = { plans:[] };
    render();
  }
}
export function initStayTracker() {
  refreshState();
  document.addEventListener('twogether:saved', refreshState);
  document.addEventListener('twogether:budget-refreshed', refreshState);
  document.addEventListener('twogether:trips-refreshed', refreshState);
  document.querySelector('[data-sheet="stay-tracker"]')?.addEventListener('click', () => setTimeout(refreshState, 0));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initStayTracker, { once:true });
else initStayTracker();
