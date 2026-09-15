// Shared Jar card in Balances -- a shared account both profiles see.
// Extracted from v33.js's renderSharedJar().
import { $ } from '../lib/dom.js';
import { n, money } from '../lib/format.js';
import { currentState } from './planner-state.js';

export function renderSharedJar() {
  const root = $('#financeCurrent'); if (!root) return;
  let card = $('.v33-shared-jar', root);
  if (!card) { card = document.createElement('article'); card.className = 'v33-shared-jar'; root.appendChild(card); }
  const jar = currentState()?.sharedJar || { balance: 870, initialBalance: 870, transactions: [] };
  const used = Math.max(0, n(jar.initialBalance || 870) - n(jar.balance ?? 870));
  card.innerHTML = `<div class="v33-jar-icon" aria-hidden="true">♡</div><div><span class="panel-kicker">SHARED BANK</span><h3>Shared Jar</h3><p>Used for the optional 20% accommodation contribution.</p></div><div class="v33-jar-money"><strong>${money(jar.balance ?? 870)}</strong><small>${used ? `${money(used)} used for accommodation` : 'Ready for your next accommodation'}</small></div>`;
}
