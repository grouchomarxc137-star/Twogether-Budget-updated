// Intercepts the Log Trip wizard at the "ideal total budget" step and
// reroutes it into saving a budget Plan, then offers a scope choice
// (budget-only / some expenses / all expenses). Extracted from
// trip-wizard-bridge-v15.js. Pairs with trips/wizard.js and
// trips/budget-plans.js/expenses-flow.js via the window.TwogetherWorkflow
// bridge, same as the original.
import { $ } from '../lib/dom.js';
import { esc, n, money } from '../lib/format.js';
import { actor } from '../lib/session.js';
import { toast } from '../lib/toast.js';

let meta = {};
let creating = false;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function heading() { return $('#wizardBody h2')?.textContent?.trim() || ''; }
function post(action, payload) { return window.TwogetherAPI.post(action, payload, actor()); }
function resetMeta() { meta = {}; }

function captureCurrent() {
  const h = heading();
  const input = $('#wizardInput');
  if (!input) return;
  if (/country or place/i.test(h)) meta.otherLocation = input.value;
  else if (/Which city or area/i.test(h)) meta.city = input.value;
  else if (/trip start/i.test(h)) meta.start = input.value;
  else if (/When did it end/i.test(h)) meta.end = input.value;
}

function validMeta() {
  const location = meta.location || '';
  const otherLocation = location === 'Other' ? String(meta.otherLocation || '').trim() : '';
  return {
    location, otherLocation,
    city: String(meta.city || '').trim(),
    start: String(meta.start || '').trim(),
    end: String(meta.end || '').trim(),
  };
}

async function createPlanFromMainWizard(budget) {
  if (creating) return;
  const a = actor();
  const m = validMeta();
  if (!a) { toast('Choose a profile first', 'warn'); return; }
  if (!m.location || !m.city || !m.start || !m.end || (m.location === 'Other' && !m.otherLocation)) {
    toast('Trip details are incomplete. Go back and check location and dates.', 'warn');
    return;
  }

  creating = true;
  const body = $('#wizardBody');
  if (body) body.innerHTML = '<div class="bridge15-saving"><strong>Saving your trip…</strong><span>This should only take a moment.</span></div>';

  try {
    const result = await post('savePlan', { meta: m, budget: String(budget) });
    if (!result?.planId) throw new Error('The trip could not be confirmed as saved. Please retry once.');

    const created = { id: result.planId, meta: m, createdBy: a };
    showScope(created);

    Promise.resolve(window.TwogetherWorkflow?.refresh?.()).catch(() => {});
    window.dispatchEvent(new Event('focus'));
  } catch (err) {
    toast(err.message || 'Could not save the trip', 'warn');
    $('#restartWizard')?.click();
  } finally {
    creating = false;
  }
}

function showScope(plan) {
  const body = $('#wizardBody'); if (!body) return;
  const city = plan?.meta?.city || 'this trip';
  const step = $('#wizardStep'); if (step) step.textContent = 'Trip saved';
  const progress = $('#wizardProgress'); if (progress) progress.style.width = '100%';
  body.innerHTML = `<div class="question-stage bridge15-scope-stage">
    <h2>What do you want to log now?</h2>
    <p><strong>${esc(city)}</strong> is now under Current Trips. You can stop here or add expenses now.</p>
    <div class="bridge15-scope">
      <button class="trip-pick" type="button" data-bridge15-scope="budget"><span class="pick-icon">✓</span><div><strong>Budget only for now</strong><small>Add expenses later from Current Trips.</small></div></button>
      <button class="trip-pick" type="button" data-bridge15-scope="some"><span class="pick-icon">＋</span><div><strong>Log some expenses</strong><small>Choose only the categories you want to add now.</small></div></button>
      <button class="trip-pick" type="button" data-bridge15-scope="all"><span class="pick-icon">→</span><div><strong>Log all expenses</strong><small>Continue through the full trip expense flow.</small></div></button>
    </div>
  </div>`;

  body.querySelectorAll('[data-bridge15-scope]').forEach((btn) => btn.addEventListener('click', () => {
    const mode = btn.dataset.bridge15Scope;
    if (mode === 'budget') {
      $('#restartWizard')?.click();
      setTimeout(() => $('#twCurrentTripsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
      return;
    }
    launchPlanExpenses(plan.id, mode);
  }));
}

async function launchPlanExpenses(planId, mode) {
  try { await window.TwogetherWorkflow?.refresh?.(); } catch {}

  if (window.TwogetherWorkflow?.start) {
    window.TwogetherWorkflow.start(planId);
  } else {
    const actual = $(`#budgetPlanGrid [data-v5-plan="${window.CSS?.escape ? CSS.escape(planId) : planId}"] [data-v5-actual]`);
    if (actual) actual.click();
  }

  const wanted = mode === 'some' ? 'partial' : 'full';
  for (let i = 0; i < 16; i++) {
    const btn = $(`[data-v5-actual-mode="${wanted}"]`);
    if (btn) { btn.click(); return; }
    await sleep(80);
  }
  toast('The trip is saved. Open it from Current Trips to add expenses.', 'warn');
}

function enhanceAccommodation20() {
  const h = heading();
  const input = $('#wizardInput');
  if (!/How much was accommodation/i.test(h) || !input) return;
  const wrap = input.closest('.money-input-wrap');
  if (!wrap) return;
  let calc = $('#bridge15Accommodation20');
  if (!calc) {
    calc = document.createElement('div');
    calc.id = 'bridge15Accommodation20';
    calc.className = 'bridge15-20';
    wrap.insertAdjacentElement('afterend', calc);
  }
  const update = () => { const html = `20% = <strong>${money(n(input.value) * 0.20)}</strong>`; if (calc.innerHTML !== html) calc.innerHTML = html; };
  if (input.dataset.bridge15Calc !== '1') {
    input.dataset.bridge15Calc = '1';
    input.addEventListener('input', update);
  }
  update();
}

export function installWizardBridge() {
  document.addEventListener('click', (e) => {
    const newTrip = e.target.closest?.('[data-trip-pick="new"]');
    if (newTrip) { resetMeta(); return; }

    const choice = e.target.closest?.('#wizardBody [data-choice]');
    if (choice && /Where was this trip/i.test(heading())) meta.location = choice.dataset.choice || '';

    const target = e.target.closest?.('#wizardBody [data-wizard-next], #wizardBody [data-skip-budget]');
    if (!target) return;

    const h = heading();
    if (!/ideal total budget/i.test(h)) {
      if (target.matches('[data-wizard-next]')) captureCurrent();
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();
    const input = $('#wizardInput');
    const skipped = target.matches('[data-skip-budget]');
    const raw = String(input?.value || '').trim();
    if (!skipped && (!raw || !Number.isFinite(Number(raw.replace(',', '.'))))) { toast('Enter a valid budget, or choose Skip budget.', 'warn'); return; }
    createPlanFromMainWizard(skipped ? '0' : raw);
  }, true);

  document.addEventListener('click', (e) => {
    if (e.target.closest?.('#restartWizard')) resetMeta();
  }, false);

  const body = $('#wizardBody');
  if (body) { new MutationObserver(() => requestAnimationFrame(enhanceAccommodation20)).observe(body, { childList: true, subtree: true }); }
  enhanceAccommodation20();
}
