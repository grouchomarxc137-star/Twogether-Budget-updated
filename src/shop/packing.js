// Per-trip packing checklist, unlocked by buying the "packing-list" reward
// in the Shop. Extracted from v28.js, rewired to import directly from
// shop/state.js instead of going through the window.TwogetherV27 bridge.
import { $, $$ } from '../lib/dom.js';
import { esc } from '../lib/format.js';
import { actor } from '../lib/session.js';
import { toast } from '../lib/toast.js';
import { profile, testState, has, post, refresh, ensureModal } from './state.js';

function packingFor(id) {
  const p = profile();
  return Array.isArray(p.packing?.[id]) ? p.packing[id].map((x) => ({ text: String(x?.text || ''), done: !!x?.done })) : [];
}

async function savePacking(id, list) {
  const a = actor();
  if (!a) throw new Error('Choose your profile first');
  if (testState().active) { toast('Packing preview is available in real mode only', 'warn'); return false; }
  await post('shopSavePacking', { id, list });
  setTimeout(() => refresh(true), 80);
  return true;
}

function openPacking(id) {
  if (!id) return toast('This trip is missing its packing reference', 'warn');
  const m = ensureModal(), body = $('#v27ModalBody', m), list = packingFor(id);
  body.innerHTML = '<div class="v28-pack-head"><span class="eyebrow">PACKING LIST</span><h2>Pack for this trip</h2><p>Keep your own little checklist here.</p></div><div class="v28-pack-add"><input id="v28PackInput" placeholder="Add something to pack"><button id="v28PackAdd" type="button">Add</button></div><div id="v28PackList" class="v28-pack-list"></div>';
  const draw = () => {
    const host = $('#v28PackList', m);
    host.innerHTML = list.length
      ? list.map((x, i) => `<div class="v28-pack-row ${x.done ? 'done' : ''}"><input type="checkbox" data-pack-check="${i}" ${x.done ? 'checked' : ''}><span>${esc(x.text)}</span><button type="button" data-pack-delete="${i}" aria-label="Delete ${esc(x.text)}">×</button></div>`).join('')
      : '<div class="v28-pack-empty">Nothing packed yet. Add your first item.</div>';
    $$('[data-pack-check]', host).forEach((c) => c.onchange = async () => {
      const i = Number(c.dataset.packCheck); list[i].done = c.checked; draw();
      try { await savePacking(id, list); } catch (e) { toast(e.message || 'Could not save packing', 'warn'); }
    });
    $$('[data-pack-delete]', host).forEach((b) => b.onclick = async () => {
      list.splice(Number(b.dataset.packDelete), 1); draw();
      try { await savePacking(id, list); } catch (e) { toast(e.message || 'Could not save packing', 'warn'); }
    });
  };
  const add = async () => {
    const input = $('#v28PackInput', m), text = input.value.trim(); if (!text) return;
    list.push({ text, done: false }); input.value = ''; draw();
    try { await savePacking(id, list); } catch (e) { toast(e.message || 'Could not save packing', 'warn'); }
  };
  $('#v28PackAdd', m).onclick = add;
  $('#v28PackInput', m).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  draw(); m.hidden = false;
  setTimeout(() => $('#v28PackInput', m)?.focus(), 0);
}

function syncPackingButtons() {
  const owned = has('packing-list');
  $$('#twCurrentTrips .tw-current-card').forEach((card) => {
    const actions = $('.tw-current-actions', card); if (!actions) return;
    let b = $('[data-v27-pack]', actions);
    if (!owned) { b?.remove(); return; }
    const id = card.dataset.currentPlan || card.dataset.currentTrip || ''; if (!id) return;
    if (!b) { b = document.createElement('button'); b.type = 'button'; b.className = 'text-btn'; b.dataset.v27Pack = id; b.textContent = 'Packing'; actions.insertBefore(b, actions.lastElementChild); }
    b.dataset.v27Pack = id;
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openPacking(id); };
  });
}

function installPackingCapture() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-v27-pack]'); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    openPacking(b.dataset.v27Pack || b.closest('.tw-current-card')?.dataset.currentPlan || b.closest('.tw-current-card')?.dataset.currentTrip || '');
  }, true);
}

export function initPacking() {
  installPackingCapture();
  syncPackingButtons();
  document.addEventListener('twogether:v18-rendered', () => requestAnimationFrame(syncPackingButtons));
  document.addEventListener('twogether:shop-refreshed', () => requestAnimationFrame(syncPackingButtons));
  document.addEventListener('twogether:shop-award', () => requestAnimationFrame(syncPackingButtons));
  document.addEventListener('twogether:saved', () => setTimeout(syncPackingButtons, 120));
  window.addEventListener('focus', syncPackingButtons);
  setTimeout(syncPackingButtons, 350);
  setTimeout(syncPackingButtons, 1100);
}

initPacking();
