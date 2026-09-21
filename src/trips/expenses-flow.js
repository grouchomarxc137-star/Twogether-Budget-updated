// The three ways to log/correct actual expenses for a budgeted trip: full
// wizard, resumable partial (save-a-few-categories-now), and mismatch
// correction ("match the differences"). Kept together in one file since
// all three share the same activeFlow state (only one can be active at a
// time) -- extracted from workflow.js.
//
// Circular import note: imports renderBudgetPlans from budget-plans.js
// (savePartialActual refreshes the plan grid after saving), and
// budget-plans.js imports startActualChoice from here (its "actual"
// button, and showNewTripChoice's plan-actual choice). Safe under ES
// module live bindings -- neither call happens at module top-level.
import { $, $$ } from '../lib/dom.js';
import { toast } from '../lib/toast.js';
import {
  MONEY_FIELDS, MONEY_LABELS, esc, n, money, fmtDate, actor, otherActor,
  getActiveFlow, setActiveFlow, planById, tripById, post, refreshState, getSharedVersion, tripForPlan,
  locationLabel, showOverlay, closeOverlay, closeBudgetModal, partialSummary, hasPartial,
} from './budget-state.js';
import { renderBudgetPlans } from './budget-plans.js';
import { renderShared } from './shared-expenses.js';

function actualDraftKey(planId) {
  return `twogether:actual-flow:v2:${actor() || 'guest'}:${planId || ''}`;
}

function readActualDraft(planId) {
  try {
    const raw = localStorage.getItem(actualDraftKey(planId));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || saved.type !== 'actual' || saved.planId !== planId || !saved.draft) return null;
    return saved;
  } catch {
    return null;
  }
}

function persistActualDraft(flow) {
  if (!flow || flow.type !== 'actual' || !flow.planId) return;
  try {
    localStorage.setItem(actualDraftKey(flow.planId), JSON.stringify({
      type: 'actual',
      planId: flow.planId,
      index: Math.max(0, Number(flow.index) || 0),
      otherFlow: flow.otherFlow || null,
      draft: flow.draft,
      savedAt: new Date().toISOString(),
    }));
  } catch {}
}

function clearActualDraft(planId) {
  try { localStorage.removeItem(actualDraftKey(planId)); } catch {}
}

function partialFromActual(flow) {
  const partial = { otherNote: flow?.draft?.otherNote || '', uncertain: { ...(flow?.draft?.uncertain || {}) } };
  MONEY_FIELDS.forEach((key) => { partial[key] = flow?.draft?.[key] ?? ''; });
  return partial;
}

async function saveActualAndExit() {
  const flow = getActiveFlow();
  if (!flow || flow.type !== 'actual') return;
  persistActualDraft(flow);
  const partial = partialFromActual(flow);
  const hasAnything = MONEY_FIELDS.some((key) => partial[key] !== '' && partial[key] != null);
  try {
    if (hasAnything) await post('savePlanPartial', { planId: flow.planId, partial });
    closeOverlay();
    toast(hasAnything ? 'Saved. Continue this trip whenever you’re ready.' : 'Your place in the wizard is saved on this device.');
    if (hasAnything) setTimeout(() => refreshState(), 500);
  } catch (err) {
    toast(err.message || 'Could not save your progress', 'warn');
  }
}

document.addEventListener('twogether:workflow-save-exit', () => {
  const flow = getActiveFlow();
  if (flow?.type === 'actual') { saveActualAndExit(); return; }
  if (flow?.type === 'partial') { savePartialActual(); }
});

// ---- Full "actual expenses" wizard ----

export function startActualChoice(planId) {
  const plan = planById(planId); const a = actor();
  if (!plan || !a) { toast('Could not open this budgeted trip', 'warn'); return; }
  closeBudgetModal();
  document.querySelector('.tab[data-sheet="log"]')?.click();
  if (getSharedVersion() < 7) {
    startPlanActual(planId);
    return;
  }
  const partial = plan?.partials?.[a] || null;
  const saved = partialSummary(partial);
  requestAnimationFrame(() => {
    const content = `${saved ? `<div class="v5-reference"><span>Already saved for later</span><strong>${esc(saved)}</strong></div>` : ''}<div class="v5-choice-stack"><button class="trip-pick" type="button" data-v5-actual-mode="full"><span class="pick-icon">✓</span><div><strong>Log everything now</strong><small>Use the normal full trip-expense wizard. Anything saved earlier is already filled in.</small></div></button><button class="trip-pick" type="button" data-v5-actual-mode="partial"><span class="pick-icon">＋</span><div><strong>Log some expenses now</strong><small>Save one or more expense categories now and finish the rest later.</small></div></button></div>`;
    showOverlay('ACTUAL EXPENSES', 12, 'How much do you want to log now?', 'Record a few expenses now or complete the whole trip.', content);
    $('[data-v5-actual-mode="full"]')?.addEventListener('click', () => startPlanActual(planId));
    $('[data-v5-actual-mode="partial"]')?.addEventListener('click', () => startPartialActual(planId));
    $('#wizardCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function startPlanActual(planId) {
  const plan = planById(planId); const a = actor(); if (!plan || !a) return;
  const trip = tripForPlan(plan); const existing = trip?.submissions?.[a] || {}; const partial = plan?.partials?.[a] || {};
  const saved = readActualDraft(planId);
  const baseDraft = { accom: '', groceries: '', eat: '', travel: '', fuel: '', tolls: '', other: '', otherNote: '', paid: '', uncertain: {}, ...partial, ...existing, uncertain: { ...(partial.uncertain || {}), ...(existing.uncertain || {}) } };
  setActiveFlow({
    type: 'actual', planId, index: saved?.index ?? 0, otherFlow: saved?.otherFlow || null, resumeNotice: !!saved,
    draft: saved?.draft ? { ...baseDraft, ...saved.draft, uncertain: { ...baseDraft.uncertain, ...(saved.draft.uncertain || {}) } } : baseDraft,
  });
  closeBudgetModal();
  document.querySelector('.tab[data-sheet="log"]')?.click();
  renderActualFlow();
  $('#wizardCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function actualSteps() {
  const f = getActiveFlow();
  const base = [
    ['accom', 'How much was accommodation?'], ['travel', 'How much on flights or trains?'], ['fuel', 'How much on fuel?'], ['tolls', 'How much on tolls or parking?'], ['groceries', 'How much on groceries?'], ['eat', 'How much on eating out?'],
  ].map(([key, title]) => ({ key, title, type: 'money' }));
  base.push({ key: 'otherFlow', title: 'Other expenses', type: 'otherExpenses' });
  base.push({ key: 'paid', title: `How much did ${actor()} actually pay?`, type: 'money', noUncertain: true });
  base.push({ key: 'review', title: 'Ready to save your actual expenses?', type: 'review' });
  return base.filter((step) => {
    const m = planById(f?.planId)?.sharedExpenses?.[step.key];
    if (m?.mode?.[otherActor(actor())] === 'full' && m.total !== '' && m.total != null) { f.draft[step.key] = m.total; return false; }
    return true;
  });
}

function ensureActualOtherFlow() {
  const f = getActiveFlow();
  if (!f.otherFlow) {
    const existing = n(f.draft.other);
    f.otherFlow = { stage: 'amount', items: [], amount: existing > 0 ? String(f.draft.other ?? existing) : '', name: existing > 0 ? String(f.draft.otherNote || '') : '', uncertain: !!f.draft?.uncertain?.other };
  }
  return f.otherFlow;
}

function syncActualOtherDraft() {
  const f = getActiveFlow(); const of_ = ensureActualOtherFlow();
  f.draft.other = String(of_.items.reduce((sum, item) => sum + n(item.amount), 0));
  f.draft.otherNote = of_.items.map((item) => `${item.name} · ${money(item.amount)}`).join(' + ');
  f.draft.uncertain = { ...(f.draft.uncertain || {}) };
  f.draft.uncertain.other = of_.items.some((item) => !!item.uncertain);
}

function actualOtherList() {
  const of_ = ensureActualOtherFlow();
  return of_.items.length ? `<div class="v5-review">${of_.items.map((item) => `<div class="v5-review-row"><span>${esc(item.name)}</span><strong>${item.uncertain ? '~ ' : ''}${money(item.amount)}</strong></div>`).join('')}</div>` : '';
}

function renderActualOtherExpenses(plan, steps, qCount, qNum) {
  const f = getActiveFlow(); const of_ = ensureActualOtherFlow();
  const list = actualOtherList();
  const title = of_.stage === 'name' ? 'What was this expense?' : of_.stage === 'more' ? 'Any more other expenses?' : of_.items.length ? 'How much was the next other expense?' : 'Any other expenses?';
  let control = '';
  if (of_.stage === 'name') {
    control = `${list}<div class="v5-reference"><span>Amount</span><strong>${of_.uncertain ? '~ ' : ''}${money(of_.amount)}</strong></div><div class="field-wrap"><input id="v5OtherName" class="big-input" value="${esc(of_.name || '')}" placeholder="e.g. museum tickets"></div><div class="v5-actions"><button class="btn ghost" type="button" data-v5-other-back>Back</button><button class="btn primary big" type="button" data-v5-other-next>Next</button></div>`;
  } else if (of_.stage === 'more') {
    control = `${list}<div class="v5-choice-stack"><button class="trip-pick" type="button" data-v5-other-more="yes"><span class="pick-icon">＋</span><div><strong>Yes, add another</strong><small>Add another amount and its name.</small></div></button><button class="trip-pick" type="button" data-v5-other-more="no"><span class="pick-icon">✓</span><div><strong>No, continue</strong><small>Continue to what you actually paid.</small></div></button></div>`;
  } else {
    control = `${list}<div class="${of_.uncertain ? 'uncertain-mode' : ''}"><div class="money-input-wrap"><span>€</span><input id="v5OtherAmount" class="big-input money-field" inputmode="decimal" value="${esc(of_.amount || '')}" placeholder="0.00"></div><div class="certainty-row"><button class="certainty ${!of_.uncertain ? 'active' : ''}" type="button" data-v5-other-cert="exact">Exact</button><button class="certainty ${of_.uncertain ? 'active' : ''}" type="button" data-v5-other-cert="estimate">Not sure · estimate</button></div>${of_.items.length ? '' : '<button class="btn ghost full" type="button" data-v5-other-none>No other expenses</button>'}</div><div class="v5-actions"><button class="btn ghost" type="button" data-v5-other-back>Back</button><button class="btn primary big" type="button" data-v5-other-next>Next</button></div>`;
  }
  showOverlay(`QUESTION ${Math.max(1, qNum)} OF ${qCount}`, ((f.index + 1) / steps.length) * 100, title, `Budgeted trip: ${plan.meta?.city || locationLabel(plan.meta)} · ${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)}`, control);
  const amount = $('#v5OtherAmount'), name = $('#v5OtherName');
  amount?.addEventListener('input', () => { of_.amount = amount.value; }); name?.addEventListener('input', () => { of_.name = name.value; }); setTimeout(() => { (amount || name)?.focus(); }, 0);
  $$('[data-v5-other-cert]').forEach((btn) => btn.addEventListener('click', () => { of_.uncertain = btn.dataset.v5OtherCert === 'estimate'; renderActualFlow(); }));
  $('[data-v5-other-none]')?.addEventListener('click', () => { of_.items = []; f.draft.other = '0'; f.draft.otherNote = ''; f.draft.uncertain.other = false; f.index++; renderActualFlow(); });
  $('[data-v5-other-more="yes"]')?.addEventListener('click', () => { of_.stage = 'amount'; of_.amount = ''; of_.name = ''; of_.uncertain = false; renderActualFlow(); });
  $('[data-v5-other-more="no"]')?.addEventListener('click', () => { syncActualOtherDraft(); f.index++; renderActualFlow(); });
  $('[data-v5-other-back]')?.addEventListener('click', () => {
    if (of_.stage === 'name') { of_.stage = 'amount'; renderActualFlow(); return; }
    if (of_.stage === 'more') { of_.stage = 'name'; const last = of_.items.pop(); if (last) { of_.amount = String(last.amount); of_.name = last.name; of_.uncertain = !!last.uncertain; syncActualOtherDraft(); } renderActualFlow(); return; }
    if (of_.items.length) { of_.stage = 'more'; renderActualFlow(); return; }
    if (f.index === 0) closeOverlay(); else { f.index--; renderActualFlow(); }
  });
  $('[data-v5-other-next]')?.addEventListener('click', () => {
    if (of_.stage === 'amount') {
      const value = String(of_.amount || '').trim(); if (!value || !Number.isFinite(Number(value.replace(',', '.')))) { toast('Enter a valid amount first', 'warn'); return; } of_.stage = 'name'; renderActualFlow(); return;
    }
    if (of_.stage === 'name') {
      const expenseName = String(of_.name || '').trim(); if (!expenseName) { toast('Add the name of the expense first', 'warn'); return; } of_.items.push({ amount: String(of_.amount), name: expenseName, uncertain: !!of_.uncertain }); syncActualOtherDraft(); of_.amount = ''; of_.name = ''; of_.uncertain = false; of_.stage = 'more'; renderActualFlow();
    }
  });
}

function renderActualFlow() {
  const f = getActiveFlow();
  if (f?.type !== 'actual') return;
  persistActualDraft(f);
  const plan = planById(f.planId); if (!plan) return closeOverlay();
  const steps = actualSteps(); if (f.index >= steps.length) f.index = steps.length - 1;
  const step = steps[f.index]; const isReview = step.type === 'review';
  const qCount = steps.filter((s) => s.type !== 'review').length;
  const qNum = steps.slice(0, f.index + 1).filter((s) => s.type !== 'review').length;
  if (isReview) {
    const total = MONEY_FIELDS.reduce((sum, k) => sum + n(f.draft[k]), 0);
    const content = `<div class="v5-reference"><span>${esc(plan.meta?.city || locationLabel(plan.meta))} · your planned budget</span><strong>${money(plan?.budgets?.[actor()])}</strong><small>${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)}</small></div><div class="v5-review">${MONEY_FIELDS.map((k) => `<div class="v5-review-row"><span>${esc(MONEY_LABELS[k])}</span><strong>${f.draft?.uncertain?.[k] ? '~ ' : ''}${money(f.draft[k])}</strong></div>`).join('')}<div class="v5-review-row"><span>Total expenses</span><strong>${money(total)}</strong></div><div class="v5-review-row"><span>${esc(actor())} actually paid</span><strong>${money(f.draft.paid)}</strong></div></div><div class="v5-actions"><button class="btn ghost" type="button" data-v5-back>Back</button><button class="btn primary big" type="button" data-v5-save-actual>Save actual expenses</button></div>`;
    showOverlay('REVIEW', 100, step.title, 'The trip details come from your budget plan.', content);
    $('[data-v5-back]')?.addEventListener('click', () => { f.index--; renderActualFlow(); });
    $('[data-v5-save-actual]')?.addEventListener('click', savePlanActual);
    return;
  }
  if (['accom', 'travel'].includes(step.key)) {
    showOverlay('SHARED EXPENSE', ((f.index + 1) / steps.length) * 100, MONEY_LABELS[step.key], 'Record the total bill and your payment.', '<div id="sharedHost"></div>');
    return renderShared({ host: $('#sharedHost'), plan, key: step.key, onBack: () => { if (f.index === 0) closeOverlay(); else { f.index--; renderActualFlow(); } }, onDone: (total, unknown) => { f.draft[step.key] = total; f.draft.uncertain[step.key] = unknown; f.index++; renderActualFlow(); } });
  }
  if (step.type === 'otherExpenses') { renderActualOtherExpenses(plan, steps, qCount, qNum); return; }
  const uncertain = !!f.draft?.uncertain?.[step.key];
  let control = '';
  if (step.type === 'text') {
    control = `<div class="field-wrap"><input id="v5FlowInput" class="big-input" type="text" value="${esc(f.draft[step.key] || '')}"></div>`;
  } else {
    const pot = step.key === 'accom' ? `<div id="v5FullJointPot" style="margin-top:10px;font-weight:800">20% = <strong>${money(n(f.draft.accom) * 0.20)}</strong></div>` : '';
    const label = MONEY_LABELS[step.key] || 'Expense';
    const modeCards = !step.noUncertain ? `<div class="expense-mode-grid"><button class="expense-mode-card ${!uncertain ? 'active' : ''}" type="button" data-v5-cert="exact"><span>€</span><strong>Add ${esc(label.toLowerCase())} cost</strong><small>Enter the amount you paid.</small></button><button class="expense-mode-card ${uncertain ? 'active' : ''}" type="button" data-v5-cert="estimate"><span>?</span><strong>Not sure of cost</strong><small>Enter your best estimate.</small></button></div>` : '';
    control = `<div class="${uncertain ? 'uncertain-mode' : ''}">${modeCards}<div class="money-input-wrap"><span>€</span><input id="v5FlowInput" class="big-input money-field" inputmode="decimal" value="${esc(String(f.draft[step.key] ?? ''))}" placeholder="0.00"></div>${pot}${step.key === 'other' ? '<button class="btn ghost full" type="button" data-v5-none>No other expenses</button>' : ''}</div>`;
  }
  control += `<div class="v5-actions"><button class="btn ghost" type="button" data-v5-back>← Back</button><button class="btn primary big" type="button" data-v5-next>Continue →</button></div>`;
  showOverlay(`QUESTION ${Math.max(1, qNum)} OF ${qCount}`, ((f.index + 1) / steps.length) * 100, step.title, `Budgeted trip: ${plan.meta?.city || locationLabel(plan.meta)} · ${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)}`, control);
  const input = $('#v5FlowInput'); input?.addEventListener('input', () => { f.draft[step.key] = input.value; if (step.key === 'accom') { const strong = $('#v5FullJointPot strong'); if (strong) strong.textContent = money(n(input.value) * 0.20); } }); setTimeout(() => input?.focus(), 0);
  $$('[data-v5-cert]').forEach((btn) => btn.addEventListener('click', () => { f.draft.uncertain = { ...(f.draft.uncertain || {}) }; f.draft.uncertain[step.key] = btn.dataset.v5Cert === 'estimate'; renderActualFlow(); }));
  $('[data-v5-none]')?.addEventListener('click', () => { f.draft.other = '0'; f.draft.uncertain.other = false; f.index++; renderActualFlow(); });
  $('[data-v5-back]')?.addEventListener('click', () => { if (f.index === 0) closeOverlay(); else { f.index--; renderActualFlow(); } });
  $('[data-v5-next]')?.addEventListener('click', () => {
    const value = String(f.draft[step.key] ?? '').trim();
    if (step.type === 'money' && (!value || !Number.isFinite(Number(value.replace(',', '.'))))) { toast('Enter a valid amount first', 'warn'); return; }
    f.index++; renderActualFlow();
  });
}

async function savePlanActual() {
  const flow = getActiveFlow(); if (!flow || flow.type !== 'actual') return;
  const btn = $('[data-v5-save-actual]'); if (btn) btn.disabled = true;
  try {
    await post('savePlanSubmission', { planId: flow.planId, submission: { ...flow.draft, uncertain: { ...(flow.draft.uncertain || {}) } } });
    clearActualDraft(flow.planId);
    closeOverlay(); toast('Your actual expenses were saved');
    setTimeout(() => refreshState(), 750);
  } catch (err) { toast(err.message || 'Could not save expenses', 'warn'); if (btn) btn.disabled = false; }
}

// ---- Partial (resumable) actual expenses ----

function startPartialActual(planId) {
  const plan = planById(planId); const a = actor(); if (!plan || !a) return;
  const existing = plan?.partials?.[a] || {};
  const draft = { otherNote: existing.otherNote || '', uncertain: { ...(existing.uncertain || {}) } };
  MONEY_FIELDS.forEach((key) => { draft[key] = existing[key] ?? ''; });
  setActiveFlow({ type: 'partial', planId, stage: 'choose', key: '', draft, expanded: true, mode: 'new', entryAmount: '', entryUncertain: false, pendingAmount: null, pendingUncertain: false, entryName: '' });
  closeBudgetModal();
  document.querySelector('.tab[data-sheet="log"]')?.click();
  renderPartialActual();
  $('#wizardCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function partialHasValue(f, key) { return f?.draft?.[key] !== '' && f?.draft?.[key] != null; }

function beginPartialAmount(f, key, mode) {
  f.key = key; f.mode = mode || 'new'; f.stage = 'amount';
  f.entryAmount = f.mode === 'replace' ? String(f.draft[key] ?? '') : '';
  f.entryUncertain = f.mode === 'replace' ? !!f.draft?.uncertain?.[key] : false;
  f.entryName = ''; f.pendingAmount = null; f.pendingUncertain = false;
  renderPartialActual();
}

function commitPartialEntry(f, name) {
  const key = f.key;
  const entered = n(f.pendingAmount == null ? f.entryAmount : f.pendingAmount);
  const old = partialHasValue(f, key) ? n(f.draft[key]) : 0;
  const oldUncertain = !!f.draft?.uncertain?.[key];
  const entryUncertain = f.pendingAmount == null ? !!f.entryUncertain : !!f.pendingUncertain;
  const total = f.mode === 'add' ? old + entered : entered;
  f.draft[key] = String(total);
  f.draft.uncertain = { ...(f.draft.uncertain || {}) };
  f.draft.uncertain[key] = f.mode === 'add' ? (oldUncertain || entryUncertain) : entryUncertain;
  if (key === 'other') {
    const clean = String(name || '').trim();
    if (f.mode === 'add' && String(f.draft.otherNote || '').trim()) f.draft.otherNote = `${f.draft.otherNote} + ${clean}`;
    else f.draft.otherNote = clean;
  }
  f.entryAmount = ''; f.entryName = ''; f.pendingAmount = null; f.pendingUncertain = false; f.entryUncertain = false;
  f.stage = 'more';
  renderPartialActual();
}

function renderPartialActual() {
  const f = getActiveFlow(); if (!f || f.type !== 'partial') return;
  const plan = planById(f.planId); if (!plan) return closeOverlay();
  const saved = partialSummary(f.draft);
  const icons = { accom: '⌂', groceries: '▣', eat: '♨', travel: '✈', fuel: '⛽', tolls: '↔', other: '＋' };

  if (f.stage === 'choose') {
    const partialOrder = ['travel', 'accom', 'fuel', 'groceries', 'eat', 'tolls', 'other'];
    const unlogged = partialOrder.filter((key) => !partialHasValue(f, key) && plan.sharedExpenses?.[key]?.mode?.[otherActor(actor())] !== 'full');
    let selectable = unlogged;
    if (!selectable.length && !f.expanded) { f.expanded = true; selectable = unlogged; }
    const choices = selectable.map((key) => `<button class="trip-pick" type="button" data-v5-partial-key="${key}"><span class="pick-icon">${icons[key] || '＋'}</span><div><strong>${esc(MONEY_LABELS[key])}</strong><small>Add ${esc(MONEY_LABELS[key].toLowerCase())}</small></div></button>`).join('');
    const savedKeys = partialOrder.filter((key) => partialHasValue(f, key));
    const savedChoices = savedKeys.map((key) => `<button class="trip-pick" type="button" data-v5-partial-saved="${key}"><span class="pick-icon">↻</span><div><strong>${esc(MONEY_LABELS[key])}</strong><small>Saved total ${money(f.draft[key])} · add another or edit</small></div></button>`).join('');
    const intro = !f.expanded ? 'Start with accommodation and/or Flights / Train. After your first entry, you can add the other categories.' : 'Choose one of the remaining categories. Saved categories can still be updated below.';
    const content = `${saved ? `<div class="v5-reference"><span>Saved so far</span><strong>${esc(saved)}</strong></div>` : ''}${choices ? `<div class="v5-choice-stack">${choices}</div>` : '<div class="budget-empty">All categories already have a saved amount.</div>'}${savedChoices ? `<div class="v5-step" style="margin:18px 0 8px">ALREADY LOGGED · EDIT OR ADD</div><div class="v5-choice-stack">${savedChoices}</div>` : ''}${saved ? '<div class="v5-actions"><button class="btn ghost" type="button" data-v5-partial-cancel>Cancel</button><button class="btn primary big" type="button" data-v5-partial-save>Save for later</button></div>' : ''}`;
    showOverlay('PARTIAL EXPENSES', 24, 'What do you want to log?', intro, content);
    $$('[data-v5-partial-key]').forEach((btn) => btn.addEventListener('click', () => beginPartialAmount(f, btn.dataset.v5PartialKey, 'new')));
    $$('[data-v5-partial-saved]').forEach((btn) => btn.addEventListener('click', () => { f.key = btn.dataset.v5PartialSaved; f.stage = 'savedAction'; renderPartialActual(); }));
    $('[data-v5-partial-cancel]')?.addEventListener('click', closeOverlay);
    $('[data-v5-partial-save]')?.addEventListener('click', savePartialActual);
    return;
  }

  if (f.stage === 'savedAction') {
    const key = f.key; const label = MONEY_LABELS[key];
    const content = `<div class="v5-reference"><span>Current saved total</span><strong>${money(f.draft[key])}</strong></div><div class="v5-choice-stack"><button class="trip-pick" type="button" data-v5-saved-action="add"><span class="pick-icon">＋</span><div><strong>Add another ${esc(label.toLowerCase())} expense</strong><small>The new amount will be added to the current total.</small></div></button><button class="trip-pick" type="button" data-v5-saved-action="replace"><span class="pick-icon">✎</span><div><strong>Edit the saved total</strong><small>Replace ${money(f.draft[key])} with a corrected total.</small></div></button></div><div class="v5-actions"><button class="btn ghost" type="button" data-v5-saved-back>Back</button></div>`;
    showOverlay('PARTIAL EXPENSES', 38, `Update ${label}`, `Twogether only stores the running total for this category.`, content);
    $$('[data-v5-saved-action]').forEach((btn) => btn.addEventListener('click', () => beginPartialAmount(f, key, btn.dataset.v5SavedAction)));
    $('[data-v5-saved-back]')?.addEventListener('click', () => { f.stage = 'choose'; renderPartialActual(); });
    return;
  }

  if (f.stage === 'more') {
    const content = `<div class="v5-reference"><span>Saved so far</span><strong>${esc(saved || '—')}</strong></div><div class="v5-choice-stack"><button class="trip-pick" type="button" data-v5-partial-more="yes"><span class="pick-icon">＋</span><div><strong>Yes, log something else</strong><small>Show the remaining categories and anything already saved that you can update.</small></div></button><button class="trip-pick" type="button" data-v5-partial-more="no"><span class="pick-icon">✓</span><div><strong>No, that’s all for now</strong><small>Save these totals and continue another day.</small></div></button></div>`;
    showOverlay('PARTIAL EXPENSES', 72, 'Anything else to log now?', 'You can keep building these totals little by little until you complete the full trip.', content);
    $('[data-v5-partial-more="yes"]')?.addEventListener('click', () => { f.expanded = true; f.stage = 'choose'; f.key = ''; renderPartialActual(); });
    $('[data-v5-partial-more="no"]')?.addEventListener('click', savePartialActual);
    return;
  }

  if (f.stage === 'name') {
    const base = f.mode === 'add' && partialHasValue(f, 'other') ? String(f.draft.otherNote || '') : '';
    const content = `<div class="v5-reference"><span>${f.mode === 'add' ? 'Amount being added' : 'Other expense amount'}</span><strong>${money(f.pendingAmount)}</strong></div><div class="field-wrap"><input id="v5PartialOtherName" class="big-input" value="${esc(f.entryName || '')}" placeholder="e.g. museum tickets"></div>${base ? `<small style="display:block;margin-top:8px;color:var(--muted)">Existing note: ${esc(base)}</small>` : ''}<div class="v5-actions"><button class="btn ghost" type="button" data-v5-partial-name-back>Back</button><button class="btn primary big" type="button" data-v5-partial-name-next>Next</button></div>`;
    showOverlay('PARTIAL EXPENSES', 58, 'What was the other expense?', 'Give this expense a short name so you remember it later.', content);
    const name = $('#v5PartialOtherName'); name?.addEventListener('input', () => { f.entryName = name.value; }); setTimeout(() => name?.focus(), 0);
    $('[data-v5-partial-name-back]')?.addEventListener('click', () => { f.stage = 'amount'; renderPartialActual(); });
    $('[data-v5-partial-name-next]')?.addEventListener('click', () => { const clean = String(f.entryName || '').trim(); if (!clean) { toast('Add the name of the expense first', 'warn'); return; } commitPartialEntry(f, clean); });
    return;
  }

  const key = f.key; const label = MONEY_LABELS[key];
  if (['accom', 'travel'].includes(key)) {
    showOverlay('SHARED EXPENSE', 48, label, 'Record the total bill and your payment.', '<div id="sharedHost"></div>');
    return renderShared({ host: $('#sharedHost'), plan, key, onBack: () => { f.stage = 'choose'; f.key = ''; renderPartialActual(); }, onDone: (total, unknown) => { f.mode = 'replace'; f.entryAmount = total; f.entryUncertain = unknown; commitPartialEntry(f, ''); } });
  }
  const current = partialHasValue(f, key) ? n(f.draft[key]) : 0;
  const value = f.entryAmount || '';
  const pot = key === 'accom' ? `<div id="v5JointPot" style="margin-top:10px;font-weight:800">20% = <strong>${money((f.mode === 'add' ? current + n(value) : n(value)) * 0.20)}</strong></div>` : '';
  const modeHelp = f.mode === 'add' ? `Current total: ${money(current)}. Enter only the new ${label.toLowerCase()} expense and Twogether will add it.` : f.mode === 'replace' ? `Correct the saved total for ${label.toLowerCase()}.` : `Budgeted trip: ${plan.meta?.city || locationLabel(plan.meta)} · ${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)}`;
  const content = `${f.mode === 'add' ? `<div class="v5-reference"><span>Current saved total</span><strong>${money(current)}</strong></div>` : ''}<div class="money-input-wrap"><span>€</span><input id="v5PartialAmount" class="big-input money-field" inputmode="decimal" value="${esc(String(value))}" placeholder="0.00"></div><div class="certainty-row"><button class="certainty ${!f.entryUncertain ? 'active' : ''}" type="button" data-v5-partial-cert="exact">Exact</button><button class="certainty ${f.entryUncertain ? 'active' : ''}" type="button" data-v5-partial-cert="estimate">Not sure · estimate</button></div>${pot}<div class="v5-actions"><button class="btn ghost" type="button" data-v5-partial-back>Back</button><button class="btn primary big" type="button" data-v5-partial-next>Next</button></div>`;
  showOverlay('PARTIAL EXPENSES', 48, `${f.mode === 'add' ? 'Add another' : 'How much was'} ${label.toLowerCase()}?`, modeHelp, content);
  const input = $('#v5PartialAmount');
  input?.addEventListener('input', () => { f.entryAmount = input.value; if (key === 'accom') { const strong = $('#v5JointPot strong'); if (strong) { const shown = (f.mode === 'add' ? current + n(input.value) : n(input.value)) * 0.20; strong.textContent = money(shown); } } });
  setTimeout(() => input?.focus(), 0);
  $$('[data-v5-partial-cert]').forEach((btn) => btn.addEventListener('click', () => { f.entryUncertain = btn.dataset.v5PartialCert === 'estimate'; renderPartialActual(); }));
  $('[data-v5-partial-back]')?.addEventListener('click', () => { f.stage = f.mode === 'new' ? 'choose' : 'savedAction'; renderPartialActual(); });
  $('[data-v5-partial-next]')?.addEventListener('click', () => {
    const raw = String(f.entryAmount || '').trim();
    if (!raw || !Number.isFinite(Number(raw.replace(',', '.')))) { toast('Enter a valid amount first', 'warn'); return; }
    if (key === 'other') { f.pendingAmount = n(raw); f.pendingUncertain = !!f.entryUncertain; f.entryName = f.mode === 'replace' ? String(f.draft.otherNote || '') : ''; f.stage = 'name'; renderPartialActual(); return; }
    commitPartialEntry(f, '');
  });
}

async function savePartialActual() {
  const f = getActiveFlow(); if (!f || f.type !== 'partial') return;
  if (!hasPartial(f.draft)) { toast('Add at least one expense first', 'warn'); return; }
  const btn = $('[data-v5-partial-save],[data-v5-partial-more="no"]'); if (btn) btn.disabled = true;
  const partial = { otherNote: f.draft.otherNote || '', uncertain: { ...(f.draft.uncertain || {}) } };
  MONEY_FIELDS.forEach((key) => { partial[key] = f.draft[key] ?? ''; });
  try {
    await post('savePlanPartial', { planId: f.planId, partial });
    const plan = planById(f.planId); const a = actor();
    if (plan && a) {
      plan.partials = { ...(plan.partials || {}) };
      plan.partials[a] = JSON.parse(JSON.stringify(partial));
      renderBudgetPlans();
    }
    closeOverlay(); toast('Saved. You can keep adding expenses later.');
    setTimeout(() => refreshState(), 1600);
  } catch (err) { toast(err.message || 'Could not save partial expenses', 'warn'); if (btn) btn.disabled = false; }
}

// ---- Mismatch correction ("match the differences") ----

function mismatchSteps(trip, name) {
  const own = trip?.submissions?.[name], other = trip?.submissions?.[otherActor(name)]; if (!own || !other) return [];
  const steps = [];
  MONEY_FIELDS.forEach((key) => {
    const amountDiff = Math.abs(n(own[key]) - n(other[key])) > 0.01;
    const certaintyDiff = !!own?.uncertain?.[key] !== !!other?.uncertain?.[key];
    if (amountDiff || certaintyDiff) steps.push({ key, label: MONEY_LABELS[key], type: 'money' });
  });
  if (String(own.otherNote || '').trim().toLowerCase() !== String(other.otherNote || '').trim().toLowerCase()) steps.push({ key: 'otherNote', label: 'Other expense note', type: 'text' });
  return steps;
}

export async function startMatch(tripId) {
  const a = actor(); if (!a) return toast('Choose your profile first', 'warn');
  let trip = tripById(tripId);
  if (!trip) {
    showOverlay('MATCHING', 12, 'Opening your differences…', 'Loading the latest shared version.', '');
    try { await refreshState(); trip = tripById(tripId); } catch {}
  }
  if (!trip) { closeOverlay(); return toast('Trip not found', 'warn'); }
  const own = trip?.submissions?.[a], otherName = otherActor(a), other = trip?.submissions?.[otherName];
  if (!own || !other) return toast('Both versions need to be logged first', 'warn');
  const steps = mismatchSteps(trip, a); if (!steps.length) return toast('Your calculations already match');
  setActiveFlow({ type: 'match', tripId, name: a, otherName, other: JSON.parse(JSON.stringify(other)), original: JSON.parse(JSON.stringify(own)), draft: JSON.parse(JSON.stringify(own)), steps, index: 0 });
  document.querySelector('.tab[data-sheet="log"]')?.click();
  renderMatchFlow();
  $('#wizardCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function matchDisplay(step, submission) {
  if (step.type === 'money') return `${money(submission?.[step.key])}${submission?.uncertain?.[step.key] ? ' · estimate' : ' · exact'}`;
  if (step.type === 'certainty') return submission?.uncertain?.[step.key] ? 'Estimate' : 'Exact';
  return String(submission?.[step.key] || '—');
}

function renderMatchFlow() {
  const f = getActiveFlow(); if (!f || f.type !== 'match') return;
  const total = f.steps.length;
  if (f.index >= total) {
    const content = `<div class="v5-review">${f.steps.map((step) => `<div class="v5-review-row"><span>${esc(step.label)}</span><strong>${esc(matchDisplay(step, f.draft))}</strong></div>`).join('')}</div><div class="v5-actions"><button class="btn ghost" type="button" data-v5-match-back>Back</button><button class="btn primary big" type="button" data-v5-match-save>Save corrections</button></div>`;
    showOverlay('REVIEW', 100, 'Ready to update your version?', 'Only the answers that differed are being changed. Everything else stays untouched.', content);
    $('[data-v5-match-back]')?.addEventListener('click', () => { f.index--; renderMatchFlow(); });
    $('[data-v5-match-save]')?.addEventListener('click', saveMatch);
    return;
  }
  const step = f.steps[f.index]; const uncertain = !!f.draft?.uncertain?.[step.key];
  let control = '';
  if (step.type === 'money') control = `<div class="v5-reference"><span>${esc(f.otherName)} entered</span><strong>${esc(matchDisplay(step, f.other))}</strong><small>Your current answer: ${esc(matchDisplay(step, f.original))}</small></div><div class="money-input-wrap"><span>€</span><input id="v5MatchInput" class="big-input money-field" inputmode="decimal" value="${esc(String(f.draft?.[step.key] ?? ''))}" placeholder="${esc(String(f.other?.[step.key] ?? '0.00'))}"></div><div class="certainty-row"><button class="certainty ${!uncertain ? 'active' : ''}" type="button" data-v5-match-cert="exact">Exact</button><button class="certainty ${uncertain ? 'active' : ''}" type="button" data-v5-match-cert="estimate">Estimate</button></div><button class="v5-use" type="button" data-v5-use-other>Use ${esc(f.otherName)}’s answer</button>`;
  else if (step.type === 'certainty') control = `<div class="v5-reference"><span>${esc(f.otherName)} entered</span><strong>${esc(matchDisplay(step, f.other))}</strong><small>Your current answer: ${esc(matchDisplay(step, f.original))}</small></div><div class="certainty-row"><button class="certainty ${!uncertain ? 'active' : ''}" type="button" data-v5-match-cert="exact">Exact</button><button class="certainty ${uncertain ? 'active' : ''}" type="button" data-v5-match-cert="estimate">Estimate</button></div><button class="v5-use" type="button" data-v5-use-other>Use ${esc(f.otherName)}’s answer</button>`;
  else control = `<div class="v5-reference"><span>${esc(f.otherName)} entered</span><strong>${esc(matchDisplay(step, f.other))}</strong><small>Your current answer: ${esc(matchDisplay(step, f.original))}</small></div><div class="field-wrap"><input id="v5MatchInput" class="big-input" value="${esc(String(f.draft?.[step.key] || ''))}" placeholder="${esc(String(f.other?.[step.key] || ''))}"></div><button class="v5-use" type="button" data-v5-use-other>Use ${esc(f.otherName)}’s answer</button>`;
  control += `<div class="v5-actions"><button class="btn ghost" type="button" data-v5-match-back>${f.index === 0 ? 'Cancel' : 'Back'}</button><button class="btn primary big" type="button" data-v5-match-next>Next</button></div>`;
  showOverlay(`MATCHING ${f.index + 1} OF ${total}`, ((f.index + 1) / total) * 100, step.label, `${f.otherName}'s answer is your reference. Only this field needs attention.`, control);
  const input = $('#v5MatchInput'); input?.addEventListener('input', () => { f.draft[step.key] = input.value; }); setTimeout(() => input?.focus(), 0);
  $$('[data-v5-match-cert]').forEach((btn) => btn.addEventListener('click', () => { f.draft.uncertain = { ...(f.draft.uncertain || {}) }; f.draft.uncertain[step.key] = btn.dataset.v5MatchCert === 'estimate'; renderMatchFlow(); }));
  $('[data-v5-use-other]')?.addEventListener('click', () => {
    if (step.type === 'money') { f.draft[step.key] = String(f.other?.[step.key] ?? ''); f.draft.uncertain = { ...(f.draft.uncertain || {}) }; f.draft.uncertain[step.key] = !!f.other?.uncertain?.[step.key]; }
    else if (step.type === 'certainty') { f.draft.uncertain = { ...(f.draft.uncertain || {}) }; f.draft.uncertain[step.key] = !!f.other?.uncertain?.[step.key]; }
    else f.draft[step.key] = String(f.other?.[step.key] || '');
    renderMatchFlow();
  });
  $('[data-v5-match-back]')?.addEventListener('click', () => { if (f.index === 0) closeOverlay(); else { f.index--; renderMatchFlow(); } });
  $('[data-v5-match-next]')?.addEventListener('click', () => {
    if (step.type === 'money') {
      const value = String(f.draft?.[step.key] ?? '').trim();
      if (!value || !Number.isFinite(Number(value.replace(',', '.')))) { toast('Enter a valid amount first', 'warn'); return; }
    }
    f.index++; renderMatchFlow();
  });
}

async function saveMatch() {
  const f = getActiveFlow(); if (!f || f.type !== 'match') return;
  const btn = $('[data-v5-match-save]'); if (btn) btn.disabled = true;
  try {
    await post('saveSubmission', { tripId: f.tripId, submission: { ...f.draft, uncertain: { ...(f.draft.uncertain || {}) } } }, f.name);
    closeOverlay(); toast('Your corrections were saved');
    setTimeout(() => refreshState(), 750);
  } catch (err) { toast(err.message || 'Could not save corrections', 'warn'); if (btn) btn.disabled = false; }
}

export { startPartialActual, renderActualFlow, renderPartialActual, renderMatchFlow };
