import './trip-planner-polish.css';
import { $, } from '../lib/dom.js';
import { toast } from '../lib/toast.js';
import { actor, esc, installUi, closeBudgetModal, post, refreshState } from './budget-state.js';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const CITY_EXAMPLES = {
  Italy: 'Lonato del Garda',
  Netherlands: 'Amsterdam',
  Portugal: 'Lisbon',
  Other: 'Tunis',
};

let draft = null;
let monthCursor = null;

function iso(year, month, day) {
  return [year, String(month + 1).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
}

function localDate(value) {
  const parts = String(value || '').split('-').map(Number);
  if (parts.length !== 3 || !parts.every(Number.isFinite)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function dateLabel(value) {
  const date = localDate(value);
  return date ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date) : '';
}

function dayCount(start, end) {
  const a = localDate(start), b = localDate(end);
  if (!a || !b) return 0;
  return Math.floor((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000) + 1;
}

function updateCityExample() {
  const input = $('#v5PlanCity');
  if (!input || !draft) return;
  const example = CITY_EXAMPLES[draft.location] || 'City or area';
  input.placeholder = 'e.g. ' + example;
}

function updateSummary() {
  const summary = $('#v5PlanDateSummary');
  const count = $('#v5PlanDateCount');
  if (!summary || !count || !draft) return;

  if (!draft.start) {
    summary.textContent = 'Choose your dates';
    count.textContent = 'Select start + end';
    return;
  }
  if (!draft.end) {
    summary.textContent = dateLabel(draft.start) + ' → choose end';
    count.textContent = 'Start selected';
    return;
  }

  const days = dayCount(draft.start, draft.end);
  summary.textContent = dateLabel(draft.start) + ' — ' + dateLabel(draft.end);
  count.textContent = days + (days === 1 ? ' day total' : ' days total');
}

function renderCalendar() {
  const root = $('#v5PlanCalendar');
  if (!root || !draft || !monthCursor) return;

  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const cells = [];

  for (let i = 0; i < firstOffset; i++) cells.push('<span class="plan-cal-empty"></span>');
  for (let day = 1; day <= lastDay; day++) {
    const value = iso(year, month, day);
    const start = value === draft.start;
    const end = value === draft.end;
    const between = !!(draft.start && draft.end && value > draft.start && value < draft.end);
    const selected = start || end || between;
    const cls = ['plan-cal-day', start ? 'start' : '', end ? 'end' : '', between ? 'in-range' : '', (draft.end && (start || end)) ? 'has-range' : ''].filter(Boolean).join(' ');
    cells.push('<button type="button" class="' + cls + '" data-plan-date="' + value + '" aria-label="' + esc(dateLabel(value)) + '" aria-pressed="' + (selected ? 'true' : 'false') + '"><span>' + day + '</span></button>');
  }

  const total = draft.end ? dayCount(draft.start, draft.end) : 0;
  const hint = !draft.start ? 'Choose your arrival date' : (!draft.end ? 'Now choose your return date' : 'Your selected trip range');
  root.innerHTML =
    '<div class="plan-cal-head"><button type="button" data-plan-month="-1" aria-label="Previous month">‹</button><div><small>TRIP DATES</small><strong>' + MONTHS[month] + ' ' + year + '</strong></div><button type="button" data-plan-month="1" aria-label="Next month">›</button></div>' +
    '<p class="plan-cal-hint">' + hint + '</p>' +
    '<div class="plan-cal-weekdays">' + WEEKDAYS.map((day) => '<span>' + day + '</span>').join('') + '</div>' +
    '<div class="plan-cal-grid">' + cells.join('') + '</div>' +
    '<div class="plan-cal-footer"><div><span>Selected dates</span><strong>' +
      (draft.start ? esc(dateLabel(draft.start)) : 'Choose start') +
      (draft.end ? ' — ' + esc(dateLabel(draft.end)) : '') +
      '</strong><small>' +
      (draft.end ? total + (total === 1 ? ' day total' : ' days total') : 'Pick the start, then the end') +
      '</small></div><button type="button" class="btn primary" data-plan-apply ' + (!draft.end ? 'disabled' : '') + '>Apply</button></div>';

  root.querySelectorAll('[data-plan-month]').forEach((button) => button.addEventListener('click', () => {
    monthCursor = new Date(year, month + Number(button.dataset.planMonth), 1);
    renderCalendar();
  }));

  root.querySelectorAll('[data-plan-date]').forEach((button) => button.addEventListener('click', () => {
    const value = button.dataset.planDate;
    if (!draft.start || draft.end) {
      draft.start = value;
      draft.end = '';
    } else if (value < draft.start) {
      draft.start = value;
      draft.end = '';
    } else {
      draft.end = value;
    }
    updateSummary();
    renderCalendar();
  }));

  root.querySelector('[data-plan-apply]')?.addEventListener('click', () => {
    if (!draft.end) return;
    root.classList.add('hidden');
    $('#v5PlanDateToggle')?.classList.remove('open');
  });
}

function showModal() {
  installUi();
  const modal = $('#workflowBudgetModal');
  const body = $('#workflowBudgetBody');
  if (!modal || !body) return;

  body.innerHTML =
    '<div class="plan-trip-modal-head"><span class="panel-kicker">PLAN A TRIP</span><h2>Where are you going?</h2><p>Just the essentials. Expenses can be added later from Open trip.</p></div>' +
    '<div class="plan-trip-form">' +
      '<div class="plan-trip-field"><label>Country</label><select id="v5PlanLocation"><option value="Italy">🇮🇹 Italy</option><option value="Netherlands">🇳🇱 Netherlands</option><option value="Portugal">🇵🇹 Portugal</option><option value="Other">✦ Other</option></select></div>' +
      '<div class="plan-trip-field hidden" id="v5PlanOtherWrap"><label>Country / place</label><input id="v5PlanOther" placeholder="e.g. Tunisia"></div>' +
      '<div class="plan-trip-field full"><label>City / area</label><input id="v5PlanCity" placeholder="e.g. Lonato del Garda" autocomplete="address-level2"></div>' +
      '<div class="plan-trip-field full"><label>Dates</label><button id="v5PlanDateToggle" class="plan-date-toggle" type="button"><span><small>Trip dates</small><strong id="v5PlanDateSummary">Choose your dates</strong></span><b id="v5PlanDateCount">Select start + end</b><i aria-hidden="true">⌄</i></button><div id="v5PlanCalendar" class="plan-calendar hidden"></div></div>' +
      '<div class="plan-trip-field full"><label>Budget <span>optional</span></label><div class="plan-budget-input"><span>€</span><input id="v5PlanBudget" inputmode="decimal" placeholder="0"></div><small>You can add or change your budget later.</small></div>' +
    '</div>' +
    '<div class="plan-trip-actions"><button class="btn ghost" type="button" data-plan-cancel>Cancel</button><button class="btn primary" type="button" data-plan-save>Save trip</button></div>';

  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function bindForm() {
  const location = $('#v5PlanLocation');
  const otherWrap = $('#v5PlanOtherWrap');
  const calendar = $('#v5PlanCalendar');
  const dateToggle = $('#v5PlanDateToggle');

  location?.addEventListener('change', () => {
    draft.location = location.value;
    otherWrap?.classList.toggle('hidden', draft.location !== 'Other');
    if (draft.location !== 'Other') draft.otherLocation = '';
    updateCityExample();
  });
  $('#v5PlanOther')?.addEventListener('input', (event) => { draft.otherLocation = event.target.value; });
  $('#v5PlanCity')?.addEventListener('input', (event) => { draft.city = event.target.value; });
  $('#v5PlanBudget')?.addEventListener('input', (event) => { draft.budget = event.target.value; });

  dateToggle?.addEventListener('click', () => {
    const opening = calendar?.classList.contains('hidden');
    calendar?.classList.toggle('hidden', !opening);
    dateToggle.classList.toggle('open', !!opening);
    if (opening) {
      renderCalendar();
      if (window.matchMedia('(max-width: 700px)').matches) {
        setTimeout(() => calendar?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 40);
      }
    }
  });

  $('[data-plan-cancel]')?.addEventListener('click', closeBudgetModal);
  $('[data-plan-save]')?.addEventListener('click', saveTrip);
  updateCityExample();
  updateSummary();
}

async function saveTrip() {
  if (!draft) return;
  const name = actor();
  if (!name) { toast('Choose your profile first', 'warn'); return; }

  const meta = {
    location: draft.location || '',
    otherLocation: draft.location === 'Other' ? String(draft.otherLocation || '').trim() : '',
    city: String(draft.city || '').trim(),
    start: draft.start || '',
    end: draft.end || '',
  };
  const budget = String(draft.budget || '').trim();

  if (!meta.location || (!meta.city && meta.location !== 'Italy') || !meta.start || !meta.end || (meta.location === 'Other' && !meta.otherLocation)) {
    toast(meta.location === 'Italy' ? 'Choose the trip dates first' : 'Add the destination and choose the trip dates first', 'warn');
    return;
  }
  if (budget && !Number.isFinite(Number(budget.replace(',', '.')))) {
    toast('Enter a valid budget, or leave it empty', 'warn');
    return;
  }

  const button = $('[data-plan-save]');
  if (button) button.disabled = true;
  try {
    await post('savePlan', { meta, budget }, name);
    closeBudgetModal();
    toast('Trip planned');
    await refreshState();
    setTimeout(() => window.TwogetherV18?.refresh?.(true), 80);
    setTimeout(() => $('#twCurrentTripsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  } catch (error) {
    toast(error.message || 'Could not save the trip', 'warn');
    if (button) button.disabled = false;
  }
}

function openPlanTrip() {
  const now = new Date();
  monthCursor = new Date(now.getFullYear(), now.getMonth(), 1);
  draft = { location: 'Italy', otherLocation: '', city: '', start: '', end: '', budget: '' };
  showModal();
  bindForm();
  setTimeout(() => $('#v5PlanCity')?.focus(), 80);
}

document.addEventListener('twogether:budget-new-plan', openPlanTrip);
