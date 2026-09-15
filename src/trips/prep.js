// Plan-based Trip Prep checklist (packing + reminders), separate from
// shop/packing.js's purchase-gated per-trip packing system -- the two are
// kept as distinct systems rather than force-merged, since both touch real,
// possibly-existing backend data under different shapes (this one is keyed
// by plan.prep and isn't purchase-gated; shop/packing.js is keyed by
// profile().packing[id] and requires owning the "packing-list" reward).
// Extracted from v33.js.
import { $, $$ } from '../lib/dom.js';
import { esc, uid } from '../lib/format.js';
import { actor } from '../lib/session.js';
import { toast } from '../lib/toast.js';
import { planById, freshState } from '../finances/planner-state.js';

const PACKING_DEFAULTS = ['Toothbrushes', 'Slippers', 'Hair brush', 'Shampoo', 'Conditioner', 'Shower gel', 'Dishwasher detergent'];
const REMINDER_DEFAULTS = ["Don't forget to put fuel", "Don't forget to ask mom to make work sandwich", "Don't forget to take pictures of the Airbnb when you arrive"];
let prepPlanId = '';

function ensurePrepModal() {
  if ($('#v33PrepModal')) return;
  const modal = document.createElement('div');
  modal.id = 'v33PrepModal'; modal.className = 'v33-prep-modal'; modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = '<div class="v33-prep-backdrop" data-prep-close></div><section class="v33-prep-card" role="dialog" aria-modal="true" aria-label="Prepare for trip"><button class="v33-prep-close" type="button" data-prep-close>×</button><div id="v33PrepBody"></div></section>';
  document.body.appendChild(modal);
  $$('[data-prep-close]', modal).forEach((x) => x.addEventListener('click', closePrep));
}
function defaults(list) { return list.map((text) => ({ id: uid(), text, done: false })); }

export function openPrep(id) {
  prepPlanId = id; ensurePrepModal();
  const plan = planById(id); if (!plan) return toast('Trip not found', 'warn');
  const stored = plan.prep || {};
  const prep = {
    packing: stored.packing?.length ? JSON.parse(JSON.stringify(stored.packing)) : defaults(PACKING_DEFAULTS),
    reminders: stored.reminders?.length ? JSON.parse(JSON.stringify(stored.reminders)) : defaults(REMINDER_DEFAULTS),
  };
  $('#v33PrepModal')._prep = prep;
  renderPrep();
  $('#v33PrepModal').classList.add('show'); $('#v33PrepModal').setAttribute('aria-hidden', 'false');
}
function closePrep() {
  $('#v33PrepModal')?.classList.remove('show'); $('#v33PrepModal')?.setAttribute('aria-hidden', 'true');
}
function prepRows(kind, list) {
  return `<div class="v33-check-list" data-prep-list="${kind}">${list.map((x) => `<div class="v33-check-row" data-prep-id="${esc(x.id)}"><input type="checkbox" ${x.done ? 'checked' : ''} data-prep-check aria-label="Done"><input class="v33-check-text" value="${esc(x.text)}" data-prep-text><button type="button" data-prep-remove aria-label="Remove">×</button></div>`).join('')}</div><div class="v33-add-check"><input placeholder="Add another item" data-prep-new="${kind}"><button class="btn ghost" type="button" data-prep-add="${kind}">Add</button></div>`;
}
function renderPrep() {
  const modal = $('#v33PrepModal'), body = $('#v33PrepBody'), prep = modal?._prep; if (!body || !prep) return;
  const plan = planById(prepPlanId);
  body.innerHTML = `<span class="panel-kicker">${esc(plan?.meta?.city || 'TRIP')}</span><h2>Prepare for trip</h2><p>Tick things off, edit them, or add your own.</p><section class="v33-prep-section"><h3>Packing / things to take</h3>${prepRows('packing', prep.packing)}</section><section class="v33-prep-section"><h3>Important trip reminders</h3>${prepRows('reminders', prep.reminders)}</section><button class="btn primary v33-prep-save" type="button" data-prep-save>Save checklist</button>`;
  bindPrep();
}
function bindPrep() {
  const modal = $('#v33PrepModal'), prep = modal._prep;
  $$('[data-prep-id]', modal).forEach((row) => {
    const list = row.closest('[data-prep-list]').dataset.prepList, item = prep[list].find((x) => x.id === row.dataset.prepId);
    $('[data-prep-check]', row).addEventListener('change', (e) => item.done = e.target.checked);
    $('[data-prep-text]', row).addEventListener('change', (e) => item.text = e.target.value.trim());
    $('[data-prep-remove]', row).addEventListener('click', () => { prep[list] = prep[list].filter((x) => x.id !== item.id); renderPrep(); });
  });
  $$('[data-prep-add]', modal).forEach((b) => b.addEventListener('click', () => {
    const kind = b.dataset.prepAdd, input = $(`[data-prep-new="${kind}"]`, modal), text = input.value.trim(); if (!text) return;
    prep[kind].push({ id: uid(), text, done: false }); renderPrep();
  }));
  $('[data-prep-save]', modal)?.addEventListener('click', async () => {
    const btn = $('[data-prep-save]', modal); btn.disabled = true;
    prep.packing = prep.packing.filter((x) => x.text); prep.reminders = prep.reminders.filter((x) => x.text);
    try {
      const r = await window.TwogetherAPI.post('saveTripPrep', { planId: prepPlanId, prep }, actor());
      const plan = planById(prepPlanId); if (plan) plan.prep = r.prep;
      toast('Trip checklist saved'); closePrep();
      await freshState();
    } catch (e) {
      toast(e.message || 'Could not save checklist', 'warn'); btn.disabled = false;
    }
  });
}

export function decorateCurrentTrips() {
  $$('#twCurrentTrips .tw-current-card[data-current-plan]').forEach((card) => {
    if ($('[data-v33-prep]', card)) return;
    const actions = $('.tw-current-actions', card); if (!actions) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'text-btn v33-prepare-btn'; b.dataset.v33Prep = ''; b.textContent = 'Prepare';
    const open = $('[data-current-open]', actions);
    actions.insertBefore(b, open || null);
  });
}

export function installPrepCapture() {
  ensurePrepModal();
  document.addEventListener('click', (e) => {
    const prep = e.target.closest?.('[data-v33-prep]'); if (!prep) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const id = prep.closest('[data-current-plan]')?.dataset.currentPlan;
    if (id) openPrep(id);
  }, true);
}
