// Current Trip overview: a simple shared category table with drill-down
// editing for individual trip expenses. Existing/legacy trip totals stay
// visible while new log-as-you-go expenses use the shared expenseEntries
// collection on each budget plan.
import { fmtDate } from '../lib/format.js';

const names = ['Principessa', 'Principe'];
const legacyKeys = ['travel', 'accom', 'fuel', 'groceries', 'eat', 'tolls', 'other'];
const legacyLabels = { travel: 'Flights / Train', accom: 'Accommodation', fuel: 'Fuel', groceries: 'House groceries', eat: 'Food / eating out', tolls: 'Parking / Tolls', other: 'Other' };
const rows = [
  { key: 'accommodation', label: 'Accommodation', category: 'accommodation', legacy: ['accom'] },
  { key: 'transport', label: 'Transport', category: 'transport', legacy: ['travel', 'fuel', 'tolls'], subtypes: [['flights-trains', 'Flights / Trains'], ['fuel', 'Fuel'], ['parking-tolls', 'Parking / Tolls'], ['other', 'Other']] },
  { key: 'groceries', label: 'Groceries', category: 'food', legacy: ['groceries', 'eat'], subtypes: [['eating-out', 'Food / eating out'], ['groceries', 'House groceries'], ['other', 'Other']] },
  { key: 'activities', label: 'Activities', category: 'activities', legacy: [] },
  { key: 'other', label: 'Other', category: 'other', legacy: ['other'], customName: true },
];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = (v) => v !== '' && v != null;
const n = (v) => Number(String(v ?? 0).replace(',', '.')) || 0;
const money = (v) => '€' + n(v).toFixed(2);
const today = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); };

let latest = null, dialog = null, opened = null, refreshing = false, lastRefresh = 0, busy = false;

function rowByKey(key) { return rows.find((row) => row.key === key) || null; }
function records(plan, trip) { return names.map((name) => trip?.submissions?.[name] || plan?.partials?.[name] || {}); }
function entries(plan) { return Array.isArray(plan?.expenseEntries) ? plan.expenseEntries : []; }
function rowEntries(plan, row) { return entries(plan).filter((entry) => entry?.category === row.category); }
function sharedFor(plan, trip, key) { return plan?.sharedExpenses?.[key] || trip?.sharedExpenses?.[key] || null; }

function legacyPaid(plan, trip, row, name) {
  const record = trip?.submissions?.[name] || plan?.partials?.[name] || {};
  return row.legacy.reduce((sum, key) => {
    const shared = sharedFor(plan, trip, key);
    if (has(shared?.paid?.[name])) return sum + n(shared.paid[name]);
    return sum + (has(record?.[key]) ? n(record[key]) : 0);
  }, 0);
}

function entryPaid(entry, name) {
  const remaining = Math.max(0, n(entry?.amount) - n(entry?.jarContribution));
  if (entry?.paidBy === 'both') return remaining / 2;
  return entry?.paidBy === name ? remaining : 0;
}

function rowPaid(plan, trip, row, name) {
  return legacyPaid(plan, trip, row, name) + rowEntries(plan, row).reduce((sum, entry) => sum + entryPaid(entry, name), 0);
}

function rowTotal(plan, trip, row) {
  const [a, b] = records(plan, trip);
  const legacy = row.legacy.reduce((sum, key) => {
    const shared = sharedFor(plan, trip, key);
    return sum + (has(shared?.total) ? n(shared.total) : Math.max(n(a?.[key]), n(b?.[key])));
  }, 0);
  return legacy + rowEntries(plan, row).reduce((sum, entry) => sum + n(entry?.amount), 0);
}

function legacyTotal(plan, trip) {
  const [a, b] = records(plan, trip);
  return legacyKeys.reduce((sum, key) => {
    const shared = sharedFor(plan, trip, key);
    return sum + (has(shared?.total) ? n(shared.total) : Math.max(n(a?.[key]), n(b?.[key])));
  }, 0);
}

function total(plan, trip) {
  return legacyTotal(plan, trip) + entries(plan).reduce((sum, entry) => sum + n(entry?.amount), 0);
}

function metrics(plan, trip) {
  return '<div class="overview-metrics">' +
    names.map((name) => '<div><span>' + name + ' budget</span><strong>' + (has(plan?.budgets?.[name]) ? money(plan.budgets[name]) : 'Not set') + '</strong></div>').join('') +
    '<div><span>Total budget</span><strong>' + (names.some((name) => has(plan?.budgets?.[name])) ? money(names.reduce((sum, name) => sum + n(plan.budgets[name]), 0)) : has(trip?.budget) ? money(trip.budget) : 'Not set') + '</strong></div>' +
    '<div><span>Trip so far</span><strong>' + money(total(plan, trip)) + '</strong></div></div>';
}

function warnings(plan, trip) {
  const result = [];
  for (const key of ['accom', 'travel']) {
    const shared = sharedFor(plan, trip, key);
    if (!shared?.mode || !names.some((name) => shared.mode[name])) continue;
    if (names.every((name) => has(shared.totals?.[name])) && Math.abs(n(shared.totals.Principessa) - n(shared.totals.Principe)) > 0.005) result.push((legacyLabels[key] || key) + ': different totals are still saved.');
  }
  return result;
}

function rowMatch(plan, trip, row) {
  const [a, b] = records(plan, trip);
  let sawLegacy = false, incomplete = false, conflict = false;
  for (const key of row.legacy) {
    const av = a?.[key], bv = b?.[key], ah = has(av), bh = has(bv);
    const shared = sharedFor(plan, trip, key);
    if (ah || bh || shared) sawLegacy = true;
    if (ah !== bh) incomplete = true;
    if (ah && bh && Math.abs(n(av) - n(bv)) > 0.005) conflict = true;
    if (names.some((name) => has(shared?.totals?.[name]))) {
      const ph = has(shared?.totals?.Principessa), qh = has(shared?.totals?.Principe);
      if (ph !== qh) incomplete = true;
      if (ph && qh && Math.abs(n(shared.totals.Principessa) - n(shared.totals.Principe)) > 0.005) conflict = true;
    }
  }
  if (conflict) return { cls: 'different', symbol: '×', text: 'Different' };
  if (incomplete) return { cls: 'waiting', symbol: '~', text: 'Incomplete' };
  if (rowEntries(plan, row).length || sawLegacy) return { cls: 'matched', symbol: '✓', text: 'Matched' };
  return { cls: 'waiting', symbol: '~', text: 'Incomplete' };
}

function matchCell(status) {
  return '<span class="overview-match ' + status.cls + '"><i>' + status.symbol + '</i>' + status.text + '</span>';
}

function close() { dialog?.remove(); dialog = null; opened = null; }
export function open(plan) { if (!plan) return; opened = plan.id; draw(plan); }

function hero(plan, trip) {
  const locked = names.every((name) => trip?.confirmed?.[name]);
  const country = plan.meta?.location === 'Other' ? (plan.meta?.otherLocation || 'Trip') : (plan.meta?.location || 'Trip');
  return '<header class="overview-hero"><div class="overview-title-row"><div class="overview-title-copy"><span class="overview-country">' + esc(country) + '</span><h2>' + esc(plan.meta?.city || 'Current trip') + '</h2><p>' + fmtDate(plan.meta?.start) + ' – ' + fmtDate(plan.meta?.end) + '</p></div><span class="overview-status-pill ' + (locked ? 'confirmed' : '') + '">' + (locked ? 'Confirmed' : 'In progress') + '</span></div>' + metrics(plan, trip) + '</header>';
}

function draw(plan) {
  dialog?.remove();
  dialog = document.createElement('dialog');
  dialog.className = 'current-overview';
  const trip = latest?.trips?.find((item) => item.id === plan.linkedTripId);
  dialog.innerHTML = '<button class="trip-close" data-overview-close aria-label="Close overview">×</button><div class="overview-shell">' + hero(plan, trip) +
    '<div class="overview-scroll"><div class="overview-simple-table"><table><thead><tr><th>Expenses</th><th>Principessa</th><th>Principe</th><th>Match</th></tr></thead><tbody>' +
    rows.map((row) => '<tr><th><button type="button" class="overview-category-btn" data-category="' + row.key + '">' + esc(row.label) + '<span>›</span></button></th><td>' + money(rowPaid(plan, trip, row, 'Principessa')) + '</td><td>' + money(rowPaid(plan, trip, row, 'Principe')) + '</td><td>' + matchCell(rowMatch(plan, trip, row)) + '</td></tr>').join('') +
    '</tbody></table></div><p class="overview-table-hint">Select a category to view, add or edit its expenses.</p></div></div>';
  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.addEventListener('cancel', close);
  dialog.querySelector('[data-overview-close]').onclick = close;
  dialog.querySelectorAll('[data-category]').forEach((button) => button.onclick = () => drawCategory(plan, button.dataset.category));
}

function subtypeLabel(row, entry) {
  if (!row?.subtypes?.length) return row?.label || 'Expense';
  const value = row.category === 'transport' ? entry?.transportType : entry?.foodType;
  const normalized = value === 'tolls' ? 'parking-tolls' : value;
  return row.subtypes.find(([key]) => key === normalized)?.[1] || row.label;
}

function entryTitle(row, entry) {
  return entry?.name || subtypeLabel(row, entry) || entry?.note || row.label;
}

function entryMeta(row, entry) {
  const paid = entry?.paidBy === 'both' ? 'Both paid' : 'Paid by ' + (entry?.paidBy || '—');
  const split = entry?.split === 'personal' ? 'Personal · ' + (entry?.forActor || entry?.paidBy || '—') : 'Shared 50/50';
  const parts = [subtypeLabel(row, entry), paid, split, fmtDate(entry?.date)];
  if (entry?.uncertain) parts.push('estimate');
  if (entry?.jarContribution) parts.push('Jar ' + money(entry.jarContribution));
  return parts.filter(Boolean).join(' · ');
}

function categoryEntriesHtml(plan, row) {
  const list = rowEntries(plan, row);
  if (!list.length) return '<div class="overview-category-empty"><strong>Nothing logged here yet.</strong><span>Your next saved expense will appear here.</span></div>';
  return '<div class="overview-category-list">' + list.slice().reverse().map((entry) =>
    '<div class="overview-category-entry"><button type="button" class="overview-entry-main" data-entry-edit="' + esc(entry.id) + '"><span><strong>' + esc(entryTitle(row, entry)) + '</strong><small>' + esc(entryMeta(row, entry)) + '</small></span><b>' + money(entry.amount) + '</b></button><button type="button" class="overview-entry-delete" data-entry-delete="' + esc(entry.id) + '">Delete</button></div>'
  ).join('') + '</div>';
}

function blankDraft(row, subtype = '') {
  return { id: '', category: row.category, foodType: row.category === 'food' ? subtype : '', transportType: row.category === 'transport' ? subtype : '', name: '', amount: '', paidBy: document.body.dataset.actor || 'Principessa', split: 'shared', forActor: document.body.dataset.actor || 'Principessa', date: today(), note: '', uncertain: false, useJar: false, showMore: false };
}

function draftFromEntry(entry) {
  return {
    ...entry,
    name: entry?.name || '',
    foodType: entry?.foodType || '',
    transportType: entry?.transportType === 'tolls' ? 'parking-tolls' : (entry?.transportType || ''),
    amount: String(entry?.amount ?? ''),
    date: entry?.date || today(),
    note: entry?.note || '',
    showMore: !!(entry?.note || entry?.uncertain || (entry?.date && entry.date !== today())),
  };
}

function formSubtype(row, draft) {
  if (!row.subtypes?.length) return '';
  const current = row.category === 'transport' ? draft.transportType : draft.foodType;
  return '<fieldset><legend>' + esc(row.label) + ' type</legend><div class="overview-form-chips">' + row.subtypes.map(([key, label]) => '<button type="button" class="' + (current === key || (current === 'tolls' && key === 'parking-tolls') ? 'active' : '') + '" data-form-subtype="' + key + '">' + esc(label) + '</button>').join('') + '</div></fieldset>';
}

function categoryFormHtml(plan, row, draft, entry) {
  const available = n(latest?.sharedJar?.balance) + n(entry?.jarContribution);
  const jar = draft.useJar && row.category === 'accommodation' ? n(draft.amount) * .2 : 0;
  const needsName = row.customName || draft.foodType === 'other' || draft.transportType === 'other';
  return '<div class="overview-expense-form">' +
    formSubtype(row, draft) +
    (needsName ? '<label>Expense name<input id="overviewExpenseName" value="' + esc(draft.name || '') + '" placeholder="Write your own"></label>' : '') +
    '<label>Amount<div class="overview-money-input"><span>€</span><input id="overviewExpenseAmount" inputmode="decimal" value="' + esc(draft.amount || '') + '" placeholder="0.00"></div></label>' +
    '<fieldset><legend>Who paid?</legend><div class="overview-form-chips">' + names.concat('both').map((value) => '<button type="button" class="' + (draft.paidBy === value ? 'active' : '') + '" data-form-payer="' + value + '">' + (value === 'both' ? 'Both' : value) + '</button>').join('') + '</div></fieldset>' +
    '<fieldset><legend>How should we count it?</legend><div class="overview-form-chips"><button type="button" class="' + (draft.split === 'shared' ? 'active' : '') + '" data-form-split="shared">Shared 50/50</button><button type="button" class="' + (draft.split === 'personal' ? 'active' : '') + '" data-form-split="personal">Personal</button></div></fieldset>' +
    (draft.split === 'personal' ? '<fieldset><legend>Personal expense for</legend><div class="overview-form-chips">' + names.map((value) => '<button type="button" class="' + (draft.forActor === value ? 'active' : '') + '" data-form-owner="' + value + '">' + value + '</button>').join('') + '</div></fieldset>' : '') +
    (row.category === 'accommodation' ? '<button type="button" class="overview-jar-toggle ' + (draft.useJar ? 'active' : '') + '" data-form-jar><span><strong>Use 20% from Shared Jar</strong><small>Accommodation only · ' + money(available) + ' available</small></span><b>' + (draft.useJar ? money(jar) + ' from Jar' : 'Off') + '</b></button>' : '') +
    '<button type="button" class="overview-more" data-form-more aria-expanded="' + (draft.showMore ? 'true' : 'false') + '"><span>' + (draft.showMore ? '⌃' : '⌄') + '</span> More options</button>' +
    '<div class="overview-more-fields ' + (draft.showMore ? '' : 'hidden') + '"><label>Date<input id="overviewExpenseDate" type="date" value="' + esc(draft.date || today()) + '"></label><label>Note <small>optional</small><input id="overviewExpenseNote" value="' + esc(draft.note || '') + '" placeholder="Add a note"></label><label class="overview-estimate"><input id="overviewExpenseEstimate" type="checkbox" ' + (draft.uncertain ? 'checked' : '') + '><span>This amount is an estimate</span></label></div>' +
    '<div class="overview-form-actions">' + (draft.id ? '<button type="button" class="btn ghost" data-form-cancel>Cancel edit</button>' : '') + '<button type="button" class="btn primary" data-form-save>' + (draft.id ? 'Save changes' : 'Save expense') + '</button></div><p data-overview-error class="overview-form-error" role="status"></p></div>';
}

function historyHtml(plan, row, expanded) {
  const list = rowEntries(plan, row);
  const currentTotal = list.reduce((sum, entry) => sum + n(entry?.amount), 0);
  if (!list.length) return '<aside class="overview-history-panel"><div class="overview-history-title"><span>Logged expenses</span><strong>Nothing yet</strong></div><p>Add an expense on the left and it will appear here.</p></aside>';
  return '<aside class="overview-history-panel"><button type="button" class="overview-history-summary" data-history-open><span><small>Logged expenses</small><strong>' + list.length + (list.length === 1 ? ' expense' : ' expenses') + '</strong></span><b>' + money(currentTotal) + '</b><i>' + (list.length === 1 ? 'Edit' : (expanded ? 'Hide' : 'View')) + ' →</i></button>' +
    (expanded && list.length > 1 ? categoryEntriesHtml(plan, row) : '') + '</aside>';
}

function categorySummaryHtml(plan, trip, row) {
  return '<div class="overview-category-totals"><div><span>Category total</span><strong>' + money(rowTotal(plan, trip, row)) + '</strong></div><div><span>Principessa paid</span><strong>' + money(rowPaid(plan, trip, row, 'Principessa')) + '</strong></div><div><span>Principe paid</span><strong>' + money(rowPaid(plan, trip, row, 'Principe')) + '</strong></div></div>';
}

function drawCategory(plan, key, editId = '', expandedHistory = false) {
  const row = rowByKey(key); if (!row || !dialog) return;
  const selected = editId ? entries(plan).find((item) => item.id === editId) || null : null;
  let draft = selected ? draftFromEntry(selected) : blankDraft(row);
  let expanded = expandedHistory;

  const render = () => {
    const trip = latest?.trips?.find((item) => item.id === plan.linkedTripId);
    const currentEntry = draft.id ? entries(plan).find((item) => item.id === draft.id) || selected : null;
    dialog.innerHTML = '<button class="trip-close" data-overview-close aria-label="Close overview">×</button><div class="overview-shell">' + hero(plan, trip) +
      '<div class="overview-scroll"><button type="button" class="overview-back" data-category-back>← Back to expenses</button><div class="overview-category-head"><div><span class="panel-kicker">EXPENSES</span><h3>' + esc(row.label) + '</h3><p>' + (draft.id ? 'Editing a logged expense.' : 'Log a new expense and the category total updates automatically.') + '</p></div>' + matchCell(rowMatch(plan, trip, row)) + '</div>' +
      categorySummaryHtml(plan, trip, row) +
      '<div class="overview-category-layout"><section class="overview-quick-log"><div class="overview-quick-log-head"><span>' + (draft.id ? 'EDIT EXPENSE' : 'QUICK LOG') + '</span><strong>' + (draft.id ? esc(entryTitle(row, currentEntry || draft)) : 'Add to ' + esc(row.label)) + '</strong></div>' + categoryFormHtml(plan, row, draft, currentEntry) + '</section>' +
      historyHtml(plan, row, expanded) + '</div></div></div>';

    dialog.querySelector('[data-overview-close]').onclick = close;
    dialog.querySelector('[data-category-back]').onclick = () => draw(plan);
    const amount = dialog.querySelector('#overviewExpenseAmount');
    amount?.addEventListener('input', (event) => { draft.amount = event.target.value; });
    dialog.querySelector('#overviewExpenseName')?.addEventListener('input', (event) => { draft.name = event.target.value; });
    dialog.querySelector('#overviewExpenseDate')?.addEventListener('input', (event) => { draft.date = event.target.value; });
    dialog.querySelector('#overviewExpenseNote')?.addEventListener('input', (event) => { draft.note = event.target.value; });
    dialog.querySelector('#overviewExpenseEstimate')?.addEventListener('change', (event) => { draft.uncertain = event.target.checked; });

    dialog.querySelectorAll('[data-form-subtype]').forEach((button) => button.onclick = () => {
      if (row.category === 'transport') draft.transportType = button.dataset.formSubtype;
      else draft.foodType = button.dataset.formSubtype;
      render();
    });
    dialog.querySelectorAll('[data-form-payer]').forEach((button) => button.onclick = () => {
      draft.paidBy = button.dataset.formPayer;
      if (draft.paidBy === 'both' && draft.split === 'personal') draft.split = 'shared';
      render();
    });
    dialog.querySelectorAll('[data-form-split]').forEach((button) => button.onclick = () => {
      draft.split = button.dataset.formSplit;
      if (draft.split === 'personal' && draft.paidBy === 'both') draft.paidBy = document.body.dataset.actor || 'Principessa';
      render();
    });
    dialog.querySelectorAll('[data-form-owner]').forEach((button) => button.onclick = () => { draft.forActor = button.dataset.formOwner; render(); });
    dialog.querySelector('[data-form-jar]')?.addEventListener('click', () => { draft.useJar = !draft.useJar; render(); });
    dialog.querySelector('[data-form-more]').onclick = () => { draft.showMore = !draft.showMore; render(); };
    dialog.querySelector('[data-form-cancel]')?.addEventListener('click', () => { draft = blankDraft(row); render(); });
    dialog.querySelector('[data-form-save]').onclick = () => saveEntry(plan, row, draft);

    const historyButton = dialog.querySelector('[data-history-open]');
    if (historyButton) historyButton.onclick = () => {
      const list = rowEntries(plan, row);
      if (list.length === 1) {
        draft = draftFromEntry(list[0]);
        expanded = false;
        render();
      } else {
        expanded = !expanded;
        render();
      }
    };
    dialog.querySelectorAll('[data-entry-edit]').forEach((button) => button.onclick = () => {
      const entry = entries(plan).find((item) => item.id === button.dataset.entryEdit);
      if (!entry) return;
      draft = draftFromEntry(entry);
      render();
    });
    dialog.querySelectorAll('[data-entry-delete]').forEach((button) => button.onclick = () => deleteEntry(plan, row, button));
    if (!draft.id && row.subtypes?.length === 0) setTimeout(() => amount?.focus(), 0);
  };

  render();
}

async function saveEntry(plan, row, draft) {
  if (busy) return;
  const error = dialog?.querySelector('[data-overview-error]');
  const amount = Number(String(draft.amount || '').replace(',', '.'));
  const subtype = row.category === 'transport' ? draft.transportType : row.category === 'food' ? draft.foodType : '';
  const needsName = row.customName || subtype === 'other';
  if (row.subtypes?.length && !subtype) { if (error) error.textContent = 'Choose a type first.'; return; }
  if (needsName && !String(draft.name || '').trim()) { if (error) error.textContent = 'Add the expense name first.'; return; }
  if (!Number.isFinite(amount) || amount <= 0) { if (error) error.textContent = 'Enter a valid amount.'; return; }

  busy = true;
  try {
    await window.TwogetherAPI.post('saveTripExpense', {
      planId: plan.id,
      expense: {
        id: draft.id || '',
        category: row.category,
        foodType: row.category === 'food' ? draft.foodType : '',
        transportType: row.category === 'transport' ? draft.transportType : '',
        name: String(draft.name || '').trim(),
        amount,
        paidBy: draft.paidBy,
        split: draft.split,
        forActor: draft.split === 'personal' ? draft.forActor : '',
        date: draft.date || today(),
        note: draft.note || '',
        uncertain: !!draft.uncertain,
        useJar: row.category === 'accommodation' && !!draft.useJar,
      },
    }, document.body.dataset.actor);
    await refresh(true);
    const updated = latest?.plans?.find((item) => item.id === plan.id) || plan;
    drawCategory(updated, row.key);
  } catch (err) {
    if (error) error.textContent = err.message || 'Could not save expense.';
  } finally {
    busy = false;
  }
}

async function deleteEntry(plan, row, button) {
  if (busy) return;
  if (button.dataset.sure !== '1') {
    button.dataset.sure = '1'; button.textContent = 'Delete?';
    setTimeout(() => { if (button.isConnected) { button.dataset.sure = ''; button.textContent = 'Delete'; } }, 1800);
    return;
  }
  busy = true;
  try {
    await window.TwogetherAPI.post('deleteTripExpense', { planId: plan.id, expenseId: button.dataset.entryDelete }, document.body.dataset.actor);
    await refresh(true);
    const updated = latest?.plans?.find((item) => item.id === plan.id) || plan;
    drawCategory(updated, row.key);
  } catch (err) {
    const error = dialog?.querySelector('[data-overview-error]');
    if (error) error.textContent = err.message || 'Could not remove expense.';
  } finally {
    busy = false;
  }
}

export async function refresh(force = false) {
  const now = Date.now();
  if (refreshing || (!force && latest && now - lastRefresh < 10000)) return latest;
  refreshing = true;
  try { latest = await window.TwogetherAPI.state(); lastRefresh = Date.now(); return latest; }
  catch { return latest; } finally { refreshing = false; }
}
export { total, warnings, metrics };

function bindEnterSubmit() {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.key !== 'Enter' || e.isComposing || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || !e.target.matches('input,select')) return;
    const root = e.target.closest('.shared-entry,#wizardCard,#workflowV5Overlay,#workflowBudgetModal,.current-overview');
    if (!root) return;
    const target = [...root.querySelectorAll('[data-next],[data-save],[data-wizard-next],[data-v5-next],[data-v5-partial-next],[data-v5-match-next],[data-form-save],button')].find((button) => !button.disabled && button.getClientRects().length && /^(Next|Continue|Save)/i.test(button.textContent.trim()));
    if (target) { e.preventDefault(); e.stopImmediatePropagation(); target.click(); }
  }, true);
}

function backgroundRefresh() { if (document.visibilityState === 'visible') refresh(false); }

export function initOverviewDialog() {
  bindEnterSubmit();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(true); });
  window.addEventListener('focus', () => refresh(false));
  document.addEventListener('twogether:saved', () => { refresh(true); window.TwogetherWorkflow.refresh().catch(() => {}); });
  window.TwogetherOverview = { open, total, warnings, metrics, refresh };
  document.addEventListener('DOMContentLoaded', () => {
    refresh(true);
    setInterval(backgroundRefresh, 30000);
  });
}
