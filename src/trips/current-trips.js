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
import { esc, n, money, fmtDate, uid } from '../lib/format.js';
import { actor } from '../lib/session.js';
import { toast } from '../lib/toast.js';
import { openSheet, rememberCardView, backFromCardView, dismissCardView } from '../app/navigation.js';
import { tripImage, preloadTripImages } from './trip-images.js';
import { isCarExpense, carExpenseLabel, CAR_TYPES, carExpenseSubtype } from './car-expenses.js';
import { recurringBudgetItems, budgetProgressForMonth, budgetKeyForItem } from '../finances/main-budgets.js';

const MONEY_KEYS = ['travel', 'accom', 'fuel', 'groceries', 'eat', 'tolls', 'other'];
const PARTIAL_ORDER = ['travel', 'accom', 'fuel', 'groceries', 'eat', 'tolls', 'other'];
const LABELS = { travel: 'Transport', accom: 'Accommodation', fuel: 'Car · Fuel', groceries: 'Groceries', eat: 'Eating out', tolls: 'Car · Tolls / Parking', other: 'Other' };

let remoteState = null;
let refreshing = false;
let overlayObserver = null;
let storyObserver = null;
let simplifiedView = { name: 'home', planId: '', budgetMode: 'combined' };
let simplifiedLayer = null;
let simplifiedSnackTimer = null;
let tripSwipe = { tracking:false, active:false, mode:'', startX:0, startY:0, lastX:0, lastY:0 };
let cardSwipe = { tracking:false, active:false, startX:0, startY:0, lastX:0, row:null, direction:'', ignoreClickUntil:0 };
let expenseSwipe = { tracking:false, active:false, startX:0, startY:0, lastX:0, row:null, ignoreClickUntil:0 };
let deleteConfirmLayer = null;
let tripNotificationTimer = null;
let nextPackingBoundaryTimer = null;
let tripFocusScrollY = 0;
let startupReadySent = false;

function markStartupReady() {
  if (startupReadySent) return;
  startupReadySent = true;
  document.dispatchEvent(new CustomEvent('twogether:startup-ready'));
}

function has(v) { return v !== '' && v != null; }
function isLocked(t) { return !!(t?.confirmed?.Principessa && t?.confirmed?.Principe); }
function tripMeta(t) { return t?.submissions?.[t?.createdBy] || t?.submissions?.Principessa || t?.submissions?.Principe || {}; }
function locationLabel(m) { return m?.location === 'Other' ? (m.otherLocation || 'Other') : (m?.location || '—'); }
function localDate(value) { if (!value) return null; const d = new Date(value + 'T12:00:00'); return Number.isNaN(d.getTime()) ? null : d; }
function localToday() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); }
function dayDiff(a, b) { return Math.round((b - a) / 86400000); }
function localDateKey(date=new Date()) {
  const pad=(value)=>String(value).padStart(2,'0');
  return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());
}
function returnPackingResetDue(plan, today=localDateKey()) {
  const start=String(plan?.meta?.start||''), end=String(plan?.meta?.end||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return false;
  if(plan?.prep?.returnPackingResetEnd===end||end<start)return false;
  const endDay=localDate(end);
  if(!endDay)return false;
  const resetDay=localDateKey(new Date(endDay.getFullYear(),endDay.getMonth(),endDay.getDate()-1));
  if(today<start||today<resetDay||today>end)return false;
  const linked=plan?.linkedTripId&&(remoteState?.trips||[]).find((item)=>item.id===plan.linkedTripId);
  return !linked||!isLocked(linked);
}
async function applyReturnPackingReset(plan) {
  if(!actor()||!returnPackingResetDue(plan))return false;
  const result=await window.TwogetherAPI.post('resetReturnPacking',{planId:plan.id,localDate:localDateKey()},actor());
  if(!result?.ok)throw new Error(result?.error||'Could not refresh return packing');
  if(result.prep)plan.prep=JSON.parse(JSON.stringify(result.prep));
  return !!result.reset;
}
async function refreshReturnPackingResets() {
  for(const plan of (remoteState?.plans||[])){
    if(!returnPackingResetDue(plan))continue;
    try{await applyReturnPackingReset(plan);}
    catch(error){console.warn('Return packing reset could not be saved:',error);}
  }
}
function schedulePackingBoundaryRefresh() {
  if(nextPackingBoundaryTimer)clearTimeout(nextPackingBoundaryTimer);
  const now=new Date();
  const tomorrow=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,0,0,4);
  nextPackingBoundaryTimer=setTimeout(()=>{
    nextPackingBoundaryTimer=null;
    refreshState(false);
    schedulePackingBoundaryRefresh();
  },Math.max(1000,tomorrow-now));
}

function tripTiming(meta) {
  const start = localDate(meta?.start), end = localDate(meta?.end), now = localToday();
  if (!start || !end) return '';
  if (now < start) { const days = Math.max(1, dayDiff(now, start)); return `Starts in ${days} day${days === 1 ? '' : 's'}`; }
  if (now <= end) { const total = Math.max(1, dayDiff(start, end) + 1), day = Math.max(1, Math.min(total, dayDiff(start, now) + 1)); return `Day ${day} of ${total}`; }
  return 'Past trip';
}
function shortDate(value) { const d = localDate(value); return d ? `${d.getDate()} ${d.toLocaleDateString('en-GB',{month:'short'})}` : ''; }
function shortRange(start, end) {
  const a = localDate(start), b = localDate(end); if (!a || !b) return '';
  const am = a.toLocaleDateString('en-GB',{month:'short'}), bm = b.toLocaleDateString('en-GB',{month:'short'});
  return am === bm ? `${a.getDate()}–${b.getDate()} ${bm}` : `${a.getDate()} ${am}–${b.getDate()} ${bm}`;
}
function cardMoney(value) {
  return money(value);
}

function simplifyStaticCopy() {
  const compare = $('#compare .page-heading'); if (compare) { const eyebrow = $('.eyebrow', compare); if (eyebrow) eyebrow.textContent = ''; const p = $('p', compare); if (p) p.textContent = 'Compare your current costs with possible next steps.'; }
  const storyHeading = $('#log .trip-gallery-section .section-heading'); if (storyHeading) { $('.panel-kicker', storyHeading)?.replaceChildren(document.createTextNode('CONFIRMED')); const h = $('h2', storyHeading); if (h) h.textContent = 'Trip stories'; const p = $('p', storyHeading); if (p) p.textContent = 'Only trips confirmed by both of you appear here.'; }
}

function ensureCurrentTrips() {
  const gallery = $('#log .trip-gallery-section'); if (!gallery) return null;
  let section = $('#twCurrentTripsSection');
  if (!section) {
    section = document.createElement('section');
    section.id = 'twCurrentTripsSection';
    gallery.parentNode.insertBefore(section, gallery);
  }
  if (section.dataset.tv2Full !== '1') {
    section.className = 'tv2-current-host';
    section.innerHTML = '<div id="twCurrentTrips" class="tv2-root"></div>';
    section.dataset.tv2Full = '1';
    section.addEventListener('click', handleSimplifiedClick);
    section.addEventListener('keydown', (e) => {
      const budgetInput = e.target.closest('[data-personal-budget-input]');
      if (budgetInput && e.key === 'Enter') {
        e.preventDefault();
        section.querySelector('[data-act="save-my-budget"]')?.click();
        return;
      }
      if (e.target.closest('[data-act="add-my-budget"], [data-act="edit-my-budget"], [data-act="save-my-budget"], [data-act="cancel-budget-editor"]')) return;
      const card = e.target.closest('[data-act="toggle-budget-view"]');
      if (!card || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      card.click();
    });
    bindSimplifiedSwipe(section);
    bindCardDeleteSwipe(section);
    bindExpenseDeleteSwipe(section);
  }
  return section;
}

function expenseTotal(plan, trip) {
  const entries = tripEntries(plan);
  if (entries.length) {
    return entries.reduce((sum, entry) => {
      const amount = Math.max(0, n(entry?.amount));
      const jar = Math.min(amount, Math.max(0, n(entry?.jarContribution)));
      return sum + (amount - jar);
    }, 0);
  }

  const a = trip?.submissions?.Principessa || plan?.partials?.Principessa || {};
  const b = trip?.submissions?.Principe || plan?.partials?.Principe || {};
  return MONEY_KEYS.reduce((sum, key) => {
    const shared = plan?.sharedExpenses?.[key] || trip?.sharedExpenses?.[key];
    const total = has(shared?.total)
      ? n(shared.total)
      : (() => {
          const av = has(a?.[key]) ? n(a[key]) : null, bv = has(b?.[key]) ? n(b[key]) : null;
          if (av != null && bv != null) return Math.max(av, bv);
          return av ?? bv ?? 0;
        })();
    const jar = key === 'accom' ? Math.min(total, Math.max(0, n(shared?.accommodation?.jarContribution))) : 0;
    return sum + Math.max(0, total - jar);
  }, 0);
}

function tripEntries(plan) {
  return Array.isArray(plan?.expenseEntries) ? plan.expenseEntries : [];
}
function tripRepayments(plan) {
  return Array.isArray(plan?.repayments) ? plan.repayments : [];
}
function settlementState(plan) {
  const paid = { Principessa:0, Principe:0 }, share = { Principessa:0, Principe:0 };
  for (const entry of tripEntries(plan)) {
    const remaining = Math.max(0, n(entry.amount) - n(entry.jarContribution));
    if (entry.paidBy === 'both') { paid.Principessa += remaining / 2; paid.Principe += remaining / 2; }
    else if (paid[entry.paidBy] != null) paid[entry.paidBy] += remaining;
    if (entry.split === 'personal') share[entry.forActor === 'Principe' ? 'Principe' : 'Principessa'] += remaining;
    else { share.Principessa += remaining / 2; share.Principe += remaining / 2; }
  }
  for (const repayment of tripRepayments(plan)) {
    const value = n(repayment.amount);
    if (repayment.from === 'Principessa' && repayment.to === 'Principe') { paid.Principessa += value; paid.Principe -= value; }
    else if (repayment.from === 'Principe' && repayment.to === 'Principessa') { paid.Principe += value; paid.Principessa -= value; }
  }
  const delta = paid.Principessa - share.Principessa;
  if (Math.abs(delta) < .005) return { debtor:'', creditor:'', amount:0, paid, share };
  return {
    debtor: delta > 0 ? 'Principe' : 'Principessa',
    creditor: delta > 0 ? 'Principessa' : 'Principe',
    amount: Math.abs(delta),
    paid,
    share,
  };
}
function debtCategoryKey(entry) {
  if (entry?.category === 'accommodation') return 'stay';
  if (entry?.category === 'transport') return isCarExpense(entry) ? 'car' : 'transport';
  if (entry?.category === 'food') return entry.foodType === 'groceries' ? 'groceries' : 'eating-out';
  if (entry?.category === 'activities') return 'activities';
  return 'other';
}
function categorySettlementState(plan, key) {
  const paid = { Principessa:0, Principe:0 }, share = { Principessa:0, Principe:0 };
  for (const entry of tripEntries(plan)) {
    if (debtCategoryKey(entry) !== key) continue;
    const remaining = Math.max(0, n(entry.amount) - n(entry.jarContribution));
    if (entry.paidBy === 'both') { paid.Principessa += remaining / 2; paid.Principe += remaining / 2; }
    else if (paid[entry.paidBy] != null) paid[entry.paidBy] += remaining;
    if (entry.split === 'personal') share[entry.forActor === 'Principe' ? 'Principe' : 'Principessa'] += remaining;
    else { share.Principessa += remaining / 2; share.Principe += remaining / 2; }
  }
  for (const repayment of tripRepayments(plan)) {
    if (repayment.category !== key) continue;
    const value = n(repayment.amount);
    if (repayment.from === 'Principessa' && repayment.to === 'Principe') { paid.Principessa += value; paid.Principe -= value; }
    else if (repayment.from === 'Principe' && repayment.to === 'Principessa') { paid.Principe += value; paid.Principessa -= value; }
  }
  const delta = paid.Principessa - share.Principessa;
  if (Math.abs(delta) < .005) return { debtor:'', creditor:'', amount:0, paid, share };
  return {
    debtor: delta > 0 ? 'Principe' : 'Principessa',
    creditor: delta > 0 ? 'Principessa' : 'Principe',
    amount: Math.abs(delta),
    paid, share,
  };
}
function owedCategoryBreakdown(plan, person = actor()) {
  const keys = ['stay','transport','car','groceries','eating-out','activities','other'];
  const balances = Object.fromEntries(keys.map((key)=>[key,0]));
  const opened = Object.fromEntries(keys.map((key)=>[key,'']));
  let pendingPositive = 0, pendingNegative = 0;

  const sign = (value) => value > .005 ? 1 : value < -.005 ? -1 : 0;
  const applyDelta = (key, delta, stamp) => {
    const before = balances[key] || 0, beforeSign = sign(before);
    balances[key] = before + delta;
    const afterSign = sign(balances[key]);
    if (!afterSign) {
      balances[key] = 0;
      opened[key] = '';
    } else if (afterSign !== beforeSign) {
      opened[key] = stamp;
    }
  };
  const consumePending = (key, stamp) => {
    if (balances[key] < -.005 && pendingPositive > .005) {
      const used = Math.min(pendingPositive, -balances[key]);
      applyDelta(key, used, stamp);
      pendingPositive -= used;
    }
    if (balances[key] > .005 && pendingNegative > .005) {
      const used = Math.min(pendingNegative, balances[key]);
      applyDelta(key, -used, stamp);
      pendingNegative -= used;
    }
  };
  const consumeLegacy = (effect, stamp) => {
    const wantsNegative = effect > 0;
    let remaining = Math.abs(effect);
    const eligible = keys.filter((key)=>wantsNegative ? balances[key] < -.005 : balances[key] > .005)
      .sort((a,b)=>String(opened[a]||'').localeCompare(String(opened[b]||'')) || keys.indexOf(a)-keys.indexOf(b));
    for (const key of eligible) {
      if (remaining <= .005) break;
      const due = wantsNegative ? -balances[key] : balances[key];
      const used = Math.min(remaining,due);
      applyDelta(key,wantsNegative ? used : -used,stamp);
      remaining -= used;
    }
    if (remaining > .005) {
      if (wantsNegative) pendingPositive += remaining;
      else pendingNegative += remaining;
    }
  };
  const eventStamp = (item, index, kind) => {
    const created = String(item?.createdAt || '');
    const day = String(item?.date || created.slice(0,10) || '9999-12-31');
    const time = created.includes('T') ? created.slice(11) : (kind === 'expense' ? '00:00:00' : '23:59:59');
    return day+'T'+time+'|'+String(index).padStart(5,'0')+'|'+kind;
  };

  const events = tripEntries(plan).map((entry,index)=>({kind:'expense',entry,stamp:eventStamp(entry,index,'expense')}))
    .concat(tripRepayments(plan).map((repayment,index)=>({kind:'repayment',repayment,stamp:eventStamp(repayment,index,'repayment')})))
    .sort((a,b)=>a.stamp.localeCompare(b.stamp));

  for (const event of events) {
    if (event.kind === 'expense') {
      const entry = event.entry, key = debtCategoryKey(entry);
      const remaining = Math.max(0,n(entry.amount)-n(entry.jarContribution));
      const paidPrincipessa = entry.paidBy === 'both' ? remaining/2 : entry.paidBy === 'Principessa' ? remaining : 0;
      const owner = entry.forActor === 'Principe' ? 'Principe' : 'Principessa';
      const sharePrincipessa = entry.split === 'personal' ? (owner === 'Principessa' ? remaining : 0) : remaining/2;
      applyDelta(key,paidPrincipessa-sharePrincipessa,event.stamp);
      consumePending(key,event.stamp);
      continue;
    }

    const repayment = event.repayment, value = n(repayment.amount);
    const effect = repayment.from === 'Principessa' && repayment.to === 'Principe'
      ? value
      : repayment.from === 'Principe' && repayment.to === 'Principessa'
        ? -value : 0;
    if (!effect) continue;
    if (repayment.category && keys.includes(repayment.category)) {
      applyDelta(repayment.category,effect,event.stamp);
    } else {
      consumeLegacy(effect,event.stamp);
    }
  }

  if (pendingPositive > .005) applyDelta('other',pendingPositive,'9999-12-31T23:59:59|legacy');
  if (pendingNegative > .005) applyDelta('other',-pendingNegative,'9999-12-31T23:59:59|legacy');

  const overall = settlementState(plan);
  const targetCents = overall.debtor === person ? Math.max(0,Math.round(n(overall.amount)*100)) : 0;
  const out = Object.fromEntries(keys.map((key)=>[key,0]));
  if (!targetCents) return out;

  const wantsNegative = person === 'Principessa';
  const debts = keys.map((key)=>({
    key,
    cents: Math.max(0,Math.round((wantsNegative ? -balances[key] : balances[key])*100)),
    opened: opened[key] || '9999-12-31T23:59:59',
  })).filter((item)=>item.cents>0);

  let excess = Math.max(0,debts.reduce((sum,item)=>sum+item.cents,0)-targetCents);
  debts.sort((a,b)=>a.opened.localeCompare(b.opened) || keys.indexOf(a.key)-keys.indexOf(b.key));
  for (const item of debts) {
    const reduce = Math.min(excess,item.cents);
    item.cents -= reduce;
    excess -= reduce;
  }
  debts.forEach((item)=>{ out[item.key]=item.cents/100; });
  const assigned = debts.reduce((sum,item)=>sum+item.cents,0);
  if (assigned < targetCents) out.other += (targetCents-assigned)/100;
  return out;
}
function owedCategoryAmount(plan, key, person = actor()) {
  return owedCategoryBreakdown(plan,person)[key] || 0;
}
function debtCategoryLabel(key) {
  const item = EXPENSE_CATS.find(([candidate])=>candidate===key);
  return item ? item[1] : 'Other';
}
function debtCategoryIcon(key) {
  const item = EXPENSE_CATS.find(([candidate])=>candidate===key);
  return item ? item[2] : '•';
}

function tripBudget(plan, trip) {
  const p = plan?.budgets?.Principessa, q = plan?.budgets?.Principe;
  if (has(p) || has(q)) return (has(p) ? n(p) : 0) + (has(q) ? n(q) : 0);
  return has(trip?.budget) ? n(trip.budget) : null;
}
function tripPhase(meta) {
  const start = localDate(meta?.start), end = localDate(meta?.end), now = localToday();
  if (!start || !end) return 'unknown';
  if (now < start) return 'upcoming';
  if (now <= end) return 'now';
  return 'past';
}
function statusLine(meta) {
  const start = localDate(meta?.start), end = localDate(meta?.end), now = localToday();
  if (!start || !end) return '';
  if (now < start) { const days = Math.max(1, dayDiff(now, start)); return days === 1 ? 'Starts tomorrow' : `Starts in ${days} days`; }
  if (now <= end) { const total = Math.max(1, dayDiff(start, end) + 1), day = Math.max(1, Math.min(total, dayDiff(start, now) + 1)); return `Day ${day} of ${total}`; }
  return 'Ended · still open';
}
function dayLabel(value) {
  if (!value) return 'No date';
  const d = localDate(value), now = localToday(); if (!d) return '';
  const diff = dayDiff(d, now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${d.toLocaleDateString('en-GB',{weekday:'short'})} ${d.getDate()} ${d.toLocaleDateString('en-GB',{month:'short'})}`;
}
function relativePayer(name) { return name === actor() ? 'you' : name; }
function categoryInfo(entry) {
  if (entry?.category === 'accommodation') return ['Stay', '🛏'];
  if (entry?.category === 'transport') {
    if(isCarExpense(entry))return ['Car · '+carExpenseLabel(entry),'⛽'];
    return ['Transport', '✈️'];
  }
  if (entry?.category === 'food') {
    if (entry?.foodType === 'groceries') return ['Groceries', '🛒'];
    return ['Eating out', '🍝'];
  }
  if (entry?.category === 'activities') return ['Activities', '🎟'];
  return [entry?.name || entry?.note || 'Other', '•'];
}
function entryTitle(entry) {
  return entry?.note || entry?.name || categoryInfo(entry)[0];
}
function paymentMismatchDetails(plan) {
  const validPayers = new Set(['Principessa','Principe','both']);
  return tripEntries(plan).map((entry) => {
    const amount = Math.max(0, n(entry?.amount));
    if (amount <= .005) return null;
    const jar = Math.min(amount, Math.max(0, n(entry?.jarContribution)));
    const remaining = Math.max(0, amount - jar);
    const assignedByPeople = validPayers.has(String(entry?.paidBy || '')) ? remaining : 0;
    const missing = Math.max(0, amount - jar - assignedByPeople);
    if (missing <= .005) return null;
    return {
      id: String(entry?.id || ''),
      title: entryTitle(entry),
      amount: missing,
      reason: entry?.paidBy ? 'Payment assignment is incomplete' : 'No payer selected',
    };
  }).filter(Boolean);
}

function planJarTotal(plan) {
  return tripEntries(plan).reduce((sum, entry) => sum + Math.max(0, n(entry?.jarContribution)), 0);
}
function entryMeta(entry) {
  const parts = [];
  if (entry?.paidBy === 'both') parts.push('each paid half');
  else if (entry?.paidBy) parts.push(relativePayer(entry.paidBy));
  if (entry?.jarContribution) parts.push(`${displayMoney(entry.jarContribution,true)} from Jar`);
  if (entry?.uncertain) parts.push('estimate');
  return parts.join(' · ');
}
function expenseTimeline(plan, canDelete = true) {
  const rows = tripEntries(plan).map((entry)=>({ kind:'expense', date:entry.date || '', entry }))
    .concat(tripRepayments(plan).map((repayment)=>({ kind:'repayment', date:repayment.date || String(repayment.createdAt || '').slice(0,10), repayment })))
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  if (!rows.length) return '<div class="tv2-empty-list">No expenses yet. Add them as they happen, it takes a few seconds.</div>';
  const groups = new Map();
  rows.forEach((row) => { const key = row.date || ''; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); });
  return [...groups.entries()].map(([date, items]) => '<div class="tv2-day"><h2>'+esc(dayLabel(date))+'</h2>'+items.map((row) => {
    if (row.kind === 'repayment') {
      const repayment = row.repayment, me = actor();
      const title = repayment.from === me ? 'Paid back '+repayment.to : repayment.from+' paid you back';
      const category = repayment.category ? debtCategoryLabel(repayment.category) : 'Owed money';
      const direction = repayment.from === me ? 'you → '+repayment.to : repayment.from+' → you';
      const meta = [category, repayment.note, direction].filter(Boolean).join(' · ');
      const settlementClass = repayment.from === me ? 'is-settlement is-outgoing' : 'is-settlement';
      return '<div class="tv2-row '+settlementClass+'"><span class="tv2-ic" aria-hidden="true">💸</span><span class="tv2-row-main"><strong>'+esc(title)+'</strong><small>'+esc(meta)+'</small></span><span class="tv2-amt">'+displayMoney(repayment.amount,true)+'</span></div>';
    }
    const entry = row.entry, [, icon] = categoryInfo(entry);
    const button = '<button class="tv2-row" data-act="open-expense" data-id="'+esc(entry.id)+'"><span class="tv2-ic" aria-hidden="true">'+icon+'</span><span class="tv2-row-main"><strong>'+esc(entryTitle(entry))+'</strong><small>'+esc(entryMeta(entry))+'</small></span><span class="tv2-amt">'+displayMoney(entry.amount,true)+'</span></button>';
    if (!canDelete) return button;
    return '<div class="tv2-expense-swipe-row" data-expense-id="'+esc(entry.id)+'"><span class="tv2-expense-delete-reveal" aria-hidden="true"><b>Delete</b></span>'+button+'</div>';
  }).join('')+'</div>').join('');
}
function settlementLine(plan) {
  const settlement = settlementState(plan), me = actor();
  if (!settlement.debtor) return 'You’re even';
  if (me === settlement.creditor) return `${settlement.debtor} owes you ${displayMoney(settlement.amount,true)}`;
  if (me === settlement.debtor) return `You owe ${settlement.creditor} ${displayMoney(settlement.amount,true)}`;
  return `${settlement.debtor} owes ${settlement.creditor} ${displayMoney(settlement.amount,true)}`;
}
function displayMoney(value, _forceCents = false) {
  return money(value);
}

function planItem(plan, trip) {
  const meta = plan?.meta || {}, available = tripBudget(plan, trip), spent = expenseTotal(plan, trip);
  return { kind:'plan', id:plan.id, plan, trip, meta, available, spent, left:available == null ? null : available - spent, phase:tripPhase(meta) };
}
function standaloneItem(trip) {
  const meta = tripMeta(trip), available = has(trip?.budget) ? n(trip.budget) : null, spent = expenseTotal({}, trip);
  return { kind:'trip', id:trip.id, trip, meta, available, spent, left:available == null ? null : available - spent, phase:tripPhase(meta) };
}
function allSimplifiedItems() {
  const trips = remoteState?.trips || [], plans = remoteState?.plans || [], tripMap = new Map(trips.map((t)=>[t.id,t])), linked = new Set(plans.map((p)=>p.linkedTripId).filter(Boolean));
  const planItems = plans.filter((p)=>!isLocked(tripMap.get(p.linkedTripId))).map((p)=>planItem(p,tripMap.get(p.linkedTripId)));
  const standalone = trips.filter((t)=>!isLocked(t)&&!linked.has(t.id)).map(standaloneItem);
  const rank = { now:0, upcoming:1, past:2, unknown:3 };
  return planItems.concat(standalone).sort((a,b)=>(rank[a.phase]-rank[b.phase])||String(a.meta?.start||'').localeCompare(String(b.meta?.start||'')));
}
function cardCountryEmoji(meta) {
  const country = String(meta?.location === 'Other' ? (meta?.otherLocation || '') : (meta?.location || '')).trim();
  return COUNTRY_EMOJI[country] || COUNTRY_EMOJI[String(meta?.location || '').trim()] || '🌍';
}
function simplifiedCard(item) {
  const pct = item.available && item.available > 0 ? Math.min(100, Math.max(0, (item.spent / item.available) * 100)) : 0;
  const over = item.left != null && item.left < 0;
  const name = item.meta?.city || locationLabel(item.meta);
  const country = locationLabel(item.meta);
  const image = tripImage(name, country, item.id);
  return '<div class="tv2-swipe-row" data-swipe-kind="'+item.kind+'" data-swipe-id="'+esc(item.id)+'">'+
    (item.kind === 'plan' ? '<span class="tv2-checklist-reveal" aria-hidden="true"><b>Checklist</b></span>' : '')+
    '<span class="tv2-delete-reveal" aria-hidden="true"><b>Delete</b></span>'+
    '<button class="tv2-card '+(item.phase==='past'?'is-past':'')+'" data-act="open-trip" data-kind="'+item.kind+'" data-id="'+esc(item.id)+'">'+
      '<span class="tv2-card-photo" aria-hidden="true" style="background-image:url(&quot;'+esc(image)+'&quot;)"></span>'+
      '<span class="tv2-card-content">'+
        '<span class="tv2-card-top"><strong>'+esc(name)+'</strong><small>'+esc(shortRange(item.meta?.start,item.meta?.end))+'</small></span>'+
        '<span class="tv2-card-sub">'+esc(statusLine(item.meta))+'</span>'+
        '<span class="tv2-card-money"><span>'+displayMoney(item.spent)+' spent</span>'+(item.left != null?'<span class="'+(over?'is-over':'')+'">'+displayMoney(item.left)+' left</span>':'')+'</span>'+
        (item.available && item.available > 0?'<span class="tv2-bar '+(over?'is-over':'')+'"><i style="width:'+pct.toFixed(1)+'%"></i></span>':'')+
      '</span>'+
    '</button>'+
  '</div>';
}

function simplifiedHome(items) {
  const groups = [
    ['now','Now'],
    ['upcoming','Upcoming'],
    ['past','Past'],
    ['unknown','Other'],
  ].map(([phase,label])=>({phase,label,items:items.filter((item)=>item.phase===phase)})).filter((group)=>group.items.length);
  const content = groups.length
    ? groups.map((group)=>'<section class="tv2-group"><h2 class="tv2-group-head">'+esc(group.label)+'</h2>'+group.items.map(simplifiedCard).join('')+'</section>').join('')
    : '<div class="tv2-empty-card"><strong>No trips yet</strong><span>Create one when you start planning. You can add expenses as they happen.</span></div>';
  return '<div class="tv2-page"><header class="tv2-home-head"><h1>Trips</h1></header>'+content+
    '<div class="tv2-dock"><button class="tv2-primary" data-act="new-trip">＋ New trip</button></div></div>';
}
function simplifiedTrip(plan, trip) {
  const meta = plan?.meta || {}, me = actor(), personal = simplifiedView.budgetMode === 'personal';
  const other = me === 'Principessa' ? 'Principe' : 'Principessa';
  const phase = tripPhase(meta), past = phase === 'past';
  const settlement = settlementState(plan), hasOutstandingDebt = settlement.amount > .005;
  const paymentMismatches = paymentMismatchDetails(plan), hasPaymentMismatch = paymentMismatches.length > 0;
  const mineConfirmed = !!trip?.confirmed?.[me], otherConfirmed = !!trip?.confirmed?.[other];
  const confirmHtml = !past ? '' : mineConfirmed
    ? '<section class="tv2-trip-confirm is-waiting"><div><strong>✓ You confirmed this trip</strong><span>'+(otherConfirmed?'Finalising trip…':'Waiting for '+esc(other)+'. It stays under Past until both of you confirm.')+'</span></div></section>'
    : hasPaymentMismatch
      ? '<section class="tv2-trip-confirm is-blocked"><div><strong>Payment assignment needs fixing</strong><span>'+esc(paymentMismatches.map((item)=>item.title+' · '+displayMoney(item.amount,true)+' unassigned').join(' · '))+'.</span></div><button type="button" disabled>Confirm trip</button></section>'
      : hasOutstandingDebt
        ? '<section class="tv2-trip-confirm is-blocked"><div><strong>Payback needed</strong><span>Pay back all owed money before confirming this trip. '+esc(settlement.debtor)+' still owes '+displayMoney(settlement.amount,true)+'.</span></div><button type="button" disabled>Confirm trip</button></section>'
        : '<section class="tv2-trip-confirm"><div><strong>Trip finished</strong><span>'+(otherConfirmed?esc(other)+' already confirmed. Confirm yours to move it to Trip stories.':'Confirm when the logged expenses look final. It moves to Trip stories after both of you confirm.')+'</span></div><button type="button" data-act="confirm-trip">Confirm trip</button></section>';
  const combinedAvailable = tripBudget(plan, trip), combinedSpent = expenseTotal(plan, trip);
  const ownBudget = has(plan?.budgets?.[me]) ? n(plan.budgets[me]) : null;
  const ownSpent = n(settlement.share?.[me]);
  const available = personal ? ownBudget : combinedAvailable;
  const spent = personal ? ownSpent : combinedSpent;
  const left = available == null ? null : available - spent;
  const over = left != null && left < 0, pct = available && available > 0 ? Math.min(100, Math.max(0, (spent / available) * 100)) : 0;
  const personalClass = personal ? ' is-personal '+(me === 'Principe' ? 'is-principe' : 'is-principessa') : '';
  const budgetLabel = 'Available';
  return '<div class="tv2-page">'+
    '<header class="tv2-trip-head"><div class="tv2-nav"><button class="tv2-link" data-act="home">‹ Trips</button>'+(ownBudget != null?'<button class="tv2-link" data-act="edit-my-budget">Edit my budget</button>':'<span></span>')+'</div>'+
      '<h1>'+esc(meta.city || locationLabel(meta))+'</h1><p>'+esc(shortRange(meta.start,meta.end))+(statusLine(meta)?' · '+esc(statusLine(meta)):'')+'</p></header>'+
    '<section class="tv2-money'+personalClass+'" data-act="toggle-budget-view" role="button" tabindex="0" aria-label="'+(personal?'Show combined trip budget':'Show your personal trip budget')+'"><div class="tv2-figs">'+
      '<div class="tv2-fig"><span>'+budgetLabel+'</span><b>'+(available == null?'Not set':displayMoney(available))+'</b>'+(!personal&&!has(plan?.budgets?.[me])?'<button type="button" class="tv2-nudge" data-act="add-my-budget">+ add yours</button>':'')+'</div>'+
      '<div class="tv2-fig"><span>Spent</span><b>'+displayMoney(spent)+'</b></div></div>'+
      (available && available > 0?'<div class="tv2-bar '+(over?'is-over':'')+'"><i style="width:'+pct.toFixed(1)+'%"></i></div>':'')+
      (left == null?'':'<div class="tv2-left '+(over?'is-over':'')+'"><b>'+displayMoney(Math.abs(left))+'</b><span>'+(over?'over budget':'left')+'</span></div>')+
    '</section>'+
    (()=>{const balanceLine=settlementLine(plan),balanceClass=balanceLine==='You’re even'?'is-even':balanceLine.startsWith('You owe ')?'is-debtor':'';return '<button class="tv2-balance '+balanceClass+'" data-act="balance"><span>'+esc(balanceLine)+'</span><span aria-hidden="true">›</span></button>';})()+
    confirmHtml+
    '<section class="tv2-list" aria-label="Expenses">'+expenseTimeline(plan,!isLocked(trip))+'</section>'+
    '<div class="tv2-dock"><button class="tv2-primary" data-act="add-expense">＋ Add expense</button></div>'+
  '</div>';
}
function simplifiedPersonalBudgetEditor(plan) {
  const me = actor(), meta = plan?.meta || {};
  const existing = has(plan?.budgets?.[me]), value = existing ? String(plan.budgets[me]) : '';
  return '<div class="tv2-page tv2-budget-edit-page">'+
    '<header class="tv2-trip-head"><div class="tv2-nav"><button class="tv2-link" data-act="cancel-budget-editor">‹ '+esc(meta.city || 'Trip')+'</button></div>'+
      '<h1>'+(existing?'Edit my budget':'Add my budget')+'</h1><p>'+esc(shortRange(meta.start,meta.end))+' · Only your personal trip budget</p></header>'+
    '<section class="tv2-budget-editor-card">'+
      '<label class="tv2-budget-editor-label" for="tv2PersonalBudgetInput">How much do you want available for this trip?</label>'+
      '<div class="tv2-budget-editor-amount"><span aria-hidden="true">€</span><input id="tv2PersonalBudgetInput" data-personal-budget-input inputmode="decimal" autocomplete="off" placeholder="0" value="'+esc(value)+'" aria-label="Your personal trip budget"></div>'+
      '<p class="tv2-budget-editor-help">This is your own budget. '+esc(me === 'Principessa' ? 'Principe' : 'Principessa')+' keeps their own separately.</p>'+
      '<p class="tv2-budget-editor-error" data-budget-error aria-live="polite"></p>'+
    '</section>'+
    '<button type="button" class="tv2-primary tv2-budget-editor-save" data-act="save-my-budget">'+(existing?'Update my budget':'Save my budget')+'</button>'+
  '</div>';
}

function setTripFocusLock(locked) {
  const body = document.body, html = document.documentElement;
  if (locked) {
    if (body.classList.contains('tv2-trip-focus')) return;
    tripFocusScrollY = window.scrollY || html.scrollTop || body.scrollTop || 0;
    body.style.top = '-' + tripFocusScrollY + 'px';
    html.classList.add('tv2-trip-focus');
    body.classList.add('tv2-trip-focus');
    return;
  }
  const wasLocked = body.classList.contains('tv2-trip-focus');
  html.classList.remove('tv2-trip-focus');
  body.classList.remove('tv2-trip-focus');
  body.style.top = '';
  if (wasLocked) window.scrollTo({ top: tripFocusScrollY, left: 0, behavior: 'auto' });
}

function renderCurrentTrips() {
  const section = ensureCurrentTrips(), root = $('#twCurrentTrips'); if (!section || !root || !remoteState) return;
  if (simplifiedView.name === 'trip') {
    const plan = (remoteState.plans || []).find((p)=>p.id===simplifiedView.planId);
    if (!plan) {
      dismissCardView('current-trip:'+simplifiedView.planId);
      simplifiedView = { name:'home', planId:'', budgetMode:'combined' };
    } else {
      const trip = (remoteState.trips || []).find((t)=>t.id===plan.linkedTripId);
      const snapshot={planId:plan.id,budgetMode:simplifiedView.budgetMode||'combined',budgetEditor:!!simplifiedView.budgetEditor};
      rememberCardView('current-trip:'+plan.id,()=>{
        openSheet('log');
        simplifiedView={name:'trip',planId:snapshot.planId,budgetMode:snapshot.budgetMode,budgetEditor:snapshot.budgetEditor};
        renderCurrentTrips();
      });
      root.classList.add('tv2-trip-view');
      section.classList.add('tv2-focus-open');
      setTripFocusLock(true);
      root.innerHTML = simplifiedView.budgetEditor ? simplifiedPersonalBudgetEditor(plan) : simplifiedTrip(plan, trip);
      root._twogetherBack = () => backFromCurrentTrip();
      root._twogetherHome = () => closeCurrentTripToHome({dismiss:true});
      return;
    }
  }
  root._twogetherBack = null;
  root._twogetherHome = null;
  root.classList.remove('tv2-trip-view');
  section.classList.remove('tv2-focus-open');
  root.style.transition = '';
  root.style.transform = '';
  root.style.opacity = '';
  setTripFocusLock(false);
  root.innerHTML = simplifiedHome(allSimplifiedItems());
}

const EXPENSE_CATS = [
  ['stay','Stay','🛏'],['transport','Transport','✈️'],['car','Car','⛽'],
  ['groceries','Groceries','🛒'],['eating-out','Eating out','🍝'],['activities','Activities','🎟'],['owed','Owed money','💸'],['other','Other','•'],
];
function uiCategoryFromEntry(entry) {
  if (!entry) return '';
  if (entry.category === 'accommodation') return 'stay';
  if (entry.category === 'transport') return isCarExpense(entry) ? 'car' : 'transport';
  if (entry.category === 'food') return entry.foodType === 'groceries' ? 'groceries' : 'eating-out';
  return entry.category || 'other';
}
function mapUiCategory(key,carType='fuel') {
  if (key === 'stay') return {category:'accommodation',foodType:'',transportType:'',useJar:true};
  if (key === 'transport') return {category:'transport',foodType:'',transportType:'other',useJar:false};
  if (key === 'car') return {category:'transport',foodType:'',transportType:carExpenseSubtype(carType),useJar:false};
  if (key === 'groceries') return {category:'food',foodType:'groceries',transportType:'',useJar:false};
  if (key === 'eating-out') return {category:'food',foodType:'eating-out',transportType:'',useJar:false};
  if (key === 'activities') return {category:'activities',foodType:'',transportType:'',useJar:false};
  return {category:'other',foodType:'',transportType:'',useJar:false};
}
function closeSimplifiedSheet() {
  simplifiedLayer?.remove(); simplifiedLayer = null; document.body.classList.remove('tv2-locked');
}
function currentTripCardKey() { return simplifiedView.name==='trip'&&simplifiedView.planId ? 'current-trip:'+simplifiedView.planId : ''; }
function closeCurrentTripToHome({dismiss=false}={}) {
  const key=currentTripCardKey();
  if(dismiss&&key)dismissCardView(key);
  simplifiedView={name:'home',planId:'',budgetMode:'combined'};
  renderCurrentTrips();
}
function backFromCurrentTrip() {
  const key=currentTripCardKey();
  if(!key){closeCurrentTripToHome();return;}
  backFromCardView(key,()=>closeCurrentTripToHome());
}

function simplifiedSnack(message) {
  let el = document.querySelector('.tv2-snack');
  if (!el) { el = document.createElement('div'); el.className = 'tv2-snack'; el.setAttribute('role','status'); document.body.appendChild(el); }
  el.innerHTML = '<span>'+esc(message)+'</span>'; el.classList.add('show'); clearTimeout(simplifiedSnackTimer);
  simplifiedSnackTimer = setTimeout(()=>el.classList.remove('show'),2600);
}
function openSimplifiedExpenseSheet(plan, existing = null) {
  closeSimplifiedSheet();
  const me = actor(), other = me === 'Principessa' ? 'Principe' : 'Principessa';
  const oldJar = n(existing?.jarContribution), availableJar = () => n(remoteState?.sharedJar?.balance) + oldJar;
  const debt = () => settlementState(plan);
  const owedAmount = () => { const current = debt(); return current.debtor === me ? current.amount : 0; };
  const owedTo = () => { const current = debt(); return current.debtor === me ? current.creditor : ''; };
  const owedCategoryAmountNow = () => state.owedCategory ? owedCategoryAmount(plan,state.owedCategory,me) : 0;
  const maxCategoryRepayment = () => Math.min(owedAmount(), owedCategoryAmountNow());
  const state = {
    amountText: existing ? String(existing.amount ?? '') : '',
    category: uiCategoryFromEntry(existing),
    carType:isCarExpense(existing)?String(existing.transportType):'fuel',
    paidBy: existing?.paidBy || me,
    split: existing?.split || 'shared',
    forActor: existing?.forActor || (existing?.split === 'personal' && existing?.paidBy && existing.paidBy !== 'both' ? existing.paidBy : me),
    date: existing?.date || new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10),
    note: existing?.note || '',
    uncertain: !!existing?.uncertain,
    useJar: existing ? !!existing.useJar : true,
    more: !!existing,
    owedCategory:'',
    owedNoteOpen:false,
    repaymentNote:'',
    busy:false,error:'',mounted:false,
  };
  const amount = () => Number(String(state.amountText||'').replace(',','.'));
  const validAmount = () => Number.isFinite(amount()) && amount() > 0;
  const jarAmount = () => state.category === 'stay' && state.useJar && validAmount() ? amount() * .2 : 0;
  const tripFuelBudget = () => {
    if(me!=='Principe')return null;
    const kind=state.category==='car'&&state.carType==='fuel'?'fuel':state.category==='groceries'?'groceries':'';
    if(!kind)return null;
    const month=String(state.date||'').slice(0,7);
    const budget=recurringBudgetItems(remoteState?.financeProfiles?.Principe?.recurring).find((item)=>budgetKeyForItem(item)===kind);
    if(!budget||!/^\d{4}-\d{2}$/.test(month))return null;
    const record=(remoteState?.finances?.Principe||[]).find((row)=>row.month===month);
    const summary=budgetProgressForMonth([budget],record,remoteState?.plans||[],month,'Principe',{tripExpenseId:existing?.id,tripPlanId:plan.id})[0];
    const effect=state.paidBy==='Principe'?(validAmount()?amount():0):state.paidBy==='both'?(validAmount()?amount()/2:0):0;
    return { ...summary, after:summary.remaining-effect };
  };
  const canSave = () => {
    if (state.category === 'owed') return !!state.owedCategory && maxCategoryRepayment() > .005 && validAmount() && amount() <= maxCategoryRepayment() + .005;
    return validAmount() && !!state.category && (state.category !== 'stay' || !state.useJar || jarAmount() <= availableJar()+.005);
  };
  const summary = () => {
    const payer = state.paidBy === me ? 'Paid by you' : state.paidBy === 'both' ? 'Each paid half' : 'Paid by '+state.paidBy;
    const split = state.paidBy === 'both' ? '' : state.split === 'shared' ? 'split 50/50' : state.forActor === me ? 'just you' : 'just '+other;
    const date = state.date === new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10) ? 'today' : fmtDate(state.date);
    return [payer,split,date,state.uncertain?'estimate':''].filter(Boolean).join(' · ');
  };
  const html = () => {
    const settlement = debt(), mine = settlement.debtor === me ? settlement.amount : 0;
    const categories = EXPENSE_CATS.filter(([key]) => !existing || key !== 'owed');
    const owedMode = state.category === 'owed';
    const selectedAmount = owedCategoryAmountNow();
    const selectedMax = maxCategoryRepayment();
    const selectedLabel = state.owedCategory ? debtCategoryLabel(state.owedCategory) : '';
    const amountField = owedMode
      ? '<div class="tv2-amount tv2-owed-total" aria-label="Total amount you owe"><strong>'+displayMoney(mine,true)+'</strong><small>total owed</small></div>'
      : '<label class="tv2-amount"><span aria-hidden="true">€</span><input id="tv2Amount" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0" value="'+esc(state.amountText)+'" aria-label="Amount in euros"></label>';

    let owedPanel = '';
    if (owedMode && state.owedCategory) {
      if (selectedMax > .005) {
        owedPanel = '<div class="tv2-owed-panel tv2-owed-repay">'+
          '<div class="tv2-owed-head"><span>You owe '+esc(settlement.creditor)+' for '+esc(selectedLabel)+'</span><strong>'+displayMoney(selectedAmount,true)+'</strong></div>'+
          '<label class="tv2-owed-field"><span>Amount you paid back</span><div><b>€</b><input id="tv2Amount" inputmode="decimal" autocomplete="off" placeholder="0" value="'+esc(state.amountText)+'"></div></label>'+
          '<button type="button" class="tv2-btn tv2-pay-full" data-pay-full>Pay full '+displayMoney(selectedMax,true)+'</button>'+
          '<button type="button" class="tv2-defaults tv2-owed-note-toggle" data-owed-note-toggle aria-expanded="'+(state.owedNoteOpen?'true':'false')+'"><span class="tv2-summary">'+(state.owedNoteOpen?'Hide note':'＋ Add note')+'</span><span class="tv2-chev" aria-hidden="true">'+(state.owedNoteOpen?'⌃':'⌄')+'</span></button>'+
          '<div class="tv2-more tv2-owed-note-box" '+(state.owedNoteOpen?'':'hidden')+'><label class="tv2-field"><span>Optional note</span><input id="tv2RepaymentNote" maxlength="180" placeholder="e.g. my half of the Airbnb" value="'+esc(state.repaymentNote)+'"></label></div>'+
        '</div>';
      } else {
        owedPanel = '<div class="tv2-owed-panel is-empty"><div class="tv2-owed-head"><span>'+esc(selectedLabel)+'</span><strong>€0</strong></div><p>Nothing to pay back in this category right now.</p></div>';
      }
    } else if (owedMode && mine <= .005) {
      owedPanel = settlement.creditor === me && settlement.debtor
        ? '<div class="tv2-owed-panel is-empty"><div class="tv2-owed-head"><span>'+esc(settlement.debtor)+' owes you</span><strong>'+displayMoney(settlement.amount,true)+'</strong></div><p>They can log their repayment from their own profile.</p></div>'
        : '<div class="tv2-owed-panel is-empty"><div class="tv2-owed-head"><span>Nothing owed</span><strong>€0</strong></div><p>You’re even on this trip right now.</p></div>';
    }

    const forOptions = state.paidBy === other
      ? [['shared','Shared 50/50'],[other,'Just '+other]]
      : [['shared','Shared 50/50'],[me,'Just you']];
    const normalOptions = owedMode ? '' :
      '<div class="tv2-jar-slot"></div>'+
      '<button type="button" class="tv2-defaults" data-more aria-expanded="'+(state.more?'true':'false')+'"><span class="tv2-summary">'+esc(summary())+'</span><span class="tv2-chev" aria-hidden="true">'+(state.more?'⌃':'⌄')+'</span></button>'+
      '<div class="tv2-more" '+(state.more?'':'hidden')+'>'+
        '<div class="tv2-field"><span>Paid by</span><div class="tv2-seg">'+
          [[me,'You'],[other,other],['both','Each paid half']].map(([k,l])=>'<button type="button" data-payer="'+k+'" class="'+(state.paidBy===k?'on':'')+'">'+esc(l)+'</button>').join('')+
        '</div></div>'+
        '<div class="tv2-field" '+(state.paidBy==='both'?'hidden':'')+'><span>For</span><div class="tv2-seg">'+
          forOptions.map(([k,l])=>'<button type="button" data-split="'+k+'" class="'+((k==='shared'&&state.split==='shared')||(k!=='shared'&&state.split==='personal'&&state.forActor===k)?'on':'')+'">'+esc(l)+'</button>').join('')+
        '</div></div>'+
        '<label class="tv2-field tv2-date-field"><span>Date</span><span class="tv2-date-box"><input type="date" id="tv2Date" value="'+esc(state.date)+'"></span></label>'+
        '<label class="tv2-field"><span>Note</span><input id="tv2Note" maxlength="180" placeholder="e.g. dinner by the canal" value="'+esc(state.note)+'"></label>'+
        '<label class="tv2-check"><input type="checkbox" id="tv2Est" '+(state.uncertain?'checked':'')+'> This amount is an estimate</label>'+
      '</div>';

    return '<div class="tv2-sheet-head"><h2>'+(owedMode?'Owed money':existing?'Edit expense':'Add expense')+'</h2><button class="tv2-x" data-close aria-label="Close">✕</button></div>'+
      amountField+
      '<div class="tv2-cats" role="group" aria-label="Category">'+categories.map(([k,l,i])=>{
        const selectedDebt = owedMode && state.owedCategory===k;
        const hasOwedBalance = owedMode && k !== 'owed' && owedCategoryAmount(plan,k,me) > .005;
        const cls = state.category===k || selectedDebt ? 'on' : '';
        return '<button type="button" class="tv2-cat '+cls+(selectedDebt?' is-owed-target':'')+(hasOwedBalance?' has-owed-balance':'')+'" data-cat="'+k+'" aria-pressed="'+((state.category===k||selectedDebt)?'true':'false')+'"><span aria-hidden="true">'+i+'</span>'+esc(l)+'</button>';
      }).join('')+'</div>'+
      (state.category==='car'?'<fieldset class="tv2-car-subtypes"><legend>Car expense</legend><div class="tv2-seg">'+(state.carType==='parking-tolls'?[{value:'parking-tolls',label:'Tolls / Parking (older)'},...CAR_TYPES]:CAR_TYPES).map((type)=>'<button type="button" data-car-type="'+type.value+'" class="'+(state.carType===type.value?'on':'')+'" aria-pressed="'+(state.carType===type.value?'true':'false')+'">'+type.label+'</button>').join('')+'</div></fieldset>':'')+
      owedPanel+normalOptions+
      (tripFuelBudget()?'<div class="finance-budget-trip-preview" aria-live="polite"></div>':'')+
      '<p class="tv2-hint" aria-live="polite"></p>'+
      '<button type="button" class="tv2-primary tv2-save" data-save>'+(owedMode?'Log repayment':existing?'Save changes':'Save')+'</button>'+
      (existing?'<button type="button" class="tv2-danger-link" data-delete>Delete expense</button>':'');
  };
  simplifiedLayer = document.createElement('div'); simplifiedLayer.className = 'tv2-layer tv2-expense-layer';
  simplifiedLayer.innerHTML = '<div class="tv2-backdrop" data-close></div><div class="tv2-sheet" role="dialog" aria-modal="true"></div>';
  // This editor is a one-level overlay: every shared back/home gesture closes only it.
  simplifiedLayer._twogetherBack = () => closeSimplifiedSheet();
  simplifiedLayer._twogetherHome = () => closeSimplifiedSheet();
  document.body.appendChild(simplifiedLayer); document.body.classList.add('tv2-locked');
  const sheet = simplifiedLayer.querySelector('.tv2-sheet');
  function refreshLive() {
    const slot = sheet.querySelector('.tv2-jar-slot');
    if (slot) {
      if (state.category === 'stay') {
        if (availableJar() <= 0) slot.innerHTML = '<div class="tv2-jar is-off"><span>Shared Jar has '+displayMoney(availableJar(),true)+' available</span></div>';
        else if (state.useJar) slot.innerHTML = '<div class="tv2-jar"><span>Shared Jar pays <b>'+(validAmount()?displayMoney(jarAmount(),true):'20%')+'</b> (20%)</span><button type="button" data-jar="off">Remove</button></div>';
        else slot.innerHTML = '<div class="tv2-jar is-off"><span>Shared Jar not used</span><button type="button" data-jar="on">Use 20%</button></div>';
      } else slot.innerHTML = '';
    }
    const summaryEl = sheet.querySelector('[data-more] .tv2-summary');
    if (summaryEl) summaryEl.textContent = summary();
    const budgetEl=sheet.querySelector('.finance-budget-trip-preview');
    if(budgetEl){
      const budget=tripFuelBudget();
      if(budget)budgetEl.innerHTML='<strong>'+esc(budget.name)+' · '+displayMoney(budget.remaining,true)+' left</strong>'+
        '<small>'+displayMoney(budget.spent,true)+' spent of '+displayMoney(budget.amount,true)+(validAmount()?' · After this: '+displayMoney(budget.after,true)+' left':'')+'</small>';
    }
    const hint = sheet.querySelector('.tv2-hint'), save = sheet.querySelector('[data-save]');
    save.disabled = !canSave() || state.busy;
    save.textContent = state.busy ? 'Saving…' : state.category === 'owed' ? 'Log repayment' : existing ? 'Save changes' : 'Save';

    if (state.category === 'owed') {
      const max = maxCategoryRepayment();
      hint.textContent = state.error || (!state.owedCategory ? '' : max <= .005 ? '' : state.amountText && !validAmount() ? 'That amount doesn’t look right' : !validAmount() ? 'Enter how much you paid back' : amount() > max + .005 ? 'You can pay back up to '+displayMoney(max,true)+' for '+debtCategoryLabel(state.owedCategory) : '');
      hint.classList.toggle('is-error',!!state.error || (!!state.amountText&&!validAmount()) || (validAmount()&&amount()>max+.005));
    } else {
      hint.textContent = state.error || (state.amountText && !validAmount() ? 'That amount doesn’t look right' : !validAmount() ? 'Enter the amount' : !state.category ? 'Pick a category' : state.category==='stay'&&state.useJar&&jarAmount()>availableJar()+.005 ? 'Not enough in the Shared Jar.' : '');
      hint.classList.toggle('is-error',!!state.error || (!!state.amountText&&!validAmount()) || (state.category==='stay'&&state.useJar&&jarAmount()>availableJar()+.005));
    }
  }
  function mount() {
    sheet.classList.toggle('is-owed', state.category === 'owed');
    sheet.innerHTML = html();
    const input = sheet.querySelector('#tv2Amount');
    input?.addEventListener('input',()=>{state.amountText=input.value;state.error='';refreshLive();});
    input?.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();if(canSave())save();}});
    sheet.querySelector('#tv2Date')?.addEventListener('change',(e)=>{state.date=e.target.value||state.date;refreshLive();});
    sheet.querySelector('#tv2Note')?.addEventListener('input',(e)=>{state.note=e.target.value;});
    sheet.querySelector('#tv2RepaymentNote')?.addEventListener('input',(e)=>{state.repaymentNote=e.target.value;});
    sheet.querySelector('#tv2Est')?.addEventListener('change',(e)=>{state.uncertain=e.target.checked;refreshLive();});
    sheet.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-close')) { closeSimplifiedSheet(); return; }
      if (b.dataset.owedCategory) {
        state.owedCategory=b.dataset.owedCategory;
        state.amountText='';
        state.error='';
        mount();
        return;
      }
      if (b.hasAttribute('data-owed-note-toggle')) {
        state.owedNoteOpen=!state.owedNoteOpen;
        mount();
        return;
      }
      if(b.dataset.carType){
        state.carType=carExpenseSubtype(b.dataset.carType);
        mount();return;
      }
      if (b.dataset.cat) {
        const key = b.dataset.cat;
        if (state.category === 'owed') {
          if (key === 'owed') {
            state.category='';
            state.owedCategory='';
            state.amountText='';
            state.owedNoteOpen=false;
            state.repaymentNote='';
            state.error='';
            state.useJar=true;
          } else {
            state.owedCategory=key;
            state.amountText='';
            state.owedNoteOpen=false;
            state.repaymentNote='';
            state.error='';
          }
          mount();
          return;
        }
        state.category=key;
        // Preserve the rest of an existing expense when only its category changes.
        if(state.category!=='stay')state.useJar=false;
        if(state.category==='owed'){
          state.more=false;
          state.owedCategory='';
          state.owedNoteOpen=false;
          state.repaymentNote='';
        } else {
          state.owedCategory='';
          state.owedNoteOpen=false;
          state.repaymentNote='';
        }
        mount();
        return;
      }
      if (b.hasAttribute('data-pay-full')) {
        const fullAmount=maxCategoryRepayment(), whole=Math.abs(fullAmount-Math.round(fullAmount))<.005;
        state.amountText=fullAmount.toLocaleString('nl-NL',{useGrouping:false,minimumFractionDigits:whole?0:2,maximumFractionDigits:2});
        mount(); return;
      }
      if (b.dataset.jar) { state.useJar=b.dataset.jar==='on'; refreshLive(); return; }
      if (b.hasAttribute('data-more')) { state.more=!state.more; mount(); return; }
      if (b.dataset.payer) { state.paidBy=b.dataset.payer; if(state.paidBy==='both')state.split='shared'; else if(state.split==='personal')state.forActor=state.paidBy; mount(); return; }
      if (b.dataset.split) { if(b.dataset.split==='shared'){state.split='shared';}else{state.split='personal';state.forActor=b.dataset.split;} mount(); return; }
      if (b.hasAttribute('data-save')) { save(); return; }
      if (b.hasAttribute('data-delete')) { remove(); }
    };
    refreshLive();
    if (!state.mounted && !existing && input && state.category !== 'owed') { state.mounted=true; setTimeout(()=>input.focus(),0); }
  }
  async function save() {
    if (!canSave() || state.busy) return;
    state.busy=true; state.error=''; refreshLive();
    if (state.category === 'owed') {
      const paidBack = amount(), target = owedTo();
      try {
        await window.TwogetherAPI.post('saveTripRepayment',{planId:plan.id,amount:paidBack,date:state.date,category:state.owedCategory,note:state.repaymentNote.trim()},actor());
        closeSimplifiedSheet(); await refreshState(true);
        simplifiedSnack(displayMoney(paidBack,true)+' paid back to '+target);
      } catch (err) { state.busy=false; state.error=err?.message||'Could not save repayment. Check your connection and try again.'; refreshLive(); }
      return;
    }
    const mapped=mapUiCategory(state.category,state.carType);
    try {
      await window.TwogetherAPI.post('saveTripExpense',{planId:plan.id,expense:{
        id:existing?.id||'',category:mapped.category,foodType:mapped.foodType,transportType:mapped.transportType,name:'',
        amount:amount(),paidBy:state.paidBy,split:state.paidBy==='both'?'shared':state.split,forActor:state.split==='personal'?state.forActor:'',
        date:state.date,note:state.note.trim(),uncertain:!!state.uncertain,useJar:state.category==='stay'&&!!state.useJar
      }},actor());
      const savedAmount=amount(), savedLabel=EXPENSE_CATS.find((x)=>x[0]===state.category)?.[1]||'Expense';
      closeSimplifiedSheet(); await refreshState(true); simplifiedSnack(existing?'Saved':displayMoney(savedAmount,true)+' '+savedLabel.toLowerCase()+' added');
    } catch (err) { state.busy=false; state.error=err?.message||'Could not save. Check your connection and try again.'; refreshLive(); }
  }
  async function remove() {
    if (!existing || state.busy) return;
    state.busy=true;
    try {
      await window.TwogetherAPI.post('deleteTripExpense',{planId:plan.id,expenseId:existing.id},actor());
      closeSimplifiedSheet(); await refreshState(true); simplifiedSnack('Expense deleted');
    } catch (err) { state.busy=false;state.error=err?.message||'Could not delete';refreshLive(); }
  }
  simplifiedLayer.querySelector('.tv2-backdrop').onclick=()=>{closeReminderNotificationEditor();closeSimplifiedSheet();};
  simplifiedLayer.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&!notifyEditorLayer)closeSimplifiedSheet();});
  mount();
}

const CHECKLIST_DEFAULTS = {
  packing: ['Toothbrushes', 'Slippers', 'Hair brush', 'Shampoo', 'Conditioner', 'Shower gel', 'Dishwasher detergent'],
  reminders: ["Don't forget to put fuel", "Don't forget to ask mom to make work sandwich", "Don't forget to take pictures of the Airbnb when you arrive"],
};
const CHECKLIST_PACKING_SECTION_DEFS = [
  { key:'clothes', label:'Clothes', words:['shirt','t-shirt','tshirt','top','blouse','sweater','jumper','hoodie','jacket','coat','pants','trousers','jeans','shorts','dress','skirt','underwear','bra','socks','shoe','sneaker','trainer','boot','slipper','pyjama','pajama','swimsuit','bikini','hat','cap','belt','scarf','glove'] },
  { key:'toiletries', label:'Toiletries & care', words:['toothbrush','toothpaste','shampoo','conditioner','shower gel','soap','deodorant','perfume','makeup','skin care','skincare','cream','lotion','razor','hair brush','hairbrush','comb','floss','towel','sanitary','tampon','pad'] },
  { key:'electronics', label:'Electronics', words:['phone','charger','charging','cable','power bank','powerbank','laptop','macbook','ipad','tablet','headphone','earphone','earbud','airpod','camera','battery','adapter','adaptor','plug','kindle','smartwatch','watch charger'] },
  { key:'documents', label:'Documents & money', words:['passport','id card','identity card','driving licence','driving license','licence','license','boarding pass','ticket','wallet','cash','bank card','credit card','insurance','visa','reservation','booking confirmation'] },
  { key:'health', label:'Health', words:['medicine','medication','pill','painkiller','ibuprofen','paracetamol','naproxen','bandage','first aid','vitamin','glasses','contact lens','contacts','prescription'] },
  { key:'food', label:'Food & drinks', words:['snack','food','water','bottle','sandwich','coffee','tea','drink','juice'] },
  { key:'other', label:'Other', words:[] },
];
function checklistSection(value) {
  return String(value||'').trim().toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,80);
}
function defaultChecklistPackingSections() {
  return CHECKLIST_PACKING_SECTION_DEFS.map((section)=>({id:section.key,label:section.label}));
}
function checklistPackingSections(source=remoteState?.tripPrepDefaults?.packingSections) {
  const raw=Array.isArray(source)?source:defaultChecklistPackingSections();
  const seen=new Set();
  const out=[];
  raw.forEach((section)=>{
    const id=checklistSection(section?.id||section?.key);
    const label=String(section?.label||'').trim().slice(0,48);
    if(!id||seen.has(id)||!label)return;
    seen.add(id);
    out.push({id,label});
  });
  if(!seen.has('other'))out.push({id:'other',label:'Other'});
  return out.slice(0,20);
}
function checklistCategoryId() {
  return 'custom-'+String(uid()).toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,28);
}
function inferredChecklistSection(text,sections=checklistPackingSections()) {
  const normalized=String(text||'').trim().toLowerCase().replace(/[’']/g,"'");
  if(!normalized)return 'other';
  const allowed=new Set(sections.map((section)=>section.id));
  for(const section of CHECKLIST_PACKING_SECTION_DEFS){
    if(section.key==='other'||!allowed.has(section.key))continue;
    if(section.words.some((word)=>normalized.includes(word)))return section.key;
  }
  return 'other';
}
function checklistVisibleSection(item,personal,person,sections=checklistPackingSections()) {
  const view=checklistViewItem(item,personal,person);
  const allowed=new Set(sections.map((section)=>section.id));
  const explicit=checklistSection(view?.section);
  if(explicit&&allowed.has(explicit))return explicit;
  return inferredChecklistSection(view?.text,sections);
}
function checklistGroupedRows(items,personal,person,rowRenderer,sections=checklistPackingSections()) {
  const groups=checklistPackingSections(sections);
  const buckets=new Map(groups.map((section)=>[section.id,[]]));
  items.forEach((item)=>{
    const key=checklistVisibleSection(item,personal,person,groups);
    (buckets.get(key)||buckets.get('other')).push(item);
  });
  return groups.map((section)=>{
    const rows=buckets.get(section.id)||[];
    return '<div class="tv2-check-group-title '+(rows.length?'':'is-empty')+'" data-check-group-title="'+esc(section.id)+'"><span>'+esc(section.label)+'</span><b>'+rows.length+'</b></div>'+
      rows.map(rowRenderer).join('');
  }).join('');
}
function checklistAddedBy(value) {
  return value === 'Principessa' || value === 'Principe' ? value : '';
}
function checklistPersonalFor(value) {
  return value === 'Principessa' || value === 'Principe' ? value : '';
}
function checklistPersonalPayload(value) {
  const source=value&&typeof value==='object'?value:{};
  const out={};
  ['Principessa','Principe'].forEach((name)=>{
    const raw=source[name]&&typeof source[name]==='object'?source[name]:null;
    if(!raw)return;
    const next={};
    if(Object.prototype.hasOwnProperty.call(raw,'text'))next.text=String(raw.text||'');
    if(Object.prototype.hasOwnProperty.call(raw,'done'))next.done=!!raw.done;
    if(Object.prototype.hasOwnProperty.call(raw,'hidden'))next.hidden=!!raw.hidden;
    if(Object.prototype.hasOwnProperty.call(raw,'notifyAt'))next.notifyAt=String(raw.notifyAt||'');
    if(Object.prototype.hasOwnProperty.call(raw,'section'))next.section=checklistSection(raw.section);
    if(Number.isFinite(Number(raw.order)))next.order=Number(raw.order);
    if(Object.keys(next).length)out[name]=next;
  });
  return out;
}
function checklistPersonalOverride(item,person) {
  const personal=item?.personal&&typeof item.personal==='object'?item.personal:{};
  return personal?.[person]&&typeof personal[person]==='object'?personal[person]:{};
}
function checklistIsShared(item) {
  return !checklistPersonalFor(item?.personalFor);
}
function checklistVisibleInView(item,personal,person) {
  const owner=checklistPersonalFor(item?.personalFor);
  if(!personal)return !owner;
  return owner===person && checklistPersonalOverride(item,person).hidden!==true;
}
function checklistViewItem(item,personal,person) {
  if(!personal||!checklistIsShared(item))return item;
  const override=checklistPersonalOverride(item,person);
  const view={...item};
  if(Object.prototype.hasOwnProperty.call(override,'text'))view.text=String(override.text||'');
  if(Object.prototype.hasOwnProperty.call(override,'done'))view.done=!!override.done;
  if(Object.prototype.hasOwnProperty.call(override,'notifyAt'))view.notifyAt=String(override.notifyAt||'');
  if(Object.prototype.hasOwnProperty.call(override,'section'))view.section=checklistSection(override.section);
  return view;
}
function checklistNotificationItems(items,person) {
  // Keep existing reminder behavior: a shared During Trip task can notify
  // both people, while private packing entries notify only their owner.
  return (Array.isArray(items)?items:[])
    .filter((item)=>checklistVisibleInView(item,true,person)||checklistVisibleInView(item,false,person))
    .map((item)=>checklistViewItem(item,true,person));
}
function checklistItemsForView(items,personal,person) {
  const source=Array.isArray(items)?items:[];
  const visible=source.filter((item)=>checklistVisibleInView(item,personal,person));
  if(!personal)return visible;
  const baseIndex=new Map(source.map((item,index)=>[item.id,index]));
  return visible.slice().sort((a,b)=>{
    const ao=Number(checklistPersonalOverride(a,person).order);
    const bo=Number(checklistPersonalOverride(b,person).order);
    const ar=Number.isFinite(ao)?ao:100000+(baseIndex.get(a.id)||0);
    const br=Number.isFinite(bo)?bo:100000+(baseIndex.get(b.id)||0);
    return ar-br;
  });
}
function checklistSetViewField(item,personal,person,key,value) {
  if(personal&&checklistIsShared(item)){
    item.personal=checklistPersonalPayload(item.personal);
    const current={...(item.personal?.[person]||{})};
    current[key]=value;
    item.personal[person]=current;
    return;
  }
  item[key]=value;
}
function checklistHideInPersonalView(item,person) {
  item.personal=checklistPersonalPayload(item.personal);
  const current={...(item.personal?.[person]||{})};
  current.hidden=true;
  item.personal[person]=current;
}
function checklistSetPersonalOrder(items,person,ids) {
  const rank=new Map(ids.map((id,index)=>[id,index]));
  items.forEach((item)=>{
    if(!rank.has(item.id))return;
    item.personal=checklistPersonalPayload(item.personal);
    const current={...(item.personal?.[person]||{})};
    current.order=rank.get(item.id);
    item.personal[person]=current;
  });
}
function checklistSeed(list) {
  return list.map((text) => ({ id: uid(), text, done:false, section:'', addedBy:'', personalFor:'', personal:{} }));
}
function tripPrepSnapshot(plan) {
  const stored = plan?.prep || {};
  const initialized = !!stored.updatedAt || (Array.isArray(stored.packing) && stored.packing.length > 0) || (Array.isArray(stored.reminders) && stored.reminders.length > 0);
  if (!initialized) {
    return {
      packing: checklistSeed(CHECKLIST_DEFAULTS.packing),
      reminders: checklistSeed(CHECKLIST_DEFAULTS.reminders),
    };
  }
  return {
    packing: Array.isArray(stored.packing) ? stored.packing : [],
    reminders: Array.isArray(stored.reminders) ? stored.reminders : [],
  };
}

function recurrentPrepSnapshot() {
  const stored = remoteState?.tripPrepDefaults || {};
  const initialized = !!stored.updatedAt || Array.isArray(stored.packing) || Array.isArray(stored.reminders) || Array.isArray(stored.notes);
  const source = initialized ? stored : {
    packing: checklistSeed(CHECKLIST_DEFAULTS.packing),
    reminders: checklistSeed(CHECKLIST_DEFAULTS.reminders),
    notes: [],
  };
  return {
    packing: (Array.isArray(source.packing) ? source.packing : []).map((item) => ({ id:item.id || uid(), text:String(item.text || ''), done:false, section:checklistSection(item.section), addedBy:checklistAddedBy(item.addedBy), personalFor:checklistPersonalFor(item.personalFor), personal:checklistPersonalPayload(item.personal) })),
    reminders: (Array.isArray(source.reminders) ? source.reminders : []).map((item) => ({ id:item.id || uid(), text:String(item.text || ''), done:false, addedBy:checklistAddedBy(item.addedBy), personalFor:checklistPersonalFor(item.personalFor), personal:checklistPersonalPayload(item.personal) })),
    notes: (Array.isArray(source.notes) ? source.notes : []).map((item) => ({ id:item.id || uid(), text:String(item.text || ''), addedBy:checklistAddedBy(item.addedBy), personalFor:checklistPersonalFor(item.personalFor), personal:checklistPersonalPayload(item.personal), createdAt:String(item.createdAt || '') })),
    packingSections: checklistPackingSections(source.packingSections),
  };
}

function tripPrepNotificationItems() {
  if (!remoteState || !actor()) return [];
  const now = new Date();
  return (remoteState.plans || []).map((plan) => {
    const trip = plan?.linkedTripId ? (remoteState.trips || []).find((item) => item.id === plan.linkedTripId) : null;
    if (trip && isLocked(trip)) return null;
    const meta = plan?.meta || {};
    const start = localDate(meta.start);
    if (!start) return null;
    const tripStart = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
    const hoursUntilStart = (tripStart - now) / 3600000;
    if (hoursUntilStart <= 0 || hoursUntilStart > 48) return null;
    const urgent = hoursUntilStart <= 12;

    const prep = tripPrepSnapshot(plan);
    const me=actor();
    const reminders = checklistNotificationItems(prep.reminders,me).filter((item) => !item.done && String(item.text || '').trim());
    const packing = checklistNotificationItems(prep.packing,me).filter((item) => !item.done && String(item.text || '').trim());
    if (!reminders.length && !packing.length) return null;

    const name = String(meta.city || locationLabel(meta) || 'Your trip').trim();
    const title = urgent
      ? name + ' starts soon — final checks'
      : name + ' is coming up ♡';
    const parts = [];
    if (reminders.length) parts.push(reminders.length + ' important reminder' + (reminders.length === 1 ? '' : 's'));
    if (packing.length) parts.push(packing.length + ' packing item' + (packing.length === 1 ? '' : 's'));

    return {
      id: 'trip-prep:' + plan.id,
      actor: actor(),
      kind: 'trip-prep',
      title,
      detail: parts.join(' · '),
      openLabel: 'Open checklist',
      urgent,
      priority: urgent ? 'critical' : '',
      reminders: reminders.map((item) => item.text),
      packing: packing.map((item) => item.text),
    };
  }).filter(Boolean);
}

function scheduledTripReminderNotificationItems() {
  if (!remoteState || !actor()) return [];
  const now=Date.now();
  const items=[];
  (remoteState.plans||[]).forEach((plan)=>{
    const trip=plan?.linkedTripId?(remoteState.trips||[]).find((item)=>item.id===plan.linkedTripId):null;
    if(trip&&isLocked(trip))return;
    const prep=tripPrepSnapshot(plan);
    const me=actor();
    const tripName=String(plan?.meta?.city||locationLabel(plan?.meta)||'Trip').trim();
    checklistNotificationItems(prep.reminders,me).forEach((item)=>{
      const notifyAt=Date.parse(String(item?.notifyAt||''));
      if(item?.done||!String(item?.text||'').trim()||!Number.isFinite(notifyAt)||notifyAt>now)return;
      items.push({
        id:'trip-reminder:'+plan.id+':'+item.id,
        actor:actor(),
        kind:'trip-reminder',
        title:String(item.text||'Important reminder').trim(),
        detail:tripName+' · Scheduled reminder',
        openLabel:'Open checklist',
        priority:'important',
      });
    });
  });
  return items;
}

function scheduleNextTripReminderRefresh() {
  if(tripNotificationTimer){
    clearTimeout(tripNotificationTimer);
    tripNotificationTimer=null;
  }
  if(!remoteState)return;
  const now=Date.now();
  let next=Infinity;
  (remoteState.plans||[]).forEach((plan)=>{
    const trip=plan?.linkedTripId?(remoteState.trips||[]).find((item)=>item.id===plan.linkedTripId):null;
    if(trip&&isLocked(trip))return;
    checklistItemsForView(tripPrepSnapshot(plan).reminders,true,actor()).map((item)=>checklistViewItem(item,true,actor())).forEach((item)=>{
      if(item?.done)return;
      const stamp=Date.parse(String(item?.notifyAt||''));
      if(Number.isFinite(stamp)&&stamp>now&&stamp<next)next=stamp;
    });
  });
  if(!Number.isFinite(next))return;
  const delay=Math.min(2147480000,Math.max(250,next-now+150));
  tripNotificationTimer=setTimeout(()=>{
    tripNotificationTimer=null;
    publishTripNotifications();
  },delay);
}

function tripRepaymentNotificationItems() {
  if (!remoteState || !actor()) return [];
  const me = actor();
  const today = localToday();

  return (remoteState.plans || []).map((plan) => {
    const meta = plan?.meta || {};
    const end = localDate(meta.end);
    if (!end) return null;

    const daysAfterEnd = dayDiff(end, today);
    if (daysAfterEnd < 2) return null;

    const settlement = settlementState(plan);
    if (!settlement.debtor || !settlement.creditor || settlement.amount <= .005) return null;
    if (me !== settlement.debtor && me !== settlement.creditor) return null;

    const tripName = String(meta.city || locationLabel(meta) || 'Trip').trim();
    const title = me === settlement.debtor
      ? 'You still need to pay ' + settlement.creditor + ' ' + displayMoney(settlement.amount, true)
      : settlement.debtor + ' still needs to pay you ' + displayMoney(settlement.amount, true);

    return {
      id: 'trip-repayment:' + plan.id,
      actor: me,
      kind: 'trip-repayment',
      title,
      detail: tripName + ' · ended ' + daysAfterEnd + ' day' + (daysAfterEnd === 1 ? '' : 's') + ' ago',
      priority: 'important',
    };
  }).filter(Boolean);
}

function publishTripNotifications() {
  window.TwogetherNotifications?.setPending([
    ...scheduledTripReminderNotificationItems(),
    ...tripPrepNotificationItems(),
    ...tripRepaymentNotificationItems(),
  ], 'trips');
  scheduleNextTripReminderRefresh();
}

async function openSimplifiedChecklist(plan, initialPersonal = true) {
  if (!plan) return;
  // Also check immediately when opening a checklist that was left on screen
  // through midnight. The action is idempotent across both people's devices.
  try{await applyReturnPackingReset(plan);}
  catch(error){toast(error?.message||'Could not refresh return packing','warn');return;}
  closeSimplifiedSheet();
  const prep = JSON.parse(JSON.stringify(tripPrepSnapshot(plan)));
  prep.notes = JSON.parse(JSON.stringify(recurrentPrepSnapshot().notes || []));
  const state = { error:'', packingMine:!!initialPersonal, busy:false, reminderDraftText:'', reminderDraftNotifyAt:'' };
  simplifiedLayer = document.createElement('div');
  simplifiedLayer.className = 'tv2-layer';
  simplifiedLayer.innerHTML = '<div class="tv2-backdrop" data-close></div><div class="tv2-sheet tv2-checklist-sheet" role="dialog" aria-modal="true" aria-label="Trip checklist"></div>';
  document.body.appendChild(simplifiedLayer);
  document.body.classList.add('tv2-locked');
  const sheet = simplifiedLayer.querySelector('.tv2-checklist-sheet');

  bindChecklistSwipeDown(simplifiedLayer, sheet);

  const reminderBellIcon=()=>'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>';
  const notifyParts=(value)=>{
    const d=new Date(String(value||''));
    if(Number.isNaN(d.getTime()))return {date:'',time:''};
    const pad=(n)=>String(n).padStart(2,'0');
    return {date:d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()),time:pad(d.getHours())+':'+pad(d.getMinutes())};
  };
  const notifyLabel=(value)=>{
    const d=new Date(String(value||''));
    if(Number.isNaN(d.getTime()))return '';
    return d.toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  };
  const notifyAtFromFields=(date,time)=>{
    if(!date||!time)return '';
    const d=new Date(date+'T'+time+':00');
    return Number.isNaN(d.getTime())?'':d.toISOString();
  };
  const noteDateLabel=(value)=>{
    const d=new Date(String(value||''));
    if(Number.isNaN(d.getTime()))return 'Added recently';
    return 'Added '+d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  };

  const noteRowHtml = (item) => {
    const viewItem=checklistViewItem(item,state.packingMine,actor());
    return '<div class="tv2-check-swipe-row tv2-check-note-swipe" data-check-swipe data-check-kind="notes" data-check-id="'+esc(item.id)+'">'+
      '<div class="tv2-check-delete-reveal" aria-hidden="true"><b>Delete</b></div>'+
      '<div class="tv2-check-row tv2-check-note-row" data-check-kind="notes" data-check-id="'+esc(item.id)+'">'+
        '<div class="tv2-check-note-copy">'+
          '<div class="tv2-check-text-scroll" data-check-scroll><input class="tv2-check-text" data-check-text maxlength="160" value="'+esc(viewItem.text)+'" aria-label="Trip note"></div>'+
          '<small>'+esc(noteDateLabel(item.createdAt))+'</small>'+
        '</div>'+
      '</div>'+
    '</div>';
  };

  const rowHtml = (kind, item, completed = false) => {
    const viewItem=checklistViewItem(item,state.packingMine,actor());
    const canNotify=kind==='reminders'&&!completed;
    const label=notifyLabel(viewItem.notifyAt);
    return '<div class="tv2-check-swipe-row" data-check-swipe data-check-kind="'+kind+'" data-check-id="'+esc(item.id)+'">'+
      '<div class="tv2-check-delete-reveal" aria-hidden="true"><b>Delete</b></div>'+
      '<div class="tv2-check-row '+(completed?'is-completed':'')+(canNotify?' has-reminder-notify':'')+'" data-check-kind="'+kind+'" data-check-id="'+esc(item.id)+'">'+
        '<label class="tv2-check-toggle"><input type="checkbox" data-check-toggle '+(viewItem.done?'checked':'')+' aria-label="'+(viewItem.done?'Move back to checklist':'Mark completed')+'"><span></span></label>'+
        '<div class="tv2-check-text-scroll" data-check-scroll>'+
          '<input class="tv2-check-text" data-check-text maxlength="160" value="'+esc(viewItem.text)+'" aria-label="Checklist item">'+
        '</div>'+
        (canNotify?'<button type="button" class="tv2-check-notify '+(label?'is-set':'')+'" data-check-notify aria-label="'+esc(label?'Edit notification · '+label:'Add notification date and time')+'" title="'+esc(label||'Add notification')+'">'+reminderBellIcon()+'</button>':'')+
        (completed
          ? '<small>'+(kind==='packing'?'Packing':'Reminder')+'</small>'
          : '<button type="button" class="tv2-check-drag" data-check-drag aria-label="Hold and drag to reorder"><i></i><i></i><i></i></button>')+
      '</div>'+
    '</div>';
  };

  const activeSection = (kind, title) => {
    const mine=state.packingMine;
    const active = checklistItemsForView(prep[kind],mine,actor()).filter((item)=>!checklistViewItem(item,mine,actor()).done);
    const ownerClass=mine?(actor()==='Principe'?' is-principe':' is-principessa'):'';
    const isReminder=kind==='reminders';
    const draftNotifyLabel=isReminder?notifyLabel(state.reminderDraftNotifyAt):'';
    const notifyButton=isReminder?'<button type="button" class="tv2-check-add-notify '+(draftNotifyLabel?'is-set':'')+'" data-check-new-notify aria-label="'+esc(draftNotifyLabel?'Edit notification · '+draftNotifyLabel:'Add notification date and time')+'" title="'+esc(draftNotifyLabel||'Add notification')+'">'+reminderBellIcon()+'</button>':'';
    const sectionTools=kind==='packing'&&mine
      ? '<div class="tv2-check-section-tools"><span>'+active.length+'</span><button type="button" data-check-categories>Categories</button></div>'
      : '<span>'+active.length+'</span>';
    const packingSections=checklistPackingSections();
    return '<section class="tv2-check-section'+(mine?' is-mine-packing':'')+ownerClass+'" data-check-section="'+kind+'"><div class="tv2-check-section-head"><h3>'+esc(title)+'</h3>'+sectionTools+'</div>'+
      '<div class="tv2-check-list" data-check-list-kind="'+kind+'">'+(active.length?(kind==='packing'&&mine?checklistGroupedRows(active,mine,actor(),(item)=>rowHtml(kind,item),packingSections):active.map((item)=>rowHtml(kind,item)).join('')):'<p class="tv2-check-empty">'+(mine?'Nothing of yours here ♡':'All clear here ♡')+'</p>')+'</div>'+
      '<div class="tv2-check-add '+(isReminder?'is-reminder-add':'')+'"><input data-check-new="'+kind+'" maxlength="160" placeholder="Add another item" value="'+esc(isReminder?state.reminderDraftText:'')+'">'+notifyButton+'<button type="button" data-check-add="'+kind+'">Add</button></div>'+
    '</section>';
  };

  const notesSection = () => {
    const personal=state.packingMine;
    const visible=checklistItemsForView(prep.notes,personal,actor());
    const ownerClass=personal?(actor()==='Principe'?' is-principe':' is-principessa'):'';
    return '<section class="tv2-check-section tv2-check-notes'+(personal?' is-mine-packing':'')+ownerClass+'" data-check-section="notes">'+
      '<div class="tv2-check-section-head"><h3>Notes</h3><span>'+visible.length+'</span></div>'+
      '<div class="tv2-check-list">'+(visible.length?visible.map(noteRowHtml).join(''):'<p class="tv2-check-empty">'+(personal?'No personal notes yet.':'No shared notes yet.')+'</p>')+'</div>'+
      '<div class="tv2-check-add"><input data-check-new="notes" maxlength="160" placeholder="Add a note for next trip"><button type="button" data-check-add="notes">Add</button></div>'+
    '</section>';
  };

  const completedSection = () => {
    const mine=state.packingMine;
    const done = [
      ...checklistItemsForView(prep.packing,mine,actor()).filter((item)=>checklistViewItem(item,mine,actor()).done).map((item)=>({kind:'packing',item})),
      ...checklistItemsForView(prep.reminders,mine,actor()).filter((item)=>checklistViewItem(item,mine,actor()).done).map((item)=>({kind:'reminders',item})),
    ];
    if (!done.length) return '';
    return '<section class="tv2-check-section tv2-check-completed"><div class="tv2-check-section-head"><h3>Completed</h3><span>'+done.length+'</span></div>'+
      '<div class="tv2-check-list">'+done.map(({kind,item})=>rowHtml(kind,item,true)).join('')+'</div></section>';
  };

  const textMeasureCanvas = document.createElement('canvas');
  const textMeasureContext = textMeasureCanvas.getContext('2d');
  function syncChecklistTextWidth(input) {
    const scroller = input?.closest('[data-check-scroll]'); if (!input || !scroller) return;
    const style = getComputedStyle(input);
    if (textMeasureContext) {
      textMeasureContext.font = [style.fontStyle,style.fontVariant,style.fontWeight,style.fontSize,style.fontFamily].filter(Boolean).join(' ');
      const text = input.value || '';
      const spacing = Number.parseFloat(style.letterSpacing) || 0;
      const exact = Math.ceil(textMeasureContext.measureText(text).width + Math.max(0,text.length-1) * spacing);
      input.style.width = Math.max(scroller.clientWidth, exact)+'px';
    } else {
      input.style.width = '100%';
    }
    const maxScroll = Math.max(0, input.getBoundingClientRect().width - scroller.clientWidth);
    if (scroller.scrollLeft > maxScroll) scroller.scrollLeft = maxScroll;
  }
  function syncAllChecklistTextWidths() {
    sheet.querySelectorAll('[data-check-text]').forEach(syncChecklistTextWidth);
  }

  function render(moveId = '') {
    if (!sheet) return;
    const personal=state.packingMine;
    const me=actor();
    sheet.classList.toggle('is-personal-checklist',personal);
    sheet.classList.toggle('is-principessa',personal&&me==='Principessa');
    sheet.classList.toggle('is-principe',personal&&me==='Principe');
    sheet.innerHTML =
      '<div class="tv2-sheet-head tv2-checklist-head"><div><small class="tv2-check-city">'+esc(plan.meta?.city || locationLabel(plan.meta))+'</small><h2>'+(personal?'My checklist':'During Trip')+'</h2>'+(personal?'<span class="tv2-check-personal-mode">'+esc(me)+'</span>':'<span class="tv2-check-shared-mode">Shared with both of you</span>')+'</div>'+
        '<div class="tv2-check-head-actions"><button type="button" class="tv2-check-view-toggle" data-check-view-toggle>'+esc(personal?'During Trip':'My checklist')+' ↔</button>'+
        (personal?'<button type="button" class="tv2-check-recurrent" data-check-recurrent><strong>Recurrent Items</strong><b aria-hidden="true">›</b></button>':'')+'</div></div>'+
      activeSection('packing',personal?'Packing / things to take':'Groceries & things to do')+
      activeSection('reminders',personal?'Important reminders':'Shared reminders')+
      notesSection()+
      completedSection()+
      '<p class="tv2-hint '+(state.error?'is-error':'')+'" aria-live="polite">'+esc(state.error)+'</p>';
    requestAnimationFrame(() => {
      syncAllChecklistTextWidths();
      if (moveId) {
        const row = sheet.querySelector('.tv2-check-row[data-check-id="'+CSS.escape(moveId)+'"]');
        row?.classList.add('just-arrived');
      }
    });
  }

  function findItem(row) {
    const kind = row?.dataset.checkKind, id = row?.dataset.checkId;
    return kind && Array.isArray(prep[kind]) ? prep[kind].find((item)=>item.id===id) : null;
  }
  function cleanPrep(source=prep) {
    return {
      returnPackingResetEnd:String(plan?.prep?.returnPackingResetEnd||''),
      packing: source.packing.filter((item)=>String(item.text||'').trim()).map((item)=>({id:item.id,recurrentId:item.recurrentId||'',text:String(item.text||'').trim(),done:!!item.done,section:checklistSection(item.section),addedBy:checklistAddedBy(item.addedBy),personalFor:checklistPersonalFor(item.personalFor),personal:checklistPersonalPayload(item.personal)})),
      reminders: source.reminders.filter((item)=>String(item.text||'').trim()).map((item)=>({id:item.id,recurrentId:item.recurrentId||'',text:String(item.text||'').trim(),done:!!item.done,addedBy:checklistAddedBy(item.addedBy),personalFor:checklistPersonalFor(item.personalFor),notifyAt:String(item.notifyAt||''),personal:checklistPersonalPayload(item.personal)})),
    };
  }
  function cleanNotes(source=prep.notes) {
    return (Array.isArray(source)?source:[]).filter((item)=>String(item.text||'').trim()).map((item)=>({
      id:item.id,
      text:String(item.text||'').trim(),
      addedBy:checklistAddedBy(item.addedBy),
      personalFor:checklistPersonalFor(item.personalFor),
      personal:checklistPersonalPayload(item.personal),
      createdAt:String(item.createdAt||''),
    }));
  }
  let checklistSaveQueue=Promise.resolve();
  function saveChecklistSnapshot(snapshot) {
    state.error='';
    const payload=JSON.parse(JSON.stringify(snapshot||cleanPrep()));
    checklistSaveQueue=checklistSaveQueue.catch(()=>{}).then(()=>
      window.TwogetherAPI.post('saveTripPrep',{planId:plan.id,prep:payload},actor())
    ).then((result)=>{
      if(result?.prep)plan.prep=JSON.parse(JSON.stringify(result.prep));
      if(remoteState&&result?.tripPrepDefaults)remoteState.tripPrepDefaults=JSON.parse(JSON.stringify(result.tripPrepDefaults));
      publishTripNotifications();
      return result;
    });
    checklistSaveQueue.catch(()=>{});
    return checklistSaveQueue;
  }
  function autoSaveChecklist() {
    return saveChecklistSnapshot(cleanPrep()).catch((err)=>{
      if(String(err?.message||'').includes('Packing was reset for the journey home')){
        closeSimplifiedSheet();
        toast('Packing was refreshed for the journey home. Reopen your checklist.','warn');
        refreshState(false);
        return null;
      }
      state.error=err?.message||'Could not update checklist';
      if(sheet?.isConnected)render();
      return null;
    });
  }
  let notesSaveQueue=Promise.resolve();
  function saveNotesSnapshot(source=prep.notes) {
    state.error='';
    const payload=cleanNotes(source);
    notesSaveQueue=notesSaveQueue.catch(()=>{}).then(()=>
      window.TwogetherAPI.post('saveTripNotes',{notes:payload},actor())
    ).then((result)=>{
      if(remoteState&&result?.prep)remoteState.tripPrepDefaults=JSON.parse(JSON.stringify(result.prep));
      if(Array.isArray(result?.notes))prep.notes=JSON.parse(JSON.stringify(result.notes));
      return result;
    });
    notesSaveQueue.catch(()=>{});
    return notesSaveQueue;
  }
  function autoSaveNotes() {
    return saveNotesSnapshot(prep.notes).catch((err)=>{
      state.error=err?.message||'Could not update notes';
      if(sheet?.isConnected)render();
      return null;
    });
  }
  let notifyEditorLayer=null;
  function closeReminderNotificationEditor(){
    notifyEditorLayer?.remove();
    notifyEditorLayer=null;
  }
  function openReminderNotificationEditor(item=null){
    closeReminderNotificationEditor();
    const current=String((item?checklistViewItem(item,state.packingMine,actor()).notifyAt:'')||state.reminderDraftNotifyAt||'');
    const parts=notifyParts(current);
    const todayParts=notifyParts(new Date().toISOString());
    notifyEditorLayer=document.createElement('div');
    notifyEditorLayer.className='tv2-confirm-layer tv2-check-notify-layer';
    notifyEditorLayer.innerHTML=
      '<div class="tv2-confirm-backdrop" data-notify-cancel></div>'+
      '<div class="tv2-confirm-card tv2-check-notify-card" role="dialog" aria-modal="true" aria-labelledby="tv2NotifyTitle">'+
        '<h2 id="tv2NotifyTitle">'+(current?'Edit notification':'Add notification')+'</h2>'+
        '<p>Choose when Twogether should remind you about this important item.</p>'+
        '<div class="tv2-check-notify-fields">'+
          '<label><span>Date</span><input type="date" data-notify-date min="'+esc(todayParts.date)+'" value="'+esc(parts.date)+'"></label>'+
          '<label><span>Time</span><input type="time" data-notify-time value="'+esc(parts.time)+'"></label>'+
        '</div>'+
        '<p class="tv2-confirm-error" data-notify-error aria-live="polite"></p>'+
        '<div class="tv2-confirm-actions tv2-check-notify-actions '+(current?'has-remove':'')+'">'+
          '<button type="button" data-notify-cancel>Cancel</button>'+
          (current?'<button type="button" class="is-remove" data-notify-remove>Remove</button>':'')+
          '<button type="button" class="is-save" data-notify-save>Save</button>'+
        '</div>'+
      '</div>';
    simplifiedLayer.appendChild(notifyEditorLayer);

    const finishDraft=()=>{
      closeReminderNotificationEditor();
      render();
      requestAnimationFrame(()=>sheet.querySelector('[data-check-new="reminders"]')?.focus());
    };
    const cancel=()=>closeReminderNotificationEditor();
    notifyEditorLayer.querySelectorAll('[data-notify-cancel]').forEach((button)=>button.addEventListener('click',cancel));
    notifyEditorLayer.querySelector('[data-notify-remove]')?.addEventListener('click',()=>{
      if(item){
        checklistSetViewField(item,state.packingMine,actor(),'notifyAt','');
        autoSaveChecklist();
        closeReminderNotificationEditor();
        render(item.id);
      }else{
        state.reminderDraftNotifyAt='';
        finishDraft();
      }
    });
    notifyEditorLayer.querySelector('[data-notify-save]')?.addEventListener('click',()=>{
      const date=String(notifyEditorLayer?.querySelector('[data-notify-date]')?.value||'');
      const time=String(notifyEditorLayer?.querySelector('[data-notify-time]')?.value||'');
      const notifyAt=notifyAtFromFields(date,time);
      const error=notifyEditorLayer?.querySelector('[data-notify-error]');
      if(!date||!time||!notifyAt){
        if(error)error.textContent='Choose both a date and a time.';
        return;
      }
      if(item){
        checklistSetViewField(item,state.packingMine,actor(),'notifyAt',notifyAt);
        autoSaveChecklist();
        closeReminderNotificationEditor();
        render(item.id);
      }else{
        state.reminderDraftNotifyAt=notifyAt;
        finishDraft();
      }
    });
    notifyEditorLayer.addEventListener('keydown',(e)=>{if(e.key==='Escape')cancel();});
  }

  function addItem(kind) {
    const input = sheet.querySelector('[data-check-new="'+kind+'"]');
    const text = input?.value?.trim(); if (!text || !Array.isArray(prep[kind])) return;
    const next={ id:uid(), text, done:false, section:'', addedBy:actor(), personalFor:state.packingMine?actor():'', personal:{} };
    if(kind==='notes'){
      delete next.done;
      next.createdAt=new Date().toISOString();
      prep.notes.push(next);
      render();
      autoSaveNotes();
      requestAnimationFrame(() => sheet.querySelector('[data-check-new="notes"]')?.focus());
      return;
    }
    if(kind==='reminders'&&state.reminderDraftNotifyAt)next.notifyAt=state.reminderDraftNotifyAt;
    prep[kind].push(next);
    if(kind==='reminders'){
      state.reminderDraftText='';
      state.reminderDraftNotifyAt='';
    }
    render();
    autoSaveChecklist();
    requestAnimationFrame(() => sheet.querySelector('[data-check-new="'+kind+'"]')?.focus());
  }

  let checklistSwipe={tracking:false,active:false,startX:0,startY:0,lastX:0,lastY:0,row:null,textScroller:null,textTimer:null,textMode:false,startScrollLeft:0};
  let checklistSwipeIgnoreUntil=0;

  const clearChecklistTextScrollTimer=()=>{
    if(checklistSwipe.textTimer)clearTimeout(checklistSwipe.textTimer);
    checklistSwipe.textTimer=null;
  };

  const startChecklistTextScroll=()=>{
    const scroller=checklistSwipe.textScroller;
    if(!checklistSwipe.tracking||checklistSwipe.active||!scroller||scroller.scrollWidth<=scroller.clientWidth+2)return;
    checklistSwipe.textMode=true;
    checklistSwipe.startScrollLeft=scroller.scrollLeft;
    scroller.classList.add('is-longpress-scroll');
    resetChecklistSwipeVisual(checklistSwipe.row,false);
    try{if(typeof navigator.vibrate==='function')navigator.vibrate(8);}catch{}
  };

  const resetChecklistSwipeVisual=(row,animate=true)=>{
    if(!row)return;
    const card=row.querySelector('.tv2-check-row');
    const reveal=row.querySelector('.tv2-check-delete-reveal');
    if(card){
      card.style.transition=animate?'transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease':'none';
      card.style.transform='translateX(0)';
      card.style.opacity='1';
    }
    if(reveal){
      reveal.style.transition=animate?'width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease':'none';
      reveal.style.width='0px';
      reveal.style.opacity='0';
    }
    if(animate)setTimeout(()=>{
      if(card?.isConnected)card.style.transition='';
      if(reveal?.isConnected)reveal.style.transition='';
    },220);
  };

  const resetChecklistSwipeState=()=>{
    clearChecklistTextScrollTimer();
    checklistSwipe.textScroller?.classList.remove('is-longpress-scroll');
    checklistSwipe={tracking:false,active:false,startX:0,startY:0,lastX:0,lastY:0,row:null,textScroller:null,textTimer:null,textMode:false,startScrollLeft:0};
  };

  const closeOtherChecklistSwipes=(except=null)=>{
    sheet.querySelectorAll('[data-check-swipe]').forEach((row)=>{
      if(row!==except)resetChecklistSwipeVisual(row,true);
    });
  };

  const openChecklistDeleteConfirm=(kind,id)=>{
    const item=Array.isArray(prep[kind])?prep[kind].find((entry)=>entry.id===id):null;
    if(!item)return;
    const viewItem=checklistViewItem(item,state.packingMine,actor());
    closeDeleteConfirm();
    deleteConfirmLayer=document.createElement('div');
    deleteConfirmLayer.className='tv2-confirm-layer';
    const isNote=kind==='notes';
    deleteConfirmLayer.innerHTML=
      '<div class="tv2-confirm-backdrop" data-confirm-cancel></div>'+
      '<div class="tv2-confirm-card" role="dialog" aria-modal="true" aria-labelledby="tv2ChecklistDeleteTitle">'+
        '<h2 id="tv2ChecklistDeleteTitle">'+(isNote?'Delete note?':'Delete checklist item?')+'</h2>'+
        '<p>Are you sure you want to delete <strong>'+esc(viewItem.text||'this item')+'</strong>?</p>'+
        '<p class="tv2-confirm-error" aria-live="polite"></p>'+
        '<div class="tv2-confirm-actions"><button type="button" data-confirm-cancel>Cancel</button><button type="button" class="is-delete" data-confirm-delete>Delete</button></div>'+
      '</div>';
    document.body.appendChild(deleteConfirmLayer);

    const cancel=()=>{
      closeDeleteConfirm();
      closeOtherChecklistSwipes();
    };
    deleteConfirmLayer.querySelectorAll('[data-confirm-cancel]').forEach((button)=>button.addEventListener('click',cancel));
    deleteConfirmLayer.addEventListener('keydown',(e)=>{if(e.key==='Escape')cancel();});

    const deleteButton=deleteConfirmLayer.querySelector('[data-confirm-delete]');
    deleteButton?.addEventListener('click',async()=>{
      if(state.busy)return;
      deleteButton.disabled=true;
      deleteButton.textContent='Deleting…';
      const error=deleteConfirmLayer.querySelector('.tv2-confirm-error');
      if(error)error.textContent='';
      const next={
        packing:prep.packing.map((entry)=>JSON.parse(JSON.stringify(entry))),
        reminders:prep.reminders.map((entry)=>JSON.parse(JSON.stringify(entry))),
        notes:prep.notes.map((entry)=>JSON.parse(JSON.stringify(entry))),
      };
      const previousKind=prep[kind].map((entry)=>JSON.parse(JSON.stringify(entry)));
      const target=next[kind].find((entry)=>entry.id===id);
      if(state.packingMine&&target&&checklistIsShared(target))checklistHideInPersonalView(target,actor());
      else next[kind]=next[kind].filter((entry)=>entry.id!==id);
      prep[kind]=next[kind];
      try{
        state.busy=true;
        if(kind==='notes')await saveNotesSnapshot(prep.notes);
        else await saveChecklistSnapshot(cleanPrep());
        state.busy=false;
        closeDeleteConfirm();
        render();
        simplifiedSnack(kind==='notes'?'Note deleted':'Checklist item deleted');
      }catch(err){
        prep[kind]=previousKind;
        state.busy=false;
        deleteButton.disabled=false;
        deleteButton.textContent='Delete';
        if(error)error.textContent=err?.message||'Could not delete checklist item';
      }
    });
  };

  sheet.addEventListener('touchstart',(e)=>{
    if(state.busy||deleteConfirmLayer||e.touches.length!==1||e.target.closest('[data-check-drag],[data-check-notify]'))return;
    const row=e.target.closest('[data-check-swipe]');
    if(!row)return;
    closeOtherChecklistSwipes(row);
    resetChecklistSwipeVisual(row,false);
    const t=e.touches[0];
    const textScroller=e.target.closest('[data-check-scroll]');
    const canTextScroll=!!textScroller&&textScroller.scrollWidth>textScroller.clientWidth+2;
    checklistSwipe={
      tracking:true,active:false,startX:t.clientX,startY:t.clientY,lastX:t.clientX,lastY:t.clientY,row,
      textScroller:canTextScroll?textScroller:null,textTimer:null,textMode:false,startScrollLeft:textScroller?.scrollLeft||0
    };
    if(canTextScroll)checklistSwipe.textTimer=setTimeout(startChecklistTextScroll,260);
  },{passive:true});

  sheet.addEventListener('touchmove',(e)=>{
    if(!checklistSwipe.tracking||!checklistSwipe.row||e.touches.length!==1)return;
    const t=e.touches[0];
    const dx=t.clientX-checklistSwipe.startX;
    const dy=Math.abs(t.clientY-checklistSwipe.startY);
    checklistSwipe.lastX=t.clientX;
    checklistSwipe.lastY=t.clientY;

    if(checklistSwipe.textMode&&checklistSwipe.textScroller){
      e.preventDefault();
      const scroller=checklistSwipe.textScroller;
      const maxScroll=Math.max(0,scroller.scrollWidth-scroller.clientWidth);
      scroller.scrollLeft=Math.max(0,Math.min(maxScroll,checklistSwipe.startScrollLeft-dx));
      return;
    }

    if(!checklistSwipe.active){
      if(Math.abs(dx)<8&&dy<8)return;
      clearChecklistTextScrollTimer();
      if(dx<-10&&Math.abs(dx)>dy*1.2){
        checklistSwipe.active=true;
      }else if(dy>=Math.abs(dx)||dx>10){
        resetChecklistSwipeVisual(checklistSwipe.row,true);
        resetChecklistSwipeState();
        return;
      }
    }
    if(!checklistSwipe.active)return;
    e.preventDefault();

    const row=checklistSwipe.row;
    const width=row.getBoundingClientRect().width||280;
    const distance=Math.max(-width*.94,Math.min(0,dx));
    const exposed=Math.abs(distance);
    const card=row.querySelector('.tv2-check-row');
    const reveal=row.querySelector('.tv2-check-delete-reveal');
    if(card){
      card.style.transition='none';
      card.style.transform='translateX('+distance+'px)';
    }
    if(reveal){
      reveal.style.transition='none';
      reveal.style.width=exposed+'px';
      reveal.style.opacity=String(Math.min(1,.35+exposed/120));
    }
  },{passive:false});

  sheet.addEventListener('touchend',(e)=>{
    if(!checklistSwipe.tracking||!checklistSwipe.row){
      resetChecklistSwipeState();
      return;
    }
    if(checklistSwipe.textMode){
      checklistSwipeIgnoreUntil=Date.now()+250;
      e.preventDefault();
      resetChecklistSwipeState();
      return;
    }
    clearChecklistTextScrollTimer();
    const row=checklistSwipe.row;
    const dx=checklistSwipe.lastX-checklistSwipe.startX;
    const width=row.getBoundingClientRect().width||280;
    const threshold=Math.max(180,width*.62);
    const fullSwipe=checklistSwipe.active&&-dx>=threshold;
    const kind=row.dataset.checkKind,id=row.dataset.checkId;

    if(!fullSwipe){
      resetChecklistSwipeVisual(row,true);
      resetChecklistSwipeState();
      return;
    }

    checklistSwipeIgnoreUntil=Date.now()+450;
    const card=row.querySelector('.tv2-check-row');
    const reveal=row.querySelector('.tv2-check-delete-reveal');
    if(card){
      card.style.transition='transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      card.style.transform='translateX(-'+width+'px)';
      card.style.opacity='.76';
    }
    if(reveal){
      reveal.style.transition='width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      reveal.style.width=width+'px';
      reveal.style.opacity='1';
    }
    resetChecklistSwipeState();
    setTimeout(()=>{
      resetChecklistSwipeVisual(row,false);
      openChecklistDeleteConfirm(kind,id);
    },180);
  },{passive:false});

  sheet.addEventListener('touchcancel',()=>{
    resetChecklistSwipeVisual(checklistSwipe.row,true);
    resetChecklistSwipeState();
  },{passive:true});

  let checklistDragFrame=0;
  let checklistAutoScrollFrame=0;
  let checklistDragPendingY=0;
  let checklistProtectedTouchId=null;

  const checklistGroupForRow=(row)=>{
    let node=row?.previousElementSibling;
    while(node){
      if(node.matches?.('[data-check-group-title]'))return checklistSection(node.dataset.checkGroupTitle);
      node=node.previousElementSibling;
    }
    return '';
  };

  const setChecklistGestureLock=(locked)=>{
    if(locked){
      simplifiedLayer.dataset.tv2GestureLock='1';
      simplifiedLayer.dataset.tv2GestureOwner='reorder';
      sheet.style.transition='none';
      sheet.style.transform='translateY(0)';
      sheet.style.opacity='1';
      sheet.style.scrollBehavior='auto';
      const backdrop=simplifiedLayer.querySelector('.tv2-backdrop');
      if(backdrop){
        backdrop.style.transition='none';
        backdrop.style.opacity='1';
      }
      return;
    }
    if(simplifiedLayer?.isConnected){
      delete simplifiedLayer.dataset.tv2GestureLock;
      delete simplifiedLayer.dataset.tv2GestureOwner;
    }
    sheet.style.scrollBehavior='';
  };

  let checklistDrag={
    timer:null,
    tracking:false,
    active:false,
    touchId:null,
    row:null,
    list:null,
    kind:'',
    itemId:'',
    ghost:null,
    startX:0,
    startY:0,
    lastY:0,
    activationY:0,
    grabOffsetY:0,
  };

  const checklistDragHaptic=()=>{
    try{if(typeof navigator.vibrate==='function')navigator.vibrate(10);}catch{}
  };

  const touchForChecklistDrag=(touches,id)=>
    [...(touches||[])].find((touch)=>touch.identifier===id)||null;

  const isChecklistProtectedTouch=(touch)=>{
    if(!touch)return false;
    const rows=[...sheet.querySelectorAll('[data-check-swipe]')].filter((row)=>row.querySelector('[data-check-drag]'));
    return rows.some((row)=>{
      const rect=row.getBoundingClientRect();
      return touch.clientY>=rect.top&&touch.clientY<=rect.bottom&&
        touch.clientX>=rect.right-52&&touch.clientX<=rect.right;
    });
  };

  const checklistHandleForTouch=(target,touch)=>{
    if(target?.closest?.('[data-check-notify]'))return null;
    const direct=target?.closest?.('[data-check-drag]');
    if(direct)return direct;
    const row=target?.closest?.('[data-check-swipe]');
    if(!row||!row.querySelector('[data-check-drag]')||!touch)return null;
    const rect=row.getBoundingClientRect();
    if(touch.clientY<rect.top||touch.clientY>rect.bottom||
      touch.clientX<rect.right-52||touch.clientX>rect.right)return null;
    return row.querySelector('[data-check-drag]');
  };

  const clearChecklistDragTimer=()=>{
    if(checklistDrag.timer)clearTimeout(checklistDrag.timer);
    checklistDrag.timer=null;
  };

  const cleanupChecklistDragVisual=()=>{
    checklistDrag.ghost?.remove();
    checklistDrag.ghost=null;
    if(checklistDrag.row){
      checklistDrag.row.classList.remove('is-reorder-slot');
      checklistDrag.row.style.transition='';
      checklistDrag.row.style.transform='';
    }
    sheet.classList.remove('is-reordering-items');
  };

  const resetChecklistDrag=()=>{
    clearChecklistDragTimer();
    if(checklistDragFrame){
      cancelAnimationFrame(checklistDragFrame);
      checklistDragFrame=0;
    }
    if(checklistAutoScrollFrame){
      cancelAnimationFrame(checklistAutoScrollFrame);
      checklistAutoScrollFrame=0;
    }
    cleanupChecklistDragVisual();
    setChecklistGestureLock(false);
    checklistDrag={
      timer:null,
      tracking:false,
      active:false,
      touchId:null,
      row:null,
      list:null,
      kind:'',
      itemId:'',
      ghost:null,
      startX:0,
      startY:0,
      lastY:0,
      activationY:0,
      grabOffsetY:0,
    };
  };

  const animateChecklistLayout=(beforeRects)=>{
    requestAnimationFrame(()=>{
      if(!checklistDrag.list)return;
      const rows=[...checklistDrag.list.querySelectorAll('[data-check-swipe]')];
      rows.forEach((row)=>{
        if(row===checklistDrag.row)return;
        const oldTop=beforeRects.get(row);
        if(oldTop==null)return;
        const newTop=row.getBoundingClientRect().top;
        const delta=oldTop-newTop;
        if(Math.abs(delta)<.5)return;
        row.style.transition='none';
        row.style.transform='translate3d(0,'+delta+'px,0)';
        void row.offsetHeight;
        row.style.transition='transform .17s cubic-bezier(.22,.8,.28,1)';
        row.style.transform='translate3d(0,0,0)';
        setTimeout(()=>{
          if(row?.isConnected){
            row.style.transition='';
            row.style.transform='';
          }
        },190);
      });
    });
  };

  const moveChecklistSlot=(beforeRow)=>{
    if(!checklistDrag.active||!checklistDrag.list||!checklistDrag.row)return;
    const currentNext=checklistDrag.row.nextElementSibling;
    if((beforeRow&&currentNext===beforeRow)||(!beforeRow&&!currentNext))return;

    const rows=[...checklistDrag.list.querySelectorAll('[data-check-swipe]')];
    const beforeRects=new Map(rows.filter((row)=>row!==checklistDrag.row).map((row)=>[row,row.getBoundingClientRect().top]));

    if(beforeRow)checklistDrag.list.insertBefore(checklistDrag.row,beforeRow);
    else checklistDrag.list.appendChild(checklistDrag.row);

    animateChecklistLayout(beforeRects);
    checklistDragHaptic();
  };

  const checklistGroupTitleForY=(touchY)=>{
    const titles=[...checklistDrag.list.querySelectorAll('[data-check-group-title]')].filter((title)=>title.getBoundingClientRect().height>0);
    if(!titles.length)return null;
    let target=titles[0];
    for(let index=1;index<titles.length;index+=1){
      const rect=titles[index].getBoundingClientRect();
      const boundary=rect.top+rect.height/2;
      if(touchY<boundary)return target;
      target=titles[index];
    }
    return target;
  };

  const placeChecklistSlot=(touchY)=>{
    if(!checklistDrag.active||!checklistDrag.list||!checklistDrag.row||!checklistDrag.ghost)return;
    if(checklistDrag.kind==='packing'){
      const title=checklistGroupTitleForY(touchY);
      if(title){
        let nextTitle=title.nextElementSibling;
        while(nextTitle&&!nextTitle.matches?.('[data-check-group-title]'))nextTitle=nextTitle.nextElementSibling;
        const rows=[];
        let node=title.nextElementSibling;
        while(node&&node!==nextTitle){
          if(node.matches?.('[data-check-swipe]')&&node!==checklistDrag.row)rows.push(node);
          node=node.nextElementSibling;
        }
        const before=rows.find((row)=>{
          const rect=row.getBoundingClientRect();
          return touchY<rect.top+rect.height/2;
        })||nextTitle||null;
        moveChecklistSlot(before);
        return;
      }
    }
    const ghostTop=touchY-checklistDrag.grabOffsetY;
    const ghostHeight=checklistDrag.ghost.getBoundingClientRect().height||checklistDrag.row.getBoundingClientRect().height;
    const ghostCenter=ghostTop+ghostHeight/2;
    const rows=[...checklistDrag.list.querySelectorAll('[data-check-swipe]')].filter((row)=>row!==checklistDrag.row);
    const before=rows.find((row)=>{
      const rect=row.getBoundingClientRect();
      return ghostCenter<rect.top+rect.height/2;
    })||null;
    moveChecklistSlot(before);
  };

  const clampChecklistDragY=(touchY)=>{
    if(!checklistDrag.ghost)return touchY;
    const sheetRect=sheet.getBoundingClientRect();
    const ghostHeight=checklistDrag.ghost.getBoundingClientRect().height||checklistDrag.row?.getBoundingClientRect().height||0;
    const grab=Math.max(0,Math.min(ghostHeight,checklistDrag.grabOffsetY));
    const pad=8;
    const minY=sheetRect.top+pad+grab;
    const maxY=sheetRect.bottom-pad-Math.max(0,ghostHeight-grab);
    if(maxY<minY)return (minY+maxY)/2;
    return Math.max(minY,Math.min(maxY,touchY));
  };

  const paintChecklistDrag=(touchY)=>{
    if(!checklistDrag.active||!checklistDrag.ghost)return;
    const clampedY=clampChecklistDragY(touchY);
    const dy=clampedY-checklistDrag.activationY;
    checklistDrag.ghost.style.transform='translate3d(0,'+dy+'px,0) scale(1)';
    placeChecklistSlot(clampedY);
  };

  const scheduleChecklistDragPaint=(touchY)=>{
    checklistDragPendingY=touchY;
    if(checklistDragFrame)return;
    checklistDragFrame=requestAnimationFrame(()=>{
      checklistDragFrame=0;
      paintChecklistDrag(checklistDragPendingY);
    });
  };

  const checklistSectionScrollBounds=()=>{
    const section=checklistDrag.list?.closest('.tv2-check-section');
    if(!section)return null;
    const sheetRect=sheet.getBoundingClientRect();
    const sectionRect=section.getBoundingClientRect();
    const contentTop=sheet.scrollTop+(sectionRect.top-sheetRect.top);
    const contentBottom=sheet.scrollTop+(sectionRect.bottom-sheetRect.top);
    const globalMax=Math.max(0,sheet.scrollHeight-sheet.clientHeight);
    const min=Math.max(0,Math.min(globalMax,contentTop-8));
    const max=Math.max(0,Math.min(globalMax,contentBottom-sheet.clientHeight+8));
    if(max<min)return {min:sheet.scrollTop,max:sheet.scrollTop,sectionRect,sheetRect};
    return {min,max,sectionRect,sheetRect};
  };
  const startChecklistAutoScroll=()=>{
    if(checklistAutoScrollFrame)return;
    const tick=()=>{
      if(!checklistDrag.active||!checklistDrag.list){
        checklistAutoScrollFrame=0;
        return;
      }
      const bounds=checklistSectionScrollBounds();
      if(!bounds){
        checklistAutoScrollFrame=0;
        return;
      }
      const visibleTop=Math.max(bounds.sheetRect.top,bounds.sectionRect.top);
      const visibleBottom=Math.min(bounds.sheetRect.bottom,bounds.sectionRect.bottom);
      const visibleHeight=Math.max(1,visibleBottom-visibleTop);
      const edge=Math.min(112,Math.max(70,visibleHeight*.22));
      const y=checklistDrag.lastY;
      let delta=0;
      if(y<visibleTop+edge&&sheet.scrollTop>bounds.min+.5){
        const strength=Math.min(1,Math.max(0,(visibleTop+edge-y)/edge));
        delta=-(5+24*strength*strength);
      }else if(y>visibleBottom-edge&&sheet.scrollTop<bounds.max-.5){
        const strength=Math.min(1,Math.max(0,(y-(visibleBottom-edge))/edge));
        delta=5+24*strength*strength;
      }
      if(delta){
        const before=sheet.scrollTop;
        sheet.scrollTop=Math.max(bounds.min,Math.min(bounds.max,before+delta));
        if(Math.abs(sheet.scrollTop-before)>.1)scheduleChecklistDragPaint(y);
      }
      checklistAutoScrollFrame=requestAnimationFrame(tick);
    };
    checklistAutoScrollFrame=requestAnimationFrame(tick);
  };

  const beginChecklistDrag=()=>{
    if(!checklistDrag.tracking||checklistDrag.active||!checklistDrag.row||!checklistDrag.list)return;
    clearChecklistDragTimer();

    const sourceCard=checklistDrag.row.querySelector('.tv2-check-row');
    if(!sourceCard)return;
    const rect=sourceCard.getBoundingClientRect();
    const sourceStyle=getComputedStyle(sourceCard);
    const ghost=sourceCard.cloneNode(true);
    ghost.classList.add('tv2-check-drag-ghost');
    ghost.style.gridTemplateColumns=sourceStyle.gridTemplateColumns;
    ghost.style.columnGap=sourceStyle.columnGap;
    ghost.style.rowGap=sourceStyle.rowGap;
    ghost.querySelectorAll('input,button').forEach((control)=>{
      control.tabIndex=-1;
      control.setAttribute('aria-hidden','true');
    });

    const sheetRect=sheet.getBoundingClientRect();
    const inset=8;
    const ghostLeft=Math.max(sheetRect.left+inset,rect.left);
    const ghostRight=Math.min(sheetRect.right-inset,rect.right);
    ghost.style.top=rect.top+'px';
    ghost.style.left=ghostLeft+'px';
    ghost.style.width=Math.max(1,ghostRight-ghostLeft)+'px';
    ghost.style.height=rect.height+'px';
    ghost.style.transform='translate3d(0,0,0) scale(1)';
    simplifiedLayer.appendChild(ghost);

    checklistDrag.ghost=ghost;
    checklistDrag.active=true;
    setChecklistGestureLock(true);
    checklistDrag.activationY=checklistDrag.lastY;
    checklistDrag.grabOffsetY=checklistDrag.lastY-rect.top;

    checklistDrag.row.classList.add('is-reorder-slot');
    sheet.classList.add('is-reordering-items');
    checklistDragHaptic();
    startChecklistAutoScroll();
  };

  const applyChecklistOrder=()=>{
    const kind=checklistDrag.kind;
    const list=checklistDrag.list;
    if(!kind||!Array.isArray(prep[kind])||!list)return;
    const rows=[...list.querySelectorAll('[data-check-swipe]')];
    const ids=rows.map((row)=>row.dataset.checkId);
    if(kind==='packing'){
      const byId=new Map(prep[kind].map((item)=>[item.id,item]));
      rows.forEach((row)=>{
        const item=byId.get(row.dataset.checkId);
        if(!item)return;
        const group=checklistGroupForRow(row)||'other';
        const view=checklistViewItem(item,state.packingMine,actor());
        const inferred=inferredChecklistSection(view?.text,checklistPackingSections());
        checklistSetViewField(item,state.packingMine,actor(),'section',group===inferred?'':group);
      });
    }
    if(state.packingMine){
      checklistSetPersonalOrder(prep[kind],actor(),ids);
      return;
    }
    const visibleSet=new Set(ids);
    const byId=new Map(prep[kind].map((item)=>[item.id,item]));
    let index=0;
    prep[kind]=prep[kind].map((item)=>{
      if(!visibleSet.has(item.id))return item;
      return byId.get(ids[index++])||item;
    });
  };

  const finishChecklistDrag=()=>{
    applyChecklistOrder();
    checklistSwipeIgnoreUntil=Date.now()+350;
    resetChecklistDrag();
    render();
    autoSaveChecklist();
  };

  const cancelChecklistDrag=()=>{
    const wasActive=checklistDrag.active;
    resetChecklistDrag();
    if(wasActive)render();
  };

  sheet.addEventListener('touchstart',(e)=>{
    if(state.busy||deleteConfirmLayer||e.touches.length!==1)return;
    const t=e.touches[0];
    const notificationTarget=e.target.closest?.('[data-check-notify]');
    const handle=checklistHandleForTouch(e.target,t);
    const protectedZone=!notificationTarget&&(!!handle||isChecklistProtectedTouch(t));

    if(handle){
      sheet.__tv2CancelSwipeDown?.();
      resetChecklistDrag();
    }

    if(protectedZone){
      checklistProtectedTouchId=t.identifier;
      setChecklistGestureLock(true);
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    if(!handle)return;
    const row=handle.closest('[data-check-swipe]');
    const list=row?.closest('.tv2-check-list');
    if(!row||!list)return;

    closeOtherChecklistSwipes();

    checklistDrag.tracking=true;
    checklistDrag.touchId=t.identifier;
    checklistDrag.row=row;
    checklistDrag.list=list;
    checklistDrag.kind=row.dataset.checkKind||'';
    checklistDrag.itemId=row.dataset.checkId||'';
    checklistDrag.startX=t.clientX;
    checklistDrag.startY=t.clientY;
    checklistDrag.lastY=t.clientY;
    checklistDrag.timer=setTimeout(beginChecklistDrag,180);
  },{passive:false,capture:true});

  sheet.addEventListener('touchmove',(e)=>{
    const protectedTouch=touchForChecklistDrag(e.touches,checklistProtectedTouchId);
    if(protectedTouch){
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    if(!checklistDrag.tracking)return;
    const t=touchForChecklistDrag(e.touches,checklistDrag.touchId);
    if(!t)return;

    e.preventDefault();
    e.stopImmediatePropagation();
    checklistDrag.lastY=t.clientY;

    if(!checklistDrag.active){
      const dx=t.clientX-checklistDrag.startX;
      const dy=t.clientY-checklistDrag.startY;
      if(Math.hypot(dx,dy)>=3)beginChecklistDrag();
      else return;
    }
    if(!checklistDrag.active)return;

    scheduleChecklistDragPaint(t.clientY);
  },{passive:false,capture:true});

  sheet.addEventListener('touchend',(e)=>{
    const protectedTouch=touchForChecklistDrag(e.changedTouches,checklistProtectedTouchId);
    if(protectedTouch){
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    if(!checklistDrag.tracking){
      if(protectedTouch){
        checklistProtectedTouchId=null;
        setChecklistGestureLock(false);
      }
      return;
    }

    const t=touchForChecklistDrag(e.changedTouches,checklistDrag.touchId);
    if(!t)return;

    e.preventDefault();
    e.stopImmediatePropagation();

    if(!checklistDrag.active){
      resetChecklistDrag();
      checklistProtectedTouchId=null;
      return;
    }

    if(checklistDragFrame){
      cancelAnimationFrame(checklistDragFrame);
      checklistDragFrame=0;
    }
    paintChecklistDrag(t.clientY);
    checklistProtectedTouchId=null;
    finishChecklistDrag();
  },{passive:false,capture:true});

  sheet.addEventListener('touchcancel',(e)=>{
    const protectedTouch=touchForChecklistDrag(e.changedTouches,checklistProtectedTouchId);
    if(protectedTouch){
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    if(!checklistDrag.tracking){
      if(protectedTouch){
        checklistProtectedTouchId=null;
        setChecklistGestureLock(false);
      }
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    checklistProtectedTouchId=null;
    cancelChecklistDrag();
  },{passive:false,capture:true});

  sheet.addEventListener('change',(e)=>{
    const row=e.target.closest('.tv2-check-row'); if(!row)return;
    const item=findItem(row); if(!item)return;
    if(e.target.matches('[data-check-toggle]')){
      checklistSetViewField(item,state.packingMine,actor(),'done',e.target.checked);
      autoSaveChecklist();
      row.classList.add('is-moving');
      setTimeout(()=>render(item.id),180);
    } else if(e.target.matches('[data-check-text]')) {
      checklistSetViewField(item,state.packingMine,actor(),'text',e.target.value.trim());
      if(row.dataset.checkKind==='notes')autoSaveNotes();
      else autoSaveChecklist();
    }
  });
  sheet.addEventListener('input',(e)=>{
    if(e.target.matches('[data-check-new="reminders"]')){
      state.reminderDraftText=e.target.value;
      return;
    }
    if(!e.target.matches('[data-check-text]'))return;
    const row=e.target.closest('.tv2-check-row'),item=findItem(row);
    if(item)checklistSetViewField(item,state.packingMine,actor(),'text',e.target.value);
    syncChecklistTextWidth(e.target);
  });
  sheet.addEventListener('keydown',(e)=>{
    const input=e.target.closest('[data-check-new]'); if(!input||e.key!=='Enter')return;
    e.preventDefault(); addItem(input.dataset.checkNew);
  });
  sheet.addEventListener('click',(e)=>{
    if(Date.now()<checklistSwipeIgnoreUntil&&e.target.closest('[data-check-swipe]')){
      e.preventDefault();
      return;
    }
    const b=e.target.closest('button'); if(!b)return;
    if(b.hasAttribute('data-check-view-toggle')){state.packingMine=!state.packingMine;render();return;}
    if(b.hasAttribute('data-close')){closeReminderNotificationEditor();closeSimplifiedSheet();return;}
    if(b.hasAttribute('data-check-recurrent')){closeReminderNotificationEditor();openRecurrentChecklistItems(plan,state.packingMine);return;}
    if(b.hasAttribute('data-check-categories')){closeReminderNotificationEditor();openRecurrentChecklistItems(plan,state.packingMine,true);return;}
    if(b.hasAttribute('data-check-new-notify')){
      const input=sheet.querySelector('[data-check-new="reminders"]');
      state.reminderDraftText=String(input?.value||'');
      openReminderNotificationEditor();
      return;
    }
    if(b.hasAttribute('data-check-notify')){
      const item=findItem(b.closest('.tv2-check-row'));
      if(item)openReminderNotificationEditor(item);
      return;
    }
    if(b.dataset.checkAdd){addItem(b.dataset.checkAdd);return;}
  });
  simplifiedLayer.querySelector('.tv2-backdrop').onclick=closeSimplifiedSheet;
  simplifiedLayer.addEventListener('keydown',(e)=>{if(e.key==='Escape')closeSimplifiedSheet();});
  render();
}

function openRecurrentChecklistItems(plan, initialPersonal = true, initialCategoriesOpen = false) {
  closeSimplifiedSheet();
  const prep = JSON.parse(JSON.stringify(recurrentPrepSnapshot()));
  const state = { busy:false, error:'', personal:true, categoriesOpen:!!initialCategoriesOpen };
  simplifiedLayer = document.createElement('div');
  simplifiedLayer.className = 'tv2-layer';
  simplifiedLayer.innerHTML = '<div class="tv2-backdrop" data-close></div><div class="tv2-sheet tv2-checklist-sheet tv2-recurrent-sheet" role="dialog" aria-modal="true" aria-label="Recurrent checklist items"></div>';
  document.body.appendChild(simplifiedLayer);
  document.body.classList.add('tv2-locked');
  const sheet = simplifiedLayer.querySelector('.tv2-checklist-sheet');

  bindChecklistSwipeDown(simplifiedLayer, sheet);

  const rowHtml = (kind,item) => {
    const viewItem=checklistViewItem(item,state.personal,actor());
    return '<div class="tv2-recurrent-swipe-row" data-recurrent-swipe data-check-kind="'+kind+'" data-check-id="'+esc(item.id)+'">'+
      '<div class="tv2-recurrent-delete-reveal" aria-hidden="true"><b>Delete</b></div>'+
      '<div class="tv2-check-row tv2-recurrent-row">'+
        '<span class="tv2-recurrent-dot" aria-hidden="true"></span>'+
        '<div class="tv2-check-text-scroll" data-check-scroll><input class="tv2-check-text" data-check-text maxlength="160" value="'+esc(viewItem.text)+'" aria-label="Recurrent checklist item"></div>'+
        '<button type="button" class="tv2-recurrent-drag" data-recurrent-drag aria-label="Hold and drag to reorder"><i></i><i></i><i></i></button>'+
      '</div>'+
    '</div>';
  };

  const categoryManagerHtml = () => {
    const rows=checklistPackingSections(prep.packingSections).map((section)=>
      '<div class="tv2-check-category-swipe-row" data-check-category-row="'+esc(section.id)+'" data-check-category-swipe>'+
        (section.id==='other'?'':'<div class="tv2-check-category-delete-reveal" aria-hidden="true"><b>Delete</b></div>')+
        '<div class="tv2-check-category-row '+(section.id==='other'?'has-fallback':'')+'">'+
          '<input data-check-category-label="'+esc(section.id)+'" maxlength="48" value="'+esc(section.label)+'" aria-label="Category name">'+
          (section.id==='other'?'<span class="tv2-check-category-fixed">Fallback</span>':'')+
          '<button type="button" class="tv2-check-category-drag" data-check-category-drag aria-label="Hold and drag to reorder"><i></i><i></i><i></i></button>'+
        '</div>'+
      '</div>'
    ).join('');
    return '<div class="tv2-check-category-manager">'+
      '<p>Organise packing categories</p>'+
      rows+
      '<div class="tv2-check-category-add"><input data-check-category-new maxlength="48" placeholder="New category"><button type="button" data-check-category-add>Add</button></div>'+
      '<small>Items group themselves automatically. Drag an item into another category whenever you want to correct it.</small>'+
    '</div>';
  };

  const sectionHtml = (kind,title) => {
    const visible=checklistItemsForView(prep[kind],state.personal,actor());
    const packingSections=checklistPackingSections(prep.packingSections);
    const sectionTools=kind==='packing'
      ? '<div class="tv2-check-section-tools"><span>'+visible.length+'</span><button type="button" data-check-categories aria-expanded="'+(state.categoriesOpen?'true':'false')+'">'+(state.categoriesOpen?'Done':'Categories')+'</button></div>'
      : '<span>'+visible.length+'</span>';
    return '<section class="tv2-check-section"><div class="tv2-check-section-head"><h3>'+esc(title)+'</h3>'+sectionTools+'</div>'+
      (kind==='packing'&&state.categoriesOpen?categoryManagerHtml():'')+
      '<div class="tv2-check-list" data-check-list-kind="'+kind+'">'+(visible.length?(kind==='packing'?checklistGroupedRows(visible,state.personal,actor(),(item)=>rowHtml(kind,item),packingSections):visible.map((item)=>rowHtml(kind,item)).join('')):'<p class="tv2-check-empty">'+(state.personal?'Nothing of yours here ♡':'No shared standard items here.')+'</p>')+'</div>'+
      '<div class="tv2-check-add"><input data-check-new="'+kind+'" maxlength="160" placeholder="Add standard item"><button type="button" data-check-add="'+kind+'">Add</button></div>'+
    '</section>';
  };

  const textMeasureCanvas = document.createElement('canvas');
  const textMeasureContext = textMeasureCanvas.getContext('2d');
  function syncRecurrentTextWidth(input) {
    const scroller=input?.closest('[data-check-scroll]'); if(!input||!scroller)return;
    const style=getComputedStyle(input);
    if(textMeasureContext){
      textMeasureContext.font=[style.fontStyle,style.fontVariant,style.fontWeight,style.fontSize,style.fontFamily].filter(Boolean).join(' ');
      const text=input.value||'';
      const spacing=Number.parseFloat(style.letterSpacing)||0;
      const exact=Math.ceil(textMeasureContext.measureText(text).width+Math.max(0,text.length-1)*spacing);
      input.style.width=Math.max(scroller.clientWidth,exact)+'px';
    }else input.style.width='100%';
    const maxScroll=Math.max(0,input.getBoundingClientRect().width-scroller.clientWidth);
    if(scroller.scrollLeft>maxScroll)scroller.scrollLeft=maxScroll;
  }
  function syncAllRecurrentTextWidths(){
    sheet.querySelectorAll('[data-check-text]').forEach(syncRecurrentTextWidth);
  }

  function render() {
    const personal=state.personal,me=actor();
    sheet.classList.toggle('is-personal-checklist',personal);
    sheet.classList.toggle('is-principessa',personal&&me==='Principessa');
    sheet.classList.toggle('is-principe',personal&&me==='Principe');
    sheet.innerHTML =
      '<div class="tv2-sheet-head tv2-checklist-head"><div><button type="button" class="tv2-check-back" data-check-back>‹ My checklist</button><h2>My recurrent items</h2><span class="tv2-check-personal-mode">'+esc(me)+'</span></div><button class="tv2-x" data-close aria-label="Close">✕</button></div>'+
      sectionHtml('packing','Packing / things to take')+
      sectionHtml('reminders','Important reminders')+
      '<p class="tv2-hint '+(state.error?'is-error':'')+'" aria-live="polite">'+esc(state.error)+'</p>'+
      '<button type="button" class="tv2-primary tv2-check-save" data-check-defaults-save '+(state.busy?'disabled':'')+'>'+(state.busy?'Saving…':'Save recurrent items')+'</button>';
    requestAnimationFrame(syncAllRecurrentTextWidths);
  }

  function findItem(row) {
    const source=row?.matches?.('[data-check-kind]')?row:row?.closest?.('[data-check-kind]');
    const kind=source?.dataset.checkKind,id=source?.dataset.checkId;
    return kind&&Array.isArray(prep[kind])?prep[kind].find((item)=>item.id===id):null;
  }
  function addItem(kind) {
    const input=sheet.querySelector('[data-check-new="'+kind+'"]');
    const text=input?.value?.trim(); if(!text||!Array.isArray(prep[kind]))return;
    prep[kind].push({id:uid(),text,done:false,section:'',addedBy:actor(),personalFor:actor(),personal:{}});
    render();
    requestAnimationFrame(()=>sheet.querySelector('[data-check-new="'+kind+'"]')?.focus());
  }
  function recurrentPayload(source=prep) {
    const existingNotes=recurrentPrepSnapshot().notes||[];
    return {
      packing:source.packing.filter((item)=>String(item.text||'').trim()).map((item)=>({id:item.id,text:String(item.text||'').trim(),done:false,section:checklistSection(item.section),addedBy:checklistAddedBy(item.addedBy),personalFor:checklistPersonalFor(item.personalFor),personal:checklistPersonalPayload(item.personal)})),
      reminders:source.reminders.filter((item)=>String(item.text||'').trim()).map((item)=>({id:item.id,text:String(item.text||'').trim(),done:false,addedBy:checklistAddedBy(item.addedBy),personalFor:checklistPersonalFor(item.personalFor),personal:checklistPersonalPayload(item.personal)})),
      notes:existingNotes.map((item)=>({id:item.id,text:String(item.text||'').trim(),addedBy:checklistAddedBy(item.addedBy),personalFor:checklistPersonalFor(item.personalFor),personal:checklistPersonalPayload(item.personal),createdAt:String(item.createdAt||'')})),
      packingSections:checklistPackingSections(source.packingSections),
    };
  }
  let recurrentSaveQueue=Promise.resolve();
  function autoSaveRecurrentOrder() {
    const payload=recurrentPayload();
    state.error='';
    recurrentSaveQueue=recurrentSaveQueue.catch(()=>{}).then(()=>
      window.TwogetherAPI.post('saveTripPrepDefaults',{prep:payload},actor())
    ).then((result)=>{
      if(remoteState&&result?.prep)remoteState.tripPrepDefaults=JSON.parse(JSON.stringify(result.prep));
      return result;
    }).catch((err)=>{
      state.error=err?.message||'Could not save recurrent item order';
      if(sheet?.isConnected)render();
      throw err;
    });
    recurrentSaveQueue.catch(()=>{});
    return recurrentSaveQueue;
  }
  async function saveDefaults() {
    if(state.busy)return;
    state.busy=true;state.error='';render();
    const payload=recurrentPayload();
    try{
      await recurrentSaveQueue.catch(()=>{});
      const result=await window.TwogetherAPI.post('saveTripPrepDefaults',{prep:payload},actor());
      if(remoteState&&result?.prep)remoteState.tripPrepDefaults=JSON.parse(JSON.stringify(result.prep));
      closeSimplifiedSheet();
      await refreshState(true);
      const refreshedPlan=(remoteState?.plans||[]).find((item)=>item.id===plan.id)||plan;
      openSimplifiedChecklist(refreshedPlan,state.personal);
      simplifiedSnack('Recurrent items saved');
    }catch(err){
      state.busy=false;state.error=err?.message||'Could not save recurrent items';render();
    }
  }

  let categorySwipe={tracking:false,active:false,startX:0,startY:0,lastX:0,lastY:0,row:null};
  const resetCategorySwipeVisual=(row,animate=true)=>{
    if(!row)return;
    const card=row.querySelector('.tv2-check-category-row');
    const reveal=row.querySelector('.tv2-check-category-delete-reveal');
    if(card){
      card.style.transition=animate?'transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease':'none';
      card.style.transform='translateX(0)';
      card.style.opacity='1';
    }
    if(reveal){
      reveal.style.transition=animate?'width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease':'none';
      reveal.style.width='0px';
      reveal.style.opacity='0';
    }
    if(animate)setTimeout(()=>{
      if(card?.isConnected)card.style.transition='';
      if(reveal?.isConnected)reveal.style.transition='';
    },220);
  };
  const resetCategorySwipeState=()=>{
    categorySwipe={tracking:false,active:false,startX:0,startY:0,lastX:0,lastY:0,row:null};
  };
  const closeOtherCategorySwipes=(except=null)=>{
    sheet.querySelectorAll('[data-check-category-swipe]').forEach((row)=>{
      if(row!==except)resetCategorySwipeVisual(row,true);
    });
  };
  const moveDeletedCategoryItemsToOther=(id)=>{
    prep.packing.forEach((item)=>{
      if(checklistSection(item.section)===id)item.section='other';
      item.personal=checklistPersonalPayload(item.personal);
      ['Principessa','Principe'].forEach((name)=>{
        const entry=item.personal?.[name];
        if(entry&&checklistSection(entry.section)===id)entry.section='other';
      });
    });
  };
  const openCategoryDeleteConfirm=(id)=>{
    if(!id||id==='other')return;
    const section=checklistPackingSections(prep.packingSections).find((entry)=>entry.id===id);
    if(!section)return;
    closeDeleteConfirm();
    deleteConfirmLayer=document.createElement('div');
    deleteConfirmLayer.className='tv2-confirm-layer';
    deleteConfirmLayer.innerHTML=
      '<div class="tv2-confirm-backdrop" data-confirm-cancel></div>'+
      '<div class="tv2-confirm-card" role="dialog" aria-modal="true" aria-labelledby="tv2CategoryDeleteTitle">'+
        '<h2 id="tv2CategoryDeleteTitle">Delete category?</h2>'+
        '<p>Delete <strong>'+esc(section.label)+'</strong>? Its items will move to <strong>Other</strong>.</p>'+
        '<p class="tv2-confirm-error" aria-live="polite"></p>'+
        '<div class="tv2-confirm-actions"><button type="button" data-confirm-cancel>Cancel</button><button type="button" class="is-delete" data-confirm-delete>Delete</button></div>'+
      '</div>';
    document.body.appendChild(deleteConfirmLayer);
    const cancel=()=>{
      closeDeleteConfirm();
      closeOtherCategorySwipes();
    };
    deleteConfirmLayer.querySelectorAll('[data-confirm-cancel]').forEach((button)=>button.addEventListener('click',cancel));
    deleteConfirmLayer.addEventListener('keydown',(e)=>{if(e.key==='Escape')cancel();});
    const deleteButton=deleteConfirmLayer.querySelector('[data-confirm-delete]');
    deleteButton?.addEventListener('click',async()=>{
      if(state.busy)return;
      const previousSections=JSON.parse(JSON.stringify(prep.packingSections));
      const previousPacking=JSON.parse(JSON.stringify(prep.packing));
      deleteButton.disabled=true;
      deleteButton.textContent='Deleting…';
      const error=deleteConfirmLayer.querySelector('.tv2-confirm-error');
      if(error)error.textContent='';
      prep.packingSections=checklistPackingSections(prep.packingSections).filter((entry)=>entry.id!==id);
      moveDeletedCategoryItemsToOther(id);
      try{
        state.busy=true;
        const payload=recurrentPayload();
        recurrentSaveQueue=recurrentSaveQueue.catch(()=>{}).then(()=>
          window.TwogetherAPI.post('saveTripPrepDefaults',{prep:payload},actor())
        );
        recurrentSaveQueue.catch(()=>{});
        const result=await recurrentSaveQueue;
        if(remoteState&&result?.prep)remoteState.tripPrepDefaults=JSON.parse(JSON.stringify(result.prep));
        if(result?.prep?.packingSections)prep.packingSections=checklistPackingSections(result.prep.packingSections);
        if(result?.prep?.packing)prep.packing=JSON.parse(JSON.stringify(result.prep.packing));
        state.busy=false;
        closeDeleteConfirm();
        render();
        simplifiedSnack('Category deleted');
      }catch(err){
        prep.packingSections=previousSections;
        prep.packing=previousPacking;
        state.busy=false;
        deleteButton.disabled=false;
        deleteButton.textContent='Delete';
        if(error)error.textContent=err?.message||'Could not delete category';
      }
    });
  };

  sheet.addEventListener('touchstart',(e)=>{
    if(state.busy||deleteConfirmLayer||e.touches.length!==1||e.target.closest('[data-check-category-drag]'))return;
    const row=e.target.closest('[data-check-category-swipe]');
    if(!row||!row.querySelector('.tv2-check-category-delete-reveal'))return;
    closeOtherCategorySwipes(row);
    resetCategorySwipeVisual(row,false);
    const t=e.touches[0];
    categorySwipe={tracking:true,active:false,startX:t.clientX,startY:t.clientY,lastX:t.clientX,lastY:t.clientY,row};
  },{passive:true});

  sheet.addEventListener('touchmove',(e)=>{
    if(!categorySwipe.tracking||!categorySwipe.row||e.touches.length!==1)return;
    const t=e.touches[0];
    const dx=t.clientX-categorySwipe.startX;
    const dy=Math.abs(t.clientY-categorySwipe.startY);
    categorySwipe.lastX=t.clientX;
    categorySwipe.lastY=t.clientY;
    if(!categorySwipe.active){
      if(Math.abs(dx)<8&&dy<8)return;
      if(dx<-10&&Math.abs(dx)>dy*1.2)categorySwipe.active=true;
      else{
        resetCategorySwipeVisual(categorySwipe.row,true);
        resetCategorySwipeState();
        return;
      }
    }
    e.preventDefault();
    const row=categorySwipe.row;
    const width=row.getBoundingClientRect().width||280;
    const distance=Math.max(-width*.94,Math.min(0,dx));
    const exposed=Math.abs(distance);
    const card=row.querySelector('.tv2-check-category-row');
    const reveal=row.querySelector('.tv2-check-category-delete-reveal');
    if(card){
      card.style.transition='none';
      card.style.transform='translateX('+distance+'px)';
    }
    if(reveal){
      reveal.style.transition='none';
      reveal.style.width=exposed+'px';
      reveal.style.opacity=String(Math.min(1,.35+exposed/120));
    }
  },{passive:false});

  sheet.addEventListener('touchend',(e)=>{
    if(!categorySwipe.tracking||!categorySwipe.row){
      resetCategorySwipeState();
      return;
    }
    const row=categorySwipe.row;
    const dx=categorySwipe.lastX-categorySwipe.startX;
    const width=row.getBoundingClientRect().width||280;
    const threshold=Math.max(180,width*.62);
    const fullSwipe=categorySwipe.active&&-dx>=threshold;
    const id=checklistSection(row.dataset.checkCategoryRow);
    if(!fullSwipe){
      resetCategorySwipeVisual(row,true);
      resetCategorySwipeState();
      return;
    }
    e.preventDefault();
    const card=row.querySelector('.tv2-check-category-row');
    const reveal=row.querySelector('.tv2-check-category-delete-reveal');
    if(card){
      card.style.transition='transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      card.style.transform='translateX(-'+width+'px)';
      card.style.opacity='.76';
    }
    if(reveal){
      reveal.style.transition='width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      reveal.style.width=width+'px';
      reveal.style.opacity='1';
    }
    resetCategorySwipeState();
    setTimeout(()=>{
      resetCategorySwipeVisual(row,false);
      openCategoryDeleteConfirm(id);
    },180);
  },{passive:false});

  sheet.addEventListener('touchcancel',()=>{
    resetCategorySwipeVisual(categorySwipe.row,true);
    resetCategorySwipeState();
  },{passive:true});

  let categoryDragFrame=0;
  let categoryAutoScrollFrame=0;
  let categoryProtectedTouchId=null;
  let categoryDrag={
    timer:null,
    tracking:false,
    active:false,
    touchId:null,
    row:null,
    list:null,
    ghost:null,
    startX:0,
    startY:0,
    lastY:0,
    activationY:0,
    grabOffsetY:0,
  };
  const categoryTouchFor=(touches,id)=>
    [...(touches||[])].find((touch)=>touch.identifier===id)||null;
  const clearCategoryDragTimer=()=>{
    if(categoryDrag.timer)clearTimeout(categoryDrag.timer);
    categoryDrag.timer=null;
  };
  const setCategoryGestureLock=(locked)=>{
    if(locked){
      simplifiedLayer.dataset.tv2GestureLock='1';
      simplifiedLayer.dataset.tv2GestureOwner='reorder';
      sheet.style.transition='none';
      sheet.style.transform='translateY(0)';
      sheet.style.opacity='1';
      sheet.style.scrollBehavior='auto';
      const backdrop=simplifiedLayer.querySelector('.tv2-backdrop');
      if(backdrop){
        backdrop.style.transition='none';
        backdrop.style.opacity='1';
      }
      return;
    }
    if(simplifiedLayer?.isConnected){
      delete simplifiedLayer.dataset.tv2GestureLock;
      delete simplifiedLayer.dataset.tv2GestureOwner;
    }
    sheet.style.scrollBehavior='';
  };
  const cleanupCategoryDragVisual=()=>{
    categoryDrag.ghost?.remove();
    categoryDrag.ghost=null;
    if(categoryDrag.row){
      categoryDrag.row.classList.remove('is-reorder-slot');
      categoryDrag.row.style.transition='';
      categoryDrag.row.style.transform='';
    }
    sheet.classList.remove('is-reordering-categories');
  };
  const resetCategoryDrag=()=>{
    clearCategoryDragTimer();
    if(categoryDragFrame){cancelAnimationFrame(categoryDragFrame);categoryDragFrame=0;}
    if(categoryAutoScrollFrame){cancelAnimationFrame(categoryAutoScrollFrame);categoryAutoScrollFrame=0;}
    cleanupCategoryDragVisual();
    setCategoryGestureLock(false);
    categoryProtectedTouchId=null;
    categoryDrag={timer:null,tracking:false,active:false,touchId:null,row:null,list:null,ghost:null,startX:0,startY:0,lastY:0,activationY:0,grabOffsetY:0};
  };
  const categoryHandleForTouch=(target,touch)=>{
    const direct=target?.closest?.('[data-check-category-drag]');
    if(direct)return direct;
    const row=target?.closest?.('[data-check-category-swipe]');
    if(!row||!touch)return null;
    const rect=row.getBoundingClientRect();
    if(touch.clientY<rect.top||touch.clientY>rect.bottom||touch.clientX<rect.right-52||touch.clientX>rect.right)return null;
    return row.querySelector('[data-check-category-drag]');
  };
  const animateCategoryLayout=(beforeRects)=>{
    requestAnimationFrame(()=>{
      if(!categoryDrag.list)return;
      const rows=[...categoryDrag.list.querySelectorAll('[data-check-category-swipe]')];
      rows.forEach((row)=>{
        if(row===categoryDrag.row)return;
        const oldTop=beforeRects.get(row);
        if(oldTop==null)return;
        const newTop=row.getBoundingClientRect().top;
        const delta=oldTop-newTop;
        if(Math.abs(delta)<.5)return;
        row.style.transition='none';
        row.style.transform='translate3d(0,'+delta+'px,0)';
        void row.offsetHeight;
        row.style.transition='transform .17s cubic-bezier(.22,.8,.28,1)';
        row.style.transform='translate3d(0,0,0)';
        setTimeout(()=>{
          if(row?.isConnected){
            row.style.transition='';
            row.style.transform='';
          }
        },190);
      });
    });
  };
  const moveCategorySlot=(beforeRow)=>{
    if(!categoryDrag.active||!categoryDrag.list||!categoryDrag.row)return;
    const anchor=categoryDrag.list.querySelector('.tv2-check-category-add');
    const currentNext=categoryDrag.row.nextElementSibling;
    if((beforeRow&&currentNext===beforeRow)||(!beforeRow&&currentNext===anchor))return;
    const rows=[...categoryDrag.list.querySelectorAll('[data-check-category-swipe]')];
    const beforeRects=new Map(rows.filter((row)=>row!==categoryDrag.row).map((row)=>[row,row.getBoundingClientRect().top]));
    if(beforeRow)categoryDrag.list.insertBefore(categoryDrag.row,beforeRow);
    else if(anchor)categoryDrag.list.insertBefore(categoryDrag.row,anchor);
    animateCategoryLayout(beforeRects);
    try{if(typeof navigator.vibrate==='function')navigator.vibrate(8);}catch{}
  };
  const placeCategorySlot=(touchY)=>{
    if(!categoryDrag.active||!categoryDrag.row||!categoryDrag.list)return;
    const rows=[...categoryDrag.list.querySelectorAll('[data-check-category-swipe]')].filter((row)=>row!==categoryDrag.row);
    const before=rows.find((row)=>{
      const rect=row.getBoundingClientRect();
      return touchY<rect.top+rect.height/2;
    })||null;
    moveCategorySlot(before);
  };
  const clampCategoryDragY=(touchY)=>{
    if(!categoryDrag.ghost)return touchY;
    const rect=sheet.getBoundingClientRect();
    const height=categoryDrag.ghost.getBoundingClientRect().height||categoryDrag.row?.getBoundingClientRect().height||0;
    const grab=Math.max(0,Math.min(height,categoryDrag.grabOffsetY));
    const pad=8;
    const minY=rect.top+pad+grab;
    const maxY=rect.bottom-pad-Math.max(0,height-grab);
    return maxY<minY?(minY+maxY)/2:Math.max(minY,Math.min(maxY,touchY));
  };
  const paintCategoryDrag=(touchY)=>{
    if(!categoryDrag.active||!categoryDrag.ghost)return;
    const y=clampCategoryDragY(touchY);
    categoryDrag.ghost.style.transform='translate3d(0,'+(y-categoryDrag.activationY)+'px,0) scale(1)';
    placeCategorySlot(y);
  };
  const scheduleCategoryDrag=(touchY)=>{
    categoryDrag.lastY=touchY;
    if(categoryDragFrame)return;
    categoryDragFrame=requestAnimationFrame(()=>{
      categoryDragFrame=0;
      paintCategoryDrag(categoryDrag.lastY);
    });
  };
  const startCategoryAutoScroll=()=>{
    if(categoryAutoScrollFrame)return;
    const tick=()=>{
      if(!categoryDrag.active){categoryAutoScrollFrame=0;return;}
      const rect=sheet.getBoundingClientRect();
      const edge=Math.min(112,Math.max(76,rect.height*.19));
      const y=categoryDrag.lastY;
      let delta=0;
      if(y<rect.top+edge){
        const strength=Math.min(1,Math.max(0,(rect.top+edge-y)/edge));
        delta=-(5+24*strength*strength);
      }else if(y>rect.bottom-edge){
        const strength=Math.min(1,Math.max(0,(y-(rect.bottom-edge))/edge));
        delta=5+24*strength*strength;
      }
      if(delta){
        const maxScroll=Math.max(0,sheet.scrollHeight-sheet.clientHeight);
        const before=sheet.scrollTop;
        sheet.scrollTop=Math.max(0,Math.min(maxScroll,before+delta));
        if(Math.abs(sheet.scrollTop-before)>.1)scheduleCategoryDrag(y);
      }
      categoryAutoScrollFrame=requestAnimationFrame(tick);
    };
    categoryAutoScrollFrame=requestAnimationFrame(tick);
  };
  const beginCategoryDrag=()=>{
    if(!categoryDrag.tracking||categoryDrag.active||!categoryDrag.row||!categoryDrag.list)return;
    clearCategoryDragTimer();
    const sourceCard=categoryDrag.row.querySelector('.tv2-check-category-row');
    if(!sourceCard)return;
    const rect=sourceCard.getBoundingClientRect();
    const ghost=sourceCard.cloneNode(true);
    ghost.classList.add('tv2-check-category-drag-ghost');
    ghost.querySelectorAll('input,button').forEach((control)=>{
      control.tabIndex=-1;
      control.setAttribute('aria-hidden','true');
    });
    const sheetRect=sheet.getBoundingClientRect();
    const inset=8;
    const ghostLeft=Math.max(sheetRect.left+inset,rect.left);
    const ghostRight=Math.min(sheetRect.right-inset,rect.right);
    ghost.style.top=rect.top+'px';
    ghost.style.left=ghostLeft+'px';
    ghost.style.width=Math.max(1,ghostRight-ghostLeft)+'px';
    ghost.style.height=rect.height+'px';
    ghost.style.transform='translate3d(0,0,0) scale(1)';
    simplifiedLayer.appendChild(ghost);
    categoryDrag.ghost=ghost;
    categoryDrag.active=true;
    categoryDrag.activationY=categoryDrag.lastY;
    categoryDrag.grabOffsetY=categoryDrag.lastY-rect.top;
    categoryDrag.row.classList.add('is-reorder-slot');
    sheet.classList.add('is-reordering-categories');
    setCategoryGestureLock(true);
    try{if(typeof navigator.vibrate==='function')navigator.vibrate(10);}catch{}
    startCategoryAutoScroll();
  };
  const finishCategoryDrag=()=>{
    const ids=[...categoryDrag.list.querySelectorAll('[data-check-category-swipe]')].map((row)=>checklistSection(row.dataset.checkCategoryRow));
    const byId=new Map(checklistPackingSections(prep.packingSections).map((section)=>[section.id,section]));
    prep.packingSections=ids.map((id)=>byId.get(id)).filter(Boolean);
    resetCategoryDrag();
    render();
    autoSaveRecurrentOrder();
  };

  sheet.addEventListener('touchstart',(e)=>{
    if(state.busy||deleteConfirmLayer||e.touches.length!==1)return;
    const t=e.touches[0];
    const handle=categoryHandleForTouch(e.target,t);
    if(!handle)return;
    sheet.__tv2CancelSwipeDown?.();
    resetCategoryDrag();
    closeOtherCategorySwipes();
    categoryProtectedTouchId=t.identifier;
    setCategoryGestureLock(true);
    e.preventDefault();
    e.stopImmediatePropagation();
    const row=handle.closest('[data-check-category-swipe]');
    const list=row?.closest('.tv2-check-category-manager');
    if(!row||!list)return;
    categoryDrag.tracking=true;
    categoryDrag.touchId=t.identifier;
    categoryDrag.row=row;
    categoryDrag.list=list;
    categoryDrag.startX=t.clientX;
    categoryDrag.startY=t.clientY;
    categoryDrag.lastY=t.clientY;
    categoryDrag.timer=setTimeout(beginCategoryDrag,180);
  },{passive:false,capture:true});

  sheet.addEventListener('touchmove',(e)=>{
    if(!categoryDrag.tracking)return;
    const t=categoryTouchFor(e.touches,categoryDrag.touchId);
    if(!t)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    categoryDrag.lastY=t.clientY;
    if(!categoryDrag.active){
      const dx=t.clientX-categoryDrag.startX;
      const dy=t.clientY-categoryDrag.startY;
      if(Math.hypot(dx,dy)>=3)beginCategoryDrag();
      else return;
    }
    if(categoryDrag.active)scheduleCategoryDrag(t.clientY);
  },{passive:false,capture:true});

  sheet.addEventListener('touchend',(e)=>{
    if(!categoryDrag.tracking)return;
    const t=categoryTouchFor(e.changedTouches,categoryDrag.touchId);
    if(!t)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(!categoryDrag.active){
      resetCategoryDrag();
      return;
    }
    if(categoryDragFrame){cancelAnimationFrame(categoryDragFrame);categoryDragFrame=0;}
    paintCategoryDrag(t.clientY);
    finishCategoryDrag();
  },{passive:false,capture:true});

  sheet.addEventListener('touchcancel',(e)=>{
    if(!categoryDrag.tracking)return;
    const t=categoryTouchFor(e.changedTouches,categoryDrag.touchId);
    if(t){
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    const wasActive=categoryDrag.active;
    resetCategoryDrag();
    if(wasActive)render();
  },{passive:false,capture:true});

  let recurrentSwipe={tracking:false,active:false,startX:0,startY:0,lastX:0,lastY:0,row:null,textScroller:null,textTimer:null,textMode:false,startScrollLeft:0};

  const clearRecurrentTextScrollTimer=()=>{
    if(recurrentSwipe.textTimer)clearTimeout(recurrentSwipe.textTimer);
    recurrentSwipe.textTimer=null;
  };

  const startRecurrentTextScroll=()=>{
    const scroller=recurrentSwipe.textScroller;
    if(!recurrentSwipe.tracking||recurrentSwipe.active||!scroller||scroller.scrollWidth<=scroller.clientWidth+2)return;
    recurrentSwipe.textMode=true;
    recurrentSwipe.startScrollLeft=scroller.scrollLeft;
    scroller.classList.add('is-longpress-scroll');
    resetRecurrentSwipeVisual(recurrentSwipe.row,false);
    try{if(typeof navigator.vibrate==='function')navigator.vibrate(8);}catch{}
  };

  const resetRecurrentSwipeVisual=(row,animate=true)=>{
    if(!row)return;
    const card=row.querySelector('.tv2-recurrent-row');
    const reveal=row.querySelector('.tv2-recurrent-delete-reveal');
    if(card){
      card.style.transition=animate?'transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease':'none';
      card.style.transform='translateX(0)';
      card.style.opacity='1';
    }
    if(reveal){
      reveal.style.transition=animate?'width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease':'none';
      reveal.style.width='0px';
      reveal.style.opacity='0';
    }
    if(animate)setTimeout(()=>{
      if(card?.isConnected)card.style.transition='';
      if(reveal?.isConnected)reveal.style.transition='';
    },220);
  };

  const resetRecurrentSwipeState=()=>{
    clearRecurrentTextScrollTimer();
    recurrentSwipe.textScroller?.classList.remove('is-longpress-scroll');
    recurrentSwipe={tracking:false,active:false,startX:0,startY:0,lastX:0,lastY:0,row:null,textScroller:null,textTimer:null,textMode:false,startScrollLeft:0};
  };

  const closeOtherRecurrentSwipes=(except=null)=>{
    sheet.querySelectorAll('[data-recurrent-swipe]').forEach((row)=>{
      if(row!==except)resetRecurrentSwipeVisual(row,true);
    });
  };

  const openRecurrentDeleteConfirm=(kind,id)=>{
    const item=Array.isArray(prep[kind])?prep[kind].find((entry)=>entry.id===id):null;
    if(!item)return;
    const viewItem=checklistViewItem(item,state.personal,actor());
    closeDeleteConfirm();
    deleteConfirmLayer=document.createElement('div');
    deleteConfirmLayer.className='tv2-confirm-layer';
    deleteConfirmLayer.innerHTML=
      '<div class="tv2-confirm-backdrop" data-confirm-cancel></div>'+
      '<div class="tv2-confirm-card" role="dialog" aria-modal="true" aria-labelledby="tv2RecurrentDeleteTitle">'+
        '<h2 id="tv2RecurrentDeleteTitle">Delete recurrent item?</h2>'+
        '<p>Are you sure you want to delete <strong>'+esc(viewItem.text||'this item')+'</strong>?</p>'+
        '<p class="tv2-confirm-error" aria-live="polite"></p>'+
        '<div class="tv2-confirm-actions"><button type="button" data-confirm-cancel>Cancel</button><button type="button" class="is-delete" data-confirm-delete>Delete</button></div>'+
      '</div>';
    document.body.appendChild(deleteConfirmLayer);

    const cancel=()=>{
      closeDeleteConfirm();
      closeOtherRecurrentSwipes();
    };
    deleteConfirmLayer.querySelectorAll('[data-confirm-cancel]').forEach((button)=>button.addEventListener('click',cancel));
    deleteConfirmLayer.addEventListener('keydown',(e)=>{if(e.key==='Escape')cancel();});

    const deleteButton=deleteConfirmLayer.querySelector('[data-confirm-delete]');
    deleteButton?.addEventListener('click',async()=>{
      if(state.busy)return;
      deleteButton.disabled=true;
      deleteButton.textContent='Deleting…';
      const error=deleteConfirmLayer.querySelector('.tv2-confirm-error');
      if(error)error.textContent='';
      const next={
        packing:prep.packing.map((entry)=>({...entry})),
        reminders:prep.reminders.map((entry)=>({...entry})),
      };
      const previousKind=prep[kind].map((entry)=>JSON.parse(JSON.stringify(entry)));
      const target=next[kind].find((entry)=>entry.id===id);
      if(state.personal&&target&&checklistIsShared(target))checklistHideInPersonalView(target,actor());
      else next[kind]=next[kind].filter((entry)=>entry.id!==id);
      prep[kind]=next[kind];
      try{
        state.busy=true;
        const payload=recurrentPayload();
        recurrentSaveQueue=recurrentSaveQueue.catch(()=>{}).then(()=>
          window.TwogetherAPI.post('saveTripPrepDefaults',{prep:payload},actor())
        );
        recurrentSaveQueue.catch(()=>{});
        const result=await recurrentSaveQueue;
        if(remoteState&&result?.prep)remoteState.tripPrepDefaults=JSON.parse(JSON.stringify(result.prep));
        state.busy=false;
        closeDeleteConfirm();
        render();
        simplifiedSnack('Recurrent item deleted');
      }catch(err){
        prep[kind]=previousKind;
        state.busy=false;
        deleteButton.disabled=false;
        deleteButton.textContent='Delete';
        if(error)error.textContent=err?.message||'Could not delete recurrent item';
      }
    });
  };

  sheet.addEventListener('touchstart',(e)=>{
    if(state.busy||deleteConfirmLayer||e.touches.length!==1||e.target.closest('[data-recurrent-drag]'))return;
    const row=e.target.closest('[data-recurrent-swipe]');
    if(!row)return;
    closeOtherRecurrentSwipes(row);
    resetRecurrentSwipeVisual(row,false);
    const t=e.touches[0];
    const textScroller=e.target.closest('[data-check-scroll]');
    const canTextScroll=!!textScroller&&textScroller.scrollWidth>textScroller.clientWidth+2;
    recurrentSwipe={
      tracking:true,active:false,startX:t.clientX,startY:t.clientY,lastX:t.clientX,lastY:t.clientY,row,
      textScroller:canTextScroll?textScroller:null,textTimer:null,textMode:false,startScrollLeft:textScroller?.scrollLeft||0
    };
    if(canTextScroll)recurrentSwipe.textTimer=setTimeout(startRecurrentTextScroll,260);
  },{passive:true});

  sheet.addEventListener('touchmove',(e)=>{
    if(!recurrentSwipe.tracking||!recurrentSwipe.row||e.touches.length!==1)return;
    const t=e.touches[0];
    const dx=t.clientX-recurrentSwipe.startX;
    const dy=Math.abs(t.clientY-recurrentSwipe.startY);
    recurrentSwipe.lastX=t.clientX;
    recurrentSwipe.lastY=t.clientY;

    if(recurrentSwipe.textMode&&recurrentSwipe.textScroller){
      e.preventDefault();
      const scroller=recurrentSwipe.textScroller;
      const maxScroll=Math.max(0,scroller.scrollWidth-scroller.clientWidth);
      scroller.scrollLeft=Math.max(0,Math.min(maxScroll,recurrentSwipe.startScrollLeft-dx));
      return;
    }

    if(!recurrentSwipe.active){
      if(Math.abs(dx)<8&&dy<8)return;
      clearRecurrentTextScrollTimer();
      if(dx<-10&&Math.abs(dx)>dy*1.2){
        recurrentSwipe.active=true;
      }else if(dy>=Math.abs(dx)||dx>10){
        resetRecurrentSwipeVisual(recurrentSwipe.row,true);
        resetRecurrentSwipeState();
        return;
      }
    }
    if(!recurrentSwipe.active)return;
    e.preventDefault();

    const row=recurrentSwipe.row;
    const width=row.getBoundingClientRect().width||280;
    const distance=Math.max(-width*.94,Math.min(0,dx));
    const exposed=Math.abs(distance);
    const card=row.querySelector('.tv2-recurrent-row');
    const reveal=row.querySelector('.tv2-recurrent-delete-reveal');
    if(card){
      card.style.transition='none';
      card.style.transform='translateX('+distance+'px)';
    }
    if(reveal){
      reveal.style.transition='none';
      reveal.style.width=exposed+'px';
      reveal.style.opacity=String(Math.min(1,.35+exposed/120));
    }
  },{passive:false});

  sheet.addEventListener('touchend',(e)=>{
    if(!recurrentSwipe.tracking||!recurrentSwipe.row){
      resetRecurrentSwipeState();
      return;
    }
    if(recurrentSwipe.textMode){
      e.preventDefault();
      resetRecurrentSwipeState();
      return;
    }
    clearRecurrentTextScrollTimer();
    const row=recurrentSwipe.row;
    const dx=recurrentSwipe.lastX-recurrentSwipe.startX;
    const width=row.getBoundingClientRect().width||280;
    const threshold=Math.max(180,width*.62);
    const fullSwipe=recurrentSwipe.active&&-dx>=threshold;
    const kind=row.dataset.checkKind,id=row.dataset.checkId;

    if(!fullSwipe){
      resetRecurrentSwipeVisual(row,true);
      resetRecurrentSwipeState();
      return;
    }

    const card=row.querySelector('.tv2-recurrent-row');
    const reveal=row.querySelector('.tv2-recurrent-delete-reveal');
    if(card){
      card.style.transition='transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      card.style.transform='translateX(-'+width+'px)';
      card.style.opacity='.76';
    }
    if(reveal){
      reveal.style.transition='width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      reveal.style.width=width+'px';
      reveal.style.opacity='1';
    }
    resetRecurrentSwipeState();
    setTimeout(()=>{
      resetRecurrentSwipeVisual(row,false);
      openRecurrentDeleteConfirm(kind,id);
    },180);
  },{passive:false});

  sheet.addEventListener('touchcancel',()=>{
    resetRecurrentSwipeVisual(recurrentSwipe.row,true);
    resetRecurrentSwipeState();
  },{passive:true});

  let recurrentDragFrame=0;
  let recurrentAutoScrollFrame=0;
  let recurrentDragPendingY=0;
  let recurrentProtectedTouchId=null;

  const recurrentGroupForRow=(row)=>{
    let node=row?.previousElementSibling;
    while(node){
      if(node.matches?.('[data-check-group-title]'))return checklistSection(node.dataset.checkGroupTitle);
      node=node.previousElementSibling;
    }
    return '';
  };
  const setRecurrentGestureLock=(locked)=>{
    if(locked){
      simplifiedLayer.dataset.tv2GestureLock='1';
      simplifiedLayer.dataset.tv2GestureOwner='reorder';
      sheet.style.transition='none';
      sheet.style.transform='translateY(0)';
      sheet.style.opacity='1';
      sheet.style.scrollBehavior='auto';
      const backdrop=simplifiedLayer.querySelector('.tv2-backdrop');
      if(backdrop){
        backdrop.style.transition='none';
        backdrop.style.opacity='1';
      }
      return;
    }
    if(simplifiedLayer?.isConnected){
      delete simplifiedLayer.dataset.tv2GestureLock;
      delete simplifiedLayer.dataset.tv2GestureOwner;
    }
    sheet.style.scrollBehavior='';
  };

  let recurrentDrag={
    timer:null,
    tracking:false,
    active:false,
    touchId:null,
    row:null,
    list:null,
    ghost:null,
    kind:'',
    itemId:'',
    startX:0,
    startY:0,
    lastY:0,
    activationY:0,
    grabOffsetY:0,
  };

  const dragHaptic=()=>{
    try{if(typeof navigator.vibrate==='function')navigator.vibrate(10);}catch{}
  };

  const touchForRecurrentDrag=(touches,id)=>
    [...(touches||[])].find((touch)=>touch.identifier===id)||null;

  const isRecurrentProtectedTouch=(touch)=>{
    if(!touch)return false;
    const rows=[...sheet.querySelectorAll('[data-recurrent-swipe]')];
    return rows.some((row)=>{
      const rect=row.getBoundingClientRect();
      return touch.clientY>=rect.top&&touch.clientY<=rect.bottom&&
        touch.clientX>=rect.right-52&&touch.clientX<=rect.right;
    });
  };

  const recurrentHandleForTouch=(target,touch)=>{
    const direct=target?.closest?.('[data-recurrent-drag]');
    if(direct)return direct;
    const row=target?.closest?.('[data-recurrent-swipe]');
    if(!row||!touch)return null;
    const rect=row.getBoundingClientRect();
    if(touch.clientY<rect.top||touch.clientY>rect.bottom||
      touch.clientX<rect.right-52||touch.clientX>rect.right)return null;
    return row.querySelector('[data-recurrent-drag]');
  };

  const releaseRecurrentProtectedTouch=()=>{
    recurrentProtectedTouchId=null;
    if(!recurrentDrag.tracking)setRecurrentGestureLock(false);
  };

  const clearRecurrentDragTimer=()=>{
    if(recurrentDrag.timer)clearTimeout(recurrentDrag.timer);
    recurrentDrag.timer=null;
  };

  const animateRecurrentLayout=(beforeRects)=>{
    requestAnimationFrame(()=>{
      if(!recurrentDrag.list)return;
      const rows=[...recurrentDrag.list.querySelectorAll('[data-recurrent-swipe]')];
      rows.forEach((row)=>{
        if(row===recurrentDrag.row)return;
        const oldTop=beforeRects.get(row);
        if(oldTop==null)return;
        const newTop=row.getBoundingClientRect().top;
        const delta=oldTop-newTop;
        if(Math.abs(delta)<.5)return;
        row.style.transition='none';
        row.style.transform='translate3d(0,'+delta+'px,0)';
        void row.offsetHeight;
        row.style.transition='transform .17s cubic-bezier(.22,.8,.28,1)';
        row.style.transform='translate3d(0,0,0)';
        setTimeout(()=>{
          if(row?.isConnected){
            row.style.transition='';
            row.style.transform='';
          }
        },190);
      });
    });
  };

  const moveRecurrentSlot=(beforeRow)=>{
    if(!recurrentDrag.active||!recurrentDrag.list||!recurrentDrag.row)return;
    const currentNext=recurrentDrag.row.nextElementSibling;
    if((beforeRow&&currentNext===beforeRow)||(!beforeRow&&!currentNext))return;

    const rows=[...recurrentDrag.list.querySelectorAll('[data-recurrent-swipe]')];
    const beforeRects=new Map(rows.filter((row)=>row!==recurrentDrag.row).map((row)=>[row,row.getBoundingClientRect().top]));

    if(beforeRow)recurrentDrag.list.insertBefore(recurrentDrag.row,beforeRow);
    else recurrentDrag.list.appendChild(recurrentDrag.row);

    animateRecurrentLayout(beforeRects);
    dragHaptic();
  };

  const recurrentGroupTitleForY=(touchY)=>{
    const titles=[...recurrentDrag.list.querySelectorAll('[data-check-group-title]')].filter((title)=>title.getBoundingClientRect().height>0);
    if(!titles.length)return null;
    let target=titles[0];
    for(let index=1;index<titles.length;index+=1){
      const rect=titles[index].getBoundingClientRect();
      const boundary=rect.top+rect.height/2;
      if(touchY<boundary)return target;
      target=titles[index];
    }
    return target;
  };

  const placeRecurrentSlot=(touchY)=>{
    if(!recurrentDrag.active||!recurrentDrag.list||!recurrentDrag.row||!recurrentDrag.ghost)return;
    if(recurrentDrag.kind==='packing'){
      const title=recurrentGroupTitleForY(touchY);
      if(title){
        let nextTitle=title.nextElementSibling;
        while(nextTitle&&!nextTitle.matches?.('[data-check-group-title]'))nextTitle=nextTitle.nextElementSibling;
        const rows=[];
        let node=title.nextElementSibling;
        while(node&&node!==nextTitle){
          if(node.matches?.('[data-recurrent-swipe]')&&node!==recurrentDrag.row)rows.push(node);
          node=node.nextElementSibling;
        }
        const before=rows.find((row)=>{
          const rect=row.getBoundingClientRect();
          return touchY<rect.top+rect.height/2;
        })||nextTitle||null;
        moveRecurrentSlot(before);
        return;
      }
    }
    const ghostTop=touchY-recurrentDrag.grabOffsetY;
    const ghostHeight=recurrentDrag.ghost.getBoundingClientRect().height||recurrentDrag.row.getBoundingClientRect().height;
    const ghostCenter=ghostTop+ghostHeight/2;
    const rows=[...recurrentDrag.list.querySelectorAll('[data-recurrent-swipe]')].filter((row)=>row!==recurrentDrag.row);
    const before=rows.find((row)=>{
      const rect=row.getBoundingClientRect();
      return ghostCenter<rect.top+rect.height/2;
    })||null;
    moveRecurrentSlot(before);
  };

  const clampRecurrentDragY=(touchY)=>{
    if(!recurrentDrag.ghost)return touchY;
    const sheetRect=sheet.getBoundingClientRect();
    const ghostHeight=recurrentDrag.ghost.getBoundingClientRect().height||recurrentDrag.row?.getBoundingClientRect().height||0;
    const grab=Math.max(0,Math.min(ghostHeight,recurrentDrag.grabOffsetY));
    const pad=8;
    const minY=sheetRect.top+pad+grab;
    const maxY=sheetRect.bottom-pad-Math.max(0,ghostHeight-grab);
    if(maxY<minY)return (minY+maxY)/2;
    return Math.max(minY,Math.min(maxY,touchY));
  };

  const paintRecurrentDrag=(touchY)=>{
    if(!recurrentDrag.active||!recurrentDrag.ghost)return;
    const clampedY=clampRecurrentDragY(touchY);
    const dy=clampedY-recurrentDrag.activationY;
    recurrentDrag.ghost.style.transform='translate3d(0,'+dy+'px,0) scale(1)';
    placeRecurrentSlot(clampedY);
  };

  const scheduleRecurrentDragPaint=(touchY)=>{
    recurrentDragPendingY=touchY;
    if(recurrentDragFrame)return;
    recurrentDragFrame=requestAnimationFrame(()=>{
      recurrentDragFrame=0;
      paintRecurrentDrag(recurrentDragPendingY);
    });
  };

  const recurrentSectionScrollBounds=()=>{
    const section=recurrentDrag.list?.closest('.tv2-check-section');
    if(!section)return null;
    const sheetRect=sheet.getBoundingClientRect();
    const sectionRect=section.getBoundingClientRect();
    const contentTop=sheet.scrollTop+(sectionRect.top-sheetRect.top);
    const contentBottom=sheet.scrollTop+(sectionRect.bottom-sheetRect.top);
    const globalMax=Math.max(0,sheet.scrollHeight-sheet.clientHeight);
    const min=Math.max(0,Math.min(globalMax,contentTop-8));
    const max=Math.max(0,Math.min(globalMax,contentBottom-sheet.clientHeight+8));
    if(max<min)return {min:sheet.scrollTop,max:sheet.scrollTop,sectionRect,sheetRect};
    return {min,max,sectionRect,sheetRect};
  };
  const startRecurrentAutoScroll=()=>{
    if(recurrentAutoScrollFrame)return;
    const tick=()=>{
      if(!recurrentDrag.active||!recurrentDrag.list){
        recurrentAutoScrollFrame=0;
        return;
      }
      const bounds=recurrentSectionScrollBounds();
      if(!bounds){
        recurrentAutoScrollFrame=0;
        return;
      }
      const visibleTop=Math.max(bounds.sheetRect.top,bounds.sectionRect.top);
      const visibleBottom=Math.min(bounds.sheetRect.bottom,bounds.sectionRect.bottom);
      const visibleHeight=Math.max(1,visibleBottom-visibleTop);
      const edge=Math.min(112,Math.max(70,visibleHeight*.22));
      const y=recurrentDrag.lastY;
      let delta=0;
      if(y<visibleTop+edge&&sheet.scrollTop>bounds.min+.5){
        const strength=Math.min(1,Math.max(0,(visibleTop+edge-y)/edge));
        delta=-(5+24*strength*strength);
      }else if(y>visibleBottom-edge&&sheet.scrollTop<bounds.max-.5){
        const strength=Math.min(1,Math.max(0,(y-(visibleBottom-edge))/edge));
        delta=5+24*strength*strength;
      }
      if(delta){
        const before=sheet.scrollTop;
        sheet.scrollTop=Math.max(bounds.min,Math.min(bounds.max,before+delta));
        if(Math.abs(sheet.scrollTop-before)>.1)scheduleRecurrentDragPaint(y);
      }
      recurrentAutoScrollFrame=requestAnimationFrame(tick);
    };
    recurrentAutoScrollFrame=requestAnimationFrame(tick);
  };

  const cleanupRecurrentDragVisual=()=>{
    recurrentDrag.ghost?.remove();
    recurrentDrag.ghost=null;
    if(recurrentDrag.row){
      recurrentDrag.row.classList.remove('is-reorder-slot');
      recurrentDrag.row.style.transition='';
      recurrentDrag.row.style.transform='';
    }
    sheet.classList.remove('is-reordering-items');
  };

  const resetRecurrentDrag=()=>{
    clearRecurrentDragTimer();
    if(recurrentDragFrame){
      cancelAnimationFrame(recurrentDragFrame);
      recurrentDragFrame=0;
    }
    if(recurrentAutoScrollFrame){
      cancelAnimationFrame(recurrentAutoScrollFrame);
      recurrentAutoScrollFrame=0;
    }
    cleanupRecurrentDragVisual();
    setRecurrentGestureLock(false);
    recurrentDrag={
      timer:null,
      tracking:false,
      active:false,
      touchId:null,
      row:null,
      list:null,
      ghost:null,
      kind:'',
      itemId:'',
      startX:0,
      startY:0,
      lastY:0,
      activationY:0,
      grabOffsetY:0,
    };
  };

  const beginRecurrentDrag=()=>{
    if(!recurrentDrag.tracking||recurrentDrag.active||!recurrentDrag.row||!recurrentDrag.list)return;
    clearRecurrentDragTimer();

    const sourceCard=recurrentDrag.row.querySelector('.tv2-recurrent-row');
    if(!sourceCard)return;
    const rect=sourceCard.getBoundingClientRect();
    const sourceStyle=getComputedStyle(sourceCard);
    const ghost=sourceCard.cloneNode(true);
    ghost.classList.add('tv2-recurrent-drag-ghost');
    ghost.style.gridTemplateColumns=sourceStyle.gridTemplateColumns;
    ghost.style.columnGap=sourceStyle.columnGap;
    ghost.style.rowGap=sourceStyle.rowGap;
    ghost.querySelectorAll('input,button').forEach((control)=>{
      control.tabIndex=-1;
      control.setAttribute('aria-hidden','true');
    });

    const sheetRect=sheet.getBoundingClientRect();
    const inset=8;
    const ghostLeft=Math.max(sheetRect.left+inset,rect.left);
    const ghostRight=Math.min(sheetRect.right-inset,rect.right);
    ghost.style.top=rect.top+'px';
    ghost.style.left=ghostLeft+'px';
    ghost.style.width=Math.max(1,ghostRight-ghostLeft)+'px';
    ghost.style.height=rect.height+'px';
    ghost.style.transform='translate3d(0,0,0) scale(1)';
    simplifiedLayer.appendChild(ghost);

    recurrentDrag.ghost=ghost;
    recurrentDrag.active=true;
    setRecurrentGestureLock(true);
    recurrentDrag.activationY=recurrentDrag.lastY;
    recurrentDrag.grabOffsetY=recurrentDrag.lastY-rect.top;

    recurrentDrag.row.classList.add('is-reorder-slot');
    sheet.classList.add('is-reordering-items');
    dragHaptic();
    startRecurrentAutoScroll();
  };

  const finishRecurrentDrag=()=>{
    const kind=recurrentDrag.kind;
    const list=recurrentDrag.list;
    if(kind&&Array.isArray(prep[kind])&&list){
      const rows=[...list.querySelectorAll('[data-recurrent-swipe]')];
      const ids=rows.map((row)=>row.dataset.checkId);
      if(kind==='packing'){
        const byId=new Map(prep[kind].map((item)=>[item.id,item]));
        rows.forEach((row)=>{
          const item=byId.get(row.dataset.checkId);
          if(!item)return;
          const group=recurrentGroupForRow(row)||'other';
          const view=checklistViewItem(item,state.personal,actor());
          const inferred=inferredChecklistSection(view?.text,checklistPackingSections(prep.packingSections));
          checklistSetViewField(item,state.personal,actor(),'section',group===inferred?'':group);
        });
      }
      if(state.personal){
        checklistSetPersonalOrder(prep[kind],actor(),ids);
      }else{
        const visibleSet=new Set(ids);
        const byId=new Map(prep[kind].map((item)=>[item.id,item]));
        let index=0;
        prep[kind]=prep[kind].map((item)=>{
          if(!visibleSet.has(item.id))return item;
          return byId.get(ids[index++])||item;
        });
      }
    }
    resetRecurrentDrag();
    render();
    autoSaveRecurrentOrder();
  };

  const cancelRecurrentDrag=()=>{
    const wasActive=recurrentDrag.active;
    resetRecurrentDrag();
    if(wasActive)render();
  };

  sheet.addEventListener('touchstart',(e)=>{
    if(state.busy||deleteConfirmLayer||e.touches.length!==1)return;
    const t=e.touches[0];
    const handle=recurrentHandleForTouch(e.target,t);
    const protectedZone=!!handle||isRecurrentProtectedTouch(t);

    if(handle){
      sheet.__tv2CancelSwipeDown?.();
      resetRecurrentDrag();
    }

    if(protectedZone){
      recurrentProtectedTouchId=t.identifier;
      setRecurrentGestureLock(true);
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    if(!handle)return;
    const row=handle.closest('[data-recurrent-swipe]');
    const list=row?.closest('.tv2-check-list');
    if(!row||!list)return;

    closeOtherRecurrentSwipes();

    recurrentDrag.tracking=true;
    recurrentDrag.touchId=t.identifier;
    recurrentDrag.row=row;
    recurrentDrag.list=list;
    recurrentDrag.kind=row.dataset.checkKind||'';
    recurrentDrag.itemId=row.dataset.checkId||'';
    recurrentDrag.startX=t.clientX;
    recurrentDrag.startY=t.clientY;
    recurrentDrag.lastY=t.clientY;
    recurrentDrag.timer=setTimeout(beginRecurrentDrag,180);
  },{passive:false,capture:true});

  sheet.addEventListener('touchmove',(e)=>{
    const protectedTouch=touchForRecurrentDrag(e.touches,recurrentProtectedTouchId);
    if(protectedTouch){
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    if(!recurrentDrag.tracking)return;
    const t=touchForRecurrentDrag(e.touches,recurrentDrag.touchId);
    if(!t)return;

    e.preventDefault();
    e.stopImmediatePropagation();
    recurrentDrag.lastY=t.clientY;

    if(!recurrentDrag.active){
      const dx=t.clientX-recurrentDrag.startX;
      const dy=t.clientY-recurrentDrag.startY;
      if(Math.hypot(dx,dy)>=3)beginRecurrentDrag();
      else return;
    }
    if(!recurrentDrag.active)return;

    scheduleRecurrentDragPaint(t.clientY);
  },{passive:false,capture:true});

  sheet.addEventListener('touchend',(e)=>{
    const protectedTouch=touchForRecurrentDrag(e.changedTouches,recurrentProtectedTouchId);
    if(protectedTouch){
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    if(!recurrentDrag.tracking){
      if(protectedTouch)releaseRecurrentProtectedTouch();
      return;
    }
    const t=touchForRecurrentDrag(e.changedTouches,recurrentDrag.touchId);
    if(!t)return;

    e.preventDefault();
    e.stopImmediatePropagation();

    if(!recurrentDrag.active){
      resetRecurrentDrag();
      recurrentProtectedTouchId=null;
      return;
    }

    if(recurrentDragFrame){
      cancelAnimationFrame(recurrentDragFrame);
      recurrentDragFrame=0;
    }
    paintRecurrentDrag(t.clientY);
    recurrentProtectedTouchId=null;
    finishRecurrentDrag();
  },{passive:false,capture:true});

  sheet.addEventListener('touchcancel',(e)=>{
    const protectedTouch=touchForRecurrentDrag(e.changedTouches,recurrentProtectedTouchId);
    if(protectedTouch){
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    if(!recurrentDrag.tracking){
      if(protectedTouch)releaseRecurrentProtectedTouch();
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    recurrentProtectedTouchId=null;
    cancelRecurrentDrag();
  },{passive:false,capture:true});

  sheet.addEventListener('input',(e)=>{
    if(e.target.matches('[data-check-category-label]')){
      const id=checklistSection(e.target.dataset.checkCategoryLabel);
      const stored=prep.packingSections.find((entry)=>checklistSection(entry.id)===id);
      if(stored)stored.label=String(e.target.value||'').slice(0,48);
      sheet.querySelectorAll('[data-check-group-title="'+CSS.escape(id)+'"] span').forEach((label)=>{
        label.textContent=String(e.target.value||'').trim()||(id==='other'?'Other':'Category');
      });
      return;
    }
    if(!e.target.matches('[data-check-text]'))return;
    const item=findItem(e.target.closest('.tv2-check-row'));
    if(item)checklistSetViewField(item,state.personal,actor(),'text',e.target.value);
    syncRecurrentTextWidth(e.target);
  });
  sheet.addEventListener('change',(e)=>{
    if(e.target.matches('[data-check-category-label]')){
      const id=checklistSection(e.target.dataset.checkCategoryLabel);
      const stored=prep.packingSections.find((entry)=>checklistSection(entry.id)===id);
      if(stored)stored.label=String(e.target.value||'').trim().slice(0,48)||(id==='other'?'Other':'Category');
      render();
      return;
    }
    if(!e.target.matches('[data-check-text]'))return;
    const item=findItem(e.target.closest('.tv2-check-row'));
    if(item)checklistSetViewField(item,state.personal,actor(),'text',e.target.value.trim());
  });
  sheet.addEventListener('keydown',(e)=>{
    const categoryInput=e.target.closest('[data-check-category-new]');
    if(categoryInput&&e.key==='Enter'){
      e.preventDefault();
      sheet.querySelector('[data-check-category-add]')?.click();
      return;
    }
    const input=e.target.closest('[data-check-new]');if(!input||e.key!=='Enter')return;
    e.preventDefault();addItem(input.dataset.checkNew);
  });
  sheet.addEventListener('click',(e)=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-close')){closeSimplifiedSheet();return;}
    if(b.hasAttribute('data-check-back')){closeSimplifiedSheet();openSimplifiedChecklist(plan,state.personal);return;}
    if(b.hasAttribute('data-check-categories')){state.categoriesOpen=!state.categoriesOpen;render();return;}
    if(b.hasAttribute('data-check-category-add')){
      const input=sheet.querySelector('[data-check-category-new]');
      const label=String(input?.value||'').trim().slice(0,48);
      if(!label)return;
      const sections=checklistPackingSections(prep.packingSections);
      if(sections.some((section)=>section.label.toLowerCase()===label.toLowerCase())){
        state.error='That category already exists.';
        render();
        return;
      }
      prep.packingSections=[...sections.filter((section)=>section.id!=='other'),{id:checklistCategoryId(),label},sections.find((section)=>section.id==='other')||{id:'other',label:'Other'}];
      state.error='';
      render();
      requestAnimationFrame(()=>sheet.querySelector('[data-check-category-new]')?.focus());
      return;
    }
    if(b.dataset.checkAdd){addItem(b.dataset.checkAdd);return;}
    if(b.hasAttribute('data-check-defaults-save'))saveDefaults();
  });
  simplifiedLayer.querySelector('.tv2-backdrop').onclick=closeSimplifiedSheet;
  simplifiedLayer.addEventListener('keydown',(e)=>{if(e.key==='Escape')closeSimplifiedSheet();});
  render();
}

function bindChecklistSwipeDown(layer, sheet) {
  if (!layer || !sheet || layer.dataset.tv2SwipeDown === '1') return;
  layer.dataset.tv2SwipeDown = '1';
  const mobile = () => window.matchMedia?.('(max-width:760px)')?.matches ?? window.innerWidth <= 760;
  const startsInChecklistHeader = (e) => {
    const target=e.target;
    return !!target?.closest?.('.tv2-sheet-head') && !target.closest?.('button,input,textarea,select,a');
  };
  const startsInChecklistNoCloseStrip = (e) => {
    const row=e.target.closest?.('[data-recurrent-swipe],[data-check-swipe]');
    const touch=e.touches?.[0];
    if(!row||!touch)return false;
    const rect=row.getBoundingClientRect();
    return touch.clientY>=rect.top&&touch.clientY<=rect.bottom&&
      touch.clientX>=rect.right-52&&touch.clientX<=rect.right;
  };
  let gesture = { tracking:false, active:false, startX:0, startY:0, lastY:0 };

  const resetVisual = (animate = true) => {
    sheet.style.transition = animate ? 'transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease' : 'none';
    sheet.style.transform = 'translateY(0)';
    sheet.style.opacity = '1';
    const backdrop = layer.querySelector('.tv2-backdrop');
    if (backdrop) {
      backdrop.style.transition = animate ? 'opacity .18s ease' : 'none';
      backdrop.style.opacity = '1';
    }
    if (animate) setTimeout(() => {
      if (sheet.isConnected) sheet.style.transition = '';
      if (backdrop?.isConnected) backdrop.style.transition = '';
    }, 220);
  };
  const clear = (animate = true) => {
    if (gesture.active) resetVisual(animate);
    gesture = { tracking:false, active:false, startX:0, startY:0, lastY:0 };
  };
  const cancelSwipeDownForReorder=()=>{
    gesture = { tracking:false, active:false, startX:0, startY:0, lastY:0 };
    resetVisual(false);
  };
  sheet.__tv2CancelSwipeDown=cancelSwipeDownForReorder;

  sheet.addEventListener('touchstart', (e) => {
    if (!mobile() || e.touches.length !== 1 || !startsInChecklistHeader(e) || layer.dataset.tv2GestureLock === '1' || layer.dataset.tv2GestureOwner === 'reorder' || sheet.scrollTop > 1 || sheet.classList.contains('is-reordering-items') || e.target.closest?.('[data-recurrent-drag],[data-check-drag]') || startsInChecklistNoCloseStrip(e)) return;
    const t = e.touches[0];
    gesture = { tracking:true, active:false, startX:t.clientX, startY:t.clientY, lastY:t.clientY };
  }, { passive:true });

  sheet.addEventListener('touchmove', (e) => {
    if (layer.dataset.tv2GestureLock === '1' || layer.dataset.tv2GestureOwner === 'reorder' || sheet.classList.contains('is-reordering-items')) {
      cancelSwipeDownForReorder();
      return;
    }
    if (!gesture.tracking || e.touches.length !== 1) return;
    const t = e.touches[0], dx = Math.abs(t.clientX - gesture.startX), dy = t.clientY - gesture.startY;
    gesture.lastY = t.clientY;
    if (!gesture.active) {
      if (dx < 8 && Math.abs(dy) < 8) return;
      if (dy > 10 && dy > dx * 1.25 && sheet.scrollTop <= 1) gesture.active = true;
      else { gesture.tracking = false; return; }
    }
    if (!gesture.active) return;
    e.preventDefault();
    const distance = Math.max(0, Math.min(dy, window.innerHeight * .72));
    sheet.style.transition = 'none';
    sheet.style.transform = 'translateY('+distance+'px)';
    sheet.style.opacity = String(Math.max(.82, 1 - distance / (window.innerHeight * 2.2)));
    const backdrop = layer.querySelector('.tv2-backdrop');
    if (backdrop) {
      backdrop.style.transition = 'none';
      backdrop.style.opacity = String(Math.max(.48, 1 - distance / (window.innerHeight * .95)));
    }
  }, { passive:false });

  sheet.addEventListener('touchend', () => {
    if (layer.dataset.tv2GestureLock === '1' || layer.dataset.tv2GestureOwner === 'reorder' || sheet.classList.contains('is-reordering-items')) {
      cancelSwipeDownForReorder();
      return;
    }
    if (!gesture.tracking) { gesture = { tracking:false, active:false, startX:0, startY:0, lastY:0 }; return; }
    const dy = gesture.lastY - gesture.startY;
    const dismiss = gesture.active && dy >= Math.min(110, window.innerHeight * .16);
    gesture = { tracking:false, active:false, startX:0, startY:0, lastY:0 };
    if (!dismiss) { resetVisual(true); return; }

    const backdrop = layer.querySelector('.tv2-backdrop');
    sheet.style.transition = 'transform .22s cubic-bezier(.22,.8,.28,1), opacity .18s ease';
    sheet.style.transform = 'translateY(100%)';
    sheet.style.opacity = '.72';
    if (backdrop) {
      backdrop.style.transition = 'opacity .18s ease';
      backdrop.style.opacity = '0';
    }
    setTimeout(() => {
      if (simplifiedLayer === layer) closeSimplifiedSheet();
      else layer.remove();
    }, 190);
  }, { passive:true });

  sheet.addEventListener('touchcancel', () => {
    if (layer.dataset.tv2GestureLock === '1') { gesture = { tracking:false, active:false, startX:0, startY:0, lastY:0 }; resetVisual(false); return; }
    clear(true);
  }, { passive:true });
}

function resetCardSwipeVisual(row, animate = true) {
  if (!row) return;
  const card = row.querySelector('.tv2-card');
  const checklist = row.querySelector('.tv2-checklist-reveal');
  const remove = row.querySelector('.tv2-delete-reveal');
  row.classList.remove('is-swiping-checklist','is-swiping-delete');
  [checklist,remove].forEach((action) => {
    if (!action) return;
    action.style.transition = animate ? 'width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease' : 'none';
    action.style.width = '0px';
    action.style.opacity = '0';
  });
  if (card) {
    card.style.transition = animate ? 'transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease' : 'none';
    card.style.transform = 'translateX(0)';
    card.style.opacity = '1';
  }
  if (animate) setTimeout(() => {
    [card,checklist,remove].forEach((el)=>{ if (el?.isConnected) el.style.transition=''; });
  },220);
}
function closeCardSwipeRows(except = null) {
  document.querySelectorAll('#twCurrentTrips .tv2-swipe-row').forEach((row) => {
    if (row !== except) resetCardSwipeVisual(row, true);
  });
}

function closeDeleteConfirm() {
  deleteConfirmLayer?.remove();
  deleteConfirmLayer = null;
}
function openDeleteConfirm(kind, id) {
  closeDeleteConfirm();
  const item = allSimplifiedItems().find((x) => x.kind === kind && x.id === id);
  if (!item) return;
  const name = item.meta?.city || locationLabel(item.meta) || 'this trip';
  deleteConfirmLayer = document.createElement('div');
  deleteConfirmLayer.className = 'tv2-confirm-layer';
  deleteConfirmLayer.innerHTML =
    '<div class="tv2-confirm-backdrop" data-confirm-cancel></div>'+
    '<div class="tv2-confirm-card" role="dialog" aria-modal="true" aria-labelledby="tv2DeleteTitle">'+
      '<h2 id="tv2DeleteTitle">Delete trip?</h2>'+
      '<p>Are you sure you want to delete <strong>'+esc(name)+'</strong>?</p>'+
      '<p class="tv2-confirm-note">This removes the trip and its logged expenses.</p>'+
      '<p class="tv2-confirm-error" aria-live="polite"></p>'+
      '<div class="tv2-confirm-actions"><button type="button" data-confirm-cancel>Cancel</button><button type="button" class="is-delete" data-confirm-delete>Delete</button></div>'+
    '</div>';
  document.body.appendChild(deleteConfirmLayer);
  const cancel = () => closeDeleteConfirm();
  deleteConfirmLayer.querySelectorAll('[data-confirm-cancel]').forEach((button) => button.addEventListener('click', cancel));
  deleteConfirmLayer.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDeleteConfirm(); });
  const deleteButton = deleteConfirmLayer.querySelector('[data-confirm-delete]');
  deleteButton.addEventListener('click', async () => {
    deleteButton.disabled = true;
    deleteButton.textContent = 'Deleting…';
    const error = deleteConfirmLayer.querySelector('.tv2-confirm-error');
    error.textContent = '';
    try {
      await window.TwogetherAPI.post('deleteCurrentTrip', { kind, id }, actor());
      closeDeleteConfirm();
      closeCardSwipeRows();
      await refreshState(true);
      simplifiedSnack('Trip deleted');
    } catch (err) {
      deleteButton.disabled = false;
      deleteButton.textContent = 'Delete';
      error.textContent = err?.message || 'Could not delete this trip';
    }
  });
  setTimeout(() => deleteButton.focus(), 0);
}
function bindCardDeleteSwipe(section) {
  if (section.dataset.tv2DeleteSwipe === '1') return;
  section.dataset.tv2DeleteSwipe = '1';
  const mobile = () => window.matchMedia?.('(max-width:760px)')?.matches ?? window.innerWidth <= 760;
  const resetState = () => {
    cardSwipe = { tracking:false, active:false, startX:0, startY:0, lastX:0, row:null, direction:'', ignoreClickUntil:cardSwipe.ignoreClickUntil || 0 };
  };
  const paint = (row, distance, direction) => {
    const card = row.querySelector('.tv2-card');
    const action = row.querySelector(direction === 'checklist' ? '.tv2-checklist-reveal' : '.tv2-delete-reveal');
    const other = row.querySelector(direction === 'checklist' ? '.tv2-delete-reveal' : '.tv2-checklist-reveal');
    if (!card || !action) return;
    row.classList.toggle('is-swiping-checklist', direction === 'checklist');
    row.classList.toggle('is-swiping-delete', direction === 'delete');
    const exposed = Math.abs(distance);
    card.style.transition = 'none';
    card.style.transform = 'translateX('+distance+'px)';
    action.style.transition = 'none';
    action.style.width = exposed+'px';
    action.style.opacity = String(Math.min(1, .35 + exposed / 120));
    if (other) { other.style.width='0px'; other.style.opacity='0'; }
  };
  const finishAction = (row, direction) => {
    const card = row.querySelector('.tv2-card');
    const action = row.querySelector(direction === 'checklist' ? '.tv2-checklist-reveal' : '.tv2-delete-reveal');
    const width = row.getBoundingClientRect().width || window.innerWidth - 32;
    const finalDistance = direction === 'checklist' ? width : -width;
    if (card) {
      card.style.transition = 'transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      card.style.transform = 'translateX('+finalDistance+'px)';
      card.style.opacity = '.76';
    }
    if (action) {
      action.style.transition = 'width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      action.style.width = width+'px';
      action.style.opacity = '1';
    }
  };

  section.addEventListener('touchstart', (e) => {
    if (!mobile() || simplifiedView.name !== 'home' || deleteConfirmLayer || simplifiedLayer || e.touches.length !== 1) return;
    const row = e.target.closest('.tv2-swipe-row'); if (!row) return;
    closeCardSwipeRows(row);
    resetCardSwipeVisual(row, false);
    const t = e.touches[0];
    cardSwipe = { tracking:true, active:false, startX:t.clientX, startY:t.clientY, lastX:t.clientX, row, direction:'', ignoreClickUntil:cardSwipe.ignoreClickUntil || 0 };
  }, { passive:true });

  section.addEventListener('touchmove', (e) => {
    if (!cardSwipe.tracking || !cardSwipe.row || e.touches.length !== 1) return;
    const t = e.touches[0], dx = t.clientX - cardSwipe.startX, dy = Math.abs(t.clientY - cardSwipe.startY);
    const row = cardSwipe.row, canChecklist = row.dataset.swipeKind === 'plan';
    cardSwipe.lastX = t.clientX;

    if (!cardSwipe.active) {
      if (Math.abs(dx) < 8 && dy < 8) return;
      const horizontal = Math.abs(dx) > dy * 1.2;
      const direction = dx > 10 && canChecklist ? 'checklist' : dx < -10 ? 'delete' : '';
      if (horizontal && direction) {
        cardSwipe.active = true;
        cardSwipe.direction = direction;
      } else if (dy >= Math.abs(dx) || (horizontal && Math.abs(dx) > 10 && !direction)) {
        resetState();
        return;
      }
    }
    if (!cardSwipe.active) return;
    e.preventDefault();

    const width = row.getBoundingClientRect().width || window.innerWidth - 32;
    const maxDistance = width * .94;
    let distance = dx;
    if (cardSwipe.direction === 'checklist') distance = Math.max(0, Math.min(maxDistance, dx));
    else distance = Math.min(0, Math.max(-maxDistance, dx));
    paint(row, distance, cardSwipe.direction);
  }, { passive:false });

  section.addEventListener('touchend', () => {
    if (!cardSwipe.tracking || !cardSwipe.row) { resetState(); return; }
    const row = cardSwipe.row;
    const dx = cardSwipe.lastX - cardSwipe.startX;
    const width = row.getBoundingClientRect().width || window.innerWidth - 32;
    const threshold = Math.max(180, width * .62);
    const direction = cardSwipe.direction;
    const fullSwipe = cardSwipe.active && ((direction === 'checklist' && dx >= threshold) || (direction === 'delete' && -dx >= threshold));

    if (!cardSwipe.active) { resetCardSwipeVisual(row, true); resetState(); return; }

    cardSwipe.ignoreClickUntil = Date.now() + 550;
    if (!fullSwipe) {
      resetCardSwipeVisual(row, true);
      resetState();
      return;
    }

    const kind = row.dataset.swipeKind, id = row.dataset.swipeId;
    finishAction(row, direction);
    resetState();
    setTimeout(() => {
      resetCardSwipeVisual(row, false);
      if (direction === 'checklist') {
        const plan = (remoteState?.plans || []).find((item)=>item.id===id);
        if (plan) openSimplifiedChecklist(plan);
      } else {
        openDeleteConfirm(kind, id);
      }
    }, 180);
  }, { passive:true });

  section.addEventListener('touchcancel', () => {
    resetCardSwipeVisual(cardSwipe.row, true);
    resetState();
  }, { passive:true });
}


function resetExpenseSwipeVisual(row, animate = true) {
  if (!row) return;
  const expense = row.querySelector('.tv2-row');
  const remove = row.querySelector('.tv2-expense-delete-reveal');
  if (remove) {
    remove.style.transition = animate ? 'width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease' : 'none';
    remove.style.width = '0px';
    remove.style.opacity = '0';
  }
  if (expense) {
    expense.style.transition = animate ? 'transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease' : 'none';
    expense.style.transform = 'translateX(0)';
    expense.style.opacity = '1';
  }
  if (animate) setTimeout(() => {
    [expense,remove].forEach((el)=>{ if (el?.isConnected) el.style.transition=''; });
  },220);
}
function closeExpenseSwipeRows(except = null) {
  document.querySelectorAll('#twCurrentTrips .tv2-expense-swipe-row').forEach((row) => {
    if (row !== except) resetExpenseSwipeVisual(row, true);
  });
}
function openExpenseDeleteConfirm(planId, expenseId) {
  closeDeleteConfirm();
  const plan = (remoteState?.plans || []).find((item)=>item.id===planId);
  const entry = tripEntries(plan).find((item)=>item.id===expenseId);
  const linkedTrip = plan?.linkedTripId ? (remoteState?.trips || []).find((trip)=>trip.id===plan.linkedTripId) : null;
  if (!plan || !entry || isLocked(linkedTrip)) return;
  const title = entryTitle(entry) || categoryInfo(entry)[0] || 'this expense';
  deleteConfirmLayer = document.createElement('div');
  deleteConfirmLayer.className = 'tv2-confirm-layer';
  deleteConfirmLayer.innerHTML =
    '<div class="tv2-confirm-backdrop" data-confirm-cancel></div>'+
    '<div class="tv2-confirm-card" role="dialog" aria-modal="true" aria-labelledby="tv2ExpenseDeleteTitle">'+
      '<h2 id="tv2ExpenseDeleteTitle">Delete expense?</h2>'+
      '<p>Are you sure you want to delete <strong>'+esc(title)+'</strong> · '+displayMoney(entry.amount,true)+'?</p>'+
      '<p class="tv2-confirm-note">This expense will be removed from the trip.</p>'+
      '<p class="tv2-confirm-error" aria-live="polite"></p>'+
      '<div class="tv2-confirm-actions"><button type="button" data-confirm-cancel>Cancel</button><button type="button" class="is-delete" data-confirm-delete>Delete</button></div>'+
    '</div>';
  document.body.appendChild(deleteConfirmLayer);
  const cancel = () => { closeDeleteConfirm(); closeExpenseSwipeRows(); };
  deleteConfirmLayer.querySelectorAll('[data-confirm-cancel]').forEach((button) => button.addEventListener('click', cancel));
  deleteConfirmLayer.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancel(); });
  const deleteButton = deleteConfirmLayer.querySelector('[data-confirm-delete]');
  deleteButton.addEventListener('click', async () => {
    deleteButton.disabled = true;
    deleteButton.textContent = 'Deleting…';
    const error = deleteConfirmLayer.querySelector('.tv2-confirm-error');
    error.textContent = '';
    try {
      await window.TwogetherAPI.post('deleteTripExpense',{planId,expenseId},actor());
      closeDeleteConfirm();
      closeExpenseSwipeRows();
      await refreshState(true);
      simplifiedSnack('Expense deleted');
    } catch (err) {
      deleteButton.disabled = false;
      deleteButton.textContent = 'Delete';
      error.textContent = err?.message || 'Could not delete this expense';
    }
  });
  setTimeout(() => deleteButton.focus(), 0);
}
function bindExpenseDeleteSwipe(section) {
  if (section.dataset.tv2ExpenseDeleteSwipe === '1') return;
  section.dataset.tv2ExpenseDeleteSwipe = '1';
  const mobile = () => window.matchMedia?.('(max-width:760px)')?.matches ?? window.innerWidth <= 760;
  const resetState = () => {
    expenseSwipe = { tracking:false, active:false, startX:0, startY:0, lastX:0, row:null, ignoreClickUntil:expenseSwipe.ignoreClickUntil || 0 };
  };
  section.addEventListener('touchstart', (e) => {
    if (!mobile() || simplifiedView.name !== 'trip' || deleteConfirmLayer || simplifiedLayer || e.touches.length !== 1) return;
    const plan = (remoteState?.plans || []).find((item)=>item.id===simplifiedView.planId);
    const linkedTrip = plan?.linkedTripId ? (remoteState?.trips || []).find((trip)=>trip.id===plan.linkedTripId) : null;
    if (!plan || isLocked(linkedTrip)) return;
    const row = e.target.closest('.tv2-expense-swipe-row'); if (!row) return;
    closeExpenseSwipeRows(row);
    resetExpenseSwipeVisual(row, false);
    const t = e.touches[0];
    expenseSwipe = { tracking:true, active:false, startX:t.clientX, startY:t.clientY, lastX:t.clientX, row, ignoreClickUntil:expenseSwipe.ignoreClickUntil || 0 };
  }, { passive:true });
  section.addEventListener('touchmove', (e) => {
    if (!expenseSwipe.tracking || !expenseSwipe.row || e.touches.length !== 1) return;
    const t = e.touches[0], dx = t.clientX - expenseSwipe.startX, dy = Math.abs(t.clientY - expenseSwipe.startY);
    expenseSwipe.lastX = t.clientX;
    if (!expenseSwipe.active) {
      if (Math.abs(dx) < 8 && dy < 8) return;
      if (dx < -10 && Math.abs(dx) > dy * 1.2) expenseSwipe.active = true;
      else if (dy >= Math.abs(dx) || dx > 0) { resetState(); return; }
    }
    if (!expenseSwipe.active) return;
    e.preventDefault();
    const row = expenseSwipe.row, expense = row.querySelector('.tv2-row'), remove = row.querySelector('.tv2-expense-delete-reveal');
    if (!expense || !remove) return;
    const width = row.getBoundingClientRect().width || window.innerWidth - 32;
    const distance = Math.min(0, Math.max(-width * .94, dx));
    const exposed = Math.abs(distance);
    expense.style.transition = 'none';
    expense.style.transform = 'translateX('+distance+'px)';
    remove.style.transition = 'none';
    remove.style.width = exposed+'px';
    remove.style.opacity = String(Math.min(1,.35+exposed/120));
  }, { passive:false });
  section.addEventListener('touchend', () => {
    if (!expenseSwipe.tracking || !expenseSwipe.row) { resetState(); return; }
    const row = expenseSwipe.row, dx = expenseSwipe.lastX - expenseSwipe.startX;
    const width = row.getBoundingClientRect().width || window.innerWidth - 32;
    const fullSwipe = expenseSwipe.active && -dx >= Math.max(180,width*.62);
    if (!expenseSwipe.active || !fullSwipe) {
      resetExpenseSwipeVisual(row,true);
      resetState();
      return;
    }
    expenseSwipe.ignoreClickUntil = Date.now()+550;
    const expenseId = row.dataset.expenseId, planId = simplifiedView.planId;
    const expense = row.querySelector('.tv2-row'), remove = row.querySelector('.tv2-expense-delete-reveal');
    if (expense) {
      expense.style.transition = 'transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      expense.style.transform = 'translateX(-'+width+'px)';
      expense.style.opacity = '.76';
    }
    if (remove) {
      remove.style.transition = 'width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      remove.style.width = width+'px';
      remove.style.opacity = '1';
    }
    resetState();
    setTimeout(() => {
      resetExpenseSwipeVisual(row,false);
      openExpenseDeleteConfirm(planId,expenseId);
    },180);
  }, { passive:true });
  section.addEventListener('touchcancel', () => {
    resetExpenseSwipeVisual(expenseSwipe.row,true);
    resetState();
  }, { passive:true });
}

function bindSimplifiedSwipe(section) {
  if (section.dataset.tv2Swipe === '1') return;
  section.dataset.tv2Swipe = '1';
  const mobile = () => window.matchMedia?.('(max-width:760px)')?.matches ?? window.innerWidth <= 760;
  const root = () => section.querySelector('#twCurrentTrips.tv2-trip-view');

  const resetState = () => {
    tripSwipe = { tracking:false, active:false, mode:'', startX:0, startY:0, lastX:0, lastY:0 };
  };
  const clearVisual = (animate = true) => {
    const current = root(); if (!current) { resetState(); return; }
    current.style.transition = animate ? 'transform .2s cubic-bezier(.22,.8,.28,1), opacity .18s ease' : 'none';
    current.style.transform = 'translate(-50%,-50%)';
    current.style.opacity = '1';
    if (animate) setTimeout(() => {
      if (!current.isConnected || simplifiedView.name !== 'trip') return;
      current.style.transition = '';
    }, 220);
  };
  const finishBack = (mode) => {
    const current = root(); if (!current) { resetState(); return; }
    current.style.transition = 'transform .22s cubic-bezier(.22,.8,.28,1), opacity .18s ease';
    current.style.transform = mode === 'right'
      ? 'translate(calc(-50% + 100vw),-50%)'
      : 'translate(-50%,calc(-50% + 100dvh))';
    current.style.opacity = '.7';
    resetState();
    setTimeout(() => {
      if (simplifiedView.name !== 'trip') return;
      closeCurrentTripToHome({dismiss:true});
    }, 185);
  };

  section.addEventListener('touchstart', (e) => {
    if (!mobile() || simplifiedView.name !== 'trip' || simplifiedLayer || deleteConfirmLayer || e.touches.length !== 1) return;
    const current = root(); if (!current) return;
    const t = e.touches[0];
    const canRight = t.clientX <= 46;
    const canDown = current.scrollTop <= 1;
    if (!canRight && !canDown) return;
    tripSwipe = {
      tracking:true, active:false, mode:'',
      startX:t.clientX, startY:t.clientY, lastX:t.clientX, lastY:t.clientY
    };
  }, { passive:true });

  section.addEventListener('touchmove', (e) => {
    if (!tripSwipe.tracking || e.touches.length !== 1) return;
    const current = root(); if (!current) { resetState(); return; }
    const t = e.touches[0];
    const dx = t.clientX - tripSwipe.startX;
    const dy = t.clientY - tripSwipe.startY;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    tripSwipe.lastX = t.clientX;
    tripSwipe.lastY = t.clientY;

    if (!tripSwipe.active) {
      if (ax < 9 && ay < 9) return;

      if (ax > ay * 1.25) {
        if (dx > 10 && tripSwipe.startX <= 46) {
          tripSwipe.active = true;
          tripSwipe.mode = 'right';
          expenseSwipe.tracking = false;
        } else {
          resetState();
          return;
        }
      } else if (ay > ax * 1.15) {
        if (dy > 10 && current.scrollTop <= 1) {
          tripSwipe.active = true;
          tripSwipe.mode = 'down';
          expenseSwipe.tracking = false;
        } else {
          resetState();
          return;
        }
      } else {
        return;
      }
    }

    if (!tripSwipe.active) return;
    e.preventDefault();
    current.style.transition = 'none';

    if (tripSwipe.mode === 'right') {
      const distance = Math.max(0, Math.min(dx, window.innerWidth * .78));
      current.style.transform = 'translate(calc(-50% + '+distance+'px),-50%)';
      current.style.opacity = String(Math.max(.82, 1 - distance / (window.innerWidth * 2.5)));
    } else {
      const distance = Math.max(0, Math.min(dy, window.innerHeight * .62));
      current.style.transform = 'translate(-50%,calc(-50% + '+distance+'px))';
      current.style.opacity = String(Math.max(.82, 1 - distance / (window.innerHeight * 2.2)));
    }
  }, { passive:false });

  section.addEventListener('touchend', () => {
    if (!tripSwipe.tracking) { resetState(); return; }
    const mode = tripSwipe.mode;
    const dx = tripSwipe.lastX - tripSwipe.startX;
    const dy = tripSwipe.lastY - tripSwipe.startY;
    const goBack = tripSwipe.active && (
      (mode === 'right' && dx >= Math.min(92, window.innerWidth * .24)) ||
      (mode === 'down' && dy >= Math.min(110, window.innerHeight * .16))
    );
    if (goBack) finishBack(mode);
    else { resetState(); clearVisual(true); }
  }, { passive:true });

  section.addEventListener('touchcancel', () => {
    const wasActive = tripSwipe.active;
    resetState();
    if (wasActive) clearVisual(true);
  }, { passive:true });
}

async function handleSimplifiedClick(e) {
  if (simplifiedView.name === 'trip') {
    const tripCard = e.currentTarget.querySelector('#twCurrentTrips.tv2-trip-view');
    if (tripCard && !tripCard.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      closeCurrentTripToHome({dismiss:true});
      return;
    }
  }

  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'open-trip' && Date.now() < cardSwipe.ignoreClickUntil) { e.preventDefault(); return; }
  if (b.dataset.act === 'new-trip') { document.dispatchEvent(new CustomEvent('twogether:budget-new-plan')); return; }
  if (b.dataset.act === 'home') { backFromCurrentTrip(); return; }
  if (b.dataset.act === 'open-trip') {
    if (b.dataset.kind === 'plan') { simplifiedView={name:'trip',planId:b.dataset.id,budgetMode:'combined'}; renderCurrentTrips(); }
    else window.TwogetherApp?.open(b.dataset.id);
    return;
  }
  const plan = (remoteState?.plans || []).find((p)=>p.id===simplifiedView.planId); if (!plan) return;
  if (b.dataset.act === 'add-my-budget' || b.dataset.act === 'edit-my-budget') {
    e.preventDefault();
    e.stopPropagation();
    simplifiedView.budgetEditor = true;
    renderCurrentTrips();
    return;
  }
  if (b.dataset.act === 'cancel-budget-editor') {
    simplifiedView.budgetEditor = false;
    renderCurrentTrips();
    return;
  }
  if (b.dataset.act === 'save-my-budget') {
    e.preventDefault();
    e.stopPropagation();
    const currentSection = b.closest('#twCurrentTripsSection') || document;
    const input = currentSection.querySelector('[data-personal-budget-input]');
    const error = currentSection.querySelector('[data-budget-error]');
    const value = Number(String(input?.value || '').replace(',','.'));
    if (!Number.isFinite(value) || value <= 0) {
      if (error) error.textContent = 'Enter a valid budget amount.';
      input?.focus();
      return;
    }
    const editing = has(plan?.budgets?.[actor()]);
    b.disabled = true;
    b.textContent = 'Saving…';
    if (error) error.textContent = '';
    try {
      await window.TwogetherAPI.post('savePlan',{id:plan.id,budget:value},actor());
      simplifiedView.budgetEditor = false;
      await refreshState(true);
      simplifiedSnack(editing ? 'Your trip budget was updated' : 'Your trip budget was added');
    } catch (err) {
      b.disabled = false;
      b.textContent = editing ? 'Update my budget' : 'Save my budget';
      if (error) error.textContent = err?.message || 'Could not save your budget.';
    }
    return;
  }
  if (b.dataset.act === 'toggle-budget-view') {
    simplifiedView.budgetMode = simplifiedView.budgetMode === 'personal' ? 'combined' : 'personal';
    renderCurrentTrips();
    return;
  }
  if (b.dataset.act === 'budgets') { window.TwogetherWorkflow?.budget(plan.id); return; }
  if (b.dataset.act === 'confirm-trip') {
    if (tripPhase(plan.meta) !== 'past' || b.disabled) return;
    const mismatches = paymentMismatchDetails(plan);
    if (mismatches.length) {
      toast('Fix payment assignment first: '+mismatches.map((item)=>item.title+' '+displayMoney(item.amount,true)).join(', ')+'.','warn');
      return;
    }
    const outstanding = settlementState(plan);
    if (outstanding.amount > .005) {
      toast('Pay back all owed money before confirming this trip.','warn');
      return;
    }
    const other = actor() === 'Principessa' ? 'Principe' : 'Principessa';
    b.disabled = true;
    b.textContent = 'Confirming…';
    try {
      const result = await window.TwogetherAPI.post('confirmPlanTrip',{planId:plan.id},actor());
      if (result?.locked) {
        dismissCardView(currentTripCardKey());
        simplifiedView={name:'home',planId:'',budgetMode:'combined'};
      }
      await refreshState(true);
      simplifiedSnack(result?.locked ? 'Trip confirmed · moved to Trip stories' : 'Your confirmation was saved · waiting for '+other);
    } catch (err) {
      b.disabled = false;
      b.textContent = 'Confirm trip';
      toast(err?.message || 'Could not confirm this trip','warn');
    }
    return;
  }
  if (b.dataset.act === 'add-expense') { openSimplifiedExpenseSheet(plan); return; }
  if (b.dataset.act === 'open-expense') {
    if (Date.now() < expenseSwipe.ignoreClickUntil) { e.preventDefault(); return; }
    const entry = tripEntries(plan).find((x)=>x.id===b.dataset.id); if (entry) openSimplifiedExpenseSheet(plan,entry);
    return;
  }
  if (b.dataset.act === 'balance') return;
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
    const image = tripImage(city, country, card.dataset.openTrip || `${city}|${country}`);
    card.style.setProperty('--v28-story-bg', `url("${image}")`);
    card.dataset.v28Background = '1';
  });
}

export async function refreshState(force = false) {
  if (refreshing || !window.TwogetherAPI) return; refreshing = true;
  try {
    remoteState = await window.TwogetherAPI.state();
    if(actor() && remoteState && !remoteState.tripPrepDefaults?.personalRecurrentV1){
      const converted=await window.TwogetherAPI.post('personalizeTripChecklists',{},actor());
      if(!converted?.ok)throw new Error(converted?.error||'Could not update personal checklists');
      remoteState=await window.TwogetherAPI.state();
    }
    await refreshReturnPackingResets();
    const imageUrls = allSimplifiedItems().map((item) => {
      const name = item.meta?.city || locationLabel(item.meta);
      return tripImage(name, locationLabel(item.meta), item.id);
    });
    await preloadTripImages(imageUrls);
    renderCurrentTrips();
    filterTripStories();
    enhanceTripModal();
    publishTripNotifications();
  }
  catch (err) { if (force) toast(err.message || 'Could not refresh shared trips', 'warn'); }
  finally {
    refreshing = false;
    markStartupReady();
  }
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
  const differences = $$('.difference-row', root);
  const total = parseMoney(root.querySelector('.trip-modal-total strong')?.textContent || '');
  const paid = $$('.submission-card', root).map((card) => {
    const match = (card.querySelector(':scope > small')?.textContent || '').match(/Paid:\s*([^·]+)/i);
    return match ? parseMoney(match[1]) : null;
  }).filter((value) => value != null);
  const paidTotal = paid.length >= 2 ? paid.reduce((a, b) => a + b, 0) : null;

  const tripId = String(root.dataset.tripId || '');
  const plan = (remoteState?.plans || []).find((item) => String(item?.linkedTripId || '') === tripId) || null;
  const exactMismatches = plan ? paymentMismatchDetails(plan) : [];
  const jarTotal = plan ? planJarTotal(plan) : 0;
  // Current confirmed snapshots store spending net of Shared Jar contributions,
  // so their payer totals are already directly comparable with Total spent.
  // Older gross snapshots still need the Jar added once for reconciliation.
  const paidOnlyDelta = total != null && paidTotal != null ? total - paidTotal : null;
  const legacyGrossSnapshot = paidOnlyDelta != null && jarTotal > .005 && Math.abs(paidOnlyDelta - jarTotal) <= .01;
  const assignedTotal = paidTotal == null ? null : paidTotal + (legacyGrossSnapshot ? jarTotal : 0);
  const delta = total != null && assignedTotal != null ? total - assignedTotal : null;
  const hasMismatch = exactMismatches.length > 0 || (delta != null && Math.abs(delta) > .01);
  const mismatchSig = exactMismatches.map((item) => item.id+':'+item.amount).join('|');
  const sig = differences.length+'|'+total+'|'+paidTotal+'|'+jarTotal+'|'+legacyGrossSnapshot+'|'+delta+'|'+mismatchSig;
  if (root.dataset.v18WarningSig === sig) return;
  root.dataset.v18WarningSig = sig;
  root.querySelectorAll('.tw-trip-warning').forEach((item) => item.remove());

  const anchor = root.querySelector('.difference-list') || root.querySelector('.submission-grid') || root.firstElementChild;
  if (differences.length) {
    const box = document.createElement('div');
    box.className = 'tw-trip-warning soft';
    box.innerHTML = '<strong>'+differences.length+' detail'+(differences.length === 1 ? '' : 's')+' still differ</strong>The trip stays unmatched until every highlighted detail matches.';
    anchor?.parentNode?.insertBefore(box, anchor);
  }

  if (hasMismatch) {
    const box = document.createElement('div');
    box.className = 'tw-trip-warning';
    const details = exactMismatches.length
      ? '<div class="tw-trip-warning-list">'+exactMismatches.map((item)=>'<span><b>'+esc(item.title)+'</b><i>'+esc(item.reason)+' · '+money(item.amount)+' unassigned</i></span>').join('')+'</div>'
      : '<div class="tw-trip-warning-list"><span><b>Unassigned payment</b><i>'+money(Math.abs(delta))+' is not assigned to a payer. This older trip does not contain expense-level payer data.</i></span></div>';
    box.innerHTML = '<strong>Payment totals do not match the trip expenses</strong>'+
      (total != null && assignedTotal != null ? money(total)+' of expenses are recorded, while '+money(assignedTotal)+' is accounted for between both of you'+(jarTotal > .005 ? ' and the Shared Jar' : '')+'.' : '')+
      details;
    const target = root.querySelector('.trip-budget-comparison') || root.querySelector('.budget-check') || anchor;
    target?.parentNode?.insertBefore(box, target?.nextSibling || null);
  }

  const confirm = root.querySelector('[data-confirm-own]');
  if (confirm && hasMismatch) {
    confirm.disabled = true;
    confirm.textContent = 'Fix payment mismatch first';
  }
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
    const image = tripImage(city, country, card.dataset.openTrip || card.dataset.tripId || card.dataset.id || `${city}|${country}`);
    const bg = `linear-gradient(180deg,rgba(255,255,255,.02),rgba(25,18,10,.20)),url("${image}")`;
    art.style.backgroundImage = bg; card.style.setProperty('--v27-trip-bg', bg); card.dataset.v27Background = '1';
    art.removeAttribute('title');
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
  schedulePackingBoundaryRefresh();
  enhanceCardMedia(); decorateTripStories();
  document.addEventListener('twogether:v18-rendered', () => requestAnimationFrame(() => { enhanceCardMedia(); decorateTripStories(); }));
  setTimeout(() => refreshState(true), 180);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshState(false); });
  document.addEventListener('twogether:saved', () => setTimeout(() => refreshState(false), 120));
  document.addEventListener('twogether:notification-action', (event) => {
    if (event.detail?.choice !== 'open') return;
    const kind=String(event.detail?.kind||'');
    if(kind!=='trip-prep'&&kind!=='trip-reminder')return;
    const rawId=String(event.detail?.id||'');
    const id=kind==='trip-reminder'
      ? rawId.replace(/^trip-reminder:/,'').split(':')[0]
      : rawId.replace(/^trip-prep:/,'');
    const plan = (remoteState?.plans || []).find((item) => item.id === id);
    if (plan) openSimplifiedChecklist(plan);
    else refreshState(false);
  });
  window.addEventListener('focus', () => refreshState(false), { passive: true });
  window.TwogetherV18 = { refresh: refreshState, get state() { return remoteState; } };
}
