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

const MONEY_KEYS = ['travel', 'accom', 'fuel', 'groceries', 'eat', 'tolls', 'other'];
const PARTIAL_ORDER = ['travel', 'accom', 'fuel', 'groceries', 'eat', 'tolls', 'other'];
const LABELS = { travel: 'Flights / Train', accom: 'Accommodation', fuel: 'Fuel', groceries: 'Groceries', eat: 'Eating out', tolls: 'Tolls / Parking', other: 'Other' };

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
let tripFocusScrollY = 0;

function has(v) { return v !== '' && v != null; }
function isLocked(t) { return !!(t?.confirmed?.Principessa && t?.confirmed?.Principe); }
function tripMeta(t) { return t?.submissions?.[t?.createdBy] || t?.submissions?.Principessa || t?.submissions?.Principe || {}; }
function locationLabel(m) { return m?.location === 'Other' ? (m.otherLocation || 'Other') : (m?.location || '—'); }
function localDate(value) { if (!value) return null; const d = new Date(value + 'T12:00:00'); return Number.isNaN(d.getTime()) ? null : d; }
function localToday() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); }
function dayDiff(a, b) { return Math.round((b - a) / 86400000); }
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
  const amount = n(value); const whole = Math.abs(amount - Math.round(amount)) < .005;
  return '€' + amount.toLocaleString('nl-NL',{minimumFractionDigits:whole?0:2,maximumFractionDigits:2});
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
  const a = trip?.submissions?.Principessa || plan?.partials?.Principessa || {};
  const b = trip?.submissions?.Principe || plan?.partials?.Principe || {};
  const legacy = MONEY_KEYS.reduce((sum, key) => {
    const shared = plan?.sharedExpenses?.[key] || trip?.sharedExpenses?.[key];
    if (has(shared?.total)) return sum + n(shared.total);
    const av = has(a?.[key]) ? n(a[key]) : null, bv = has(b?.[key]) ? n(b[key]) : null;
    if (av != null && bv != null) return sum + Math.max(av, bv);
    return sum + (av ?? bv ?? 0);
  }, 0);
  return legacy + tripEntries(plan).reduce((sum, entry) => sum + n(entry?.amount), 0);
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
    if (entry?.transportType === 'fuel') return ['Car', '⛽'];
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
      const meta = repayment.from === me ? 'Owed money · you → '+repayment.to : 'Owed money · '+repayment.from+' → you';
      return '<div class="tv2-row is-settlement"><span class="tv2-ic" aria-hidden="true">💸</span><span class="tv2-row-main"><strong>'+esc(title)+'</strong><small>'+esc(meta)+'</small></span><span class="tv2-amt">'+displayMoney(repayment.amount,true)+'</span></div>';
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
function displayMoney(value, forceCents = false) {
  const amount = n(value), whole = Math.abs(amount - Math.round(amount)) < .005 && !forceCents;
  return '€' + amount.toLocaleString('nl-NL',{minimumFractionDigits:whole?0:2,maximumFractionDigits:2});
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
  const name = item.meta?.city || locationLabel(item.meta);
  const flag = cardCountryEmoji(item.meta);
  return '<div class="tv2-swipe-row" data-swipe-kind="'+item.kind+'" data-swipe-id="'+esc(item.id)+'">'+
    (item.kind === 'plan' ? '<span class="tv2-checklist-reveal" aria-hidden="true"><b>Checklist</b></span>' : '')+
    '<span class="tv2-delete-reveal" aria-hidden="true"><b>Delete</b></span>'+
    '<button class="tv2-card '+(item.phase==='past'?'is-past':'')+'" data-act="open-trip" data-kind="'+item.kind+'" data-id="'+esc(item.id)+'">'+
      '<span class="tv2-card-top"><strong><span class="tv2-card-flag" aria-hidden="true">'+flag+'</span> '+esc(name)+'</strong><small>'+esc(shortRange(item.meta?.start,item.meta?.end))+'</small></span>'+
      '<span class="tv2-card-sub">'+esc(statusLine(item.meta))+'</span>'+
      '<span class="tv2-card-money"><span>'+displayMoney(item.spent)+' spent</span>'+(item.left != null?'<span>'+displayMoney(item.left)+' left</span>':'')+'</span>'+
      (item.available && item.available > 0?'<span class="tv2-bar"><i style="width:'+pct.toFixed(1)+'%"></i></span>':'')+
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
  const mineConfirmed = !!trip?.confirmed?.[me], otherConfirmed = !!trip?.confirmed?.[other];
  const confirmHtml = !past ? '' : mineConfirmed
    ? '<section class="tv2-trip-confirm is-waiting"><div><strong>✓ You confirmed this trip</strong><span>'+(otherConfirmed?'Finalising trip…':'Waiting for '+esc(other)+'. It stays under Past until both of you confirm.')+'</span></div></section>'
    : '<section class="tv2-trip-confirm"><div><strong>Trip finished</strong><span>'+(otherConfirmed?esc(other)+' already confirmed. Confirm yours to move it to Trip stories.':'Confirm when the logged expenses look final. It moves to Trip stories after both of you confirm.')+'</span></div><button type="button" data-act="confirm-trip">Confirm trip</button></section>';
  const combinedAvailable = tripBudget(plan, trip), combinedSpent = expenseTotal(plan, trip);
  const ownBudget = has(plan?.budgets?.[me]) ? n(plan.budgets[me]) : null;
  const ownSpent = n(settlementState(plan).paid?.[me]);
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
    if (!plan) simplifiedView = { name:'home', planId:'', budgetMode:'combined' };
    else {
      const trip = (remoteState.trips || []).find((t)=>t.id===plan.linkedTripId);
      root.classList.add('tv2-trip-view');
      section.classList.add('tv2-focus-open');
      setTripFocusLock(true);
      root.innerHTML = simplifiedView.budgetEditor ? simplifiedPersonalBudgetEditor(plan) : simplifiedTrip(plan, trip);
      return;
    }
  }
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
  if (entry.category === 'transport') return entry.transportType === 'fuel' ? 'car' : 'transport';
  if (entry.category === 'food') return entry.foodType === 'groceries' ? 'groceries' : 'eating-out';
  return entry.category || 'other';
}
function mapUiCategory(key) {
  if (key === 'stay') return {category:'accommodation',foodType:'',transportType:'',useJar:true};
  if (key === 'transport') return {category:'transport',foodType:'',transportType:'other',useJar:false};
  if (key === 'car') return {category:'transport',foodType:'',transportType:'fuel',useJar:false};
  if (key === 'groceries') return {category:'food',foodType:'groceries',transportType:'',useJar:false};
  if (key === 'eating-out') return {category:'food',foodType:'eating-out',transportType:'',useJar:false};
  if (key === 'activities') return {category:'activities',foodType:'',transportType:'',useJar:false};
  return {category:'other',foodType:'',transportType:'',useJar:false};
}
function closeSimplifiedSheet() {
  simplifiedLayer?.remove(); simplifiedLayer = null; document.body.classList.remove('tv2-locked');
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
  const state = {
    amountText: existing ? String(existing.amount ?? '') : '',
    category: uiCategoryFromEntry(existing),
    paidBy: existing?.paidBy || me,
    split: existing?.split || 'shared',
    forActor: existing?.forActor || me,
    date: existing?.date || new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10),
    note: existing?.note || '',
    uncertain: !!existing?.uncertain,
    useJar: existing ? !!existing.useJar : true,
    more: !!existing,
    busy:false,error:'',mounted:false,
  };
  const amount = () => Number(String(state.amountText||'').replace(',','.'));
  const validAmount = () => Number.isFinite(amount()) && amount() > 0;
  const jarAmount = () => state.category === 'stay' && state.useJar && validAmount() ? amount() * .2 : 0;
  const canSave = () => {
    if (state.category === 'owed') return owedAmount() > .005 && validAmount() && amount() <= owedAmount() + .005;
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
    const amountField = state.category === 'owed' ? '' :
      '<label class="tv2-amount"><span aria-hidden="true">€</span><input id="tv2Amount" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0" value="'+esc(state.amountText)+'" aria-label="Amount in euros"></label>';
    let owedPanel = '';
    if (state.category === 'owed') {
      if (mine > .005) {
        owedPanel = '<div class="tv2-owed-panel">'+
          '<div class="tv2-owed-head"><span>You owe '+esc(settlement.creditor)+'</span><strong>'+displayMoney(mine,true)+'</strong></div>'+
          '<p>This is a repayment between you two, so it changes who has actually paid without adding another trip expense.</p>'+
          '<label class="tv2-owed-field"><span>Amount you paid back</span><div><b>€</b><input id="tv2Amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="'+esc(state.amountText)+'"></div></label>'+
          '<button type="button" class="tv2-btn tv2-pay-full" data-pay-full>Pay full '+displayMoney(mine,true)+'</button>'+
        '</div>';
      } else if (settlement.creditor === me && settlement.debtor) {
        owedPanel = '<div class="tv2-owed-panel is-empty"><div class="tv2-owed-head"><span>'+esc(settlement.debtor)+' owes you</span><strong>'+displayMoney(settlement.amount,true)+'</strong></div><p>They can log their repayment from their own profile.</p></div>';
      } else {
        owedPanel = '<div class="tv2-owed-panel is-empty"><div class="tv2-owed-head"><span>Nothing owed</span><strong>€0.00</strong></div><p>You’re even on this trip right now.</p></div>';
      }
    }
    const normalOptions = state.category === 'owed' ? '' :
      '<div class="tv2-jar-slot"></div>'+
      '<button type="button" class="tv2-defaults" data-more aria-expanded="'+(state.more?'true':'false')+'"><span class="tv2-summary">'+esc(summary())+'</span><span class="tv2-chev" aria-hidden="true">'+(state.more?'⌃':'⌄')+'</span></button>'+
      '<div class="tv2-more" '+(state.more?'':'hidden')+'>'+
        '<div class="tv2-field"><span>Paid by</span><div class="tv2-seg">'+
          [[me,'You'],[other,other],['both','Each paid half']].map(([k,l])=>'<button type="button" data-payer="'+k+'" class="'+(state.paidBy===k?'on':'')+'">'+esc(l)+'</button>').join('')+
          '<button type="button" data-jar-payer>Shared Jar</button>'+
        '</div></div>'+
        '<div class="tv2-field" '+(state.paidBy==='both'?'hidden':'')+'><span>For</span><div class="tv2-seg">'+
          [['shared','Shared 50/50'],[me,'Just you'],[other,'Just '+other]].map(([k,l])=>'<button type="button" data-split="'+k+'" class="'+((k==='shared'&&state.split==='shared')||(k!=='shared'&&state.split==='personal'&&state.forActor===k)?'on':'')+'">'+esc(l)+'</button>').join('')+
        '</div></div>'+
        '<label class="tv2-field tv2-date-field"><span>Date</span><span class="tv2-date-box"><input type="date" id="tv2Date" value="'+esc(state.date)+'"></span></label>'+
        '<label class="tv2-field"><span>Note</span><input id="tv2Note" maxlength="180" placeholder="e.g. dinner by the canal" value="'+esc(state.note)+'"></label>'+
        '<label class="tv2-check"><input type="checkbox" id="tv2Est" '+(state.uncertain?'checked':'')+'> This amount is an estimate</label>'+
      '</div>';
    return '<div class="tv2-sheet-head"><h2>'+(existing?'Edit expense':'Add expense')+'</h2><button class="tv2-x" data-close aria-label="Close">✕</button></div>'+
      amountField+
      '<div class="tv2-cats" role="group" aria-label="Category">'+categories.map(([k,l,i])=>'<button type="button" class="tv2-cat '+(state.category===k?'on':'')+'" data-cat="'+k+'" aria-pressed="'+(state.category===k?'true':'false')+'"><span aria-hidden="true">'+i+'</span>'+esc(l)+'</button>').join('')+'</div>'+
      owedPanel+normalOptions+
      '<p class="tv2-hint" aria-live="polite"></p>'+
      '<button type="button" class="tv2-primary tv2-save" data-save>'+(state.category==='owed'?'Log repayment':existing?'Save changes':'Save')+'</button>'+
      (existing?'<button type="button" class="tv2-danger-link" data-delete>Delete expense</button>':'');
  };
  simplifiedLayer = document.createElement('div'); simplifiedLayer.className = 'tv2-layer';
  simplifiedLayer.innerHTML = '<div class="tv2-backdrop" data-close></div><div class="tv2-sheet" role="dialog" aria-modal="true"></div>';
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
    const summaryEl = sheet.querySelector('.tv2-summary');
    if (summaryEl) summaryEl.textContent = summary();
    const hint = sheet.querySelector('.tv2-hint'), save = sheet.querySelector('[data-save]');
    save.disabled = !canSave() || state.busy;
    save.textContent = state.busy ? 'Saving…' : state.category === 'owed' ? 'Log repayment' : existing ? 'Save changes' : 'Save';

    if (state.category === 'owed') {
      const mine = owedAmount();
      hint.textContent = state.error || (mine <= .005 ? '' : state.amountText && !validAmount() ? 'That amount doesn’t look right' : !validAmount() ? 'Enter how much you paid back' : amount() > mine + .005 ? 'You only owe '+displayMoney(mine,true) : '');
      hint.classList.toggle('is-error',!!state.error || (!!state.amountText&&!validAmount()) || (validAmount()&&amount()>mine+.005));
    } else {
      hint.textContent = state.error || (state.amountText && !validAmount() ? 'That amount doesn’t look right' : !validAmount() ? 'Enter the amount' : !state.category ? 'Pick a category' : state.category==='stay'&&state.useJar&&jarAmount()>availableJar()+.005 ? 'Not enough in the Shared Jar.' : '');
      hint.classList.toggle('is-error',!!state.error || (!!state.amountText&&!validAmount()) || (state.category==='stay'&&state.useJar&&jarAmount()>availableJar()+.005));
    }
  }
  function mount() {
    sheet.innerHTML = html();
    const input = sheet.querySelector('#tv2Amount');
    input?.addEventListener('input',()=>{state.amountText=input.value;state.error='';refreshLive();});
    input?.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();if(canSave())save();}});
    sheet.querySelector('#tv2Date')?.addEventListener('change',(e)=>{state.date=e.target.value||state.date;refreshLive();});
    sheet.querySelector('#tv2Note')?.addEventListener('input',(e)=>{state.note=e.target.value;});
    sheet.querySelector('#tv2Est')?.addEventListener('change',(e)=>{state.uncertain=e.target.checked;refreshLive();});
    sheet.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-close')) { closeSimplifiedSheet(); return; }
      if (b.dataset.cat) {
        const wasOwed = state.category === 'owed';
        state.category=b.dataset.cat;
        if ((state.category === 'owed') !== wasOwed) state.amountText='';
        if(state.category!=='stay')state.useJar=false;
        if(state.category==='owed')state.more=false;
        mount();
        return;
      }
      if (b.hasAttribute('data-pay-full')) { state.amountText=owedAmount().toFixed(2); mount(); return; }
      if (b.dataset.jar) { state.useJar=b.dataset.jar==='on'; refreshLive(); return; }
      if (b.hasAttribute('data-more')) { state.more=!state.more; mount(); return; }
      if (b.dataset.payer) { state.paidBy=b.dataset.payer; if(state.paidBy==='both')state.split='shared'; mount(); return; }
      if (b.hasAttribute('data-jar-payer')) { if(state.category!=='stay'){state.error='Shared Jar can only be used for Stay.';refreshLive();return;} state.useJar=true;state.error='Shared Jar contributes 20% to Stay; choose who paid the remaining amount.';refreshLive();return; }
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
        await window.TwogetherAPI.post('saveTripRepayment',{planId:plan.id,amount:paidBack,date:state.date},actor());
        closeSimplifiedSheet(); await refreshState(true);
        simplifiedSnack(displayMoney(paidBack,true)+' paid back to '+target);
      } catch (err) { state.busy=false; state.error=err?.message||'Could not save repayment. Check your connection and try again.'; refreshLive(); }
      return;
    }
    const mapped=mapUiCategory(state.category);
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
  simplifiedLayer.querySelector('.tv2-backdrop').onclick=closeSimplifiedSheet;
  simplifiedLayer.addEventListener('keydown',(e)=>{if(e.key==='Escape')closeSimplifiedSheet();});
  mount();
}

const CHECKLIST_DEFAULTS = {
  packing: ['Toothbrushes', 'Slippers', 'Hair brush', 'Shampoo', 'Conditioner', 'Shower gel', 'Dishwasher detergent'],
  reminders: ["Don't forget to put fuel", "Don't forget to ask mom to make work sandwich", "Don't forget to take pictures of the Airbnb when you arrive"],
};
function checklistSeed(list) {
  return list.map((text) => ({ id: uid(), text, done:false }));
}
function openSimplifiedChecklist(plan) {
  if (!plan) return;
  closeSimplifiedSheet();
  const stored = plan.prep || {};
  const prep = {
    packing: stored.packing?.length ? JSON.parse(JSON.stringify(stored.packing)) : checklistSeed(CHECKLIST_DEFAULTS.packing),
    reminders: stored.reminders?.length ? JSON.parse(JSON.stringify(stored.reminders)) : checklistSeed(CHECKLIST_DEFAULTS.reminders),
  };
  const state = { busy:false, error:'' };
  simplifiedLayer = document.createElement('div');
  simplifiedLayer.className = 'tv2-layer';
  simplifiedLayer.innerHTML = '<div class="tv2-backdrop" data-close></div><div class="tv2-sheet tv2-checklist-sheet" role="dialog" aria-modal="true" aria-label="Trip checklist"></div>';
  document.body.appendChild(simplifiedLayer);
  document.body.classList.add('tv2-locked');
  const sheet = simplifiedLayer.querySelector('.tv2-checklist-sheet');

  bindChecklistSwipeDown(simplifiedLayer, sheet);

  const rowHtml = (kind, item, completed = false) =>
    '<div class="tv2-check-row '+(completed?'is-completed':'')+'" data-check-kind="'+kind+'" data-check-id="'+esc(item.id)+'">'+
      '<label class="tv2-check-toggle"><input type="checkbox" data-check-toggle '+(item.done?'checked':'')+' aria-label="'+(item.done?'Move back to checklist':'Mark completed')+'"><span></span></label>'+
      '<div class="tv2-check-text-scroll" data-check-scroll>'+
        '<input class="tv2-check-text" data-check-text maxlength="160" value="'+esc(item.text)+'" aria-label="Checklist item">'+
      '</div>'+
      '<button type="button" class="tv2-check-remove" data-check-remove aria-label="Remove item">×</button>'+
      (completed?'<small>'+(kind==='packing'?'Packing':'Reminder')+'</small>':'')+
    '</div>';

  const activeSection = (kind, title) => {
    const active = prep[kind].filter((item)=>!item.done);
    return '<section class="tv2-check-section"><div class="tv2-check-section-head"><h3>'+esc(title)+'</h3><span>'+active.length+'</span></div>'+
      '<div class="tv2-check-list">'+(active.length?active.map((item)=>rowHtml(kind,item)).join(''):'<p class="tv2-check-empty">All clear here ♡</p>')+'</div>'+
      '<div class="tv2-check-add"><input data-check-new="'+kind+'" maxlength="160" placeholder="Add another item"><button type="button" data-check-add="'+kind+'">Add</button></div>'+
    '</section>';
  };

  const completedSection = () => {
    const done = [
      ...prep.packing.filter((item)=>item.done).map((item)=>({kind:'packing',item})),
      ...prep.reminders.filter((item)=>item.done).map((item)=>({kind:'reminders',item})),
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
    sheet.innerHTML =
      '<div class="tv2-sheet-head"><div><small class="tv2-check-city">'+esc(plan.meta?.city || locationLabel(plan.meta))+'</small><h2>Checklist</h2></div><button class="tv2-x" data-close aria-label="Close">✕</button></div>'+
      '<p class="tv2-check-intro">Keep the little things together before the trip.</p>'+
      activeSection('packing','Packing / things to take')+
      activeSection('reminders','Important reminders')+
      completedSection()+
      '<p class="tv2-hint '+(state.error?'is-error':'')+'" aria-live="polite">'+esc(state.error)+'</p>'+
      '<button type="button" class="tv2-primary tv2-check-save" data-check-save '+(state.busy?'disabled':'')+'>'+(state.busy?'Saving…':'Save checklist')+'</button>';
    requestAnimationFrame(() => {
      syncAllChecklistTextWidths();
      if (moveId) {
        const row = sheet.querySelector('[data-check-id="'+CSS.escape(moveId)+'"]');
        row?.classList.add('just-arrived');
      }
    });
  }

  function findItem(row) {
    const kind = row?.dataset.checkKind, id = row?.dataset.checkId;
    return kind && Array.isArray(prep[kind]) ? prep[kind].find((item)=>item.id===id) : null;
  }
  function addItem(kind) {
    const input = sheet.querySelector('[data-check-new="'+kind+'"]');
    const text = input?.value?.trim(); if (!text || !Array.isArray(prep[kind])) return;
    prep[kind].push({ id:uid(), text, done:false });
    render();
    requestAnimationFrame(() => sheet.querySelector('[data-check-new="'+kind+'"]')?.focus());
  }
  async function saveChecklist() {
    if (state.busy) return;
    state.busy=true; state.error=''; render();
    prep.packing = prep.packing.filter((item)=>String(item.text||'').trim());
    prep.reminders = prep.reminders.filter((item)=>String(item.text||'').trim());
    try {
      await window.TwogetherAPI.post('saveTripPrep',{planId:plan.id,prep},actor());
      closeSimplifiedSheet();
      await refreshState(true);
      simplifiedSnack('Checklist saved');
    } catch (err) {
      state.busy=false; state.error=err?.message||'Could not save checklist'; render();
    }
  }

  sheet.addEventListener('change',(e)=>{
    const row=e.target.closest('.tv2-check-row'); if(!row)return;
    const item=findItem(row); if(!item)return;
    if(e.target.matches('[data-check-toggle]')){
      item.done=e.target.checked;
      row.classList.add('is-moving');
      setTimeout(()=>render(item.id),180);
    } else if(e.target.matches('[data-check-text]')) item.text=e.target.value.trim();
  });
  sheet.addEventListener('input',(e)=>{
    if(!e.target.matches('[data-check-text]'))return;
    const row=e.target.closest('.tv2-check-row'),item=findItem(row);
    if(item)item.text=e.target.value;
    syncChecklistTextWidth(e.target);
  });
  sheet.addEventListener('keydown',(e)=>{
    const input=e.target.closest('[data-check-new]'); if(!input||e.key!=='Enter')return;
    e.preventDefault(); addItem(input.dataset.checkNew);
  });
  sheet.addEventListener('click',(e)=>{
    const b=e.target.closest('button'); if(!b)return;
    if(b.hasAttribute('data-close')){closeSimplifiedSheet();return;}
    if(b.dataset.checkAdd){addItem(b.dataset.checkAdd);return;}
    if(b.hasAttribute('data-check-remove')){
      const row=b.closest('.tv2-check-row'),kind=row?.dataset.checkKind,id=row?.dataset.checkId;
      if(kind&&Array.isArray(prep[kind]))prep[kind]=prep[kind].filter((item)=>item.id!==id);
      render(); return;
    }
    if(b.hasAttribute('data-check-save'))saveChecklist();
  });
  simplifiedLayer.querySelector('.tv2-backdrop').onclick=closeSimplifiedSheet;
  simplifiedLayer.addEventListener('keydown',(e)=>{if(e.key==='Escape')closeSimplifiedSheet();});
  render();
}

function bindChecklistSwipeDown(layer, sheet) {
  if (!layer || !sheet || layer.dataset.tv2SwipeDown === '1') return;
  layer.dataset.tv2SwipeDown = '1';
  const mobile = () => window.matchMedia?.('(max-width:760px)')?.matches ?? window.innerWidth <= 760;
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

  sheet.addEventListener('touchstart', (e) => {
    if (!mobile() || e.touches.length !== 1 || sheet.scrollTop > 1) return;
    const t = e.touches[0];
    gesture = { tracking:true, active:false, startX:t.clientX, startY:t.clientY, lastY:t.clientY };
  }, { passive:true });

  sheet.addEventListener('touchmove', (e) => {
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

  sheet.addEventListener('touchcancel', () => clear(true), { passive:true });
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
      simplifiedView = { name:'home', planId:'', budgetMode:'combined' };
      renderCurrentTrips();
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
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'open-trip' && Date.now() < cardSwipe.ignoreClickUntil) { e.preventDefault(); return; }
  if (b.dataset.act === 'new-trip') { document.dispatchEvent(new CustomEvent('twogether:budget-new-plan')); return; }
  if (b.dataset.act === 'home') { simplifiedView={name:'home',planId:'',budgetMode:'combined'}; renderCurrentTrips(); return; }
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
    const other = actor() === 'Principessa' ? 'Principe' : 'Principessa';
    b.disabled = true;
    b.textContent = 'Confirming…';
    try {
      const result = await window.TwogetherAPI.post('confirmPlanTrip',{planId:plan.id},actor());
      if (result?.locked) simplifiedView={name:'home',planId:'',budgetMode:'combined'};
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
