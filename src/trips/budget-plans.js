// The Budget Plans grid (before-the-trip planning) + new-plan/budget-only
// modals + the "is this one of your budgeted trips?" redirect shown when
// starting a new trip. Extracted from workflow.js.
//
// Circular import note: imports startActualChoice from expenses-flow.js
// (the "actual" button, and the plan-actual choice in showNewTripChoice),
// and expenses-flow.js imports renderBudgetPlans from here (to refresh the
// grid after saving). Safe under ES module live bindings -- see the note
// at the top of expenses-flow.js.
import { $, $$ } from '../lib/dom.js';
import { toast } from '../lib/toast.js';
import {
  esc, money, fmtDate, actor, otherActor,
  getSharedState, getSharedVersion, planById, tripForPlan, isLocked, post,
  locationLabel, variance, partialSummary, hasPartial, setActiveFlow, setBypassNewTrip,
  installUi, closeBudgetModal, refreshState, showOverlay, closeOverlay,
} from './budget-state.js';
import { startActualChoice } from './expenses-flow.js';

// New trip creation is handled by plan-trip.js.

export function renderBudgetPlans() {
  installUi();
  const section = $('#budgetPlannerSection'); const root = $('#budgetPlanGrid');
  if (!section || !root) return;
  const sharedState = getSharedState();
  if (sharedState.version < 4) { section.classList.add('hidden'); root.innerHTML = ''; return; }
  section.classList.remove('hidden');
  const plans = [...sharedState.plans].sort((a, b) => String(b?.meta?.start || b.updatedAt || '').localeCompare(String(a?.meta?.start || a.updatedAt || '')));
  if (!plans.length) { root.innerHTML = '<div class="budget-empty">No planned trip budgets yet. Create one before your next trip.</div>'; return; }
  const activePlans = plans.filter((plan) => !isLocked(tripForPlan(plan)));
  const displayedPlans = activePlans;
  const a = actor();
  const emptyActive = activePlans.length ? '' : '<div class="budget-empty">No active trip budgets right now. You can create one whenever you want.</div>';
  root.innerHTML = emptyActive + displayedPlans.map((plan) => {
    const meta = plan.meta || {}; const trip = tripForPlan(plan); const locked = isLocked(trip);
    const pBudget = plan?.budgets?.Principessa ?? ''; const qBudget = plan?.budgets?.Principe ?? '';
    const pLiveShare = liveTripBudgetShare(plan, 'Principessa'), qLiveShare = liveTripBudgetShare(plan, 'Principe');
    const pActual = pLiveShare !== '' ? pLiveShare : (trip?.submissions?.Principessa?.paid ?? '');
    const qActual = qLiveShare !== '' ? qLiveShare : (trip?.submissions?.Principe?.paid ?? '');
    const pPartial = plan?.partials?.Principessa || null; const qPartial = plan?.partials?.Principe || null;
    const pEarly = partialSummary(pPartial), qEarly = partialSummary(qPartial);
    const pv = variance(pBudget, pActual), qv = variance(qBudget, qActual);
    const bothBudgets = pBudget !== '' && qBudget !== ''; const bothActual = pActual !== '' && qActual !== '';
    const totalVar = bothBudgets && bothActual ? variance(money2n(pBudget) + money2n(qBudget), money2n(pActual) + money2n(qActual)) : { text: bothBudgets ? 'Waiting for both actual spends' : 'Waiting for both budgets', cls: '' };
    const ownBudget = plan?.budgets?.[a] ?? ''; const ownSub = trip?.submissions?.[a] || null;
    const ownPartial = plan?.partials?.[a] || null; const ownStarted = hasPartial(ownPartial);
    const anyPartial = hasPartial(pPartial) || hasPartial(qPartial);
    const status = locked ? 'Last confirmed trip' : trip ? 'Trip expenses in progress' : anyPartial ? 'Some expenses logged' : 'Waiting for the trip';
    const combinedPlanned = bothBudgets ? money(money2n(pBudget) + money2n(qBudget)) : 'Waiting for both budgets';
    return `<article class="budget-plan-card ${locked ? 'last-confirmed-budget' : ''}" data-v5-plan="${esc(plan.id)}"><div class="budget-plan-top"><div><span class="trip-country">${esc(locationLabel(meta))}</span><h3>${esc(meta.city || locationLabel(meta))}</h3><p>${fmtDate(meta.start)}–${fmtDate(meta.end)}</p></div><span class="budget-plan-status ${locked ? 'done' : trip || anyPartial ? 'live' : ''}">${esc(status)}</span></div><div class="v5-reference"><span>Combined planned budget</span><strong>${esc(combinedPlanned)}</strong></div><div class="budget-person-grid"><div class="budget-person ${pv.cls}"><span>Principessa</span><strong>${pBudget === '' ? 'No budget' : money(pBudget)}</strong><small>${esc(pv.text)}${pActual !== '' ? ` · actual ${money(pActual)}` : ''}${pEarly ? ` · saved early: ${esc(pEarly)}` : ''}</small></div><div class="budget-person ${qv.cls}"><span>Principe</span><strong>${qBudget === '' ? 'No budget' : money(qBudget)}</strong><small>${esc(qv.text)}${qActual !== '' ? ` · actual ${money(qActual)}` : ''}${qEarly ? ` · saved early: ${esc(qEarly)}` : ''}</small></div></div><div class="budget-total-check ${totalVar.cls}"><span>Combined</span><strong>${esc(totalVar.text)}</strong></div><div class="budget-plan-actions">${a && !ownSub && !ownStarted ? `<button class="btn ghost" type="button" data-v5-own-budget>${ownBudget === '' ? 'Add my budget' : 'Edit my budget'}</button>` : a && (ownSub || ownStarted) ? '<span class="budget-locked-note">Your planned budget is locked because you already started logging actual expenses.</span>' : ''}${a && !locked && ownBudget !== '' ? `<button class="btn primary" type="button" data-v5-actual>${ownSub ? 'Edit my actual expenses' : ownStarted ? 'Continue actual expenses' : 'Log actual expenses'}</button>` : ''}${trip ? '<button class="btn ghost" type="button" data-v5-open-trip>Open trip</button>' : ''}</div></article>`;
  }).join('');
  $$('[data-v5-plan]', root).forEach((card) => {
    const id = card.dataset.v5Plan;
    $('[data-v5-own-budget]', card)?.addEventListener('click', () => openBudgetOnly(id));
    $('[data-v5-actual]', card)?.addEventListener('click', () => startActualChoice(id));
    $('[data-v5-open-trip]', card)?.addEventListener('click', () => {
      const plan = planById(id); const tripId = plan?.linkedTripId;
      if (tripId) document.querySelector(`[data-open-trip="${CSS.escape(tripId)}"]`)?.click();
    });
  });
}

function liveTripBudgetShare(plan, person) {
  const entries = Array.isArray(plan?.expenseEntries) ? plan.expenseEntries : [];
  if (!entries.length) return '';
  let total = 0;
  entries.forEach((entry) => {
    const gross = Math.max(0, money2n(entry?.amount));
    const jar = Math.min(gross, Math.max(0, money2n(entry?.jarContribution)));
    const remaining = gross - jar;
    if (entry?.split === 'personal') {
      const owner = entry?.forActor === 'Principe' ? 'Principe' : 'Principessa';
      if (owner === person) total += remaining;
    } else {
      total += remaining / 2;
    }
  });
  return Math.max(0, Math.round(total * 100) / 100);
}

function money2n(v) { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : 0; }

function showBudgetModal(html) {
  installUi(); const modal = $('#workflowBudgetModal'); const body = $('#workflowBudgetBody');
  if (body) body.innerHTML = html; modal?.classList.add('show'); modal?.setAttribute('aria-hidden', 'false');
}

let budgetModalPlanId = '';

export function openNewPlan() {
  if (getSharedVersion() < 4) { toast('Trip budgets are not available yet', 'warn'); return; }
  const a = actor(); if (!a) { toast('Choose your profile first', 'warn'); return; }
  budgetModalPlanId = '';
  showBudgetModal(`<span class="panel-kicker">PLAN BEFORE THE TRIP</span><h2>Create a trip budget</h2><p>Add the trip details and your individual budget. ${esc(otherActor(a))} can add theirs separately.</p><div class="v5-form"><div class="v5-field"><label>Country</label><select id="v5PlanLocation"><option>Italy</option><option>Netherlands</option><option>Portugal</option><option>Other</option></select></div><div class="v5-field"><label>If Other</label><input id="v5PlanOther" placeholder="e.g. Tunisia"></div><div class="v5-field full"><label>City / area</label><input id="v5PlanCity" placeholder="e.g. Lonato del Garda"></div><div class="v5-field"><label>Start date</label><input id="v5PlanStart" type="date"></div><div class="v5-field"><label>End date</label><input id="v5PlanEnd" type="date"></div><div class="v5-field full"><label>${esc(a)} individual budget</label><input id="v5PlanBudget" inputmode="decimal" placeholder="0.00"></div></div><div class="v5-modal-actions"><button class="btn primary" type="button" data-v5-save-plan>Save trip budget</button></div>`);
  $('[data-v5-save-plan]')?.addEventListener('click', saveNewPlan);
}

async function saveNewPlan() {
  const a = actor();
  const meta = { location: $('#v5PlanLocation')?.value || '', otherLocation: $('#v5PlanOther')?.value || '', city: $('#v5PlanCity')?.value || '', start: $('#v5PlanStart')?.value || '', end: $('#v5PlanEnd')?.value || '' };
  const budget = $('#v5PlanBudget')?.value || '';
  if (!meta.location || !meta.city || !meta.start || !meta.end) { toast('Add the trip details first', 'warn'); return; }
  if (!budget || !Number.isFinite(Number(budget.replace(',', '.')))) { toast('Enter your budget first', 'warn'); return; }
  try {
    await post('savePlan', { meta, budget }, a); closeBudgetModal(); toast('Your trip budget was saved');
    setTimeout(refreshState, 750);
  } catch (err) { toast(err.message || 'Could not save budget', 'warn'); }
}

export function openBudgetOnly(id) {
  const plan = planById(id); const a = actor(); if (!plan || !a) return;
  budgetModalPlanId = id;
  showBudgetModal(`<span class="panel-kicker">YOUR BUDGET</span><h2>${esc(plan.meta?.city || locationLabel(plan.meta))}</h2><p>${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)} · this only changes ${esc(a)}’s planned spending limit.</p><div class="v5-form"><div class="v5-field full"><label>${esc(a)} individual budget</label><input id="v5PlanBudget" inputmode="decimal" value="${esc(String(plan?.budgets?.[a] ?? ''))}" placeholder="0.00"></div></div><div class="v5-modal-actions"><button class="btn primary" type="button" data-v5-save-budget>Save my budget</button></div>`);
  $('[data-v5-save-budget]')?.addEventListener('click', saveBudgetOnly);
}

async function saveBudgetOnly() {
  const plan = planById(budgetModalPlanId); const budget = $('#v5PlanBudget')?.value || '';
  if (!plan || !budget || !Number.isFinite(Number(budget.replace(',', '.')))) { toast('Enter a valid budget', 'warn'); return; }
  try {
    await post('savePlan', { id: plan.id, budget }); closeBudgetModal(); toast('Your budget was updated');
    setTimeout(refreshState, 750);
  } catch (err) { toast(err.message || 'Could not save budget', 'warn'); }
}

export function eligibleBudgetPlans() {
  const a = actor(); if (!a || getSharedVersion() < 4) return [];
  return getSharedState().plans.filter((plan) => {
    const ownBudget = plan?.budgets?.[a]; if (ownBudget === '' || ownBudget == null) return false;
    const trip = tripForPlan(plan); if (isLocked(trip)) return false;
    return !trip?.submissions?.[a];
  });
}

function clickBypassed(btn) {
  setBypassNewTrip(true); btn.click(); setBypassNewTrip(false);
}

export function showNewTripChoice(originalButton) {
  const plans = eligibleBudgetPlans();
  if (!plans.length) {
    clickBypassed(originalButton); return;
  }
  setActiveFlow({ type: 'choosePlan', originalButton });
  const choices = `<div class="v5-choice-stack">${plans.map((plan) => `<button class="trip-pick" type="button" data-v5-plan-actual="${esc(plan.id)}"><span class="pick-icon">↔</span><div><strong>Yes · ${esc(plan.meta?.city || locationLabel(plan.meta))}</strong><small>${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)} · log the actual expenses</small></div></button>`).join('')}<button class="trip-pick new-trip-pick" type="button" data-v5-really-new><span class="pick-icon">＋</span><div><strong>No · this is a different trip</strong><small>Start the normal new-trip questions.</small></div></button></div>`;
  showOverlay('TRIP TYPE', 12, 'Is this one of your budgeted trips?', 'Choose the planned trip to enter its actual expenses, or start a completely new trip.', choices);
  $$('[data-v5-plan-actual]').forEach((btn) => btn.addEventListener('click', () => startActualChoice(btn.dataset.v5PlanActual)));
  $('[data-v5-really-new]')?.addEventListener('click', () => {
    closeOverlay();
    clickBypassed(originalButton);
  });
}
