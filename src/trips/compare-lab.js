// Compare Lab: a free-form two-scenario budget comparator, part of the
// Trips hub's #compare sheet. Extracted from v27.js.
import { $, $$ } from '../lib/dom.js';
import { esc, n as num, money, uid } from '../lib/format.js';
import { actor } from '../lib/session.js';
import { toast } from '../lib/toast.js';
import { financeProfile, post, refresh, setCompareLab } from '../shop/state.js';

function blankLab() {
  return {
    id: uid(), titleA: 'Scenario A', titleB: 'Scenario B',
    rowsA: [{ id: uid(), name: 'Transport', amount: '' }, { id: uid(), name: 'Stay', amount: '' }, { id: uid(), name: 'Food', amount: '' }],
    rowsB: [{ id: uid(), name: 'Transport', amount: '' }, { id: uid(), name: 'Stay', amount: '' }, { id: uid(), name: 'Food', amount: '' }],
  };
}

function labData() {
  const raw = financeProfile()?.compareLab;
  return raw && raw.id ? JSON.parse(JSON.stringify(raw)) : blankLab();
}

function scenarioTotal(rows) {
  return (rows || []).reduce((s, x) => s + num(x.amount), 0);
}

export function renderCompareLab() {
  const host = $('#compare');
  if (!host || !actor()) return;
  let sec = $('#v27CompareLab');
  if (!sec) { sec = document.createElement('section'); sec.id = 'v27CompareLab'; host.appendChild(sec); }
  const lab = labData();
  sec.dataset.labId = lab.id;
  sec.innerHTML = `<div class="v27-compare-head"><div><span class="eyebrow">BUILD YOUR OWN</span><h2>Compare any two scenarios</h2><p>Perfect for two versions of the same trip, car options, rentals, or anything else you want to compare.</p></div><button data-new-compare>New comparison</button></div><div class="v27-custom-compare">${['A', 'B'].map((side) => scenarioHtml(lab, side)).join('')}</div><div id="v27CompareVerdict" class="v27-compare-verdict"></div>`;
  bindCompare(sec, lab);
  updateCompareVerdict(sec);
}

function scenarioHtml(lab, side) {
  const rows = lab['rows' + side] || [];
  return `<article class="v27-scenario" data-side="${side}"><input class="v27-scenario-title" value="${esc(lab['title' + side] || `Scenario ${side}`)}" aria-label="Scenario ${side} title"><div class="v27-scenario-rows">${rows.map((r, i) => `<div class="v27-scenario-row" data-row="${i}"><input data-row-name value="${esc(r.name || '')}" placeholder="Cost name"><div><span>€</span><input data-row-amount inputmode="decimal" value="${esc(String(r.amount ?? ''))}" placeholder="0.00"></div><button data-row-remove aria-label="Remove row">×</button></div>`).join('')}</div><div class="v27-scenario-foot"><button data-add-row>+ Add row</button><div><span>Total</span><strong data-scenario-total>${money(scenarioTotal(rows))}</strong></div><button data-save-scenario>Save scenario</button></div></article>`;
}

function readLab(sec, base) {
  const lab = { ...base, id: sec.dataset.labId };
  ['A', 'B'].forEach((side) => {
    const card = $(`[data-side="${side}"]`, sec);
    lab['title' + side] = $('.v27-scenario-title', card)?.value.trim() || `Scenario ${side}`;
    lab['rows' + side] = $$('.v27-scenario-row', card).map((row) => ({
      id: uid(),
      name: $('[data-row-name]', row)?.value.trim() || 'Cost',
      amount: $('[data-row-amount]', row)?.value.trim() === '' ? '' : num($('[data-row-amount]', row)?.value),
    }));
  });
  return lab;
}

function updateCompareVerdict(sec) {
  const cards = $$('.v27-scenario', sec);
  const totals = cards.map((c) => {
    const total = $$('.v27-scenario-row', c).reduce((s, row) => s + num($('[data-row-amount]', row)?.value), 0);
    $('[data-scenario-total]', c).textContent = money(total);
    return total;
  });
  const v = $('#v27CompareVerdict', sec);
  if (!v) return;
  if (!totals[0] && !totals[1]) {
    v.innerHTML = '<span>Add costs to both sides and Twogether will compare them here.</span>';
  } else if (Math.abs(totals[0] - totals[1]) < 0.005) {
    v.innerHTML = '<strong>Same total</strong><span>Both scenarios currently cost the same.</span>';
  } else {
    const win = totals[0] < totals[1] ? 0 : 1, diff = Math.abs(totals[0] - totals[1]);
    v.innerHTML = `<strong>${esc($('.v27-scenario-title', cards[win]).value || `Scenario ${win ? 'B' : 'A'}`)} is cheaper</strong><span>By ${money(diff)}.</span>`;
  }
}

function bindCompare(sec, base) {
  sec.addEventListener('input', () => updateCompareVerdict(sec));
  $$('[data-add-row]', sec).forEach((b) => b.onclick = () => {
    const card = b.closest('.v27-scenario'), rows = $('.v27-scenario-rows', card), div = document.createElement('div');
    div.className = 'v27-scenario-row';
    div.innerHTML = '<input data-row-name placeholder="Cost name"><div><span>€</span><input data-row-amount inputmode="decimal" placeholder="0.00"></div><button data-row-remove aria-label="Remove row">×</button>';
    rows.appendChild(div);
    $('[data-row-remove]', div).onclick = () => { div.remove(); updateCompareVerdict(sec); };
    $('[data-row-name]', div).focus();
  });
  $$('[data-row-remove]', sec).forEach((b) => b.onclick = () => { b.closest('.v27-scenario-row').remove(); updateCompareVerdict(sec); });
  $$('[data-save-scenario]', sec).forEach((b) => b.onclick = async () => {
    const side = b.closest('[data-side]').dataset.side, lab = readLab(sec, base);
    try {
      const r = await post('saveCompareLab', { lab, side });
      toast(r?.compareCompleteAwarded ? '+10 Lovis · comparison saved and completed' : '+4 Lovis · scenario saved');
      await refresh(true);
    } catch (e) {
      toast(e.message, 'warn');
    }
  });
  $('[data-new-compare]', sec).onclick = () => {
    const fresh = blankLab();
    setCompareLab(fresh);
    renderCompareLab();
  };
}
