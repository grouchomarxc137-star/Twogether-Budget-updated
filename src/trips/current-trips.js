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
let simplifiedView = { name: 'home', planId: '' };
let simplifiedLayer = null;
let simplifiedSnackTimer = null;
let swipeBack = { tracking:false, active:false, startX:0, startY:0, lastX:0 };

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
    bindSimplifiedSwipe(section);
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
function expenseTimeline(plan) {
  const list = tripEntries(plan).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  if (!list.length) return '<div class="tv2-empty-list">No expenses yet. Add them as they happen, it takes a few seconds.</div>';
  const groups = new Map();
  list.forEach((entry) => { const key = entry.date || ''; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(entry); });
  return [...groups.entries()].map(([date, items]) => '<div class="tv2-day"><h2>'+esc(dayLabel(date))+'</h2>'+items.map((entry) => {
    const [, icon] = categoryInfo(entry);
    return '<button class="tv2-row" data-act="open-expense" data-id="'+esc(entry.id)+'"><span class="tv2-ic" aria-hidden="true">'+icon+'</span><span class="tv2-row-main"><strong>'+esc(entryTitle(entry))+'</strong><small>'+esc(entryMeta(entry))+'</small></span><span class="tv2-amt">'+displayMoney(entry.amount,true)+'</span></button>';
  }).join('')+'</div>').join('');
}
function settlementLine(plan) {
  const paid = { Principessa:0, Principe:0 }, share = { Principessa:0, Principe:0 };
  for (const entry of tripEntries(plan)) {
    const remaining = Math.max(0, n(entry.amount) - n(entry.jarContribution));
    if (entry.paidBy === 'both') { paid.Principessa += remaining / 2; paid.Principe += remaining / 2; }
    else if (paid[entry.paidBy] != null) paid[entry.paidBy] += remaining;
    if (entry.split === 'personal') share[entry.forActor === 'Principe' ? 'Principe' : 'Principessa'] += remaining;
    else { share.Principessa += remaining / 2; share.Principe += remaining / 2; }
  }
  const d = paid.Principessa - share.Principessa, me = actor(), other = me === 'Principessa' ? 'Principe' : 'Principessa';
  if (Math.abs(d) < .005) return 'You’re even';
  const creditor = d > 0 ? 'Principessa' : 'Principe', debtor = d > 0 ? 'Principe' : 'Principessa', amount = Math.abs(d);
  if (me === creditor) return `${debtor} owes you ${displayMoney(amount,true)}`;
  if (me === debtor) return `You owe ${creditor} ${displayMoney(amount,true)}`;
  return `${debtor} owes ${creditor} ${displayMoney(amount,true)}`;
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
function simplifiedCard(item) {
  const pct = item.available && item.available > 0 ? Math.min(100, Math.max(0, (item.spent / item.available) * 100)) : 0;
  return '<button class="tv2-card" data-act="open-trip" data-kind="'+item.kind+'" data-id="'+esc(item.id)+'">'+
    '<span class="tv2-card-top"><strong>'+esc(item.meta?.city || locationLabel(item.meta))+'</strong><small>'+esc(shortRange(item.meta?.start,item.meta?.end))+'</small></span>'+
    '<span class="tv2-card-sub">'+esc(statusLine(item.meta))+'</span>'+
    '<span class="tv2-card-money"><span>'+displayMoney(item.spent)+' spent</span>'+(item.left != null?'<span>'+displayMoney(item.left)+' left</span>':'')+'</span>'+
    (item.available && item.available > 0?'<span class="tv2-bar"><i style="width:'+pct.toFixed(1)+'%"></i></span>':'')+
  '</button>';
}
function simplifiedHome(items) {
  return '<div class="tv2-page"><header class="tv2-home-head"><h1>Trips</h1></header>'+
    (items.length?items.map(simplifiedCard).join(''):'<div class="tv2-empty-card"><strong>No trips yet</strong><span>Create one when you start planning. You can add expenses as they happen.</span></div>')+
    '<div class="tv2-dock"><button class="tv2-primary" data-act="new-trip">＋ New trip</button></div></div>';
}
function simplifiedTrip(plan, trip) {
  const meta = plan?.meta || {}, available = tripBudget(plan, trip), spent = expenseTotal(plan, trip), left = available == null ? null : available - spent;
  const over = left != null && left < 0, pct = available && available > 0 ? Math.min(100, Math.max(0, (spent / available) * 100)) : 0;
  const own = plan?.budgets?.[actor()];
  return '<div class="tv2-page">'+
    '<header class="tv2-trip-head"><div class="tv2-nav"><button class="tv2-link" data-act="home">‹ Trips</button><button class="tv2-link" data-act="edit-trip">Edit</button></div>'+
      '<h1>'+esc(meta.city || locationLabel(meta))+'</h1><p>'+esc(shortRange(meta.start,meta.end))+(statusLine(meta)?' · '+esc(statusLine(meta)):'')+'</p></header>'+
    '<section class="tv2-money" aria-label="Trip money"><div class="tv2-figs">'+
      '<button class="tv2-fig" data-act="budgets"><span>Available</span><b>'+(available == null?'Not set':displayMoney(available))+'</b>'+(!has(own)?'<small class="tv2-nudge">+ add yours</small>':'')+'</button>'+
      '<div class="tv2-fig"><span>Spent</span><b>'+displayMoney(spent)+'</b></div></div>'+
      (available && available > 0?'<div class="tv2-bar '+(over?'is-over':'')+'"><i style="width:'+pct.toFixed(1)+'%"></i></div>':'')+
      (left == null?'':'<div class="tv2-left '+(over?'is-over':'')+'"><b>'+displayMoney(Math.abs(left))+'</b><span>'+(over?'over budget':'left')+'</span></div>')+
    '</section>'+
    '<button class="tv2-balance '+(settlementLine(plan)==='You’re even'?'is-even':'')+'" data-act="balance"><span>'+esc(settlementLine(plan))+'</span><span aria-hidden="true">›</span></button>'+
    '<section class="tv2-list" aria-label="Expenses">'+expenseTimeline(plan)+'</section>'+
    '<div class="tv2-dock"><button class="tv2-primary" data-act="add-expense">＋ Add expense</button></div>'+
  '</div>';
}

function renderCurrentTrips() {
  const section = ensureCurrentTrips(), root = $('#twCurrentTrips'); if (!section || !root || !remoteState) return;
  root.classList.toggle('tv2-trip-view', simplifiedView.name === 'trip');
  if (simplifiedView.name === 'trip') {
    const plan = (remoteState.plans || []).find((p)=>p.id===simplifiedView.planId);
    if (!plan) simplifiedView = { name:'home', planId:'' };
    else {
      const trip = (remoteState.trips || []).find((t)=>t.id===plan.linkedTripId);
      root.innerHTML = simplifiedTrip(plan, trip);
      return;
    }
  }
  root.classList.remove('tv2-trip-view');
  root.innerHTML = simplifiedHome(allSimplifiedItems());
}

const EXPENSE_CATS = [
  ['stay','Stay','🛏'],['transport','Transport','✈️'],['car','Car','⛽'],
  ['groceries','Groceries','🛒'],['eating-out','Eating out','🍝'],['activities','Activities','🎟'],['other','Other','•'],
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
  const canSave = () => validAmount() && !!state.category && (state.category !== 'stay' || !state.useJar || jarAmount() <= availableJar()+.005);
  const summary = () => {
    const payer = state.paidBy === me ? 'Paid by you' : state.paidBy === 'both' ? 'Each paid half' : 'Paid by '+state.paidBy;
    const split = state.paidBy === 'both' ? '' : state.split === 'shared' ? 'split 50/50' : state.forActor === me ? 'just you' : 'just '+other;
    const date = state.date === new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10) ? 'today' : fmtDate(state.date);
    return [payer,split,date,state.uncertain?'estimate':''].filter(Boolean).join(' · ');
  };
  const html = () => '<div class="tv2-sheet-head"><h2>'+(existing?'Edit expense':'Add expense')+'</h2><button class="tv2-x" data-close aria-label="Close">✕</button></div>'+
    '<label class="tv2-amount"><span aria-hidden="true">€</span><input id="tv2Amount" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0" value="'+esc(state.amountText)+'" aria-label="Amount in euros"></label>'+
    '<div class="tv2-cats" role="group" aria-label="Category">'+EXPENSE_CATS.map(([k,l,i])=>'<button type="button" class="tv2-cat '+(state.category===k?'on':'')+'" data-cat="'+k+'" aria-pressed="'+(state.category===k?'true':'false')+'"><span aria-hidden="true">'+i+'</span>'+esc(l)+'</button>').join('')+'</div>'+
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
      '<label class="tv2-field"><span>Date</span><input type="date" id="tv2Date" value="'+esc(state.date)+'"></label>'+
      '<label class="tv2-field"><span>Note</span><input id="tv2Note" maxlength="180" placeholder="e.g. dinner by the canal" value="'+esc(state.note)+'"></label>'+
      '<label class="tv2-check"><input type="checkbox" id="tv2Est" '+(state.uncertain?'checked':'')+'> This amount is an estimate</label>'+
    '</div>'+
    '<p class="tv2-hint" aria-live="polite"></p>'+
    '<button type="button" class="tv2-primary tv2-save" data-save>'+(existing?'Save changes':'Save')+'</button>'+
    (existing?'<button type="button" class="tv2-danger-link" data-delete>Delete expense</button>':'');
  simplifiedLayer = document.createElement('div'); simplifiedLayer.className = 'tv2-layer';
  simplifiedLayer.innerHTML = '<div class="tv2-backdrop" data-close></div><div class="tv2-sheet" role="dialog" aria-modal="true"></div>';
  document.body.appendChild(simplifiedLayer); document.body.classList.add('tv2-locked');
  const sheet = simplifiedLayer.querySelector('.tv2-sheet');
  function refreshLive() {
    const slot = sheet.querySelector('.tv2-jar-slot');
    if (state.category === 'stay') {
      if (availableJar() <= 0) slot.innerHTML = '<div class="tv2-jar is-off"><span>Shared Jar has '+displayMoney(availableJar(),true)+' available</span></div>';
      else if (state.useJar) slot.innerHTML = '<div class="tv2-jar"><span>Shared Jar pays <b>'+(validAmount()?displayMoney(jarAmount(),true):'20%')+'</b> (20%)</span><button type="button" data-jar="off">Remove</button></div>';
      else slot.innerHTML = '<div class="tv2-jar is-off"><span>Shared Jar not used</span><button type="button" data-jar="on">Use 20%</button></div>';
    } else slot.innerHTML = '';
    sheet.querySelector('.tv2-summary').textContent = summary();
    const hint = sheet.querySelector('.tv2-hint'), save = sheet.querySelector('[data-save]');
    save.disabled = !canSave() || state.busy; save.textContent = state.busy ? 'Saving…' : existing ? 'Save changes' : 'Save';
    hint.textContent = state.error || (state.amountText && !validAmount() ? 'That amount doesn’t look right' : !validAmount() ? 'Enter the amount' : !state.category ? 'Pick a category' : state.category==='stay'&&state.useJar&&jarAmount()>availableJar()+.005 ? 'Not enough in the Shared Jar.' : '');
    hint.classList.toggle('is-error',!!state.error || (!!state.amountText&&!validAmount()) || (state.category==='stay'&&state.useJar&&jarAmount()>availableJar()+.005));
  }
  function mount() {
    sheet.innerHTML = html();
    const input = sheet.querySelector('#tv2Amount');
    input.addEventListener('input',()=>{state.amountText=input.value;state.error='';refreshLive();});
    input.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();if(canSave())save();}});
    sheet.querySelector('#tv2Date')?.addEventListener('change',(e)=>{state.date=e.target.value||state.date;refreshLive();});
    sheet.querySelector('#tv2Note')?.addEventListener('input',(e)=>{state.note=e.target.value;});
    sheet.querySelector('#tv2Est')?.addEventListener('change',(e)=>{state.uncertain=e.target.checked;refreshLive();});
    sheet.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-close')) { closeSimplifiedSheet(); return; }
      if (b.dataset.cat) { state.category=b.dataset.cat; if(state.category!=='stay')state.useJar=false; sheet.querySelectorAll('[data-cat]').forEach((x)=>{x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',String(x===b));}); refreshLive(); return; }
      if (b.dataset.jar) { state.useJar=b.dataset.jar==='on'; refreshLive(); return; }
      if (b.hasAttribute('data-more')) { state.more=!state.more; mount(); return; }
      if (b.dataset.payer) { state.paidBy=b.dataset.payer; if(state.paidBy==='both')state.split='shared'; mount(); return; }
      if (b.hasAttribute('data-jar-payer')) { if(state.category!=='stay'){state.error='Shared Jar can only be used for Stay.';refreshLive();return;} state.useJar=true;state.error='Shared Jar contributes 20% to Stay; choose who paid the remaining amount.';refreshLive();return; }
      if (b.dataset.split) { if(b.dataset.split==='shared'){state.split='shared';}else{state.split='personal';state.forActor=b.dataset.split;} mount(); return; }
      if (b.hasAttribute('data-save')) { save(); return; }
      if (b.hasAttribute('data-delete')) { remove(); }
    };
    refreshLive();
    if (!state.mounted && !existing) { state.mounted=true; setTimeout(()=>input.focus(),0); }
  }
  async function save() {
    if (!canSave() || state.busy) return;
    state.busy=true; state.error=''; refreshLive();
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

function bindSimplifiedSwipe(section) {
  if (section.dataset.tv2Swipe === '1') return;
  section.dataset.tv2Swipe = '1';
  const mobile = () => window.matchMedia?.('(max-width:760px)')?.matches ?? window.innerWidth <= 760;
  const page = () => section.querySelector('#twCurrentTrips.tv2-trip-view > .tv2-page');
  const clearVisual = (animate = true) => {
    const current = page(); if (!current) return;
    current.style.transition = animate ? 'transform .18s cubic-bezier(.22,.8,.28,1), opacity .18s ease' : 'none';
    current.style.transform = 'translateX(0)';
    current.style.opacity = '1';
    if (animate) setTimeout(() => { if (current.isConnected) current.style.transition = ''; }, 200);
  };
  const cancel = () => {
    if (swipeBack.active) clearVisual(true);
    swipeBack = { tracking:false, active:false, startX:0, startY:0, lastX:0 };
  };
  section.addEventListener('touchstart', (e) => {
    if (!mobile() || simplifiedView.name !== 'trip' || simplifiedLayer || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX > 46) return;
    swipeBack = { tracking:true, active:false, startX:t.clientX, startY:t.clientY, lastX:t.clientX };
  }, { passive:true });
  section.addEventListener('touchmove', (e) => {
    if (!swipeBack.tracking || e.touches.length !== 1) return;
    const t = e.touches[0], dx = t.clientX - swipeBack.startX, dy = Math.abs(t.clientY - swipeBack.startY);
    swipeBack.lastX = t.clientX;
    if (!swipeBack.active) {
      if (Math.abs(dx) < 8 && dy < 8) return;
      if (dx > 10 && dx > dy * 1.25) swipeBack.active = true;
      else if (dy >= Math.abs(dx) || dx < 0) { swipeBack.tracking = false; return; }
    }
    if (!swipeBack.active) return;
    e.preventDefault();
    const current = page(); if (!current) return;
    const distance = Math.max(0, Math.min(dx, window.innerWidth * .78));
    current.style.transition = 'none';
    current.style.transform = 'translateX(' + distance + 'px)';
    current.style.opacity = String(Math.max(.82, 1 - distance / (window.innerWidth * 2.5)));
  }, { passive:false });
  section.addEventListener('touchend', () => {
    if (!swipeBack.tracking) { swipeBack = { tracking:false, active:false, startX:0, startY:0, lastX:0 }; return; }
    const dx = swipeBack.lastX - swipeBack.startX, current = page();
    const goBack = swipeBack.active && dx >= Math.min(92, window.innerWidth * .24);
    swipeBack = { tracking:false, active:false, startX:0, startY:0, lastX:0 };
    if (!current) return;
    if (goBack) {
      current.style.transition = 'transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      current.style.transform = 'translateX(100vw)';
      current.style.opacity = '.72';
      setTimeout(() => {
        simplifiedView = { name:'home', planId:'' };
        renderCurrentTrips();
        window.scrollTo({ top:0, behavior:'auto' });
      }, 170);
    } else clearVisual(true);
  }, { passive:true });
  section.addEventListener('touchcancel', cancel, { passive:true });
}

function handleSimplifiedClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'new-trip') { document.dispatchEvent(new CustomEvent('twogether:budget-new-plan')); return; }
  if (b.dataset.act === 'home') { simplifiedView={name:'home',planId:''}; renderCurrentTrips(); return; }
  if (b.dataset.act === 'open-trip') {
    if (b.dataset.kind === 'plan') { simplifiedView={name:'trip',planId:b.dataset.id}; renderCurrentTrips(); }
    else window.TwogetherApp?.open(b.dataset.id);
    return;
  }
  const plan = (remoteState?.plans || []).find((p)=>p.id===simplifiedView.planId); if (!plan) return;
  if (b.dataset.act === 'budgets' || b.dataset.act === 'edit-trip') { window.TwogetherWorkflow?.budget(plan.id); return; }
  if (b.dataset.act === 'add-expense') { openSimplifiedExpenseSheet(plan); return; }
  if (b.dataset.act === 'open-expense') {
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
