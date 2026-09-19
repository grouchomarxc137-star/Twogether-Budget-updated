// Shared Jar inside Current cash -- a shared account both profiles see.
// Its balance still comes from the shared server state and is updated by
// accommodation contributions in the existing trip-finance flow.
import { $ } from '../lib/dom.js';
import { n, money } from '../lib/format.js';
import { currentState, profile } from './planner-state.js';

export function renderSharedJar() {
  const root = $('#financeCurrent'); if (!root) return;

  // Clean up the old standalone card if it is still present in the DOM.
  $('.v33-shared-jar', root)?.remove();

  const cashCard = $('[data-fin-current-cash]', root) || $('.finance-current-card', root);
  if (!cashCard) return;

  const jar = currentState()?.sharedJar || { balance: 870, initialBalance: 870, transactions: [] };
  const jarBalance = n(jar.balance ?? 870);
  const used = Math.max(0, n(jar.initialBalance || 870) - jarBalance);
  const bankTotal = (profile()?.bankAccounts || []).reduce((sum, account) => sum + n(account?.balance), 0);

  let row = $('.v33-shared-jar-bank', cashCard);
  if (!row || row.tagName !== 'BUTTON') {
    const nextRow = document.createElement('button');
    nextRow.type = 'button';
    nextRow.className = 'finance-current-row v33-shared-jar-bank';
    nextRow.setAttribute('aria-label', 'Edit Shared Jar balance');
    const addBankButton = $('[data-fin-add-bank]', cashCard);
    if (row) row.replaceWith(nextRow);
    else if (addBankButton) cashCard.insertBefore(nextRow, addBankButton);
    else cashCard.appendChild(nextRow);
    row = nextRow;
  }

  row.innerHTML = `<span>Shared Jar<small>Shared · ${used ? `${money(used)} used for accommodation` : 'ready for accommodation'} · tap to edit</small></span><strong>${money(jarBalance)}</strong>`;
  row.onclick = () => document.dispatchEvent(new CustomEvent('twogether:edit-shared-jar', { detail: { balance: jarBalance } }));

  const empty = $('.finance-current-empty', cashCard);
  if (empty) empty.remove();

  const total = $('[data-fin-current-cash-total]', cashCard) || $('.finance-current-title > strong', cashCard);
  if (total) total.textContent = money(bankTotal + jarBalance);
}
