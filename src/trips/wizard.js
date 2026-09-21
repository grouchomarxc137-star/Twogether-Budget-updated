// The "Log Trip" wizard state machine. Extracted from app.js.
//
// Circular import note: imports closeTripModal/openTripModal from
// overview.js (beginEdit/[data-add-own] need to close/navigate the modal),
// and overview.js imports beginEdit/beginJoin from here. Safe under ES
// module live bindings since neither runs at module top-level -- see the
// note at the top of overview.js.
import { $, $$ } from '../lib/dom.js';
import { esc, n, money } from '../lib/format.js';
import { actor, otherActor } from '../lib/session.js';
import { toast } from '../lib/toast.js';
import { MONEY_FIELDS, MONEY_LABELS, tripMeta, locationLabel, isLocked, differences, fmtDate } from './data.js';
import { getState, postAction } from './state.js';
import { openSheet } from '../app/navigation.js';
import { closeTripModal } from './overview.js';

let wizard = freshWizard();

const WIZARD_CATEGORIES = ['Trip', 'Accommodation', 'Transport', 'Food', 'Activities', 'Summary'];

function wizardStorageKey() {
  return `twogether:trip-wizard:v2:${actor() || 'guest'}`;
}

function readSavedWizard() {
  try {
    const raw = localStorage.getItem(wizardStorageKey());
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || !saved.mode || !saved.draft || !Number.isFinite(Number(saved.index))) return null;
    return { ...saved, index: Math.max(0, Number(saved.index) || 0), otherFlow: saved.otherFlow || null };
  } catch {
    return null;
  }
}

function saveWizardDraftLocal() {
  if (!wizard?.mode) return;
  try {
    localStorage.setItem(wizardStorageKey(), JSON.stringify({
      mode: wizard.mode,
      tripId: wizard.tripId || '',
      draft: wizard.draft,
      index: wizard.index || 0,
      otherFlow: wizard.otherFlow || null,
      savedAt: new Date().toISOString(),
    }));
  } catch {}
}

function clearSavedWizard() {
  try { localStorage.removeItem(wizardStorageKey()); } catch {}
}

function wizardCategory(step) {
  const key = step?.key || '';
  if (['tripChoice', 'location', 'otherLocation', 'city', 'start', 'end', 'budget'].includes(key)) return 'Trip';
  if (key === 'accom') return 'Accommodation';
  if (['travel', 'fuel', 'tolls'].includes(key)) return 'Transport';
  if (['groceries', 'eat'].includes(key)) return 'Food';
  if (key === 'otherFlow') return 'Activities';
  if (['paid', 'review'].includes(key)) return 'Summary';
  return 'Trip';
}

function categoryTrackerHtml(step) {
  const current = wizardCategory(step);
  const active = Math.max(0, WIZARD_CATEGORIES.indexOf(current));
  return `<div class="wizard-category-bar"><div class="wizard-category-track" aria-label="Trip logging progress">${WIZARD_CATEGORIES.map((name, index) => `<div class="wizard-category-step ${index < active ? 'done' : ''} ${index === active ? 'active' : ''}"><span>${index < active ? '✓' : index + 1}</span><small>${name}</small></div>`).join('')}</div>${wizard.mode ? '<button class="wizard-save-exit" type="button" data-wizard-save-exit>Save & exit</button>' : ''}</div>`;
}

function expenseModeHtml(step, uncertain) {
  if (!MONEY_FIELDS.includes(step.key) || step.noUncertain) return '';
  const label = MONEY_LABELS[step.key] || 'expense';
  return `<div class="expense-mode-grid"><button class="expense-mode-card ${!uncertain ? 'active' : ''}" type="button" data-certainty="exact"><span>€</span><strong>Add ${esc(label.toLowerCase())} cost</strong><small>Enter the amount you paid.</small></button><button class="expense-mode-card ${uncertain ? 'active' : ''}" type="button" data-certainty="estimate"><span>?</span><strong>Not sure of cost</strong><small>Enter your best estimate.</small></button></div>`;
}

function freshDraft() {
  return {
    location: '', otherLocation: '', city: '', start: '', end: '', budget: '',
    accom: '', groceries: '', eat: '', travel: '', fuel: '', tolls: '', other: '', otherNote: '',
    paid: '', uncertain: {},
  };
}

function freshWizard() {
  return { mode: null, tripId: '', draft: freshDraft(), index: 0, otherFlow: null };
}

export function resetWizard() {
  wizard = freshWizard();
}

export function refreshWizardIfIdle() {
  if (actor() && wizard.mode === null) renderWizard();
}

function pendingForActor() {
  return getState().trips.filter((t) => !isLocked(t) && !t?.submissions?.[actor()] && t?.submissions?.[otherActor()]);
}

function editableForActor() {
  return getState().trips.filter((t) => !isLocked(t) && !!t?.submissions?.[actor()]);
}

export function beginNew() {
  clearSavedWizard();
  wizard = { mode: 'new', tripId: '', draft: freshDraft(), index: 0, otherFlow: null };
  renderWizard();
}

export function beginJoin(id) {
  clearSavedWizard();
  const plan = window.TwogetherWorkflow?.state.plans.find((p) => p.linkedTripId === id);
  if (plan) { window.TwogetherWorkflow.start(plan.id); return; }
  const t = getState().trips.find((x) => x.id === id);
  if (!t || isLocked(t)) return;
  const meta = tripMeta(t);
  wizard = {
    mode: 'join', tripId: id, index: 0, otherFlow: null,
    draft: { ...freshDraft(), ...meta, budget: t.budget ?? '', uncertain: {} },
  };
  renderWizard();
}

export function beginEdit(id) {
  clearSavedWizard();
  const plan = window.TwogetherWorkflow?.state.plans.find((p) => p.linkedTripId === id);
  if (plan) { window.TwogetherWorkflow.start(plan.id); return; }
  const t = getState().trips.find((x) => x.id === id);
  const own = t?.submissions?.[actor()];
  if (!t || !own || isLocked(t)) return;
  const meta = tripMeta(t);
  wizard = {
    mode: 'edit', tripId: id, index: 0, otherFlow: null,
    draft: { ...freshDraft(), ...meta, ...own, budget: t.budget ?? '', uncertain: { ...(own.uncertain || {}) } },
  };
  closeTripModal();
  openSheet('log');
  renderWizard();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function flowSteps() {
  if (wizard.mode === null) {
    return [{ key: 'tripChoice', title: 'Which trip are you logging?', type: 'tripChoice' }];
  }

  const moneySteps = [
    { key: 'accom', title: 'How much was accommodation?', type: 'money' },
    { key: 'travel', title: 'How much on flights or trains?', type: 'money' },
    { key: 'fuel', title: 'How much on fuel?', type: 'money' },
    { key: 'tolls', title: 'How much on tolls or parking?', type: 'money' },
    { key: 'groceries', title: 'How much on groceries?', type: 'money' },
    { key: 'eat', title: 'How much on eating out?', type: 'money' },
    { key: 'otherFlow', title: 'Other expenses', type: 'otherExpenses' },
    { key: 'paid', title: `How much did ${actor()} actually pay?`, type: 'money', optional: true, noUncertain: true },
    { key: 'review', title: wizard.mode === 'edit' ? 'Save your corrected version?' : 'Ready to save your version?', type: 'review' },
  ];

  if (wizard.mode === 'join' || wizard.mode === 'edit') return moneySteps.filter((s) => !s.when || s.when(wizard.draft));

  const locationExample = wizard.draft.location === 'Italy' ? 'Lonato del Garda' :
    wizard.draft.location === 'Portugal' ? 'Lisbon' :
    wizard.draft.location === 'Netherlands' ? 'Tilburg' : 'your city or area';

  return [
    { key: 'location', title: 'Where was this trip?', help: 'Choose the main country.', type: 'choice', options: ['Italy', 'Netherlands', 'Portugal', 'Other'] },
    { key: 'otherLocation', title: 'What country or place was it?', type: 'text', placeholder: 'e.g. Tunisia', when: (d) => d.location === 'Other' },
    { key: 'city', title: 'Which city or area?', help: `For example: ${locationExample}.`, type: 'text', placeholder: `e.g. ${locationExample}` },
    { key: 'start', title: 'When did the trip start?', type: 'date' },
    { key: 'end', title: 'When did it end?', type: 'date' },
    { key: 'budget', title: 'What is your ideal total budget for this trip?', help: 'Enter your own budget. Your partner adds theirs separately.', type: 'budget', optional: true },
    ...moneySteps,
  ].filter((s) => !s.when || s.when(wizard.draft));
}

function currentStep() {
  const steps = flowSteps();
  if (wizard.index >= steps.length) wizard.index = Math.max(0, steps.length - 1);
  return steps[wizard.index];
}

function contextBanner() {
  if (wizard.mode !== 'join' && wizard.mode !== 'edit') return '';
  const t = getState().trips.find((x) => x.id === wizard.tripId);
  const m = tripMeta(t);
  const verb = wizard.mode === 'edit' ? 'Editing your calculations for' : 'Adding your calculations to';
  return `<div class="existing-trip-context"><strong>${verb} ${esc(m.city || locationLabel(m))}</strong><span>${esc(locationLabel(m))} · ${fmtDate(m.start)}–${fmtDate(m.end)}</span></div>`;
}

function ensureOtherFlow() {
  if (!wizard.otherFlow) {
    const existing = n(wizard.draft.other);
    wizard.otherFlow = {
      stage: 'amount', items: [],
      amount: existing > 0 ? String(wizard.draft.other ?? existing) : '',
      name: existing > 0 ? String(wizard.draft.otherNote || '') : '',
      uncertain: !!wizard.draft?.uncertain?.other,
    };
  }
  return wizard.otherFlow;
}

function syncOtherDraft() {
  const f = ensureOtherFlow();
  const total = f.items.reduce((sum, item) => sum + n(item.amount), 0);
  wizard.draft.other = String(total);
  wizard.draft.otherNote = f.items.map((item) => `${item.name} · ${money(item.amount)}`).join(' + ');
  wizard.draft.uncertain = { ...(wizard.draft.uncertain || {}) };
  wizard.draft.uncertain.other = f.items.some((item) => !!item.uncertain);
}

function otherFlowTitle() {
  const f = ensureOtherFlow();
  if (f.stage === 'name') return 'What was this expense?';
  if (f.stage === 'more') return 'Any more other expenses?';
  return f.items.length ? 'How much was the next other expense?' : 'Any other expenses?';
}

function otherCollectedHtml() {
  const f = ensureOtherFlow();
  if (!f.items.length) return '';
  return `<div class="v5-review">${f.items.map((item) => `<div class="v5-review-row"><span>${esc(item.name)}</span><strong>${item.uncertain ? '~ ' : ''}${money(item.amount)}</strong></div>`).join('')}</div>`;
}

function otherExpensesControl() {
  const f = ensureOtherFlow();
  const list = otherCollectedHtml();
  if (f.stage === 'name') {
    return `${list}<div class="v5-reference"><span>Amount</span><strong>${f.uncertain ? '~ ' : ''}${money(f.amount)}</strong></div><div class="field-wrap"><input id="wizardOtherName" class="big-input" type="text" value="${esc(f.name || '')}" placeholder="e.g. museum tickets"></div><div class="wizard-actions"><button class="btn ghost" type="button" data-other-back>Back</button><button class="btn primary big" type="button" data-other-next>Next</button></div>`;
  }
  if (f.stage === 'more') {
    return `${list}<div class="choice-grid"><button class="choice" type="button" data-other-more="yes">Yes, add another</button><button class="choice" type="button" data-other-more="no">No, continue</button></div>`;
  }
  return `${list}<div class="${f.uncertain ? 'uncertain-mode' : ''}"><div class="money-input-wrap"><span>€</span><input id="wizardOtherAmount" class="big-input money-field" inputmode="decimal" value="${esc(f.amount || '')}" placeholder="0.00"></div><div class="certainty-row"><button class="certainty ${!f.uncertain ? 'active' : ''}" type="button" data-other-certainty="exact">Exact</button><button class="certainty ${f.uncertain ? 'active' : ''}" type="button" data-other-certainty="estimate">Not sure · estimate</button></div>${f.items.length ? '' : '<button class="btn ghost full" type="button" data-other-none>No other expenses</button>'}</div><div class="wizard-actions"><button class="btn ghost" type="button" data-other-back>Back</button><button class="btn primary big" type="button" data-other-next>Next</button></div>`;
}

export function renderWizard() {
  const body = $('#wizardBody');
  if (!body || !actor()) return;
  const steps = flowSteps();
  const s = currentStep();
  if (s.type === 'otherExpenses') s.title = otherFlowTitle();
  const stepEl = $('#wizardStep');
  const progress = $('#wizardProgress');

  if (s.type === 'review') {
    if (stepEl) stepEl.textContent = 'Review';
  } else {
    const questionCount = steps.filter((x) => x.type !== 'review').length;
    const questionNumber = steps.slice(0, wizard.index + 1).filter((x) => x.type !== 'review').length;
    if (stepEl) stepEl.textContent = `Question ${Math.max(1, questionNumber)} of ${Math.max(1, questionCount)}`;
  }
  if (progress) progress.style.width = `${Math.max(8, ((wizard.index + 1) / Math.max(1, steps.length)) * 100)}%`;

  let control = '';
  if (s.type === 'otherExpenses') {
    control = otherExpensesControl();
  } else if (s.type === 'tripChoice') {
    const pending = pendingForActor();
    const editable = editableForActor().filter((t) => t.submissions?.Principessa && t.submissions?.Principe && differences(t).length);
    const saved = readSavedWizard();
    const savedCity = saved?.draft?.city || 'your saved trip';
    control = `${saved ? `<button class="wizard-resume-card" type="button" data-wizard-resume><span>↻</span><div><strong>Continue where you left off</strong><small>${esc(savedCity)} · your answers are saved on this device.</small></div><b>Continue →</b></button>` : ''}<div class="trip-choice-stack">
      <button class="trip-pick new-trip-pick" data-trip-pick="new" type="button"><span class="pick-icon">＋</span><div><strong>Start a new trip</strong><small>Log location, dates, planned budget and your expenses.</small></div></button>
      ${pending.map((t) => {
        const m = tripMeta(t);
        return `<button class="trip-pick" data-trip-pick="${esc(t.id)}" type="button"><span class="pick-icon">↔</span><div><strong>Add your version · ${esc(m.city || locationLabel(m))}</strong><small>${fmtDate(m.start)}–${fmtDate(m.end)} · only expense questions</small></div></button>`;
      }).join('')}
      ${editable.map((t) => {
        const m = tripMeta(t);
        return `<button class="trip-pick" data-edit-pick="${esc(t.id)}" type="button"><span class="pick-icon">✎</span><div><strong>Fix your version · ${esc(m.city || locationLabel(m))}</strong><small>Your two calculations currently differ.</small></div></button>`;
      }).join('')}
    </div>`;
  } else if (s.type === 'choice') {
    control = `<div class="choice-grid">${s.options.map((o) => `<button class="choice" type="button" data-choice="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
  } else if (s.type === 'text' || s.type === 'date') {
    control = `<div class="field-wrap"><input id="wizardInput" class="big-input" type="${s.type === 'date' ? 'date' : 'text'}" value="${esc(wizard.draft[s.key] || '')}" placeholder="${esc(s.placeholder || '')}"></div>`;
  } else if (s.type === 'money' || s.type === 'moneyOrNone' || s.type === 'budget') {
    const value = wizard.draft[s.key] ?? '';
    const isUncertain = !!wizard.draft.uncertain?.[s.key];
    control = `<div class="${isUncertain ? 'uncertain-mode' : ''}">
      ${expenseModeHtml(s, isUncertain)}
      <div class="money-input-wrap"><span>€</span><input id="wizardInput" class="big-input money-field" inputmode="decimal" value="${esc(value)}" placeholder="0.00"></div>
      ${isUncertain ? '<div class="estimate-note">This amount will count in totals but stay marked as an estimate.</div>' : ''}
      ${s.type === 'moneyOrNone' ? '<button class="btn ghost full" type="button" data-none> No other expenses </button>' : ''}
      ${s.type === 'budget' ? '<button class="btn ghost full" type="button" data-skip-budget>Skip budget</button>' : ''}
    </div>`;
  } else if (s.type === 'review') {
    control = reviewHtml();
  }

  const help = s.type === 'tripChoice'
    ? `Start a new trip, or add your version to one ${otherActor()} already logged.`
    : (s.help || (wizard.mode === 'join' ? 'The trip details are already shared. Only enter your expense calculations.' : wizard.mode === 'edit' ? 'Correct only the calculations that need changing.' : ''));

  body.innerHTML = `<div class="question-stage">${categoryTrackerHtml(s)}${contextBanner()}<h2>${esc(s.title)}</h2>${help ? `<p>${esc(help)}</p>` : ''}${control}${wizardActions(s)}</div>`;
  bindWizard(s);
  saveWizardDraftLocal();
}

function wizardActions(s) {
  if (s.type === 'tripChoice' || s.type === 'review' || s.type === 'otherExpenses') return '';
  const back = `<button class="btn ghost" type="button" data-wizard-back>← Back</button>`;
  if (s.type === 'choice') return `<div class="wizard-actions single-back">${back}</div>`;
  const optional = s.optional;
  return `<div class="wizard-actions">${back}<button class="btn primary big" type="button" data-wizard-next>${optional ? 'Continue' : 'Next'} →</button></div>`;
}

function reviewHtml() {
  const d = wizard.draft;
  const total = MONEY_FIELDS.reduce((sum, k) => sum + n(d[k]), 0);
  const estimate = MONEY_FIELDS.some((k) => d?.uncertain?.[k]);
  const submitLabel = wizard.mode === 'edit' ? 'Update my version' : 'Save my version';
  return `<div class="review-card">
    <div class="review-total ${estimate ? 'estimate-total' : ''}"><span>Your trip calculation</span><strong>${estimate ? '~ ' : ''}${money(total)}</strong><small>${d.budget ? `Planned budget ${money(d.budget)}` : 'No planned budget'}</small></div>
    <div class="review-grid">
      <div><span>Trip</span><strong>${esc(d.city || locationLabel(d))}</strong></div>
      <div><span>Dates</span><strong>${fmtDate(d.start)}–${fmtDate(d.end)}</strong></div>
      ${MONEY_FIELDS.map((k) => `<div class="${d?.uncertain?.[k] ? 'uncertain-review' : ''}"><span>${esc(MONEY_LABELS[k])}</span><strong>${d?.uncertain?.[k] ? '~ ' : ''}${money(d[k])}</strong></div>`).join('')}
      <div><span>${esc(actor())} paid</span><strong>${money(d.paid)}</strong></div>
    </div>
  </div><div class="wizard-actions"><button class="btn ghost" type="button" data-wizard-back>Back</button><button class="btn primary big" type="button" data-save-version>${esc(submitLabel)}</button></div>`;
}

function bindWizard(s) {
  $('[data-wizard-resume]')?.addEventListener('click', () => {
    const saved = readSavedWizard();
    if (!saved) return;
    wizard = saved;
    renderWizard();
  });
  $('[data-wizard-save-exit]')?.addEventListener('click', () => {
    saveWizardDraftLocal();
    wizard = freshWizard();
    renderWizard();
    toast('Saved. You can continue from here later.');
  });
  $$('[data-trip-pick]').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.dataset.tripPick;
    id === 'new' ? beginNew() : beginJoin(id);
  }));
  $$('[data-edit-pick]').forEach((btn) => btn.addEventListener('click', () => beginEdit(btn.dataset.editPick)));
  $$('[data-choice]').forEach((btn) => btn.addEventListener('click', () => {
    wizard.draft[s.key] = btn.dataset.choice;
    wizard.index++;
    renderWizard();
  }));

  if (s.type === 'otherExpenses') {
    const f = ensureOtherFlow();
    const amountInput = $('#wizardOtherAmount');
    const nameInput = $('#wizardOtherName');
    amountInput?.addEventListener('input', () => { f.amount = amountInput.value; });
    nameInput?.addEventListener('input', () => { f.name = nameInput.value; });
    setTimeout(() => { (amountInput || nameInput)?.focus(); }, 0);
    $$('[data-other-certainty]').forEach((btn) => btn.addEventListener('click', () => {
      f.uncertain = btn.dataset.otherCertainty === 'estimate'; renderWizard();
    }));
    $('[data-other-none]')?.addEventListener('click', () => {
      f.items = []; wizard.draft.other = '0'; wizard.draft.otherNote = ''; wizard.draft.uncertain.other = false; wizard.index++; renderWizard();
    });
    $('[data-other-more="yes"]')?.addEventListener('click', () => {
      f.stage = 'amount'; f.amount = ''; f.name = ''; f.uncertain = false; renderWizard();
    });
    $('[data-other-more="no"]')?.addEventListener('click', () => {
      syncOtherDraft(); wizard.index++; renderWizard();
    });
    $('[data-other-back]')?.addEventListener('click', () => {
      if (f.stage === 'name') { f.stage = 'amount'; renderWizard(); return; }
      if (f.stage === 'more') { f.stage = 'name'; const last = f.items.pop(); if (last) { f.amount = String(last.amount); f.name = last.name; f.uncertain = !!last.uncertain; syncOtherDraft(); } renderWizard(); return; }
      if (f.items.length) { f.stage = 'more'; renderWizard(); return; }
      if (wizard.index > 0) { wizard.index--; renderWizard(); } else { wizard = freshWizard(); renderWizard(); }
    });
    $('[data-other-next]')?.addEventListener('click', () => {
      if (f.stage === 'amount') {
        const value = String(f.amount || '').trim();
        if (!value || !Number.isFinite(Number(value.replace(',', '.')))) { toast('Enter a valid amount', 'warn'); return; }
        f.stage = 'name'; renderWizard(); return;
      }
      if (f.stage === 'name') {
        const name = String(f.name || '').trim();
        if (!name) { toast('Add the name of the expense first', 'warn'); return; }
        f.items.push({ amount: String(f.amount), name, uncertain: !!f.uncertain });
        syncOtherDraft(); f.amount = ''; f.name = ''; f.uncertain = false; f.stage = 'more'; renderWizard();
      }
    });
    return;
  }

  const input = $('#wizardInput');
  if (input) {
    input.addEventListener('input', () => {
      let v = input.value;
      if (MONEY_FIELDS.includes(s.key) || s.key === 'paid' || s.key === 'budget') {
        if (v === '-') {
          if (MONEY_FIELDS.includes(s.key)) wizard.draft.uncertain[s.key] = true;
          v = ''; input.value = '';
        }
      }
      wizard.draft[s.key] = v;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && s.type !== 'date') {
        e.preventDefault();
        $('[data-wizard-next]')?.click();
      }
    });
    setTimeout(() => input.focus(), 0);
  }

  $$('[data-certainty]').forEach((btn) => btn.addEventListener('click', () => {
    wizard.draft.uncertain[s.key] = btn.dataset.certainty === 'estimate';
    renderWizard();
  }));
  $('[data-none]')?.addEventListener('click', () => {
    wizard.draft.other = '0'; wizard.draft.uncertain.other = false; wizard.index++; renderWizard();
  });
  $('[data-skip-budget]')?.addEventListener('click', () => {
    wizard.draft.budget = ''; wizard.index++; renderWizard();
  });
  $('[data-wizard-back]')?.addEventListener('click', () => {
    if (wizard.index > 0) { wizard.index--; renderWizard(); }
    else { wizard = freshWizard(); renderWizard(); }
  });
  $('[data-wizard-next]')?.addEventListener('click', () => {
    const value = String(wizard.draft[s.key] ?? '').trim();
    if (!s.optional && !value) { toast('Add an answer first', 'warn'); return; }
    if ((MONEY_FIELDS.includes(s.key) || s.key === 'paid' || s.key === 'budget') && value && !Number.isFinite(Number(value.replace(',', '.')))) {
      toast('Enter a valid amount', 'warn'); return;
    }
    wizard.index++;
    renderWizard();
  });
  $('[data-save-version]')?.addEventListener('click', saveWizardVersion);
}

async function saveWizardVersion() {
  const btn = $('[data-save-version]');
  if (btn) btn.disabled = true;
  const payload = {
    tripId: wizard.mode === 'new' ? '' : wizard.tripId,
    submission: { ...wizard.draft, uncertain: { ...wizard.draft.uncertain } },
    budget: wizard.mode === 'new' ? wizard.draft.budget : undefined,
  };
  try {
    await postAction('saveSubmission', payload, actor());
    toast(wizard.mode === 'edit' ? 'Your version was updated' : 'Your version was saved');
    clearSavedWizard();
    wizard = freshWizard();
    renderWizard();
  } catch (err) {
    toast(err.message || 'Could not save', 'warn');
    if (btn) btn.disabled = false;
  }
}

export function bindRestartWizard() {
  $('#restartWizard')?.addEventListener('click', () => { clearSavedWizard(); wizard = freshWizard(); renderWizard(); });
}
