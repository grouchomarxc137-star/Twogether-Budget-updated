// Planner-vs-Actual monthly budget tool, additive to finances.js's own
// month tracker -- both render into the same "Monthly finances" view side
// by side (confirmed by running both: this is not a replacement, the two
// features coexist). Extracted from v33.js.
import { $, $$ } from '../lib/dom.js';
import { esc, n as num, money, uid } from '../lib/format.js';
import { actor } from '../lib/session.js';
import { toast } from '../lib/toast.js';
import { financeRecord, profile, currentState } from './planner-state.js';

const MONTHS = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
let plannerMonth = '2026-09';

function baseRow(name, planner = '', actual = '', group = 'other', notes = '', kind = 'expense', frequency = 'monthly', paymentTiming = '') {
  return { id: uid(), name, planner, actual, group, notes, kind, frequency, paymentTiming, reserveMonthly: frequency === 'yearly' && paymentTiming === 'later' && planner !== '' ? Math.round(num(planner) / 12 * 100) / 100 : '' };
}
function principeDefaults() {
  return [
    baseRow('Salary', '', '', 'other', 'Usually €1.350–€1.600', 'income', 'monthly'),
    baseRow('Mandatory savings', '', '', 'savings', 'Move planned savings aside when possible', 'expense', 'monthly'),
    baseRow('Rent', 575, '', 'rent', '', 'expense', 'monthly'), baseRow('Ryanair part 3', 47.58, '', 'other', '', 'expense', 'monthly'),
    baseRow('Iliad', 9.99, '', 'subscriptions', 'Around the 2nd', 'expense', 'monthly'), baseRow('Spotify', 16.99, '', 'subscriptions', 'Around the 22nd', 'expense', 'monthly'),
    baseRow('ChatGPT Plus', 23, '', 'subscriptions', 'Around the 9th', 'expense', 'monthly'), baseRow('Railway Hosting', 5, '', 'subscriptions', 'Around the 27th', 'expense', 'monthly'),
    baseRow('Claude', 21.96, '', 'subscriptions', 'Around the 22nd', 'expense', 'monthly'), baseRow('Amazon Prime', 1.99, '', 'subscriptions', '', 'expense', 'monthly'),
    baseRow('OneDrive', '', '', 'subscriptions', 'Paid yearly', 'expense', 'yearly', 'later'), baseRow('Loverzz', '', '', 'subscriptions', 'Paid yearly', 'expense', 'yearly', 'later'),
    baseRow('Fuel', 300, '', 'transport', '', 'expense', 'monthly'), baseRow('Groceries', 17.33, '', 'groceries', '', 'expense', 'monthly'), baseRow('Personal', 100, '', 'other', '', 'expense', 'monthly'),
    baseRow('Airbnb', 142, '', 'other', '', 'expense', 'one-time'), baseRow('Flights', '', '', 'transport', '', 'expense', 'one-time'), baseRow('P&P expenses', '', '', 'other', '', 'expense', 'one-time'),
  ];
}
function requiredBudgetRows() { return ['Flights', 'P&P expenses', 'Airbnb']; }
function previousPlanning(month) {
  const list = currentState()?.finances?.[actor()] || [];
  return [...list].filter((r) => r.month < month && r.planning?.items?.length).sort((a, b) => b.month.localeCompare(a.month))[0]?.planning || null;
}
function migrateRecordToPlanning(rec) {
  if (!rec) return [];
  const rows = [];
  (rec.incomes || []).forEach((x) => rows.push(baseRow(x.name, x.amount, x.amount, 'other', 'Migrated from the existing month', 'income', 'monthly')));
  (rec.expenses || []).forEach((x) => { if (String(x.name || '').toLowerCase() === 'extra' && x.group === 'extra') return; rows.push(baseRow(x.name, x.amount, x.amount, x.group || 'other', 'Migrated from the existing month', 'expense', 'monthly')); });
  return rows;
}
function initialPlanning(month) {
  const rec = financeRecord(month); if (rec?.planning?.items?.length) return JSON.parse(JSON.stringify(rec.planning));
  let items = actor() === 'Principe' ? principeDefaults() : migrateRecordToPlanning(rec);
  const prior = previousPlanning(month);
  if (prior?.items?.length) {
    const carry = prior.items.filter((x) => x.frequency === 'monthly' || (x.frequency === 'yearly' && x.paymentTiming === 'later')).map((x) => ({ ...x, id: uid(), actual: '', reserveMonthly: x.frequency === 'yearly' && x.paymentTiming === 'later' && x.planner !== '' ? Math.round(num(x.planner) / 12 * 100) / 100 : '' }));
    if (carry.length) items = carry;
  }
  const names = new Set(items.map((x) => String(x.name).toLowerCase()));
  requiredBudgetRows().forEach((name) => { if (!names.has(name.toLowerCase())) items.push(baseRow(name, '', '', 'other', '', 'expense', 'one-time')); });
  const opening = rec?.planning?.openingSavings ?? profile().savingsTotal ?? '';
  return { items, openingSavings: opening, updatedAt: '' };
}
function expenseCategory(item) {
  const n = String(item.name || '').toLowerCase();
  if (item.kind === 'income') return 'Income';
  if (n === 'rent' || /ryanair part/.test(n)) return 'Fixed expenses';
  if (item.group === 'subscriptions') return 'Subscriptions';
  if (['fuel', 'groceries', 'personal', 'airbnb', 'flights', 'p&p expenses'].includes(n)) return 'Variable expenses';
  if (item.frequency === 'yearly') return 'Yearly expenses';
  return 'Other';
}
function monthlyPlanned(item) {
  if (item.kind === 'income') return num(item.planner);
  if (item.frequency === 'yearly' && item.paymentTiming === 'later') return num(item.reserveMonthly);
  return num(item.planner);
}
function planningSummary(planning) {
  const items = planning.items || [];
  const plannedIncome = items.filter((x) => x.kind === 'income').reduce((s, x) => s + num(x.planner), 0);
  const actualIncome = items.filter((x) => x.kind === 'income').reduce((s, x) => s + num(x.actual), 0);
  const plannedOut = items.filter((x) => x.kind !== 'income').reduce((s, x) => s + monthlyPlanned(x), 0);
  const actualOut = items.filter((x) => x.kind !== 'income').reduce((s, x) => s + num(x.actual), 0);
  const saved = actualIncome - actualOut, opening = num(planning.openingSavings), after = opening + saved;
  return { plannedIncome, actualIncome, plannedOut, actualOut, saved, opening, after, diff: plannedOut - actualOut };
}

export function renderPlanner() {
  const view = $('[data-fin-view="monthly"]'); if (!view) return;
  let root = $('#v33FinancePlanner', view);
  if (!root) { root = document.createElement('section'); root.id = 'v33FinancePlanner'; root.className = 'v33-planner'; view.appendChild(root); }
  if (!actor()) { root.innerHTML = ''; return; }
  const activeActor = actor();
  let planning = root._planning && root.dataset.month === plannerMonth && root.dataset.actor === activeActor ? root._planning : initialPlanning(plannerMonth);
  root._planning = planning; root.dataset.month = plannerMonth; root.dataset.actor = activeActor;
  const finalized = !!financeRecord(plannerMonth)?.finalized;
  const grouped = {}; planning.items.forEach((x) => (grouped[expenseCategory(x)] || (grouped[expenseCategory(x)] = [])).push(x));
  const order = ['Income', 'Fixed expenses', 'Subscriptions', 'Variable expenses', 'Yearly expenses', 'Other'];
  const rows = order.filter((k) => grouped[k]?.length).map((cat) => `<tr class="v33-cat"><th colspan="5">${esc(cat)}</th></tr>` + grouped[cat].map((item) => {
    const reserve = item.frequency === 'yearly' && item.paymentTiming === 'later' && item.planner !== '' ? `<small class="v33-reserve">Reserve ${money(num(item.planner) / 12)}/month</small>` : '';
    const custom = !!item.custom;
    return `<tr data-plan-row="${esc(item.id)}"><td><strong>${esc(item.name)}</strong>${reserve}${custom ? '<button type="button" class="v33-remove-row" data-remove-row aria-label="Remove expense">×</button>' : ''}</td><td><input data-field="planner" inputmode="decimal" value="${esc(item.planner ?? '')}" ${finalized ? 'disabled' : ''}></td><td><input data-field="actual" inputmode="decimal" value="${esc(item.actual ?? '')}" ${(finalized || (item.frequency === 'yearly' && item.paymentTiming === 'later')) ? 'disabled' : ''}></td><td><span>${esc(item.notes || '')}</span>${item.frequency !== 'monthly' ? `<small>${item.frequency === 'yearly' ? 'Yearly' : 'One-time'}${item.frequency === 'yearly' && item.paymentTiming === 'later' ? ' · due later' : ''}</small>` : ''}</td><td>${custom ? '<span class="v33-custom-mark">Custom</span>' : ''}</td></tr>`;
  }).join('')).join('');
  const s = planningSummary(planning), status = finalized ? 'Month closed — Actual is final.' : 'Actual is the amount paid so far. It stays ongoing until you confirm/close the month.';
  root.innerHTML = `<div class="v33-planner-head"><div><span class="panel-kicker">PLANNER VS ACTUAL</span><h2>${esc(actor())}’s monthly plan</h2><p>${status}</p></div><label>Month<select id="v33PlannerMonth">${MONTHS.map((m) => `<option value="${m}" ${m === plannerMonth ? 'selected' : ''}>${m}</option>`).join('')}</select></label></div>
    <div class="v33-opening"><label>Savings before month <div class="finance-money mini"><span>€</span><input id="v33OpeningSavings" inputmode="decimal" value="${esc(planning.openingSavings ?? '')}" ${finalized ? 'disabled' : ''}></div></label><p>Planner is your adjustable budget. Actual is only what has really been paid so far.</p></div>
    <div class="v33-plan-table-wrap"><table class="v33-plan-table"><thead><tr><th>Category</th><th>Planner</th><th>Actual</th><th>Notes</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="v33-plan-actions"><button type="button" class="btn ghost" id="v33AddExpense" ${finalized ? 'disabled' : ''}>+ Extra expense?</button><button type="button" class="btn primary" id="v33SavePlanning" ${finalized ? 'disabled' : ''}>Save planner / actual</button></div>
    <div id="v33ExtraForm" class="v33-extra-form hidden"></div>
    <div class="v33-month-summary"><h3>Monthly summary</h3><div><span>Savings before month</span><strong>${money(s.opening)}</strong></div><div><span>Planned income</span><strong>${money(s.plannedIncome)}</strong></div><div><span>Actual income so far</span><strong>${money(s.actualIncome)}</strong></div><div><span>Planned monthly outflow</span><strong>${money(s.plannedOut)}</strong></div><div><span>Actual expenses so far</span><strong>${money(s.actualOut)}</strong></div><div><span>Saved / left so far</span><strong class="${s.saved < 0 ? 'negative' : ''}">${money(s.saved)}</strong></div><div><span>Savings after month (so far)</span><strong>${money(s.after)}</strong></div><div><span>Against planner</span><strong class="${s.diff >= 0 ? 'positive' : 'negative'}">${s.diff >= 0 ? 'Under' : 'Over'} ${money(Math.abs(s.diff))}</strong></div></div>`;
  bindPlanner(root, finalized);
}
function readPlannerInputs(root) {
  const p = root._planning; if (!p) return;
  p.openingSavings = $('#v33OpeningSavings', root)?.value ?? '';
  $$('[data-plan-row]', root).forEach((tr) => {
    const item = p.items.find((x) => x.id === tr.dataset.planRow); if (!item) return;
    item.planner = $('[data-field="planner"]', tr)?.value ?? '';
    if (!(item.frequency === 'yearly' && item.paymentTiming === 'later')) item.actual = $('[data-field="actual"]', tr)?.value ?? '';
    item.reserveMonthly = item.frequency === 'yearly' && item.paymentTiming === 'later' && item.planner !== '' ? Math.round(num(item.planner) / 12 * 100) / 100 : '';
  });
}
function bindPlanner(root, finalized) {
  $('#v33PlannerMonth', root)?.addEventListener('change', (e) => { plannerMonth = e.target.value; root._planning = null; renderPlanner(); });
  $$('input[data-field],#v33OpeningSavings', root).forEach((i) => i.addEventListener('change', () => { readPlannerInputs(root); renderPlanner(); }));
  $$('[data-remove-row]', root).forEach((b) => b.addEventListener('click', () => { readPlannerInputs(root); const id = b.closest('[data-plan-row]').dataset.planRow; root._planning.items = root._planning.items.filter((x) => x.id !== id); renderPlanner(); }));
  $('#v33AddExpense', root)?.addEventListener('click', () => showExtraForm(root));
  $('#v33SavePlanning', root)?.addEventListener('click', async () => {
    readPlannerInputs(root); const btn = $('#v33SavePlanning', root); btn.disabled = true;
    try {
      const result = await window.TwogetherAPI.post('saveFinancePlanning', { month: plannerMonth, planning: root._planning }, actor());
      await window.TwogetherAPI.remoteState();
      root._planning = JSON.parse(JSON.stringify(result.planning || root._planning));
      toast('Planner and Actual saved');
      renderPlanner();
    } catch (e) {
      toast(e.message || 'Could not save monthly planning', 'warn'); btn.disabled = false;
    }
  });
}
function showExtraForm(root) {
  const form = $('#v33ExtraForm', root); if (!form) return;
  form.classList.remove('hidden');
  form.innerHTML = `<h3>Add an extra expense</h3><div class="v33-extra-grid"><label>Name<input id="v33ExtraName" placeholder="e.g. Insurance"></label><label>Planner amount<input id="v33ExtraPlanner" inputmode="decimal" placeholder="0.00"></label><label>Actual paid so far<input id="v33ExtraActual" inputmode="decimal" placeholder="0.00"></label><label>What type of expense is this?<select id="v33ExtraFreq"><option value="one-time">One-time</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label><label class="v33-yearly-pay hidden" id="v33YearlyWrap">How is this yearly expense being paid?<select id="v33ExtraTiming"><option value="upfront">Paid upfront now</option><option value="later">Paid once per year / due later</option></select></label></div><div id="v33ReservePreview"></div><div class="v33-plan-actions"><button class="btn ghost" type="button" data-extra-cancel>Cancel</button><button class="btn primary" type="button" data-extra-add>Add expense</button></div>`;
  const update = () => {
    const yearly = $('#v33ExtraFreq', form).value === 'yearly';
    $('#v33YearlyWrap', form).classList.toggle('hidden', !yearly);
    const later = yearly && $('#v33ExtraTiming', form).value === 'later', amt = num($('#v33ExtraPlanner', form).value);
    $('#v33ReservePreview', form).innerHTML = later && amt ? `<div class="v33-reserve-preview"><strong>${money(amt / 12)} per month</strong><span>Keep this reserved in the account. It is not counted as Actual until the yearly bill is really paid.</span></div>` : '';
    $('#v33ExtraActual', form).disabled = later;
  };
  $('#v33ExtraFreq', form).addEventListener('change', update); $('#v33ExtraTiming', form).addEventListener('change', update); $('#v33ExtraPlanner', form).addEventListener('input', update);
  $('[data-extra-cancel]', form).addEventListener('click', () => form.classList.add('hidden'));
  $('[data-extra-add]', form).addEventListener('click', () => {
    const name = $('#v33ExtraName', form).value.trim(), planner = $('#v33ExtraPlanner', form).value, frequency = $('#v33ExtraFreq', form).value;
    const timing = frequency === 'yearly' ? $('#v33ExtraTiming', form).value : '', later = frequency === 'yearly' && timing === 'later', actual = later ? '' : $('#v33ExtraActual', form).value;
    if (!name) return toast('Add an expense name', 'warn');
    readPlannerInputs(root);
    root._planning.items.push({ ...baseRow(name, planner, actual, 'other', '', 'expense', frequency, timing), custom: true });
    renderPlanner();
  });
}
