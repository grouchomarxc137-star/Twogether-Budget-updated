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

let financeState = {
  version: 0,
  finances: { Principessa: [], Principe: [] },
  financeProfiles: { Principessa: freshProfile(), Principe: freshProfile() },
};
let flow = null;
let selectedMonth = '2026-09';
let loading = false;

const signedMoney = (v) => `${n(v) >= 0 ? '+' : '−'}${money(Math.abs(n(v)))}`;
const monthLabel = (m) => MONTHS.find((x) => x[0] === m)?.[1] || m;

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
  return { bankAccounts: [], savingsTotal: '', savingsReserved: [], receivables: [], scenarios: [], wishlist: [], compareLab: {}, recurring: normalizeRecurringConfig({}), updatedAt: '', updatedBy: '' };
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
      repayments: Array.isArray(x.repayments) ? x.repayments.map((r) => ({ id: r.id || uid(), month: String(r.month || ''), amount: r.amount ?? '', at: String(r.at || '') })) : [],
    })) : [],
    scenarios: Array.isArray(p.scenarios) ? p.scenarios.map((x) => ({ id: x.id || uid(), name: String(x.name || ''), upfront: x.upfront ?? '', monthly: x.monthly ?? '' })) : [],
    wishlist: Array.isArray(p.wishlist) ? JSON.parse(JSON.stringify(p.wishlist)) : [],
    compareLab: p.compareLab && typeof p.compareLab === 'object' ? JSON.parse(JSON.stringify(p.compareLab)) : {},
    recurring: normalizeRecurringConfig(p.recurring),
    updatedAt: p.updatedAt || '', updatedBy: p.updatedBy || '',
  };
}
function profile() {
  const a = actor();
  return a ? normalizeProfile(financeState.financeProfiles?.[a]) : freshProfile();
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
function recurringExpenseGroups() {
  return manualGroups().filter((g) => g.key !== 'extra');
}

function post(action, payload) { return window.TwogetherAPI.post(action, payload, actor()); }

function ownMonths() { return financeState.finances?.[actor()] || []; }
function recordFor(month) { return ownMonths().find((x) => x.month === month) || null; }
function hasValue(v) { return v !== '' && v != null; }
function normalizeFinanceRecord(rec, owner = actor()) {
  const copy = JSON.parse(JSON.stringify(rec || {}));
  const rules = financeRules(owner);
  copy.incomes = Array.isArray(copy.incomes) ? copy.incomes.map((x) => ({ ...x, date: normalizeFinanceDate(x.date, copy.month) })) : [];
  copy.expenses = Array.isArray(copy.expenses) ? copy.expenses.map((x) => ({ ...x, group: normalizeGroup(x.group), date: normalizeFinanceDate(x.date, copy.month) })) : [];
  const fixedExtras = copy.expenses.filter((x) => normalizeGroup(x.group) === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra');
  if (rules.extraTracking) {
    const storedBudget = hasValue(copy.extraBudget) ? n(copy.extraBudget) : (fixedExtras.length && hasValue(fixedExtras[0].amount) ? n(fixedExtras[0].amount) : rules.extraBudget);
    copy.extraBudget = storedBudget;
    copy.expenses = copy.expenses.filter((x) => normalizeGroup(x.group) !== 'extra' || String(x.name || '').trim().toLowerCase() !== 'extra' || x === fixedExtras[0]);
    if (!copy.expenses.some((x) => normalizeGroup(x.group) === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra')) copy.expenses.push({ group: 'extra', name: 'Extra', amount: storedBudget, date: '' });
    copy.expenses.forEach((x) => { if (normalizeGroup(x.group) === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra') { x.amount = storedBudget; x.date = ''; } });
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
  const owedTotal = p.receivables.reduce((sum, x) => sum + loanRemaining(x), 0);
  const latestInvestment = [...ownMonths()].filter((x) => hasValue(x.investmentTotal)).sort((a, b) => String(b.month).localeCompare(String(a.month)))[0] || null;
  const inv = latestInvestment ? calc(latestInvestment) : { investmentTotal: null, sisterInvestments: 0, ownInvestments: null };
  const gl = latestInvestment ? investmentGL(latestInvestment) : null;
  const ownInvestments = inv.ownInvestments == null ? 0 : inv.ownInvestments;
  const netWorth = availableSavings + ownInvestments;
  const mainLeftover = mainAccountLeftover();
  return { p, bankTotal, savingsTotal, heldTotal, availableSavings, owedTotal, latestInvestment, inv, gl, netWorth, mainLeftover };
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
      };
      renderPage();
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
  const housePercent = HOUSE_GOAL_TARGET > 0 ? Math.max(0, (ps.netWorth / HOUSE_GOAL_TARGET) * 100) : 0;
  const houseProgress = Math.min(100, housePercent);
  const houseMarker = Math.min(98, Math.max(2, houseProgress));
  const housePercentLabel = housePercent.toFixed(1).replace(/\.0$/, '');
  const houseRemaining = Math.max(0, HOUSE_GOAL_TARGET - ps.netWorth);
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
          <div class="finance-house-goal-money"><strong>${money(ps.netWorth)}</strong><span>of ${money(HOUSE_GOAL_TARGET)}</span></div>
          <div class="finance-house-goal-track" role="progressbar" aria-label="House goal progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${houseProgress.toFixed(1)}">
            <span style="width:${houseProgress}%"></span><i style="left:${houseMarker}%" aria-hidden="true">♡</i>
          </div>
          <div class="finance-house-goal-foot">
            <span>${houseRemaining > 0 ? `${money(houseRemaining)} to go` : 'Dream-home goal reached ♡'}</span>
            <small>Saved up + investments update this automatically.</small>
          </div>
        </div>
      </article>`;
  }
  renderCurrentPanel();
  renderScenarioPanel();

  const root = $('#financeMonths'); if (!root) return;
  root.innerHTML = MONTHS.map(([key, label]) => {
    const rec = recordFor(key), c = calc(rec || {}), gl = rec ? investmentGL(rec) : null;
    const statusClass = rec ? (rec.finalized ? 'status-final' : 'status-draft') : 'status-empty';
    const extraWarn = rec && c.extraOver > 0 ? `<em class="finance-warning">⚠ Extra ${money(c.extraOver)} over</em>` : '';
    const glText = gl ? `<em class="finance-month-gl ${gl.value < 0 ? 'down' : 'up'}">${gl.value < 0 ? '▼' : '▲'} ${money(Math.abs(gl.value))}</em>` : '';
    return `<button class="finance-month ${rec ? 'saved' : ''} ${statusClass} ${key === '2026-09' ? 'current' : ''}" type="button" data-fin-month="${key}"><span>${esc(label)}</span><strong>${rec ? money(c.leftover) : 'Not logged'}</strong><small>${rec ? `${money(c.income)} in · ${money(c.outflow)} out` : 'Tap to start'}</small>${extraWarn}${glText}</button>`;
  }).join('');
  $$('[data-fin-month]', root).forEach((btn) => btn.addEventListener('click', () => {
    selectedMonth = btn.dataset.finMonth;
    const rec = recordFor(selectedMonth);
    if (rec) renderDetail(rec);
    else { flow = null; renderWizard(); }
  }));
  const detail = $('#financeDetail'); if (detail && !recordFor(selectedMonth)) detail.innerHTML = '';
}

function renderCurrentPanel() {
  const root = $('#financeCurrent'); if (!root) return;
  const { p, bankTotal, savingsTotal, heldTotal, availableSavings, owedTotal, latestInvestment, inv, gl, netWorth } = profileStats();
  const banks = p.bankAccounts.length ? p.bankAccounts.map((x, i) => `<button class="finance-current-row" type="button" data-fin-edit-bank="${i}"><span>${esc(x.name)}</span><strong>${money(x.balance)}</strong></button>`).join('') : '<div class="finance-current-empty">No bank balances added yet.</div>';
  const holds = p.savingsReserved.length ? p.savingsReserved.map((x, i) => `<button class="finance-current-row" type="button" data-fin-edit-hold="${i}"><span>${esc(x.name)}</span><strong>${money(x.amount)}</strong></button>`).join('') : '<div class="finance-current-empty">Nothing earmarked yet.</div>';
  const owed = p.receivables.length ? p.receivables.map((x, i) => { const paid = loanPaid(x), remaining = loanRemaining(x); return `<button class="finance-current-row" type="button" data-fin-edit-owed="${i}"><span>${esc(x.person)}<small>${esc(x.reason || 'Reason not added')} · Lent ${money(x.principal)} · Repaid ${money(paid)}</small></span><strong>${money(remaining)}</strong></button>`; }).join('') : '<div class="finance-current-empty">Nobody logged as owing you money.</div>';
  root.innerHTML = `
    <div class="finance-current-head"><div><span class="panel-kicker">CURRENT POSITION</span><h2>${esc(actor())}’s balances</h2><p>Bank balances are informational only. Loan repayments go back into Saved up automatically, but never count as monthly income.</p></div></div>
    <div class="finance-current-grid">
      <article class="finance-current-card tone-other" data-fin-current-cash><div class="finance-current-title"><div><span>BANKS</span><h3>Current cash</h3></div><strong data-fin-current-cash-total>${money(bankTotal)}</strong></div>${banks}<button class="btn ghost finance-add" type="button" data-fin-add-bank>+ Add bank</button><small class="finance-card-note">Tap any bank to edit its balance. Not included in net worth.</small></article>
      <article class="finance-current-card tone-wealth"><div class="finance-current-title"><div><span>SAVINGS</span><h3>Saved up</h3></div><strong>${money(availableSavings)}</strong></div><div class="finance-current-metrics"><div><span>Total saved</span><strong>${money(savingsTotal)}</strong></div><div><span>On hold</span><strong>${money(heldTotal)}</strong></div><div class="${availableSavings < 0 ? 'negative' : ''}"><span>Actually available</span><strong>${money(availableSavings)}</strong></div></div>${holds}<div class="finance-card-actions"><button class="btn ghost" type="button" data-fin-edit-savings>Edit saved total</button><button class="btn ghost" type="button" data-fin-add-hold>+ Add hold</button></div></article>
      <article class="finance-current-card tone-receivable"><div class="finance-current-title"><div><span>PAYBACK</span><h3>Money owed to me</h3></div><strong>${money(owedTotal)}</strong></div>${owed}<button class="btn ghost finance-add" type="button" data-fin-add-owed>+ Add loan</button><small class="finance-card-note">Tap a loan to see original amount, repayment history and what is still left.</small></article>
      <article class="finance-current-card tone-wealth"><div class="finance-current-title"><div><span>INVESTMENTS</span><h3>Your investment value</h3></div><strong>${money(inv.ownInvestments || 0)}</strong></div><div class="finance-current-metrics"><div><span>Total account</span><strong>${inv.investmentTotal == null ? '—' : money(inv.investmentTotal)}</strong></div><div><span>Sis</span><strong>${inv.investmentTotal == null ? '—' : money(inv.sisterInvestments)}</strong></div><div class="${gl?.value < 0 ? 'negative' : 'positive'}"><span>G/L p/m</span><strong>${gl ? signedMoney(gl.value) : '—'}</strong></div></div><div class="finance-networth"><span>Current net worth</span><strong>${money(netWorth)}</strong><small>${latestInvestment ? `Investment snapshot: ${monthLabel(latestInvestment.month)}` : 'Log an investment snapshot in a month'}</small></div></article>
    </div>`;
  $('[data-fin-add-bank]', root)?.addEventListener('click', () => openBankModal(-1));
  $$('[data-fin-edit-bank]', root).forEach((btn) => btn.addEventListener('click', () => openBankModal(Number(btn.dataset.finEditBank))));
  $('[data-fin-edit-savings]', root)?.addEventListener('click', openSavingsModal);
  $('[data-fin-add-hold]', root)?.addEventListener('click', () => openHoldModal(-1));
  $$('[data-fin-edit-hold]', root).forEach((btn) => btn.addEventListener('click', () => openHoldModal(Number(btn.dataset.finEditHold))));
  $('[data-fin-add-owed]', root)?.addEventListener('click', () => openOwedModal(-1));
  $$('[data-fin-edit-owed]', root).forEach((btn) => btn.addEventListener('click', () => openOwedModal(Number(btn.dataset.finEditOwed))));
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
  const tone = kind === 'income' ? 'other' : groupTone(item.group);
  const sub = kind === 'income' ? 'Income' : (actor() === 'Principe' ? categoryLabel(tone) : groupLabel(item.group));
  const day = normalizeRecurringDay(item.day);
  const timing = day === '' ? 'Date optional' : `Usually ${ordinalDay(day)}`;
  return `<button class="finance-recurring-row finance-tone-${tone}" type="button" data-fin-recurring-kind="${kind}" data-fin-recurring-index="${index}"><span><strong>${esc(item.name)}</strong><small>${esc(sub)} · ${esc(timing)}</small></span><b>${money(item.amount)} <i>›</i></b></button>`;
}

function openRecurringManager() {
  const config = recurringConfig();
  const incomes = config.incomes.length ? config.incomes.map((x, i) => recurringRow('income', x, i)).join('') : '<div class="finance-current-empty">No recurring income yet.</div>';
  const expenseRows = config.expenses.map((x, i) => ({ ...x, index: i, tone: groupTone(x.group) }));
  const grouped = {};
  expenseRows.forEach((x) => (grouped[x.tone] || (grouped[x.tone] = [])).push(x));
  const expenses = categoryOrder().filter((tone) => grouped[tone]?.length).map((tone) => `<div class="finance-recurring-group"><h3>${esc(categoryLabel(tone))}</h3>${grouped[tone].map((x) => recurringRow('expense', x, x.index)).join('')}</div>`).join('') || '<div class="finance-current-empty">No recurring expenses yet.</div>';
  showMini(`<span class="panel-kicker">MONTHLY DEFAULTS</span><h2>Manage recurring items</h2><p>These are the usual items Twogether asks you to confirm each month. Changes apply to future monthly check-ins only — confirmed months stay untouched.</p><div class="finance-recurring-section"><div class="finance-recurring-title"><h3>Income</h3><button class="text-btn" type="button" data-fin-recurring-add="income">+ Add</button></div>${incomes}</div><div class="finance-recurring-section"><div class="finance-recurring-title"><h3>Outflow</h3><button class="text-btn" type="button" data-fin-recurring-add="expense">+ Add</button></div>${expenses}</div>`);
  const modalBody = $('#financeMiniBody');
  if (modalBody) {
    modalBody.onclick = (e) => {
      const edit = e.target.closest?.('[data-fin-recurring-kind]');
      if (edit) {
        openRecurringEditor(edit.dataset.finRecurringKind, Number(edit.dataset.finRecurringIndex));
        return;
      }
      const add = e.target.closest?.('[data-fin-recurring-add]');
      if (add) openRecurringEditor(add.dataset.finRecurringAdd, -1);
    };
  }
}

function openRecurringEditor(kind, index) {
  const config = recurringConfig();
  const list = kind === 'income' ? config.incomes : config.expenses;
  const item = index >= 0 ? list[index] : null;
  const isExpense = kind === 'expense';
  const groups = recurringExpenseGroups();
  const selectedGroup = item?.group || groups[0]?.key || 'other';
  const groupField = isExpense ? `<label>Category<select id="finRecurringGroup">${groups.map((g) => `<option value="${g.key}" ${g.key === selectedGroup ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select></label>` : '';
  showMini(`<span class="panel-kicker">RECURRING ${isExpense ? 'OUTFLOW' : 'INCOME'}</span><h2>${item ? 'Edit recurring item' : 'Add recurring item'}</h2><p>This changes what is suggested in future monthly check-ins. The usual day is optional and can still be changed for a specific month.</p><div class="finance-mini-fields"><label>Name<input id="finRecurringName" value="${esc(item?.name || '')}" placeholder="${isExpense ? 'e.g. Spotify' : 'e.g. Salary'}"></label>${groupField}<label>Usual amount<div class="finance-money mini"><span>€</span><input id="finRecurringAmount" inputmode="decimal" value="${esc(String(item?.amount ?? ''))}" placeholder="0.00"></div></label><label>Usual day of month <small>Optional · e.g. 30</small><input id="finRecurringDay" type="number" inputmode="numeric" min="1" max="31" value="${esc(String(item?.day ?? ''))}" placeholder="Day"></label></div><div class="finance-mini-actions">${item ? '<button class="btn ghost" type="button" data-fin-recurring-delete>Remove</button>' : '<button class="btn ghost" type="button" data-fin-recurring-back>Back</button>'}<button class="btn primary" type="button" data-fin-recurring-save>Save</button></div>`);
  $('[data-fin-recurring-back]')?.addEventListener('click', openRecurringManager);
  $('[data-fin-recurring-save]')?.addEventListener('click', async () => {
    const name = String($('#finRecurringName')?.value || '').trim();
    const amount = $('#finRecurringAmount')?.value || '';
    const dayRaw = String($('#finRecurringDay')?.value || '').trim();
    const day = normalizeRecurringDay(dayRaw);
    if (!name) return toast('Add a name first', 'warn');
    if (amount === '' || !Number.isFinite(Number(amount.replace(',', '.')))) return toast('Enter a valid amount', 'warn');
    if (dayRaw && day === '') return toast('Choose a day from 1 to 31, or leave it blank', 'warn');
    const next = profile();
    const nextConfig = recurringConfig();
    nextConfig.custom = true;
    const row = { id: item?.id || uid(), name, amount: n(amount), day };
    if (isExpense) row.group = $('#finRecurringGroup')?.value || selectedGroup;
    const target = isExpense ? nextConfig.expenses : nextConfig.incomes;
    if (index >= 0) target[index] = row; else target.push(row);
    next.recurring = nextConfig;
    await saveProfile(next, 'Recurring item saved');
  });
  $('[data-fin-recurring-delete]')?.addEventListener('click', async () => {
    const next = profile();
    const nextConfig = recurringConfig();
    nextConfig.custom = true;
    const target = isExpense ? nextConfig.expenses : nextConfig.incomes;
    target.splice(index, 1);
    next.recurring = nextConfig;
    await saveProfile(next, 'Recurring item removed');
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

function renderDetail(rec) {
  if (!rec) return;
  const legacyRoot = $('#financeDetail');
  if (legacyRoot) legacyRoot.innerHTML = '';
  const rules = financeRules();
  const c = calc(rec), gl = rules.investmentTracking ? investmentGL(rec) : null, carry = extraCarryInfo(rec.month);
  const expenses = groupedExpenseHtml(rec.expenses || [], false, rec.extraSpends || []);
  const incomes = (rec.incomes || []).map((x) => `<div class="finance-breakdown-row"><span>${esc(x.name)}${financeDateMeta(x.date)}</span><strong>${money(x.amount)}</strong></div>`).join('');
  const extraStatus = rules.extraTracking && c.extraOver > 0 ? `<div class="finance-alert bad">⚠ ${money(c.extraOver)} spent beyond this month’s Extra budget.</div>` : '';
  const debtStatus = rules.extraTracking && carry.debt > 0 ? `<div class="finance-carry-note">You still owe yourself ${money(carry.debt)} from ${esc(monthLabel(carry.prevMonth))}.</div>` : '';
  const investmentBlock = rules.investmentTracking && c.investmentTotal != null ? `<div class="finance-review-section"><h3>Investment snapshot</h3><div class="finance-breakdown-row finance-tone-wealth"><span>Total investment account</span><strong>${money(c.investmentTotal)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Sis</span><strong>${money(c.sisterInvestments)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Your investments</span><strong>${money(c.ownInvestments)}</strong></div><div class="finance-breakdown-row ${gl?.value < 0 ? 'finance-negative' : 'finance-positive'}"><span>G/L p/m${gl ? ` vs ${monthLabel(gl.previousMonth)}` : ''}</span><strong>${gl ? signedMoney(gl.value) : '—'}</strong></div></div>` : '';
  showMini(`<div class="finance-month-detail-window"><div class="finance-detail-head"><div><span class="panel-kicker">${esc(actor())}</span><h2>${esc(monthLabel(rec.month))}</h2></div>${rec.finalized ? '<span class="finance-final-badge">Locked</span>' : '<div class="finance-detail-actions"><button class="btn ghost" type="button" data-fin-edit>Edit draft</button><button class="btn primary" type="button" data-fin-finalize-existing>Confirm month</button></div>'}</div><div class="finance-summary-line"><div class="finance-summary-mini"><span>Income</span><strong>${money(c.income)}</strong></div><div class="finance-summary-mini"><span>Outflow</span><strong>${money(c.outflow)}</strong></div><div class="finance-summary-mini"><span>${c.leftover < 0 ? 'Overspent' : 'Leftover'}</span><strong>${money(Math.abs(c.leftover))}</strong></div></div>${extraStatus}${debtStatus}${incomes ? `<div class="finance-review-section"><h3>Income</h3>${incomes}</div>` : ''}${expenses ? `<div class="finance-review-section"><h3>Monthly outflow</h3>${expenses}</div>` : ''}${investmentBlock}</div>`);
  const modalBody = $('#financeMiniBody');
  $('[data-fin-edit]', modalBody)?.addEventListener('click', () => { closeMini(); startEdit(rec); });
  $('[data-fin-finalize-existing]', modalBody)?.addEventListener('click', () => confirmExistingMonth(rec));
}

function ensureMiniModal() {
  if ($('#financeMiniModal')) return;
  const modal = document.createElement('div');
  modal.id = 'financeMiniModal'; modal.className = 'finance-mini-modal'; modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = '<div class="finance-mini-backdrop" data-fin-mini-close></div><div class="finance-mini-card"><button class="finance-mini-close" type="button" data-fin-mini-close>×</button><div id="financeMiniBody"></div></div>';
  document.body.appendChild(modal);
  $$('[data-fin-mini-close]', modal).forEach((el) => el.addEventListener('click', closeMini));
}
function showMini(html) { ensureMiniModal(); $('#financeMiniBody').innerHTML = html; $('#financeMiniModal').classList.add('show'); $('#financeMiniModal').setAttribute('aria-hidden', 'false'); }
function closeMini() { const modal = $('#financeMiniModal'); modal?.classList.remove('show'); modal?.setAttribute('aria-hidden', 'true'); }

async function saveProfile(next, message = 'Balances updated') {
  const a = actor(); if (!a) return;
  const normalized = normalizeProfile(next);
  financeState.financeProfiles[a] = normalized;
  renderPage(); closeMini();
  try { await post('saveFinanceProfile', { profile: normalized }); toast(message); setTimeout(loadState, 1200); }
  catch (err) { toast(err.message || 'Could not save', 'warn'); }
}

function openSharedJarModal(balance) {
  showMini(`<span class="panel-kicker">SHARED JAR</span><h2>Edit Shared Jar</h2><p>Change how much is currently in the shared account. Existing accommodation contributions stay linked and future 20% contributions will continue to update this balance.</p><div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(n(balance)))}" placeholder="0.00"></div><div class="finance-mini-actions"><span></span><button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`);
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
  showMini(`<span class="panel-kicker">BANK BALANCE</span><h2>${item ? 'Edit bank' : 'Add bank'}</h2><p>Informational only — this does not change your net worth calculation.</p><div class="finance-mini-fields"><label>Bank / account<input id="finMiniName" value="${esc(item?.name || '')}" placeholder="e.g. ING"></label><label>Current balance<div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(item?.balance ?? ''))}" placeholder="0.00"></div></label></div><div class="finance-mini-actions">${item ? '<button class="btn ghost" type="button" data-fin-mini-delete>Delete</button>' : '<span></span>'}<button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`);
  $('[data-fin-mini-save]')?.addEventListener('click', () => {
    const name = String($('#finMiniName')?.value || '').trim(), amount = $('#finMiniAmount')?.value || '';
    if (!name) return toast('Add the bank name first', 'warn'); if (amount === '' || !Number.isFinite(Number(amount.replace(',', '.')))) return toast('Enter a valid balance', 'warn');
    const next = profile(); const row = { id: item?.id || uid(), name, balance: n(amount) }; if (index >= 0) next.bankAccounts[index] = row; else next.bankAccounts.push(row); saveProfile(next, 'Bank balance saved');
  });
  $('[data-fin-mini-delete]')?.addEventListener('click', () => { const next = profile(); next.bankAccounts.splice(index, 1); saveProfile(next, 'Bank removed'); });
}

function openSavingsModal() {
  const p = profile();
  showMini(`<span class="panel-kicker">SAVED UP</span><h2>Update total savings</h2><p>Enter the full saved-up amount before Twogether subtracts the money you have earmarked/on hold.</p><div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(p.savingsTotal ?? ''))}" placeholder="0.00"></div><div class="finance-mini-actions"><span></span><button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`);
  $('[data-fin-mini-save]')?.addEventListener('click', () => { const amount = $('#finMiniAmount')?.value || ''; if (amount === '' || !Number.isFinite(Number(amount.replace(',', '.')))) return toast('Enter a valid savings total', 'warn'); const next = profile(); next.savingsTotal = n(amount); saveProfile(next, 'Savings total updated'); });
}

function openHoldModal(index) {
  const p = profile(), item = index >= 0 ? p.savingsReserved[index] : null;
  showMini(`<span class="panel-kicker">SAVINGS ON HOLD</span><h2>${item ? 'Edit earmarked money' : 'Add savings on hold'}</h2><p>This stays inside your total savings, but is subtracted from the amount you consider actually available.</p><div class="finance-mini-fields"><label>What is it reserved for?<input id="finMiniName" value="${esc(item?.name || '')}" placeholder="e.g. Driving licence"></label><label>Amount<div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(item?.amount ?? ''))}" placeholder="0.00"></div></label></div><div class="finance-mini-actions">${item ? '<button class="btn ghost" type="button" data-fin-mini-delete>Delete</button>' : '<span></span>'}<button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`);
  $('[data-fin-mini-save]')?.addEventListener('click', () => { const name = String($('#finMiniName')?.value || '').trim(), amount = $('#finMiniAmount')?.value || ''; if (!name) return toast('Add what this money is for', 'warn'); if (amount === '' || !Number.isFinite(Number(amount.replace(',', '.')))) return toast('Enter a valid amount', 'warn'); const next = profile(); const row = { id: item?.id || uid(), name, amount: n(amount) }; if (index >= 0) next.savingsReserved[index] = row; else next.savingsReserved.push(row); saveProfile(next, 'Savings hold saved'); });
  $('[data-fin-mini-delete]')?.addEventListener('click', () => { const next = profile(); next.savingsReserved.splice(index, 1); saveProfile(next, 'Savings hold removed'); });
}

function openOwedModal(index) {
  const p = profile(), item = index >= 0 ? p.receivables[index] : null;
  if (!item) {
    showMini(`<span class="panel-kicker">NEW LOAN</span><h2>Add money someone owes you</h2><p>Track the original amount you lent. Repayments will be recorded separately.</p><div class="finance-mini-fields"><label>Who owes you?<input id="finMiniPerson" placeholder="e.g. Sis"></label><label>Original amount lent<div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" placeholder="0.00"></div></label><label class="full">Why did you lend it?<input id="finMiniReason" placeholder="e.g. IP17"></label></div><div class="finance-mini-actions"><span></span><button class="btn primary" type="button" data-fin-mini-save>Save loan</button></div>`);
    $('[data-fin-mini-save]')?.addEventListener('click', () => { const person = String($('#finMiniPerson')?.value || '').trim(), reason = String($('#finMiniReason')?.value || '').trim(), amount = $('#finMiniAmount')?.value || ''; if (!person) return toast('Add who owes you first', 'warn'); if (!reason) return toast('Add why you lent it', 'warn'); if (amount === '' || !Number.isFinite(Number(amount.replace(',', '.')))) return toast('Enter a valid amount', 'warn'); const next = profile(); next.receivables.push({ id: uid(), person, reason, principal: n(amount), repayments: [] }); saveProfile(next, 'Loan added'); });
    return;
  }
  const paid = loanPaid(item), remaining = loanRemaining(item);
  const grouped = {}; (item.repayments || []).forEach((r) => { const key = r.month || 'Other'; grouped[key] = (grouped[key] || 0) + n(r.amount); });
  const history = Object.keys(grouped).sort().reverse().map((month) => `<div class="loan-history-row"><span>${esc(monthLabel(month))}</span><strong>${money(grouped[month])}</strong></div>`).join('') || '<div class="finance-current-empty">No repayments logged yet.</div>';
  showMini(`<span class="panel-kicker">PAYBACK TRACKER</span><h2>${esc(item.person)}</h2><p>${esc(item.reason)}</p><div class="loan-stats"><div><span>Originally lent</span><strong>${money(item.principal)}</strong></div><div><span>Repaid</span><strong>${money(paid)}</strong></div><div><span>Still left</span><strong>${money(remaining)}</strong></div></div><h3>Repayment history</h3><div class="loan-history">${history}</div><div class="finance-mini-actions"><button class="btn ghost" type="button" data-fin-loan-edit>Edit loan</button><button class="btn ghost" type="button" data-fin-mini-delete>Delete</button><button class="btn primary" type="button" data-fin-loan-repay ${remaining <= 0 ? 'disabled' : ''}>+ Add repayment</button></div>`);
  $('[data-fin-loan-edit]')?.addEventListener('click', () => openLoanEdit(index));
  $('[data-fin-loan-repay]')?.addEventListener('click', () => openLoanRepayment(index));
  $('[data-fin-mini-delete]')?.addEventListener('click', () => { const next = profile(); next.receivables.splice(index, 1); saveProfile(next, 'Loan removed'); });
}

function openLoanEdit(index) {
  const p = profile(), item = p.receivables[index]; if (!item) return;
  showMini(`<span class="panel-kicker">EDIT LOAN</span><h2>${esc(item.person)}</h2><div class="finance-mini-fields"><label>Who owes you?<input id="finMiniPerson" value="${esc(item.person)}"></label><label>Original amount lent<div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(item.principal ?? ''))}"></div></label><label class="full">Reason<input id="finMiniReason" value="${esc(item.reason)}"></label></div><div class="finance-mini-actions"><button class="btn ghost" type="button" data-fin-mini-back>Back</button><button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`);
  $('[data-fin-mini-back]')?.addEventListener('click', () => openOwedModal(index));
  $('[data-fin-mini-save]')?.addEventListener('click', () => { const person = String($('#finMiniPerson')?.value || '').trim(), reason = String($('#finMiniReason')?.value || '').trim(), amount = $('#finMiniAmount')?.value || ''; if (!person || !reason || amount === '' || !Number.isFinite(Number(amount.replace(',', '.')))) return toast('Complete the loan details', 'warn'); if (n(amount) < loanPaid(item)) return toast('Original amount cannot be below what has already been repaid', 'warn'); const next = profile(); next.receivables[index] = { ...next.receivables[index], person, reason, principal: n(amount) }; saveProfile(next, 'Loan updated'); });
}

function openLoanRepayment(index) {
  const p = profile(), item = p.receivables[index]; if (!item) return; const remaining = loanRemaining(item);
  showMini(`<span class="panel-kicker">REPAYMENT</span><h2>Add repayment from ${esc(item.person)}</h2><p>${money(remaining)} is still outstanding. This repayment will increase Saved up but will not count as income.</p><div class="finance-mini-fields"><label>Month<select id="finMiniRepayMonth">${MONTHS.map(([k, l]) => `<option value="${k}" ${k === selectedMonth ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label>Amount repaid<div class="finance-money mini"><span>€</span><input id="finMiniRepayAmount" inputmode="decimal" placeholder="0.00"></div></label></div><div class="finance-mini-actions"><button class="btn ghost" type="button" data-fin-mini-back>Back</button><button class="btn primary" type="button" data-fin-mini-save>Save repayment</button></div>`);
  $('[data-fin-mini-back]')?.addEventListener('click', () => openOwedModal(index));
  $('[data-fin-mini-save]')?.addEventListener('click', () => { const amount = $('#finMiniRepayAmount')?.value || '', month = $('#finMiniRepayMonth')?.value || selectedMonth; if (amount === '' || !Number.isFinite(Number(amount.replace(',', '.'))) || n(amount) <= 0) return toast('Enter a valid repayment', 'warn'); if (n(amount) > remaining) return toast('Repayment is higher than the amount still owed', 'warn'); const next = profile(); next.receivables[index].repayments = [...(next.receivables[index].repayments || []), { id: uid(), month, amount: n(amount), at: new Date().toISOString() }]; next.savingsTotal = n(next.savingsTotal) + n(amount); saveProfile(next, `Repayment saved · ${money(amount)} added to savings`); });
}

function freshRecord(month) {
  const rules = financeRules();
  return { month, incomes: [], expenses: [], extraBudget: rules.extraTracking ? rules.extraBudget : '', extraSpends: [], extraOverspendSource: '', extraOverspendAmount: 0, investmentTotal: '', sisterInvestments: '', finalized: false, finalizedAt: '' };
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
function startPartialMonth(month = selectedMonth) { const target = month || selectedMonth || '2026-09'; flow = { data: freshRecord(target), stage: 'partialMonth', temp: {}, partialMode: true }; renderWizard(); }
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
  flow = { data: existing ? cloneRecord(existing) : freshRecord(target), stage: 'partialChoose', temp: {}, partialMode: true };
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
    const candidates = partialRecurringExpenses(d.month);
    const choices = candidates.map((item, index) => {
      const loggedIndex = partialExpenseIndex(d, item), logged = loggedIndex >= 0 ? d.expenses[loggedIndex] : null;
      const tone = groupTone(item.group);
      const date = financeDateLabel(logged?.date || item.date);
      const detail = logged ? `Logged ${money(logged.amount)}${date ? ` · ${date}` : ''} · tap to edit` : `${money(item.amount)}${date ? ` · ${date}` : ''}`;
      return `<button class="finance-choice finance-tone-${tone}" type="button" data-fin-partial-expense="${index}"><div><strong>${esc(item.name)}</strong><small>${esc(detail)}</small></div><span>${logged ? '↻' : '＋'}</span></button>`;
    }).join('');
    const loggedCount = (d.expenses || []).length;
    body.innerHTML = wizardHtml('What do you want to log?', 'Choose only the expense that happened now. You can save and add the rest later.', `${choices ? `<div class="finance-choice-stack">${choices}</div>` : '<div class="finance-empty">No recurring expenses are set up yet.</div>'}<div class="finance-choice-stack" style="margin-top:10px"><button class="finance-choice finance-tone-other" type="button" data-fin-partial-custom><div><strong>Another expense</strong><small>Add a one-off or custom expense.</small></div><span>＋</span></button></div>${loggedCount ? `<div class="finance-reference" style="margin-top:14px"><span>Saved in this draft</span><strong>${loggedCount} expense${loggedCount === 1 ? '' : 's'}</strong></div>` : ''}<div class="finance-actions"><button class="btn ghost" type="button" data-fin-cancel>Cancel</button><button class="btn primary big" type="button" data-fin-save-draft>Save for later</button></div>`);
    $('[data-fin-partial-expense]').forEach((btn) => btn.addEventListener('click', () => { flow.temp = { partialCandidateIndex: Number(btn.dataset.finPartialExpense) }; flow.stage = 'partialExpense'; renderWizard(); }));
    $('[data-fin-partial-custom]')?.addEventListener('click', () => { flow.temp = {}; flow.stage = 'expenseGroup'; renderWizard(); });
    $('[data-fin-cancel]')?.addEventListener('click', resetWizard);
    $('[data-fin-save-draft]')?.addEventListener('click', () => saveMonth(false));
    return;
  }

  if (flow.stage === 'partialExpense') {
    const candidates = partialRecurringExpenses(d.month), candidate = candidates[Number(t.partialCandidateIndex)];
    if (!candidate) { flow.temp = {}; flow.stage = 'partialChoose'; renderWizard(); return; }
    const loggedIndex = partialExpenseIndex(d, candidate), logged = loggedIndex >= 0 ? d.expenses[loggedIndex] : null;
    const bounds = financeDateBounds(d.month), suggestedDate = normalizeFinanceDate(logged?.date || candidate.date, d.month);
    setProgress('PARTIAL EXPENSE', 36);
    body.innerHTML = wizardHtml(`Log ${candidate.name}`, 'Confirm the amount and date for this expense. The date can be left blank.', `<div class="finance-reference finance-tone-${groupTone(candidate.group)}"><span>${esc(categoryLabel(groupTone(candidate.group)))}</span><strong>${esc(candidate.name)}</strong><small>${logged ? 'Already in this draft — saving will update it.' : 'Only this expense will be added.'}</small></div><div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(logged?.amount ?? candidate.amount ?? ''))}" placeholder="0.00"></div><label class="finance-date-field"><span>Date <small>Optional</small></span><input class="finance-input" id="finItemDate" type="date" min="${bounds.min}" max="${bounds.max}" value="${esc(suggestedDate)}"></label><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>${logged ? 'Update expense' : 'Add expense'}</button></div>`);
    bindBack(() => { flow.temp = {}; flow.stage = 'partialChoose'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => {
      const amount = $('#finMoney')?.value || '', rawDate = String($('#finItemDate')?.value || '').trim(), safeDate = normalizeFinanceDate(rawDate, d.month);
      if (amount === '' || !Number.isFinite(Number(amount.replace(',', '.')))) return toast('Enter a valid amount', 'warn');
      if (rawDate && !safeDate) return toast('Choose a date inside this month, or leave it blank', 'warn');
      const next = { ...(logged || {}), group: candidate.group, name: candidate.name, amount: n(amount), usualDay: candidate.usualDay ?? logged?.usualDay ?? '', date: safeDate };
      if (loggedIndex >= 0) d.expenses[loggedIndex] = next; else d.expenses.push(next);
      flow.temp = {};
      flow.stage = 'partialChoose';
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
    bindBack(() => { flow.stage = 'expenseGroup'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => { const v = String($('#finText')?.value || '').trim(); if (!v) return toast('Add the expense name first', 'warn'); t.name = v; flow.stage = 'expenseAmount'; renderWizard(); }); return;
  }

  if (flow.stage === 'expenseOptionalName') {
    setProgress('EXPENSES', 49);
    body.innerHTML = wizardHtml('What was this Extra spend for?', 'Optional. Leave it as “Extra”, or add a subcategory/reason such as clothes, games or going out.', `<input class="finance-input" id="finText" placeholder="e.g. Clothes"><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn ghost" data-fin-skip>Skip · use Extra</button><button class="btn primary big" data-fin-next>Next</button></div>`);
    bindBack(() => { flow.stage = 'expenseGroup'; renderWizard(); });
    $('[data-fin-skip]')?.addEventListener('click', () => { t.name = 'Extra'; flow.stage = 'expenseAmount'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => { const v = String($('#finText')?.value || '').trim(); t.name = v || 'Extra'; flow.stage = 'expenseAmount'; renderWizard(); }); return;
  }

  if (flow.stage === 'expenseAmount') {
    const meta = groupMeta(t.group); setProgress('EXPENSES', 56);
    body.innerHTML = wizardHtml(`How much was ${t.name}?`, meta.key === 'extra' ? `This counts toward your ${money(hasValue(d.extraBudget) ? d.extraBudget : 250)} monthly Extra budget.` : 'Enter the amount for this month.', `<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);
    bindBack(() => { if (meta.optionalName) flow.stage = 'expenseOptionalName'; else if (meta.defaultName) flow.stage = 'expenseGroup'; else flow.stage = 'expenseName'; renderWizard(); });
    $('[data-fin-next]')?.addEventListener('click', () => { const v = $('#finMoney')?.value || ''; if (v === '' || !Number.isFinite(Number(v.replace(',', '.')))) return toast('Enter a valid amount', 'warn'); t.amount = n(v); flow.stage = 'expenseDate'; renderWizard(); }); return;
  }

  if (flow.stage === 'expenseDate') {
    const bounds = financeDateBounds(d.month);
    const saveExpense = (date) => { d.expenses.push({ group: t.group, name: t.name, amount: n(t.amount), date }); flow.temp = {}; flow.stage = flow.partialMode ? 'partialChoose' : 'expenseMore'; renderWizard(); };
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
  tab.addEventListener('click', () => { renderWizard(); renderPage(); setTimeout(loadState, 50); });
  $('#restartFinanceWizard')?.addEventListener('click', resetWizard);
  $('#financeManageRecurring')?.addEventListener('click', openRecurringManager);
  document.addEventListener('twogether:edit-shared-jar', (e) => openSharedJarModal(e.detail?.balance));
  const obs = new MutationObserver(() => { if ($('#finances')?.classList.contains('active')) { flow = null; renderWizard(); renderPage(); setTimeout(loadState, 40); } });
  obs.observe(document.body, { attributes: true, attributeFilter: ['data-actor'] });
  renderWizard(); renderPage();
}

document.addEventListener('DOMContentLoaded', init);
