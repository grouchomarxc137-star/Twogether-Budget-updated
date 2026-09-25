// Personal monthly finances tracker: month-by-month income/expense wizard,
// bank balances & loans, purchase-scenario testing, investment tracking.
// Its own independent JSONP state fetch (kept separate from
// window.TwogetherAPI/lib/api.js -- this module only ever needs a plain
// state read, not the caching/queueing the shared client provides).
// Extracted from finances.js.
import { $, $$ } from '../lib/dom.js';
import { esc, n, money, uid } from '../lib/format.js';
import { actor } from '../lib/session.js';
import { toast } from '../lib/toast.js';
import { tripDetailMoneyHtml, tripDetailShellHtml, tripTimelineHtml, tripExpenseRowHtml, tripSheetHtml } from '../lib/trips-ui.js';

const MONTHS = [
  ['2026-01', 'Jan 2026'], ['2026-02', 'Feb 2026'], ['2026-03', 'Mar 2026'], ['2026-04', 'Apr 2026'],
  ['2026-05', 'May 2026'], ['2026-06', 'Jun 2026'], ['2026-07', 'Jul 2026'], ['2026-08', 'Aug 2026'],
  ['2026-09', 'Sep 2026'], ['2026-10', 'Oct 2026'], ['2026-11', 'Nov 2026'], ['2026-12', 'Dec 2026'],
];
const GROUPS = [
  { key: 'fixed', label: 'Fixed expenses', example: 'e.g. Rent', tone: 'fixed', named: true },
  { key: 'medical', label: 'Medical', example: 'e.g. Zorgverzekering', tone: 'medical', named: true },
  { key: 'subscriptions', label: 'Subscriptions', example: 'e.g. Spotify', tone: 'subscriptions', named: true },
  { key: 'rent', label: 'Rent', defaultName: 'Rent', tone: 'subscriptions' },
  { key: 'groceries', label: 'Groceries', defaultName: 'Groceries', tone: 'budgets' },
  { key: 'variable', label: 'Variable expenses', example: 'e.g. Fuel', tone: 'budgets', named: true },
  { key: 'extra', label: 'Extra', defaultName: 'Extra', tone: 'budgets', optionalName: true, manual: false },
  { key: 'savings', label: 'Save up', defaultName: 'Save up', tone: 'wealth' },
  { key: 'investments', label: 'Investments', defaultName: 'Investments', tone: 'wealth' },
  { key: 'other', label: 'Other', example: 'e.g. Gift', tone: 'other', named: true },
];
const FINANCE_RULES = {
  Principessa: {
    extraBudget: 250,
    extraTracking: true,
    savedUpExtraTracking: false,
    investmentTracking: true,
    recurringIncomes: [
      { name: 'Neways', amount: 2051 },
      { name: 'Belastingdienst', amount: 129 },
    ],
    recurringExpenses: [
      { group: 'medical', name: 'Zorgverzekering', amount: 158 },
      { group: 'medical', name: 'Liability Insurance', amount: 4 },
      { group: 'rent', name: 'Rent', amount: 50 },
      { group: 'subscriptions', name: 'Chatgpt Plus', amount: 23 },
      { group: 'subscriptions', name: 'Sportcity', amount: 28 },
      { group: 'subscriptions', name: 'Spotify', amount: 8.5 },
      { group: 'subscriptions', name: 'iCloud', amount: 3 },
      { group: 'subscriptions', name: 'NS', amount: 100 },
      { group: 'subscriptions', name: 'Oranje Pakketje', amount: 4 },
      { group: 'subscriptions', name: 'Odido', amount: 30 },
      { group: 'groceries', name: 'Groceries', amount: 255 },
      { group: 'extra', name: 'Extra', amount: 250 },
      { group: 'investments', name: 'Investments', amount: 550 },
      { group: 'savings', name: 'Save up', amount: 500 },
    ],
  },
  Principe: {
    extraBudget: null,
    extraTracking: false,
    savedUpExtraTracking: true,
    investmentTracking: false,
    recurringIncomes: [
      { name: 'Salary', amount: 1550 },
    ],
    recurringExpenses: [
      { group: 'fixed', name: 'Rent', amount: 575 },
      { group: 'fixed', name: 'Ryanair part 3', amount: 47.58 },
      { group: 'subscriptions', name: 'Iliad', amount: 9.99 },
      { group: 'subscriptions', name: 'Spotify', amount: 16.99 },
      { group: 'subscriptions', name: 'ChatGPT Plus', amount: 23 },
      { group: 'subscriptions', name: 'Railway Hosting', amount: 5 },
      { group: 'subscriptions', name: 'Claude', amount: 21.96 },
      { group: 'subscriptions', name: 'Amazon Prime', amount: 1.99 },
      { group: 'variable', name: 'Fuel', amount: 300 },
      { group: 'variable', name: 'Groceries', amount: 17.33 },
      { group: 'variable', name: 'Personal', amount: 100 },
      { group: 'variable', name: 'Airbnb', amount: 142 },
      { group: 'savings', name: 'Save up', amount: 200 },
    ],
  },
};
const CATEGORY_ORDER = ['fixed', 'medical', 'subscriptions', 'budgets', 'wealth', 'other'];
const CATEGORY_LABELS = { fixed: 'Fixed expenses', medical: 'Medical', subscriptions: 'Subscriptions', budgets: 'Budgets', wealth: 'Savings / Investments', other: 'Other' };
const HOUSE_GOAL_TARGET = 150000;
const HOUSE_EMERGENCY_RESERVE = 5000;

let financeState = {
  version: 0,
  finances: { Principessa: [], Principe: [] },
  financeProfiles: { Principessa: freshProfile(), Principe: freshProfile() },
  plans: [],
};
let flow = null;
let selectedMonth = '2026-09';
let financeViewYear = Number(selectedMonth.slice(0,4));
let loading = false;
let recurringSwipeAbort = null;
let recurringSwipeIgnoreUntil = 0;
let recurringDeleteConfirmLayer = null;
let financeMonthDialog = null;
let financeMonthSwipeAbort = null;
let financeMonthSwipeIgnoreUntil = 0;
let financeMonthDeleteConfirmLayer = null;
let financeLogBackgroundLock = null;
let financeMonthPageLock = null;
let financeReminderSyncing = false;

const signedMoney = (v) => `${n(v) >= 0 ? '+' : '−'}${money(Math.abs(n(v)))}`;
const FINANCE_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const financeMonthsForYear = (year) => FINANCE_MONTH_NAMES.map((label,index)=>[`${year}-${String(index+1).padStart(2,'0')}`,label]);
const monthLabel = (m) => {
  const match=/^(\d{4})-(\d{2})$/.exec(String(m||''));
  if (!match) return String(m||'');
  const index=Number(match[2])-1;
  return `${FINANCE_MONTH_NAMES[index]?.slice(0,3)||match[2]} ${match[1]}`;
};
function financeYearBounds() {
  const years=ownMonths().map((item)=>Number(String(item.month||'').slice(0,4))).filter(Number.isFinite);
  const currentYear=new Date().getFullYear();
  return {
    min:Math.min(2026,currentYear,...years),
    max:Math.max(currentYear,...years),
  };
}

function normalizeRecurringDay(value) {
  if (value === '' || value == null) return '';
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : '';
}
function ordinalDay(value) {
  const day = normalizeRecurringDay(value);
  if (day === '') return '';
  const mod100 = day % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th');
  return `${day}${suffix}`;
}
function daysInFinanceMonth(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!match) return 31;
  return new Date(Number(match[1]), Number(match[2]), 0).getDate();
}
function financeDateForDay(month, value) {
  const day = normalizeRecurringDay(value);
  if (day === '' || !/^\d{4}-\d{2}$/.test(String(month || ''))) return '';
  const actualDay = Math.min(day, daysInFinanceMonth(month));
  return `${month}-${String(actualDay).padStart(2, '0')}`;
}
function normalizeFinanceDate(value, month = '') {
  const text = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return '';
  const year = Number(match[1]), monthNumber = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthNumber - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthNumber - 1 || date.getUTCDate() !== day) return '';
  if (month && !text.startsWith(`${month}-`)) return '';
  return text;
}
function financeDateLabel(value) {
  const safe = normalizeFinanceDate(value);
  if (!safe) return '';
  const [year, month, day] = safe.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(Date.UTC(year, month - 1, day)));
}
function financeDateMeta(value) {
  const label = financeDateLabel(value);
  return label ? `<small class="finance-item-date">${esc(label)}</small>` : '';
}
function financeDateBounds(month) {
  const lastDay = String(daysInFinanceMonth(month)).padStart(2, '0');
  return { min: `${month}-01`, max: `${month}-${lastDay}` };
}

function normalizeGroup(value) {
  const g = String(value || 'other');
  if (g === 'health') return 'medical';
  if (g === 'living') return 'rent';
  if (g === 'transport') return 'subscriptions';
  return GROUPS.some((x) => x.key === g) ? g : 'other';
}
function groupMeta(value) {
  const key = normalizeGroup(value);
  return GROUPS.find((x) => x.key === key) || GROUPS[GROUPS.length - 1];
}
function groupLabel(value) { return groupMeta(value).label; }
function groupTone(value) { return groupMeta(value).tone; }
function financeRules(owner = actor()) { return FINANCE_RULES[owner] || FINANCE_RULES.Principessa; }
function categoryLabel(tone) {
  if (actor() === 'Principe' && tone === 'budgets') return 'Variable expenses';
  if (actor() === 'Principe' && tone === 'wealth') return 'Savings';
  return CATEGORY_LABELS[tone] || tone;
}
function categoryOrder() {
  return actor() === 'Principe'
    ? ['fixed', 'subscriptions', 'budgets', 'wealth', 'medical', 'other']
    : CATEGORY_ORDER;
}
function manualGroups() {
  if (actor() !== 'Principe') return GROUPS.filter((g) => g.manual !== false && !['fixed', 'variable'].includes(g.key));
  const allowed = new Set(['fixed', 'subscriptions', 'variable', 'savings', 'other']);
  return GROUPS.filter((g) => g.manual !== false && allowed.has(g.key));
}
function nextAfterExpensesStage() {
  const rules = financeRules();
  if (rules.extraTracking) return 'extraSpentAsk';
  if (rules.savedUpExtraTracking) return 'savedUpSpentAsk';
  if (rules.investmentTracking) return 'investmentTotal';
  return 'review';
}
function nextAfterExtraStage() { return financeRules().investmentTracking ? 'investmentTotal' : 'review'; }

function normalizeRecurringConfig(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    custom: v.custom === true,
    incomes: Array.isArray(v.incomes) ? v.incomes.map((x) => ({ id: x.id || uid(), name: String(x.name || ''), amount: x.amount ?? '', day: normalizeRecurringDay(x.day) })).filter((x) => x.name) : [],
    expenses: Array.isArray(v.expenses) ? v.expenses.map((x) => ({ id: x.id || uid(), group: normalizeGroup(x.group), name: String(x.name || ''), amount: x.amount ?? '', day: normalizeRecurringDay(x.day) })).filter((x) => x.name) : [],
  };
}
function freshProfile() {
  return { bankAccounts: [], savingsTotal: '', savingsReserved: [], receivables: [], scenarios: [], wishlist: [], compareLab: {}, recurring: normalizeRecurringConfig({}), financeReminders: [], updatedAt: '', updatedBy: '' };
}
function normalizeProfile(profileData) {
  const p = profileData && typeof profileData === 'object' ? profileData : {};
  return {
    bankAccounts: Array.isArray(p.bankAccounts) ? p.bankAccounts.map((x) => ({ id: x.id || uid(), name: String(x.name || ''), balance: x.balance ?? '' })) : [],
    savingsTotal: p.savingsTotal ?? '',
    savingsReserved: Array.isArray(p.savingsReserved) ? p.savingsReserved.map((x) => ({ id: x.id || uid(), name: String(x.name || ''), amount: x.amount ?? '' })) : [],
    receivables: Array.isArray(p.receivables) ? p.receivables.map((x) => ({
      id: x.id || uid(), person: String(x.person || ''), reason: String(x.reason || ''),
      principal: x.principal ?? x.amount ?? '',
      repayments: Array.isArray(x.repayments) ? x.repayments.map((r) => ({ id: r.id || uid(), month: String(r.month || ''), date: normalizeFinanceDate(r.date) || String(r.at || '').slice(0, 10), amount: r.amount ?? '', at: String(r.at || '') })) : [],
    })) : [],
    scenarios: Array.isArray(p.scenarios) ? p.scenarios.map((x) => ({ id: x.id || uid(), name: String(x.name || ''), upfront: x.upfront ?? '', monthly: x.monthly ?? '' })) : [],
    wishlist: Array.isArray(p.wishlist) ? JSON.parse(JSON.stringify(p.wishlist)) : [],
    compareLab: p.compareLab && typeof p.compareLab === 'object' ? JSON.parse(JSON.stringify(p.compareLab)) : {},
    recurring: normalizeRecurringConfig(p.recurring),
    financeReminders: Array.isArray(p.financeReminders) ? p.financeReminders.map((item) => ({
      id: String(item?.id || ''),
      kind: item?.kind === 'income' ? 'income' : item?.kind === 'investment-snapshot' ? 'investment-snapshot' : 'expense',
      name: String(item?.name || ''),
      group: String(item?.group || ''),
      amount: item?.amount ?? '',
      month: String(item?.month || ''),
      date: normalizeFinanceDate(item?.date),
      createdAt: String(item?.createdAt || ''),
    })).filter((item) => item.id && item.name && item.month && item.date) : [],
    updatedAt: p.updatedAt || '', updatedBy: p.updatedBy || '',
  };
}
function profile() {
  const a = actor();
  return a ? normalizeProfile(financeState.financeProfiles?.[a]) : freshProfile();
}

function tripSettlement(plan) {
  const paid = { Principessa: 0, Principe: 0 };
  const share = { Principessa: 0, Principe: 0 };
  const entries = Array.isArray(plan?.expenseEntries) ? plan.expenseEntries : [];
  const repayments = Array.isArray(plan?.repayments) ? plan.repayments : [];
  entries.forEach((entry) => {
    const remaining = Math.max(0, n(entry?.amount) - n(entry?.jarContribution));
    if (entry?.paidBy === 'both') {
      paid.Principessa += remaining / 2;
      paid.Principe += remaining / 2;
    } else if (paid[entry?.paidBy] != null) {
      paid[entry.paidBy] += remaining;
    }
    if (entry?.split === 'personal') share[entry?.forActor === 'Principe' ? 'Principe' : 'Principessa'] += remaining;
    else {
      share.Principessa += remaining / 2;
      share.Principe += remaining / 2;
    }
  });
  repayments.forEach((repayment) => {
    const value = n(repayment?.amount);
    if (repayment?.from === 'Principessa' && repayment?.to === 'Principe') {
      paid.Principessa += value;
      paid.Principe -= value;
    } else if (repayment?.from === 'Principe' && repayment?.to === 'Principessa') {
      paid.Principe += value;
      paid.Principessa -= value;
    }
  });
  const delta = paid.Principessa - share.Principessa;
  if (Math.abs(delta) < .005) return { debtor: '', creditor: '', amount: 0 };
  return {
    debtor: delta > 0 ? 'Principe' : 'Principessa',
    creditor: delta > 0 ? 'Principessa' : 'Principe',
    amount: Math.abs(delta),
  };
}
const TRIP_DEBT_CATEGORIES = [
  ['stay', 'Stay'],
  ['transport', 'Transport'],
  ['car', 'Car'],
  ['groceries', 'Groceries'],
  ['eating-out', 'Eating out'],
  ['activities', 'Activities'],
  ['other', 'Other'],
];
function tripDebtCategoryKey(entry) {
  if (entry?.category === 'accommodation') return 'stay';
  if (entry?.category === 'transport') return entry?.transportType === 'fuel' ? 'car' : 'transport';
  if (entry?.category === 'food') return entry?.foodType === 'groceries' ? 'groceries' : 'eating-out';
  if (entry?.category === 'activities') return 'activities';
  return 'other';
}
function tripDebtCategoryBreakdown(plan, debtor) {
  const keys = TRIP_DEBT_CATEGORIES.map(([key]) => key);
  const balances = Object.fromEntries(keys.map((key) => [key, 0]));
  const opened = Object.fromEntries(keys.map((key) => [key, '']));
  let pendingPositive = 0, pendingNegative = 0;
  const sign = (value) => value > .005 ? 1 : value < -.005 ? -1 : 0;
  const applyDelta = (key, delta, stamp) => {
    const before = balances[key] || 0, beforeSign = sign(before);
    balances[key] = before + delta;
    const afterSign = sign(balances[key]);
    if (!afterSign) {
      balances[key] = 0;
      opened[key] = '';
    } else if (afterSign !== beforeSign) {
      opened[key] = stamp;
    }
  };
  const consumePending = (key, stamp) => {
    if (balances[key] < -.005 && pendingPositive > .005) {
      const used = Math.min(pendingPositive, -balances[key]);
      applyDelta(key, used, stamp);
      pendingPositive -= used;
    }
    if (balances[key] > .005 && pendingNegative > .005) {
      const used = Math.min(pendingNegative, balances[key]);
      applyDelta(key, -used, stamp);
      pendingNegative -= used;
    }
  };
  const consumeLegacy = (effect, stamp) => {
    const wantsNegative = effect > 0;
    let remaining = Math.abs(effect);
    const eligible = keys.filter((key) => wantsNegative ? balances[key] < -.005 : balances[key] > .005)
      .sort((a, b) => String(opened[a] || '').localeCompare(String(opened[b] || '')) || keys.indexOf(a) - keys.indexOf(b));
    for (const key of eligible) {
      if (remaining <= .005) break;
      const due = wantsNegative ? -balances[key] : balances[key];
      const used = Math.min(remaining, due);
      applyDelta(key, wantsNegative ? used : -used, stamp);
      remaining -= used;
    }
    if (remaining > .005) {
      if (wantsNegative) pendingPositive += remaining;
      else pendingNegative += remaining;
    }
  };
  const eventStamp = (item, index, kind) => {
    const created = String(item?.createdAt || '');
    const day = String(item?.date || created.slice(0, 10) || '9999-12-31');
    const time = created.includes('T') ? created.slice(11) : (kind === 'expense' ? '00:00:00' : '23:59:59');
    return day + 'T' + time + '|' + String(index).padStart(5, '0') + '|' + kind;
  };
  const entries = Array.isArray(plan?.expenseEntries) ? plan.expenseEntries : [];
  const repayments = Array.isArray(plan?.repayments) ? plan.repayments : [];
  const events = entries.map((entry, index) => ({ kind: 'expense', entry, stamp: eventStamp(entry, index, 'expense') }))
    .concat(repayments.map((repayment, index) => ({ kind: 'repayment', repayment, stamp: eventStamp(repayment, index, 'repayment') })))
    .sort((a, b) => a.stamp.localeCompare(b.stamp));

  events.forEach((event) => {
    if (event.kind === 'expense') {
      const entry = event.entry, key = tripDebtCategoryKey(entry);
      const remaining = Math.max(0, n(entry?.amount) - n(entry?.jarContribution));
      const paidPrincipessa = entry?.paidBy === 'both' ? remaining / 2 : entry?.paidBy === 'Principessa' ? remaining : 0;
      const owner = entry?.forActor === 'Principe' ? 'Principe' : 'Principessa';
      const sharePrincipessa = entry?.split === 'personal' ? (owner === 'Principessa' ? remaining : 0) : remaining / 2;
      applyDelta(key, paidPrincipessa - sharePrincipessa, event.stamp);
      consumePending(key, event.stamp);
      return;
    }
    const repayment = event.repayment, value = n(repayment?.amount);
    const effect = repayment?.from === 'Principessa' && repayment?.to === 'Principe'
      ? value
      : repayment?.from === 'Principe' && repayment?.to === 'Principessa'
        ? -value : 0;
    if (!effect) return;
    if (repayment?.category && keys.includes(repayment.category)) applyDelta(repayment.category, effect, event.stamp);
    else consumeLegacy(effect, event.stamp);
  });

  if (pendingPositive > .005) applyDelta('other', pendingPositive, '9999-12-31T23:59:59|legacy');
  if (pendingNegative > .005) applyDelta('other', -pendingNegative, '9999-12-31T23:59:59|legacy');

  const overall = tripSettlement(plan);
  const targetCents = overall.debtor === debtor ? Math.max(0, Math.round(n(overall.amount) * 100)) : 0;
  if (!targetCents) return [];
  const wantsNegative = debtor === 'Principessa';
  const debts = keys.map((key) => ({
    key,
    cents: Math.max(0, Math.round((wantsNegative ? -balances[key] : balances[key]) * 100)),
    opened: opened[key] || '9999-12-31T23:59:59',
  })).filter((item) => item.cents > 0);

  let excess = Math.max(0, debts.reduce((sum, item) => sum + item.cents, 0) - targetCents);
  debts.sort((a, b) => a.opened.localeCompare(b.opened) || keys.indexOf(a.key) - keys.indexOf(b.key));
  debts.forEach((item) => {
    const reduce = Math.min(excess, item.cents);
    item.cents -= reduce;
    excess -= reduce;
  });
  const assigned = debts.reduce((sum, item) => sum + item.cents, 0);
  if (assigned < targetCents) {
    const other = debts.find((item) => item.key === 'other');
    if (other) other.cents += targetCents - assigned;
    else debts.push({ key: 'other', cents: targetCents - assigned, opened: '9999-12-31T23:59:59' });
  }
  const labels = Object.fromEntries(TRIP_DEBT_CATEGORIES);
  return debts.filter((item) => item.cents > 0).map((item) => labels[item.key] || 'Other');
}
function tripReceivables(owner = actor()) {
  return (Array.isArray(financeState.plans) ? financeState.plans : []).map((plan) => {
    const settlement = tripSettlement(plan);
    if (!owner || settlement.creditor !== owner || settlement.amount <= .005) return null;
    const meta = plan?.meta || {};
    const place = String(meta.city || meta.otherLocation || meta.location || 'Trip').trim();
    const categories = tripDebtCategoryBreakdown(plan, settlement.debtor);
    return {
      id: plan?.id || '',
      person: settlement.debtor,
      reason: 'Trip · ' + place,
      categories: categories.join(' + ') || 'Other',
      amount: settlement.amount,
    };
  }).filter(Boolean);
}

function recurringDefaults() {
  const rules = financeRules();
  const latest = [...ownMonths()].sort((a, b) => String(b.month).localeCompare(String(a.month)))[0] || null;
  return {
    custom: false,
    incomes: rules.recurringIncomes.map((x) => ({ id: uid(), name: x.name, amount: recurringValue(latest, 'income', x.name, x.amount), day: normalizeRecurringDay(x.day) })),
    expenses: rules.recurringExpenses
      .filter((x) => normalizeGroup(x.group) !== 'extra')
      .map((x) => ({ id: uid(), group: x.group, name: x.name, amount: recurringValue(latest, 'expense', x.name, x.amount), day: normalizeRecurringDay(x.day) })),
  };
}
function recurringConfig() {
  const saved = profile().recurring;
  if (saved?.custom) return normalizeRecurringConfig(saved);
  return recurringDefaults();
}
function financeReminderSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60) || 'item';
}
function financeReminderId(kind, item, month) {
  return ['finance',actor(),month,kind,kind==='expense'?normalizeGroup(item?.group):'',financeReminderSlug(item?.name)].join(':');
}
function localFinanceToday() {
  const now=new Date();
  const month=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  const date=month+'-'+String(now.getDate()).padStart(2,'0');
  return {month,date};
}
function financeReminderMatchesLogged(reminder) {
  const rec=recordFor(reminder.month);
  if (!rec) return false;
  if(reminder.kind==='investment-snapshot'){
    const snapshotAt=String(rec.updatedAt||'');
    const requestedAt=String(reminder.createdAt||'');
    return hasValue(rec.investmentTotal)&&!!snapshotAt&&(!requestedAt||snapshotAt>=requestedAt);
  }
  const list=reminder.kind==='income'?(rec.incomes||[]):(rec.expenses||[]);
  const name=String(reminder.name||'').trim().toLowerCase();
  return list.some((item)=>{
    if(String(item?.name||'').trim().toLowerCase()!==name)return false;
    if(reminder.kind==='expense'&&normalizeGroup(item?.group)!==normalizeGroup(reminder.group))return false;
    return true;
  });
}
function financeReminderResolved(reminder) {
  const rec=recordFor(reminder.month);
  return rec?.finalized===true || financeReminderMatchesLogged(reminder);
}
function dueFinanceReminderSnapshots() {
  if(!actor())return [];
  const {month,date}=localFinanceToday();
  const rec=recordFor(month);
  if(rec?.finalized===true)return [];
  const config=recurringConfig();
  const rows=[
    ...config.incomes.map((item)=>({kind:'income',item})),
    ...config.expenses.map((item)=>({kind:'expense',item})),
  ];
  return rows.map(({kind,item})=>{
    const day=normalizeRecurringDay(item.day);
    if(day==='')return null;
    const dueDate=financeDateForDay(month,day);
    if(!dueDate||dueDate>date)return null;
    const reminder={
      id:financeReminderId(kind,item,month),
      kind,
      name:String(item.name||''),
      group:kind==='expense'?String(item.group||''):'',
      amount:item.amount,
      month,
      date:dueDate,
      createdAt:new Date().toISOString(),
    };
    if(financeReminderMatchesLogged(reminder))return null;
    return reminder;
  }).filter(Boolean);
}
function financeReminderQuestion(reminder) {
  if(reminder.kind==='investment-snapshot')return "What's your investment worth now?";
  return reminder.kind==='income'
    ? 'Has '+reminder.name+' arrived?'
    : 'Has '+reminder.name+' been charged?';
}
function publishFinanceNotifications() {
  const p=profile();
  const items=(p.financeReminders||[]).filter((item)=>!financeReminderResolved(item)).map((item)=>({
    id:item.id,
    actor:actor(),
    kind:'finance-recurring',
    title:financeReminderQuestion(item),
    detail:item.kind==='investment-snapshot'?'Update '+monthLabel(item.month)+' investment value':money(item.amount)+' · '+financeDateLabel(item.date),
    actionable:true,
  }));
  window.TwogetherNotifications?.setPending(items,'finances');
}
async function syncFinanceReminders() {
  const a=actor();
  if(!a||financeReminderSyncing)return;
  financeReminderSyncing=true;
  try{
    const current=profile();
    const kept=(current.financeReminders||[]).filter((item)=>!financeReminderResolved(item));
    const byId=new Map(kept.map((item)=>[item.id,item]));
    dueFinanceReminderSnapshots().forEach((item)=>{if(!byId.has(item.id))byId.set(item.id,item);});
    const next=[...byId.values()];
    const changed=JSON.stringify(current.financeReminders||[])!==JSON.stringify(next);
    current.financeReminders=next;
    financeState.financeProfiles[a]=normalizeProfile(current);
    publishFinanceNotifications();
    if(changed){
      try{await post('saveFinanceProfile',{profile:current});}
      catch{}
    }
  } finally {
    financeReminderSyncing=false;
  }
}
function financeReminderById(id) {
  return (profile().financeReminders||[]).find((item)=>item.id===id)||null;
}
async function removeFinanceReminder(id) {
  const a=actor(); if(!a)return;
  const next=profile();
  next.financeReminders=(next.financeReminders||[]).filter((item)=>item.id!==id);
  financeState.financeProfiles[a]=normalizeProfile(next);
  publishFinanceNotifications();
  try{await post('saveFinanceProfile',{profile:next});}catch{}
}
async function queueInvestmentSnapshotReminder(month,date='') {
  const a=actor();
  if(!a||!financeRules(a).investmentTracking||!/^[0-9]{4}-[0-9]{2}$/.test(String(month||'')))return;
  const today=new Date();
  const fallbackDate=month+'-'+String(Math.min(today.getDate(),daysInFinanceMonth(month))).padStart(2,'0');
  const reminderDate=normalizeFinanceDate(date,month)||fallbackDate;
  const id=['finance',a,month,'investment-snapshot'].join(':');
  const next=profile();
  const reminder={id,kind:'investment-snapshot',name:'Investment value',group:'investments',amount:'',month,date:reminderDate,createdAt:new Date().toISOString()};
  next.financeReminders=(next.financeReminders||[]).filter((item)=>item.id!==id).concat(reminder);
  financeState.financeProfiles[a]=normalizeProfile(next);
  publishFinanceNotifications();
  try{await post('saveFinanceProfile',{profile:next});}catch{}
}
function openFinanceReminderConfirm(reminder) {
  if(!reminder)return;
  const rec=recordFor(reminder.month);
  if(rec?.finalized===true){publishFinanceNotifications();return toast('This month is final and locked','warn');}
  const back=()=>{closeMini();window.TwogetherNotifications?.open?.();};
  if(reminder.kind==='investment-snapshot'){
    const current=rec&&hasValue(rec.investmentTotal)?String(n(rec.investmentTotal)):'';
    showMini(
      '<span class="panel-kicker">INVESTMENTS</span>'+ 
      '<h2>What’s your investment worth now?</h2>'+ 
      '<p>Enter the current value of your investment account for '+esc(monthLabel(reminder.month))+'.</p>'+ 
      '<div class="finance-mini-fields"><label class="full">Current value<div class="finance-money mini"><span>€</span><input id="finInvestmentSnapshotValue" inputmode="decimal" value="'+esc(current)+'" placeholder="0.00"></div></label></div>'+ 
      '<div class="finance-mini-actions"><button class="btn ghost" type="button" data-fin-reminder-back>Back</button><button class="btn primary" type="button" data-fin-investment-snapshot-save>Save value</button></div>',
      '',
      {back}
    );
    $('[data-fin-reminder-back]')?.addEventListener('click',back);
    $('[data-fin-investment-snapshot-save]')?.addEventListener('click',async()=>{
      const raw=$('#finInvestmentSnapshotValue')?.value||'';
      if(raw===''||!Number.isFinite(Number(raw.replace(',','.')))||n(raw)<0)return toast('Enter a valid investment value','warn');
      const button=$('[data-fin-investment-snapshot-save]'); if(button)button.disabled=true;
      try{
        const next=directMonthRecord(reminder.month);
        if(next.finalized===true)throw new Error('This month is final and locked');
        next.investmentTotal=n(raw);
        closeMini();
        await saveDirectMonthRecord(next,'Investment value updated',{openDetail:false});
        await removeFinanceReminder(reminder.id);
      }catch(error){
        if(button)button.disabled=false;
        toast(error?.message||'Could not save investment value','warn');
      }
    });
    return;
  }
  showMini(
    '<span class="panel-kicker">FINANCE REMINDER</span>'+
    '<h2>'+esc(financeReminderQuestion(reminder))+'</h2>'+
    '<div class="finance-mini-fields">'+
      '<label class="full">Amount<div class="finance-money mini"><span>€</span><input id="finReminderAmount" inputmode="decimal" value="'+esc(String(reminder.amount??''))+'"></div></label>'+
      '<label class="full">Date<strong class="finance-reminder-date">'+esc(financeDateLabel(reminder.date))+'</strong></label>'+
    '</div>'+
    '<div class="finance-mini-actions"><button class="btn ghost" type="button" data-fin-reminder-back>Back</button><button class="btn primary" type="button" data-fin-reminder-confirm>Confirm & log</button></div>',
    '',
    {back}
  );
  $('[data-fin-reminder-back]')?.addEventListener('click',back);
  $('[data-fin-reminder-confirm]')?.addEventListener('click',async()=>{
    const raw=$('#finReminderAmount')?.value||'';
    if(raw===''||!Number.isFinite(Number(raw.replace(',','.')))||n(raw)<0)return toast('Enter a valid amount','warn');
    const button=$('[data-fin-reminder-confirm]'); if(button)button.disabled=true;
    try{
      const next=directMonthRecord(reminder.month);
      if(next.finalized===true)throw new Error('This month is final and locked');
      if(financeReminderMatchesLogged(reminder)){
        closeMini();
        await removeFinanceReminder(reminder.id);
        return;
      }
      if(reminder.kind==='income') next.incomes.push({name:reminder.name,amount:n(raw),date:reminder.date});
      else next.expenses.push({group:reminder.group||'other',name:reminder.name,amount:n(raw),date:reminder.date});
      if(!recordFor(reminder.month))next.partialOnly=true;
      closeMini();
      await saveDirectMonthRecord(next,reminder.name+' logged',{openDetail:false});
      if(reminder.kind==='expense'&&normalizeGroup(reminder.group)==='investments')await queueInvestmentSnapshotReminder(reminder.month,reminder.date);
      await removeFinanceReminder(reminder.id);
    }catch(error){
      if(button)button.disabled=false;
      toast(error?.message||'Could not log this finance','warn');
    }
  });
}

function recurringExpenseGroups() {
  return actor() === 'Principe'
    ? [
        { key: 'fixed', label: 'Fixed expenses' },
        { key: 'subscriptions', label: 'Subscriptions' },
        { key: 'budgets', label: 'Variable expenses' },
        { key: 'wealth', label: 'Savings' },
        { key: 'other', label: 'Other' },
      ]
    : [
        { key: 'medical', label: 'Medical' },
        { key: 'subscriptions', label: 'Subscriptions' },
        { key: 'budgets', label: 'Budgets' },
        { key: 'wealth', label: 'Savings / Investments' },
        { key: 'other', label: 'Other' },
      ];
}

function recurringGroupForCategory(category, name, currentItem = null) {
  if (currentItem && groupTone(currentItem.group) === category) return currentItem.group;
  if (category === 'fixed') return 'fixed';
  if (category === 'medical') return 'medical';
  if (category === 'subscriptions') return 'subscriptions';
  if (category === 'budgets') return 'variable';
  if (category === 'wealth') {
    if (actor() === 'Principessa' && /invest/i.test(String(name || ''))) return 'investments';
    return 'savings';
  }
  return 'other';
}

function post(action, payload) { return window.TwogetherAPI.post(action, payload, actor()); }

function ownMonths() { return financeState.finances?.[actor()] || []; }
function recordFor(month) { return ownMonths().find((x) => x.month === month) || null; }
function directMonthRecord(month) {
  const existing = recordFor(month);
  if (existing) return cloneRecord(existing);
  const fresh = freshRecord(month);
  fresh.partialOnly = true;
  return fresh;
}
function hasValue(v) { return v !== '' && v != null; }
function normalizeFinanceRecord(rec, owner = actor()) {
  const copy = JSON.parse(JSON.stringify(rec || {}));
  const rules = financeRules(owner);
  copy.incomes = Array.isArray(copy.incomes) ? copy.incomes.map((x) => ({ ...x, date: normalizeFinanceDate(x.date, copy.month) })) : [];
  copy.expenses = Array.isArray(copy.expenses) ? copy.expenses.map((x) => ({ ...x, group: normalizeGroup(x.group), date: normalizeFinanceDate(x.date, copy.month) })) : [];
  copy.partialOnly = copy.partialOnly === true;
  const fixedExtras = copy.expenses.filter((x) => normalizeGroup(x.group) === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra');
  if (rules.extraTracking) {
    const storedBudget = hasValue(copy.extraBudget) ? n(copy.extraBudget) : (fixedExtras.length && hasValue(fixedExtras[0].amount) ? n(fixedExtras[0].amount) : rules.extraBudget);
    copy.extraBudget = storedBudget;
    if (copy.partialOnly) {
      copy.expenses = copy.expenses.filter((x) => !(normalizeGroup(x.group) === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra'));
    } else {
      copy.expenses = copy.expenses.filter((x) => normalizeGroup(x.group) !== 'extra' || String(x.name || '').trim().toLowerCase() !== 'extra' || x === fixedExtras[0]);
      if (!copy.expenses.some((x) => normalizeGroup(x.group) === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra')) copy.expenses.push({ group: 'extra', name: 'Extra', amount: storedBudget, date: '' });
      copy.expenses.forEach((x) => { if (normalizeGroup(x.group) === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra') { x.amount = storedBudget; x.date = ''; } });
    }
  } else {
    copy.extraBudget = '';
    copy.expenses = copy.expenses.filter((x) => !(normalizeGroup(x.group) === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra'));
  }
  const allowedExtraSources = rules.extraTracking ? ['creditcard', 'savings', 'main'] : (rules.savedUpExtraTracking ? ['savings'] : []);
  copy.extraSpends = Array.isArray(copy.extraSpends) ? copy.extraSpends.map((x) => {
    const sourceRaw = String(x.source || '');
    return { id: x.id || uid(), source: allowedExtraSources.includes(sourceRaw) ? sourceRaw : '', amount: n(x.amount) };
  }).filter((x) => x.source && x.amount > 0) : [];
  if (!copy.extraSpends.length && allowedExtraSources.length) {
    const legacySourceRaw = String(copy.extraOverspendSource || '');
    const legacySource = allowedExtraSources.includes(legacySourceRaw) ? legacySourceRaw : '';
    const legacyAmount = hasValue(copy.extraOverspendAmount) ? Math.max(0, n(copy.extraOverspendAmount)) : 0;
    if (legacySource && legacyAmount > 0) copy.extraSpends.push({ id: uid(), source: legacySource, amount: legacyAmount });
  }
  const legacyFirst = copy.extraSpends[0] || null;
  copy.extraOverspendSource = legacyFirst?.source || '';
  copy.extraOverspendAmount = copy.extraSpends.reduce((sum, x) => sum + n(x.amount), 0);
  return copy;
}

function extraSourceLabel(source) {
  if (source === 'savings') return 'From Saved Up';
  if (source === 'main') return 'From Main account leftover';
  return 'Credit Card';
}

function previousMonthKey(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!match) return '';
  let y = Number(match[1]), m = Number(match[2]) - 1;
  if (m === 0) { y -= 1; m = 12; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function extraSpendsTotal(rec) { return (rec?.extraSpends || []).reduce((sum, x) => sum + n(x.amount), 0); }

function extraCarryInfo(month) {
  const rules = financeRules();
  if (!rules.extraTracking) return { prevMonth: previousMonthKey(month), over: 0, budget: 0, debt: 0 };
  const prevMonth = previousMonthKey(month), prev = prevMonth ? recordFor(prevMonth) : null;
  const over = prev ? extraSpendsTotal(prev) : 0;
  return {
    prevMonth,
    over,
    budget: over > 0 ? Math.max(100, rules.extraBudget - Math.min(150, over)) : rules.extraBudget,
    debt: Math.max(0, over - 150),
  };
}

function mainAccountLeftover() { return ownMonths().reduce((sum, rec) => sum + calc(rec).leftover, 0); }

function extraSpendSummary(rec) {
  const grouped = { creditcard: 0, savings: 0, main: 0 };
  (rec?.extraSpends || []).forEach((x) => { if (Object.prototype.hasOwnProperty.call(grouped, x.source)) grouped[x.source] += n(x.amount); });
  return Object.entries(grouped).filter(([, amount]) => amount > 0).map(([source, amount]) => ({ source, amount }));
}

function loanPaid(item) { return (item?.repayments || []).reduce((sum, r) => sum + n(r.amount), 0); }
function loanRemaining(item) { return Math.max(0, n(item?.principal) - loanPaid(item)); }
function calc(rec) {
  const incomes = Array.isArray(rec?.incomes) ? rec.incomes : [];
  const expenses = Array.isArray(rec?.expenses) ? rec.expenses : [];
  const income = incomes.reduce((sum, x) => sum + n(x.amount), 0);
  const normalOutflow = expenses.reduce((sum, x) => sum + n(x.amount), 0);
  const extraOverspendAmount = extraSpendsTotal(rec);
  const outflow = normalOutflow + extraOverspendAmount;
  const savings = expenses.filter((x) => normalizeGroup(x.group) === 'savings').reduce((sum, x) => sum + n(x.amount), 0);
  const investmentContribution = expenses.filter((x) => normalizeGroup(x.group) === 'investments').reduce((sum, x) => sum + n(x.amount), 0);
  const extraBudget = hasValue(rec?.extraBudget) ? n(rec.extraBudget) : (financeRules().extraBudget || 0);
  const extraSpent = extraBudget + extraOverspendAmount;
  const extraDelta = -extraOverspendAmount;
  const leftover = income - outflow;
  const investmentTotal = hasValue(rec?.investmentTotal) ? n(rec.investmentTotal) : null;
  const sisterInvestments = hasValue(rec?.sisterInvestments) ? n(rec.sisterInvestments) : 0;
  const ownInvestments = investmentTotal == null ? null : Math.max(0, investmentTotal - sisterInvestments);
  return {
    income, outflow, savings, investmentContribution, leftover, overspent: Math.max(0, -leftover),
    extraSpent, extraBudget, extraDelta, extraOver: extraOverspendAmount, extraOverspendAmount,
    investmentTotal, sisterInvestments, ownInvestments,
  };
}

function investmentGL(rec) {
  const current = calc(rec || {});
  if (current.ownInvestments == null) return null;
  const previous = [...ownMonths()]
    .filter((x) => x.month < rec.month && hasValue(x.investmentTotal))
    .sort((a, b) => String(b.month).localeCompare(String(a.month)))[0];
  if (!previous) return null;
  const prev = calc(previous);
  if (prev.ownInvestments == null) return null;
  return { value: current.ownInvestments - prev.ownInvestments, previousMonth: previous.month, previousValue: prev.ownInvestments };
}

function profileStats() {
  const p = profile();
  const bankTotal = p.bankAccounts.reduce((sum, x) => sum + n(x.balance), 0);
  const savingsTotal = n(p.savingsTotal);
  const heldTotal = p.savingsReserved.reduce((sum, x) => sum + n(x.amount), 0);
  const availableSavings = savingsTotal - heldTotal;
  const owedTotal = p.receivables.reduce((sum, x) => sum + loanRemaining(x), 0) + tripReceivables().reduce((sum, x) => sum + n(x.amount), 0);
  const latestInvestment = [...ownMonths()].filter((x) => hasValue(x.investmentTotal)).sort((a, b) => String(b.month).localeCompare(String(a.month)))[0] || null;
  const inv = latestInvestment ? calc(latestInvestment) : { investmentTotal: null, sisterInvestments: 0, ownInvestments: null };
  const gl = latestInvestment ? investmentGL(latestInvestment) : null;
  const ownInvestments = inv.ownInvestments == null ? 0 : inv.ownInvestments;
  const netWorth = availableSavings + ownInvestments;
  const mainLeftover = mainAccountLeftover();
  return { p, bankTotal, savingsTotal, heldTotal, availableSavings, owedTotal, latestInvestment, inv, gl, netWorth, mainLeftover };
}

function netWorthForOwner(owner) {
  const p = normalizeProfile(financeState.financeProfiles?.[owner]);
  const savingsTotal = n(p.savingsTotal);
  const heldTotal = p.savingsReserved.reduce((sum, x) => sum + n(x.amount), 0);
  const availableSavings = savingsTotal - heldTotal;
  const latestInvestment = [...(financeState.finances?.[owner] || [])]
    .filter((x) => hasValue(x.investmentTotal))
    .sort((a, b) => String(b.month).localeCompare(String(a.month)))[0] || null;
  const investmentTotal = latestInvestment && hasValue(latestInvestment.investmentTotal) ? n(latestInvestment.investmentTotal) : 0;
  const sisterInvestments = latestInvestment && hasValue(latestInvestment.sisterInvestments) ? n(latestInvestment.sisterInvestments) : 0;
  const ownInvestments = Math.max(0, investmentTotal - sisterInvestments);
  return availableSavings + ownInvestments;
}

function sharedHouseProgressStats() {
  const combinedNetWorth = ['Principessa', 'Principe'].reduce((sum, owner) => sum + netWorthForOwner(owner), 0);
  const availableForHouse = Math.max(0, combinedNetWorth - HOUSE_EMERGENCY_RESERVE);
  return { combinedNetWorth, availableForHouse };
}

async function loadState() {
  if (loading || !actor()) return;
  loading = true;
  try {
    const state = await window.TwogetherAPI.remoteState();
    if (state) {
      financeState = {
        version: Number(state?.version || 0),
        finances: {
          Principessa: (Array.isArray(state?.finances?.Principessa) ? state.finances.Principessa : []).map((x) => normalizeFinanceRecord(x, 'Principessa')),
          Principe: (Array.isArray(state?.finances?.Principe) ? state.finances.Principe : []).map((x) => normalizeFinanceRecord(x, 'Principe')),
        },
        financeProfiles: {
          Principessa: normalizeProfile(state?.financeProfiles?.Principessa),
          Principe: normalizeProfile(state?.financeProfiles?.Principe),
        },
        plans: Array.isArray(state?.plans) ? state.plans : [],
      };
      renderPage();
      await syncFinanceReminders();
    }
  } catch {}
  finally { loading = false; }
}

function renderPage() {
  const sheet = $('#finances'); if (!sheet) return;
  const months = [...ownMonths()].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  const latest = months[months.length - 1] || null;
  const summary = calc(latest || {});
  const ps = profileStats();
  const latestGl = latest ? investmentGL(latest) : null;
  const house = sharedHouseProgressStats();
  const housePercent = HOUSE_GOAL_TARGET > 0 ? Math.max(0, (house.availableForHouse / HOUSE_GOAL_TARGET) * 100) : 0;
  const houseProgress = Math.min(100, housePercent);
  const houseMarker = Math.min(98, Math.max(2, houseProgress));
  const housePercentLabel = housePercent.toFixed(1).replace(/\.0$/, '');
  const houseRemaining = Math.max(0, HOUSE_GOAL_TARGET - house.availableForHouse);
  const summaryRoot = $('#financeSummary');
  if (summaryRoot) {
    const statusClass = latest ? (latest.finalized ? 'status-final' : 'status-draft') : 'status-empty';
    summaryRoot.innerHTML = `
      <div class="finance-kpi month-status ${statusClass}"><strong>${latest ? monthLabel(latest.month) : 'No month logged'}</strong></div>
      <div class="finance-kpi"><span>Total income</span><strong>${money(summary.income)}</strong></div>
      <div class="finance-kpi"><span>Total outflow</span><strong>${money(summary.outflow)}</strong></div>
      <div class="finance-kpi ${summary.leftover < 0 ? 'bad' : summary.income ? 'good' : ''}"><span>${summary.leftover < 0 ? 'Overspent' : 'Leftover'}</span><strong>${money(Math.abs(summary.leftover))}</strong></div>
      <div class="finance-kpi wealth"><span>Current net worth</span><strong>${money(ps.netWorth)}</strong><small>Available savings + your investments</small></div>
      <div class="finance-kpi ${latestGl?.value < 0 ? 'bad' : latestGl?.value > 0 ? 'good' : ''}"><span>Investment G/L p/m</span><strong>${latestGl ? signedMoney(latestGl.value) : '—'}</strong><small>${latestGl ? `vs ${monthLabel(latestGl.previousMonth)}` : 'Log 2 months to compare'}</small></div>
      <article class="finance-house-goal" aria-label="House savings goal">
        <div class="finance-house-goal-icon" aria-hidden="true"><span>🏡</span><small>♡</small></div>
        <div class="finance-house-goal-body">
          <div class="finance-house-goal-head">
            <div><span class="panel-kicker">OUR DREAM HOME</span><h2>Closer to our own front door</h2></div>
            <div class="finance-house-goal-percent"><strong>${housePercentLabel}%</strong><span>of the way there</span></div>
          </div>
          <div class="finance-house-goal-money"><strong>${money(house.availableForHouse)}</strong><span>of ${money(HOUSE_GOAL_TARGET)}</span></div>
          <div class="finance-house-goal-track" role="progressbar" aria-label="House goal progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${houseProgress.toFixed(1)}">
            <span style="width:${houseProgress}%"></span><i style="left:${houseMarker}%" aria-hidden="true">♡</i>
          </div>
          <div class="finance-house-goal-foot">
            <span>${houseRemaining > 0 ? `${money(houseRemaining)} to go` : 'Dream-home goal reached ♡'}</span>
            <small>Both net worths combined, with ${money(HOUSE_EMERGENCY_RESERVE)} kept for emergencies.</small>
          </div>
        </div>
      </article>`;
  }
  renderCurrentPanel();
  renderScenarioPanel();

  const root = $('#financeMonths'); if (!root) return;
  const yearBounds=financeYearBounds();
  financeViewYear=Math.min(yearBounds.max,Math.max(yearBounds.min,financeViewYear));
  const now=new Date();
  const currentKey=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const yearControls=`<div class="finance-year-switcher" aria-label="Finance year">
    <button type="button" data-fin-year-prev aria-label="Previous year" ${financeViewYear<=yearBounds.min?'disabled':''}>‹</button>
    <strong>${financeViewYear}</strong>
    <button type="button" data-fin-year-next aria-label="Next year" ${financeViewYear>=yearBounds.max?'disabled':''}>›</button>
  </div>`;
  const monthCards=financeMonthsForYear(financeViewYear).map(([key, label]) => {
    const rec = recordFor(key), c = calc(rec || {});
    const status=rec ? (rec.finalized?'final':'draft') : 'empty';
    const pillText=rec ? (rec.finalized?'Locked':'Draft') : (key===currentKey?'Current':'Not logged');
    const amountText=rec ? money(Math.abs(c.leftover)) : '';
    const amountLabel=rec ? (c.leftover<0?'over':'left') : 'Tap to start';
    const meta=rec ? `${money(c.income)} in · ${money(c.outflow)} out` : '';
    return `<button class="tv2-card finance-month-tv2-card status-${status}" type="button" data-fin-month="${key}">
      <div class="tv2-card-top"><strong>${esc(label)}</strong><span class="tv2-pill">${esc(pillText)}</span></div>
      <div class="tv2-card-money">${meta?`<span>${esc(meta)}</span>`:''}<b class="${rec&&c.leftover<0?'is-over':''}">${amountText?amountText+' ':''}${esc(amountLabel)}</b></div>
    </button>`;
  }).join('');
  root.innerHTML=yearControls+monthCards;
  $$('[data-fin-month]', root).forEach((btn) => btn.addEventListener('click', () => {
    selectedMonth = btn.dataset.finMonth;
    renderDetail(directMonthRecord(selectedMonth));
  }));
  $('[data-fin-year-prev]',root)?.addEventListener('click',()=>{
    if(financeViewYear>yearBounds.min){financeViewYear-=1;renderPage();}
  });
  $('[data-fin-year-next]',root)?.addEventListener('click',()=>{
    if(financeViewYear<yearBounds.max){financeViewYear+=1;renderPage();}
  });
  const detail = $('#financeDetail'); if (detail && !recordFor(selectedMonth)) detail.innerHTML = '';
}

function renderCurrentPanel() {
  const root = $('#financeCurrent'); if (!root) return;
  const { p, bankTotal, savingsTotal, heldTotal, availableSavings, owedTotal, latestInvestment, inv, gl, netWorth } = profileStats();
  const banks = p.bankAccounts.length ? p.bankAccounts.map((x, i) => `<button class="finance-current-row" type="button" data-fin-edit-bank="${i}"><span>${esc(x.name)}</span><strong>${money(x.balance)}</strong></button>`).join('') : '<div class="finance-current-empty">No bank balances added yet.</div>';
  const holds = p.savingsReserved.length ? p.savingsReserved.map((x, i) => `<button class="finance-current-row" type="button" data-fin-edit-hold="${i}"><span>${esc(x.name)}</span><strong>${money(x.amount)}</strong></button>`).join('') : '<div class="finance-current-empty">Nothing earmarked yet.</div>';
  const tripOwedItems = tripReceivables();
  const activeManualOwed = p.receivables.map((x, i) => ({ item:x, index:i, remaining:loanRemaining(x) })).filter((x) => x.remaining > .005);
  const activeTripRows = tripOwedItems.map((x) => `<div class="finance-current-row finance-trip-owed"><span>${esc(x.person)}<small>${esc(x.reason)} · ${esc(x.categories)}</small></span><strong>${money(x.amount)}</strong></div>`).join('');
  const activeManualRows = activeManualOwed.map(({ item, index, remaining }) => `<button class="finance-current-row finance-manual-owed" type="button" data-fin-repay-owed="${index}"><span>${esc(item.person)}<small>${esc(item.reason || 'Reason not added')} · Manual loan</small></span><strong>${money(remaining)}</strong></button>`).join('');
  const owedPreview = activeTripRows + activeManualRows || '<button class="finance-current-row finance-owed-preview is-empty" type="button" data-fin-open-owed-history><span>Nobody currently owes you money.</span><strong>€0.00</strong></button>';
  root.innerHTML = `
    <div class="finance-current-head"><div><span class="panel-kicker">CURRENT POSITION</span><h2>${esc(actor())}’s balances</h2></div></div>
    <div class="finance-current-grid">
      <article class="finance-current-card tone-other" data-fin-current-cash><div class="finance-current-title"><div><span>BANKS</span><h3>Current cash</h3></div><strong data-fin-current-cash-total>${money(bankTotal)}</strong></div>${banks}<button class="btn ghost finance-add" type="button" data-fin-add-bank>+ Add bank</button></article>
      <article class="finance-current-card tone-wealth"><div class="finance-current-title"><div><span>SAVINGS</span><h3>Saved up</h3></div><strong>${money(availableSavings)}</strong></div><div class="finance-current-metrics"><div><span>Total saved</span><strong>${money(savingsTotal)}</strong></div><div><span>On hold</span><strong>${money(heldTotal)}</strong></div><div class="${availableSavings < 0 ? 'negative' : ''}"><span>Actually available</span><strong>${money(availableSavings)}</strong></div></div>${holds}<div class="finance-card-actions"><button class="btn ghost" type="button" data-fin-edit-savings>Edit saved total</button><button class="btn ghost" type="button" data-fin-add-hold>+ Add hold</button></div></article>
      <article class="finance-current-card tone-receivable" data-fin-owed-card><button class="finance-current-title finance-owed-title-open" type="button" data-fin-open-owed-history><div><span>PAYBACK</span><h3>Money owed to me</h3></div><strong>${money(owedTotal)}</strong></button>${owedPreview}<button class="btn ghost finance-add" type="button" data-fin-add-owed>+ Add loan</button></article>
      <article class="finance-current-card tone-wealth"><div class="finance-current-title"><div><span>INVESTMENTS</span><h3>Your investment value</h3></div><strong>${money(inv.ownInvestments || 0)}</strong></div><div class="finance-current-metrics"><div><span>Total account</span><strong>${inv.investmentTotal == null ? '—' : money(inv.investmentTotal)}</strong></div><div><span>Sis</span><strong>${inv.investmentTotal == null ? '—' : money(inv.sisterInvestments)}</strong></div><div class="${gl?.value < 0 ? 'negative' : 'positive'}"><span>G/L p/m</span><strong>${gl ? signedMoney(gl.value) : '—'}</strong></div></div><div class="finance-networth"><span>Current net worth</span><strong>${money(netWorth)}</strong><small>${latestInvestment ? `Investment snapshot: ${monthLabel(latestInvestment.month)}` : 'Log an investment snapshot in a month'}</small></div></article>
    </div>`;
  $('[data-fin-add-bank]', root)?.addEventListener('click', () => openBankModal(-1));
  $$('[data-fin-edit-bank]', root).forEach((btn) => btn.addEventListener('click', () => openBankModal(Number(btn.dataset.finEditBank))));
  $('[data-fin-edit-savings]', root)?.addEventListener('click', openSavingsModal);
  $('[data-fin-add-hold]', root)?.addEventListener('click', () => openHoldModal(-1));
  $$('[data-fin-edit-hold]', root).forEach((btn) => btn.addEventListener('click', () => openHoldModal(Number(btn.dataset.finEditHold))));
  $('[data-fin-add-owed]', root)?.addEventListener('click', () => openOwedModal(-1));
  root.querySelectorAll('[data-fin-repay-owed]').forEach((btn) => btn.addEventListener('click', () => openLoanRepayment(Number(btn.dataset.finRepayOwed))));
  root.querySelectorAll('[data-fin-open-owed-history]').forEach((btn) => btn.addEventListener('click', openOwedHistory));
  $('[data-fin-owed-card]', root)?.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    openOwedHistory();
  });
}

function renderScenarioPanel() {
  const root = $('#financeScenarios'); if (!root) return;
  const ps = profileStats(), p = ps.p;
  const latest = [...ownMonths()].sort((a, b) => String(b.month).localeCompare(String(a.month)))[0] || null;
  const monthlyLeft = latest ? calc(latest).leftover : 0;
  const currentMain = ps.mainLeftover;
  const cards = p.scenarios.length ? p.scenarios.map((x, i) => {
    const upfront = n(x.upfront), monthly = n(x.monthly);
    const rawMainAfter = currentMain - upfront;
    const fromSavings = Math.max(0, -rawMainAfter);
    const mainAfter = Math.max(0, rawMainAfter);
    const savingsAfter = ps.availableSavings - fromSavings;
    const afterMonth = monthlyLeft - monthly;
    const type = monthly > 0 ? 'Purchase + Monthly cost' : 'Purchase';
    const cls = savingsAfter < 0 || afterMonth < 0 ? 'bad' : fromSavings > 0 ? 'warn' : 'good';
    const verdict = savingsAfter < 0 ? 'Not fully covered by Main account + available savings' : afterMonth < 0 ? 'Purchase fits, but the monthly cost exceeds your usual leftover' : fromSavings > 0 ? 'Purchase needs some of your available savings' : 'Fits your current Main account leftover';
    const monthlyRows = monthly > 0 ? `<div class="scenario-row"><span>Monthly cost</span><strong>${money(monthly)}</strong></div><div class="scenario-row"><span>Monthly leftover after</span><strong>${money(afterMonth)}</strong></div>` : '';
    const savingsRows = fromSavings > 0 ? `<div class="scenario-row scenario-alert-row"><span>Needed from saved up</span><strong>${money(fromSavings)}</strong></div><div class="scenario-row"><span>Available savings after</span><strong>${money(savingsAfter)}</strong></div>` : '';
    return `<button class="finance-scenario-card ${cls}" type="button" data-fin-scenario="${i}"><span class="panel-kicker">${esc(type)}</span><h3>${esc(x.name)}</h3><div class="scenario-row"><span>Purchase price</span><strong>${money(upfront)}</strong></div><div class="scenario-row"><span>Current Main account leftover</span><strong>${money(currentMain)}</strong></div><div class="scenario-row"><span>Main account leftover after</span><strong>${money(mainAfter)}</strong></div>${monthlyRows}${savingsRows}<div class="scenario-verdict">${esc(verdict)}</div></button>`;
  }).join('') : '<div class="finance-current-empty">No purchase scenarios yet.</div>';
  root.innerHTML = `<div class="finance-scenario-wrap"><div class="finance-scenario-head"><div><span class="panel-kicker">WHAT IF?</span><h2>Purchase test scenarios</h2><p>Your Main account leftover is the sum of your logged monthly leftovers. Purchases use that first; any shortfall can come from actually available savings.</p></div><button class="btn primary" type="button" data-fin-add-scenario>+ Test a purchase</button></div><div class="finance-scenario-grid">${cards}</div></div>`;
  $('[data-fin-add-scenario]', root)?.addEventListener('click', () => openScenarioModal(-1));
  $$('[data-fin-scenario]', root).forEach((btn) => btn.addEventListener('click', () => openScenarioModal(Number(btn.dataset.finScenario))));
}

function recurringRow(kind, item, index) {
  const tone = kind === 'income' ? 'income' : groupTone(item.group);
  const day = normalizeRecurringDay(item.day);
  const timing = day === '' ? '' : 'Usually '+ordinalDay(day);
  return '<div class="finance-recurring-swipe-row finance-recurring-tone-'+tone+'" data-fin-recurring-kind="'+kind+'" data-fin-recurring-index="'+index+'">'+
    '<div class="finance-recurring-edit-reveal" aria-hidden="true"><b>Edit</b></div>'+
    '<div class="finance-recurring-delete-reveal" aria-hidden="true"><b>Delete</b></div>'+
    '<button class="finance-recurring-tv2-row" type="button" data-fin-recurring-open>'+
      '<span class="finance-recurring-item-main"><strong>'+esc(item.name)+'</strong>'+(timing?'<small>'+esc(timing)+'</small>':'')+'</span>'+
      '<span class="finance-recurring-item-amount">'+money(item.amount)+'</span>'+
    '</button>'+
  '</div>';
}

function recurringCategoryCard(kind, tone, label, items) {
  const total = items.reduce((sum, x) => sum + n(x.item.amount), 0);
  const rows = items.map((x) => recurringRow(kind, x.item, x.index)).join('');
  return '<div class="finance-recurring-card finance-recurring-card-'+tone+'">'+
    '<div class="finance-recurring-card-head">'+
      '<div class="finance-recurring-card-title">'+
        '<span class="finance-recurring-card-icon finance-tv2-tone-'+tone+'" aria-hidden="true">'+financeMonthToneIcon(tone, kind)+'</span>'+
        '<h3>'+esc(label)+'</h3>'+
      '</div>'+
      '<span class="finance-recurring-card-total"><span>Total</span><strong>'+money(total)+'</strong></span>'+
    '</div>'+
    '<div class="finance-recurring-card-body">'+rows+'</div>'+
  '</div>';
}

function resetRecurringSwipeVisual(row, animate = true) {
  if (!row) return;
  const card = row.querySelector('.finance-recurring-tv2-row');
  const edit = row.querySelector('.finance-recurring-edit-reveal');
  const remove = row.querySelector('.finance-recurring-delete-reveal');
  [edit,remove].forEach((action)=>{
    if(!action)return;
    action.style.transition=animate?'width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease':'none';
    action.style.width='0px';
    action.style.opacity='0';
  });
  if(card){
    card.style.transition=animate?'transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease':'none';
    card.style.transform='translateX(0)';
    card.style.opacity='1';
  }
  if(animate)setTimeout(()=>{[card,edit,remove].forEach((el)=>{if(el?.isConnected)el.style.transition='';});},220);
}
function closeRecurringSwipeRows(except = null) {
  document.querySelectorAll('#financeMiniBody .finance-recurring-swipe-row').forEach((row)=>{
    if(row!==except) resetRecurringSwipeVisual(row,true);
  });
}
function closeRecurringDeleteConfirm() {
  recurringDeleteConfirmLayer?.remove();
  recurringDeleteConfirmLayer=null;
}
function openRecurringDeleteConfirm(kind,index) {
  closeRecurringDeleteConfirm();
  const config=recurringConfig();
  const list=kind==='income'?config.incomes:config.expenses;
  const item=list[index];
  if(!item)return;
  recurringDeleteConfirmLayer=document.createElement('div');
  recurringDeleteConfirmLayer.className='tv2-confirm-layer';
  recurringDeleteConfirmLayer.innerHTML=
    '<div class="tv2-confirm-backdrop" data-fin-recurring-confirm-cancel></div>'+
    '<div class="tv2-confirm-card" role="dialog" aria-modal="true" aria-labelledby="finRecurringDeleteTitle">'+
      '<h2 id="finRecurringDeleteTitle">Delete item?</h2>'+
      '<p>Are you sure you want to delete <strong>'+esc(item.name)+'</strong>?</p>'+
      '<p class="tv2-confirm-note">This removes it from future recurring finance items. Already logged months stay unchanged.</p>'+
      '<p class="tv2-confirm-error" aria-live="polite"></p>'+
      '<div class="tv2-confirm-actions"><button type="button" data-fin-recurring-confirm-cancel>Cancel</button><button type="button" class="is-delete" data-fin-recurring-confirm-delete>Delete</button></div>'+
    '</div>';
  document.body.appendChild(recurringDeleteConfirmLayer);

  const cancel=()=>{closeRecurringDeleteConfirm();closeRecurringSwipeRows();};
  recurringDeleteConfirmLayer.querySelectorAll('[data-fin-recurring-confirm-cancel]').forEach((button)=>button.addEventListener('click',cancel));
  recurringDeleteConfirmLayer.addEventListener('keydown',(e)=>{if(e.key==='Escape')cancel();});

  const deleteButton=recurringDeleteConfirmLayer.querySelector('[data-fin-recurring-confirm-delete]');
  deleteButton.addEventListener('click',async()=>{
    deleteButton.disabled=true;
    deleteButton.textContent='Deleting…';
    const error=recurringDeleteConfirmLayer.querySelector('.tv2-confirm-error');
    error.textContent='';
    try{
      const next=profile();
      const nextConfig=recurringConfig();
      nextConfig.custom=true;
      const target=kind==='income'?nextConfig.incomes:nextConfig.expenses;
      if(!target[index]) throw new Error('This recurring item no longer exists');
      target.splice(index,1);
      next.recurring=nextConfig;
      const normalized=normalizeProfile(next);
      financeState.financeProfiles[actor()]=normalized;
      await post('saveFinanceProfile',{profile:normalized});
      closeRecurringDeleteConfirm();
      renderPage();
      openRecurringManager();
      toast('Recurring item removed');
      setTimeout(loadState,800);
    }catch(err){
      deleteButton.disabled=false;
      deleteButton.textContent='Delete';
      error.textContent=err?.message||'Could not delete this recurring item';
    }
  });
  setTimeout(()=>deleteButton.focus(),0);
}
function bindRecurringItemSwipe(root) {
  recurringSwipeAbort?.abort();
  const controller=new AbortController();
  recurringSwipeAbort=controller;
  const signal=controller.signal;
  const mobile=()=>window.matchMedia?.('(max-width:760px)')?.matches??window.innerWidth<=760;
  let swipe={tracking:false,active:false,startX:0,startY:0,lastX:0,row:null,direction:''};

  const resetState=()=>{swipe={tracking:false,active:false,startX:0,startY:0,lastX:0,row:null,direction:''};};
  const paint=(row,distance,direction)=>{
    const card=row.querySelector('.finance-recurring-tv2-row');
    const action=row.querySelector(direction==='edit'?'.finance-recurring-edit-reveal':'.finance-recurring-delete-reveal');
    const other=row.querySelector(direction==='edit'?'.finance-recurring-delete-reveal':'.finance-recurring-edit-reveal');
    if(!card||!action)return;
    const exposed=Math.abs(distance);
    card.style.transition='none';
    card.style.transform='translateX('+distance+'px)';
    action.style.transition='none';
    action.style.width=exposed+'px';
    action.style.opacity=String(Math.min(1,.35+exposed/120));
    if(other){other.style.width='0px';other.style.opacity='0';}
  };
  const finish=(row,direction)=>{
    const card=row.querySelector('.finance-recurring-tv2-row');
    const action=row.querySelector(direction==='edit'?'.finance-recurring-edit-reveal':'.finance-recurring-delete-reveal');
    const width=row.getBoundingClientRect().width||window.innerWidth-32;
    const distance=direction==='edit'?width:-width;
    if(card){
      card.style.transition='transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      card.style.transform='translateX('+distance+'px)';
      card.style.opacity='.76';
    }
    if(action){
      action.style.transition='width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      action.style.width=width+'px';
      action.style.opacity='1';
    }
  };

  root.addEventListener('touchstart',(e)=>{
    if(!mobile()||recurringDeleteConfirmLayer||e.touches.length!==1)return;
    const row=e.target.closest('.finance-recurring-swipe-row');
    if(!row)return;
    closeRecurringSwipeRows(row);
    resetRecurringSwipeVisual(row,false);
    const t=e.touches[0];
    swipe={tracking:true,active:false,startX:t.clientX,startY:t.clientY,lastX:t.clientX,row,direction:''};
  },{passive:true,signal});

  root.addEventListener('touchmove',(e)=>{
    if(!swipe.tracking||!swipe.row||e.touches.length!==1)return;
    const t=e.touches[0],dx=t.clientX-swipe.startX,dy=Math.abs(t.clientY-swipe.startY);
    swipe.lastX=t.clientX;
    if(!swipe.active){
      if(Math.abs(dx)<8&&dy<8)return;
      const horizontal=Math.abs(dx)>dy*1.2;
      const direction=dx>10?'edit':dx<-10?'delete':'';
      if(horizontal&&direction){swipe.active=true;swipe.direction=direction;}
      else if(dy>=Math.abs(dx)||(horizontal&&Math.abs(dx)>10&&!direction)){resetState();return;}
    }
    if(!swipe.active)return;
    e.preventDefault();
    const width=swipe.row.getBoundingClientRect().width||window.innerWidth-32;
    const maxDistance=width*.94;
    const distance=swipe.direction==='edit'
      ? Math.max(0,Math.min(maxDistance,dx))
      : Math.min(0,Math.max(-maxDistance,dx));
    paint(swipe.row,distance,swipe.direction);
  },{passive:false,signal});

  root.addEventListener('touchend',()=>{
    if(!swipe.tracking||!swipe.row){resetState();return;}
    const row=swipe.row,dx=swipe.lastX-swipe.startX,direction=swipe.direction;
    const width=row.getBoundingClientRect().width||window.innerWidth-32;
    const threshold=Math.max(180,width*.62);
    const fullSwipe=swipe.active&&((direction==='edit'&&dx>=threshold)||(direction==='delete'&&-dx>=threshold));
    if(!swipe.active){
      resetRecurringSwipeVisual(row,true);
      resetState();
      return;
    }
    recurringSwipeIgnoreUntil=Date.now()+550;
    if(!fullSwipe){
      resetRecurringSwipeVisual(row,true);
      resetState();
      return;
    }
    const kind=row.dataset.finRecurringKind,index=Number(row.dataset.finRecurringIndex);
    finish(row,direction);
    resetState();
    setTimeout(()=>{
      resetRecurringSwipeVisual(row,false);
      if(direction==='edit') openRecurringEditor(kind,index);
      else openRecurringDeleteConfirm(kind,index);
    },180);
  },{passive:true,signal});

  root.addEventListener('touchcancel',()=>{
    resetRecurringSwipeVisual(swipe.row,true);
    resetState();
  },{passive:true,signal});
}

function openRecurringManager() {
  const config = recurringConfig();
  const incomeItems = config.incomes.map((item,index)=>({item,index}));
  const incomes = incomeItems.length
    ? recurringCategoryCard('income','income','Income',incomeItems)
    : '<div class="finance-recurring-empty-card">No recurring income yet.</div>';

  const expenseRows = config.expenses.map((item,index)=>({item,index,tone:groupTone(item.group)}));
  const grouped = {};
  expenseRows.forEach((x)=>(grouped[x.tone]||(grouped[x.tone]=[])).push(x));
  const expenses = categoryOrder().filter((tone)=>grouped[tone]?.length).map((tone)=>
    recurringCategoryCard('expense',tone,categoryLabel(tone),grouped[tone])
  ).join('') || '<div class="finance-recurring-empty-card">No recurring expenses yet.</div>';

  showMini(
    '<div class="tv2-root finance-recurring-tv2">'+
      '<div class="tv2-page">'+
        '<header class="tv2-trip-head finance-recurring-page-head"><div class="tv2-nav"><button type="button" class="tv2-link" data-fin-recurring-close>‹ Finances</button><span></span></div>'+
          '<h1>Manage recurring items</h1></header>'+
        '<section class="finance-recurring-list">'+
          '<div class="finance-recurring-section-block">'+
            '<div class="finance-recurring-tv2-head"><h2>Income</h2><button type="button" class="finance-recurring-add" data-fin-recurring-add="income"><span aria-hidden="true">＋</span> Add</button></div>'+
            incomes+
          '</div>'+
          '<div class="finance-recurring-section-block finance-recurring-outflow-block">'+
            '<div class="finance-recurring-tv2-head is-outflow"><h2>Outflow</h2><button type="button" class="finance-recurring-add" data-fin-recurring-add="expense"><span aria-hidden="true">＋</span> Add</button></div>'+
            expenses+
          '</div>'+
        '</section>'+
      '</div>'+
    '</div>',
    'recurring-manager'
  );

  const modalBody=$('#financeMiniBody');
  $('[data-fin-recurring-close]',modalBody)?.addEventListener('click',closeMini);
  if (modalBody) {
    bindRecurringItemSwipe(modalBody);
    modalBody.onclick=(e)=>{
      if(Date.now()<recurringSwipeIgnoreUntil)return;
      const edit=e.target.closest?.('.finance-recurring-swipe-row');
      if(edit){openRecurringEditor(edit.dataset.finRecurringKind,Number(edit.dataset.finRecurringIndex));return;}
      const add=e.target.closest?.('[data-fin-recurring-add]');
      if(add) openRecurringEditor(add.dataset.finRecurringAdd,-1);
    };
  }
}

function openRecurringEditor(kind,index) {
  const config=recurringConfig();
  const list=kind==='income'?config.incomes:config.expenses;
  const item=index>=0?list[index]:null;
  const isExpense=kind==='expense';
  const groups=recurringExpenseGroups();
  const selectedGroup=item?groupTone(item.group):(groups[0]?.key||'other');
  const referenceMonth=/^\d{4}-\d{2}$/.test(String(selectedMonth||''))?selectedMonth:'2026-09';
  const bounds=financeDateBounds(referenceMonth);
  const selectedDate=financeDateForDay(referenceMonth,item?.day);
  const groupField=isExpense
    ? '<label class="tv2-field"><span>Category</span><select id="finRecurringGroup" class="finance-recurring-select">'+groups.map((g)=>'<option value="'+g.key+'" '+(g.key===selectedGroup?'selected':'')+'>'+esc(g.label)+'</option>').join('')+'</select></label>'
    : '';

  showMini(
    '<div class="tv2-root finance-recurring-tv2">'+
      '<div class="tv2-page tv2-budget-edit-page">'+
        '<header class="tv2-trip-head"><div class="tv2-nav"><button type="button" class="tv2-link" data-fin-recurring-back>‹ Recurring items</button><span></span></div>'+
          '<h1>'+(item?'Edit item':'Add item')+'</h1><p>'+(isExpense?'Monthly outflow':'Monthly income')+'</p></header>'+
        '<section class="tv2-budget-editor-card finance-recurring-editor-card">'+
          '<label class="tv2-field"><span>Name</span><input id="finRecurringName" value="'+esc(item?.name||'')+'" placeholder="'+(isExpense?'e.g. Spotify':'e.g. Salary')+'"></label>'+
          groupField+
          '<label class="tv2-field"><span>Usual amount</span><div class="finance-recurring-amount"><b>€</b><input id="finRecurringAmount" inputmode="decimal" value="'+esc(String(item?.amount??''))+'" placeholder="0.00"></div></label>'+
          '<label class="tv2-field tv2-date-field"><span>Usual date</span><span class="tv2-date-box"><input id="finRecurringDate" type="date" min="'+bounds.min+'" max="'+bounds.max+'" value="'+esc(selectedDate)+'"></span></label>'+
        '</section>'+
        '<div class="finance-recurring-editor-actions">'+
          '<button type="button" class="tv2-primary" data-fin-recurring-save>Save</button>'+
        '</div>'+
      '</div>'+
    '</div>',
    'recurring-manager',
    { back: openRecurringManager }
  );

  $('[data-fin-recurring-back]')?.addEventListener('click',openRecurringManager);
  $('[data-fin-recurring-save]')?.addEventListener('click',async()=>{
    const name=String($('#finRecurringName')?.value||'').trim();
    const amount=$('#finRecurringAmount')?.value||'';
    const dateRaw=String($('#finRecurringDate')?.value||'').trim();
    const safeDate=dateRaw?normalizeFinanceDate(dateRaw,referenceMonth):'';
    const day=safeDate?Number(safeDate.slice(-2)):'';
    if(!name) return toast('Add a name first','warn');
    if(amount===''||!Number.isFinite(Number(amount.replace(',','.')))) return toast('Enter a valid amount','warn');
    if(dateRaw&&!safeDate) return toast('Choose a valid date','warn');
    const next=profile();
    const nextConfig=recurringConfig();
    nextConfig.custom=true;
    const row={id:item?.id||uid(),name,amount:n(amount),day};
    if(isExpense) {
      const category=$('#finRecurringGroup')?.value||selectedGroup;
      row.group=recurringGroupForCategory(category,name,item);
    }
    const target=isExpense?nextConfig.expenses:nextConfig.incomes;
    if(index>=0) target[index]=row; else target.push(row);
    next.recurring=nextConfig;
    await saveProfile(next,'Recurring item saved');
  });

}

function openScenarioModal(index) {
  const p = profile(), item = index >= 0 ? p.scenarios[index] : null;
  showMini(`<span class="panel-kicker">TEST SCENARIO</span><h2>${item ? 'Edit purchase test' : 'Test a purchase'}</h2><p>Purchase price is tested against your accumulated Main account leftover. If that is not enough, Twogether uses your actually available savings. A monthly cost only reduces your usual monthly leftover.</p><div class="finance-mini-fields"><label>What are you considering?<input id="finMiniScenarioName" value="${esc(item?.name || '')}" placeholder="e.g. New laptop"></label><label>Purchase price<div class="finance-money mini"><span>€</span><input id="finMiniScenarioUpfront" inputmode="decimal" value="${esc(String(item?.upfront ?? ''))}" placeholder="0.00"></div></label><label>Monthly cost, if any<div class="finance-money mini"><span>€</span><input id="finMiniScenarioMonthly" inputmode="decimal" value="${esc(String(item?.monthly ?? 0))}" placeholder="0.00"></div></label></div><div class="finance-mini-actions">${item ? '<button class="btn ghost" type="button" data-fin-mini-delete>Delete</button>' : '<span></span>'}<button class="btn primary" type="button" data-fin-mini-save>Save scenario</button></div>`);
  $('[data-fin-mini-save]')?.addEventListener('click', () => {
    const name = String($('#finMiniScenarioName')?.value || '').trim(), upfront = $('#finMiniScenarioUpfront')?.value || '', monthly = $('#finMiniScenarioMonthly')?.value || '0';
    if (!name) return toast('Add what you want to test', 'warn');
    if (upfront === '' || !Number.isFinite(Number(upfront.replace(',', '.')))) return toast('Enter a valid purchase price', 'warn');
    if (monthly !== '' && !Number.isFinite(Number(monthly.replace(',', '.')))) return toast('Enter a valid monthly cost', 'warn');
    const next = profile(), row = { id: item?.id || uid(), name, upfront: n(upfront), monthly: n(monthly) }; if (index >= 0) next.scenarios[index] = row; else next.scenarios.push(row); saveProfile(next, 'Scenario saved');
  });
  $('[data-fin-mini-delete]')?.addEventListener('click', () => { const next = profile(); next.scenarios.splice(index, 1); saveProfile(next, 'Scenario removed'); });
}

function financeLogCategories(rec) {
  const tones = new Set();
  recurringConfig().expenses.forEach((item)=>tones.add(groupTone(item.group)));
  (rec?.expenses || []).forEach((item)=>tones.add(groupTone(item.group)));
  manualGroups().forEach((group)=>tones.add(group.tone));
  return [
    { key:'income', label:'Income', tone:'income', icon:financeMonthToneIcon('income', 'income') },
    ...categoryOrder().filter((tone)=>tones.has(tone)).map((tone)=>({
      key:tone,
      label:categoryLabel(tone),
      tone,
      icon:financeMonthToneIcon(tone),
    })),
  ];
}
function financeRecurringItemsForCategory(category) {
  const config = recurringConfig();
  if (category === 'income') {
    return (config.incomes || []).map((item)=>({
      id:item.id || item.name,
      name:String(item.name || ''),
      amount:item.amount,
      day:normalizeRecurringDay(item.day),
      group:'',
      tone:'income',
    })).filter((item)=>item.name);
  }
  if (!category || category === 'other') return [];
  return (config.expenses || []).filter((item)=>groupTone(item.group)===category).map((item)=>({
    id:item.id || item.name,
    name:String(item.name || ''),
    amount:item.amount,
    day:normalizeRecurringDay(item.day),
    group:normalizeGroup(item.group),
    tone:category,
  })).filter((item)=>item.name);
}

function financeGroupForTone(tone, name = '') {
  const lower = String(name || '').trim().toLowerCase();
  if (tone === 'fixed') return 'fixed';
  if (tone === 'medical') return 'medical';
  if (tone === 'subscriptions') return 'subscriptions';
  if (tone === 'budgets') {
    if (lower === 'extra') return 'extra';
    if (lower.includes('grocer')) return 'groceries';
    return 'variable';
  }
  if (tone === 'wealth') return lower.includes('invest') ? 'investments' : 'savings';
  return 'other';
}
function setFinanceMonthPageLock(locked) {
  const body=document.body;
  const html=document.documentElement;
  if(locked){
    if(financeMonthPageLock)return;
    const scrollY=window.scrollY||html.scrollTop||body.scrollTop||0;
    financeMonthPageLock={scrollY,bodyTop:body.style.top,htmlScrollBehavior:html.style.scrollBehavior};
    body.style.top='-'+scrollY+'px';
    html.classList.add('finance-month-page-locked');
    body.classList.add('finance-month-page-locked');
    return;
  }
  const lock=financeMonthPageLock;
  html.classList.remove('finance-month-page-locked');
  body.classList.remove('finance-month-page-locked');
  if(!lock)return;
  body.style.top=lock.bodyTop;
  financeMonthPageLock=null;
  html.style.scrollBehavior='auto';
  window.scrollTo(0,lock.scrollY);
  html.style.scrollBehavior=lock.htmlScrollBehavior;
}

function closeFinanceTransactionSheet() {
  document.querySelector('.finance-log-layer')?.remove();

  if(financeLogBackgroundLock){
    const {shell,scrollTop,controller}=financeLogBackgroundLock;
    controller?.abort();
    if(shell?.isConnected){
      shell.style.removeProperty('overflow');
      shell.style.removeProperty('overflow-y');
      shell.style.removeProperty('touch-action');
      shell.scrollTop=scrollTop;
    }
    financeLogBackgroundLock=null;
  }

  financeMonthDialog?.classList.remove('finance-log-background-locked');
  document.documentElement.classList.remove('finance-log-locked');
  document.body.classList.remove('finance-log-locked');
  document.body.classList.remove('tv2-locked');
  document.body.classList.remove('trip-expense-open');
}
async function saveDirectMonthRecord(rec, message = 'Transaction saved', options = {}) {
  if (!rec || rec.finalized === true) throw new Error('This month is final and locked');
  const next = cloneRecord(rec);
  next.finalized = false;
  next.finalizedAt = '';
  const result = await post('saveFinanceMonth',{monthData:next});
  if (result?.financeProfile) financeState.financeProfiles[actor()] = normalizeProfile(result.financeProfile);
  const list = financeState.finances[actor()] || [];
  const idx = list.findIndex((item)=>item.month===next.month);
  const saved = normalizeFinanceRecord({...next,updatedAt:new Date().toISOString(),updatedBy:actor()},actor());
  if (idx >= 0) list[idx]=saved; else list.push(saved);
  list.sort((a,b)=>String(a.month).localeCompare(String(b.month)));
  selectedMonth=saved.month;
  renderPage();
  if(options.openDetail!==false) renderDetail(saved);
  publishFinanceNotifications();
  toast(message);
  setTimeout(loadState,800);
}
function openFinanceTransactionSheet(rec, edit = null) {
  if (!rec || rec.finalized) return;
  closeFinanceTransactionSheet();

  const categories=financeLogCategories(rec);
  const editingKind=edit?.kind==='income'?'income':edit?.kind==='expense'?'expense':'';
  const editingIndex=Number.isInteger(edit?.index)?edit.index:-1;
  const editingItem=editingKind==='income'
    ? (rec.incomes||[])[editingIndex]
    : editingKind==='expense'
      ? (rec.expenses||[])[editingIndex]
      : null;
  const editingCategory=editingKind==='income'?'income':editingItem?groupTone(editingItem.group):'';

  const state={
    amountText:editingItem?String(n(editingItem.amount)):'',
    category:editingCategory,
    selectedItemId:editingItem?'__editing__':'',
    name:editingItem?String(editingItem.name||''):'',
    group:editingKind==='expense'?normalizeGroup(editingItem?.group):'',
    date:editingItem?normalizeFinanceDate(editingItem.date,rec.month):'',
    more:!!editingItem,
    busy:false,
    error:'',
    mounted:false,
  };

  const amount=()=>Number(String(state.amountText||'').replace(',','.'));
  const validAmount=()=>Number.isFinite(amount())&&amount()>0;
  const selectedCategory=()=>categories.find((item)=>item.key===state.category)||null;
  const selectedItems=()=>financeRecurringItemsForCategory(state.category);
  const isOther=()=>state.category==='other';
  const hasChosenItem=()=>!!state.selectedItemId || isOther();
  const canSave=()=>validAmount()&&!!state.category&&hasChosenItem()&&!!state.name.trim();

  const layer=document.createElement('dialog');
  layer.className='tv2-layer finance-log-layer finance-log-host';
  layer.setAttribute('aria-label','Log finance');
  layer.innerHTML='<div class="tv2-backdrop" data-fin-log-close></div><div class="tv2-sheet finance-log-sheet" role="document"></div>';
  document.body.appendChild(layer);
  layer.showModal();
  document.documentElement.classList.add('finance-log-locked');
  document.body.classList.add('finance-log-locked');
  document.body.classList.add('tv2-locked');
  document.body.classList.add('trip-expense-open');
  financeMonthDialog?.classList.add('finance-log-background-locked');
  const sheet=layer.querySelector('.finance-log-sheet');

  // Freeze the actual month scroller at its current position while Log finance is open.
  const backgroundShell=financeMonthDialog?.querySelector('.overview-trip-shell')||null;
  if(backgroundShell){
    const controller=new AbortController();
    const frozenTop=backgroundShell.scrollTop;
    financeLogBackgroundLock={shell:backgroundShell,scrollTop:frozenTop,controller};
    backgroundShell.style.setProperty('overflow','hidden','important');
    backgroundShell.style.setProperty('overflow-y','hidden','important');
    backgroundShell.style.setProperty('touch-action','none','important');
    const hold=()=>{
      if(Math.abs(backgroundShell.scrollTop-frozenTop)>.5) backgroundShell.scrollTop=frozenTop;
    };
    backgroundShell.addEventListener('scroll',hold,{passive:true,signal:controller.signal});
    backgroundShell.addEventListener('touchmove',(event)=>event.preventDefault(),{passive:false,signal:controller.signal});
    backgroundShell.addEventListener('wheel',(event)=>event.preventDefault(),{passive:false,signal:controller.signal});
    hold();
  }

  // Stop scroll chaining on mobile: the sheet may scroll, but never the page behind it.
  let financeLogTouchY=null;
  layer.addEventListener('touchstart',(event)=>{
    if(event.touches.length===1) financeLogTouchY=event.touches[0].clientY;
  },{passive:true});
  layer.addEventListener('touchmove',(event)=>{
    const targetSheet=event.target.closest('.finance-log-sheet');
    if(!targetSheet){
      event.preventDefault();
      return;
    }
    if(event.touches.length!==1||financeLogTouchY==null)return;
    const y=event.touches[0].clientY;
    const dy=y-financeLogTouchY;
    financeLogTouchY=y;
    const atTop=targetSheet.scrollTop<=0;
    const atBottom=Math.ceil(targetSheet.scrollTop+targetSheet.clientHeight)>=targetSheet.scrollHeight;
    if((atTop&&dy>0)||(atBottom&&dy<0)) event.preventDefault();
  },{passive:false});
  layer.addEventListener('touchend',()=>{financeLogTouchY=null;},{passive:true});
  layer.addEventListener('touchcancel',()=>{financeLogTouchY=null;},{passive:true});
  layer.addEventListener('wheel',(event)=>{
    const targetSheet=event.target.closest('.finance-log-sheet');
    if(!targetSheet){
      event.preventDefault();
      return;
    }
    const atTop=targetSheet.scrollTop<=0;
    const atBottom=Math.ceil(targetSheet.scrollTop+targetSheet.clientHeight)>=targetSheet.scrollHeight;
    if((atTop&&event.deltaY<0)||(atBottom&&event.deltaY>0)) event.preventDefault();
  },{passive:false});

  function resetToCategories() {
    state.category='';
    state.selectedItemId='';
    state.name='';
    state.group='';
    state.date='';
    state.more=false;
    state.error='';
  }

  function categoryTile(item,selected=false) {
    return '<button type="button" class="tv2-cat finance-log-category finance-tv2-tone-'+item.tone+' '+(selected?'on':'')+'" data-fin-log-cat="'+item.key+'" aria-pressed="'+(selected?'true':'false')+'"><span aria-hidden="true">'+item.icon+'</span>'+esc(item.label)+'</button>';
  }

  function itemTile(item,index,category) {
    const selected=state.selectedItemId===String(item.id);
    return '<button type="button" class="tv2-cat finance-log-item finance-tv2-tone-'+category.tone+' '+(selected?'on':'')+'" data-fin-log-item="'+index+'" aria-pressed="'+(selected?'true':'false')+'"><span aria-hidden="true">'+category.icon+'</span>'+esc(item.name)+'</button>';
  }

  function title() {
    return editingItem?'Edit finance':'Log finance';
  }

  function dateSummary() {
    return state.date ? 'Date · '+financeDateLabel(state.date) : 'Select date';
  }

  function hintText() {
    if (state.error) return state.error;
    if (state.amountText&&!validAmount()) return 'That amount doesn’t look right';
    if (!validAmount()) return 'Enter the amount';
    if (!state.category) return 'Pick a category';
    if (!hasChosenItem()) return 'Pick an item';
    if (!state.name.trim()) return 'Add a name';
    return '';
  }

  function render() {
    const category=selectedCategory();
    const items=selectedItems();
    const drillDown=!!category;
    const bounds=financeDateBounds(rec.month);
    const tone=category?.tone||'';
    sheet.className='tv2-sheet finance-log-sheet'+(tone?' finance-log-sheet-tone-'+tone:'');
    const tiles=!drillDown
      ? categories.map((item)=>categoryTile(item,false)).join('')
      : categoryTile(category,true)+items.map((item,index)=>itemTile(item,index,category)).join('');

    sheet.innerHTML=tripSheetHtml({
      title:title(),
      closeAttr:'data-fin-log-close',
      amountId:'financeLogAmount',
      amountValue:state.amountText,
      categoriesHtml:tiles,
      categoriesClass:'finance-log-categories '+(drillDown?'is-drilled':''),
      categoriesLabel:drillDown?'Items':'Category',
      afterCategoriesHtml:isOther()
        ? '<label class="tv2-field finance-log-name"><span>Expense name</span><input id="financeLogName" maxlength="100" placeholder="e.g. Gift, clothes, one-off purchase" value="'+esc(state.name)+'"></label>'
        : '',
      defaultsHtml:'<button type="button" class="tv2-defaults" data-fin-log-more aria-expanded="'+(state.more?'true':'false')+'"><span class="tv2-summary">'+esc(dateSummary())+'</span><span class="tv2-chev" aria-hidden="true">'+(state.more?'⌃':'⌄')+'</span></button>',
      moreHtml:'<div class="tv2-more" '+(state.more?'':'hidden')+'><label class="tv2-field"><span>Date</span><input id="financeLogDate" type="date" min="'+bounds.min+'" max="'+bounds.max+'" value="'+esc(state.date)+'"></label></div>',
      hintAttr:'data-fin-log-hint',
      hintClass:state.error?'is-error':'',
      saveAttr:'data-fin-log-save',
      saveLabel:state.busy?'Saving…':editingItem?'Save changes':'Save',
      saveDisabled:!canSave()||state.busy,
    });

    const amountInput=sheet.querySelector('#financeLogAmount');
    amountInput?.addEventListener('input',()=>{
      state.amountText=amountInput.value;
      state.error='';
      refreshLive();
    });
    amountInput?.addEventListener('keydown',(event)=>{
      if(event.key==='Enter'){
        event.preventDefault();
        if(canSave()) sheet.querySelector('[data-fin-log-save]')?.click();
      }
    });
    sheet.querySelector('#financeLogName')?.addEventListener('input',(event)=>{
      state.name=event.target.value;
      state.error='';
      refreshLive();
    });
    sheet.querySelector('#financeLogDate')?.addEventListener('change',(event)=>{
      state.date=normalizeFinanceDate(event.target.value,rec.month);
      refreshLive();
    });

    refreshLive();
    if(!state.mounted){
      state.mounted=true;
      setTimeout(()=>amountInput?.focus(),0);
    }
  }

  function refreshLive() {
    const hint=sheet.querySelector('[data-fin-log-hint]');
    if(hint){
      hint.textContent=hintText();
      hint.classList.toggle('is-error',!!state.error || (!!state.amountText&&!validAmount()));
    }
    const save=sheet.querySelector('[data-fin-log-save]');
    if(save){
      save.disabled=!canSave()||state.busy;
      save.textContent=state.busy?'Saving…':editingItem?'Save changes':'Save';
    }
    const summary=sheet.querySelector('.tv2-summary');
    if(summary) summary.textContent=dateSummary();
  }

  layer.addEventListener('click',async(event)=>{
    const button=event.target.closest('button');
    if(!button) return;

    if(button.hasAttribute('data-fin-log-close')){
      closeFinanceTransactionSheet();
      return;
    }

    if(button.dataset.finLogCat){
      const clicked=button.dataset.finLogCat;
      if(state.category===clicked){
        resetToCategories();
        render();
        return;
      }
      state.category=clicked;
      state.selectedItemId='';
      state.name='';
      state.group=clicked==='other'?'other':'';
      state.date='';
      state.more=false;
      state.error='';
      render();
      return;
    }

    if(button.dataset.finLogItem!=null){
      const items=selectedItems();
      const item=items[Number(button.dataset.finLogItem)];
      if(!item) return;
      state.selectedItemId=String(item.id);
      state.name=item.name;
      state.group=state.category==='income'?'':(item.group||financeGroupForTone(state.category,item.name));
      state.amountText=hasValue(item.amount)?String(n(item.amount)):'';
      state.date=financeDateForDay(rec.month,item.day);
      state.more=false;
      state.error='';
      render();
      setTimeout(()=>{
        const input=sheet.querySelector('#financeLogAmount');
        input?.focus();
        input?.select?.();
      },0);
      return;
    }

    if(button.hasAttribute('data-fin-log-more')){
      state.more=!state.more;
      render();
      return;
    }

    if(button.hasAttribute('data-fin-log-save')){
      if(!canSave()||state.busy) return;
      state.busy=true;
      state.error='';
      refreshLive();

      const next=cloneRecord(rec);
      next.incomes=[...(next.incomes||[])];
      next.expenses=[...(next.expenses||[])];
      let investmentLogged=false;

      if(state.category==='income'){
        const row={name:state.name.trim(),amount:amount(),date:state.date};
        if(editingKind==='income'&&editingIndex>=0) next.incomes[editingIndex]=row;
        else {
          if(editingKind==='expense'&&editingIndex>=0) next.expenses.splice(editingIndex,1);
          next.incomes.push(row);
        }
      } else {
        const row={group:state.group||financeGroupForTone(state.category,state.name),name:state.name.trim(),amount:amount(),date:state.date};
        investmentLogged=normalizeGroup(row.group)==='investments';
        if(editingKind==='expense'&&editingIndex>=0) next.expenses[editingIndex]=row;
        else {
          if(editingKind==='income'&&editingIndex>=0) next.incomes.splice(editingIndex,1);
          next.expenses.push(row);
        }
      }

      if(!recordFor(rec.month)) next.partialOnly=true;
      try {
        closeFinanceTransactionSheet();
        await saveDirectMonthRecord(next,editingItem?'Finance updated':state.category==='income'?'Income added':'Expense added');
        if(investmentLogged)await queueInvestmentSnapshotReminder(next.month,state.date);
      } catch(error) {
        state.busy=false;
        state.error=error?.message||'Could not save this item.';
        if(!layer.isConnected) document.body.appendChild(layer);
        if(!layer.open) layer.showModal();
        document.documentElement.classList.add('finance-log-locked');
        document.body.classList.add('finance-log-locked');
        document.body.classList.add('tv2-locked');
        document.body.classList.add('trip-expense-open');
        financeMonthDialog?.classList.add('finance-log-background-locked');
        if(financeLogBackgroundLock?.shell?.isConnected){
          financeLogBackgroundLock.shell.scrollTop=financeLogBackgroundLock.scrollTop;
        }
        render();
      }
    }
  });

  layer.querySelector('.tv2-backdrop')?.addEventListener('click',closeFinanceTransactionSheet);
  layer.addEventListener('keydown',(event)=>{
    if(event.key==='Escape') closeFinanceTransactionSheet();
  });

  render();
}


function financeMonthToneIcon(tone, kind = 'expense') {
  if (kind === 'income') return '💶';
  if (tone === 'budgets' && actor() === 'Principe') return '🛒';
  return { fixed:'🏠', medical:'🩺', subscriptions:'🔁', budgets:'💰', wealth:'🏦', other:'🏷️' }[tone] || '🏷️';
}

function financeMonthDayLabel(value) {
  if (!value) return 'No date';
  const safe=normalizeFinanceDate(value);
  if (!safe) return 'No date';
  const [year,month,day]=safe.split('-').map(Number);
  const date=new Date(Date.UTC(year,month-1,day));
  return new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short'}).format(date);
}
function financeMonthTimeline(rec) {
  const locked=rec?.finalized===true;
  const rows=(rec.incomes||[]).map((item,index)=>({
    kind:'income',date:item.date||'',item,index,tone:'income',
  })).concat((rec.expenses||[]).map((item,index)=>({
    kind:'expense',date:item.date||'',item,index,tone:groupTone(item.group),
  })));
  extraSpendSummary({extraSpends:rec.extraSpends||[]}).forEach((item,index)=>{
    const savedUpOnly=actor()==='Principe'&&item.source==='savings';
    rows.push({
      kind:'summary',
      date:'',
      item:{name:extraSourceLabel(item.source),amount:item.amount,group:savedUpOnly?'savings':'extra'},
      index:1000+index,
      tone:savedUpOnly?'wealth':'budgets',
    });
  });
  rows.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')) || a.kind.localeCompare(b.kind));

  const grouped=new Map();
  rows.forEach((row)=>{const key=row.date||'';if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);});
  const groups=[...grouped.entries()].map(([date,items])=>({label:financeMonthDayLabel(date),items}));

  return tripTimelineHtml(groups,{
    emptyText:'No finances yet. Add them as they happen, it takes a few seconds.',
    rowHtml:(row)=>{
      const item=row.item;
      const income=row.kind==='income';
      const tone=income?'income':row.tone;
      const meta=income?'Income':categoryLabel(tone);
      const editable=row.kind!=='summary'&&!locked;
      const rowHtml=tripExpenseRowHtml({
        attr:editable?'data-fin-entry-kind="'+row.kind+'" data-fin-entry-index="'+row.index+'"':'',
        disabled:!editable,
        icon:financeMonthToneIcon(tone,income?'income':'expense'),
        iconClass:'finance-tv2-tone-'+tone,
        title:item.name||(income?'Income':groupLabel(item.group)),
        meta,
        amount:money(item.amount),
        amountClass:income?'finance-tv2-income-amt':'',
      });
      if(!editable) return rowHtml;
      return '<div class="finance-month-swipe-row" data-fin-entry-kind="'+row.kind+'" data-fin-entry-index="'+row.index+'">'+
        '<div class="finance-month-delete-reveal" aria-hidden="true"><b>Delete</b></div>'+
        rowHtml+
      '</div>';
    },
  });
}

function resetFinanceMonthSwipeVisual(row, animate = true) {
  if (!row) return;
  const card=row.querySelector('.overview-trip-expense');
  const remove=row.querySelector('.finance-month-delete-reveal');
  if(remove){
    remove.style.transition=animate?'width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease':'none';
    remove.style.width='0px';
    remove.style.opacity='0';
  }
  if(card){
    card.style.transition=animate?'transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease':'none';
    card.style.transform='translateX(0)';
    card.style.opacity='1';
  }
  if(animate)setTimeout(()=>{[card,remove].forEach((el)=>{if(el?.isConnected)el.style.transition='';});},220);
}

function closeFinanceMonthSwipeRows(except = null) {
  financeMonthDialog?.querySelectorAll('.finance-month-swipe-row').forEach((row)=>{
    if(row!==except) resetFinanceMonthSwipeVisual(row,true);
  });
}

function closeFinanceMonthDeleteConfirm() {
  financeMonthDeleteConfirmLayer?.remove();
  financeMonthDeleteConfirmLayer=null;
}

function openFinanceMonthDeleteConfirm(rec, kind, index) {
  if (!rec || rec.finalized === true) return;
  closeFinanceMonthDeleteConfirm();
  const list=kind==='income'?(rec.incomes||[]):(rec.expenses||[]);
  const item=list[index];
  if(!item)return;

  financeMonthDeleteConfirmLayer=document.createElement('dialog');
  financeMonthDeleteConfirmLayer.className='finance-month-delete-confirm-host';
  financeMonthDeleteConfirmLayer.setAttribute('aria-label','Delete finance');
  financeMonthDeleteConfirmLayer.innerHTML=
    '<div class="tv2-confirm-layer">'+
      '<div class="tv2-confirm-backdrop" data-fin-month-confirm-cancel></div>'+
      '<div class="tv2-confirm-card" role="document" aria-labelledby="finMonthDeleteTitle">'+
        '<h2 id="finMonthDeleteTitle">Delete finance?</h2>'+
        '<p>Are you sure you want to delete <strong>'+esc(item.name||(kind==='income'?'Income':groupLabel(item.group)))+'</strong> · '+money(item.amount)+'?</p>'+
        '<p class="tv2-confirm-note">This removes it from '+esc(monthLabel(rec.month))+'.</p>'+
        '<p class="tv2-confirm-error" aria-live="polite"></p>'+
        '<div class="tv2-confirm-actions"><button type="button" data-fin-month-confirm-cancel>Cancel</button><button type="button" class="is-delete" data-fin-month-confirm-delete>Delete</button></div>'+
      '</div>'+
    '</div>';
  document.body.appendChild(financeMonthDeleteConfirmLayer);
  financeMonthDeleteConfirmLayer.showModal();

  const cancel=()=>{closeFinanceMonthDeleteConfirm();closeFinanceMonthSwipeRows();};
  financeMonthDeleteConfirmLayer.querySelectorAll('[data-fin-month-confirm-cancel]').forEach((button)=>button.addEventListener('click',cancel));
  financeMonthDeleteConfirmLayer.addEventListener('cancel',(event)=>{event.preventDefault();cancel();});
  financeMonthDeleteConfirmLayer.addEventListener('keydown',(event)=>{if(event.key==='Escape'){event.preventDefault();cancel();}});

  const deleteButton=financeMonthDeleteConfirmLayer.querySelector('[data-fin-month-confirm-delete]');
  deleteButton.addEventListener('click',async()=>{
    deleteButton.disabled=true;
    deleteButton.textContent='Deleting…';
    const error=financeMonthDeleteConfirmLayer.querySelector('.tv2-confirm-error');
    error.textContent='';
    try{
      const next=cloneRecord(rec);
      next.incomes=[...(next.incomes||[])];
      next.expenses=[...(next.expenses||[])];
      const target=kind==='income'?next.incomes:next.expenses;
      if(!target[index]) throw new Error('This finance item no longer exists');
      target.splice(index,1);
      closeFinanceMonthDeleteConfirm();
      closeFinanceMonthSwipeRows();
      await saveDirectMonthRecord(next,'Finance deleted');
    }catch(err){
      deleteButton.disabled=false;
      deleteButton.textContent='Delete';
      error.textContent=err?.message||'Could not delete this finance item';
    }
  });
  setTimeout(()=>deleteButton.focus(),0);
}

function bindFinanceMonthSwipe(rec) {
  financeMonthSwipeAbort?.abort();
  const controller=new AbortController();
  financeMonthSwipeAbort=controller;
  const signal=controller.signal;
  const root=financeMonthDialog;
  if(!root)return;

  const mobile=()=>window.matchMedia?.('(max-width:760px)')?.matches??window.innerWidth<=760;

  // Same Trips-style row delete: only right-to-left.
  let rowSwipe={tracking:false,active:false,startX:0,startY:0,lastX:0,row:null};
  const resetRowState=()=>{rowSwipe={tracking:false,active:false,startX:0,startY:0,lastX:0,row:null};};

  // Same Trips page-back gestures: left edge -> right, or top -> down.
  let pageSwipe={tracking:false,active:false,mode:'',startX:0,startY:0,lastX:0,lastY:0};
  const resetPageState=()=>{pageSwipe={tracking:false,active:false,mode:'',startX:0,startY:0,lastX:0,lastY:0};};

  const clearPageVisual=(animate=true)=>{
    if(!root?.isConnected){resetPageState();return;}
    root.style.transition=animate?'transform .2s cubic-bezier(.22,.8,.28,1), opacity .18s ease':'none';
    root.style.removeProperty('transform');
    root.style.opacity='1';
    if(animate)setTimeout(()=>{
      if(!root?.isConnected)return;
      root.style.transition='';
      root.style.removeProperty('opacity');
    },220);
  };

  const finishBack=(mode)=>{
    if(!root?.isConnected){resetPageState();return;}
    root.style.transition='transform .22s cubic-bezier(.22,.8,.28,1), opacity .18s ease';
    const target=mode==='right'
      ? 'translate(calc(-50% + 100vw),-50%)'
      : 'translate(-50%,calc(-50% + 100dvh))';
    root.style.setProperty('transform',target,'important');
    root.style.opacity='.7';
    resetPageState();
    resetRowState();
    setTimeout(()=>closeFinanceMonthDialog(),185);
  };

  const paintDelete=(row,distance)=>{
    const card=row.querySelector('.overview-trip-expense');
    const remove=row.querySelector('.finance-month-delete-reveal');
    if(!card||!remove)return;
    const exposed=Math.abs(distance);
    card.style.transition='none';
    card.style.transform='translateX('+distance+'px)';
    remove.style.transition='none';
    remove.style.width=exposed+'px';
    remove.style.opacity=String(Math.min(1,.35+exposed/120));
  };

  const finishDelete=(row)=>{
    const card=row.querySelector('.overview-trip-expense');
    const remove=row.querySelector('.finance-month-delete-reveal');
    const width=row.getBoundingClientRect().width||window.innerWidth-32;
    if(card){
      card.style.transition='transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      card.style.transform='translateX(-'+width+'px)';
      card.style.opacity='.76';
    }
    if(remove){
      remove.style.transition='width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      remove.style.width=width+'px';
      remove.style.opacity='1';
    }
  };

  root.addEventListener('touchstart',(event)=>{
    if(!mobile()||financeMonthDeleteConfirmLayer||event.touches.length!==1)return;
    const touch=event.touches[0];
    const scrollRoot=root.querySelector('.overview-trip-shell')||root;
    const canRight=touch.clientX<=46;
    const canDown=scrollRoot.scrollTop<=1;
    const row=event.target.closest('.finance-month-swipe-row');

    if(canRight||canDown){
      closeFinanceMonthSwipeRows();
      pageSwipe={
        tracking:true,active:false,mode:canRight?'right':'down',
        startX:touch.clientX,startY:touch.clientY,lastX:touch.clientX,lastY:touch.clientY
      };
    }

    if(row){
      closeFinanceMonthSwipeRows(row);
      resetFinanceMonthSwipeVisual(row,false);
      rowSwipe={tracking:true,active:false,startX:touch.clientX,startY:touch.clientY,lastX:touch.clientX,row};
    }else{
      resetRowState();
    }
  },{passive:true,signal});

  root.addEventListener('touchmove',(event)=>{
    if(!mobile()||event.touches.length!==1)return;
    const touch=event.touches[0];

    if(pageSwipe.tracking){
      const dx=touch.clientX-pageSwipe.startX;
      const dy=touch.clientY-pageSwipe.startY;
      const ax=Math.abs(dx),ay=Math.abs(dy);
      pageSwipe.lastX=touch.clientX;
      pageSwipe.lastY=touch.clientY;

      if(!pageSwipe.active){
        if(ax<9&&ay<9)return;
        if(pageSwipe.mode==='right'){
          if(dx>10&&ax>ay*1.25)pageSwipe.active=true;
          else if(ay>=ax||dx<0)resetPageState();
        }else{
          const scrollRoot=root.querySelector('.overview-trip-shell')||root;
          if(dy>10&&ay>ax*1.15&&scrollRoot.scrollTop<=1)pageSwipe.active=true;
          else if(ax>=ay||dy<0)resetPageState();
        }
      }
      if(pageSwipe.active){
        event.preventDefault();
        root.style.transition='none';
        if(pageSwipe.mode==='right'){
          const distance=Math.max(0,Math.min(dx,window.innerWidth*.78));
          root.style.setProperty('transform','translate(calc(-50% + '+distance+'px),-50%)','important');
          root.style.opacity=String(Math.max(.82,1-distance/(window.innerWidth*2.5)));
        }else{
          const distance=Math.max(0,Math.min(dy,window.innerHeight*.62));
          root.style.setProperty('transform','translate(-50%,calc(-50% + '+distance+'px))','important');
          root.style.opacity=String(Math.max(.82,1-distance/(window.innerHeight*2.2)));
        }
        resetRowState();
        return;
      }
    }

    if(!rowSwipe.tracking||!rowSwipe.row)return;
    const dx=touch.clientX-rowSwipe.startX,dy=Math.abs(touch.clientY-rowSwipe.startY);
    rowSwipe.lastX=touch.clientX;
    if(!rowSwipe.active){
      if(Math.abs(dx)<8&&dy<8)return;
      if(dx<-10&&Math.abs(dx)>dy*1.2)rowSwipe.active=true;
      else if(dy>=Math.abs(dx)||dx>0){resetFinanceMonthSwipeVisual(rowSwipe.row,true);resetRowState();return;}
    }
    if(!rowSwipe.active)return;
    event.preventDefault();
    const width=rowSwipe.row.getBoundingClientRect().width||window.innerWidth-32;
    const distance=Math.min(0,Math.max(-width*.94,dx));
    paintDelete(rowSwipe.row,distance);
  },{passive:false,signal});

  root.addEventListener('touchend',()=>{
    if(pageSwipe.tracking){
      const mode=pageSwipe.mode;
      const dx=pageSwipe.lastX-pageSwipe.startX;
      const dy=pageSwipe.lastY-pageSwipe.startY;
      const goBack=pageSwipe.active&&(
        (mode==='right'&&dx>=Math.min(92,window.innerWidth*.24))||
        (mode==='down'&&dy>=Math.min(110,window.innerHeight*.16))
      );
      if(goBack)finishBack(mode);
      else{resetPageState();clearPageVisual(true);}
      return;
    }

    if(!rowSwipe.tracking||!rowSwipe.row){resetRowState();return;}
    const row=rowSwipe.row,dx=rowSwipe.lastX-rowSwipe.startX;
    const width=row.getBoundingClientRect().width||window.innerWidth-32;
    const fullSwipe=rowSwipe.active&&-dx>=Math.max(180,width*.62);
    if(!fullSwipe){
      resetFinanceMonthSwipeVisual(row,true);
      resetRowState();
      return;
    }

    financeMonthSwipeIgnoreUntil=Date.now()+550;
    const kind=row.dataset.finEntryKind,index=Number(row.dataset.finEntryIndex);
    finishDelete(row);
    resetRowState();
    setTimeout(()=>{
      resetFinanceMonthSwipeVisual(row,false);
      openFinanceMonthDeleteConfirm(rec,kind,index);
    },180);
  },{passive:true,signal});

  root.addEventListener('touchcancel',()=>{
    if(pageSwipe.tracking||pageSwipe.active){
      resetPageState();
      clearPageVisual(true);
    }
    resetFinanceMonthSwipeVisual(rowSwipe.row,true);
    resetRowState();
  },{passive:true,signal});
}


function closeFinanceMonthDialog() {
  financeMonthSwipeAbort?.abort();
  financeMonthSwipeAbort=null;
  closeFinanceMonthDeleteConfirm();
  if(document.querySelector('.finance-log-layer'))closeFinanceTransactionSheet();
  financeMonthDialog?.remove();
  financeMonthDialog=null;
  setFinanceMonthPageLock(false);
}

function renderDetail(rec) {
  if (!rec) return;
  const legacyRoot=$('#financeDetail');
  if (legacyRoot) legacyRoot.innerHTML='';
  closeFinanceMonthDialog();
  if ($('#financeMiniModal')?.classList.contains('is-month-detail')) closeMini();

  const rules=financeRules();
  const totals=calc(rec), carry=extraCarryInfo(rec.month);
  const over=totals.leftover<0;
  const progress=totals.income>0?Math.min(100,Math.max(0,(totals.outflow/totals.income)*100)):null;
  const stored=recordFor(rec.month);
  const status=rec.finalized?'Locked':stored?'Draft':'Not logged';
  const year=String(rec.month||'').slice(0,4)||String(financeViewYear);
  const right=stored&&!rec.finalized
    ? {attr:'data-fin-finalize-existing',label:'Confirm'}
    : null;
  const notes=[];
  if(rules.extraTracking&&totals.extraOver>0){
    notes.push('<div class="overview-trip-balance is-debtor finance-month-note"><span>Extra budget exceeded · '+money(totals.extraOver)+' over</span></div>');
  }
  if(rules.extraTracking&&carry.debt>0){
    notes.push('<div class="overview-trip-balance is-debtor finance-month-note"><span>'+money(carry.debt)+' extra carried from '+esc(monthLabel(carry.prevMonth))+'</span></div>');
  }

  financeMonthDialog=document.createElement('dialog');
  financeMonthDialog.className='current-overview current-overview-trip finance-month-overview';
  financeMonthDialog.innerHTML=tripDetailShellHtml({
    back:{attr:'data-fin-month-close',label:'‹ '+year},
    right,
    title:monthLabel(rec.month),
    subtitle:actor()+' · '+status,
    moneyHtml:tripDetailMoneyHtml({
      first:{label:'Total income',value:money(totals.income)},
      second:{label:'Total outflow',value:money(totals.outflow)},
      progress,
      summary:{value:money(Math.abs(totals.leftover)),label:over?'overspent':'leftover',over},
    }),
    middleHtml:notes.join(''),
    listHtml:financeMonthTimeline(rec),
    dock:rec.finalized?null:{attr:'data-fin-add-transaction',label:'＋ Log finance'},
  });

  document.body.appendChild(financeMonthDialog);
  setFinanceMonthPageLock(true);
  financeMonthDialog.showModal();
  financeMonthDialog.addEventListener('cancel',(event)=>{event.preventDefault();closeFinanceMonthDialog();});
  financeMonthDialog.querySelector('[data-fin-month-close]')?.addEventListener('click',closeFinanceMonthDialog);
  financeMonthDialog.querySelector('[data-fin-add-transaction]')?.addEventListener('click',()=>openFinanceTransactionSheet(rec));
  financeMonthDialog.querySelector('[data-fin-finalize-existing]')?.addEventListener('click',()=>confirmExistingMonth(rec));
  bindFinanceMonthSwipe(rec);
  financeMonthDialog.querySelectorAll('[data-fin-entry-kind]').forEach((button)=>{
    button.addEventListener('click',(event)=>{
      if(Date.now()<financeMonthSwipeIgnoreUntil){event.preventDefault();return;}
      openFinanceTransactionSheet(rec,{
        kind:button.dataset.finEntryKind,
        index:Number(button.dataset.finEntryIndex),
      });
    });
  });
}


function ensureMiniModal() {
  if ($('#financeMiniModal')) return;
  const modal = document.createElement('div');
  modal.id = 'financeMiniModal'; modal.className = 'finance-mini-modal'; modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = '<div class="finance-mini-backdrop" data-fin-mini-close></div><div class="finance-mini-card"><button class="finance-mini-close" type="button" data-fin-mini-close>×</button><div id="financeMiniBody"></div></div>';
  document.body.appendChild(modal);
  $$('[data-fin-mini-close]', modal).forEach((el) => el.addEventListener('click', closeMini));
}
function showMini(html, mode = '', nav = {}) {
  ensureMiniModal();
  const modal = $('#financeMiniModal');
  modal._twogetherBack = typeof nav.back === 'function' ? nav.back : closeMini;
  modal._twogetherHome = typeof nav.home === 'function' ? nav.home : closeMini;
  $('#financeMiniBody').innerHTML = html;
  const monthDetail = mode === 'month-detail';
  const recurringManager = mode === 'recurring-manager';
  const focused = monthDetail || recurringManager;
  modal.classList.toggle('is-month-detail', monthDetail);
  modal.classList.toggle('is-recurring-manager', recurringManager);
  document.documentElement.classList.toggle('finance-month-focus', focused);
  document.body.classList.toggle('finance-month-focus', focused);
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}
function closeMini() {
  const modal = $('#financeMiniModal');
  modal?.classList.remove('show','is-month-detail','is-recurring-manager');
  modal?.setAttribute('aria-hidden', 'true');
  document.documentElement.classList.remove('finance-month-focus');
  document.body.classList.remove('finance-month-focus');
  recurringSwipeAbort?.abort();
  recurringSwipeAbort=null;
  closeRecurringDeleteConfirm();
  if(modal){
    modal._twogetherBack=null;
    modal._twogetherHome=null;
  }
}

async function saveProfile(next, message = 'Balances updated') {
  const a = actor(); if (!a) return;
  const normalized = normalizeProfile(next);
  financeState.financeProfiles[a] = normalized;
  renderPage(); closeMini();
  try { await post('saveFinanceProfile', { profile: normalized }); toast(message); setTimeout(loadState, 1200); }
  catch (err) { toast(err.message || 'Could not save', 'warn'); }
}

function openSharedJarHistory(detail = {}) {
  const balance = n(detail.balance);
  const initialBalance = n(detail.initialBalance);
  const transactions = Array.isArray(detail.transactions) ? detail.transactions : [];
  const rows = transactions.length
    ? transactions.map((transaction) => `<div class="finance-jar-history-row"><span><strong>${esc(transaction.trip || 'Trip')}</strong><small>${esc(transaction.category || 'Stay')}${transaction.date ? ' · ' + esc(transaction.date) : ''}${transaction.actor ? ' · ' + esc(transaction.actor) : ''}</small></span><b>−${money(transaction.amount)}</b></div>`).join('')
    : '<div class="finance-current-empty">No Shared Jar transactions yet.</div>';
  showMini(`<span class="panel-kicker">SHARED JAR</span><h2>Shared Jar</h2><div class="finance-jar-summary"><span>Current balance</span><strong>${money(balance)}</strong><small>Started with ${money(initialBalance)}</small></div><div class="finance-jar-history-head"><h3>Past transactions</h3><span>${transactions.length} ${transactions.length === 1 ? 'transaction' : 'transactions'}</span></div><div class="finance-jar-history">${rows}</div><div class="finance-mini-actions"><span></span><button class="btn ghost" type="button" data-fin-jar-edit>Edit balance</button></div>`);
  $('[data-fin-jar-edit]')?.addEventListener('click', () => openSharedJarModal(balance, () => openSharedJarHistory(detail)));
}

function openSharedJarModal(balance, backAction = closeMini) {
  showMini(`<span class="panel-kicker">SHARED JAR</span><h2>Edit Shared Jar</h2><div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(n(balance)))}" placeholder="0.00"></div><div class="finance-mini-actions"><span></span><button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`, '', { back: backAction });
  $('[data-fin-mini-save]')?.addEventListener('click', async () => {
    const amount = $('#finMiniAmount')?.value || '';
    if (amount === '' || !Number.isFinite(Number(amount.replace(',', '.'))) || Number(amount.replace(',', '.')) < 0) return toast('Enter a valid balance', 'warn');
    const btn = $('[data-fin-mini-save]'); if (btn) btn.disabled = true;
    try {
      await post('updateSharedJarBalance', { balance: n(amount) });
      closeMini();
      toast('Shared Jar balance updated');
    } catch (err) {
      toast(err.message || 'Could not update Shared Jar', 'warn');
      if (btn) btn.disabled = false;
    }
  });
}

function openBankModal(index) {
  const p = profile(), item = index >= 0 ? p.bankAccounts[index] : null;
  showMini(`<span class="panel-kicker">BANK BALANCE</span><h2>${item ? 'Edit bank' : 'Add bank'}</h2><div class="finance-mini-fields"><label>Bank / account<input id="finMiniName" value="${esc(item?.name || '')}" placeholder="e.g. ING"></label><label>Current balance<div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(item?.balance ?? ''))}" placeholder="0.00"></div></label></div><div class="finance-mini-actions">${item ? '<button class="btn ghost" type="button" data-fin-mini-delete>Delete</button>' : '<span></span>'}<button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`);
  $('[data-fin-mini-save]')?.addEventListener('click', () => {
    const name = String($('#finMiniName')?.value || '').trim(), amount = $('#finMiniAmount')?.value || '';
    if (!name) return toast('Add the bank name first', 'warn'); if (amount === '' || !Number.isFinite(Number(amount.replace(',', '.')))) return toast('Enter a valid balance', 'warn');
    const next = profile(); const row = { id: item?.id || uid(), name, balance: n(amount) }; if (index >= 0) next.bankAccounts[index] = row; else next.bankAccounts.push(row); saveProfile(next, 'Bank balance saved');
  });
  $('[data-fin-mini-delete]')?.addEventListener('click', () => { const next = profile(); next.bankAccounts.splice(index, 1); saveProfile(next, 'Bank removed'); });
}

function openSavingsModal() {
  const p = profile();
  showMini(`<span class="panel-kicker">SAVED UP</span><h2>Update total savings</h2><div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(p.savingsTotal ?? ''))}" placeholder="0.00"></div><div class="finance-mini-actions"><span></span><button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`);
  $('[data-fin-mini-save]')?.addEventListener('click', () => { const amount = $('#finMiniAmount')?.value || ''; if (amount === '' || !Number.isFinite(Number(amount.replace(',', '.')))) return toast('Enter a valid savings total', 'warn'); const next = profile(); next.savingsTotal = n(amount); saveProfile(next, 'Savings total updated'); });
}

function openHoldModal(index) {
  const p = profile(), item = index >= 0 ? p.savingsReserved[index] : null;
  showMini(`<span class="panel-kicker">SAVINGS ON HOLD</span><h2>${item ? 'Edit earmarked money' : 'Add savings on hold'}</h2><div class="finance-mini-fields"><label>What is it reserved for?<input id="finMiniName" value="${esc(item?.name || '')}" placeholder="e.g. Driving licence"></label><label>Amount<div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(item?.amount ?? ''))}" placeholder="0.00"></div></label></div><div class="finance-mini-actions">${item ? '<button class="btn ghost" type="button" data-fin-mini-delete>Delete</button>' : '<span></span>'}<button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`);
  $('[data-fin-mini-save]')?.addEventListener('click', () => { const name = String($('#finMiniName')?.value || '').trim(), amount = $('#finMiniAmount')?.value || ''; if (!name) return toast('Add what this money is for', 'warn'); if (amount === '' || !Number.isFinite(Number(amount.replace(',', '.')))) return toast('Enter a valid amount', 'warn'); const next = profile(); const row = { id: item?.id || uid(), name, amount: n(amount) }; if (index >= 0) next.savingsReserved[index] = row; else next.savingsReserved.push(row); saveProfile(next, 'Savings hold saved'); });
  $('[data-fin-mini-delete]')?.addEventListener('click', () => { const next = profile(); next.savingsReserved.splice(index, 1); saveProfile(next, 'Savings hold removed'); });
}

function owedTransactionSortValue(item, index = 0) {
  const at = String(item?.at || item?.createdAt || '');
  const date = String(item?.date || '');
  const month = String(item?.month || '');
  return (at || date || month || '0000-00') + '|' + String(index).padStart(5, '0');
}

function manualLoanTransactionsHtml(item, remaining) {
  let repayments = (Array.isArray(item?.repayments) ? item.repayments : []).map((repayment, index) => ({
    repayment,
    index,
    stamp: owedTransactionSortValue(repayment, index),
  })).sort((a, b) => b.stamp.localeCompare(a.stamp));

  if (remaining <= .005 && repayments.length) repayments = repayments.slice(0, 1);
  if (!repayments.length) return '<div class="finance-owed-transactions-empty">No repayment transactions yet.</div>';

  return repayments.map(({ repayment }, rowIndex) => {
    const month = String(repayment.month || '');
    const exactDate = normalizeFinanceDate(repayment.date) || normalizeFinanceDate(String(repayment.at || '').slice(0, 10));
    const dateLabel = financeDateLabel(exactDate);
    const label = /^\d{4}-\d{2}$/.test(month) ? monthLabel(month) : (dateLabel || 'Repayment');
    const finalPayment = remaining <= .005 && rowIndex === 0;
    const meta = (finalPayment ? 'Final repayment' : 'Repayment') + (dateLabel ? ' · Paid '+dateLabel : '');
    return '<div class="finance-owed-transaction">'+
      '<span><strong>'+esc(label)+'</strong><small>'+esc(meta)+'</small></span>'+
      '<b class="is-repayment">−'+money(repayment.amount)+'</b>'+
    '</div>';
  }).join('');
}

function tripOwedTransactionsHtml(item) {
  const plan = (Array.isArray(financeState.plans) ? financeState.plans : []).find((candidate) => String(candidate?.id || '') === String(item?.id || ''));
  if (!plan) return '<div class="finance-owed-transactions-empty">No trip transactions available.</div>';
  const owner = actor();
  const labels = Object.fromEntries(TRIP_DEBT_CATEGORIES);
  const rows = [];

  (Array.isArray(plan.expenseEntries) ? plan.expenseEntries : []).forEach((entry, index) => {
    const value = Math.max(0, n(entry?.amount) - n(entry?.jarContribution));
    if (value <= .005) return;
    const paidByOwner = entry?.paidBy === 'both' ? value / 2 : entry?.paidBy === owner ? value : 0;
    const forActor = entry?.forActor === 'Principe' ? 'Principe' : 'Principessa';
    const ownerShare = entry?.split === 'personal' ? (forActor === owner ? value : 0) : value / 2;
    const effect = paidByOwner - ownerShare;
    if (Math.abs(effect) <= .005) return;
    const category = labels[tripDebtCategoryKey(entry)] || 'Other';
    const date = String(entry?.date || entry?.createdAt || '').slice(0, 10);
    rows.push({
      stamp: owedTransactionSortValue(entry, index),
      title: String(entry?.name || category),
      meta: [financeDateLabel(date), category].filter(Boolean).join(' · ') || category,
      amount: effect,
      repayment: false,
    });
  });

  (Array.isArray(plan.repayments) ? plan.repayments : []).forEach((repayment, index) => {
    const value = n(repayment?.amount);
    if (value <= .005) return;
    const effect = repayment?.to === owner ? -value : repayment?.from === owner ? value : 0;
    if (Math.abs(effect) <= .005) return;
    const other = repayment?.from === owner ? repayment?.to : repayment?.from;
    const date = String(repayment?.date || repayment?.createdAt || '').slice(0, 10);
    rows.push({
      stamp: owedTransactionSortValue(repayment, index),
      title: repayment?.to === owner ? 'Repayment received' : 'Repayment sent',
      meta: [financeDateLabel(date), other].filter(Boolean).join(' · ') || 'Trip repayment',
      amount: effect,
      repayment: true,
    });
  });

  rows.sort((a, b) => b.stamp.localeCompare(a.stamp));
  if (!rows.length) return '<div class="finance-owed-transactions-empty">No trip transactions available.</div>';
  return rows.map((row) => '<div class="finance-owed-transaction">'+
    '<span><strong>'+esc(row.title)+'</strong><small>'+esc(row.meta)+'</small></span>'+
    '<b class="'+(row.amount < 0 ? 'is-repayment' : 'is-added')+'">'+(row.amount < 0 ? '−' : '+')+money(Math.abs(row.amount))+'</b>'+
  '</div>').join('');
}

function openOwedHistory() {
  const p = profile();
  const tripItems = tripReceivables();
  const manualItems = p.receivables.map((item, index) => ({
    item,
    index,
    paid: loanPaid(item),
    remaining: loanRemaining(item),
  }));
  const activeManualItems = manualItems.filter(({ remaining }) => remaining > .005);
  const paidManualItems = manualItems.filter(({ remaining }) => remaining <= .005);
  const total = activeManualItems.reduce((sum, x) => sum + x.remaining, 0) + tripItems.reduce((sum, x) => sum + n(x.amount), 0);

  const tripRows = tripItems.map((item, index) => `
    <div class="finance-owed-history-item">
      <button class="finance-owed-history-row is-trip" type="button" data-fin-history-expand="trip-${index}" aria-expanded="false">
        <span><strong>${esc(item.person)}</strong><small>${esc(item.reason)} · ${esc(item.categories)} · Trip</small></span>
        <span class="finance-owed-history-side"><b>${money(item.amount)}</b><i aria-hidden="true">⌄</i></span>
      </button>
      <div class="finance-owed-transactions" data-fin-history-panel="trip-${index}" hidden>${tripOwedTransactionsHtml(item)}</div>
    </div>`).join('');

  const manualRows = [...activeManualItems].reverse().map(({ item, index, paid, remaining }) => `
    <div class="finance-owed-history-item">
      <button class="finance-owed-history-row is-loan" type="button" data-fin-history-expand="loan-${index}" aria-expanded="false">
        <span><strong>${esc(item.person)}</strong><small>${esc(item.reason || 'Reason not added')} · Lent ${money(item.principal)} · Repaid ${money(paid)}</small></span>
        <span class="finance-owed-history-side"><b>${money(remaining)}</b><i aria-hidden="true">⌄</i></span>
      </button>
      <div class="finance-owed-transactions" data-fin-history-panel="loan-${index}" hidden>
        ${manualLoanTransactionsHtml(item, remaining)}
      </div>
    </div>`).join('');

  const activeRows = tripRows + manualRows || '<div class="finance-current-empty">Nobody currently owes you money.</div>';

  const pastLoans = paidManualItems.map(({ item }) => {
    const repayments = (Array.isArray(item?.repayments) ? item.repayments : [])
      .map((repayment, index) => ({ repayment, stamp: owedTransactionSortValue(repayment, index) }))
      .sort((a, b) => b.stamp.localeCompare(a.stamp));
    const finalRepayment = repayments[0]?.repayment || null;
    const finalDate = normalizeFinanceDate(finalRepayment?.date) || normalizeFinanceDate(String(finalRepayment?.at || '').slice(0, 10));
    const finalMonth = String(finalRepayment?.month || '');
    const finalLabel = financeDateLabel(finalDate) || (/^\d{4}-\d{2}$/.test(finalMonth) ? monthLabel(finalMonth) : '—');
    return { item, finalLabel, stamp: finalRepayment ? owedTransactionSortValue(finalRepayment) : '' };
  }).sort((a, b) => b.stamp.localeCompare(a.stamp));

  const pastRows = pastLoans.map(({ item, finalLabel }) => `
    <div class="finance-owed-history-row is-paid finance-past-loan-row">
      <span><strong>${esc(item.person)}</strong><small>${esc(item.reason || 'Reason not added')} · Lent ${money(item.principal)} · Repaid ${money(loanPaid(item))} · ${esc(finalLabel)}</small></span>
      <span class="finance-owed-history-side"><b>${money(item.principal)}</b></span>
    </div>`).join('');

  const pastSection = pastLoans.length
    ? `<div class="finance-past-loans-section">
        <button class="finance-owed-history-row finance-past-loans-toggle" type="button" data-fin-past-loans-toggle aria-expanded="false">
          <span><strong>Past loans</strong></span>
          <span class="finance-owed-history-side"><i aria-hidden="true">⌄</i></span>
        </button>
        <div class="finance-past-loans" data-fin-past-loans-panel hidden>${pastRows}</div>
      </div>`
    : '';

  showMini(`<span class="panel-kicker">PAYBACK</span><h2>Money owed to me</h2><div class="finance-owed-summary"><span>Currently owed</span><strong>${money(total)}</strong></div><div class="finance-jar-history-head"><h3>Currently owed</h3><span>${tripItems.length + activeManualItems.length} ${tripItems.length + activeManualItems.length === 1 ? 'item' : 'items'}</span></div><div class="finance-owed-history">${activeRows}</div>${pastSection}<div class="finance-mini-actions"><span></span><button class="btn ghost" type="button" data-fin-history-add-loan>+ Add loan</button></div>`);

  $$('[data-fin-history-expand]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.finHistoryExpand;
    const panel = document.querySelector('[data-fin-history-panel="'+key+'"]');
    if (!panel) return;
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    btn.closest('.finance-owed-history-item')?.classList.toggle('is-expanded', !expanded);
    panel.hidden = expanded;
  }));
  $('[data-fin-past-loans-toggle]')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const panel = document.querySelector('[data-fin-past-loans-panel]');
    if (!panel) return;
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    button.closest('.finance-past-loans-section')?.classList.toggle('is-expanded', !expanded);
    panel.hidden = expanded;
  });
  $('[data-fin-history-add-loan]')?.addEventListener('click', () => openOwedModal(-1, openOwedHistory));
}

function openOwedModal(index, backAction = closeMini) {
  const p = profile(), item = index >= 0 ? p.receivables[index] : null;
  if (!item) {
    showMini(`<span class="panel-kicker">NEW LOAN</span><h2>Add money someone owes you</h2><div class="finance-mini-fields"><label>Who owes you?<input id="finMiniPerson" placeholder="e.g. Sis"></label><label>Original amount lent<div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" placeholder="0.00"></div></label><label class="full">Why did you lend it?<input id="finMiniReason" placeholder="e.g. IP17"></label></div><div class="finance-mini-actions"><span></span><button class="btn primary" type="button" data-fin-mini-save>Save loan</button></div>`, '', { back: backAction });
    $('[data-fin-mini-save]')?.addEventListener('click', () => { const person = String($('#finMiniPerson')?.value || '').trim(), reason = String($('#finMiniReason')?.value || '').trim(), amount = $('#finMiniAmount')?.value || ''; if (!person) return toast('Add who owes you first', 'warn'); if (!reason) return toast('Add why you lent it', 'warn'); if (amount === '' || !Number.isFinite(Number(amount.replace(',', '.')))) return toast('Enter a valid amount', 'warn'); const next = profile(); next.receivables.push({ id: uid(), person, reason, principal: n(amount), repayments: [] }); saveProfile(next, 'Loan added'); });
    return;
  }
  const paid = loanPaid(item), remaining = loanRemaining(item);
  const grouped = {}; (item.repayments || []).forEach((r) => { const key = r.month || 'Other'; grouped[key] = (grouped[key] || 0) + n(r.amount); });
  const history = Object.keys(grouped).sort().reverse().map((month) => `<div class="loan-history-row"><span>${esc(monthLabel(month))}</span><strong>${money(grouped[month])}</strong></div>`).join('') || '<div class="finance-current-empty">No repayments logged yet.</div>';
  showMini(`<span class="panel-kicker">PAYBACK TRACKER</span><h2>${esc(item.person)}</h2><p>${esc(item.reason)}</p><div class="loan-stats"><div><span>Originally lent</span><strong>${money(item.principal)}</strong></div><div><span>Repaid</span><strong>${money(paid)}</strong></div><div><span>Still left</span><strong>${money(remaining)}</strong></div></div><h3>Repayment history</h3><div class="loan-history">${history}</div><div class="finance-mini-actions"><button class="btn ghost" type="button" data-fin-loan-edit>Edit loan</button><button class="btn ghost" type="button" data-fin-mini-delete>Delete</button><button class="btn primary" type="button" data-fin-loan-repay ${remaining <= 0 ? 'disabled' : ''}>+ Add repayment</button></div>`, '', { back: backAction });
  $('[data-fin-loan-edit]')?.addEventListener('click', () => openLoanEdit(index, () => openOwedModal(index, backAction)));
  $('[data-fin-loan-repay]')?.addEventListener('click', () => openLoanRepayment(index, () => openOwedModal(index, backAction)));
  $('[data-fin-mini-delete]')?.addEventListener('click', () => { const next = profile(); next.receivables.splice(index, 1); saveProfile(next, 'Loan removed'); });
}

function openLoanEdit(index, backAction = closeMini) {
  const p = profile(), item = p.receivables[index]; if (!item) return;
  showMini(`<span class="panel-kicker">EDIT LOAN</span><h2>${esc(item.person)}</h2><div class="finance-mini-fields"><label>Who owes you?<input id="finMiniPerson" value="${esc(item.person)}"></label><label>Original amount lent<div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(item.principal ?? ''))}"></div></label><label class="full">Reason<input id="finMiniReason" value="${esc(item.reason)}"></label></div><div class="finance-mini-actions"><button class="btn ghost" type="button" data-fin-mini-back>Back</button><button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`, '', { back: backAction });
  $('[data-fin-mini-back]')?.addEventListener('click', backAction);
  $('[data-fin-mini-save]')?.addEventListener('click', () => { const person = String($('#finMiniPerson')?.value || '').trim(), reason = String($('#finMiniReason')?.value || '').trim(), amount = $('#finMiniAmount')?.value || ''; if (!person || !reason || amount === '' || !Number.isFinite(Number(amount.replace(',', '.')))) return toast('Complete the loan details', 'warn'); if (n(amount) < loanPaid(item)) return toast('Original amount cannot be below what has already been repaid', 'warn'); const next = profile(); next.receivables[index] = { ...next.receivables[index], person, reason, principal: n(amount) }; saveProfile(next, 'Loan updated'); });
}

function openLoanRepayment(index, backAction = closeMini) {
  const p = profile(), item = p.receivables[index]; if (!item) return; const remaining = loanRemaining(item);
  const today = new Date().toISOString().slice(0, 10);
  const defaultDate = today.startsWith(selectedMonth+'-') ? today : '';
  showMini(`<span class="panel-kicker">REPAYMENT</span><h2>Add repayment from ${esc(item.person)}</h2><div class="finance-mini-fields"><label>Month<select id="finMiniRepayMonth">${MONTHS.map(([k, l]) => `<option value="${k}" ${k === selectedMonth ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label>Date repaid<input id="finMiniRepayDate" type="date" value="${defaultDate}" min="${selectedMonth}-01" max="${selectedMonth}-${String(daysInFinanceMonth(selectedMonth)).padStart(2,'0')}"></label><label>Amount repaid<div class="finance-money mini"><span>€</span><input id="finMiniRepayAmount" inputmode="decimal" placeholder="0.00"></div></label></div><div class="finance-mini-actions"><button class="btn ghost" type="button" data-fin-mini-back>Back</button><button class="btn primary" type="button" data-fin-mini-save>Save repayment</button></div>`, '', { back: backAction });
  $('[data-fin-mini-back]')?.addEventListener('click', backAction);
  $('#finMiniRepayMonth')?.addEventListener('change', (event) => {
    const month = event.target.value || selectedMonth;
    const dateInput = $('#finMiniRepayDate');
    if (!dateInput) return;
    dateInput.min = month+'-01';
    dateInput.max = month+'-'+String(daysInFinanceMonth(month)).padStart(2,'0');
    if (dateInput.value && !dateInput.value.startsWith(month+'-')) dateInput.value='';
  });
  $('[data-fin-mini-save]')?.addEventListener('click', () => { const amount = $('#finMiniRepayAmount')?.value || '', month = $('#finMiniRepayMonth')?.value || selectedMonth, rawDate = String($('#finMiniRepayDate')?.value || '').trim(), date = normalizeFinanceDate(rawDate, month); if (amount === '' || !Number.isFinite(Number(amount.replace(',', '.'))) || n(amount) <= 0) return toast('Enter a valid repayment', 'warn'); if (!date) return toast('Choose the repayment date', 'warn'); if (n(amount) > remaining) return toast('Repayment is higher than the amount still owed', 'warn'); const next = profile(); next.receivables[index].repayments = [...(next.receivables[index].repayments || []), { id: uid(), month, date, amount: n(amount), at: new Date().toISOString() }]; next.savingsTotal = n(next.savingsTotal) + n(amount); saveProfile(next, `Repayment saved · ${money(amount)} added to savings`); });
}

function freshRecord(month) {
  const rules = financeRules();
  return { month, incomes: [], expenses: [], extraBudget: rules.extraTracking ? rules.extraBudget : '', extraSpends: [], extraOverspendSource: '', extraOverspendAmount: 0, investmentTotal: '', sisterInvestments: '', partialOnly: false, finalized: false, finalizedAt: '' };
}
function cloneRecord(rec) {
  const rules = financeRules();
  const copy = normalizeFinanceRecord(rec, actor());
  copy.extraBudget = rules.extraTracking ? (hasValue(copy.extraBudget) ? n(copy.extraBudget) : rules.extraBudget) : '';
  copy.extraSpends = (rules.extraTracking || rules.savedUpExtraTracking) && Array.isArray(copy.extraSpends) ? copy.extraSpends.map((x) => ({ ...x, id: x.id || uid() })) : [];
  copy.extraOverspendSource = copy.extraSpends[0]?.source || '';
  copy.extraOverspendAmount = copy.extraSpends.reduce((sum, x) => sum + n(x.amount), 0);
  copy.finalized = copy.finalized === true; if (!copy.finalizedAt) copy.finalizedAt = '';
  if (copy.investmentTotal == null) copy.investmentTotal = ''; if (copy.sisterInvestments == null) copy.sisterInvestments = '';
  return copy;
}

function startMonth(month = '2026-09', skipMonth = false) { const target = month || selectedMonth; if (skipMonth) { startRecurringMonth(target); return; } flow = { data: freshRecord(target), stage: 'month', temp: {} }; renderWizard(); }
function startPartialMonth(month = selectedMonth) {
  const target = month || selectedMonth || '2026-09';
  const data = freshRecord(target);
  data.partialOnly = true;
  flow = { data, stage: 'partialMonth', temp: {}, partialMode: true };
  renderWizard();
}
function partialRecurringExpenses(month) {
  return (seededRecord(month).expenses || []).filter((x) => !(normalizeGroup(x.group) === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra'));
}
function partialExpenseIndex(d, candidate) {
  const name = String(candidate?.name || '').trim().toLowerCase(), group = normalizeGroup(candidate?.group);
  return (d.expenses || []).findIndex((x) => normalizeGroup(x.group) === group && String(x.name || '').trim().toLowerCase() === name);
}
function startPartialExpenses(month) {
  const target = month || selectedMonth;
  const existing = recordFor(target);
  if (existing?.finalized === true) return toast('This month is final and locked', 'warn');
  const data = existing ? cloneRecord(existing) : freshRecord(target);
  data.partialOnly = true;
  data.expenses = (data.expenses || []).filter((x) => !(normalizeGroup(x.group) === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra'));
  flow = { data, stage: 'partialChoose', temp: {}, partialMode: true };
  selectedMonth = target;
  renderWizard();
}
function startEdit(rec) { if (rec?.finalized === true) return toast('This month is final and locked', 'warn'); flow = { data: cloneRecord(rec), stage: 'review', temp: {} }; renderWizard(); }
function resetWizard() { flow = null; renderWizard(); }
function setProgress(label, pct) { const step = $('#financeWizardStep'), bar = $('#financeWizardProgress'); if (step) step.textContent = label; if (bar) bar.style.width = Math.max(8, Math.min(100, pct)) + '%'; }
function wizardHtml(title, help, body) { return `<div class="finance-question"><h2>${esc(title)}</h2>${help ? `<p>${esc(help)}</p>` : ''}${body}</div>`; }
function bindBack(next) { $('[data-fin-back]')?.addEventListener('click', next); }
function listHtml(items, labelFn) { return items?.length ? `<div class="finance-list">${items.map((x) => `<div class="finance-list-row"><span>${esc(labelFn(x))}${financeDateMeta(x.date)}</span><strong>${money(x.amount)}</strong></div>`).join('')}</div>` : ''; }

function latestPriorMonth(month) {
  return [...ownMonths()].filter((x) => String(x.month) < String(month)).sort((a, b) => String(b.month).localeCompare(String(a.month)))[0] || null;
}
function recurringValue(previous, kind, name, fallback) {
  if (!previous) return fallback;
  const list = kind === 'income' ? (previous.incomes || []) : (previous.expenses || []);
  const match = list.find((x) => String(x.name || '').trim().toLowerCase() === String(name).trim().toLowerCase());
  return match && hasValue(match.amount) ? n(match.amount) : fallback;
}
function seededRecord(month) {
  const rules = financeRules(), previous = latestPriorMonth(month), d = freshRecord(month), carry = extraCarryInfo(month);
  const savedRecurring = profile().recurring;
  const custom = savedRecurring?.custom === true;
  const setup = custom ? normalizeRecurringConfig(savedRecurring) : {
    incomes: rules.recurringIncomes,
    expenses: rules.recurringExpenses.filter((x) => normalizeGroup(x.group) !== 'extra'),
  };
  d.extraBudget = rules.extraTracking ? carry.budget : '';
  d.incomes = setup.incomes.map((x) => {
    const usualDay = normalizeRecurringDay(x.day);
    return { name: x.name, amount: custom ? n(x.amount) : recurringValue(previous, 'income', x.name, x.amount), usualDay, date: financeDateForDay(month, usualDay) };
  });
  d.expenses = setup.expenses.map((x) => {
    const usualDay = normalizeRecurringDay(x.day);
    return { group: x.group, name: x.name, amount: custom ? n(x.amount) : recurringValue(previous, 'expense', x.name, x.amount), usualDay, date: financeDateForDay(month, usualDay) };
  });
  if (rules.extraTracking) d.expenses.push({ group: 'extra', name: 'Extra', amount: carry.budget, usualDay: '', date: '' });
  d.extraSpends = [];
  return d;
}

function buildRecurringQueue(d) {
  return [
    ...(d.incomes || []).map((_, index) => ({ kind: 'income', index })),
    ...(d.expenses || []).map((_, index) => ({ kind: 'expense', index })),
  ];
}
function recurringSource(item, d) { return item?.kind === 'income' ? d.incomes?.[item.index] : d.expenses?.[item.index]; }
function startRecurringMonth(month) {
  const d = seededRecord(month || selectedMonth);
  flow = { data: d, stage: 'recurringCheck', temp: {}, recurringQueue: buildRecurringQueue(d), recurringIndex: 0 };
  renderWizard();
}
function groupedExpenseHtml(items, removable = false, extraSpends = []) {
  const rows = (items || []).map((x, index) => ({ ...x, index, group: normalizeGroup(x.group), tone: groupTone(x.group), isExtraSpend: false }));
  extraSpendSummary({ extraSpends }).forEach((x) => {
    const savedUpOnly = actor() === 'Principe' && x.source === 'savings';
    rows.push({ group: savedUpOnly ? 'savings' : 'extra', tone: savedUpOnly ? 'wealth' : 'budgets', name: extraSourceLabel(x.source), amount: x.amount, isExtraSpend: true, extraSource: x.source, index: -1 });
  });
  const grouped = {};
  rows.forEach((x) => (grouped[x.tone] || (grouped[x.tone] = [])).push(x));
  return categoryOrder().filter((tone) => grouped[tone]?.length).map((tone) => {
    const group = grouped[tone], total = group.reduce((sum, x) => sum + n(x.amount), 0);
    const itemRows = group.map((x) => {
      const fixedExtra = !x.isExtraSpend && normalizeGroup(x.group) === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra';
      const rowClass = x.isExtraSpend ? ' finance-extra-spend-row' : fixedExtra && n(x.amount) < 250 ? ' finance-reduced-extra' : '';
      const controls = removable && !x.isExtraSpend ? ` <button class="text-btn" data-fin-edit-expense="${x.index}">Edit</button> <button class="text-btn" data-fin-remove-expense="${x.index}">×</button>` : '';
      return `<div class="finance-category-item${rowClass}"><span>${esc(x.name || groupLabel(x.group))}${financeDateMeta(x.date)}</span><strong>${money(x.amount)}${controls}</strong></div>`;
    }).join('');
    return `<div class="finance-category-bubble finance-tone-${tone}"><div class="finance-category-head"><strong>${esc(categoryLabel(tone))}</strong><span>${money(total)}</span></div>${itemRows}</div>`;
  }).join('');
}

function renderWizard() {
  const body = $('#financeWizardBody'); if (!body) return;
  if (!actor()) { setProgress('PERSONAL FINANCES', 8); body.innerHTML = wizardHtml('Choose your profile first', 'Your monthly finances are kept separately for Principessa and Principe.', ''); return; }
  if (!flow) {
    setProgress('MONTHLY FINANCES', 8);
    const intro = actor() === 'Principe' ? 'Income, fixed expenses, subscriptions, variable expenses and savings.' : 'Income, colored expenses, €250 Extra budget, savings and investments.';
    body.innerHTML = wizardHtml(`Track ${actor()}’s month`, 'Choose whether you want to do the whole check-in or only log a few expenses for now.', `<div class="finance-choice-stack"><button class="finance-choice" type="button" data-fin-start><div><strong>Log everything now</strong><small>${esc(intro)}</small></div><span>✓</span></button><button class="finance-choice" type="button" data-fin-start-partial><div><strong>Log some expenses now</strong><small>Pick only the expenses that happened so far and save the month as a draft.</small></div><span>＋</span></button></div>`);
    $('[data-fin-start]')?.addEventListener('click', () => startMonth(selectedMonth, false));
    $('[data-fin-start-partial]')?.addEventListener('click', () => startPartialMonth(selectedMonth));
    return;
  }
  const d = flow.data, t = flow.temp || {};

  if (flow.stage === 'partialMonth') {
    setProgress('PARTIAL EXPENSES', 12);
    body.innerHTML = wizardHtml('Which month are you adding expenses to?', 'You can keep coming back to the same draft throughout the month.', `<select class="finance-select" id="finMonthSelect">${MONTHS.map(([k, l]) => `<option value="${k}" ${k === d.month ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="finance-actions"><button class="btn ghost" data-fin-back>Cancel</button><button class="btn primary big" data-fin-next>Choose expenses</button></div>`);
    bindBack(resetWizard);
    $('[data-fin-next]')?.addEventListener('click', () => { const chosen = $('#finMonthSelect')?.value || d.month; startPartialExpenses(chosen); });
    return;
  }

  if (flow.stage === 'partialChoose') {
    setProgress('PARTIAL EXPENSES', 24);
    const groups = manualGroups();
    const choices = groups.map((g) => `<button class="finance-choice finance-tone-${g.tone}" type="button" data-fin-partial-group="${g.key}"><div><strong>${esc(g.label)}</strong></div><span>→</span></button>`).join('');
    const loggedCount = (d.expenses || []).length;
    body.innerHTML = wizardHtml('What kind of expense do you want to log?', 'Choose a category first.', `<div class="finance-group-grid">${choices}</div>${loggedCount ? `<div class="finance-reference" style="margin-top:14px"><span>Saved in this draft</span><strong>${loggedCount} expense${loggedCount === 1 ? '' : 's'}</strong></div>` : ''}<div class="finance-actions"><button class="btn ghost" type="button" data-fin-cancel>Cancel</button><button class="btn primary big" type="button" data-fin-save-draft>Save for later</button></div>`);
    $$('[data-fin-partial-group]').forEach((btn) => btn.addEventListener('click', () => {
      flow.partialGroup = btn.dataset.finPartialGroup;
      flow.temp = {};
      flow.stage = 'partialCategory';
      renderWizard();
    }));
    $('[data-fin-cancel]')?.addEventListener('click', resetWizard);
    $('[data-fin-save-draft]')?.addEventListener('click', () => saveMonth(false));
    return;
  }

  if (flow.stage === 'partialCategory') {
    setProgress('PARTIAL EXPENSES', 30);
    const meta = groupMeta(flow.partialGroup);
    const candidates = partialRecurringExpenses(d.month);
    const categoryCandidates = candidates
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => normalizeGroup(item.group) === meta.key);
    const choices = categoryCandidates.map(({ item, index }) => {
      const loggedIndex = partialExpenseIndex(d, item), logged = loggedIndex >= 0 ? d.expenses[loggedIndex] : null;
      const date = financeDateLabel(logged?.date || item.date);
      const detail = logged ? `Logged ${money(logged.amount)}${date ? ` · ${date}` : ''} · tap to edit` : `${money(item.amount)}${date ? ` · ${date}` : ''}`;
      return `<button class="finance-choice finance-tone-${meta.tone}" type="button" data-fin-partial-expense="${index}"><div><strong>${esc(item.name)}</strong><small>${esc(detail)}</small></div><span>${logged ? '↻' : '＋'}</span></button>`;
    }).join('');
    const loggedCount = (d.expenses || []).length;
    body.innerHTML = wizardHtml(meta.label, 'Choose what you want to log from this category.', `<div class="finance-choice-stack">${choices}${choices ? '' : '<div class="finance-empty">Nothing recurring is set up in this category yet.</div>'}<button class="finance-choice finance-tone-${meta.tone}" type="button" data-fin-partial-custom><div><strong>Add another expense</strong></div><span>＋</span></button></div>${loggedCount ? `<div class="finance-reference" style="margin-top:14px"><span>Saved in this draft</span><strong>${loggedCount} expense${loggedCount === 1 ? '' : 's'}</strong></div>` : ''}<div class="finance-actions"><button class="btn ghost" type="button" data-fin-partial-categories>Back to categories</button><button class="btn primary big" type="button" data-fin-save-draft>Save for later</button></div>`);
    $$('[data-fin-partial-expense]').forEach((btn) => btn.addEventListener('click', () => {
      flow.temp = { partialCandidateIndex: Number(btn.dataset.finPartialExpense) };
      flow.stage = 'partialExpense';
      renderWizard();
    }));
    $('[data-fin-partial-custom]')?.addEventListener('click', () => {
      const selected = groupMeta(flow.partialGroup);
      flow.temp = { group: selected.key };
      if (selected.optionalName) { flow.temp.name = selected.defaultName; flow.stage = 'expenseOptionalName'; }
      else if (selected.defaultName) { flow.temp.name = selected.defaultName; flow.stage = 'expenseAmount'; }
      else flow.stage = 'expenseName';
      renderWizard();
    });
    $('[data-fin-partial-categories]')?.addEventListener('click', () => {
      flow.partialGroup = '';
      flow.temp = {};
      flow.stage = 'partialChoose';
      renderWizard();
    });
    $('[data-fin-save-draft]')?.addEventListener('click', () => saveMonth(false));
    return;
  }

  if (flow.stage === 'partialExpense') {
    const candidates = partialRecurringExpenses(d.month), candidate = candidates[Number(t.partialCandidateIndex)];
    if (!candidate) { flow.temp = {}; flow.stage = flow.partialGroup ? 'partialCategory' : 'partialChoose'; renderWizard(); return; }
    const loggedIndex = partialExpenseIndex(d, candidate), logged = loggedIndex >= 0 ? d.expenses[loggedIndex] : null;
    const bounds = financeDateBounds(d.month), suggestedDate = normalizeFinanceDate(logged?.date || candidate.date, d.month);
    setProgress('PARTIAL EXPENSE', 36);
    body.innerHTML = wizardHtml(`Log ${candidate.name}`, 'Confirm the amount and date for this expense. The date can be left blank.', `<div class="finance-reference finance-tone-${groupTone(candidate.group)}"><span>${esc(groupLabel(candidate.group))}</span><strong>${esc(candidate.name)}</strong><small>${logged ? 'Already in this draft — saving will update it.' : 'Only this expense will be added.'}</small></div><div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(logged?.amount ?? candidate.amount ?? ''))}" placeholder="0.00"></div><label class="finance-date-field"><span>Date <small>Optional</small></span><input class="finance-input" id="finItemDate" type="date" min="${bounds.min}" max="${bounds.max}" value="${esc(suggestedDate)}"></label><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>${logged ? 'Update expense' : 'Add expense'}</button></div>`);
    bindBack(() => { flow.temp = {}; flow.stage = flow.partialGroup ? 'partialCategory' : 'partialChoose'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => {
      const amount = $('#finMoney')?.value || '', rawDate = String($('#finItemDate')?.value || '').trim(), safeDate = normalizeFinanceDate(rawDate, d.month);
      if (amount === '' || !Number.isFinite(Number(amount.replace(',', '.')))) return toast('Enter a valid amount', 'warn');
      if (rawDate && !safeDate) return toast('Choose a date inside this month, or leave it blank', 'warn');
      const next = { ...(logged || {}), group: candidate.group, name: candidate.name, amount: n(amount), usualDay: candidate.usualDay ?? logged?.usualDay ?? '', date: safeDate };
      if (loggedIndex >= 0) d.expenses[loggedIndex] = next; else d.expenses.push(next);
      flow.temp = {};
      flow.stage = flow.partialGroup ? 'partialCategory' : 'partialChoose';
      renderWizard();
    });
    return;
  }

  if (flow.stage === 'month') {
    setProgress('QUESTION 1', 10);
    body.innerHTML = wizardHtml('Which month are you logging?', 'Choose the month these numbers belong to.', `<select class="finance-select" id="finMonthSelect">${MONTHS.map(([k, l]) => `<option value="${k}" ${k === d.month ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="finance-actions"><button class="btn ghost" data-fin-back>Cancel</button><button class="btn primary big" data-fin-next>Next</button></div>`);
    bindBack(resetWizard); $('[data-fin-next]')?.addEventListener('click', () => { const chosen = $('#finMonthSelect')?.value || d.month; const existing = recordFor(chosen); existing ? startEdit(existing) : startRecurringMonth(chosen); }); return;
  }

  if (flow.stage === 'recurringCheck') {
    const queue = flow.recurringQueue || buildRecurringQueue(d), idx = Number(flow.recurringIndex || 0);
    if (idx >= queue.length) { flow.stage = nextAfterExpensesStage(); renderWizard(); return; }
    const item = queue[idx], source = recurringSource(item, d);
    if (!source) { flow.recurringIndex = idx + 1; renderWizard(); return; }
    const isFixedExtra = item.kind === 'expense' && normalizeGroup(source.group) === 'extra' && String(source.name || '').trim().toLowerCase() === 'extra';
    const meta = item.kind === 'income' ? { label: 'Income', tone: 'other' } : { label: categoryLabel(groupTone(source.group)), tone: groupTone(source.group) };
    const pct = 12 + Math.round(((idx + 1) / Math.max(1, queue.length)) * 48);
    setProgress(`CHECKING ${idx + 1} OF ${queue.length}`, pct);
    const carry = extraCarryInfo(d.month);
    const usualDay = normalizeRecurringDay(source.usualDay);
    if (!isFixedExtra && usualDay !== '' && !normalizeFinanceDate(source.date, d.month)) source.date = financeDateForDay(d.month, usualDay);
    const scheduledLabel = financeDateLabel(source.date);
    const actionText = item.kind === 'income' ? 'added to your account' : 'removed from your account';
    const bounds = financeDateBounds(d.month);
    const help = isFixedExtra
      ? (n(d.extraBudget) < 250 ? `Your normal €250 Extra is reduced this month because you used extra money in ${monthLabel(carry.prevMonth)}.${carry.debt > 0 ? ` You still owe yourself ${money(carry.debt)} from last month.` : ''}` : 'This is your normal monthly Extra allocation. You do not need to itemize what the budget itself is spent on.')
      : usualDay !== ''
        ? `Was ${source.name} ${actionText} on ${scheduledLabel}?`
        : `No usual date is set for ${source.name}. Add the date for this month if you want, or leave it blank.`;
    const dateField = !isFixedExtra && usualDay === '' ? `<label class="finance-date-field"><span>Actual date <small>Optional</small></span><input class="finance-input" id="finRecurringDate" type="date" min="${bounds.min}" max="${bounds.max}" value="${esc(normalizeFinanceDate(source.date, d.month))}"></label>` : '';
    const editButton = isFixedExtra ? '' : `<button class="btn ghost" type="button" data-fin-recurring-edit>Edit</button>`;
    const extraClass = isFixedExtra && n(d.extraBudget) < 250 ? ' finance-extra-budget-reduced' : '';
    const timing = !isFixedExtra && scheduledLabel ? ` · ${scheduledLabel}` : '';
    body.innerHTML = wizardHtml(`${source.name} · ${money(source.amount)}?`, help, `<div class="finance-reference finance-tone-${meta.tone}${extraClass}"><span>${esc(meta.label)}</span><strong>${esc(source.name)}</strong><small>${isFixedExtra ? 'Monthly Extra budget' : 'Usual amount'} · ${money(source.amount)}${timing}</small></div>${dateField}<div class="finance-actions">${editButton}<button class="btn primary big" type="button" data-fin-recurring-confirm>Confirm</button></div>`);
    $('[data-fin-recurring-confirm]')?.addEventListener('click', () => {
      const dateInput = $('#finRecurringDate');
      if (dateInput) {
        const raw = String(dateInput.value || '').trim();
        const safe = normalizeFinanceDate(raw, d.month);
        if (raw && !safe) return toast('Choose a date inside this month, or leave it blank', 'warn');
        source.date = safe;
      }
      flow.recurringIndex = idx + 1;
      renderWizard();
    });
    $('[data-fin-recurring-edit]')?.addEventListener('click', () => { flow.temp = { recurringItem: item }; flow.stage = 'recurringEdit'; renderWizard(); });
    return;
  }

  if (flow.stage === 'recurringEdit') {
    const item = t.recurringItem, source = recurringSource(item, d), idx = Number(flow.recurringIndex || 0);
    if (!item || !source) { flow.stage = 'recurringCheck'; renderWizard(); return; }
    const bounds = financeDateBounds(d.month);
    setProgress(`EDITING ${idx + 1} OF ${(flow.recurringQueue || []).length}`, 20 + Math.round(((idx + 1) / Math.max(1, (flow.recurringQueue || []).length)) * 40));
    body.innerHTML = wizardHtml(`Update ${source.name}`, 'Change this month’s amount or actual date. The recurring default stays unchanged.', `<div class="finance-reference"><span>Current suggestion</span><strong>${money(source.amount)}</strong></div><div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(source.amount ?? ''))}" placeholder="0.00"></div><label class="finance-date-field"><span>Actual date <small>Optional</small></span><input class="finance-input" id="finRecurringDate" type="date" min="${bounds.min}" max="${bounds.max}" value="${esc(normalizeFinanceDate(source.date, d.month))}"></label><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Save & continue</button></div>`);
    bindBack(() => { flow.stage = 'recurringCheck'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => {
      const v = $('#finMoney')?.value || '';
      const rawDate = String($('#finRecurringDate')?.value || '').trim();
      const safeDate = normalizeFinanceDate(rawDate, d.month);
      if (v === '' || !Number.isFinite(Number(v.replace(',', '.')))) return toast('Enter a valid amount', 'warn');
      if (rawDate && !safeDate) return toast('Choose a date inside this month, or leave it blank', 'warn');
      source.amount = n(v);
      source.date = safeDate;
      flow.temp = {};
      flow.recurringIndex = idx + 1;
      flow.stage = 'recurringCheck';
      renderWizard();
    });
    return;
  }

  if (flow.stage === 'savedUpSpentAsk') {
    setProgress('SAVED UP', 64);
    const entry = (d.extraSpends || []).find((x) => x.source === 'savings') || null;
    const saved = entry ? `<div class="finance-reference finance-tone-wealth"><span>Saved up used</span><strong>${money(entry.amount)}</strong></div>` : '';
    body.innerHTML = wizardHtml('Did you use money from Saved up?', 'If yes, enter how much you used. That amount will be subtracted from Principe’s Saved up total when the month is saved.', `${saved}<div class="finance-choice-stack"><button class="finance-choice" data-fin-saved-up-yes><div><strong>Yes</strong><small>${entry ? 'Update the amount used.' : 'Enter the amount used from Saved up.'}</small></div><span>→</span></button><button class="finance-choice" data-fin-saved-up-no><div><strong>No</strong><small>${entry ? 'Remove the saved-up spending from this month.' : 'No money used from Saved up.'}</small></div><span>→</span></button></div>`);
    $('[data-fin-saved-up-yes]')?.addEventListener('click', () => { flow.stage = 'savedUpSpentAmount'; renderWizard(); });
    $('[data-fin-saved-up-no]')?.addEventListener('click', () => {
      d.extraSpends = (d.extraSpends || []).filter((x) => x.source !== 'savings');
      flow.stage = flow.extraReturn === 'review' ? 'review' : nextAfterExtraStage();
      flow.extraReturn = '';
      renderWizard();
    });
    return;
  }

  if (flow.stage === 'savedUpSpentAmount') {
    setProgress('SAVED UP', 70);
    const entry = (d.extraSpends || []).find((x) => x.source === 'savings') || null;
    body.innerHTML = wizardHtml('How much did you use from Saved up?', 'Enter the amount Principe used from his saved-up money.', `<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${entry ? esc(String(entry.amount)) : ''}" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Save</button></div>`);
    bindBack(() => { flow.stage = 'savedUpSpentAsk'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => {
      const v = $('#finMoney')?.value || '';
      if (v === '' || !Number.isFinite(Number(v.replace(',', '.'))) || n(v) <= 0) return toast('Enter a valid amount', 'warn');
      d.extraSpends = (d.extraSpends || []).filter((x) => x.source !== 'savings');
      d.extraSpends.push({ id: entry?.id || uid(), source: 'savings', amount: n(v) });
      flow.stage = flow.extraReturn === 'review' ? 'review' : nextAfterExtraStage();
      flow.extraReturn = '';
      renderWizard();
    });
    return;
  }

  if (flow.stage === 'extraSpentAsk') {
    setProgress('EXTRA', 64);
    const entries = d.extraSpends || [];
    const saved = entries.length ? `<div class="finance-list">${entries.map((x, i) => `<div class="finance-list-row finance-extra-saved"><span>${esc(extraSourceLabel(x.source))}</span><strong>${money(x.amount)} <button class="text-btn" data-fin-extra-edit="${i}">Edit</button> <button class="text-btn" data-fin-extra-remove="${i}">×</button></strong></div>`).join('')}</div>` : '';
    body.innerHTML = wizardHtml('Any extra money spent?', 'Only log money used beyond your Extra budget for this month.', `${saved}<div class="finance-choice-stack"><button class="finance-choice" data-fin-extra-yes><div><strong>Yes</strong><small>Add credit card, saved-up, or Main account spending.</small></div><span>→</span></button><button class="finance-choice" data-fin-extra-no><div><strong>${entries.length ? 'No more' : 'No'}</strong><small>${entries.length ? 'Continue with what is saved.' : 'Nothing beyond the Extra budget.'}</small></div><span>→</span></button></div>`);
    $$('[data-fin-extra-edit]').forEach((btn) => btn.addEventListener('click', () => { flow.temp = { extraEditIndex: Number(btn.dataset.finExtraEdit) }; flow.stage = 'extraEditAmount'; renderWizard(); }));
    $$('[data-fin-extra-remove]').forEach((btn) => btn.addEventListener('click', () => { d.extraSpends.splice(Number(btn.dataset.finExtraRemove), 1); renderWizard(); }));
    $('[data-fin-extra-yes]')?.addEventListener('click', () => { flow.stage = 'extraSourceAsk'; renderWizard(); });
    $('[data-fin-extra-no]')?.addEventListener('click', () => { flow.stage = flow.extraReturn === 'review' ? 'review' : nextAfterExtraStage(); flow.extraReturn = ''; renderWizard(); });
    return;
  }

  if (flow.stage === 'extraSourceAsk') {
    setProgress('EXTRA', 67);
    body.innerHTML = wizardHtml('Where did the extra money come from?', 'Choose the source for this extra spending.', `<div class="finance-choice-stack"><button class="finance-choice" data-fin-extra-source="creditcard"><div><strong>Credit Card</strong><small>Extra spending charged to your credit card.</small></div><span>→</span></button><button class="finance-choice" data-fin-extra-source="savings"><div><strong>From Saved Up</strong><small>Money taken from your savings.</small></div><span>→</span></button><button class="finance-choice" data-fin-extra-source="main"><div><strong>From Main account leftover</strong><small>Extra money used from your accumulated Main account leftover.</small></div><span>→</span></button></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button></div>`);
    bindBack(() => { flow.stage = 'extraSpentAsk'; renderWizard(); });
    $$('[data-fin-extra-source]').forEach((btn) => btn.addEventListener('click', () => { flow.temp = { extraSource: btn.dataset.finExtraSource }; flow.stage = 'extraAmount'; renderWizard(); }));
    return;
  }

  if (flow.stage === 'extraAmount') {
    const source = t.extraSource || 'creditcard'; setProgress('EXTRA', 70);
    body.innerHTML = wizardHtml(`How much from ${extraSourceLabel(source)}?`, 'Enter the amount used so far. You can add another extra source afterwards.', `<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Save</button></div>`);
    bindBack(() => { flow.stage = 'extraSourceAsk'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => { const v = $('#finMoney')?.value || ''; if (v === '' || !Number.isFinite(Number(v.replace(',', '.'))) || n(v) <= 0) return toast('Enter a valid amount', 'warn'); d.extraSpends.push({ id: uid(), source, amount: n(v) }); flow.temp = {}; flow.stage = 'extraMoreAsk'; renderWizard(); });
    return;
  }

  if (flow.stage === 'extraMoreAsk') {
    setProgress('EXTRA', 72);
    const total = extraSpendsTotal(d);
    body.innerHTML = wizardHtml('Any more extra money spent?', 'You can keep adding extra spending from a different or the same source.', `<div class="finance-reference finance-tone-budgets"><span>Extra money logged so far</span><strong>${money(total)}</strong></div><div class="finance-choice-stack"><button class="finance-choice" data-fin-extra-more><div><strong>Yes, add another</strong></div><span>＋</span></button><button class="finance-choice" data-fin-extra-done><div><strong>No, continue</strong></div><span>→</span></button></div>`);
    $('[data-fin-extra-more]')?.addEventListener('click', () => { flow.stage = 'extraSourceAsk'; renderWizard(); });
    $('[data-fin-extra-done]')?.addEventListener('click', () => { flow.stage = flow.extraReturn === 'review' ? 'review' : nextAfterExtraStage(); flow.extraReturn = ''; renderWizard(); });
    return;
  }

  if (flow.stage === 'extraEditAmount') {
    const idx = Number(t.extraEditIndex), item = d.extraSpends?.[idx];
    if (!item) { flow.temp = {}; flow.stage = 'extraSpentAsk'; renderWizard(); return; }
    setProgress('EDIT EXTRA', 70);
    body.innerHTML = wizardHtml(`Edit ${extraSourceLabel(item.source)}`, 'Update this extra amount. It remains editable until the month is confirmed.', `<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(item.amount ?? ''))}" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Save change</button></div>`);
    bindBack(() => { flow.temp = {}; flow.stage = 'extraSpentAsk'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => { const v = $('#finMoney')?.value || ''; if (v === '' || !Number.isFinite(Number(v.replace(',', '.'))) || n(v) <= 0) return toast('Enter a valid amount', 'warn'); item.amount = n(v); flow.temp = {}; flow.stage = 'extraSpentAsk'; renderWizard(); });
    return;
  }

  if (flow.stage === 'incomeSource') {
    setProgress('INCOME', 20);
    body.innerHTML = wizardHtml(d.incomes.length ? 'Add another income source' : 'What income did you receive?', 'Salary, benefits, reimbursements or any other money that came in.', `${listHtml(d.incomes, (x) => x.name)}<input class="finance-input" id="finText" placeholder="e.g. Neways"><div class="finance-actions"><button class="btn ghost" data-fin-back>${d.incomes.length ? 'Done with income' : 'Cancel'}</button><button class="btn primary big" data-fin-next>Next</button></div>`);
    bindBack(() => { if (d.incomes.length) { flow.stage = 'expenseGroup'; renderWizard(); } else resetWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => { const v = String($('#finText')?.value || '').trim(); if (!v) return toast('Add the income source first', 'warn'); t.name = v; flow.stage = 'incomeAmount'; renderWizard(); }); return;
  }

  if (flow.stage === 'incomeAmount') {
    setProgress('INCOME', 27);
    body.innerHTML = wizardHtml(`How much came from ${t.name}?`, 'Enter the amount you actually received.', `<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);
    bindBack(() => { flow.stage = 'incomeSource'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => { const v = $('#finMoney')?.value || ''; if (v === '' || !Number.isFinite(Number(v.replace(',', '.')))) return toast('Enter a valid amount', 'warn'); t.amount = n(v); flow.stage = 'incomeDate'; renderWizard(); }); return;
  }

  if (flow.stage === 'incomeDate') {
    const bounds = financeDateBounds(d.month);
    const saveIncome = (date) => { d.incomes.push({ name: t.name, amount: n(t.amount), date }); flow.temp = {}; flow.stage = 'incomeMore'; renderWizard(); };
    body.innerHTML = wizardHtml(`When was ${t.name} added?`, 'The date is optional. Leave it blank if there is no useful date to track.', `<label class="finance-date-field"><span>Date <small>Optional</small></span><input class="finance-input" id="finItemDate" type="date" min="${bounds.min}" max="${bounds.max}"></label><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><div><button class="btn ghost" data-fin-skip>Skip date</button><button class="btn primary big" data-fin-next>Save income</button></div></div>`);
    bindBack(() => { flow.stage = 'incomeAmount'; renderWizard(); });
    $('[data-fin-skip]')?.addEventListener('click', () => saveIncome(''));
    $('[data-fin-next]')?.addEventListener('click', () => { const raw = String($('#finItemDate')?.value || '').trim(); const safe = normalizeFinanceDate(raw, d.month); if (raw && !safe) return toast('Choose a date inside this month, or leave it blank', 'warn'); saveIncome(safe); });
    return;
  }

  if (flow.stage === 'incomeMore') {
    setProgress('INCOME', 31);
    body.innerHTML = wizardHtml('Any more income this month?', 'You can add as many sources as you need.', `${listHtml(d.incomes, (x) => x.name)}<div class="finance-choice-stack"><button class="finance-choice" data-fin-yes><div><strong>Yes, add another</strong></div><span>＋</span></button><button class="finance-choice" data-fin-no><div><strong>No, continue to expenses</strong></div><span>→</span></button></div>`);
    $('[data-fin-yes]')?.addEventListener('click', () => { flow.stage = 'incomeSource'; renderWizard(); }); $('[data-fin-no]')?.addEventListener('click', () => { flow.stage = 'expenseGroup'; renderWizard(); }); return;
  }

  if (flow.stage === 'editExistingIncome') {
    const idx = Number(t.editIncomeIndex), item = d.incomes?.[idx];
    if (!item) { flow.temp = {}; flow.stage = 'review'; renderWizard(); return; }
    const bounds = financeDateBounds(d.month);
    setProgress('EDIT INCOME', 34);
    body.innerHTML = wizardHtml(`Edit ${item.name}`, 'Update the amount or date for this saved draft income.', `<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(item.amount ?? ''))}" placeholder="0.00"></div><label class="finance-date-field"><span>Date <small>Optional</small></span><input class="finance-input" id="finItemDate" type="date" min="${bounds.min}" max="${bounds.max}" value="${esc(normalizeFinanceDate(item.date, d.month))}"></label><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Save change</button></div>`);
    bindBack(() => { flow.temp = {}; flow.stage = 'review'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => {
      const v = $('#finMoney')?.value || '';
      const raw = String($('#finItemDate')?.value || '').trim();
      const safe = normalizeFinanceDate(raw, d.month);
      if (v === '' || !Number.isFinite(Number(v.replace(',', '.')))) return toast('Enter a valid amount', 'warn');
      if (raw && !safe) return toast('Choose a date inside this month, or leave it blank', 'warn');
      item.amount = n(v);
      item.date = safe;
      flow.temp = {};
      flow.stage = 'review';
      renderWizard();
    });
    return;
  }

  if (flow.stage === 'editExistingExpense') {
    const idx = Number(t.editExpenseIndex), item = d.expenses?.[idx];
    if (!item) { flow.temp = {}; flow.stage = 'review'; renderWizard(); return; }
    const bounds = financeDateBounds(d.month);
    setProgress('EDIT EXPENSE', 58);
    body.innerHTML = wizardHtml(`Edit ${item.name || groupLabel(item.group)}`, 'Update this saved draft expense. Amount and date stay editable until the month is confirmed.', `<div class="finance-reference finance-tone-${groupTone(item.group)}"><span>${esc(categoryLabel(groupTone(item.group)))}</span><strong>${esc(item.name || groupLabel(item.group))}</strong></div><div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(item.amount ?? ''))}" placeholder="0.00"></div><label class="finance-date-field"><span>Date <small>Optional</small></span><input class="finance-input" id="finItemDate" type="date" min="${bounds.min}" max="${bounds.max}" value="${esc(normalizeFinanceDate(item.date, d.month))}"></label><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Save change</button></div>`);
    bindBack(() => { flow.temp = {}; flow.stage = 'review'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => {
      const v = $('#finMoney')?.value || '';
      const raw = String($('#finItemDate')?.value || '').trim();
      const safe = normalizeFinanceDate(raw, d.month);
      if (v === '' || !Number.isFinite(Number(v.replace(',', '.')))) return toast('Enter a valid amount', 'warn');
      if (raw && !safe) return toast('Choose a date inside this month, or leave it blank', 'warn');
      item.amount = n(v);
      item.date = safe;
      flow.temp = {};
      flow.stage = 'review';
      renderWizard();
    });
    return;
  }

  if (flow.stage === 'expenseGroup') {
    setProgress('EXPENSES', 42);
    const groupHelp = actor() === 'Principe' ? 'Colors follow his categories: Fixed expenses, Subscriptions, Variable expenses, Savings and Other.' : 'Colors follow your spreadsheet groups: Medical, Subscriptions, Budgets, Savings/Investments and Other.';
    body.innerHTML = wizardHtml(d.expenses.length ? 'What kind of expense are you adding?' : 'What did you spend or set aside?', groupHelp, `${listHtml(d.expenses, (x) => `${x.name} · ${groupLabel(x.group)}`)}<div class="finance-group-grid">${manualGroups().map((g) => `<button class="finance-choice finance-tone-${g.tone}" data-fin-group="${g.key}"><div><strong>${esc(g.label)}</strong><small>${g.example ? esc(g.example) : g.defaultName ? 'Name filled automatically' : ''}</small></div><span>→</span></button>`).join('')}</div>${flow.partialMode ? '<div class="finance-actions"><button class="btn ghost" data-fin-partial-back>Back to specific expenses</button></div>' : d.expenses.length ? '<div class="finance-actions"><button class="btn ghost" data-fin-exp-done>Done with expenses</button></div>' : ''}`);
    $$('[data-fin-group]').forEach((btn) => btn.addEventListener('click', () => {
      const meta = groupMeta(btn.dataset.finGroup); flow.temp = { group: meta.key };
      if (meta.optionalName) { flow.temp.name = meta.defaultName; flow.stage = 'expenseOptionalName'; }
      else if (meta.defaultName) { flow.temp.name = meta.defaultName; flow.stage = 'expenseAmount'; }
      else flow.stage = 'expenseName';
      renderWizard();
    }));
    $('[data-fin-exp-done]')?.addEventListener('click', () => { flow.stage = nextAfterExpensesStage(); renderWizard(); });
    $('[data-fin-partial-back]')?.addEventListener('click', () => { flow.temp = {}; flow.stage = 'partialChoose'; renderWizard(); });
    return;
  }

  if (flow.stage === 'expenseName') {
    const meta = groupMeta(t.group); setProgress('EXPENSES', 49);
    body.innerHTML = wizardHtml(`Name this ${meta.label.toLowerCase()} expense`, meta.example || 'Use whatever label makes sense to you.', `<input class="finance-input" id="finText" placeholder="${esc(meta.example || 'Expense name')}"><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);
    bindBack(() => { flow.stage = flow.partialMode && flow.partialGroup ? 'partialCategory' : 'expenseGroup'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => { const v = String($('#finText')?.value || '').trim(); if (!v) return toast('Add the expense name first', 'warn'); t.name = v; flow.stage = 'expenseAmount'; renderWizard(); }); return;
  }

  if (flow.stage === 'expenseOptionalName') {
    setProgress('EXPENSES', 49);
    body.innerHTML = wizardHtml('What was this Extra spend for?', 'Optional. Leave it as “Extra”, or add a subcategory/reason such as clothes, games or going out.', `<input class="finance-input" id="finText" placeholder="e.g. Clothes"><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn ghost" data-fin-skip>Skip · use Extra</button><button class="btn primary big" data-fin-next>Next</button></div>`);
    bindBack(() => { flow.stage = flow.partialMode && flow.partialGroup ? 'partialCategory' : 'expenseGroup'; renderWizard(); });
    $('[data-fin-skip]')?.addEventListener('click', () => { t.name = 'Extra'; flow.stage = 'expenseAmount'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => { const v = String($('#finText')?.value || '').trim(); t.name = v || 'Extra'; flow.stage = 'expenseAmount'; renderWizard(); }); return;
  }

  if (flow.stage === 'expenseAmount') {
    const meta = groupMeta(t.group); setProgress('EXPENSES', 56);
    body.innerHTML = wizardHtml(`How much was ${t.name}?`, meta.key === 'extra' ? `This counts toward your ${money(hasValue(d.extraBudget) ? d.extraBudget : 250)} monthly Extra budget.` : 'Enter the amount for this month.', `<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);
    bindBack(() => { if (meta.optionalName) flow.stage = 'expenseOptionalName'; else if (meta.defaultName) flow.stage = flow.partialMode && flow.partialGroup ? 'partialCategory' : 'expenseGroup'; else flow.stage = 'expenseName'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => { const v = $('#finMoney')?.value || ''; if (v === '' || !Number.isFinite(Number(v.replace(',', '.')))) return toast('Enter a valid amount', 'warn'); t.amount = n(v); flow.stage = 'expenseDate'; renderWizard(); }); return;
  }

  if (flow.stage === 'expenseDate') {
    const bounds = financeDateBounds(d.month);
    const saveExpense = (date) => { d.expenses.push({ group: t.group, name: t.name, amount: n(t.amount), date }); flow.temp = {}; flow.stage = flow.partialMode ? (flow.partialGroup ? 'partialCategory' : 'partialChoose') : 'expenseMore'; renderWizard(); };
    body.innerHTML = wizardHtml(`When was ${t.name} removed?`, 'The date is optional. Leave it blank if there is no useful date to track.', `<label class="finance-date-field"><span>Date <small>Optional</small></span><input class="finance-input" id="finItemDate" type="date" min="${bounds.min}" max="${bounds.max}"></label><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><div><button class="btn ghost" data-fin-skip>Skip date</button><button class="btn primary big" data-fin-next>Save expense</button></div></div>`);
    bindBack(() => { flow.stage = 'expenseAmount'; renderWizard(); });
    $('[data-fin-skip]')?.addEventListener('click', () => saveExpense(''));
    $('[data-fin-next]')?.addEventListener('click', () => { const raw = String($('#finItemDate')?.value || '').trim(); const safe = normalizeFinanceDate(raw, d.month); if (raw && !safe) return toast('Choose a date inside this month, or leave it blank', 'warn'); saveExpense(safe); });
    return;
  }

  if (flow.stage === 'expenseMore') {
    setProgress('EXPENSES', 60);
    const moreHelp = actor() === 'Principe' ? 'Keep adding expenses or savings until the month is complete.' : 'Keep adding expenses, Save up or Investments until the month is complete.';
    body.innerHTML = wizardHtml('Anything else this month?', moreHelp, `${listHtml(d.expenses, (x) => `${x.name} · ${groupLabel(x.group)}`)}<div class="finance-choice-stack"><button class="finance-choice" data-fin-yes><div><strong>Yes, add another</strong></div><span>＋</span></button><button class="finance-choice" data-fin-no><div><strong>No, continue</strong></div><span>→</span></button></div>`);
    $('[data-fin-yes]')?.addEventListener('click', () => { flow.stage = 'expenseGroup'; renderWizard(); }); $('[data-fin-no]')?.addEventListener('click', () => { flow.stage = nextAfterExpensesStage(); renderWizard(); }); return;
  }

  if (flow.stage === 'extraBudget') {
    setProgress('EXTRA BUDGET', 70);
    body.innerHTML = wizardHtml('What is your Extra spending limit this month?', 'Default is €250. You can change it for a specific month. This is a limit, not an expense. Twogether will warn you when your actual Extra purchases go above it.', `<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(hasValue(d.extraBudget) ? d.extraBudget : 250))}" placeholder="250.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);
    bindBack(() => { flow.stage = 'expenseGroup'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => { const v = $('#finMoney')?.value || ''; if (v === '' || !Number.isFinite(Number(v.replace(',', '.')))) return toast('Enter a valid Extra budget', 'warn'); d.extraBudget = 250; flow.stage = 'extraSpentAsk'; renderWizard(); }); return;
  }

  if (flow.stage === 'investmentTotal') {
    setProgress('INVESTMENTS', 80);
    body.innerHTML = wizardHtml('What is the investment account worth now?', 'Enter the full current investment value for this month. This is separate from how much you contributed this month.', `<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(d.investmentTotal ?? ''))}" placeholder="0.00"></div><button class="btn ghost full" type="button" data-fin-skip style="margin-top:10px">Skip investment snapshot this month</button><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);
    bindBack(() => { flow.stage = 'extraSpentAsk'; renderWizard(); });
    $('[data-fin-skip]')?.addEventListener('click', () => { d.investmentTotal = ''; d.sisterInvestments = ''; flow.stage = 'review'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => { const v = $('#finMoney')?.value || ''; if (v === '' || !Number.isFinite(Number(v.replace(',', '.')))) return toast('Enter a valid investment total', 'warn'); d.investmentTotal = n(v); flow.stage = 'sisterInvestments'; renderWizard(); }); return;
  }

  if (flow.stage === 'sisterInvestments') {
    setProgress('INVESTMENTS', 88);
    body.innerHTML = wizardHtml('How much of that belongs to Sis?', 'Twogether subtracts Sis’s amount from the total to calculate your own investment value.', `<div class="finance-reference"><span>Total investment account</span><strong>${money(d.investmentTotal)}</strong></div><div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(d.sisterInvestments ?? 0))}" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Review</button></div>`);
    bindBack(() => { flow.stage = 'investmentTotal'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => { const v = $('#finMoney')?.value || '0'; if (!Number.isFinite(Number(v.replace(',', '.')))) return toast('Enter a valid amount', 'warn'); d.sisterInvestments = n(v); if (n(d.sisterInvestments) > n(d.investmentTotal)) return toast('Sis’s amount cannot be higher than the investment total', 'warn'); flow.stage = 'review'; renderWizard(); }); return;
  }

  renderReview();
}

function renderReview() {
  const body = $('#financeWizardBody'); if (!body || !flow) return;
  const rules = financeRules();
  const d = flow.data, c = calc(d), gl = rules.investmentTracking ? investmentGL(d) : null, carry = extraCarryInfo(d.month); setProgress('REVIEW', 100);
  const incomeRows = d.incomes.map((x, i) => `<div class="finance-list-row"><span>${esc(x.name)}${financeDateMeta(x.date)}</span><strong>${money(x.amount)} <button class="text-btn" data-fin-edit-income="${i}">Edit</button> <button class="text-btn" data-fin-remove-income="${i}">×</button></strong></div>`).join('') || '<div class="finance-empty">No income added.</div>';
  const expenseRows = groupedExpenseHtml(d.expenses, true, d.extraSpends || []) || '<div class="finance-empty">No expenses added.</div>';
  const extraLine = rules.extraTracking && c.extraOver > 0 ? `<div class="finance-alert bad">⚠ ${money(c.extraOver)} spent beyond this month’s Extra budget.</div>` : '';
  const savedUpSpent = rules.savedUpExtraTracking ? (d.extraSpends || []).filter((x) => x.source === 'savings').reduce((sum, x) => sum + n(x.amount), 0) : 0;
  const savedUpLine = savedUpSpent > 0 ? `<div class="finance-carry-note">${money(savedUpSpent)} will be taken from Saved up when this month is saved.</div>` : '';
  const debtLine = rules.extraTracking && carry.debt > 0 ? `<div class="finance-carry-note">You still owe yourself ${money(carry.debt)} from ${esc(monthLabel(carry.prevMonth))}.</div>` : '';
  const investmentLines = rules.investmentTracking ? (c.investmentTotal == null ? '<div class="finance-breakdown-row"><span>Investment snapshot</span><strong>Skipped</strong></div>' : `<div class="finance-breakdown-row finance-tone-wealth"><span>Total investments</span><strong>${money(c.investmentTotal)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Sis</span><strong>${money(c.sisterInvestments)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Your investments</span><strong>${money(c.ownInvestments)}</strong></div><div class="finance-breakdown-row ${gl?.value < 0 ? 'finance-negative' : 'finance-positive'}"><span>G/L p/m${gl ? ` vs ${monthLabel(gl.previousMonth)}` : ''}</span><strong>${gl ? signedMoney(gl.value) : '—'}</strong></div>`) : '';
  const extraActions = rules.extraTracking
    ? (c.extraOver > 0 ? '<button class="btn ghost" type="button" data-fin-edit-extra-spend>Edit extra money used</button>' : '<button class="btn ghost" type="button" data-fin-edit-extra-spend>Log extra money used</button>')
    : rules.savedUpExtraTracking
      ? (savedUpSpent > 0 ? '<button class="btn ghost" type="button" data-fin-edit-extra-spend>Edit Saved up spending</button>' : '<button class="btn ghost" type="button" data-fin-edit-extra-spend>Log Saved up spending</button>')
      : '';
  const investmentSection = rules.investmentTracking ? `<div class="finance-review-section"><h3>Investment tracking</h3>${investmentLines}<button class="btn ghost" data-fin-edit-investments>Edit investment snapshot</button></div>` : '';
  body.innerHTML = wizardHtml(`Ready to save ${monthLabel(d.month)}?`, 'Review your personal monthly picture before saving.', `<div class="finance-summary-line"><div class="finance-summary-mini"><span>Income</span><strong>${money(c.income)}</strong></div><div class="finance-summary-mini"><span>Outflow</span><strong>${money(c.outflow)}</strong></div><div class="finance-summary-mini"><span>${c.leftover < 0 ? 'Overspent' : 'Leftover'}</span><strong>${money(Math.abs(c.leftover))}</strong></div></div>${extraLine}${savedUpLine}${debtLine}<div class="finance-review-section"><h3>Income</h3>${incomeRows}<button class="btn ghost" data-fin-add-income>Add income</button></div><div class="finance-review-section"><h3>Outflow</h3>${expenseRows}<button class="btn ghost" data-fin-add-expense>Add expense</button>${extraActions}</div>${investmentSection}<div class="finance-actions finance-save-actions"><button class="btn ghost" data-fin-cancel>Cancel</button><div><button class="btn ghost" data-fin-save-draft>Save draft</button><button class="btn primary big" data-fin-finalize>Confirm month</button></div></div>`);
  $$('[data-fin-edit-income]').forEach((btn) => btn.addEventListener('click', () => { flow.temp = { editIncomeIndex: Number(btn.dataset.finEditIncome) }; flow.stage = 'editExistingIncome'; renderWizard(); }));
  $$('[data-fin-remove-income]').forEach((btn) => btn.addEventListener('click', () => { d.incomes.splice(Number(btn.dataset.finRemoveIncome), 1); renderReview(); }));
  $$('[data-fin-edit-expense]').forEach((btn) => btn.addEventListener('click', () => { flow.temp = { editExpenseIndex: Number(btn.dataset.finEditExpense) }; flow.stage = 'editExistingExpense'; renderWizard(); }));
  $$('[data-fin-remove-expense]').forEach((btn) => btn.addEventListener('click', () => { d.expenses.splice(Number(btn.dataset.finRemoveExpense), 1); renderReview(); }));
  $('[data-fin-add-income]')?.addEventListener('click', () => { flow.stage = 'incomeSource'; renderWizard(); });
  $('[data-fin-add-expense]')?.addEventListener('click', () => { flow.stage = 'expenseGroup'; renderWizard(); });
  $('[data-fin-edit-extra-spend]')?.addEventListener('click', () => { flow.extraReturn = 'review'; flow.stage = rules.savedUpExtraTracking ? 'savedUpSpentAsk' : 'extraSpentAsk'; renderWizard(); });
  $('[data-fin-edit-investments]')?.addEventListener('click', () => { flow.stage = 'investmentTotal'; renderWizard(); });
  $('[data-fin-cancel]')?.addEventListener('click', resetWizard);
  $('[data-fin-save-draft]')?.addEventListener('click', () => saveMonth(false));
  $('[data-fin-finalize]')?.addEventListener('click', () => saveMonth(true));
}

async function confirmExistingMonth(rec) {
  if (!rec || rec.finalized === true) return;
  const d = cloneRecord(rec); d.finalized = true; d.finalizedAt = new Date().toISOString();
  try {
    const result = await post('saveFinanceMonth', { monthData: d });
    if (result?.financeProfile) financeState.financeProfiles[actor()] = normalizeProfile(result.financeProfile);
    const list = financeState.finances[actor()] || []; const idx = list.findIndex((x) => x.month === d.month);
    const saved = { ...d, updatedAt: new Date().toISOString(), updatedBy: actor() };
    if (idx >= 0) list[idx] = saved; else list.push(saved);
    renderPage(); renderDetail(saved); toast('Month confirmed and locked'); setTimeout(loadState, 1200);
  } catch (err) { toast(err.message || 'Could not confirm month', 'warn'); }
}

async function saveMonth(finalize = false) {
  if (!flow) return;
  const d = cloneRecord(flow.data); if (!d.month) return toast('Choose a month first', 'warn');
  if (flow.partialMode) {
    d.partialOnly = true;
    d.expenses = (d.expenses || []).filter((x) => !(normalizeGroup(x.group) === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra'));
  }
  d.finalized = !!finalize; d.finalizedAt = finalize ? new Date().toISOString() : '';
  const btn = $(finalize ? '[data-fin-finalize]' : '[data-fin-save-draft]'); if (btn) btn.disabled = true;
  try {
    const result = await post('saveFinanceMonth', { monthData: d });
    if (result?.financeProfile) financeState.financeProfiles[actor()] = normalizeProfile(result.financeProfile);
    const list = financeState.finances[actor()] || [];
    const idx = list.findIndex((x) => x.month === d.month);
    const saved = { ...d, updatedAt: new Date().toISOString(), updatedBy: actor() };
    if (idx >= 0) list[idx] = saved; else list.push(saved);
    list.sort((a, b) => String(a.month).localeCompare(String(b.month)));
    selectedMonth = d.month; flow = null; renderPage(); renderWizard(); renderDetail(saved); toast(finalize ? 'Month confirmed and locked' : 'Draft saved — you can keep editing it'); setTimeout(loadState, 1400);
  } catch (err) { toast(err.message || 'Could not save month', 'warn'); if (btn) btn.disabled = false; }
}

function init() {
  const tab = $('.tab[data-sheet="finances"]'); if (!tab) return;
  ensureMiniModal();
  tab.addEventListener('click', () => { renderPage(); setTimeout(loadState, 50); });
  $('#financeManageRecurring')?.addEventListener('click', openRecurringManager);
  document.addEventListener('twogether:open-shared-jar', (e) => openSharedJarHistory(e.detail || {}));
  document.addEventListener('twogether:edit-shared-jar', (e) => openSharedJarModal(e.detail?.balance));
  document.addEventListener('twogether:saved', () => { loadState().catch(() => {}); });
  document.addEventListener('twogether:notification-action',(event)=>{
    if(event.detail?.kind!=='finance-recurring')return;
    if(event.detail?.choice==='not-yet'){publishFinanceNotifications();return;}
    if(event.detail?.choice!=='yes')return;
    const reminder=financeReminderById(String(event.detail?.id||''));
    if(reminder)openFinanceReminderConfirm(reminder);
    else publishFinanceNotifications();
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(()=>loadState().catch(()=>{}),40);});
  const obs = new MutationObserver(() => {
    publishFinanceNotifications();
    setTimeout(()=>loadState().catch(()=>{}),40);
    if ($('#finances')?.classList.contains('active')) { flow = null; renderPage(); }
  });
  obs.observe(document.body, { attributes: true, attributeFilter: ['data-actor'] });
  renderPage();
  setTimeout(()=>loadState().catch(()=>{}),50);
}

document.addEventListener('DOMContentLoaded', init);
