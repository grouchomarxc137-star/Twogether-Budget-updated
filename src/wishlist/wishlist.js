// The wishlist boutique + basket: save up "Twos" (earned by beating your
// budget) and spend them on real wishlist items. Extracted from v27.js.
import { $, $$ } from '../lib/dom.js';
import { esc, n as num, money, uid } from '../lib/format.js';
import { actor } from '../lib/session.js';
import { toast } from '../lib/toast.js';
import { fmt, financeProfile, post, refresh, testState, saveTest, effective, ensureModal } from '../shop/state.js';

const CART_PREFIX = 'twogether_v27_cart:';

function normalizeWish(x) {
  const marker = String(x?.note || '').match(/^\s*\[\[P([1-5])\]\]\s*/i);
  return {
    id: x?.id || uid(), name: String(x?.name || ''), price: x?.price ?? '',
    note: String(x?.note || '').replace(/^\s*\[\[P[1-5]\]\]\s*/i, ''),
    priority: Number(x?.priority || marker?.[1] || 3),
    createdAt: String(x?.createdAt || ''), unlockedAt: String(x?.unlockedAt || ''), unlockedBy: String(x?.unlockedBy || ''),
  };
}

export function wishes() {
  return (financeProfile()?.wishlist || []).map(normalizeWish).filter((x) => x.name);
}

function cart() {
  try {
    const t = testState();
    const raw = t.active ? sessionStorage.getItem(CART_PREFIX + 'test:' + actor()) : localStorage.getItem(CART_PREFIX + actor());
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveCart(ids) {
  try {
    (testState().active ? sessionStorage : localStorage).setItem(CART_PREFIX + (testState().active ? 'test:' : '') + actor(), JSON.stringify([...new Set(ids)]));
  } catch {}
}

function noteParts(note) {
  const m = String(note || '').match(/https?:\/\/\S+/i);
  if (!m) return { text: String(note || '').trim(), link: '' };
  return { link: m[0], text: (String(note || '').slice(0, m.index) + String(note || '').slice((m.index || 0) + m[0].length)).trim() };
}

let wishPriority = 'all', wishView = 'wishes', wishActor = '', wishRenderKey = '';

function effectiveTwos() {
  const t = testState();
  return t.active ? t.twos : effective().twos;
}

function hasWishPrice(w) {
  return w.price !== '' && w.price != null && Number.isFinite(Number(w.price)) && num(w.price) >= 0;
}

function wishEarned(w) {
  return !!w.unlockedAt || (testState().active && testState().wishlistBought.includes(w.id));
}

function wishlistAdvice(gap) {
  if (gap <= 0) return 'Your budget wins have covered this basket. A little well-earned yes.';
  return `Finish future trips or months ${money(gap)} better than budget to cover this basket. Small wins count too.`;
}

export function renderWishlist() {
  const root = $('#financeWishlist');
  if (!root || !actor()) return;
  if (wishActor !== actor()) { wishPriority = 'all'; wishView = 'wishes'; wishActor = actor(); }
  const list = wishes(), ids = cart(), twos = effectiveTwos(), t = testState();
  const selected = list.filter((x) => ids.includes(x.id) && !wishEarned(x) && hasWishPrice(x));
  const total = selected.reduce((sum, x) => sum + num(x.price), 0), gap = Math.max(0, total - twos);
  const earned = list.filter(wishEarned), waiting = list.filter((x) => !wishEarned(x));
  const key = JSON.stringify([actor(), list, ids, twos, t.active, t.wishlistBought, wishPriority, wishView, checkoutBusy]);
  if (wishRenderKey === key && root.querySelector('.v28-boutique')) return;
  wishRenderKey = key;
  const active = document.activeElement;
  const focus = active && root.contains(active)
    ? ['wish-edit', 'cart-toggle', 'cart-remove', 'priority', 'wish-view', 'wish-add', 'checkout'].map((a) => [a, active.getAttribute('data-' + a)]).find((x) => x[1] !== null)
    : null;
  root.innerHTML = `<div class="v27-wish-shell v28-boutique">
 <header class="v27-wish-hero"><div><span class="eyebrow">THE LITTLE WISHLIST SHOP</span><h1>Good things, worth saving for.</h1><p>${esc(actor())}’s collection of little wants and bigger dreams.</p></div><div class="v27-twos-wallet"><span>${t.active ? 'Test balance' : 'Available Twos'}</span><strong>${fmt(twos)} <i>Twos</i></strong><small>${twos < 0 ? 'Your next budget wins rebuild this balance.' : '€1 better than budget = 1 Two'}</small></div></header>
 ${t.active ? '<div class="v28-test-banner" role="status">Test Lab · Try your basket with test Twos. Real wishes and balances stay untouched.</div>' : ''}
 <div class="v28-shop-layout"><section class="v28-collection" aria-label="Wishlist collection">
 <div class="v27-wish-actions"><div class="v28-view-tabs" aria-label="Collection"><button data-wish-view="wishes" aria-pressed="${wishView === 'wishes'}">On my wishlist <span>${waiting.length}</span></button><button data-wish-view="earned" aria-pressed="${wishView === 'earned'}">Earned <span>${earned.length}</span></button></div><button class="btn primary" data-wish-add ${t.active ? 'disabled' : ''}>+ Add a wish</button></div>
 <div class="v28-filter-row"><span>Priority</span><div class="v27-priority-filter" aria-label="Filter by priority"><button data-priority="all" aria-pressed="${wishPriority === 'all'}" class="${wishPriority === 'all' ? 'active' : ''}">All</button>${[1, 2, 3, 4, 5].map((p) => `<button data-priority="${p}" aria-pressed="${wishPriority === String(p)}" class="${wishPriority === String(p) ? 'active' : ''}" title="${['', 'Most wanted', 'High priority', 'Someday soon', 'Nice to have', 'Just dreaming'][p]}">P${p}</button>`).join('')}</div><small>P1 = most wanted</small></div>
 <a class="v28-mobile-basket" href="#v28Basket">View basket · ${selected.length} ${selected.length === 1 ? 'wish' : 'wishes'} <strong>${money(total)} ↓</strong></a><div class="v27-wish-grid">${list.map((w) => wishCard(w, ids)).join('')}</div><div class="v27-wish-empty" data-wish-empty hidden><span aria-hidden="true">♡</span><h3>${wishView === 'earned' ? 'Your little victories belong here.' : list.length ? 'A little room for another wish.' : 'What are you dreaming of?'}</h3><p>${wishView === 'earned' ? 'Unlock a wish with Twos and keep it here as a little reminder of what you earned.' : list.length ? 'No wishes match this priority. Try All, or add something new.' : 'Add your first wish, give it a price, and turn your budget wins into something you love.'}</p></div>
 </section><aside id="v28Basket" class="v27-cart" aria-label="Shopping basket" tabindex="-1"><div class="v27-cart-head"><div><span class="eyebrow">SET ASIDE FOR YOU</span><h2>Your little basket</h2></div><span class="v28-bag-count">${selected.length}</span></div>
 ${selected.length ? `<div class="v27-cart-items">${selected.map((x) => `<div><span>${esc(x.name)}</span><b>${money(x.price)}</b><button data-cart-remove="${esc(x.id)}" aria-label="Remove ${esc(x.name)} from basket">×</button></div>`).join('')}</div><dl class="v28-basket-totals"><div><dt>Basket total</dt><dd>${money(total)}</dd></div><div><dt>${t.active ? 'Test Twos' : 'Available Twos'}</dt><dd>${fmt(twos)}</dd></div></dl><div class="v27-cart-plan ${gap ? 'not-ready' : 'ready'}" aria-live="polite"><strong>${gap ? `${fmt(gap)} Twos to go` : 'Ready to unlock ♡'}</strong><progress max="100" value="${total > 0 ? Math.min(100, Math.max(0, twos) / total * 100) : gap ? 0 : 100}" aria-label="Basket covered by Twos"></progress><p>${wishlistAdvice(gap)}</p>${gap ? `<small>Two smaller wins of ${money(Math.ceil(gap / 2))} + ${money(gap - Math.ceil(gap / 2))} would get you there.</small>` : `<small>${fmt(twos - total)} Twos left after unlocking.</small>`}</div><button class="btn primary v27-checkout" data-checkout ${gap || checkoutBusy ? 'disabled' : ''}>${checkoutBusy ? 'Unlocking…' : t.active ? 'Preview checkout' : 'Unlock my wishes'} <span aria-hidden="true">→</span></button>` : '<div class="v28-basket-empty"><span aria-hidden="true">♡</span><h3>A little something for you?</h3><p>Add a wish to see how close you are. We’ll do the maths.</p></div>'}
 <p class="v28-basket-footnote">A playful reward for real saving.<br>No payment. No order placed.</p></aside></div></div>`;
  bindWishlist(root);
  applyWishFilter(root);
  if (focus) $$('[data-' + focus[0] + ']', root).find((x) => x.getAttribute('data-' + focus[0]) === focus[1])?.focus({ preventScroll: true });
}

function wishCard(w, ids) {
  const parts = noteParts(w.note), inCart = ids.includes(w.id), priced = hasWishPrice(w), twos = effectiveTwos();
  const earned = wishEarned(w), ready = priced && twos >= num(w.price), gap = Math.max(0, num(w.price) - twos);
  return `<article class="v27-wish-card ${earned ? 'earned' : ''} ${inCart ? 'v28-selected' : ''}" data-priority="${w.priority}" data-earned="${earned}"><div class="v27-wish-top"><span>P${w.priority} · ${['', 'Most wanted', 'High priority', 'Someday soon', 'Nice to have', 'Just dreaming'][w.priority] || 'Someday soon'}</span><b>${earned ? 'Earned ♡' : inCart ? 'In your basket' : ready ? 'Within reach' : 'Saving for'}</b></div><div class="v28-wish-title"><h3>${esc(w.name)}</h3><strong class="v27-wish-price">${priced ? money(w.price) : 'Price to come'}</strong></div><p class="v28-wish-note">${esc(parts.text || 'A little wish with your name on it.')}</p>${parts.link ? `<a href="${esc(parts.link)}" target="_blank" rel="noopener noreferrer">Take a closer look ↗</a>` : ''}<div class="v28-wish-readiness">${earned ? 'Your saving made this possible.' : !priced ? 'Add a price to start saving towards it.' : ready ? 'Your Twos can cover this wish.' : `${fmt(gap)} more Twos to cover this wish.`}</div><div class="v27-wish-card-actions"><button data-wish-edit="${esc(w.id)}" aria-label="Edit ${esc(w.name)}" ${testState().active ? 'disabled' : ''}>Edit wish</button>${priced && !earned ? `<button data-cart-toggle="${esc(w.id)}" aria-pressed="${inCart}" class="${inCart ? 'in-cart' : ''}">${inCart ? 'Added ✓' : 'Add to basket +'}</button>` : ''}</div></article>`;
}

function applyWishFilter(root) {
  let visible = 0;
  $$('.v27-wish-card', root).forEach((c) => {
    c.hidden = (wishPriority !== 'all' && c.dataset.priority !== wishPriority) || (c.dataset.earned === 'true') !== (wishView === 'earned');
    if (!c.hidden) visible++;
  });
  const empty = $('[data-wish-empty]', root);
  if (empty) empty.hidden = visible > 0;
}

function bindWishlist(root) {
  $('[data-wish-add]', root)?.addEventListener('click', () => openWishEditor());
  $$('[data-wish-edit]', root).forEach((b) => b.onclick = () => openWishEditor(b.dataset.wishEdit));
  $$('[data-cart-toggle]', root).forEach((b) => b.onclick = () => { const ids = cart(), id = b.dataset.cartToggle; saveCart(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]); renderWishlist(); });
  $$('[data-cart-remove]', root).forEach((b) => b.onclick = () => { saveCart(cart().filter((id) => id !== b.dataset.cartRemove)); renderWishlist(); });
  $$('button[data-priority]', root).forEach((b) => b.onclick = () => { wishPriority = b.dataset.priority; renderWishlist(); });
  $$('[data-wish-view]', root).forEach((b) => b.onclick = () => { wishView = b.dataset.wishView; renderWishlist(); });
  $('[data-checkout]', root)?.addEventListener('click', checkoutWishlist);
}

function openWishEditor(id = '') {
  if (testState().active) return;
  let saving = false;
  const editorActor = actor();
  const current = wishes().find((x) => x.id === id), m = ensureModal(), body = $('#v27ModalBody', m);
  body.innerHTML = `<span class="eyebrow">WISHLIST</span><h2>${current ? 'Edit wish' : 'Add a wish'}</h2><div class="v27-wish-fields"><label>What do you want?<input id="v27WishName" value="${esc(current?.name || '')}" placeholder="e.g. New headphones"></label><label>Price<div><span>€</span><input id="v27WishPrice" inputmode="decimal" value="${esc(String(current?.price ?? ''))}" placeholder="0"></div></label><label>Priority<select id="v27WishPriority">${[1, 2, 3, 4, 5].map((p) => `<option value="${p}" ${p === (current?.priority || 3) ? 'selected' : ''}>P${p}</option>`).join('')}</select></label><label class="wide">Note or link<textarea id="v27WishNote" placeholder="Why you want it, model, link…">${esc(current?.note || '')}</textarea></label></div><div class="v27-modal-actions">${current ? '<button data-wish-delete>Delete</button>' : '<span></span>'}<button class="btn primary" data-wish-save>Save wish</button></div>`;
  const save = async () => {
    if (saving || actor() !== editorActor) return;
    const name = $('#v27WishName').value.trim(), raw = $('#v27WishPrice').value.trim(), note = $('#v27WishNote').value.trim(), priority = Number($('#v27WishPriority').value);
    if (!name) return toast('Add a name first', 'warn');
    if (raw !== '' && (!Number.isFinite(Number(raw.replace(',', '.'))) || num(raw) < 0)) return toast('Enter a valid price', 'warn');
    const list = wishes();
    const row = { id: current?.id || uid(), name, price: raw === '' ? '' : num(raw), note, priority, createdAt: current?.createdAt || new Date().toISOString(), unlockedAt: current?.unlockedAt || '', unlockedBy: current?.unlockedBy || '' };
    const idx = list.findIndex((x) => x.id === row.id);
    if (idx >= 0) list[idx] = row; else list.push(row);
    saving = true;
    const button = $('[data-wish-save]');
    button.disabled = true; button.textContent = 'Saving…';
    try {
      if (await saveWishlist(list)) m.hidden = true;
    } finally {
      saving = false; button.disabled = false; button.textContent = 'Save wish';
    }
  };
  $('[data-wish-save]').onclick = save;
  $('[data-wish-delete]')?.addEventListener('click', async () => {
    const list = wishes().filter((x) => x.id !== current.id);
    saveCart(cart().filter((x) => x !== current.id));
    await saveWishlist(list);
    m.hidden = true;
  });
  m.hidden = false;
}

async function saveWishlist(list) {
  if (testState().active) { toast('End Test Lab to edit your real wishes', 'warn'); return false; }
  try {
    await refresh(true);
    const fp = { ...financeProfile(), wishlist: list };
    await post('saveFinanceProfile', { profile: fp });
    toast('Wishlist saved');
    await refresh(true);
    return true;
  } catch (e) {
    toast(e.message || 'Could not save Wishlist', 'warn');
    return false;
  }
}

let checkoutBusy = false;
async function checkoutWishlist() {
  if (checkoutBusy) return;
  const ids = cart(), selected = wishes().filter((x) => ids.includes(x.id) && !wishEarned(x) && hasWishPrice(x));
  const total = selected.reduce((sum, x) => sum + num(x.price), 0), t = testState();
  if (!selected.length) return;
  if (effectiveTwos() < total) return toast('Your basket needs more Twos before unlocking', 'warn');
  checkoutBusy = true;
  renderWishlist();
  try {
    if (t.active) {
      t.twos -= total;
      t.wishlistBought = [...new Set([...t.wishlistBought, ...selected.map((x) => x.id)])];
      saveTest(t);
      saveCart([]);
      showReceipt(selected, total, true);
    } else {
      await post('wishlistCheckout', { ids: selected.map((x) => x.id) });
      saveCart([]);
      showReceipt(selected, total, false);
      await refresh(true);
    }
  } catch (e) {
    toast(e.message || 'Checkout failed', 'warn');
  } finally {
    checkoutBusy = false;
    document.dispatchEvent(new CustomEvent('twogether:shop-refresh-all'));
  }
}

function showReceipt(items, total, preview) {
  const m = ensureModal(), body = $('#v27ModalBody', m);
  body.innerHTML = `<div class="v27-receipt"><span>♡</span><small>${preview ? 'TEST CHECKOUT' : 'TWOGETHER WISHLIST'}</small><h2>You earned this${items.length > 1 ? ' haul' : ''}.</h2><div>${items.map((x) => `<p><span>${esc(x.name)}</span><b>${money(x.price)}</b></p>`).join('')}</div><strong>${fmt(total)} Twos</strong><p>${preview ? 'Nothing real was changed.' : 'This does not buy anything in real life — it means your budget wins covered the goal.'}</p></div>`;
  m.hidden = false;
}
