// Shop/Wishlist visual decorations that patch shop.js's/wishlist.js's
// rendered DOM: balance-card icons + love-note + bird art, the Lovis
// journey visualization, the rewards sidebar + Surprise Me, wishlist card
// icons/progress bars, and calmer shop copy. Extracted from v29.js, v31.js,
// and v32.js.
//
// These three were not simple duplicates despite looking like it at first
// (an earlier pass through this codebase assumed v31/v32 were near-
// duplicate patches on the same idea): v31.js creates the DOM structure
// (fin-icons, love-note, journey path, rewards layout+sidebar) the first
// time it's missing; v32.js runs on a persistent MutationObserver that
// re-stabilizes that structure every time shop.js's renderShop() re-
// renders (which happens often), AND overrides two specific things v31
// never touched (a nicer bird illustration, the "My investments" card
// title). v32 depends on v31 having run first. Consolidated here into one
// implementation that creates-if-missing then keeps values updated,
// matching v32's smarter update-in-place approach (v31's own recreate-
// every-time version would flicker/lose DOM references under v32's
// stabilizing observer). v29.js's calmShopCopy() was byte-identical to
// v32.js's -- kept once, not twice.
import { $, $$ } from '../lib/dom.js';

let repairingShop = false;
let shopObserver = null;
let financeObserver = null;
let balanceTimer = null;

function numberFrom(text) {
  const match = String(text || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}
function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }

function calmShopCopy(root) {
  const hero = $('.v27-shop-hero', root);
  if (hero) {
    setText($('h1', hero), 'Gentle rewards for the little things we do together.');
    setText($('p', hero), 'Earn Lovis by logging, comparing, confirming and reaching Wishlist goals together.');
    const wallet = $('.v27-wallet', hero);
    const twos = wallet && $$('span', wallet).find((el) => el.textContent.trim() === 'Twos');
    if (twos) { const amount = twos.nextElementSibling, note = amount?.nextElementSibling; twos.remove(); amount?.remove(); note?.remove(); }
  }
  const score = $('.v27-score', root);
  if (score) {
    setText($('h2', score), 'Our Lovis journey');
    $$('.v27-score-row', score).forEach((row) => { const detail = $('span', row); if (detail) setText(detail, detail.textContent.split('·')[0].trim()); });
    setText($('p', score), 'Every little action moves your Lovis journey forward.');
  }
  if (hero && !$('.v29-shop-ribbon', hero)) {
    const ribbon = document.createElement('div'); ribbon.className = 'v29-shop-ribbon'; ribbon.textContent = '♡ little rewards for the things you do together ✦';
    hero?.appendChild(ribbon);
  }
  root.classList.add('v29-shop');
  $$('.v27-shop-item', root).forEach((item, i) => item.style.setProperty('--v29-i', String(i)));
}

function journeyValues(score) {
  const values = { Principessa: 0, Principe: 0 };
  $$('.v27-score-row', score).forEach((row) => { const name = $('strong', row)?.textContent.trim(); if (name in values) values[name] = numberFrom($('span', row)?.textContent || $('b', row)?.textContent); });
  return values;
}
function repairJourney(root) {
  const score = $('.v27-score', root); if (!score) return;
  score.classList.add('v31-journey');
  const values = journeyValues(score);
  let path = $('.v31-journey-path', score);
  if (!path) {
    path = document.createElement('div'); path.className = 'v31-journey-path';
    path.innerHTML = `<div class="v31-journey-person"><div class="v31-journey-avatar">♕</div><strong>Principessa</strong><small>${values.Principessa.toLocaleString()} Lovis</small></div><div class="v31-journey-route" aria-label="Shared Lovis milestones"><div class="v31-milestone"><i>✓</i><span>First moments</span></div><div class="v31-milestone"><i>♡</i><span>Little rewards</span></div><div class="v31-milestone"><i>✦</i><span>More adventures</span></div></div><div class="v31-journey-person"><div class="v31-journey-avatar">♔</div><strong>Principe</strong><small>${values.Principe.toLocaleString()} Lovis</small></div>`;
    $('.v27-section-title', score)?.insertAdjacentElement('afterend', path);
  } else {
    const people = $$('.v31-journey-person', path);
    setText($('small', people[0]), `${values.Principessa.toLocaleString()} Lovis`);
    setText($('small', people[1]), `${values.Principe.toLocaleString()} Lovis`);
  }
}

function rewardInfo(item) {
  return { item, cost: numberFrom(item.querySelector('div:nth-child(2)>span')?.textContent), title: item.querySelector('h3')?.textContent.trim() || 'Reward', owned: item.classList.contains('owned') };
}
function currentLovis(root) { return numberFrom($('.v27-wallet strong', root)?.textContent); }
function updateRewardSide(layout, root) {
  const side = $('.v31-reward-side', layout); if (!side) return;
  const lovis = currentLovis(root), infos = $$('.v27-shop-item', layout).map(rewardInfo).sort((a, b) => a.cost - b.cost), max = Math.max(120, ...infos.map((x) => x.cost));
  const unowned = infos.filter((x) => !x.owned), next = unowned.find((x) => x.cost > lovis) || unowned[0] || null, affordable = unowned.filter((x) => x.cost <= lovis), pct = Math.max(0, Math.min(100, Math.round(lovis / max * 100)));
  $('.v31-lovis-ring', side)?.style.setProperty('--p', String(pct));
  setText($('.v31-lovis-ring strong', side), lovis.toLocaleString());
  setText($('.v31-lovis-ring small', side), `/ ${max} Lovis`);
  const msg = $('.v31-next-reward', side);
  if (msg) { if (affordable.length) setText(msg, `You can unlock ${affordable[0].title} now.`); else if (next) setText(msg, `${Math.max(0, next.cost - lovis).toLocaleString()} Lovis until ${next.title}.`); else setText(msg, 'Your reward shelf is completely unlocked. ♡'); }
}
function repairRewards(root) {
  const grid = $('.v27-shop-grid', root); if (!grid) return;
  let layout = $('.v31-rewards-layout', root);
  if (!layout) {
    const title = $$('.v27-section-title', root).find((x) => $('h2', x)?.textContent.trim() === 'Rewards'); if (!title) return;
    layout = document.createElement('section'); layout.className = 'v31-rewards-layout';
    const main = document.createElement('div'); main.className = 'v31-reward-main';
    title.parentNode.insertBefore(layout, title); layout.appendChild(main); main.appendChild(title); main.appendChild(grid);
    const side = document.createElement('aside'); side.className = 'v31-reward-side';
    side.innerHTML = '<section class="v31-lovis-side"><div class="v31-lovis-title"><i>♡</i><span>Your Lovis</span></div><div class="v31-lovis-ring"><div><div><strong>0</strong><small>/ 120 Lovis</small></div></div></div><div class="v31-next-reward"></div></section><section class="v31-surprise-side"><h3>Little surprise corner</h3><p>Not sure what to choose? Let fate (and love) pick a reward to look at.</p><button type="button" data-v31-surprise>✦ Surprise me</button></section>';
    layout.appendChild(side);
  }
  updateRewardSide(layout, root);
}

const FIN_ICONS = [
  `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="3"></rect><path d="M5 6.4 16.5 3.8c1.2-.3 2.2.6 2.2 1.7V6"></path><path d="M15 10h6v5h-6a2.5 2.5 0 0 1 0-5Z"></path><circle cx="16" cy="12.5" r=".7"></circle></svg>`,
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20v-8"></path><path d="M12 14c-4.7 0-7.2-2.8-7.2-7.7 4.9 0 7.2 2.6 7.2 7.7Z"></path><path d="M12 11.5c0-4.5 2.4-7 7.2-7.5 0 4.8-2.5 7.5-7.2 7.5Z"></path><path d="M7 20h10"></path></svg>`,
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h14"></path><polyline points="14 4 18 8 14 12"></polyline><path d="M20 16H6"></path><polyline points="10 12 6 16 10 20"></polyline></svg>`,
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h17"></path><rect x="5" y="13" width="3" height="7" rx="1"></rect><rect x="11" y="9" width="3" height="11" rx="1"></rect><rect x="17" y="4" width="3" height="16" rx="1"></rect></svg>`,
];

function repairBalances() {
  const root = $('#financeCurrent'); if (!root) return;
  $('.v31-finance-love-note', root)?.remove();
  const grid = $('.finance-current-grid', root);
  if (grid) {
    $$('.finance-current-card', grid).forEach((card, i) => {
      if (!$('.v31-fin-icon', card)) { const icon = document.createElement('div'); icon.className = 'v31-fin-icon'; icon.innerHTML = FIN_ICONS[i] || FIN_ICONS[0]; card.appendChild(icon); }
    });
  }
  const investment = $$('.finance-current-card', root).find((card) => $('.finance-current-title span', card)?.textContent.trim().toUpperCase() === 'INVESTMENTS');
  if (investment) setText($('.finance-current-title h3', investment), 'My investments');
}

export function surprise() {
  const root = $('#shopView'), layout = $('.v31-rewards-layout', root || document); if (!root || !layout) return;
  const lovis = currentLovis(root), all = $$('.v27-shop-item', layout).map(rewardInfo).filter((x) => !x.owned);
  const affordable = all.filter((x) => x.cost <= lovis), pool = affordable.length ? affordable : all; if (!pool.length) return;
  $$('.v27-shop-item.v31-surprise-pick', layout).forEach((x) => x.classList.remove('v31-surprise-pick'));
  const pick = pool[Math.floor(Math.random() * pool.length)]; pick.item.classList.add('v31-surprise-pick');
  pick.item.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const btn = $('[data-v31-surprise]', layout); if (btn) { const old = btn.textContent; btn.textContent = `♡ ${pick.title}`; clearTimeout(btn._v31t); btn._v31t = setTimeout(() => btn.textContent = old, 1800); }
}

function repairShop() {
  if (repairingShop) return;
  const root = $('#shopView'); if (!root) return;
  repairingShop = true;
  try { root.classList.add('v32-shop-stable'); calmShopCopy(root); repairJourney(root); repairRewards(root); } finally { repairingShop = false; }
}

function numberFromText(text) { const cleaned = String(text || '').replace(/,/g, '').replace(/[^0-9.\-]/g, ''); const n = Number(cleaned); return Number.isFinite(n) ? n : 0; }
function wishIcon(name) {
  const s = String(name || '').toLowerCase();
  if (/laptop|macbook|computer|pc/.test(s)) return '⌘';
  if (/headphone|earphone|airpod|music|speaker/.test(s)) return '♫';
  if (/camera|photo|lens/.test(s)) return '◉';
  if (/trip|travel|flight|holiday|vacation/.test(s)) return '✈';
  if (/perfume|fragrance/.test(s)) return '✦';
  if (/book|kindle|read/.test(s)) return '▤';
  if (/car|auto/.test(s)) return '◇';
  if (/phone|iphone/.test(s)) return '▯';
  return '♡';
}
function decorateWishlist() {
  const root = $('#financeWishlist'); if (!root) return;
  const hero = $('.v27-wish-hero', root);
  if (hero) {
    const copy = hero.firstElementChild;
    if (copy && !$('.v29-wish-values', copy)) {
      const row = document.createElement('div'); row.className = 'v29-wish-values';
      row.innerHTML = '<span><i>♡</i>Save for what you love</span><span><i>↗</i>Tiny wins count</span><span><i>✦</i>Earned feels better</span>';
      copy.appendChild(row);
    }
  }
  const twos = numberFromText($('.v27-twos-wallet strong', root)?.textContent);
  $$('.v27-wish-card', root).forEach((card) => {
    if (!$('.v29-wish-icon', card)) {
      const icon = document.createElement('div'); icon.className = 'v29-wish-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = wishIcon($('h3', card)?.textContent);
      const title = $('.v28-wish-title', card); title?.parentNode?.insertBefore(icon, title);
    }
    if (!$('.v29-wish-progress', card)) {
      const price = numberFromText($('.v27-wish-price', card)?.textContent), earned = card.classList.contains('earned');
      if (price > 0) {
        const pct = earned ? 100 : Math.max(0, Math.min(100, Math.round((Math.max(0, twos) / price) * 100)));
        const p = document.createElement('div'); p.className = 'v29-wish-progress';
        p.innerHTML = `<div><span>${earned ? 'Goal unlocked' : `${Math.min(Math.max(0, twos), price).toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${price.toLocaleString(undefined, { maximumFractionDigits: 0 })} Twos`}</span><b>${pct}%</b></div><i><em style="width:${pct}%"></em></i>`;
        const ready = $('.v28-wish-readiness', card); if (ready) card.insertBefore(p, ready); else card.appendChild(p);
      }
    }
  });
}

function observeShop() {
  const root = $('#shopView'); if (!root || shopObserver) return;
  shopObserver = new MutationObserver((muts) => { if (muts.some((m) => m.target === root)) repairShop(); });
  shopObserver.observe(root, { childList: true });
  repairShop();
}

function observeBalances() {
  const root = $('#financeCurrent'); if (!root || financeObserver) return;
  financeObserver = new MutationObserver(() => { repairBalances(); clearTimeout(balanceTimer); balanceTimer = setTimeout(repairBalances, 70); });
  financeObserver.observe(root, { childList: true });
  repairBalances();
}

export function initShopDecorations() {
  repairShop(); repairBalances(); decorateWishlist();
  observeShop(); observeBalances();
  const wishRoot = $('#financeWishlist');
  if (wishRoot) new MutationObserver(() => requestAnimationFrame(decorateWishlist)).observe(wishRoot, { childList: true, subtree: true });

  document.addEventListener('twogether:finance-view', (e) => { if (e.detail?.view === 'balances') { repairBalances(); } });
  document.addEventListener('twogether:shop-refreshed', () => { repairShop(); repairBalances(); decorateWishlist(); });
  document.addEventListener('twogether:shop-award', () => { repairShop(); decorateWishlist(); });
  document.addEventListener('twogether:v18-rendered', () => requestAnimationFrame(() => { observeShop(); observeBalances(); }));
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-v31-surprise]')) { e.preventDefault(); surprise(); return; }
    if (e.target.closest?.('#shopHub,[data-hub="finances"],[data-fin-subview="balances"],[data-buy]')) { setTimeout(repairShop, 80); setTimeout(repairShop, 420); }
  }, true);
  setTimeout(() => { observeShop(); observeBalances(); decorateWishlist(); }, 180);
}

initShopDecorations();
