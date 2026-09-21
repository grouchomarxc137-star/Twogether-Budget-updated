// Intercepts the Log Trip wizard at the final budget step and saves the
// trip as a Plan. New-trip creation ends there; expenses are managed later
// from Current Trips > Open trip. Legacy join/edit compatibility remains in
// trips/wizard.js for older unmatched records.
import { $ } from '../lib/dom.js';
import { esc } from '../lib/format.js';
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
  body.innerHTML = `<div class="question-stage bridge15-scope-stage"><h2>Trip saved</h2><p><strong>${esc(city)}</strong> is now under Current Trips. Expenses can be added later from Open trip.</p><div class="wizard-actions"><button class="btn primary big" type="button" data-bridge15-done>Done</button></div></div>`;
  body.querySelector('[data-bridge15-done]')?.addEventListener('click',()=>$('#restartWizard')?.click());
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

}
