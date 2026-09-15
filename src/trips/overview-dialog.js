// The trip reconciliation overview dialog (a native <dialog>): compares
// both partners' logged details/expenses side by side, shows shared-payment
// cards, and confirm/edit actions. Extracted from overview-v26.js. Also
// carries a global Enter-submits-nearest-button UX handler that spans
// several overlay types (kept here since that's where it originally lived,
// not because it conceptually belongs to this dialog specifically).
//
// Note: money() here intentionally stays local (toFixed(2), no thousands
// separator) rather than swapped for lib/format's money() (which uses
// toLocaleString) -- that's a real behavioral difference from the rest of
// the app that predates this migration, not something to silently "fix"
// while porting.
import { fmtDate } from '../lib/format.js';
import { renderShared } from './shared-expenses.js';

const names = ['Principessa', 'Principe'], keys = ['travel', 'accom', 'fuel', 'groceries', 'eat', 'tolls', 'other'];
const labels = { travel: 'Flights / Train', accom: 'Accommodation', fuel: 'Fuel', groceries: 'Groceries', eat: 'Eating out', tolls: 'Tolls / Parking', other: 'Other', otherNote: 'Note' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = (v) => v !== '' && v != null;
const n = (v) => Number(String(v ?? 0).replace(',', '.')) || 0;
const money = (v) => '€' + n(v).toFixed(2);

let latest = null, dialog = null, opened = null, refreshing = false, lastRefresh = 0;

function records(plan, trip) { return names.map((name) => trip?.submissions?.[name] || plan?.partials?.[name] || {}); }
function total(plan, trip) {
  const [a, b] = records(plan, trip);
  return keys.reduce((sum, key) => { const m = plan?.sharedExpenses?.[key] || trip?.sharedExpenses?.[key]; return sum + (has(m?.total) ? n(m.total) : Math.max(n(a[key]), n(b[key]))); }, 0);
}
function metrics(plan, trip) {
  return `<div class="overview-metrics">${names.map((name) => `<div><span>${name} budget</span><strong>${has(plan?.budgets?.[name]) ? money(plan.budgets[name]) : 'Not set'}</strong></div>`).join('')}<div><span>Total budget</span><strong>${names.some((name) => has(plan?.budgets?.[name])) ? money(names.reduce((s, name) => s + n(plan.budgets[name]), 0)) : has(trip?.budget) ? money(trip.budget) : 'Not set'}</strong></div><div><span>Trip so far</span><strong>${money(total(plan, trip))}</strong></div></div>`;
}
function warnings(plan, trip) {
  const result = [];
  for (const key of ['accom', 'travel']) {
    const m = plan?.sharedExpenses?.[key] || trip?.sharedExpenses?.[key];
    if (!m?.mode || !names.some((name) => m.mode[name])) continue;
    if (names.every((name) => has(m.totals?.[name])) && Math.abs(n(m.totals.Principessa) - n(m.totals.Principe)) > 0.005) result.push(`${labels[key]}: you entered different total bills. Resolve the total in the overview.`);
    if (!has(m.total) || m.totalUncertain) { result.push(`${labels[key]} total needs resolving.`); continue; }
    if (!names.some((name) => m.mode[name] === 'full') && names.some((name) => !has(m.paid?.[name]))) { result.push(`${labels[key]} is waiting for both payments.`); continue; }
    const delta = n(m.total) - names.reduce((s, name) => s + n(m.paid?.[name]), 0);
    if (Math.abs(delta) > 0.005) result.push(`${labels[key]}: payments differ from the bill by ${money(Math.abs(delta))}.`);
  }
  if (names.every((name) => trip?.submissions?.[name])) {
    const paid = names.reduce((s, name) => s + n(trip.submissions[name].paid), 0), delta = total(plan, trip) - paid;
    if (Math.abs(delta) > 0.005) result.push(`${money(total(plan, trip))} expenses recorded; ${money(paid)} paid. Difference: ${money(Math.abs(delta))}.`);
  }
  return result;
}
function close() { dialog?.remove(); dialog = null; opened = null; }
export function open(plan) { if (!plan) return; opened = plan.id; draw(plan); }
function paymentCard(plan, key, locked) {
  const m = plan.sharedExpenses?.[key] || {}, payer = names.find((name) => m.mode?.[name] === 'full') || names.find((name) => n(m.paid?.[name]) > 0) || '';
  const shared = names.some((name) => m.mode?.[name] === 'shared');
  const note = payer ? `Paid by ${payer}${shared ? ', shared between you.' : '.'}` : 'Payment details are not complete yet.';
  return `<section class="overview-payment" data-kind="${key}"><strong>${labels[key]}</strong><p>Total: ${has(m.total) ? money(m.total) : 'Not known'}${key === 'accom' && has(m.total) ? ` · 20% = ${money(n(m.total) * 0.2)}` : ''}</p>${names.map((name) => `<p>${name}: ${has(m.paid?.[name]) ? money(m.paid[name]) : 'Not logged'}${m.mode?.[name] === 'full' ? ' · fully paid' : ''}${m.mode?.[name] === 'shared' ? ' · shared' : ''}</p>`).join('')}<p class="overview-paid-note">${esc(note)}</p>${locked ? '' : `<button data-payment="${key}" type="button">Edit my payment / total</button>`}</section>`;
}
function matchCell(a, b, key, different) {
  const both = has(a[key]) && has(b[key]);
  if (different) return '<span class="overview-match different"><i>!</i>Different</span>';
  if (both) return '<span class="overview-match matched"><i>✓</i>Matched</span>';
  return '<span class="overview-match waiting"><i>–</i>No data</span>';
}
function draw(plan) {
  dialog?.remove(); dialog = document.createElement('dialog'); dialog.className = 'current-overview';
  const trip = latest?.trips?.find((t) => t.id === plan.linkedTripId), [a, b] = records(plan, trip), issues = warnings(plan, trip), fields = [...keys, 'otherNote'];
  const diff = fields.filter((key) => has(a[key]) && has(b[key]) && (keys.includes(key) ? Math.abs(n(a[key]) - n(b[key])) > 0.005 : String(a[key]).trim() !== String(b[key]).trim()));
  const locked = names.every((name) => trip?.confirmed?.[name]);
  const stateText = locked ? 'Confirmed by both of you' : diff.length ? `${diff.length} difference${diff.length === 1 ? '' : 's'} still to resolve` : 'In progress — confirm when all details and payments are complete.';
  const country = plan.meta?.location === 'Other' ? (plan.meta?.otherLocation || 'Trip') : (plan.meta?.location || 'Trip');
  dialog.innerHTML = `<button class="trip-close" data-overview-close aria-label="Close overview">×</button><div class="overview-shell"><header class="overview-hero"><div class="overview-title-row"><div class="overview-title-copy"><span class="overview-country">${esc(country)}</span><h2>${esc(plan.meta?.city || 'Current trip')}</h2><p>${fmtDate(plan.meta?.start)} – ${fmtDate(plan.meta?.end)}</p></div><span class="overview-status-pill ${locked ? 'confirmed' : ''}">${locked ? 'Confirmed' : 'In progress'}</span></div>${metrics(plan, trip)}</header><div class="overview-scroll"><p class="overview-state">${esc(stateText)}</p>${issues.map((x) => `<p class="reconcile-warning">${esc(x)}</p>`).join('')}<div class="overview-table"><table><thead><tr><th>Expense / detail</th><th>Principessa</th><th>Principe</th><th>Match</th></tr></thead><tbody>${fields.map((key) => { const different = diff.includes(key); return `<tr class="${different ? 'has-difference' : ''}"><th>${esc(labels[key] || key)}</th>${[a, b].map((r) => `<td>${has(r[key]) ? esc(keys.includes(key) ? money(r[key]) : r[key]) : 'Not logged'}${r.uncertain?.[key] ? ' · estimate' : ''}</td>`).join('')}<td>${matchCell(a, b, key, different)}</td></tr>`; }).join('')}</tbody></table></div><h3 class="overview-shared-title">Shared payments</h3><div class="overview-payment-grid">${['accom', 'travel'].map((key) => paymentCard(plan, key, locked)).join('')}</div><div class="v5-actions">${locked ? '' : '<button type="button" data-budget>Edit my budget</button><button type="button" data-expenses>Add / edit expenses</button>'}${trip && !locked ? '<button type="button" data-match>Match differences</button><button type="button" data-confirm>Confirm my version</button>' : ''}</div><p data-overview-error role="status"></p></div></div>`;
  document.body.appendChild(dialog); dialog.showModal(); dialog.addEventListener('cancel', close);
  dialog.querySelector('[data-overview-close]').onclick = close;
  dialog.querySelector('[data-budget]')?.addEventListener('click', () => { close(); window.TwogetherWorkflow.budget(plan.id); });
  dialog.querySelector('[data-expenses]')?.addEventListener('click', () => { close(); window.TwogetherWorkflow.start(plan.id); });
  dialog.querySelector('[data-match]')?.addEventListener('click', () => { close(); window.TwogetherWorkflow.match(trip.id); });
  dialog.querySelector('[data-confirm]')?.addEventListener('click', async () => {
    try { await window.TwogetherAPI.post('confirmTrip', { id: trip.id }, document.body.dataset.actor); await refresh(true); draw(latest.plans.find((p) => p.id === plan.id) || plan); }
    catch (e) { dialog.querySelector('[data-overview-error]').textContent = e.message; }
  });
  dialog.querySelectorAll('[data-payment]').forEach((btn) => btn.onclick = () => openPaymentEditor(plan, btn.dataset.payment));
}
function openPaymentEditor(plan, key) {
  if (!dialog) return;
  dialog.innerHTML = '<button class="trip-close" data-overview-close aria-label="Close overview">×</button><div class="overview-shell"><div class="overview-scroll"><div data-payment-host></div><div class="v5-actions"><button type="button" data-payment-back>Back to overview</button></div></div></div>';
  dialog.querySelector('[data-overview-close]').onclick = close;
  const host = dialog.querySelector('[data-payment-host]');
  renderShared({ host, plan, key, onDone: async () => { await refresh(true); draw(latest.plans.find((p) => p.id === plan.id) || plan); } });
  dialog.querySelector('[data-payment-back]').onclick = () => draw(plan);
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
    const root = e.target.closest('.shared-entry,#wizardCard,#workflowV5Overlay,#workflowBudgetModal');
    if (!root) return;
    const target = [...root.querySelectorAll('[data-next],[data-save],[data-wizard-next],[data-v5-next],[data-v5-partial-next],[data-v5-match-next],button')].find((b) => !b.disabled && b.getClientRects().length && /^(Next|Continue|Save)/i.test(b.textContent.trim()));
    if (target) { e.preventDefault(); e.stopImmediatePropagation(); target.click(); }
  }, true);
}

function backgroundRefresh() { if (document.visibilityState === 'visible') refresh(false); }

// Matches the original's exact structure: only refresh(true) + the
// interval were gated behind DOMContentLoaded; the other listeners and the
// window.TwogetherOverview bridge assignment ran immediately at script
// top-level. Preserved as two functions rather than folding everything
// behind one DOMContentLoaded wait, in case something reads the bridge
// earlier than that event (not observed, but not worth risking either).
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
