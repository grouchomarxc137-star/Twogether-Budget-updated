// Trip gallery + modal, the built-in Monthly/Compare pages (distinct from
// the Compare Lab), and the Activity feed. Extracted from app.js.
//
// Circular import note: this file imports beginEdit/beginJoin from
// wizard.js (for the trip modal's edit/add-own buttons), and wizard.js
// imports closeTripModal/openTripModal from here (beginEdit needs to close
// the modal before showing the wizard). Neither is called at module
// top-level -- both only run from click handlers, well after both modules
// finish loading -- so this is safe under ES module live bindings (unlike
// CommonJS, where it wouldn't be).
import { $, $$ } from '../lib/dom.js';
import { esc, n, money } from '../lib/format.js';
import { actor, otherActor } from '../lib/session.js';
import { toast } from '../lib/toast.js';
import {
  MONEY_FIELDS, MONEY_LABELS, MONTHS, RENT_DEFS, CAR_DEFS,
  locationLabel, tripMeta, isLocked, tripTotalSubmission, differences, effectiveTrip, budgetInfo, fmtDate,
} from './data.js';
import { getState, isBackendV3, postAction, syncNow } from './state.js';
import { beginEdit, beginJoin } from './wizard.js';
import { openSheet, rememberCardView, backFromCardView, dismissCardView } from '../app/navigation.js';
import { tripImage, preloadTripImages } from './trip-images.js';
import { isCarExpense, carExpenseBreakdown } from './car-expenses.js';
import { installCarLongPress, showCarBreakdown } from './car-breakdown-ui.js';

let openTripId = '';
let selectedMonthlyKey = '';
let monthlyViewMode = 'combined';
let monthlyIgnoreClickUntil = 0;

// One historical development-only trip remains in persisted data. Keep it out
// of every user-facing trip view and aggregate without touching stored data.
function isExcludedTestTrip(trip) {
  const meta = tripMeta(trip);
  return String(meta?.city || '').trim().toLowerCase() === 'test'
    && String(meta?.start || '') === '2026-08-01'
    && String(meta?.end || '') === '2026-08-02';
}
function visibleTrips(state = getState()) {
  return (Array.isArray(state?.trips) ? state.trips : []).filter((trip) => !isExcludedTestTrip(trip));
}

export function preloadTripGalleryImages() {
  const state = getState();
  const urls = visibleTrips(state).filter(isLocked).map((trip) => {
    const meta = tripMeta(trip);
    const city = meta.city || locationLabel(meta);
    return tripImage(city, locationLabel(meta), trip.id);
  });
  return preloadTripImages(urls);
}

function hiddenTestCleanupHtml(state) {
  const hidden=(Array.isArray(state?.trips)?state.trips:[]).filter((trip)=>isExcludedTestTrip(trip)&&isLocked(trip));
  return hidden.map((trip)=>'<div class="trip-test-cleanup">'+
    '<span>Hidden test trip · 1–2 August 2026</span>'+
    '<button type="button" data-remove-confirmed-test="'+esc(trip.id)+'">Remove test trip</button>'+
  '</div>').join('');
}
function confirmHiddenTestTripDeletion(id) {
  const trip=(getState()?.trips||[]).find((entry)=>entry.id===id);
  if(!trip||!isExcludedTestTrip(trip)||!isLocked(trip))return;
  document.querySelector('.trip-test-delete-confirm')?.remove();
  const layer=document.createElement('div');
  layer.className='tv2-confirm-layer trip-test-delete-confirm';
  layer.innerHTML=
    '<div class="tv2-confirm-backdrop" data-test-delete-cancel></div>'+
    '<div class="tv2-confirm-card" role="dialog" aria-modal="true" aria-labelledby="testDeleteHeading">'+
      '<h2 id="testDeleteHeading">Remove the test trip?</h2>'+
      '<p>Delete the confirmed <strong>Test</strong> trip from <strong>1–2 August 2026</strong> and its test entries?</p>'+
      '<p class="tv2-confirm-note">Only this test trip will be deleted. Real trips stay untouched. This cannot be undone.</p>'+
      '<p class="tv2-confirm-error" aria-live="polite"></p>'+
      '<div class="tv2-confirm-actions"><button type="button" data-test-delete-cancel>Cancel</button>'+
        '<button type="button" class="is-delete" data-test-delete-approve>Delete test trip</button></div>'+
    '</div>';
  document.body.appendChild(layer);
  const cancel=()=>layer.remove();
  layer.querySelectorAll('[data-test-delete-cancel]').forEach((button)=>button.addEventListener('click',cancel));
  layer.addEventListener('keydown',(e)=>{if(e.key==='Escape')cancel();});
  const approve=layer.querySelector('[data-test-delete-approve]');
  approve.addEventListener('click',async()=>{
    approve.disabled=true;approve.textContent='Deleting…';
    const error=layer.querySelector('.tv2-confirm-error');
    try {
      const result=await postAction('deleteConfirmedTestTrip',{tripId:id},actor());
      if(!result?.ok)throw new Error(result?.error||'Could not remove test trip');
      layer.remove();
      await syncNow(true);
      renderTripGallery();
      renderMonthly();
      toast('The confirmed test trip has been removed');
    } catch(err) {
      approve.disabled=false;approve.textContent='Delete test trip';
      if(error)error.textContent=err?.message||'Could not delete the trip';
    }
  });
  approve.focus();
}
function bindHiddenTestCleanup(root){
  root.querySelectorAll('[data-remove-confirmed-test]').forEach((button)=>
    button.addEventListener('click',()=>confirmHiddenTestTripDeletion(button.dataset.removeConfirmedTest)));
}

export function renderTripGallery() {
  const root = $('#tripGallery');
  if (!root) return;
  const state = getState();
  const trips = visibleTrips(state);
  const cleanup=hiddenTestCleanupHtml(state);
  if (!trips.length) {
    root.innerHTML = '<div class="empty-state gallery-empty"><strong>No trips yet</strong><span>Your shared trips will appear here.</span></div>'+cleanup;
    bindHiddenTestCleanup(root);
    return;
  }

  const sorted = trips.filter(isLocked).sort((a, b) => String(tripMeta(b).start || b.updatedAt || '').localeCompare(String(tripMeta(a).start || a.updatedAt || '')));
  root.innerHTML = sorted.map((t) => {
    const e = effectiveTrip(t), m = tripMeta(t), d = differences(t), budget = budgetInfo(t);
    let status = ''; let statusClass = 'status-wait';
    if (isLocked(t)) { status = 'Confirmed'; statusClass = 'status-ok'; }
    else if (t.submissions.Principessa && t.submissions.Principe && d.length) { status = 'Needs discussion'; statusClass = 'status-warn'; }
    else if (t.submissions.Principessa && t.submissions.Principe) { status = 'Awaiting confirmation'; statusClass = 'status-wait'; }
    else { status = `Waiting for ${t.submissions.Principessa ? 'Principe' : 'Principessa'}`; }
    const city = m.city || locationLabel(m), country = locationLabel(m), image = tripImage(city, country, t.id);
    return `<button class="trip-story-card" type="button" data-open-trip="${esc(t.id)}">
      <span class="trip-story-photo" aria-hidden="true" style="background-image:url(&quot;${esc(image)}&quot;)"></span>
      <div class="trip-card-top"><span class="trip-country">${esc(country)}</span><span class="trip-status ${statusClass}">${esc(status)}</span></div>
      <h3>${esc(city)}</h3><p>${fmtDate(m.start)}–${fmtDate(m.end)}</p>
      <div class="trip-card-bottom"><strong>${e.estimated ? '~ ' : ''}${money(e.total)}</strong><span>${budget.has ? esc(budget.label) : 'No budget set'}</span></div>
      ${!t.submissions?.[actor()] && !isLocked(t) ? '<div class="your-version-needed">Your version is still needed</div>' : ''}
    </button>`;
  }).join('')+cleanup;
  $('[data-open-trip]', root).forEach((btn) => btn.addEventListener('click', () => openTripModal(btn.dataset.openTrip)));
  bindHiddenTestCleanup(root);
}

export function openTripModal(id) {
  openTripId = id;
  const key='trip-story:'+id;
  rememberCardView(key,()=>{openSheet('log');openTripModal(id);});
  renderTripModal(id);
  const modal=$('#tripModal');
  modal?.classList.add('show');
  modal?.setAttribute('aria-hidden', 'false');
  if(modal){
    modal._twogetherBack=()=>backFromCardView(key,()=>closeTripModal(true));
    modal._twogetherHome=()=>closeTripModal(false);
  }
}

export function closeTripModal(preserveHistory = false) {
  const preserve=preserveHistory===true;
  const key=openTripId?'trip-story:'+openTripId:'';
  if(!preserve&&key)dismissCardView(key);
  openTripId = '';
  const modal=$('#tripModal');
  modal?.classList.remove('show');
  modal?.setAttribute('aria-hidden', 'true');
  if(modal&&!preserve){
    modal._twogetherBack=null;
    modal._twogetherHome=null;
  }
}

export function refreshModalIfOpen() {
  if (openTripId && $('#tripModal')?.classList.contains('show')) renderTripModal(openTripId);
}

function renderTripModal(id) {
  const root = $('#tripModalBody');
  const state = getState();
  if (root) root.dataset.tripId = id;
  const t = visibleTrips(state).find((x) => x.id === id);
  if (!root || !t) return;
  const e = effectiveTrip(t), m = tripMeta(t), diff = differences(t), budget = budgetInfo(t);
  const both = !!(t.submissions.Principessa && t.submissions.Principe);
  const locked = isLocked(t);
  const own = !!t.submissions?.[actor()];
  const canConfirm = isBackendV3() && both && !diff.length && !locked && !t.confirmed?.[actor()];

  let statusHtml = '';
  if (locked) {
    statusHtml = '<div class="match-box ok"><strong>Confirmed by both of you.</strong><span>This trip is now locked and treated as final.</span></div>';
  } else if (!both) {
    statusHtml = `<div class="match-box"><strong>Waiting for ${t.submissions.Principessa ? 'Principe' : 'Principessa'}.</strong><span>Matching can be checked after both versions are logged.</span></div>`;
  } else if (diff.length) {
    statusHtml = `<div class="match-box warn"><strong>Your calculations differ.</strong><span>Discuss the highlighted amounts, then each person can edit their own version until they match.</span></div>`;
  } else {
    const p = t.confirmed?.Principessa ? '✓' : '○', q = t.confirmed?.Principe ? '✓' : '○';
    statusHtml = `<div class="match-box ok"><strong>Your calculations match.</strong><span>${p} Principessa confirmed · ${q} Principe confirmed. Both confirmations lock the trip.</span></div>`;
  }

  root.innerHTML = `
    <div class="trip-modal-heading"><span class="eyebrow">${esc(locationLabel(m))}</span><h2>${esc(m.city || locationLabel(m))}</h2><p>${fmtDate(m.start)}–${fmtDate(m.end)}</p></div>
    <div class="trip-modal-total"><span>Current trip total</span><strong>${e.estimated ? '~ ' : ''}${money(e.total)}</strong></div>
    ${statusHtml}
    <div class="budget-check ${budget.tone}"><div><span>Planned budget</span><strong>${e.budget ? money(e.budget) : 'Not set'}</strong></div><div><span>Actual / current total</span><strong>${money(e.total)}</strong></div><div class="budget-result"><span>Budget check</span><strong>${esc(budget.label)}</strong></div></div>
    ${diff.length ? `<div class="difference-list"><h3>What differs</h3>${diff.map((x) => `<div class="difference-row"><strong>${esc(x.label)}</strong><span>Principessa: ${esc(x.a)}</span><span>Principe: ${esc(x.b)}</span></div>`).join('')}</div>` : ''}
    <div class="submission-grid">${submissionCard('Principessa', t.submissions.Principessa)}${submissionCard('Principe', t.submissions.Principe)}</div>
    <div class="trip-modal-actions">
      ${!locked && own ? '<button class="btn" type="button" data-edit-own>Edit my calculations</button>' : ''}
      ${!locked && !own && t.submissions?.[otherActor()] ? '<button class="btn" type="button" data-add-own>Add my version</button>' : ''}
      ${canConfirm ? '<button class="btn primary" type="button" data-confirm-own>Confirm my version</button>' : ''}
      ${!isBackendV3() && both && !diff.length ? '<span class="backend-inline-note">Backend v3 is needed before confirmation can be saved.</span>' : ''}
    </div>`;

  root.querySelectorAll('[data-trip-car-breakdown]').forEach((trigger)=>installCarLongPress(trigger,()=>{
    const total=n(e.fuel)+n(e.tolls);
    const plan=(Array.isArray(state.plans)?state.plans:[]).find((item)=>item.linkedTripId===t.id);
    const details=carExpenseBreakdown(plan?.expenseEntries);
    const recordedFuel=details.find((g)=>g.kind==='fuel')?.amount||0;
    const recordedOther=details.filter((g)=>g.kind!=='fuel').reduce((sum,g)=>sum+g.amount,0);
    const legacyFuel=Math.max(0,n(e.fuel)-recordedFuel);
    const legacyOther=Math.max(0,n(e.tolls)-recordedOther);
    if(legacyFuel>.005)details.push({kind:'older-fuel',label:'Fuel (older)',amount:legacyFuel,items:[]});
    if(legacyOther>.005)details.push({kind:'older-car',label:'Tolls / Parking (older)',amount:legacyOther,items:[]});
    showCarBreakdown('Car · '+(m.city||'Trip'),details,total);
  }));
  $('[data-edit-own]', root)?.addEventListener('click', () => beginEdit(id));
  $('[data-add-own]', root)?.addEventListener('click', () => { closeTripModal(true); openSheet('log'); beginJoin(id); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('[data-confirm-own]', root)?.addEventListener('click', async () => {
    try { await postAction('confirmTrip', { id }, actor()); toast('Your confirmation was saved'); await syncNow(true); }
    catch (err) { toast(err.message || 'Could not confirm', 'warn'); }
  });
}

function submissionCard(name, s) {
  if (!s) return `<div class="submission-card missing"><span>${esc(name)}</span><strong>Not logged yet</strong></div>`;
  const fields=[...MONEY_FIELDS.filter((key)=>key!=='fuel'&&key!=='tolls'),'car'];
  const html=fields.map((key)=>{
    const car=key==='car',amount=car?n(s.fuel)+n(s.tolls):n(s[key]);
    const uncertain=car?!!(s?.uncertain?.fuel||s?.uncertain?.tolls):!!s?.uncertain?.[key];
    const categoryLabel=car?'Car':key==='travel'?'Transport':MONEY_LABELS[key];
    if(car)return '<button type="button" class="trip-car-breakdown-trigger" data-trip-car-breakdown aria-label="View Car expense breakdown"><span><i class="trip-car-ball" aria-hidden="true"></i>'+esc(categoryLabel)+'</span><b>'+(uncertain?'~ ':'')+money(amount)+'</b></button>';
    return '<div><span>'+esc(categoryLabel)+'</span><b>'+(uncertain?'~ ':'')+money(amount)+'</b></div>';
  }).join('');
  return `<div class="submission-card"><span>${esc(name)}</span><strong>${money(tripTotalSubmission(s))}</strong><small>Paid: ${money(s.paid)}</small><div class="submission-mini">${html}</div></div>`;
}

const MONTHLY_CATEGORY_COLORS = {
  accom: '#819174',
  groceries: '#c89d56',
  eat: '#c77f68',
  travel: '#7188a1',
  car: '#a88d57',
  fuel: '#a88d57',
  tolls: '#8d7b6d',
  other: '#b6aaa0',
};

function fullMonthLabel(key) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!match) return String(key || '');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

const MONTHLY_DISPLAY_FIELDS=['accom','groceries','eat','travel','car','other'];
const monthlyDisplayAmount=(stat,key)=>key==='car'?Math.max(0,n(stat?.fuel)+n(stat?.tolls)):Math.max(0,n(stat?.[key]));
function monthlyDonutGradient(stat) {
  const values = MONTHLY_DISPLAY_FIELDS.map((key)=>monthlyDisplayAmount(stat,key));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= .005) return 'conic-gradient(#e8e2d9 0 100%)';
  let cursor = 0;
  const stops = [];
  MONTHLY_DISPLAY_FIELDS.forEach((key, index) => {
    const value = values[index];
    if (value <= .005) return;
    const start = cursor;
    cursor += (value / total) * 100;
    stops.push(`${MONTHLY_CATEGORY_COLORS[key]} ${start.toFixed(3)}% ${cursor.toFixed(3)}%`);
  });
  return `conic-gradient(${stops.join(',')})`;
}

function monthlyEntryKey(entry) {
  if (entry?.category === 'accommodation') return 'accom';
  if (entry?.category === 'food') return entry.foodType === 'groceries' ? 'groceries' : 'eat';
  if (entry?.category === 'transport') {
    if (entry.transportType === 'fuel') return 'fuel';
    if (isCarExpense(entry)) return 'tolls';
    return 'travel';
  }
  return 'other';
}

function monthlyRepaymentKey(repayment) {
  const map = {
    stay: 'accom',
    transport: 'travel',
    car: 'fuel',
    groceries: 'groceries',
    'eating-out': 'eat',
    activities: 'other',
    other: 'other',
  };
  return map[repayment?.category] || 'other';
}

function personalMonthlyStat(state, monthKey, person, tripCount) {
  const stat = { key: monthKey, trips: tripCount, accom:0, groceries:0, eat:0, travel:0, fuel:0, tolls:0, other:0, total:0, estimated:false, detailed:false };
  const plans = (Array.isArray(state?.plans) ? state.plans : []).filter((plan) => String(plan?.meta?.start || '').slice(0,7) === monthKey);
  plans.forEach((plan) => {
    const entries = Array.isArray(plan?.expenseEntries) ? plan.expenseEntries : [];
    if (entries.length) stat.detailed = true;
    entries.forEach((entry) => {
      const amount = Math.max(0, n(entry?.amount) - n(entry?.jarContribution));
      if (amount <= .005) return;
      const key = monthlyEntryKey(entry);
      let paid = 0;
      if (entry?.paidBy === 'both') paid = amount / 2;
      else if (entry?.paidBy === person) paid = amount;
      stat[key] += paid;
      stat.estimated = stat.estimated || !!entry?.uncertain;
    });
    const repayments = Array.isArray(plan?.repayments) ? plan.repayments : [];
    repayments.forEach((repayment) => {
      const amount = Math.max(0, n(repayment?.amount));
      if (amount <= .005) return;
      const key = monthlyRepaymentKey(repayment);
      if (repayment?.from === person) stat[key] += amount;
      if (repayment?.to === person) stat[key] -= amount;
    });
  });
  MONEY_FIELDS.forEach((key) => { stat[key] = Math.max(0, n(stat[key])); });
  stat.total = MONEY_FIELDS.reduce((sum, key) => sum + stat[key], 0);
  return stat;
}

export function renderMonthly() {
  const body = $('#monthlyBody');
  if (!body) return;
  const trips = visibleTrips().map(effectiveTrip);
  const stats = MONTHS.map(([key, label]) => {
    const monthTrips = trips.filter((t) => String(t.start || '').slice(0, 7) === key);
    const s = { key, label, trips: monthTrips.length, accom: 0, groceries: 0, eat: 0, travel: 0, fuel: 0, tolls: 0, other: 0, total: 0, estimated: false };
    monthTrips.forEach((t) => {
      MONEY_FIELDS.forEach((k) => s[k] += n(t[k]));
      s.total += t.total; s.estimated = s.estimated || t.estimated;
    });
    return s;
  });

  const total = stats.reduce((sum, month) => sum + month.total, 0);
  const tripCount = stats.reduce((sum, month) => sum + month.trips, 0);
  const activeMonths = stats.filter((month) => month.trips > 0).length || 1;
  $('#kpiTotal').textContent = money(total);
  $('#kpiMonth').textContent = money(total / activeMonths);
  $('#kpiPerson').textContent = money(total / activeMonths / 2);
  $('#kpiTrip').textContent = money(tripCount ? total / tripCount : 0);
  $('#kpiTrips').textContent = String(tripCount);

  const keys = stats.map((month) => month.key);
  if (!keys.includes(selectedMonthlyKey)) {
    const now = new Date();
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const latestActive = [...stats].reverse().find((month) => month.trips > 0);
    selectedMonthlyKey = keys.includes(currentKey) ? currentKey : (latestActive?.key || keys[0] || '');
  }

  const index = Math.max(0, keys.indexOf(selectedMonthlyKey));
  const selectedCombined = stats[index] || stats[0];
  if (!selectedCombined) {
    body.innerHTML = '<div class="empty-state"><strong>No monthly data yet</strong></div>';
    return;
  }

  const me = actor();
  const personal = monthlyViewMode === 'personal';
  const selected = personal ? personalMonthlyStat(getState(), selectedCombined.key, me, selectedCombined.trips) : selectedCombined;
  const categories = MONTHLY_DISPLAY_FIELDS.map((key) => ({
    key,
    label: key==='car'?'Car':key==='travel'?'Transport':MONEY_LABELS[key],
    amount: monthlyDisplayAmount(selected,key),
    color: MONTHLY_CATEGORY_COLORS[key],
  })).filter((item) => item.amount > .005);
  const categoryHtml = categories.length
    ? categories.map((item) => {
        const percent = selected.total > .005 ? (item.amount / selected.total) * 100 : 0;
        const content='<i style="--trip-monthly-color:'+item.color+'" aria-hidden="true"></i><span><strong>'+esc(item.label)+'</strong><small>'+percent.toFixed(0)+'% of '+(personal?'your spending':'this month')+'</small></span><b>'+money(item.amount)+'</b>';
        return item.key==='car'
          ?'<button class="trip-monthly-category trip-car-breakdown-trigger" data-trip-monthly-car type="button" aria-label="Show Car spending breakdown">'+content+'</button>'
          :'<div class="trip-monthly-category">'+content+'</div>';
      }).join('')
    : `<div class="trip-monthly-empty">${personal && !selected.detailed ? 'No detailed personal payer data is available for this month.' : personal ? 'You have no personal Trip spending logged for this month.' : 'No trip spending logged for this month.'}</div>`;

  const options = stats.map((month) => `<option value="${esc(month.key)}" ${month.key === selectedCombined.key ? 'selected' : ''}>${esc(fullMonthLabel(month.key))}</option>`).join('');
  const tripLabel = selectedCombined.trips === 1 ? '1 trip' : `${selectedCombined.trips} trips`;
  const personalClass = personal ? ` is-personal is-${me.toLowerCase()}` : '';
  const modeLabel = personal ? me : 'Together';
  const detailLine = personal
    ? (selected.detailed ? `${money(selected.total)} paid by you` : 'Personal payer details unavailable')
    : (selectedCombined.trips ? `${money(selectedCombined.total / 2)} per person` : 'Nothing spent on trips yet');
  const toggleHint = personal ? 'Tap for Together · swipe months' : `Tap for ${esc(me)} · swipe months`;
  body.innerHTML = `
    <div class="trip-monthly-nav">
      <button type="button" data-month-prev aria-label="Previous month" ${index <= 0 ? 'disabled' : ''}>‹</button>
      <label class="trip-monthly-picker">
        <select id="tripMonthlyPicker" aria-label="Choose month">${options}</select>
        <span aria-hidden="true">⌄</span>
      </label>
      <button type="button" data-month-next aria-label="Next month" ${index >= stats.length - 1 ? 'disabled' : ''}>›</button>
    </div>
    <section class="trip-monthly-card${personalClass}" data-month-swipe data-month-toggle role="button" tabindex="0" aria-label="Show ${personal ? 'combined' : 'your personal'} monthly trip spending">
      <span class="trip-monthly-mode">${esc(modeLabel)}</span>
      <div class="trip-monthly-visual">
        <div class="trip-monthly-donut" style="--trip-monthly-donut:${monthlyDonutGradient(selected)}">
          <div class="trip-monthly-donut-center">
            <span>${personal ? 'You spent' : 'Total spent'}</span>
            <strong>${selected.estimated ? '~ ' : ''}${money(selected.total)}</strong>
          </div>
        </div>
        <div class="trip-monthly-meta">
          <span class="panel-kicker">${esc(fullMonthLabel(selectedCombined.key))}</span>
          <h2>${esc(tripLabel)}</h2>
          <p>${detailLine}${selected.estimated ? ' · includes estimates' : ''}</p>
        </div>
      </div>
      <div class="trip-monthly-breakdown-head"><h3>${personal ? 'Your spending' : 'Where it went'}</h3><span>${toggleHint}</span></div>
      <div class="trip-monthly-breakdown">${categoryHtml}</div>
    </section>`;

  const move = (step) => {
    const nextIndex = Math.max(0, Math.min(stats.length - 1, index + step));
    if (nextIndex === index) return;
    selectedMonthlyKey = stats[nextIndex].key;
    renderMonthly();
  };
  $('[data-month-prev]', body)?.addEventListener('click', () => move(-1));
  $('[data-month-next]', body)?.addEventListener('click', () => move(1));
  $('#tripMonthlyPicker', body)?.addEventListener('change', (event) => {
    selectedMonthlyKey = event.target.value;
    renderMonthly();
  });

  const carTrigger=body.querySelector('[data-trip-monthly-car]');
  installCarLongPress(carTrigger,()=>{
    const currentState=getState();
    const matchingPlans=(Array.isArray(currentState.plans)?currentState.plans:[]).filter((plan)=>String(plan?.meta?.start||'').slice(0,7)===selectedCombined.key);
    const details=carExpenseBreakdown(matchingPlans.flatMap((plan)=>Array.isArray(plan.expenseEntries)?plan.expenseEntries:[]),{payer:personal?me:''});
    const shownAmount=monthlyDisplayAmount(selected,'car');
    const recordedFuel=details.find((g)=>g.kind==='fuel')?.amount||0;
    const recordedOther=details.filter((g)=>g.kind!=='fuel').reduce((sum,g)=>sum+g.amount,0);
    const legacyFuel=Math.max(0,n(selected.fuel)-recordedFuel);
    const legacyOther=Math.max(0,n(selected.tolls)-recordedOther);
    if(legacyFuel>.005)details.push({kind:'older-fuel',label:'Fuel (older)',amount:legacyFuel,items:[]});
    if(legacyOther>.005)details.push({kind:'older-car',label:'Tolls / Parking (older)',amount:legacyOther,items:[]});
    showCarBreakdown('Car · '+fullMonthLabel(selectedCombined.key),details,shownAmount);
  });
  const toggleMonthlyView = () => {
    monthlyViewMode = monthlyViewMode === 'personal' ? 'combined' : 'personal';
    renderMonthly();
  };
  const swipe = $('[data-month-swipe]', body);
  if (swipe) {
    let startX = 0, startY = 0, tracking = false;
    swipe.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button,select,input,a')) return;
      startX = event.clientX; startY = event.clientY; tracking = true;
    });
    swipe.addEventListener('pointerup', (event) => {
      if (!tracking) return;
      tracking = false;
      const dx = event.clientX - startX, dy = event.clientY - startY;
      if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.15) return;
      monthlyIgnoreClickUntil = Date.now() + 350;
      move(dx < 0 ? 1 : -1);
    });
    swipe.addEventListener('pointercancel', () => { tracking = false; });
    swipe.addEventListener('click', (event) => {
      if (Date.now() < monthlyIgnoreClickUntil || event.target.closest('button,select,input,a')) return;
      toggleMonthlyView();
    });
    swipe.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleMonthlyView();
    });
  }
}

function actualCurrentSituation() {
  const trips = visibleTrips().filter((t) => {
    const start = tripMeta(t).start || '';
    return start >= '2026-01-01' && start <= '2026-12-31';
  });
  const months = new Set(trips.map((t) => String(tripMeta(t).start || '').slice(0, 7)).filter(Boolean));
  const divisor = months.size || 1;
  const p = trips.reduce((sum, t) => sum + n(t?.submissions?.Principessa?.paid), 0) / divisor;
  const q = trips.reduce((sum, t) => sum + n(t?.submissions?.Principe?.paid), 0) / divisor;
  return { principessa: p, principe: q, total: p + q, trips: trips.length };
}

export function renderCompare() {
  const rentRoot = $('#rentRows'), carRoot = $('#carRows');
  if (rentRoot) rentRoot.innerHTML = compareRowsHtml(RENT_DEFS);
  if (carRoot) carRoot.innerHTML = compareRowsHtml(CAR_DEFS);
  $$('[data-compare-key]').forEach((input) => input.addEventListener('change', async () => {
    const key = input.dataset.compareKey;
    const value = n(input.value);
    getState().compare[key] = value;
    renderCompareNumbers();
    try { await postAction('updateCompare', { key, value }, actor()); }
    catch (err) { toast('Could not save comparison', 'warn'); }
  }));
  renderCompareNumbers();
}

function compareRowsHtml(defs) {
  const compare = getState().compare;
  return defs.map(([label, key]) => `<div class="r"><span>${esc(label)}</span><strong class="editable"><input type="number" min="0" step="1" data-compare-key="${esc(key)}" value="${esc(compare[key])}"></strong></div>`).join('');
}

function renderCompareNumbers() {
  const compare = getState().compare;
  const current = actualCurrentSituation();
  const rent = RENT_DEFS.reduce((sum, [, k]) => sum + n(compare[k]), 0);
  const car = CAR_DEFS.reduce((sum, [, k]) => sum + n(compare[k]), 0);
  if ($('#currentAvg')) $('#currentAvg').textContent = money(current.total);
  if ($('#yourShare')) $('#yourShare').textContent = money(current.principessa);
  if ($('#hisShare')) $('#hisShare').textContent = money(current.principe);
  if ($('#tripAvg')) $('#tripAvg').textContent = String(current.trips);

  const values = {
    snapCurrent: current.total,
    snapCurrentCar: current.total + car,
    snapRent: rent,
    snapRentCar: rent + car,
    snapCurrentRent: current.total + rent,
    snapAll: current.total + rent + car,
  };
  Object.entries(values).forEach(([id, val]) => { const el = $('#' + id); if (el) el.textContent = money(val); });
}

let activityReady = false;
let lastActivityKey = '';

function hideActivityWhisper(card) {
  card.classList.remove('activity-fresh');
  card.setAttribute('aria-hidden', 'true');
}

function scheduleActivityHide(card, delay = 3500) {
  clearTimeout(card._activityFadeTimer);
  card._activityFadeTimer = setTimeout(() => hideActivityWhisper(card), delay);
}

function bindActivityHover(card) {
  if (card._activityHoverBound) return;
  card._activityHoverBound = true;
  card.addEventListener('mouseenter', () => clearTimeout(card._activityFadeTimer));
  card.addEventListener('mouseleave', () => {
    if (card.classList.contains('activity-fresh')) scheduleActivityHide(card, 1200);
  });
}

export function renderActivity() {
  const root = $('#activityList');
  if (!root) return;
  const card = root.closest('.activity-whisper');
  const state = getState();
  const latest = [...(state.audit || [])].slice(-1)[0] || null;

  if (!latest) {
    root.innerHTML = '';
    if (card) hideActivityWhisper(card);
    if (!activityReady && state.updatedAt) activityReady = true;
    return;
  }

  const t = state.trips.find((x) => x.id === latest.ref);
  const place = t ? (tripMeta(t).city || locationLabel(tripMeta(t))) : '';
  const labels = {
    addSubmission: 'added a trip version', updateSubmission: 'edited a trip version', confirmTrip: 'confirmed a trip',
    updateCompare: 'updated the comparison',
    saveSharedExpense: 'saved shared expense', savePlanPartial: 'saved trip expense', savePlanSubmission: 'saved trip expenses',
    saveSubmission: 'saved a trip version', saveFinanceMonth: 'saved monthly finances',
  };
  const raw = String(latest.action || ''); const [actionKey, ...actionDetail] = raw.split(':');
  const action = labels[actionKey] || raw || 'made a change'; const detail = actionDetail.join(':');
  const suffix = detail ? `: ${esc(detail)}` : place ? ` · ${esc(place)}` : '';
  root.innerHTML = `<div class="activity-item"><span class="avatar-mini">${esc(String(latest.actor || '?').slice(0, 1))}</span><div><strong>${esc(latest.actor || 'Unknown')}</strong> ${esc(action)}${suffix}<small>${formatTime(latest.at)}</small></div></div>`;

  const latestKey = String(latest.id || `${latest.at || ''}|${latest.actor || ''}|${latest.action || ''}|${latest.ref || ''}`);
  if (!activityReady) {
    activityReady = true;
    lastActivityKey = latestKey;
  } else {
    if (latestKey === lastActivityKey) return;
    lastActivityKey = latestKey;
  }

  if (card) {
    bindActivityHover(card);
    card.classList.remove('activity-fresh');
    void card.offsetWidth;
    card.classList.add('activity-fresh');
    card.setAttribute('aria-hidden', 'false');
    scheduleActivityHide(card);
  }
}

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function renderDataViews() {
  renderTripGallery();
  renderMonthly();
  renderCompare();
}

window.TwogetherApp = { open: openTripModal };
