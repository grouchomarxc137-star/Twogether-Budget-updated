// Shared state/infra for the Budget Planning suite (trip budget plans,
// actual/partial/match expense-logging flows). Extracted from workflow.js.
// This is a separate polling loop from trips/state.js's and shop/state.js's
// -- three independent fetches of overlapping backend data, preserved
// as-is per the same note in trips/state.js (a future cleanup, not done
// here).
import { esc, n, money, fmtDate } from '../lib/format.js';
import { actor, otherActor } from '../lib/session.js';

export const MONEY_FIELDS = ['accom', 'groceries', 'eat', 'travel', 'fuel', 'tolls', 'other'];
export const MONEY_LABELS = {
  accom: 'Accommodation', groceries: 'Groceries', eat: 'Eating out',
  travel: 'Flights / Train', fuel: 'Fuel', tolls: 'Tolls / Parking', other: 'Other',
};

let sharedState = { version: 0, plans: [], trips: [] };
let refreshPromise = null;
let activeFlow = null;

export function getSharedState() {
  return sharedState;
}

export function getSharedVersion() {
  return sharedState.version;
}

export function getActiveFlow() {
  return activeFlow;
}

export function setActiveFlow(flow) {
  activeFlow = flow;
}

// Set true while re-dispatching a click on the original "Start a new trip"
// button after the user picks "No, different trip" in showNewTripChoice --
// tells the global click interceptor (trips/budget-boot.js) to let that
// particular click through instead of re-intercepting it into a loop.
let bypassNewTrip = false;
export function getBypassNewTrip() { return bypassNewTrip; }
export function setBypassNewTrip(v) { bypassNewTrip = v; }

export function locationLabel(meta) {
  return meta?.location === 'Other' ? (meta.otherLocation || 'Other') : (meta?.location || '—');
}

export function post(action, payload, name = actor()) {
  return window.TwogetherAPI.post(action, payload, name);
}

// On every successful fetch, the original workflow.js unconditionally
// re-rendered the budget plan grid and re-decorated the wizard body --
// not opt-in per caller. Dispatching an event here (instead of a callback
// param some call site could forget to pass) preserves that "always
// happens" guarantee; trips/budget-boot.js listens and calls both.
export async function refreshState() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const state = await window.TwogetherAPI.remoteState();
      const rawPlans = Array.isArray(state?.plans) ? state.plans : [];
      const rawTrips = Array.isArray(state?.trips) ? state.trips : [];
      sharedState = { ...state, plans: rawPlans, trips: rawTrips };
      document.dispatchEvent(new CustomEvent('twogether:budget-refreshed'));
      return sharedState;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export function planById(id) { return sharedState.plans.find((p) => p.id === id); }
export function tripById(id) { return sharedState.trips.find((t) => t.id === id); }
export function tripForPlan(plan) { return plan?.linkedTripId ? tripById(plan.linkedTripId) : null; }
export function isLocked(trip) { return !!(trip?.confirmed?.Principessa && trip?.confirmed?.Principe); }

export function variance(budget, actual) {
  if (budget === '' || budget == null) return { text: 'Budget not set', cls: '' };
  if (actual === '' || actual == null) return { text: 'Actual spend not logged yet', cls: '' };
  const d = n(budget) - n(actual);
  if (Math.abs(d) < 0.01) return { text: 'Exactly on budget', cls: 'under' };
  return d > 0 ? { text: `${money(d)} under budget`, cls: 'under' } : { text: `${money(Math.abs(d))} over budget`, cls: 'over' };
}

export function partialSummary(partial) {
  if (!partial) return '';
  const parts = [];
  MONEY_FIELDS.forEach((key) => {
    if (partial[key] !== '' && partial[key] != null) {
      const note = key === 'other' && partial.otherNote ? ` (${partial.otherNote})` : '';
      parts.push(`${MONEY_LABELS[key]} ${money(partial[key])}${note}`);
    }
  });
  return parts.join(' · ');
}

export function hasPartial(partial) {
  return !!partialSummary(partial);
}

let stylesInstalled = false;
export function installStyles() {
  if (stylesInstalled || document.querySelector('#workflowV5Styles')) return;
  stylesInstalled = true;
  const style = document.createElement('style'); style.id = 'workflowV5Styles';
  style.textContent = `
    .v5-overlay{display:none;position:absolute;inset:0;z-index:8;background:var(--card,#fffefa);border-radius:29px;padding:22px;overflow:auto}.v5-overlay.show{display:flex;flex-direction:column}.wizard-card{position:relative}
    .v5-top{display:flex;justify-content:space-between;align-items:start;gap:18px}.v5-progress-side{flex:1}.v5-step{font-size:12px;font-weight:850;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.v5-progress{height:5px;background:#eee7df;border-radius:999px;margin-top:9px;overflow:hidden}.v5-progress span{display:block;height:100%;background:linear-gradient(90deg,var(--rose),var(--accent));border-radius:inherit;transition:width .2s ease}
    .v5-body{flex:1;display:flex}.v5-question{width:100%;display:flex;flex-direction:column;justify-content:center;padding:25px 18px 8px}.v5-question h2{font-size:clamp(30px,3vw,44px);font-weight:500;letter-spacing:-.035em;margin:0}.v5-question>p{color:var(--muted);margin:10px 0 22px;line-height:1.55}
    .v5-reference{background:#edf2e9;border:1px solid rgba(90,110,85,.12);border-radius:17px;padding:13px 15px;margin-bottom:12px}.v5-reference span{display:block;font-size:12px;color:var(--muted);margin-bottom:3px}.v5-reference strong{font-size:21px}.v5-reference small{display:block;color:var(--muted);margin-top:5px}
    .v5-choice-stack{display:grid;gap:10px}.v5-actions{display:flex;justify-content:space-between;gap:10px;margin-top:20px}.v5-use{width:100%;border:1px dashed #d4c9bd;background:#faf7f2;border-radius:14px;padding:10px 12px;margin-top:10px;cursor:pointer;color:var(--muted)}
    .v5-review{display:grid;gap:9px}.v5-review-row{display:flex;justify-content:space-between;gap:14px;background:#f6f2ed;border-radius:14px;padding:11px 13px}.v5-review-row span{color:var(--muted)}
    .budget-planner-section{margin:34px 0 30px}.budget-planner-head{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:15px}.budget-planner-head h2{margin:3px 0 0;font-size:30px}.budget-planner-head p{margin:5px 0 0;color:var(--muted);max-width:720px}.budget-plan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}
    .budget-plan-card{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:18px;box-shadow:0 10px 28px rgba(60,45,35,.055)}.budget-plan-top{display:flex;justify-content:space-between;gap:10px;align-items:start}.budget-plan-top h3{margin:2px 0 4px;font-size:23px}.budget-plan-top p{margin:0;color:var(--muted)}.budget-plan-status{font-size:11px;padding:6px 9px;border-radius:999px;background:#f1eee9;white-space:nowrap}.budget-plan-status.live{background:#edf2e9}.budget-plan-status.done{background:#e8f1e9}
    .budget-person-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:15px 0}.budget-person{background:#f7f3ee;border-radius:15px;padding:11px}.budget-person span{display:block;font-size:12px;color:var(--muted)}.budget-person strong{display:block;margin-top:3px;font-size:19px}.budget-person small{display:block;margin-top:4px;color:var(--muted);line-height:1.3}.budget-person.over small,.budget-total-check.over strong{color:#9d4b3e}.budget-person.under small,.budget-total-check.under strong{color:#4e7352}.budget-total-check{border-top:1px solid var(--line);padding-top:12px;display:flex;justify-content:space-between;gap:12px}.budget-total-check span{color:var(--muted)}.budget-plan-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.budget-empty{background:var(--card);border:1px dashed var(--line);border-radius:20px;padding:18px;color:var(--muted)}
    .v5-budget-modal{display:none;position:fixed;inset:0;z-index:195;place-items:center;padding:20px}.v5-budget-modal.show{display:grid}.v5-budget-backdrop{position:absolute;inset:0;background:rgba(40,34,30,.5);backdrop-filter:blur(7px)}.v5-budget-card{position:relative;width:min(690px,100%);max-height:calc(100vh - 40px);overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:28px;padding:24px;box-shadow:0 24px 80px rgba(60,45,35,.18)}.v5-budget-close{position:absolute;right:16px;top:12px;border:0;background:none;font-size:28px;cursor:pointer;color:var(--muted)}.v5-budget-card h2{margin:7px 36px 5px 0;font-size:32px}.v5-budget-card>p{color:var(--muted);margin:0 0 18px}.v5-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}.v5-field{display:grid;gap:5px}.v5-field.full{grid-column:1/-1}.v5-field label{font-size:12px;color:var(--muted)}.v5-field input,.v5-field select{width:100%;border:1px solid var(--line);background:#fff;border-radius:14px;padding:12px 13px;font:inherit;font-size:16px;outline:none}.v5-modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:18px}
    @media(max-width:640px){.budget-planner-head{align-items:start;flex-direction:column}.budget-person-grid,.v5-form{grid-template-columns:1fr}.v5-field.full{grid-column:auto}}
  `;
  document.head.appendChild(style);
}

export function installUi() {
  installStyles();
  const card = document.querySelector('#wizardCard');
  if (card && !document.querySelector('#workflowV5Overlay')) {
    const overlay = document.createElement('div'); overlay.id = 'workflowV5Overlay'; overlay.className = 'v5-overlay';
    card.appendChild(overlay);
  }
  document.querySelector('#budgetPlannerSection')?.remove();
  if (!document.querySelector('#workflowBudgetModal')) {
    const modal = document.createElement('div'); modal.id = 'workflowBudgetModal'; modal.className = 'v5-budget-modal'; modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = '<div class="v5-budget-backdrop" data-v5-budget-close></div><div class="v5-budget-card"><button class="v5-budget-close" type="button" data-v5-budget-close>×</button><div id="workflowBudgetBody"></div></div>';
    document.body.appendChild(modal);
    [...modal.querySelectorAll('[data-v5-budget-close]')].forEach((el) => el.addEventListener('click', closeBudgetModal));
  }
}

export function closeBudgetModal() {
  const modal = document.querySelector('#workflowBudgetModal');
  modal?.classList.remove('show'); modal?.setAttribute('aria-hidden', 'true');
}

export function showOverlay(stepLabel, progress, title, help, content) {
  installUi();
  const overlay = document.querySelector('#workflowV5Overlay'); if (!overlay) return;
  overlay.innerHTML = `<div class="v5-top"><div class="v5-progress-side"><div class="v5-step">${esc(stepLabel)}</div><div class="v5-progress"><span style="width:${Math.max(8, Math.min(100, progress))}%"></span></div></div><button class="text-btn" type="button" data-v5-close>Start over</button></div><div class="v5-body"><div class="v5-question"><h2>${esc(title)}</h2>${help ? `<p>${esc(help)}</p>` : ''}${content}</div></div>`;
  overlay.classList.add('show');
  overlay.querySelector('[data-v5-close]')?.addEventListener('click', closeOverlay);
}

export function closeOverlay() {
  activeFlow = null;
  const overlay = document.querySelector('#workflowV5Overlay');
  overlay?.classList.remove('show');
  if (overlay) overlay.innerHTML = '';
}

export { esc, n, money, fmtDate, actor, otherActor };
