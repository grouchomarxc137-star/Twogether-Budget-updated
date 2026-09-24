// Pure DOM/text-scraping decorators: budget-vs-actual comparison box and
// spend donut chart on the trip modal, a budget check on the actual-
// expenses review step, activity-feed label touch-ups, and budget-plan
// button locking/header sync. Extracted from ui.js. No state of its own --
// everything here re-derives from already-rendered markup/text produced by
// trips/overview.js, trips/budget-plans.js, and trips/expenses-flow.js,
// exactly as the original did. This is the fragile "contract via rendered
// HTML shape" file flagged repeatedly during this reorg's earlier research;
// ported verbatim rather than rewritten to read state directly, since that
// would be a real behavior change, not a mechanical move.
import { $, $$ } from '../lib/dom.js';
import { money, esc } from '../lib/format.js';
import { actor } from '../lib/session.js';
import { getState } from './state.js';

const COLORS = ['#8d6e63', '#c8909c', '#7f927a', '#c09a5b', '#7f91a8', '#a98572', '#b7a390'];

const has = (value) => value !== '' && value != null && Number.isFinite(Number(value));

function parseMoney(text) {
  let s = String(text || '').replace(/[^0-9,.-]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    const tail = s.length - lastComma - 1;
    s = tail === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const tail = s.length - lastDot - 1;
    if (tail !== 2) s = s.replace(/\./g, '');
  }
  const value = Number(s);
  return Number.isFinite(value) ? value : null;
}

function variance(budget, actual) {
  if (!has(budget)) return { cls: 'neutral', text: 'Budget not set' };
  if (!has(actual)) return { cls: 'neutral', text: 'Actual spend not logged yet' };
  const delta = Number(budget) - Number(actual);
  if (Math.abs(delta) < 0.01) return { cls: 'on', text: 'Exactly on budget' };
  return delta > 0
    ? { cls: 'under', text: `${money(delta)} under budget` }
    : { cls: 'over', text: `${money(Math.abs(delta))} over budget` };
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function installStyles() {
  if (document.getElementById('twogetherUiStyles')) return;
  const style = document.createElement('style');
  style.id = 'twogetherUiStyles';
  style.textContent = `
    .difference-list .difference-row{background:#fffaf1!important;border-color:#ead8b9!important;align-items:center;gap:10px}
    .difference-list .difference-row>strong{color:#584c3e}
    .difference-list .difference-row>span{background:#faeee4;border:1px solid #ecd8ca;border-radius:10px;padding:7px 9px;color:#704b3e;font-weight:700}
    .trip-budget-comparison{margin:15px 0 17px;padding:16px;border:1px solid var(--line);border-radius:20px;background:#fbf8f3}
    .trip-budget-comparison h3{margin:0 0 4px;font-size:21px}
    .trip-budget-comparison>p{margin:0 0 13px;color:var(--muted);font-size:12px}
    .trip-budget-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
    .trip-budget-item{padding:13px 14px;border:1px solid var(--line);border-radius:16px;background:#fff}
    .trip-budget-item>span{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:800}
    .trip-budget-item>strong{display:block;font-size:20px;margin:4px 0 2px}
    .trip-budget-item>small{display:block;color:var(--muted);line-height:1.4}
    .trip-budget-item.under{background:#edf4e9;border-color:#cfdfc8;box-shadow:inset 3px 0 0 #93b489}
    .trip-budget-item.under small{color:#456b4b;font-weight:700}
    .trip-budget-item.over{background:#f8ebe8;border-color:#e8c7c0;box-shadow:inset 3px 0 0 #c9877a}
    .trip-budget-item.over small{color:#964e43;font-weight:700}
    .trip-budget-item.on{background:#f1f0eb;border-color:#ddd8d0}
    .review-budget-check{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line);border-radius:17px;overflow:hidden;margin:0 0 13px;background:#fff}
    .review-budget-check>div{padding:12px 13px;border-right:1px solid var(--line);display:grid;gap:3px}
    .review-budget-check>div:last-child{border-right:0}
    .review-budget-check span{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:800}
    .review-budget-check strong{font-size:18px}
    .review-budget-check.under .review-budget-result{background:#edf4e9;color:#456b4b}
    .review-budget-check.over .review-budget-result{background:#f8ebe8;color:#964e43}
    .review-budget-check.on .review-budget-result{background:#f1f0eb}
    .v5-review-row.review-paid-under{background:#edf4e9!important;box-shadow:inset 3px 0 0 #93b489}
    .v5-review-row.review-paid-over{background:#f8ebe8!important;box-shadow:inset 3px 0 0 #c9877a}
    .v5-review-row.review-paid-on{background:#f1f0eb!important}
    .confirmed-spend-overview{margin:16px 0}
    .confirmed-spend-card{position:relative;background:linear-gradient(180deg,#fffefa 0%,#fbf7f0 100%);border:1px solid #e6dbcf;border-radius:24px;padding:22px;box-shadow:0 10px 28px rgba(62,45,31,.055);cursor:pointer;touch-action:pan-y;transition:border-color .18s ease,box-shadow .18s ease,background .18s ease}
    .confirmed-spend-card.is-principessa{border-color:#d6ad45;box-shadow:0 0 0 2px rgba(214,173,69,.18),0 10px 28px rgba(96,72,24,.08);background:linear-gradient(180deg,#fffdf5 0%,#fbf5e5 100%)}
    .confirmed-spend-card.is-principe{border-color:#e68145;box-shadow:0 0 0 2px rgba(230,129,69,.18),0 10px 28px rgba(114,62,27,.08);background:linear-gradient(180deg,#fffaf6 0%,#fcf0e7 100%)}
    .confirmed-spend-card:focus-visible{outline:2px solid rgba(102,86,69,.55);outline-offset:3px}
    .confirmed-spend-mode{position:absolute;top:14px;right:14px;z-index:3;display:inline-flex;align-items:center;min-height:28px;padding:0 10px;border:1px solid rgba(112,94,75,.12);border-radius:999px;background:rgba(255,255,255,.76);color:#74685e;font-size:11px;font-weight:700;letter-spacing:.04em}
    .confirmed-spend-card.is-principessa .confirmed-spend-mode{border-color:rgba(214,173,69,.35);color:#8a6814}
    .confirmed-spend-card.is-principe .confirmed-spend-mode{border-color:rgba(230,129,69,.35);color:#a65220}
    .confirmed-spend-visual{display:grid;grid-template-columns:minmax(180px,230px) minmax(0,1fr);align-items:center;gap:28px;padding:4px 4px 20px}
    .confirmed-donut{width:min(230px,100%);aspect-ratio:1;height:auto;border-radius:50%;display:grid;place-items:center;margin:0 auto;position:relative}
    .confirmed-donut::after{content:"";position:absolute;width:66%;aspect-ratio:1;height:auto;border-radius:50%;background:#fffdf9;box-shadow:0 1px 0 rgba(74,57,43,.05)}
    .confirmed-donut-center{position:relative;z-index:1;display:grid;justify-items:center;text-align:center;gap:3px;padding:10px}
    .confirmed-donut-center strong{font-size:22px;line-height:1.05;font-variant-numeric:tabular-nums}.confirmed-donut-center span{font-size:12px;color:#857a70;margin:0}
    .confirmed-spend-meta{min-width:0}.confirmed-spend-meta>span{display:block;margin-bottom:5px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:800}
    .confirmed-spend-meta h3{margin:0;font-size:28px;line-height:1.1;font-weight:600}.confirmed-spend-meta p{margin:8px 0 0;color:#7d7269;font-size:14px;line-height:1.45}
    .confirmed-spend-head{display:flex;align-items:baseline;justify-content:space-between;gap:14px;padding:17px 2px 8px;border-top:1px solid rgba(110,89,70,.1)}
    .confirmed-spend-head h4{margin:0;font-size:17px}.confirmed-spend-head span{color:#91877e;font-size:11px;text-align:right}
    .confirmed-legend{display:grid}.confirmed-legend-row{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:11px;align-items:center;min-height:51px;border-top:1px solid rgba(110,89,70,.08)}
    .confirmed-legend-row:first-child{border-top:0}.confirmed-legend-row i{width:9px;height:9px;border-radius:50%}.confirmed-legend-row span{min-width:0;display:grid;gap:1px;color:inherit}.confirmed-legend-row span strong{font-size:14px;font-weight:620}.confirmed-legend-row span small{color:#91877e;font-size:11px}.confirmed-legend-row>b{font-size:14px;font-variant-numeric:tabular-nums;white-space:nowrap}
    .confirmed-spend-empty{padding:24px 4px 12px;color:#91877e;font-size:14px;text-align:center}
    .submission-grid.confirmed-submissions-hidden{display:none!important}
    .budget-locked-note{font-size:11px;color:var(--muted);padding:8px 2px 0}
    @media(max-width:720px){.trip-budget-grid,.review-budget-check{grid-template-columns:1fr}.review-budget-check>div{border-right:0;border-bottom:1px solid var(--line)}.review-budget-check>div:last-child{border-bottom:0}.confirmed-spend-card{padding:18px 16px;border-radius:21px}.confirmed-spend-visual{grid-template-columns:1fr;gap:16px;text-align:center}.confirmed-donut{width:min(205px,72vw)}.confirmed-spend-meta h3{font-size:24px}.confirmed-spend-head{align-items:flex-start}.confirmed-spend-head span{max-width:175px}}
  `;
  document.head.appendChild(style);
}

function parseBudgetPerson(person) {
  if (!person) return { budget: null, actual: null };
  const strong = person.querySelector('strong')?.textContent || '';
  const small = person.querySelector('small')?.textContent || '';
  const budget = /€/.test(strong) ? parseMoney(strong) : null;
  const actualMatch = small.match(/actual\s+([^·]+)/i);
  return { budget, actual: actualMatch ? parseMoney(actualMatch[1]) : null };
}

function readBudgetPlans() {
  return $$('#budgetPlanGrid .budget-plan-card').map((card) => {
    const people = $$('.budget-person', card);
    return {
      id: card.dataset.v5Plan || '',
      city: (card.querySelector('.budget-plan-top h3')?.textContent || '').trim(),
      dates: (card.querySelector('.budget-plan-top p')?.textContent || '').trim(),
      Principessa: parseBudgetPerson(people[0]),
      Principe: parseBudgetPerson(people[1]),
      card,
    };
  });
}

function findPlanForModal(root) {
  const city = (root.querySelector('.trip-modal-heading h2')?.textContent || '').trim();
  const dates = (root.querySelector('.trip-modal-heading p')?.textContent || '').trim();
  if (!city) return null;
  const plans = readBudgetPlans();
  return plans.find((p) => normalizeText(p.city) === normalizeText(city) && normalizeText(p.dates) === normalizeText(dates))
    || plans.find((p) => normalizeText(p.city) === normalizeText(city))
    || null;
}

function paidFromSubmission(root, name) {
  const cards = $$('.submission-card', root);
  const card = cards.find((c) => normalizeText(c.querySelector(':scope > span')?.textContent) === normalizeText(name));
  if (!card) return null;
  const text = card.querySelector(':scope > small')?.textContent || '';
  const match = text.match(/Paid:\s*([^·]+)/i);
  return match ? parseMoney(match[1]) : null;
}

function budgetItem(label, budget, actual) {
  const v = variance(budget, actual);
  return `<div class="trip-budget-item ${v.cls}"><span>${esc(label)}</span><strong>${has(budget) ? money(budget) : 'Not set'}</strong><small>${esc(v.text)}${has(actual) ? ` · actual ${money(actual)}` : ''}</small></div>`;
}

function decorateTripBudget() {
  const root = document.getElementById('tripModalBody');
  if (!root || !root.children.length) return;
  const plan = findPlanForModal(root);
  if (!plan) return;

  const pBudget = plan.Principessa.budget;
  const qBudget = plan.Principe.budget;
  const pPaid = paidFromSubmission(root, 'Principessa') ?? plan.Principessa.actual;
  const qPaid = paidFromSubmission(root, 'Principe') ?? plan.Principe.actual;
  const combinedBudget = has(pBudget) && has(qBudget) ? pBudget + qBudget : null;
  const combinedPaid = has(pPaid) && has(qPaid) ? pPaid + qPaid : null;
  const combinedVar = variance(combinedBudget, combinedPaid);
  const signature = [pBudget, qBudget, pPaid, qPaid].map((v) => v == null ? '' : v).join('|');
  const old = root.querySelector('.trip-budget-comparison');
  if (old?.dataset.signature === signature) return;
  old?.remove();

  const summary = root.querySelector('.budget-check');
  if (summary) {
    summary.classList.remove('ok', 'warn');
    if (combinedVar.cls === 'under' || combinedVar.cls === 'on') summary.classList.add('ok');
    if (combinedVar.cls === 'over') summary.classList.add('warn');
    summary.innerHTML = `<div><span>Planned budgets</span><strong>${has(combinedBudget) ? money(combinedBudget) : 'Not fully set'}</strong></div><div><span>Combined actually paid</span><strong>${has(combinedPaid) ? money(combinedPaid) : 'Waiting for both'}</strong></div><div class="budget-result"><span>Budget check</span><strong>${esc(combinedVar.text)}</strong></div>`;
  }

  const box = document.createElement('section');
  box.className = 'trip-budget-comparison';
  box.dataset.signature = signature;
  box.innerHTML = `<h3>Budget comparison</h3><p>Planned limits compared with what each of you actually paid.</p><div class="trip-budget-grid">${budgetItem('Principessa', pBudget, pPaid)}${budgetItem('Principe', qBudget, qPaid)}${budgetItem('Combined', combinedBudget, combinedPaid)}</div>`;
  const differences = root.querySelector('.difference-list');
  const analysis = root.querySelector('.confirmed-spend-overview');
  const submissions = root.querySelector('.submission-grid');
  const anchor = differences || analysis || submissions;
  if (anchor) anchor.parentNode.insertBefore(box, anchor);
  else root.appendChild(box);
}

function categoryData(card) {
  return [...(card?.querySelectorAll('.submission-mini > div') || [])].map((row) => ({
    label: row.querySelector('span')?.textContent?.trim() || '',
    amount: parseMoney(row.querySelector('b')?.textContent || '') || 0,
  })).filter((x) => x.label && x.amount > 0).sort((a, b) => b.amount - a.amount);
}

function confirmedEntryCategory(entry) {
  if (entry?.category === 'accommodation') return 'Accommodation';
  if (entry?.category === 'food') return entry.foodType === 'groceries' ? 'Groceries' : 'Eating out';
  if (entry?.category === 'transport') {
    if (entry.transportType === 'fuel') return 'Fuel';
    if (entry.transportType === 'tolls' || entry.transportType === 'parking-tolls') return 'Tolls / Parking';
    return 'Flights / Train';
  }
  return 'Other';
}

function confirmedRepaymentCategory(repayment) {
  const map = {
    stay: 'Accommodation',
    transport: 'Flights / Train',
    car: 'Fuel',
    groceries: 'Groceries',
    'eating-out': 'Eating out',
    activities: 'Other',
    other: 'Other',
  };
  return map[repayment?.category] || 'Other';
}

function confirmedPersonalCategories(plan, person) {
  const amounts = new Map();
  const entries = Array.isArray(plan?.expenseEntries) ? plan.expenseEntries : [];
  entries.forEach((entry) => {
    const amount = Math.max(0, Number(entry?.amount || 0) - Number(entry?.jarContribution || 0));
    if (amount <= .005) return;
    let paid = 0;
    if (entry?.paidBy === 'both') paid = amount / 2;
    else if (entry?.paidBy === person) paid = amount;
    if (paid <= .005) return;
    const label = confirmedEntryCategory(entry);
    amounts.set(label, (amounts.get(label) || 0) + paid);
  });
  (Array.isArray(plan?.repayments) ? plan.repayments : []).forEach((repayment) => {
    const amount = Math.max(0, Number(repayment?.amount || 0));
    if (amount <= .005) return;
    const label = confirmedRepaymentCategory(repayment);
    const effect = repayment?.from === person ? amount : repayment?.to === person ? -amount : 0;
    if (effect) amounts.set(label, (amounts.get(label) || 0) + effect);
  });
  return [...amounts.entries()]
    .map(([label, amount]) => ({ label, amount: Math.max(0, amount) }))
    .filter((item) => item.amount > .005)
    .sort((a, b) => b.amount - a.amount);
}

function decorateConfirmedSpend() {
  const root = document.getElementById('tripModalBody');
  if (!root || root.querySelector('.confirmed-spend-overview')) return;
  const confirmed = [...root.querySelectorAll('.match-box.ok strong')].some((el) => /confirmed by both/i.test(el.textContent || ''));
  if (!confirmed) return;
  const cards = [...root.querySelectorAll('.submission-card')];
  if (cards.length < 2) return;

  const state = getState();
  const tripId = root.dataset.tripId || '';
  const plan = (state.plans || []).find((item) => item.linkedTripId === tripId) || null;
  const me = actor(), other = me === 'Principessa' ? 'Principe' : 'Principessa';
  const totalCategories = categoryData(cards[0]);
  const total = parseMoney(root.querySelector('.trip-modal-total strong')?.textContent) || 0;
  const personal = {
    Principessa: confirmedPersonalCategories(plan, 'Principessa'),
    Principe: confirmedPersonalCategories(plan, 'Principe'),
  };
  const personalTotals = {
    Principessa: personal.Principessa.reduce((sum, item) => sum + item.amount, 0),
    Principe: personal.Principe.reduce((sum, item) => sum + item.amount, 0),
  };
  const fallbackPaid = {
    Principessa: paidFromSubmission(root, 'Principessa') || 0,
    Principe: paidFromSubmission(root, 'Principe') || 0,
  };
  const hasDetailed = !!(plan && Array.isArray(plan.expenseEntries) && plan.expenseEntries.length);

  const analysis = document.createElement('div');
  analysis.className = 'confirmed-spend-overview';
  let mode = 'total';
  let longPressed = false;
  let longTimer = null;
  let startX = 0, startY = 0;

  const render = () => {
    const viewed = mode === 'mine' ? me : mode === 'other' ? other : '';
    const categories = viewed ? personal[viewed] : totalCategories;
    const viewedTotal = viewed ? (hasDetailed ? personalTotals[viewed] : fallbackPaid[viewed]) : total;
    const safeTotal = Math.max(viewedTotal, 0.01);
    let degrees = 0;
    const stops = categories.map((item, index) => {
      const start = degrees;
      degrees += (item.amount / safeTotal) * 360;
      return `${COLORS[index % COLORS.length]} ${start}deg ${degrees}deg`;
    }).join(',');
    const legend = categories.length
      ? categories.map((item, index) => {
          const pct = viewedTotal > .005 ? (item.amount / viewedTotal) * 100 : 0;
          return `<div class="confirmed-legend-row"><i style="background:${COLORS[index % COLORS.length]}"></i><span><strong>${esc(item.label)}</strong><small>${pct.toFixed(0)}% of ${viewed ? viewed + ' spending' : 'this trip'}</small></span><b>${money(item.amount)}</b></div>`;
        }).join('')
      : `<div class="confirmed-spend-empty">${viewed && !hasDetailed ? 'Personal category details are not available for this older trip.' : viewed ? `${esc(viewed)} has no personal Trip spending logged.` : 'No spending entered yet.'}</div>`;
    const cls = viewed ? ' is-' + viewed.toLowerCase() : '';
    const modeLabel = viewed || 'Together';
    const centerLabel = viewed ? viewed + ' spent' : 'Total spent';
    const title = viewed ? viewed + ' spending' : 'Where the money went';
    const hint = mode === 'total'
      ? `Tap for ${esc(me)} · hold for ${esc(other)}`
      : `Tap for Together · hold for ${esc(other)}`;
    const detail = viewed
      ? (hasDetailed ? `${money(viewedTotal)} paid by ${esc(viewed)}` : `${money(viewedTotal)} paid · category detail unavailable`)
      : `${money(total)} across the confirmed trip`;

    analysis.innerHTML = `<section class="confirmed-spend-card${cls}" role="button" tabindex="0" aria-label="Confirmed trip spending view: ${esc(modeLabel)}">
      <span class="confirmed-spend-mode">${esc(modeLabel)}</span>
      <div class="confirmed-spend-visual">
        <div class="confirmed-donut" style="background:${categories.length ? `conic-gradient(${stops})` : '#e8e2d9'}"><div class="confirmed-donut-center"><span>${esc(centerLabel)}</span><strong>${money(viewedTotal)}</strong></div></div>
        <div class="confirmed-spend-meta"><span>CONFIRMED TRIP</span><h3>${esc(title)}</h3><p>${detail}</p></div>
      </div>
      <div class="confirmed-spend-head"><h4>${viewed ? 'Personal breakdown' : 'Category breakdown'}</h4><span>${hint}</span></div>
      <div class="confirmed-legend">${legend}</div>
    </section>`;
  };

  const clearLongPress = () => {
    if (longTimer) clearTimeout(longTimer);
    longTimer = null;
  };

  analysis.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.confirmed-spend-card') || event.button !== 0) return;
    longPressed = false;
    startX = event.clientX; startY = event.clientY;
    clearLongPress();
    longTimer = setTimeout(() => {
      longPressed = true;
      mode = 'other';
      render();
    }, 550);
  });
  analysis.addEventListener('pointermove', (event) => {
    if (Math.abs(event.clientX - startX) > 12 || Math.abs(event.clientY - startY) > 12) clearLongPress();
  });
  analysis.addEventListener('pointerup', clearLongPress);
  analysis.addEventListener('pointercancel', clearLongPress);
  analysis.addEventListener('contextmenu', (event) => {
    if (event.target.closest('.confirmed-spend-card')) event.preventDefault();
  });
  analysis.addEventListener('click', (event) => {
    if (!event.target.closest('.confirmed-spend-card')) return;
    if (longPressed) { longPressed = false; return; }
    mode = mode === 'total' ? 'mine' : 'total';
    render();
  });
  analysis.addEventListener('keydown', (event) => {
    if (!event.target.closest('.confirmed-spend-card') || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    mode = mode === 'total' ? 'mine' : 'total';
    render();
  });

  render();
  const submissions = root.querySelector('.submission-grid');
  if (submissions) {
    submissions.classList.add('confirmed-submissions-hidden');
    submissions.parentNode.insertBefore(analysis, submissions);
  } else root.appendChild(analysis);
}

function decorateTripModal() {
  decorateTripBudget();
  decorateConfirmedSpend();
}

function decorateReviewBudget() {
  const overlay = document.getElementById('workflowV5Overlay');
  if (!overlay?.classList.contains('show')) return;
  const heading = overlay.querySelector('h2')?.textContent?.trim() || '';
  if (heading !== 'Ready to save your actual expenses?') return;
  const reference = overlay.querySelector('.v5-reference');
  if (!reference) return;
  const budget = parseMoney(reference.querySelector('strong')?.textContent);
  const rows = $$('.v5-review-row', overlay);
  const paidRow = rows.find((row) => /actually paid/i.test(row.querySelector('span')?.textContent || ''));
  const paid = parseMoney(paidRow?.querySelector('strong')?.textContent);
  if (!has(budget) || !has(paid)) return;
  const v = variance(budget, paid);
  const signature = `${budget}|${paid}`;
  let box = overlay.querySelector('.review-budget-check');
  if (box?.dataset.signature === signature) return;
  box?.remove();
  box = document.createElement('div');
  box.className = `review-budget-check ${v.cls}`;
  box.dataset.signature = signature;
  box.innerHTML = `<div><span>Your planned budget</span><strong>${money(budget)}</strong></div><div><span>You actually paid</span><strong>${money(paid)}</strong></div><div class="review-budget-result"><span>Result</span><strong>${esc(v.text)}</strong></div>`;
  reference.insertAdjacentElement('afterend', box);
  paidRow?.classList.remove('review-paid-under', 'review-paid-over', 'review-paid-on');
  if (v.cls === 'under') paidRow?.classList.add('review-paid-under');
  if (v.cls === 'over') paidRow?.classList.add('review-paid-over');
  if (v.cls === 'on') paidRow?.classList.add('review-paid-on');
}

function fixActivityLabels() {
  const root = document.getElementById('activityList');
  if (!root) return;
  root.querySelectorAll('.activity-item').forEach((item) => {
    const wrap = item.querySelector('div');
    const who = item.querySelector('strong')?.textContent?.trim() || '';
    if (!wrap) return;
    [...wrap.childNodes].forEach((node) => {
      if (node.nodeType !== Node.TEXT_NODE) return;
      const possessive = who === 'Principessa' ? 'her' : who === 'Principe' ? 'his' : 'their';
      node.textContent = (node.textContent || '')
        .replace(/setIndividualBudget/g, `set ${possessive} trip budget`)
        .replace(/savePartialActual/g, 'saved early trip expenses');
    });
  });
}

function lockSubmittedBudgetButtons() {
  const current = actor();
  const grid = document.getElementById('budgetPlanGrid');
  if (!current || !grid) return;
  const index = current === 'Principessa' ? 0 : 1;
  $$('.budget-plan-card', grid).forEach((card) => {
    const mine = $$('.budget-person', card)[index];
    const hasActual = /\bactual\s+€|saved early:/i.test(mine?.querySelector('small')?.textContent || '');
    const edit = card.querySelector('[data-v5-own-budget]');
    let note = card.querySelector('.budget-locked-note');
    if (hasActual) {
      if (edit) edit.style.display = 'none';
      if (!note) {
        note = document.createElement('div');
        note.className = 'budget-locked-note';
        note.textContent = 'Your planned budget is locked because you already logged your actual expenses.';
        card.querySelector('.budget-plan-actions')?.appendChild(note);
      }
    } else {
      if (edit) edit.style.display = '';
      note?.remove();
    }
  });
}

function syncBudgetHeaderButton() {
  const header = document.querySelector('[data-v5-new-plan]');
  const grid = document.getElementById('budgetPlanGrid');
  if (!header || !grid) return;
  const openCards = $$('.budget-plan-card', grid).filter((card) => !card.classList.contains('hidden'));
  header.textContent = openCards.length ? 'Plan another trip budget' : 'Plan a trip budget';
  header.disabled = false;
  header.dataset.v6Mode = 'new';
  delete header.dataset.v6PlanId;
}

function refreshBudgetUi() {
  lockSubmittedBudgetButtons();
  syncBudgetHeaderButton();
  decorateTripModal();
}

export function initUiDecorators() {
  installStyles();
  document.addEventListener('click', (event) => {
    const header = event.target.closest?.('[data-v5-new-plan]');
    if (header?.dataset.v6Mode === 'existing') {
      const card = document.querySelector(`[data-v5-plan="${CSS.escape(header.dataset.v6PlanId || '')}"]`);
      const target = card?.querySelector('[data-v5-own-budget]');
      if (target) { event.preventDefault(); event.stopImmediatePropagation(); target.click(); return; }
    }
    if (event.target.closest?.('[data-open-trip]')) requestAnimationFrame(() => requestAnimationFrame(decorateTripModal));
  }, true);

  const modalBody = document.getElementById('tripModalBody');
  if (modalBody) new MutationObserver(() => requestAnimationFrame(decorateTripModal)).observe(modalBody, { childList: true });
  const overlay = document.getElementById('workflowV5Overlay');
  if (overlay) new MutationObserver(() => requestAnimationFrame(decorateReviewBudget)).observe(overlay, { childList: true, subtree: false });
  const grid = document.getElementById('budgetPlanGrid');
  if (grid) new MutationObserver(() => requestAnimationFrame(refreshBudgetUi)).observe(grid, { childList: true });
  const activity = document.getElementById('activityList');
  if (activity) new MutationObserver(fixActivityLabels).observe(activity, { childList: true });
  fixActivityLabels();
  refreshBudgetUi();
  decorateReviewBudget();
}
