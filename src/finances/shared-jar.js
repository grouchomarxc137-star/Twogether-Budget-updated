// Shared Jar inside Current cash -- a shared account both profiles see.
// Its balance still comes from the shared server state and is updated by
// accommodation contributions in the existing trip-finance flow.
import { $ } from '../lib/dom.js';
import { esc, n, money } from '../lib/format.js';
import { currentState, profile } from './planner-state.js';

function jarDateLabel(value) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function financeCategoryLabel(value) {
  return {
    fixed:'Fixed expenses',
    medical:'Medical',
    subscriptions:'Subscriptions',
    rent:'Rent',
    groceries:'Groceries',
    variable:'Variable expenses',
    extra:'Extra',
    savings:'Saved up',
    investments:'Investments',
    other:'Other',
  }[String(value||'')] || 'Other';
}

function jarHistory(state) {
  const plans = Array.isArray(state?.plans) ? state.plans : [];
  const transactions = Array.isArray(state?.sharedJar?.transactions) ? state.sharedJar.transactions : [];
  return transactions.map((transaction, index) => {
    if(transaction?.source==='finance'){
      return {
        id:transaction?.expenseId||String(index),
        trip:String(transaction?.name||'Finance expense').trim()||'Finance expense',
        category:'Finances · '+financeCategoryLabel(transaction?.category),
        amount:n(transaction?.amount),
        actor:String(transaction?.actor||''),
        at:String(transaction?.at||''),
        date:jarDateLabel(transaction?.date||transaction?.at),
      };
    }

    const plan = plans.find((item) => item?.id === transaction?.planId);
    const expense = transaction?.expenseId
      ? (Array.isArray(plan?.expenseEntries) ? plan.expenseEntries : []).find((item) => item?.id === transaction.expenseId)
      : null;
    const meta = plan?.meta || {};
    const trip = String(meta.city || meta.otherLocation || meta.location || 'Trip').trim();
    const category = expense?.category === 'accommodation' || !expense ? 'Stay' : 'Trip expense';
    return {
      id: transaction?.expenseId || transaction?.planId || String(index),
      trip,
      category,
      amount: n(transaction?.amount),
      actor: String(transaction?.actor || ''),
      at: String(transaction?.at || ''),
      date: jarDateLabel(transaction?.at),
    };
  }).filter((item) => item.amount > 0)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function renderSharedJar() {
  const root = $('#financeCurrent'); if (!root) return;

  // Clean up the old standalone card if it is still present in the DOM.
  $('.v33-shared-jar', root)?.remove();

  const cashCard = $('[data-fin-current-cash]', root) || $('.finance-current-card', root);
  if (!cashCard) return;

  const state = currentState();
  const jar = state?.sharedJar || { balance: 870, initialBalance: 870, transactions: [] };
  const jarBalance = n(jar.balance ?? 870);
  const history = jarHistory(state);
  const latest = history[0] || null;
  const bankTotal = (profile()?.bankAccounts || []).reduce((sum, account) => sum + n(account?.balance), 0);

  let row = $('.v33-shared-jar-bank', cashCard);
  if (!row || row.tagName !== 'BUTTON') {
    const nextRow = document.createElement('button');
    nextRow.type = 'button';
    nextRow.className = 'finance-current-row v33-shared-jar-bank';
    nextRow.setAttribute('aria-label', 'View Shared Jar transaction history');
    const addBankButton = $('[data-fin-add-bank]', cashCard);
    if (row) row.replaceWith(nextRow);
    else if (addBankButton) cashCard.insertBefore(nextRow, addBankButton);
    else cashCard.appendChild(nextRow);
    row = nextRow;
  }

  const latestText = latest
    ? `Latest · ${esc(latest.trip)} · ${esc(latest.category)} · −${money(latest.amount)}${latest.date ? ` · ${esc(latest.date)}` : ''}`
    : 'No transactions yet';
  row.innerHTML = `<span>Shared Jar<small>${latestText}</small></span><strong>${money(jarBalance)}</strong>`;
  row.onclick = () => document.dispatchEvent(new CustomEvent('twogether:open-shared-jar', {
    detail: {
      balance: jarBalance,
      initialBalance: n(jar.initialBalance ?? jarBalance),
      transactions: history,
    },
  }));

  const empty = $('.finance-current-empty', cashCard);
  if (empty) empty.remove();

  const total = $('[data-fin-current-cash-total]', cashCard) || $('.finance-current-title > strong', cashCard);
  if (total) total.textContent = money(bankTotal + jarBalance);
}
