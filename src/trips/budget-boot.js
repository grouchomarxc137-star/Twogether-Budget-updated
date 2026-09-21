// Boots the Budget Planning suite -- the migrated replacement for
// workflow.js's global click interceptor, init(), and its
// window.TwogetherWorkflow bridge (still read by trips/wizard.js and by
// still-legacy files: trip-wizard-bridge-v15.js, approved-v18.js,
// overview-v26.js, v28.js/v29.js).
import { $, $$ } from '../lib/dom.js';
import {
  getSharedState, getActiveFlow, getBypassNewTrip, refreshState, closeOverlay, installUi,
} from './budget-state.js';
import { eligibleBudgetPlans, showNewTripChoice, openBudgetOnly, renderBudgetPlans } from './budget-plans.js';
import { startMatch, renderPartialActual, renderActualFlow } from './expenses-flow.js';
import { openTripExpenseLogger } from './expense-log.js';

let lastTripId = '';

function decorateCoreWizard() {
  const body = $('#wizardBody'); if (!body) return;
  $$('[data-edit-pick]', body).forEach((btn) => {
    const strong = $('strong', btn), small = $('small', btn);
    if (strong) strong.textContent = strong.textContent.replace(/^Fix your version/, 'Match the differences');
    if (small) small.textContent = 'Only the answers that differ will be asked.';
  });
}

function bindGlobalClicks() {
  document.addEventListener('click', (event) => {
    const actualBtn = event.target.closest?.('[data-v5-actual]');
    if (actualBtn) {
      const card = actualBtn.closest('[data-v5-plan]');
      const id = card?.dataset?.v5Plan || '';
      if (id) {
        event.preventDefault(); event.stopImmediatePropagation();
        openTripExpenseLogger(id); return;
      }
    }

    const tripCard = event.target.closest?.('[data-open-trip]');
    if (tripCard) {
      lastTripId = tripCard.dataset.openTrip || '';
      refreshState().catch(() => {});
      setTimeout(() => {
        const edit = $('#tripModalBody [data-edit-own]');
        if (edit && $('#tripModalBody .difference-list')) edit.textContent = 'Match the differences';
      }, 0);
    }

    const newBtn = event.target.closest?.('[data-trip-pick="new"]');
    if (newBtn && !getBypassNewTrip()) {
      const plans = eligibleBudgetPlans();
      if (plans.length) {
        event.preventDefault(); event.stopImmediatePropagation(); showNewTripChoice(newBtn); return;
      }
    }

    const editPick = event.target.closest?.('[data-edit-pick]');
    if (editPick) {
      event.preventDefault(); event.stopImmediatePropagation(); startMatch(editPick.dataset.editPick); return;
    }

    const modalEdit = event.target.closest?.('#tripModalBody [data-edit-own]');
    if (modalEdit && lastTripId && $('#tripModalBody .difference-list')) {
      event.preventDefault(); event.stopImmediatePropagation();
      $('#tripModal')?.classList.remove('show');
      startMatch(lastTripId); return;
    }
  }, true);
}

function init() {
  installUi();
  const wizardBody = $('#wizardBody');
  if (wizardBody) {
    new MutationObserver(() => decorateCoreWizard()).observe(wizardBody, { childList: true });
    decorateCoreWizard();
  }
  document.addEventListener('twogether:budget-refreshed', () => { renderBudgetPlans(); decorateCoreWizard(); });
  bindGlobalClicks();
  refreshState().catch(() => {});
  window.addEventListener('focus', () => refreshState().catch(() => {}), { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshState().catch(() => {}); });

  window.TwogetherWorkflow = {
    refresh: refreshState,
    get state() { return getSharedState(); },
    get flow() { return getActiveFlow(); },
    start: openTripExpenseLogger,
    budget: openBudgetOnly,
    match: startMatch,
    close: closeOverlay,
    render: () => getActiveFlow()?.type === 'partial' ? renderPartialActual() : renderActualFlow(),
  };
}

// workflow.js originally used the plain "always wait for the real event"
// pattern here too (same as app.js) -- matching it exactly per the
// navigation.js lesson rather than assuming a deviation is safe.
document.addEventListener('DOMContentLoaded', init);
