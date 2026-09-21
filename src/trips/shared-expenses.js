// Shared/split expense entry for Travel and Accommodation categories,
// embedded inside the budget-planning overlay (see trips/budget-state.js's
// showOverlay). Extracted from shared.js. A "leaf" module -- only called by
// trips/expenses-flow.js, only calls window.TwogetherAPI.
//
// amount()/valid() are kept distinct from lib/format's n() deliberately:
// n() silently falls back to 0 for invalid input, but valid() here needs
// to actually detect "not a valid non-negative number" (via NaN) rather
// than have it masked as a valid zero -- swapping to n() would change
// that validation behavior.
import { esc, money } from '../lib/format.js';
import { actor, otherActor } from '../lib/session.js';

const labels = { accom: 'Accommodation', travel: 'Flights / Train' };
const amount = (v) => Number(String(v).replace(',', '.'));
const valid = (v) => String(v ?? '').trim() !== '' && Number.isFinite(amount(v)) && amount(v) >= 0;

function sharedDraftKey(planId, key, who) {
  return `twogether:shared-expense:v3:${who || 'guest'}:${planId || ''}:${key}`;
}
function readSharedDraft(planId, key, who) {
  try { return JSON.parse(localStorage.getItem(sharedDraftKey(planId, key, who)) || 'null'); } catch { return null; }
}
function writeSharedDraft(planId, key, who, value) {
  try { localStorage.setItem(sharedDraftKey(planId, key, who), JSON.stringify(value)); } catch {}
}
function clearSharedDraft(planId, key, who) {
  try { localStorage.removeItem(sharedDraftKey(planId, key, who)); } catch {}
}

function renderTravel({ host, plan, key, onDone, onBack }) {
  const who = actor(), partner = otherActor(who);
  const meta = plan.sharedExpenses?.[key] || {}, known = meta.total !== '' && meta.total != null;
  const saved = readSharedDraft(plan.id, key, who);
  let total = saved?.total ?? (known ? String(meta.total) : ''), unknown = saved?.unknown ?? false, mode = saved?.mode ?? (meta.mode?.[who] || ''), paid = saved?.paid ?? (meta.paid?.[who] ?? '');
  let stage = saved?.stage || (known && meta.mode?.[partner] === 'shared' ? 'paid' : 'total');
  if ((paid === '' || !meta.mode?.[who]) && known) paid = String(Math.max(0, amount(total) - amount(meta.paid?.[partner] || 0)));
  let busy = false;
  function error(message) { const el = host.querySelector('[data-error]'); if (el) el.textContent = message; }
  function persist() { writeSharedDraft(plan.id, key, who, { stage, total, unknown, mode, paid }); }
  function draw() {
    persist();
    const details = known ? `<p>Total: ${money(meta.total)} · ${esc(partner)} paid ${meta.paid?.[partner] === '' || meta.paid?.[partner] == null ? 'not recorded' : money(meta.paid[partner])}</p>` : '';
    let body = '';
    if (stage === 'total') body = `<h2>Total ${labels[key]}</h2>${details}<label>Total bill<input id="sharedTotal" class="big-input" inputmode="decimal" value="${esc(total)}"></label><div class="v5-actions"><button type="button" class="btn ghost" data-back>← Back</button><div class="shared-total-actions"><button type="button" data-unknown>I don’t know the total</button><button type="button" class="btn primary" data-next>Continue →</button></div></div>`;
    if (stage === 'mode') body = `<h2>Who paid this?</h2><p>Total: ${money(total)}</p><div class="v5-choice-stack"><button type="button" class="trip-pick" data-mode="full">I paid it fully myself</button><button type="button" class="trip-pick" data-mode="shared">It’s shared</button></div><button type="button" data-back>Back</button>`;
    if (stage === 'paid') body = `<h2>How much did you pay for ${labels[key].toLowerCase()}?</h2>${details}<p>${unknown ? 'The total is unknown. Save your payment now and resolve the total later.' : `Suggested remaining share: ${money(Math.max(0, amount(total) - amount(meta.paid?.[partner] || 0)))}. You can change this amount.`}</p><label>Your payment<input id="sharedPaid" class="big-input" inputmode="decimal" value="${esc(paid)}"></label><div class="v5-actions"><button type="button" data-back>Back</button><button type="button" class="btn primary" data-save>Save & continue</button></div>`;
    host.innerHTML = `<section class="shared-entry">${body}<p role="status" data-error></p></section>`;
    const input = host.querySelector('input'); input?.focus();
    input?.addEventListener('input', () => { stage === 'total' ? total = input.value : paid = input.value; persist(); });
    host.querySelector('[data-next]')?.addEventListener('click', () => { if (!valid(total)) return error('Enter a non-negative total, or choose “I don’t know the total”.'); unknown = false; if (paid === '') paid = String(Math.max(0, amount(total) - amount(meta.paid?.[partner] || 0))); stage = 'mode'; draw(); });
    host.querySelector('[data-unknown]')?.addEventListener('click', () => { unknown = !known; total = known ? String(meta.total) : ''; mode = 'shared'; stage = 'paid'; draw(); });
    host.querySelector('[data-back]')?.addEventListener('click', () => { if (stage === 'total') { persist(); onBack?.(); return; } stage = 'total'; draw(); });
    host.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; if (mode === 'full') { paid = total; save(); } else { stage = 'paid'; draw(); } }));
    host.querySelector('[data-save]')?.addEventListener('click', () => { mode = 'shared'; save(); });
  }
  async function save() {
    if (busy) return; if (!valid(paid)) return error('Enter a non-negative payment.');
    busy = true; host.querySelectorAll('button').forEach((b) => b.disabled = true);
    try {
      const result = await window.TwogetherAPI.post('saveSharedExpense', { planId: plan.id, key, total, mode, paid, unknown, totalUncertain: unknown, expectedTotal: meta.total ?? '' }, who);
      plan.sharedExpenses = { ...plan.sharedExpenses, [key]: result.sharedExpense };
      clearSharedDraft(plan.id, key, who);
      if (host.isConnected) onDone(result.sharedExpense.total === '' ? '0' : String(result.sharedExpense.total), result.sharedExpense.total === '');
    } catch (e) { if (host.isConnected) { error(e.message); host.querySelectorAll('button').forEach((b) => b.disabled = false); } } finally { busy = false; }
  }
  draw(); return true;
}

function renderAccommodation({ host, plan, onDone, onBack }) {
  const who = actor(), partner = otherActor(who);
  const savedDraft = readSharedDraft(plan.id, 'accom', who);
  let state = null, jarBalance = 870, busy = false, stage = 'loading', total = savedDraft?.total ?? '', useJar = savedDraft?.useJar ?? false, paymentType = savedDraft?.paymentType ?? '', paidUpfront = savedDraft?.paidUpfront ?? false;
  const current = plan.sharedExpenses?.accom || {};
  const existing = current.accommodation || {};
  const repayment = existing.repayment || {};
  const configured = !!existing.paymentType;

  function error(message) { const el = host.querySelector('[data-error]'); if (el) el.textContent = message; }
  function calc() {
    const gross = valid(total) ? amount(total) : 0;
    const jar = useJar ? Math.round(gross * 0.2 * 100) / 100 : 0;
    const remaining = Math.max(0, Math.round((gross - jar) * 100) / 100);
    const half = Math.round(remaining / 2 * 100) / 100;
    return { gross, jar, remaining, half, jarAfter: Math.max(0, Math.round((jarBalance - jar) * 100) / 100) };
  }
  function summaryHtml(meta = existing) {
    const r = meta.repayment || {}, status = r.status || 'none';
    return `<div class="v33-accom-summary"><div><span>Total Airbnb</span><strong>${money(current.total || total || 0)}</strong></div><div><span>Shared Jar used</span><strong>${meta.useJar ? money(meta.jarContribution) : 'No'}</strong></div><div><span>Jar left</span><strong>${money(meta.jarBalanceAfter ?? jarBalance)}</strong></div>${meta.paymentType === 'shared' ? `<div><span>Each person’s share</span><strong>${money(meta.shareEach || 0)}</strong></div>` : ''}${status !== 'none' ? `<div class="v33-repay-${status}"><span>Repayment</span><strong>${status === 'confirmed' ? 'Confirmed' : 'Pending'} · ${money(r.amount || 0)}</strong></div>` : ''}</div>`;
  }
  function persist() {
    if (!['loading', 'existing', 'repayment'].includes(stage)) writeSharedDraft(plan.id, 'accom', who, { stage, total, useJar, paymentType, paidUpfront });
  }
  function draw() {
    persist();
    let body = '';
    if (stage === 'loading') body = '<p>Loading Shared Jar…</p>';
    if (stage === 'repayment') {
      const confirmed = repayment.status === 'confirmed';
      body = `<span class="panel-kicker">ACCOMMODATION REPAYMENT</span><h2>${confirmed ? 'Repayment confirmed' : `You owe ${esc(repayment.creditor)} ${money(repayment.amount)}`}</h2>${summaryHtml()}${confirmed ? '<p class="v33-status-ok">This accommodation repayment is confirmed.</p><button class="btn primary" type="button" data-continue>Continue</button>' : `<p>Have you already paid ${esc(repayment.creditor)} back?</p><div class="v5-choice-stack"><button class="trip-pick" type="button" data-repaid="yes">Yes, I paid it back</button><button class="trip-pick" type="button" data-repaid="no">Not yet</button></div>`}`;
    }
    if (stage === 'existing') body = `<span class="panel-kicker">ACCOMMODATION</span><h2>Accommodation setup</h2>${summaryHtml()}<div class="v5-actions"><button type="button" data-edit>Change setup</button><button class="btn primary" type="button" data-continue>Continue</button></div>`;
    if (stage === 'total') body = `<span class="panel-kicker">ACCOMMODATION</span><h2>What is the total Airbnb/accommodation cost?</h2><label>Total Airbnb cost<div class="money-input-wrap"><span>€</span><input id="v33AccomTotal" class="big-input money-field" inputmode="decimal" value="${esc(total)}"></div></label><div class="v5-actions"><button class="btn ghost" type="button" data-back>← Back</button><button class="btn primary" type="button" data-next>Continue →</button></div>`;
    if (stage === 'jar') {
      const c = calc();
      body = `<span class="panel-kicker">SHARED JAR · ${money(jarBalance)} AVAILABLE</span><h2>Use the 20% Shared Jar contribution?</h2><div class="v33-jar-preview"><div><span>20% from Jar</span><strong>${money(c.gross * 0.2)}</strong></div><div><span>Cost after Jar</span><strong>${money(c.gross * 0.8)}</strong></div></div><div class="v5-choice-stack"><button class="trip-pick" type="button" data-jar="yes">Yes, use 20%</button><button class="trip-pick" type="button" data-jar="no">No, don’t use the Jar</button></div><button type="button" data-back>Back</button>`;
    }
    if (stage === 'payer') {
      const c = calc();
      body = `<span class="panel-kicker">WHO IS PAYING?</span><h2>How are you paying this accommodation?</h2>${useJar ? `<p class="v33-jar-line">${money(c.jar)} comes from the Shared Jar · ${money(c.jarAfter)} will remain.</p>` : ''}<div class="v5-choice-stack"><button class="trip-pick" type="button" data-paytype="solo"><strong>I’m paying it completely myself</strong><small>${useJar ? `You can use ${money(c.jar)} from the Jar. ` : ''}${esc(partner)} will owe you nothing.</small></button><button class="trip-pick" type="button" data-paytype="shared"><strong>Shared between us</strong><small>${money(c.half)} each${useJar ? ' after the Jar contribution' : ''}.</small></button></div><button type="button" data-back>Back</button>`;
    }
    if (stage === 'upfront') {
      const c = calc();
      body = `<span class="panel-kicker">50 / 50 SHARE</span><h2>Did you pay the accommodation upfront?</h2><p>After ${useJar ? `${money(c.jar)} from the Shared Jar` : 'the accommodation total'}, your shared cost is ${money(c.remaining)} — ${money(c.half)} each.</p><div class="v5-choice-stack"><button class="trip-pick" type="button" data-upfront="yes"><strong>Yes, I paid it upfront</strong><small>${esc(partner)} will owe you ${money(c.half)}.</small></button><button class="trip-pick" type="button" data-upfront="no"><strong>No, we each pay our own half</strong><small>No repayment debt will be created.</small></button></div><button type="button" data-back>Back</button>`;
    }
    if (stage === 'review') {
      const c = calc();
      body = `<span class="panel-kicker">REVIEW ACCOMMODATION</span><h2>Check the split</h2><div class="v33-accom-summary"><div><span>Total Airbnb</span><strong>${money(c.gross)}</strong></div><div><span>Shared Jar contribution</span><strong>${useJar ? money(c.jar) : '€0.00'}</strong></div><div><span>Shared Jar left</span><strong>${money(c.jarAfter)}</strong></div><div><span>After Jar</span><strong>${money(c.remaining)}</strong></div>${paymentType === 'shared' ? `<div><span>Each person</span><strong>${money(c.half)}</strong></div>` : `<div><span>You pay</span><strong>${money(c.remaining)}</strong></div>`}${paymentType === 'shared' && paidUpfront ? `<div class="v33-repay-pending"><span>${esc(partner)} pays you back</span><strong>${money(c.half)}</strong></div>` : ''}</div><div class="v5-actions"><button type="button" data-back>Back</button><button class="btn primary" type="button" data-save>Save & continue</button></div>`;
    }
    host.innerHTML = `<section class="shared-entry v33-accom-entry">${body}<p role="status" data-error></p></section>`;
    const input = host.querySelector('#v33AccomTotal'); input?.focus(); input?.addEventListener('input', () => { total = input.value; persist(); });
    host.querySelector('[data-next]')?.addEventListener('click', () => { if (!valid(total)) return error('Enter a valid non-negative accommodation total.'); stage = 'jar'; draw(); });
    host.querySelectorAll('[data-jar]').forEach((b) => b.addEventListener('click', () => { useJar = b.dataset.jar === 'yes'; const c = calc(); if (useJar && c.jar > jarBalance + 0.005) return error('The Shared Jar does not have enough for this 20% contribution.'); stage = 'payer'; draw(); }));
    host.querySelectorAll('[data-paytype]').forEach((b) => b.addEventListener('click', () => { paymentType = b.dataset.paytype; if (paymentType === 'solo') { paidUpfront = false; stage = 'review'; } else stage = 'upfront'; draw(); }));
    host.querySelectorAll('[data-upfront]').forEach((b) => b.addEventListener('click', () => { paidUpfront = b.dataset.upfront === 'yes'; stage = 'review'; draw(); }));
    host.querySelector('[data-back]')?.addEventListener('click', () => { if (stage === 'total') { persist(); onBack?.(); return; } stage = stage === 'jar' ? 'total' : stage === 'payer' ? 'jar' : stage === 'upfront' ? 'payer' : stage === 'review' ? (paymentType === 'shared' ? 'upfront' : 'payer') : 'total'; draw(); });
    host.querySelector('[data-edit]')?.addEventListener('click', () => { total = String(current.total ?? ''); useJar = !!existing.useJar; paymentType = ''; paidUpfront = false; stage = 'total'; draw(); });
    host.querySelector('[data-continue]')?.addEventListener('click', () => onDone(String(current.total || 0), false));
    host.querySelector('[data-save]')?.addEventListener('click', save);
    host.querySelectorAll('[data-repaid]').forEach((b) => b.addEventListener('click', () => confirmRepayment(b.dataset.repaid === 'yes')));
  }
  async function save() {
    if (busy) return; busy = true; host.querySelectorAll('button').forEach((b) => b.disabled = true);
    try {
      const result = await window.TwogetherAPI.post('saveAccommodationExpense', { planId: plan.id, total, useJar, paymentType, paidUpfront }, who);
      plan.sharedExpenses = { ...plan.sharedExpenses, accom: result.sharedExpense };
      clearSharedDraft(plan.id, 'accom', who);
      if (host.isConnected) onDone(String(result.sharedExpense.total || 0), false);
    } catch (e) { error(e.message || 'Could not save accommodation'); host.querySelectorAll('button').forEach((b) => b.disabled = false); } finally { busy = false; }
  }
  async function confirmRepayment(paidBack) {
    if (busy) return; busy = true; host.querySelectorAll('button').forEach((b) => b.disabled = true);
    try {
      const result = await window.TwogetherAPI.post('confirmAccommodationRepayment', { planId: plan.id, paidBack }, who);
      plan.sharedExpenses = { ...plan.sharedExpenses, accom: result.sharedExpense };
      if (host.isConnected) onDone(String(result.sharedExpense.total || 0), false);
    } catch (e) { error(e.message || 'Could not update repayment'); host.querySelectorAll('button').forEach((b) => b.disabled = false); } finally { busy = false; }
  }
  async function hydrate() {
    try { state = await window.TwogetherAPI.state(); jarBalance = Number(state?.sharedJar?.balance ?? 870); }
    catch { jarBalance = 870; }
    if (configured) {
      clearSharedDraft(plan.id, 'accom', who);
      if (repayment.debtor === who && (repayment.status === 'pending' || repayment.status === 'confirmed')) stage = 'repayment'; else stage = 'existing';
    } else stage = savedDraft?.stage || 'total';
    draw();
  }
  draw(); hydrate(); return true;
}

export function renderShared(opts) {
  return opts.key === 'accom' ? renderAccommodation(opts) : renderTravel(opts);
}
