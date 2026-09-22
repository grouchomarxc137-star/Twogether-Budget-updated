// The redesigned Trips experience: one shared trip, a Current Trip screen
// that answers "available / spent / left / who owes whom" first, and a
// one-panel Add Expense flow (amount -> category -> Save) with every rare
// option folded away. Built alongside the old Trips screens.
import {
  CATEGORIES, SUBCATEGORIES, categoryOf, deriveTrip, timeline, formatCents, parseMoneyToCents,
  jarSuggestion, localToday, otherActorOf, daysBetween, balanceBreakdown, autoAllocate, allocationRoom,
  repaymentsFor, claimOf,
} from '../../shared/trips-model.js';
import { esc, uid } from '../lib/format.js';
import { actor } from '../lib/session.js';
import * as store from './store.js';

const VIEW_KEY = 'twogether_trips_v2_view';
let root = null;
let layer = null;
let view = readView();
let userLeftTrip = false;
let snackTimer = null;

function readView() {
  try { return JSON.parse(sessionStorage.getItem(VIEW_KEY)) || { name: 'home' }; } catch { return { name: 'home' }; }
}
function setView(next) {
  view = next;
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch {}
  render();
  root?.scrollIntoView({ block: 'start' });
  window.scrollTo({ top: 0 });
}

const me = () => actor();
const partner = () => otherActorOf(me());
const who = (name) => (name === me() ? 'you' : name);
const Who = (name) => (name === me() ? 'You' : name);
const money = (c) => formatCents(c);
const editable = (c) => (c === null || c === undefined ? '' : formatCents(c, { whole: true }).replace('€', '').replace(/\./g, ''));
const whole = (c) => formatCents(c, { whole: true });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function shortDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
function dayLabel(iso) {
  if (!iso) return 'No date';
  const diff = daysBetween(iso, localToday());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}
function dateRange(t) {
  if (!t.start) return '';
  const [ys, ms] = t.start.split('-'), [ye, me2] = t.end.split('-');
  if (ys === ye && ms === me2) return `${Number(t.start.slice(8))}–${shortDate(t.end)}`;
  return `${shortDate(t.start)} – ${shortDate(t.end)}`;
}
function statusLine(t, d) {
  if (d.status === 'upcoming') return d.daysUntil === 1 ? 'Starts tomorrow' : `Starts in ${d.daysUntil} days`;
  if (d.status === 'ongoing') return `Day ${d.dayOf} of ${d.length}`;
  if (d.status === 'ended') return 'Trip ended';
  if (d.status === 'closed') return 'Closed';
  return '';
}

// ---------------------------------------------------------------- render

export function render() {
  if (!root) return;
  if (!me()) { root.innerHTML = '<div class="tv2-empty"><p>Choose who you are to see your trips.</p></div>'; return; }
  if (!store.ready()) {
    root.innerHTML = store.error()
      ? `<div class="tv2-empty"><p>${esc(store.error())}</p><button class="tv2-btn" data-act="retry">Try again</button></div>`
      : '<div class="tv2-empty"><p class="tv2-muted">Loading trips…</p></div>';
    return;
  }
  const active = store.trips().filter((t) => !t.closedAt).sort((a, b) => (a.end < localToday()) - (b.end < localToday()) || a.start.localeCompare(b.start));
  if (view.name === 'trip' && !store.tripById(view.tripId)) view = { name: 'home' };
  if (view.name === 'home' && !userLeftTrip && active.length === 1) view = { name: 'trip', tripId: active[0].id };
  root.innerHTML = view.name === 'trip' ? tripHtml(store.tripById(view.tripId)) : homeHtml(active);
}

function homeHtml(active) {
  const cards = active.map((t) => {
    const d = deriveTrip(t);
    const pct = d.available ? Math.min(100, Math.round((d.spent / d.available) * 100)) : 0;
    return `<button class="tv2-card" data-act="open-trip" data-id="${esc(t.id)}">
      <span class="tv2-card-top"><strong>${esc(t.place.city)}</strong><small>${esc(dateRange(t))}</small></span>
      <span class="tv2-card-sub">${esc(statusLine(t, d))}</span>
      <span class="tv2-card-money"><span>${whole(d.spent)} spent</span>${d.available !== null ? `<span>${whole(d.left)} left</span>` : ''}</span>
      ${d.available ? `<span class="tv2-bar"><i style="width:${pct}%"></i></span>` : ''}
    </button>`;
  }).join('');
  return `<div class="tv2-page">
    <header class="tv2-home-head"><h1>Trips</h1></header>
    ${cards || '<div class="tv2-empty-card"><strong>No trips yet</strong><span>Create one when you start planning. You can add expenses as they happen.</span></div>'}
    <div class="tv2-dock"><button class="tv2-primary" data-act="new-trip">＋ New trip</button></div>
  </div>`;
}

function tripHtml(t) {
  const d = deriveTrip(t);
  const over = d.left !== null && d.left < 0;
  const pct = d.available ? Math.min(100, Math.round((d.spent / d.available) * 100)) : 0;
  const balanceText = !d.debtor
    ? 'You’re even'
    : d.debtor === me() ? `You owe ${partner()} ${money(d.owed)}` : `${d.debtor} owes you ${money(d.owed)}`;
  return `<div class="tv2-page">
    <header class="tv2-trip-head">
      <div class="tv2-nav"><button class="tv2-link" data-act="home">‹ Trips</button><button class="tv2-link" data-act="edit-trip">Edit</button></div>
      <h1>${esc(t.place.city)}</h1>
      <p>${esc(dateRange(t))}${statusLine(t, d) ? ` · ${esc(statusLine(t, d))}` : ''}</p>
    </header>

    <section class="tv2-money" aria-label="Trip money">
      <div class="tv2-figs">
        <button class="tv2-fig" data-act="budgets"><span>Available</span><b>${d.available === null ? 'Not set' : whole(d.available)}</b>${t.plannedBudgets[me()] === null ? '<small class="tv2-nudge">+ add yours</small>' : ''}</button>
        <div class="tv2-fig"><span>Spent</span><b>${whole(d.spent)}</b></div>
      </div>
      ${d.available ? `<div class="tv2-bar ${over ? 'is-over' : ''}"><i style="width:${pct}%"></i></div>` : ''}
      ${d.left === null ? '' : `<div class="tv2-left ${over ? 'is-over' : ''}"><b>${whole(Math.abs(d.left))}</b><span>${over ? 'over budget' : 'left'}</span></div>`}
    </section>

    <button class="tv2-balance ${d.debtor ? '' : 'is-even'}" data-act="balance"><span>${esc(balanceText)}</span><span aria-hidden="true">›</span></button>

    <section class="tv2-list" aria-label="Expenses">${listHtml(t)}</section>

    <div class="tv2-dock"><button class="tv2-primary" data-act="add-expense">＋ Add expense</button></div>
  </div>`;
}

function expenseTitle(e) {
  if (e.note) return e.note;
  const sub = (SUBCATEGORIES[e.category] || []).find(([k]) => k === e.subcategory);
  return sub ? sub[1] : categoryOf(e.category).label;
}
function expenseMeta(e) {
  const bits = [];
  if (e.paidBy === 'each') bits.push('each paid half');
  else if (e.paidBy === 'jar') bits.push('Shared Jar');
  else if (e.paidBy) bits.push(who(e.paidBy));
  if (e.split !== 'shared' && e.paidBy !== 'jar') bits.push(`just ${who(e.split)}`);
  if (e.jarAmount && e.paidBy !== 'jar') bits.push(`${money(e.jarAmount)} from Jar`);
  if (e.estimated) bits.push('estimate');
  return bits.join(' · ');
}

function settlementFor(t, s) {
  const names = s.allocations.map((a) => t.expenses.find((e) => e.id === a.expenseId)).filter((e) => e && !e.deletedAt).map(expenseTitle);
  if (!names.length) return '';
  return ` · for ${esc(names.slice(0, 2).join(', '))}${names.length > 2 ? ` +${names.length - 2}` : ''}`;
}

function listHtml(t) {
  const groups = timeline(t);
  if (!groups.length) return '<div class="tv2-empty-list">No expenses yet. Add them as they happen, it takes a few seconds.</div>';
  return groups.map((g) => `<div class="tv2-day"><h2>${esc(dayLabel(g.date))}</h2>${g.items.map(({ kind, item }) => {
    if (kind === 'settlement') {
      return `<button class="tv2-row is-settlement" data-act="edit-settlement" data-id="${esc(item.id)}">
        <span class="tv2-ic" aria-hidden="true">↔</span>
        <span class="tv2-row-main"><strong>Repayment</strong><small>${esc(Who(item.from))} → ${esc(who(item.to))}${settlementFor(t, item)}</small></span>
        <span class="tv2-amt">${money(item.amount)}</span></button>`;
    }
    const cat = categoryOf(item.category);
    return `<button class="tv2-row" data-act="edit-expense" data-id="${esc(item.id)}">
      <span class="tv2-ic" aria-hidden="true">${cat.icon}</span>
      <span class="tv2-row-main"><strong>${esc(expenseTitle(item))}</strong><small>${esc(expenseMeta(item))}${item.jarShortfall ? '<em class="tv2-warn-text"> · Jar not applied</em>' : ''}</small></span>
      <span class="tv2-amt">${money(item.amount)}</span></button>`;
  }).join('')}</div>`).join('');
}

// ---------------------------------------------------------------- sheets

function openSheet(html, onMount) {
  closeSheet();
  layer = document.createElement('div');
  layer.className = 'tv2-layer';
  layer.innerHTML = `<div class="tv2-backdrop" data-close></div><div class="tv2-sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(layer);
  document.body.classList.add('tv2-locked');
  layer.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  onMount?.(layer.querySelector('.tv2-sheet'));
}
function closeSheet() {
  layer?.remove();
  layer = null;
  document.body.classList.remove('tv2-locked');
}
const sheetHead = (title) => `<div class="tv2-sheet-head"><h2>${esc(title)}</h2><button class="tv2-x" data-close aria-label="Close">✕</button></div>`;

function snack(message, undo) {
  let el = document.querySelector('.tv2-snack');
  if (!el) { el = document.createElement('div'); el.className = 'tv2-snack'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(message)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  el.classList.add('show');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => el.classList.remove('show'), undo ? 5000 : 2600);
  if (undo) el.querySelector('button').onclick = async () => { el.classList.remove('show'); try { await undo(); } catch (err) { snack(err.message || 'Could not undo'); } };
}

// Repayments that were recorded as covering this expense (explanation only).
function repaidLine(trip, e) {
  const reps = repaymentsFor(trip, e.id);
  if (!reps.length) return '';
  const total = reps.reduce((sum, x) => sum + x.amount, 0);
  const payers = [...new Set(reps.map((x) => who(x.settlement.from)))].join(' and ');
  const claim = claimOf(e)?.amount || 0;
  const extra = total - claim;
  return `<p class="tv2-repaid">${money(total)} repaid toward this by ${esc(payers)}${extra > 0 ? ` · ${money(extra)} more than this share now, counted as general` : ''}</p>`;
}

// ---- Add / edit expense: one panel, amount first ------------------------

function expenseSheet(trip, existing = null) {
  // The id is chosen once, when the panel opens: pressing Save again after a
  // lost response re-sends the same id, which the server recognises.
  const expenseId = existing?.id || uid();
  const jarBase = store.jarAvailableCents() + (existing ? (existing.paidBy === 'jar' ? existing.amount : existing.jarAmount) : 0);
  const s = {
    amountText: existing ? editable(existing.amount) : '',
    category: existing?.category || '',
    subcategory: existing?.subcategory || null,
    paidBy: existing?.paidBy || me(),
    split: existing?.split || 'shared',
    date: existing?.date || localToday(),
    note: existing?.note || '',
    estimated: !!existing?.estimated,
    useJar: existing ? existing.jarAmount > 0 || !!existing.jarShortfall : true,
    more: false,
    busy: false,
    error: '',
    mounted: false,
  };
  const cents = () => parseMoneyToCents(s.amountText);
  const jarAmount = () => {
    const c = cents();
    if (s.paidBy === 'jar') return c || 0;
    if (!c || s.category !== 'stay' || !s.useJar) return 0;
    return jarSuggestion(c, jarBase);
  };
  const canSave = () => (cents() || 0) > 0 && !!s.category;

  const payerLabel = { [me()]: 'You', [partner()]: partner(), each: 'Each paid half', jar: 'Shared Jar' };
  const splitLabel = { shared: 'Shared 50/50', [me()]: 'Just you', [partner()]: `Just ${partner()}` };
  const summary = () => {
    const payer = s.paidBy === me() ? 'Paid by you' : s.paidBy === 'each' ? 'Each paid half' : s.paidBy === 'jar' ? 'Paid by Shared Jar' : `Paid by ${s.paidBy}`;
    const split = s.paidBy === 'jar' || s.paidBy === 'each' ? '' : s.split === 'shared' ? 'split 50/50' : `just ${who(s.split)}`;
    const date = s.date === localToday() ? 'today' : shortDate(s.date);
    return [payer, split, date, s.estimated ? 'estimate' : ''].filter(Boolean).join(' · ');
  };

  const html = () => `${sheetHead(existing ? 'Edit expense' : 'Add expense')}
    <label class="tv2-amount"><span aria-hidden="true">€</span><input id="tv2Amount" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0" value="${esc(s.amountText)}" aria-label="Amount in euros"></label>
    <div class="tv2-cats" role="group" aria-label="Category">${CATEGORIES.map((c) => `<button type="button" class="tv2-cat ${s.category === c.key ? 'on' : ''}" data-cat="${c.key}" aria-pressed="${s.category === c.key}"><span aria-hidden="true">${c.icon}</span>${esc(c.label)}</button>`).join('')}</div>
    <div class="tv2-jar-slot"></div>
    <button type="button" class="tv2-defaults" data-more aria-expanded="${s.more}"><span class="tv2-summary"></span><span class="tv2-chev" aria-hidden="true">${s.more ? '⌃' : '⌄'}</span></button>
    <div class="tv2-more" ${s.more ? '' : 'hidden'}>
      <div class="tv2-field"><span>Paid by</span><div class="tv2-seg">${[me(), partner(), 'each', 'jar'].map((k) => `<button type="button" data-payer="${esc(k)}" class="${s.paidBy === k ? 'on' : ''}">${esc(payerLabel[k])}</button>`).join('')}</div></div>
      <div class="tv2-field" ${s.paidBy === 'each' || s.paidBy === 'jar' ? 'hidden' : ''}><span>For</span><div class="tv2-seg">${['shared', me(), partner()].map((k) => `<button type="button" data-split="${esc(k)}" class="${s.split === k ? 'on' : ''}">${esc(splitLabel[k])}</button>`).join('')}</div></div>
      ${(SUBCATEGORIES[s.category] || []).length ? `<div class="tv2-field"><span>Type</span><div class="tv2-seg">${SUBCATEGORIES[s.category].map(([k, l]) => `<button type="button" data-sub="${k}" class="${s.subcategory === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div></div>` : ''}
      <label class="tv2-field"><span>Date</span><input type="date" id="tv2Date" value="${esc(s.date)}"></label>
      <label class="tv2-field"><span>Note</span><input id="tv2Note" maxlength="180" placeholder="e.g. dinner by the canal" value="${esc(s.note)}"></label>
      <label class="tv2-check"><input type="checkbox" id="tv2Est" ${s.estimated ? 'checked' : ''}> This amount is an estimate</label>
    </div>
    <p class="tv2-hint" aria-live="polite"></p>
    <button type="button" class="tv2-primary tv2-save" data-save>${existing ? 'Save changes' : 'Save'}</button>
    ${existing ? repaidLine(trip, existing) : ''}
    ${existing ? `<button type="button" class="tv2-danger-link" data-delete>Delete expense</button>
      <p class="tv2-meta">Added by ${esc(Who(existing.createdBy) || '—')} · ${esc(shortDate(existing.createdAt.slice(0, 10)))}${existing.updatedBy && existing.updatedAt !== existing.createdAt ? ` · edited by ${esc(who(existing.updatedBy))}` : ''}</p>` : ''}`;

  // Parts that change while typing are updated in place, so the amount
  // field keeps focus and the keyboard never closes.
  function refreshLive(sheet) {
    const c = cents();
    const slot = sheet.querySelector('.tv2-jar-slot');
    if (s.category === 'stay' && s.paidBy !== 'jar') {
      const suggestion = c ? jarSuggestion(c, jarBase) : 0;
      if (jarBase <= 0) slot.innerHTML = `<div class="tv2-jar is-off ${jarBase < 0 ? 'is-negative' : ''}"><span>Shared Jar has ${money(jarBase)} available</span></div>`;
      else if (s.useJar) slot.innerHTML = `<div class="tv2-jar"><span>Shared Jar pays <b>${c ? money(suggestion) : '20%'}</b>${c && suggestion < Math.round(c * 0.2) ? ' (all it has)' : ' (20%)'}</span><button type="button" data-jar="off">Remove</button></div>`;
      else slot.innerHTML = '<div class="tv2-jar is-off"><span>Shared Jar not used</span><button type="button" data-jar="on">Use 20%</button></div>';
    } else slot.innerHTML = '';
    sheet.querySelector('.tv2-summary').textContent = summary();
    const hint = sheet.querySelector('.tv2-hint');
    const save = sheet.querySelector('[data-save]');
    save.disabled = !canSave() || s.busy;
    save.textContent = s.busy ? 'Saving…' : existing ? 'Save changes' : 'Save';
    hint.textContent = s.error || (s.amountText && !c ? 'That amount doesn’t look right' : !c ? 'Enter the amount' : !s.category ? 'Pick a category' : '');
    hint.classList.toggle('is-error', !!s.error || (!!s.amountText && !c));
  }

  function mount(sheet) {
    sheet.innerHTML = html();
    const amount = sheet.querySelector('#tv2Amount');
    amount.addEventListener('input', () => { s.amountText = amount.value; s.error = ''; refreshLive(sheet); });
    amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (canSave()) save(sheet); else amount.blur(); } });
    sheet.querySelector('#tv2Date')?.addEventListener('change', (e) => { s.date = e.target.value || localToday(); refreshLive(sheet); });
    sheet.querySelector('#tv2Note')?.addEventListener('input', (e) => { s.note = e.target.value; });
    sheet.querySelector('#tv2Est')?.addEventListener('change', (e) => { s.estimated = e.target.checked; refreshLive(sheet); });
    sheet.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.cat) {
        s.category = b.dataset.cat; s.subcategory = null;
        sheet.querySelectorAll('[data-cat]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
        if (s.more) { mount(sheet); return; }
        refreshLive(sheet); return;
      }
      if (b.dataset.jar) { s.useJar = b.dataset.jar === 'on'; refreshLive(sheet); return; }
      if (b.hasAttribute('data-more')) { s.more = !s.more; mount(sheet); return; }
      if (b.dataset.payer) { s.paidBy = b.dataset.payer; if (s.paidBy === 'each') s.split = 'shared'; mount(sheet); return; }
      if (b.dataset.split) { s.split = b.dataset.split; mount(sheet); return; }
      if (b.dataset.sub) { s.subcategory = s.subcategory === b.dataset.sub ? null : b.dataset.sub; mount(sheet); return; }
      if (b.hasAttribute('data-save')) { save(sheet); return; }
      if (b.hasAttribute('data-delete')) { remove(); }
    };
    refreshLive(sheet);
    // Focus the amount only when the panel first opens; re-renders from
    // tapping options must not pop the phone keyboard back up.
    if (!s.mounted && !existing) amount.focus();
    s.mounted = true;
  }

  async function save(sheet) {
    if (!canSave() || s.busy) return;
    s.busy = true; s.error = ''; refreshLive(sheet);
    const expense = {
      id: expenseId,
      amount: cents(), category: s.category, subcategory: s.subcategory,
      paidBy: s.paidBy, split: s.paidBy === 'each' || s.paidBy === 'jar' ? 'shared' : s.split,
      jarAmount: jarAmount(), date: s.date, note: s.note.trim(), estimated: s.estimated,
    };
    if (existing) expense.rev = existing.rev;
    try {
      const r = await store.act('tripExpenseSave', { tripId: trip.id, expense });
      closeSheet();
      if (r?.jarNotApplied) snack('Saved. The Shared Jar didn’t have enough, so it wasn’t used.');
      else if (existing) snack('Saved');
      else snack(`${formatCents(expense.amount)} ${categoryOf(expense.category).label.toLowerCase()} added`, () => store.act('tripExpenseDelete', { tripId: trip.id, expenseId: r.expense.id, rev: r.expense.rev }));
    } catch (err) {
      s.busy = false;
      s.error = err?.message || 'Could not save. Check your connection and try again.';
      if (/just changed/i.test(s.error)) { await store.refresh(); }
      refreshLive(sheet);
    }
  }

  async function remove() {
    try {
      const r = await store.act('tripExpenseDelete', { tripId: trip.id, expenseId: existing.id, rev: existing.rev });
      closeSheet();
      // Undo restores exactly this deleted version (the server refuses if it
      // changed again in the meantime).
      snack('Expense deleted', () => store.act('tripExpenseRestore', { tripId: trip.id, expenseId: r.expense.id, rev: r.expense.rev }));
    } catch (err) {
      snack(err?.message || 'Could not delete');
      if (/just changed/i.test(err?.message || '')) { closeSheet(); store.refresh(); }
    }
  }

  openSheet('', mount);
}

// ---- Create / edit trip --------------------------------------------------

function tripSheet(existing = null) {
  const places = existing ? [] : store.pastPlaces();
  const newTripId = existing ? '' : uid();
  const html = `${sheetHead(existing ? 'Edit trip' : 'New trip')}
    <label class="tv2-field tv2-big"><span>Where?</span><input id="tv2City" autocomplete="off" placeholder="City or area" value="${esc(existing?.place.city || '')}"></label>
    ${places.length ? `<div class="tv2-chips">${places.map((p) => `<button type="button" data-place="${esc(p)}">${esc(p)}</button>`).join('')}</div>` : ''}
    <div class="tv2-dates">
      <label class="tv2-field"><span>From</span><input type="date" id="tv2Start" value="${esc(existing?.start || '')}"></label>
      <label class="tv2-field"><span>To</span><input type="date" id="tv2End" value="${esc(existing?.end || '')}"></label>
    </div>
    ${existing ? '' : '<label class="tv2-field"><span>Your planned budget <em>(optional)</em></span><input id="tv2Budget" inputmode="decimal" placeholder="€ 0" autocomplete="off"></label><p class="tv2-meta">' + esc(partner()) + ' can add theirs later.</p>'}
    <p class="tv2-hint" aria-live="polite"></p>
    <button type="button" class="tv2-primary" data-save>${existing ? 'Save changes' : 'Create trip'}</button>`;
  openSheet(html, (sheet) => {
    const city = sheet.querySelector('#tv2City'), start = sheet.querySelector('#tv2Start'), end = sheet.querySelector('#tv2End'), budget = sheet.querySelector('#tv2Budget');
    const hint = sheet.querySelector('.tv2-hint'), btn = sheet.querySelector('[data-save]');
    const check = () => {
      const missing = !city.value.trim() ? 'Add where you’re going' : !start.value || !end.value ? 'Add the dates' : end.value < start.value ? 'The trip can’t end before it starts' : budget && budget.value.trim() && parseMoneyToCents(budget.value) === null ? 'That budget doesn’t look right' : '';
      hint.textContent = missing; btn.disabled = !!missing; return !missing;
    };
    start.addEventListener('change', () => { end.min = start.value; if (!end.value || end.value < start.value) end.value = start.value; check(); });
    [city, end, budget].forEach((el) => el?.addEventListener('input', check));
    end.addEventListener('change', check);
    sheet.addEventListener('click', async (e) => {
      const p = e.target.closest('[data-place]'); if (p) { city.value = p.dataset.place; check(); start.focus(); return; }
      if (!e.target.closest('[data-save]') || !check()) return;
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        if (existing) {
          await store.act('tripUpdate', { tripId: existing.id, rev: existing.rev, city: city.value, start: start.value, end: end.value });
          closeSheet(); snack('Trip updated');
        } else {
          const id = newTripId;
          const b = budget.value.trim() ? parseMoneyToCents(budget.value) : null;
          await store.act('tripCreate', { trip: { id, city: city.value, start: start.value, end: end.value }, budget: b });
          closeSheet(); userLeftTrip = false; setView({ name: 'trip', tripId: id });
        }
      } catch (err) {
        hint.textContent = err?.message || 'Could not save. Try again.'; btn.disabled = false; btn.textContent = existing ? 'Save changes' : 'Create trip';
        if (/just changed/i.test(hint.textContent)) store.refresh();
      }
    });
    check();
    if (!existing) city.focus();
  });
}

// ---- Budgets: combined first, each person on request ---------------------

function budgetSheet(trip) {
  const d = deriveTrip(trip);
  const mine = trip.plannedBudgets[me()], theirs = trip.plannedBudgets[partner()];
  const html = `${sheetHead('Budget')}
    <div class="tv2-budget-total"><span>Available together</span><b>${d.available === null ? 'Not set yet' : money(d.available)}</b></div>
    <label class="tv2-field"><span>Your planned budget</span><input id="tv2MyBudget" inputmode="decimal" placeholder="Not set" autocomplete="off" value="${esc(editable(mine))}"></label>
    <div class="tv2-kv"><span>${esc(partner())}’s planned budget</span><b>${theirs === null ? 'Not set yet' : money(theirs)}</b></div>
    ${trip.plannedBudgets.unassigned !== null ? `<div class="tv2-kv"><span>Shared budget</span><b>${money(trip.plannedBudgets.unassigned)}</b></div>` : ''}
    <div class="tv2-kv tv2-soft"><span>Your share of spending so far</span><b>${money(d.share[me()])}</b></div>
    <div class="tv2-kv tv2-soft"><span>${esc(partner())}’s share so far</span><b>${money(d.share[partner()])}</b></div>
    <p class="tv2-hint" aria-live="polite"></p>
    <button type="button" class="tv2-primary" data-save>Save my budget</button>`;
  openSheet(html, (sheet) => {
    const input = sheet.querySelector('#tv2MyBudget'), hint = sheet.querySelector('.tv2-hint');
    sheet.querySelector('[data-save]').onclick = async (e) => {
      const text = input.value.trim(); const amount = text ? parseMoneyToCents(text) : null;
      if (text && amount === null) { hint.textContent = 'That amount doesn’t look right'; return; }
      e.target.disabled = true;
      try { await store.act('tripSetBudget', { tripId: trip.id, rev: trip.rev, amount }); closeSheet(); snack('Budget saved'); }
      catch (err) {
        hint.textContent = err?.message || 'Could not save'; e.target.disabled = false;
        if (/just changed/i.test(hint.textContent)) { closeSheet(); await store.refresh(); snack(err.message); }
      }
    };
  });
}

// ---- Balance details and repayment ---------------------------------------
// The net balance (deriveTrip) is the truth; balanceBreakdown only explains
// it: what each covered for the other, the offset, repayments, and which
// expenses the remaining amount corresponds to (oldest first).

function titleOf(e) { return e ? expenseTitle(e) : 'Not tied to an expense'; }

function section(label, total, rows, { negative = false } = {}) {
  if (!rows.length) return '';
  // Collapsed by default: one line per part of the explanation; tap for rows.
  return `<details class="tv2-sec">
    <summary><span>${esc(label)}</span><b>${negative ? '−' : ''}${money(total)}</b></summary>
    <div class="tv2-sec-rows">${rows.join('')}</div></details>`;
}
function lineRow(title, sub, amount, { negative = false, id = '' } = {}) {
  return `<div class="tv2-line"${id ? ` data-open-expense="${esc(id)}"` : ''}><span><strong>${esc(title)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</span><b>${negative ? '−' : ''}${money(amount)}</b></div>`;
}
function coversList(allocations, general, trip) {
  const rows = allocations.map((a) => {
    const e = trip.expenses.find((x) => x.id === a.expenseId);
    return `<li><span>${esc(e ? titleOf(e) : 'Removed expense')}${e?.deletedAt ? ' (deleted)' : ''}</span><b>${money(a.amount)}</b></li>`;
  });
  if (general > 0) rows.push(`<li class="tv2-soft"><span>Not tied to an expense</span><b>${money(general)}</b></li>`);
  return rows.length ? `<ul class="tv2-covers">${rows.join('')}</ul>` : '';
}

function balanceSheet(trip) {
  const b = balanceBreakdown(trip, { perspective: { debtor: me() } });
  const D = b.perspective.debtor, C = b.perspective.creditor;
  const headline = b.even ? 'You’re even' : D === me() ? `You owe ${C} ${money(b.owed)}` : `${D} owes you ${money(b.owed)}`;
  const whoCovered = C === me() ? `You paid for ${D}` : `${C} paid for you`;
  const whoOffset = D === me() ? `You paid for ${C}` : `${D} paid for you`;

  const covered = section(whoCovered, b.coveredTotal, b.covered.map((r) => lineRow(titleOf(r.expense), [
    shortDate(r.expense.date),
    r.allocated ? `${money(Math.min(r.allocated, r.claim))} repaid` : '',
    r.overAllocated ? `${money(r.overAllocated)} more repaid than this share` : '',
  ].filter(Boolean).join(' · '), r.claim, { id: r.expense.id })));
  const offsets = section(whoOffset, b.offsetTotal, b.offsets.map((r) => lineRow(titleOf(r.expense), shortDate(r.expense.date), r.claim, { negative: true, id: r.expense.id })), { negative: true });
  const paid = section(`Repayments ${D === me() ? 'you' : D} made`, b.paidTotal, b.paid.map((s) => lineRow('Repayment', shortDate(s.date), s.amount, { negative: true })), { negative: true });
  const received = section(`Repayments ${C === me() ? 'you' : C} made`, b.receivedTotal, b.received.map((s) => lineRow('Repayment', shortDate(s.date), s.amount)));
  // The still-open items are listed once, under "Covers" in the repayment
  // below (for the full amount they are the same list).
  const open = b.even ? '' : `<div class="tv2-open"><div class="tv2-open-head"><span>Still open</span><b>${money(b.stillOpenTotal)}</b></div></div>`;

  const repay = b.even ? '' : `<div class="tv2-repay">
      <label class="tv2-field"><span>${D === me() ? `Pay ${esc(C)}` : `${esc(D)} paid you`}</span><input id="tv2Repay" inputmode="decimal" autocomplete="off" value="${esc(editable(b.owed))}"></label>
      <div class="tv2-covers-wrap"><span class="tv2-covers-label">Covers</span><div data-covers></div></div>
      <button type="button" class="tv2-textbtn" data-change-covers>Change what this covers</button>
      <p class="tv2-hint" aria-live="polite"></p>
      <button type="button" class="tv2-primary" data-repay>Record repayment</button></div>`;

  const html = `${sheetHead('Who owes whom')}
    <p class="tv2-balance-big">${esc(headline)}</p>
    <div class="tv2-secs">${covered}${offsets}${paid}${received}${!covered && !offsets && !paid && !received ? '<p class="tv2-meta">No shared costs between you yet.</p>' : ''}</div>
    ${open}${repay}`;

  const settlementId = uid();
  openSheet(html, (sheet) => {
    sheet.addEventListener('click', (e) => {
      const row = e.target.closest('[data-open-expense]');
      if (row) { const x = trip.expenses.find((i) => i.id === row.dataset.openExpense); if (x && !x.deletedAt) expenseSheet(trip, x); }
    });
    if (b.even) return;
    const input = sheet.querySelector('#tv2Repay'), coversEl = sheet.querySelector('[data-covers]'), hint = sheet.querySelector('.tv2-hint');
    const state = { mode: 'auto', manual: null };
    const others = trip; // the new repayment is not in the ledger yet
    const room = allocationRoom(trip, D);
    const eligible = b.covered.filter((r) => (room.get(r.expense.id) || 0) > 0);

    function amount() { return parseMoneyToCents(input.value); }
    function renderCovers() {
      const a = amount();
      hint.textContent = !a ? 'Enter the amount that was paid back' : a > b.owed ? `That is ${money(a - b.owed)} more than ${D === me() ? 'you owe' : 'is owed'}` : '';
      if (state.mode === 'none') { coversEl.innerHTML = '<p class="tv2-meta tv2-left-align">Not tied to specific expenses</p>'; return; }
      if (state.mode === 'auto') {
        const auto = autoAllocate(others, a || 0, D, C);
        coversEl.innerHTML = coversList(auto.allocations, auto.general, trip);
        return;
      }
      const chosen = state.manual.filter((m) => m.on);
      const sum = chosen.reduce((s, m) => s + (parseMoneyToCents(m.text) || 0), 0);
      coversEl.innerHTML = `<div class="tv2-pick">${state.manual.map((m, i) => `<label class="tv2-pick-row"><input type="checkbox" data-pick="${i}" ${m.on ? 'checked' : ''}><span>${esc(titleOf(m.expense))}<small>up to ${money(m.room)}</small></span><input class="tv2-pick-amt" data-pick-amt="${i}" inputmode="decimal" value="${esc(m.text)}" ${m.on ? '' : 'disabled'} aria-label="Amount toward ${esc(titleOf(m.expense))}"></label>`).join('')}
        <button type="button" class="tv2-textbtn" data-general>Don’t tie this to specific expenses</button></div>
        ${a && sum < a ? `<p class="tv2-meta tv2-left-align">${money(a - sum)} not tied to an expense</p>` : ''}`;
      if (a && sum > a) hint.textContent = 'The chosen amounts add up to more than the repayment';
      if (!chosen.length) hint.textContent = 'Choose at least one expense, or don’t tie it to expenses';
    }
    input.addEventListener('input', renderCovers);
    sheet.querySelector('[data-change-covers]').addEventListener('click', (e) => {
      const auto = autoAllocate(others, amount() || 0, D, C).allocations;
      state.mode = 'manual';
      state.manual = eligible.map((r) => {
        const pre = auto.find((x) => x.expenseId === r.expense.id);
        return { expense: r.expense, room: room.get(r.expense.id), on: !!pre, text: pre ? editable(pre.amount) : editable(room.get(r.expense.id)) };
      });
      e.target.hidden = true;
      renderCovers();
    });
    coversEl.addEventListener('change', (e) => {
      const i = e.target.dataset.pick; if (i === undefined) return;
      state.manual[i].on = e.target.checked; renderCovers();
    });
    coversEl.addEventListener('input', (e) => {
      const i = e.target.dataset.pickAmt; if (i === undefined) return;
      state.manual[i].text = e.target.value;
      const a = amount(); const sum = state.manual.filter((m) => m.on).reduce((s, m) => s + (parseMoneyToCents(m.text) || 0), 0);
      hint.textContent = a && sum > a ? 'The chosen amounts add up to more than the repayment' : '';
    });
    coversEl.addEventListener('click', (e) => { if (e.target.closest('[data-general]')) { state.mode = 'none'; renderCovers(); } });
    renderCovers();

    sheet.querySelector('[data-repay]').addEventListener('click', async (e) => {
      const a = amount();
      if (!a) { hint.textContent = 'Enter the amount that was paid back'; return; }
      const settlement = { id: settlementId, from: D, to: C, amount: a, date: localToday(), allocationMode: state.mode };
      if (state.mode === 'manual') {
        const chosen = state.manual.filter((m) => m.on).map((m) => ({ expenseId: m.expense.id, amount: parseMoneyToCents(m.text) }));
        if (!chosen.length || chosen.some((c) => !c.amount)) { hint.textContent = 'Check the amounts for the chosen expenses'; return; }
        settlement.allocations = chosen;
      }
      e.target.disabled = true;
      try {
        const r = await store.act('tripSettlementSave', { tripId: trip.id, settlement });
        closeSheet();
        snack(`Repayment of ${money(a)} recorded`, () => store.act('tripSettlementDelete', { tripId: trip.id, settlementId: r.settlement.id, rev: r.settlement.rev }));
      } catch (err) { hint.textContent = err?.message || 'Could not save'; e.target.disabled = false; }
    });
  });
}

function settlementSheet(trip, s) {
  const tied = s.allocations.reduce((sum, a) => sum + a.amount, 0);
  const html = `${sheetHead('Repayment')}
    <p class="tv2-balance-big">${esc(Who(s.from))} paid ${esc(who(s.to))} ${money(s.amount)}</p>
    <p class="tv2-meta">${esc(shortDate(s.date))} · recorded by ${esc(who(s.createdBy) || '—')}</p>
    ${s.allocations.length || s.amount - tied > 0 ? `<div class="tv2-covers-wrap"><span class="tv2-covers-label">Covered</span>${coversList(s.allocations, Math.max(0, s.amount - tied), trip)}</div>` : ''}
    <button type="button" class="tv2-danger-link" data-delete>Remove this repayment</button>`;
  openSheet(html, (sheet) => {
    sheet.querySelector('[data-delete]').onclick = async () => {
      try {
        const r = await store.act('tripSettlementDelete', { tripId: trip.id, settlementId: s.id, rev: s.rev });
        closeSheet();
        snack('Repayment removed', () => store.act('tripSettlementRestore', { tripId: trip.id, settlementId: r.settlement.id, rev: r.settlement.rev }));
      } catch (err) {
        snack(err?.message || 'Could not remove');
        if (/just changed/i.test(err?.message || '')) { closeSheet(); store.refresh(); }
      }
    };
  });
}

// ---------------------------------------------------------------- events

function onClick(e) {
  const b = e.target.closest('[data-act]'); if (!b || !root.contains(b)) return;
  const trip = view.name === 'trip' ? store.tripById(view.tripId) : null;
  switch (b.dataset.act) {
    case 'retry': store.refresh(); break;
    case 'home': userLeftTrip = true; setView({ name: 'home' }); break;
    case 'open-trip': setView({ name: 'trip', tripId: b.dataset.id }); break;
    case 'new-trip': tripSheet(); break;
    case 'edit-trip': if (trip) tripSheet(trip); break;
    case 'add-expense': if (trip) expenseSheet(trip); break;
    case 'edit-expense': { const x = trip?.expenses.find((i) => i.id === b.dataset.id); if (x) expenseSheet(trip, x); break; }
    case 'edit-settlement': { const x = trip?.settlements.find((i) => i.id === b.dataset.id); if (x) settlementSheet(trip, x); break; }
    case 'budgets': if (trip) budgetSheet(trip); break;
    case 'balance': if (trip) balanceSheet(trip); break;
    default: break;
  }
}

export function mount(element) {
  root = element;
  root.classList.add('tv2-root');
  root.addEventListener('click', onClick);
  store.subscribe(render);
  store.start(() => root.classList.contains('active') || root.offsetParent !== null);
  render();
}
