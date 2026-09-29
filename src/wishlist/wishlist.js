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

let wishPriority = 'all', wishView = 'wishes', wishStatus = 'all', wishActor = '', wishRenderKey = '';

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

const WISH_PRIORITY_LABELS = ['', 'Most wanted', 'High priority', 'Someday soon', 'Nice to have', 'Just dreaming'];

function wishVisual(w) {
  const text = (String(w?.name || '') + ' ' + String(w?.note || '')).toLowerCase();
  const rules = [
    [/(travel|trip|flight|hotel|holiday|weekend|garda|suitcase|luggage)/, '✈'],
    [/(headphone|earbud|speaker|music|sony)/, '♫'],
    [/(camera|instax|photo)/, '◉'],
    [/(coffee|espresso|smeg)/, '☕'],
    [/(home|house|lamp|decor|kitchen|pan|pot|creuset)/, '⌂'],
    [/(phone|iphone|ipad|mac|laptop|computer|tech)/, '⌘'],
    [/(shoe|bag|dress|clothes|fashion)/, '✦'],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] || '♡';
}

function wishlistGoal(waiting, selected, twos) {
  if (selected.length) {
    const total = selected.reduce((sum, item) => sum + num(item.price), 0);
    return {
      target: total,
      label: 'Basket goal',
      detail: selected.length + ' ' + (selected.length === 1 ? 'wish' : 'wishes') + ' · ' + money(total),
    };
  }
  const priced = waiting.filter(hasWishPrice).sort((a, b) => num(a.price) - num(b.price));
  if (!priced.length) return { target: 0, label: 'Next goal', detail: 'Add a price to a wish' };
  const next = priced.find((item) => num(item.price) > Math.max(0, twos)) || priced[0];
  return {
    target: num(next.price),
    label: twos >= num(next.price) ? 'Ready now' : 'Next wish',
    detail: next.name,
  };
}

export function renderWishlist() {
  const root = $('#financeWishlist');
  if (!root || !actor()) return;
  if (wishActor !== actor()) {
    wishPriority = 'all';
    wishView = 'wishes';
    wishStatus = 'all';
    wishActor = actor();
  }

  const list = wishes(), ids = cart(), twos = effectiveTwos(), t = testState();
  const selected = list.filter((x) => ids.includes(x.id) && !wishEarned(x) && hasWishPrice(x));
  const total = selected.reduce((sum, x) => sum + num(x.price), 0);
  const gap = Math.max(0, total - twos);
  const earned = list.filter(wishEarned);
  const waiting = list.filter((x) => !wishEarned(x));
  const readyCount = waiting.filter((x) => hasWishPrice(x) && twos >= num(x.price)).length;
  const goal = wishlistGoal(waiting, selected, twos);
  const goalProgress = goal.target > 0 ? Math.min(100, Math.max(0, twos) / goal.target * 100) : 0;

  const key = JSON.stringify([actor(), list, ids, twos, t.active, t.wishlistBought, wishPriority, wishView, wishStatus, checkoutBusy]);
  if (wishRenderKey === key && root.querySelector('.tw-wishlist')) return;
  wishRenderKey = key;

  const active = document.activeElement;
  const focus = active && root.contains(active)
    ? ['wish-edit', 'cart-toggle', 'cart-remove', 'priority', 'wish-view', 'wish-status', 'wish-add', 'checkout']
      .map((a) => [a, active.getAttribute('data-' + a)])
      .find((x) => x[1] !== null)
    : null;

  const statusFilters = wishView === 'wishes'
    ? `<div class="tw-wish-status" aria-label="Wishlist status">
        <button data-wish-status="all" aria-pressed="${wishStatus === 'all'}">All wishes <span>${waiting.length}</span></button>
        <button data-wish-status="ready" aria-pressed="${wishStatus === 'ready'}">Ready now <span>${readyCount}</span></button>
        <button data-wish-status="basket" aria-pressed="${wishStatus === 'basket'}">In basket <span>${selected.length}</span></button>
      </div>`
    : '';

  const emptyTitle = wishView === 'earned'
    ? 'Your earned wishes will live here.'
    : wishStatus === 'ready'
      ? 'Nothing is within reach just yet.'
      : wishStatus === 'basket'
        ? 'Your basket is empty.'
        : list.length
          ? 'No wishes match these filters.'
          : 'What are you dreaming of?';
  const emptyText = wishView === 'earned'
    ? 'When your Twos unlock a wish, it stays here as a little record of the win.'
    : wishStatus === 'ready'
      ? 'Keep collecting Twos, or choose All wishes to see everything.'
      : wishStatus === 'basket'
        ? 'Add any priced wish to your basket and it will appear here.'
        : list.length
          ? 'Try another priority or reset the filters.'
          : 'Add your first wish and let your budget wins slowly bring it closer.';

  root.innerHTML = `<div class="tw-wishlist">
    <div class="tw-wish-topline">
      <div class="tw-wish-owner">
        <span class="tw-wish-owner-heart" aria-hidden="true">♡</span>
        <div><small>${esc(actor())}'s wishlist</small><strong>${waiting.length} ${waiting.length === 1 ? 'wish' : 'wishes'} waiting</strong></div>
      </div>
      <button class="tw-wish-add" data-wish-add ${t.active ? 'disabled' : ''}>＋ Add wish</button>
    </div>

    ${t.active ? '<div class="tw-wish-test" role="status">Test Lab · Your real wishlist and Twos stay untouched.</div>' : ''}

    <section class="tw-wish-points" aria-label="Twogether points">
      <div class="tw-wish-points-head">
        <div class="tw-wish-points-value">
          <span class="tw-wish-points-icon" aria-hidden="true">✦</span>
          <div>
            <small>${t.active ? 'Test Twogether points' : 'Twogether points'}</small>
            <strong>${fmt(twos)} <em>Twos</em></strong>
          </div>
        </div>
        <a href="#v28Basket">View basket <span aria-hidden="true">→</span></a>
      </div>
      <div class="tw-wish-points-track" aria-hidden="true"><i style="width:${goalProgress.toFixed(1)}%"></i></div>
      <div class="tw-wish-points-foot">
        <span>${esc(goal.label)}</span>
        <strong>${esc(goal.detail)}</strong>
        <small>€1 better than budget = 1 Two</small>
      </div>
    </section>

    <div class="tw-wish-controls">
      <div class="tw-wish-view-tabs" aria-label="Wishlist collection">
        <button data-wish-view="wishes" aria-pressed="${wishView === 'wishes'}">Wishlist <span>${waiting.length}</span></button>
        <button data-wish-view="earned" aria-pressed="${wishView === 'earned'}">Earned <span>${earned.length}</span></button>
      </div>
      ${statusFilters}
      <div class="tw-wish-priority" aria-label="Filter by priority">
        <button data-priority="all" aria-pressed="${wishPriority === 'all'}">All priorities</button>
        ${[1, 2, 3, 4, 5].map((p) => `<button data-priority="${p}" aria-pressed="${wishPriority === String(p)}" title="${WISH_PRIORITY_LABELS[p]}">P${p}</button>`).join('')}
      </div>
    </div>

    <div class="tw-wish-layout">
      <section class="tw-wish-collection" aria-label="Wishlist collection">
        <button type="button" class="tw-wish-mobile-basket" data-basket-jump>
          <span><b>Basket</b><small>${selected.length} ${selected.length === 1 ? 'wish' : 'wishes'}</small></span>
          <strong>${money(total)} <i aria-hidden="true">→</i></strong>
        </button>

        <div class="tw-wish-grid">${list.map((w) => wishCard(w, ids)).join('')}</div>
        <div class="tw-wish-empty" data-wish-empty hidden>
          <span aria-hidden="true">♡</span>
          <h3>${emptyTitle}</h3>
          <p>${emptyText}</p>
        </div>
      </section>

      <aside id="v28Basket" class="tw-wish-basket" aria-label="Wishlist basket" tabindex="-1">
        <div class="tw-wish-basket-head">
          <div><small>SET ASIDE FOR YOU</small><h2>Your basket</h2></div>
          <span>${selected.length}</span>
        </div>
        ${selected.length ? `
          <div class="tw-wish-basket-items">${selected.map((x) => `<div>
            <span>${esc(x.name)}</span>
            <b>${money(x.price)}</b>
            <button data-cart-remove="${esc(x.id)}" aria-label="Remove ${esc(x.name)} from basket">×</button>
          </div>`).join('')}</div>
          <div class="tw-wish-basket-total"><span>Basket total</span><strong>${money(total)}</strong></div>
          <div class="tw-wish-basket-total is-points"><span>${t.active ? 'Test Twos' : 'Available Twos'}</span><strong>${fmt(twos)}</strong></div>
          <div class="tw-wish-basket-plan ${gap ? 'is-waiting' : 'is-ready'}" aria-live="polite">
            <div><strong>${gap ? fmt(gap) + ' Twos to go' : 'Ready to unlock ♡'}</strong><span>${total > 0 ? Math.min(100, Math.max(0, twos) / total * 100).toFixed(0) : 100}%</span></div>
            <progress max="100" value="${total > 0 ? Math.min(100, Math.max(0, twos) / total * 100) : 100}" aria-label="Basket covered by Twos"></progress>
            <p>${wishlistAdvice(gap)}</p>
          </div>
          <button class="tw-wish-checkout" data-checkout ${gap || checkoutBusy ? 'disabled' : ''}>${checkoutBusy ? 'Unlocking…' : t.active ? 'Preview checkout' : 'Unlock my wishes'} <span aria-hidden="true">→</span></button>
        ` : `
          <div class="tw-wish-basket-empty"><span aria-hidden="true">♡</span><h3>Nothing in the basket yet</h3><p>Add a priced wish when you want to see how close your Twos are to covering it.</p></div>
        `}
        <p class="tw-wish-basket-note">Twos are a playful reward for saving. No payment or real order is placed here.</p>
      </aside>
    </div>
  </div>`;

  bindWishlist(root);
  applyWishFilter(root);
  if (focus) {
    $$('[data-' + focus[0] + ']', root)
      .find((x) => x.getAttribute('data-' + focus[0]) === focus[1])
      ?.focus({ preventScroll: true });
  }
}

function wishCard(w, ids) {
  const parts = noteParts(w.note), inCart = ids.includes(w.id), priced = hasWishPrice(w), twos = effectiveTwos();
  const earned = wishEarned(w), ready = priced && twos >= num(w.price), gap = Math.max(0, num(w.price) - twos);
  const progress = earned ? 100 : priced && num(w.price) > 0 ? Math.min(100, Math.max(0, twos) / num(w.price) * 100) : 0;
  const status = earned ? 'Earned' : inCart ? 'In basket' : ready ? 'Ready now' : priced ? 'Saving' : 'No price';
  const readiness = earned
    ? 'You earned this one.'
    : !priced
      ? 'Add a price to track progress.'
      : ready
        ? 'Your Twos can cover it.'
        : fmt(gap) + ' Twos to go.';

  return `<article class="tw-wish-card ${earned ? 'is-earned' : ''} ${inCart ? 'is-selected' : ''}" data-priority="${w.priority}" data-earned="${earned}" data-ready="${ready}" data-in-cart="${inCart}">
    <div class="tw-wish-card-visual tone-${Math.min(5, Math.max(1, Number(w.priority) || 3))}">
      <span aria-hidden="true">${wishVisual(w)}</span>
      <i>P${w.priority}</i>
      <b>${status}</b>
    </div>
    <div class="tw-wish-card-body">
      <div class="tw-wish-card-title">
        <h3>${esc(w.name)}</h3>
        <strong>${priced ? money(w.price) : 'Price later'}</strong>
      </div>
      <p class="tw-wish-card-note">${esc(parts.text || WISH_PRIORITY_LABELS[w.priority] || 'A little wish for later.')}</p>
      ${parts.link ? `<a class="tw-wish-link" href="${esc(parts.link)}" target="_blank" rel="noopener noreferrer">Open link ↗</a>` : ''}
      <div class="tw-wish-card-progress" aria-hidden="true"><i><em style="width:${progress.toFixed(1)}%"></em></i></div>
      <small class="tw-wish-card-readiness">${readiness}</small>
      <div class="tw-wish-card-actions">
        <button class="tw-wish-edit" data-wish-edit="${esc(w.id)}" aria-label="Edit ${esc(w.name)}" ${testState().active ? 'disabled' : ''}>Edit</button>
        ${priced && !earned ? `<button class="tw-wish-cart-toggle ${inCart ? 'is-in-cart' : ''}" data-cart-toggle="${esc(w.id)}" aria-pressed="${inCart}">${inCart ? 'Added ✓' : 'Add to basket'}</button>` : ''}
      </div>
    </div>
  </article>`;
}

function applyWishFilter(root) {
  let visible = 0;
  $$('.tw-wish-card', root).forEach((card) => {
    const priorityMatch = wishPriority === 'all' || card.dataset.priority === wishPriority;
    const viewMatch = (card.dataset.earned === 'true') === (wishView === 'earned');
    const statusMatch = wishView !== 'wishes' || wishStatus === 'all'
      || (wishStatus === 'ready' && card.dataset.ready === 'true')
      || (wishStatus === 'basket' && card.dataset.inCart === 'true');
    card.hidden = !(priorityMatch && viewMatch && statusMatch);
    if (!card.hidden) visible++;
  });
  const empty = $('[data-wish-empty]', root);
  if (empty) empty.hidden = visible > 0;
}

function bindWishlist(root) {
  $('[data-wish-add]', root)?.addEventListener('click', () => openWishEditor());
  $$('[data-wish-edit]', root).forEach((b) => b.onclick = () => openWishEditor(b.dataset.wishEdit));
  $$('[data-cart-toggle]', root).forEach((b) => b.onclick = () => {
    const ids = cart(), id = b.dataset.cartToggle;
    saveCart(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
    renderWishlist();
  });
  $$('[data-cart-remove]', root).forEach((b) => b.onclick = () => {
    saveCart(cart().filter((id) => id !== b.dataset.cartRemove));
    renderWishlist();
  });
  $$('button[data-priority]', root).forEach((b) => b.onclick = () => {
    wishPriority = b.dataset.priority;
    renderWishlist();
  });
  $$('[data-wish-view]', root).forEach((b) => b.onclick = () => {
    wishView = b.dataset.wishView;
    wishStatus = 'all';
    renderWishlist();
  });
  $$('[data-wish-status]', root).forEach((b) => b.onclick = () => {
    wishStatus = b.dataset.wishStatus;
    renderWishlist();
  });
  $('[data-basket-jump]', root)?.addEventListener('click', () => {
    const basket = $('#v28Basket', root);
    basket?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    basket?.focus({ preventScroll: true });
  });
  $('[data-checkout]', root)?.addEventListener('click', checkoutWishlist);
}


function openWishEditor(id = '') {
  if (testState().active) return;
  let saving = false;
  const editorActor = actor();
  const current = wishes().find((x) => x.id === id), m = ensureModal(), body = $('#v27ModalBody', m);
  body.innerHTML = `<span class="eyebrow">WISHLIST</span><h2>${current ? 'Edit wish' : 'Add a wish'}</h2><div class="v27-wish-fields"><label>What do you want?<input id="v27WishName" value="${esc(current?.name || '')}" placeholder="e.g. New headphones"></label><label>Price<div class="v27-wish-price-field"><span aria-hidden="true">€</span><input id="v27WishPrice" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${esc(String(current?.price ?? ''))}" placeholder="0,00"></div></label><label>Priority<select id="v27WishPriority">${[1, 2, 3, 4, 5].map((p) => `<option value="${p}" ${p === (current?.priority || 3) ? 'selected' : ''}>P${p}</option>`).join('')}</select></label><label class="wide">Note or link<textarea id="v27WishNote" placeholder="Why you want it, model, link…">${esc(current?.note || '')}</textarea></label></div><div class="v27-modal-actions">${current ? '<button data-wish-delete>Delete</button>' : '<span></span>'}<button class="btn primary" data-wish-save>Save wish</button></div>`;
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
  const priceInput = $('#v27WishPrice');
  priceInput?.addEventListener('input', () => {
    const original = priceInput.value;
    let cleaned = original.replace(/[^0-9.,]/g, '');
    const separator = cleaned.search(/[.,]/);
    if (separator >= 0) {
      const whole = cleaned.slice(0, separator) || '0';
      const decimals = cleaned.slice(separator + 1).replace(/[.,]/g, '').slice(0, 2);
      cleaned = whole + cleaned[separator] + decimals;
    }
    if (cleaned !== original) priceInput.value = cleaned;
  });
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
