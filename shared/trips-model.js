// The redesigned Trips model: Trip -> Expenses + Settlements -> calculated
// Balance. Pure module (no DOM, no storage) imported by both the server
// (validation + persistence rules) and the browser (rendering), so every
// figure is computed the same way everywhere.
//
// All money is integer cents. Nothing in a trip stores a balance, an amount
// "owed" or a "paid back" flag -- those are always derived from the active
// expenses and settlements.

export const ACTORS = ['Principessa', 'Principe'];

export const CATEGORIES = [
  { key: 'stay', label: 'Stay', icon: '🛏' },
  { key: 'transport', label: 'Transport', icon: '✈️' },
  { key: 'car', label: 'Car', icon: '⛽' },
  { key: 'groceries', label: 'Groceries', icon: '🛒' },
  { key: 'eating-out', label: 'Eating out', icon: '🍝' },
  { key: 'activities', label: 'Activities', icon: '🎟' },
  { key: 'other', label: 'Other', icon: '•' },
];

export const SUBCATEGORIES = {
  transport: [['flights-trains', 'Flights / trains'], ['local', 'Local'], ['other', 'Other']],
  car: [['fuel', 'Fuel'], ['tolls-parking', 'Tolls & parking']],
  other: [['food', 'Food']],
};

export const PAYERS = ['Principessa', 'Principe', 'each', 'jar'];
export const SPLITS = ['shared', 'Principessa', 'Principe'];
export const JAR_STAY_RATE = 0.2;

const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));

const UNCATEGORISED = { key: null, label: 'Uncategorised', icon: '?' };

// Display info for a category. An unknown key is shown as "Uncategorised"
// rather than being passed off as a real category.
export function categoryOf(key) {
  return CATEGORIES.find((c) => c.key === key) || UNCATEGORISED;
}

export function otherActorOf(name) {
  return name === 'Principessa' ? 'Principe' : 'Principessa';
}

// ---------------------------------------------------------------- money

// Parses what people type: "12", "12,5", "12,50", "12.50", "1.234,56",
// "1,234.56", "€ 1 234,56". Returns integer cents, or null when the text is
// not a valid non-negative amount.
export function parseMoneyToCents(input) {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) : null;
  let s = String(input ?? '').replace(/[€\s ]/g, '');
  if (!s || !/^[0-9.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  const sepIndex = Math.max(lastComma, lastDot);
  if (sepIndex >= 0) {
    const decimals = s.length - sepIndex - 1;
    const sep = s[sepIndex];
    const bothUsed = lastComma >= 0 && lastDot >= 0;
    const sepCount = s.split(sep).length - 1;
    // "1.234" or "1,234,567": a lone separator followed by exactly three
    // digits (or repeated) is a thousands separator, not a decimal point.
    const isDecimal = bothUsed || (sepCount === 1 && decimals !== 3) || (sepCount === 1 && decimals === 3 && /^0[.,]/.test(s));
    if (isDecimal) {
      if (decimals > 2) return null;
      const whole = s.slice(0, sepIndex).replace(/[.,]/g, '');
      const frac = s.slice(sepIndex + 1).padEnd(2, '0');
      if (!/^\d*$/.test(whole) || !/^\d{2}$/.test(frac)) return null;
      return Number(whole || '0') * 100 + Number(frac);
    }
    const groups = s.split(sep);
    if (bothUsed || groups[0].length < 1 || groups[0].length > 3 || groups.slice(1).some((g) => g.length !== 3)) return null;
    s = groups.join('');
  }
  if (!/^\d+$/.test(s)) return null;
  return Number(s) * 100;
}

function groupThousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// €1.234,56 -- one format everywhere. { whole: true } drops ",00".
export function formatCents(cents, { whole = false, sign = false } = {}) {
  const value = Math.round(Number(cents) || 0);
  const neg = value < 0;
  const abs = Math.abs(value);
  const euros = Math.floor(abs / 100), rest = abs % 100;
  const body = whole && rest === 0 ? groupThousands(euros) : `${groupThousands(euros)},${String(rest).padStart(2, '0')}`;
  return `${neg ? '−' : sign ? '+' : ''}€${body}`;
}

// ---------------------------------------------------------------- dates

export function isIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function localToday(now = new Date()) {
  const d = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}

function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function daysBetween(fromIso, toIso) {
  return dayNumber(toIso) - dayNumber(fromIso);
}

// ---------------------------------------------------------------- cleaning
// Cleaning normalises types only. It never substitutes a financial meaning:
// a value that is not a known payer, split or category becomes null (and
// validation rejects it on write), instead of silently becoming "shared" or
// "other".

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cents = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const actorOrEmpty = (v) => (ACTORS.includes(v) ? v : '');
const stamp = (v) => text(v, 40);

function cleanMeta(source) {
  return {
    createdAt: stamp(source.createdAt), createdBy: actorOrEmpty(source.createdBy),
    updatedAt: stamp(source.updatedAt), updatedBy: actorOrEmpty(source.updatedBy),
    deletedAt: stamp(source.deletedAt), deletedBy: actorOrEmpty(source.deletedBy),
  };
}

export function cleanExpense(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const category = CATEGORY_KEYS.has(s.category) ? s.category : null;
  const subs = SUBCATEGORIES[category] || [];
  const subcategory = subs.some(([k]) => k === s.subcategory) ? s.subcategory : null;
  const amount = cents(s.amount) ?? 0;
  const paidBy = PAYERS.includes(s.paidBy) ? s.paidBy : null;
  const split = SPLITS.includes(s.split) ? s.split : null;
  const jarAmount = cents(s.jarAmount) ?? 0;
  return {
    id: text(s.id, 80),
    rev: Number.isInteger(s.rev) && s.rev > 0 ? s.rev : 1,
    amount, category, subcategory, paidBy, split, jarAmount,
    jarShortfall: cents(s.jarShortfall) ?? 0,
    date: isIsoDate(s.date) ? s.date : '',
    note: text(s.note, 180),
    estimated: s.estimated === true,
    ...cleanMeta(s),
  };
}

export function cleanSettlement(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    id: text(s.id, 80),
    rev: Number.isInteger(s.rev) && s.rev > 0 ? s.rev : 1,
    from: actorOrEmpty(s.from), to: actorOrEmpty(s.to),
    amount: cents(s.amount) ?? 0,
    date: isIsoDate(s.date) ? s.date : '',
    note: text(s.note, 180),
    // Explanatory metadata only: which expense claims this settlement was
    // meant to cover. The balance never reads it.
    allocations: (Array.isArray(s.allocations) ? s.allocations : [])
      .map((a) => ({ expenseId: text(a?.expenseId, 80), amount: cents(a?.amount) ?? 0 }))
      .filter((a) => a.expenseId && a.amount > 0),
    allocationMode: ALLOCATION_MODES.includes(s.allocationMode) ? s.allocationMode : 'none',
    ...cleanMeta(s),
  };
}

export const ALLOCATION_MODES = ['auto', 'manual', 'none'];

function cleanBudgets(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return { Principessa: cents(s.Principessa), Principe: cents(s.Principe), unassigned: cents(s.unassigned) };
}

export function cleanTrip(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const place = s.place && typeof s.place === 'object' ? s.place : {};
  return {
    id: text(s.id, 80),
    rev: Number.isInteger(s.rev) && s.rev > 0 ? s.rev : 1,
    place: { city: text(place.city, 120), country: text(place.country, 80) || null },
    start: isIsoDate(s.start) ? s.start : '',
    end: isIsoDate(s.end) ? s.end : '',
    plannedBudgets: cleanBudgets(s.plannedBudgets),
    expenses: (Array.isArray(s.expenses) ? s.expenses : []).map(cleanExpense).filter((e) => e.id),
    settlements: (Array.isArray(s.settlements) ? s.settlements : []).map(cleanSettlement).filter((x) => x.id),
    closedAt: stamp(s.closedAt), closedBy: actorOrEmpty(s.closedBy),
    lifecycle: (Array.isArray(s.lifecycle) ? s.lifecycle : []).map((e) => ({
      event: text(e?.event, 20), at: stamp(e?.at), by: actorOrEmpty(e?.by),
    })).filter((e) => e.event),
    ...cleanMeta(s),
  };
}

// ---------------------------------------------------------------- validation

// Returns an error message for a cleaned expense, or '' when it is a
// complete, meaningful financial record.
export function validateExpense(e) {
  if (!e.id) return 'Missing expense id';
  if (!Number.isInteger(e.amount) || e.amount <= 0) return 'Enter an amount above zero';
  if (!CATEGORY_KEYS.has(e.category)) return 'Choose a category';
  if (e.subcategory !== null && !(SUBCATEGORIES[e.category] || []).some(([k]) => k === e.subcategory)) return 'Unknown type for this category';
  if (!PAYERS.includes(e.paidBy)) return 'Choose who paid';
  if (!SPLITS.includes(e.split)) return 'Choose who the expense was for';
  if (e.paidBy === 'each' && e.split !== 'shared') return 'When each paid half, the expense must be shared';
  if (!Number.isInteger(e.jarAmount) || e.jarAmount < 0) return 'Invalid Shared Jar amount';
  if (e.jarAmount > e.amount) return 'The Shared Jar part cannot be more than the expense';
  if (e.paidBy === 'jar' && e.jarAmount !== e.amount) return 'When the Shared Jar pays, it pays the whole expense';
  if (!e.date) return 'Choose a valid date';
  return '';
}

export function validateSettlement(s) {
  if (!s.id) return 'Missing repayment id';
  if (!s.from || !s.to || s.from === s.to) return 'Choose who paid whom';
  if (!Number.isInteger(s.amount) || s.amount <= 0) return 'Enter an amount above zero';
  if (!s.date) return 'Choose a valid date';
  return '';
}

export function validateTripDetails(t) {
  if (!t.place.city) return 'Add where the trip is';
  if (!t.start || !t.end) return 'Add the trip dates';
  if (t.end < t.start) return 'The trip cannot end before it starts';
  return '';
}

// ---------------------------------------------------------------- derivation

export const isActive = (record) => !record.deletedAt;

// Splits c cents in two. The first element gets the extra cent when c is odd.
function halves(c) {
  const small = Math.floor(c / 2);
  return [c - small, small];
}

// The 20% Shared Jar suggestion for a Stay expense, capped at what the Jar
// has available. Never negative.
export function jarSuggestion(amountCents, jarAvailableCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return 0;
  const ideal = Math.round(amountCents * JAR_STAY_RATE);
  return Math.max(0, Math.min(ideal, Math.max(0, jarAvailableCents || 0)));
}

// How one expense moves money. paid/share are per person, in cents.
export function expenseEffect(e) {
  const paid = { Principessa: 0, Principe: 0 };
  const share = { Principessa: 0, Principe: 0 };
  const covered = Math.max(0, e.amount - (e.paidBy === 'jar' ? e.amount : e.jarAmount));
  // A record without a known payer or split (only possible for data that
  // did not come through validation) moves no money and marks the balance
  // as incomplete, rather than being given an assumed meaning.
  const tracked = e.paidBy !== null && e.split !== null;
  if (!tracked || covered === 0) return { paid, share, covered, tracked };
  if (e.paidBy === 'each') {
    const [a, b] = halves(covered);
    paid.Principessa = a; paid.Principe = b;
    share.Principessa = a; share.Principe = b;
    return { paid, share, covered, tracked: true };
  }
  const payer = e.paidBy;
  paid[payer] = covered;
  if (e.split === 'shared') {
    const [payerHalf, otherHalf] = halves(covered);
    share[payer] = payerHalf;
    share[otherActorOf(payer)] = otherHalf;
  } else {
    share[e.split] = covered;
  }
  return { paid, share, covered, tracked: true };
}

export function tripStatus(trip, today = localToday()) {
  if (trip.deletedAt) return 'deleted';
  if (trip.closedAt) return 'closed';
  if (trip.start && today < trip.start) return 'upcoming';
  if (trip.end && today > trip.end) return 'ended';
  return 'ongoing';
}

// Every figure the Trips screens show, derived from the trip alone.
export function deriveTrip(trip, { today = localToday() } = {}) {
  const expenses = trip.expenses.filter(isActive);
  const settlements = trip.settlements.filter(isActive);
  const budgets = trip.plannedBudgets;
  const setBudgets = [budgets.Principessa, budgets.Principe, budgets.unassigned].filter((v) => v !== null);
  const available = setBudgets.length ? setBudgets.reduce((a, b) => a + b, 0) : null;

  const paid = { Principessa: 0, Principe: 0 };
  const share = { Principessa: 0, Principe: 0 };
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0]));
  let spent = 0, jarUsed = 0, balanceComplete = true;
  for (const e of expenses) {
    spent += e.amount;
    if (e.category) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    jarUsed += e.paidBy === 'jar' ? e.amount : e.jarAmount;
    const fx = expenseEffect(e);
    if (!fx.tracked) balanceComplete = false;
    for (const who of ACTORS) { paid[who] += fx.paid[who]; share[who] += fx.share[who]; }
  }

  // net > 0: Principe owes Principessa; net < 0: Principessa owes Principe.
  let net = paid.Principessa - share.Principessa;
  const repaid = { Principessa: 0, Principe: 0 };
  for (const s of settlements) {
    repaid[s.from] += s.amount;
    net += s.from === 'Principessa' ? s.amount : -s.amount;
  }

  const status = tripStatus(trip, today);
  let dayOf = null, daysUntil = null, length = null;
  if (trip.start && trip.end) {
    length = daysBetween(trip.start, trip.end) + 1;
    if (status === 'ongoing') dayOf = daysBetween(trip.start, today) + 1;
    if (status === 'upcoming') daysUntil = daysBetween(today, trip.start);
  }

  return {
    available, spent,
    left: available === null ? null : available - spent,
    paid, share, repaid, byCategory, jarUsed,
    net,
    debtor: net > 0 ? 'Principe' : net < 0 ? 'Principessa' : null,
    creditor: net > 0 ? 'Principessa' : net < 0 ? 'Principe' : null,
    owed: Math.abs(net),
    balanceComplete,
    status, dayOf, daysUntil, length,
    expenseCount: expenses.length,
  };
}

// Expenses and settlements merged into one newest-first timeline, grouped
// by day. Ties within a day are broken by creation time.
export function timeline(trip) {
  const items = [
    ...trip.expenses.filter(isActive).map((e) => ({ kind: 'expense', date: e.date, at: e.createdAt, item: e })),
    ...trip.settlements.filter(isActive).map((s) => ({ kind: 'settlement', date: s.date, at: s.createdAt, item: s })),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || '').localeCompare(a.at || ''));
  const groups = [];
  for (const entry of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === entry.date) last.items.push(entry);
    else groups.push({ date: entry.date, items: [entry] });
  }
  return groups;
}

// Jar money the trip ledger has committed across all trips that are not
// deleted, excluding one expense (the one being edited).
export function ledgerJarUsage(trips, { excludeTripId = '', excludeExpenseId = '' } = {}) {
  let used = 0;
  for (const t of trips) {
    if (t.deletedAt) continue;
    for (const e of t.expenses) {
      if (e.deletedAt) continue;
      if (t.id === excludeTripId && e.id === excludeExpenseId) continue;
      used += e.paidBy === 'jar' ? e.amount : e.jarAmount;
    }
  }
  return used;
}

// ---------------------------------------------------------------- balance explanation
//
// The net balance (deriveTrip) is the only financial truth. Everything below
// explains it; nothing here can change it.
//
// A *claim* is what one person covered for the other on one expense: the
// other person's share of the part the Shared Jar did not pay. Settlement
// allocations say which claims a repayment was meant to cover.

// The claim an expense creates, or null when it moves no money between you.
export function claimOf(e) {
  if (!isActive(e) || !ACTORS.includes(e.paidBy) || e.split === null) return null;
  const fx = expenseEffect(e);
  const other = otherActorOf(e.paidBy);
  const amount = fx.share[other];
  return amount > 0 ? { from: other, to: e.paidBy, amount } : null;
}

// Oldest first: expense date, then when it was added, then id -- the same
// order on every device and every time.
export function compareExpenseAge(a, b) {
  return (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id);
}

// Repayments actually allocated to one expense (active settlements only).
export function repaymentsFor(trip, expenseId) {
  const out = [];
  for (const s of trip.settlements) {
    if (!isActive(s)) continue;
    for (const a of s.allocations) if (a.expenseId === expenseId) out.push({ settlement: s, amount: a.amount });
  }
  return out;
}

// Explanation of the net balance from the point of view of the person who
// owes (debtor) and the person owed (creditor):
//   covered  -- claims the creditor covered for the debtor, oldest first
//   offsets  -- claims the debtor covered for the creditor
//   paid     -- repayments debtor -> creditor;  received -- creditor -> debtor
//   stillOpen -- what the net amount corresponds to, oldest claims first
// When the net balance is zero, nothing is open. The still-open amounts
// always add up exactly to the net balance.
export function balanceBreakdown(trip, options = {}) {
  const d = deriveTrip(trip, options);
  const debtor = d.debtor || options.perspective?.debtor || 'Principe';
  const creditor = otherActorOf(debtor);
  const expenses = trip.expenses.filter(isActive).slice().sort(compareExpenseAge);
  const settlements = trip.settlements.filter(isActive);

  const claims = expenses.map((e) => ({ expense: e, claim: claimOf(e) })).filter((x) => x.claim);
  const covered = claims.filter((x) => x.claim.from === debtor);
  const offsets = claims.filter((x) => x.claim.from === creditor);
  const byId = new Map(covered.map((x) => [x.expense.id, x]));

  // Explicit allocations from debtor -> creditor repayments. Anything that
  // does not land on a matching claim (deleted expense, changed payer,
  // allocation larger than the claim now is) counts as general.
  const explicit = new Map();
  let general = 0;
  const paid = [], received = [];
  for (const s of settlements) {
    if (s.from === debtor) {
      paid.push(s);
      // Allocations can never explain more than the settlement itself.
      let left = s.amount;
      for (const a of s.allocations) {
        if (!byId.has(a.expenseId) || left <= 0) continue;
        const part = Math.min(a.amount, left);
        explicit.set(a.expenseId, (explicit.get(a.expenseId) || 0) + part);
        left -= part;
      }
      general += left;
    } else {
      received.push(s);
    }
  }

  const rows = covered.map((x) => {
    const allocated = explicit.get(x.expense.id) || 0;
    const overAllocated = Math.max(0, allocated - x.claim.amount);
    general += overAllocated;
    return { expense: x.expense, claim: x.claim.amount, allocated, overAllocated, remaining: Math.max(0, x.claim.amount - allocated), open: 0 };
  });

  const offsetTotal = offsets.reduce((sum, x) => sum + x.claim.amount, 0);
  const receivedTotal = received.reduce((sum, s) => sum + s.amount, 0);
  // Offsets and untied repayments settle the oldest claims first. Money the
  // creditor sent the debtor increases what is owed.
  let pool = offsetTotal + general - receivedTotal;
  const stillOpen = [];
  for (const r of rows) {
    const take = Math.min(r.remaining, Math.max(0, pool));
    pool -= take;
    r.open = r.remaining - take;
    if (r.open > 0) stillOpen.push({ expense: r.expense, amount: r.open });
  }
  const untied = pool < 0 ? -pool : 0; // owed but not tied to any expense
  if (untied > 0) stillOpen.push({ expense: null, amount: untied });

  const even = d.net === 0;
  return {
    net: d.net, owed: d.owed, even,
    debtor: even ? null : debtor, creditor: even ? null : creditor,
    perspective: { debtor, creditor },
    covered: rows,
    coveredTotal: rows.reduce((sum, r) => sum + r.claim, 0),
    offsets: offsets.map((x) => ({ expense: x.expense, claim: x.claim.amount })),
    offsetTotal,
    paid, paidTotal: paid.reduce((sum, s) => sum + s.amount, 0),
    received, receivedTotal,
    stillOpen: even ? [] : stillOpen,
    stillOpenTotal: even ? 0 : stillOpen.reduce((sum, x) => sum + x.amount, 0),
  };
}

// The default explanation for a new repayment of `amount` from `from` to
// `to`: the still-open claims, oldest first, until the amount runs out. What
// is left over (paying more than is owed, or paying in the direction nobody
// owes) stays general. Pass the trip without the settlement being edited.
export function autoAllocate(trip, amount, from, to) {
  const b = balanceBreakdown(trip);
  if (!ACTORS.includes(from) || to !== otherActorOf(from) || b.even || b.debtor !== from) return { allocations: [], general: Math.max(0, amount) };
  const allocations = [];
  let left = Math.max(0, amount);
  for (const item of b.stillOpen) {
    if (!item.expense || left <= 0) continue;
    const take = Math.min(item.amount, left);
    allocations.push({ expenseId: item.expense.id, amount: take });
    left -= take;
  }
  return { allocations, general: left };
}

// Room left on each expense claim for a manual allocation from `from`:
// the claim minus what other active repayments explicitly allocated to it.
export function allocationRoom(trip, from, { excludeSettlementId = '' } = {}) {
  const room = new Map();
  for (const e of trip.expenses) {
    const c = claimOf(e);
    if (c && c.from === from) room.set(e.id, c.amount);
  }
  for (const s of trip.settlements) {
    if (!isActive(s) || s.id === excludeSettlementId || s.from !== from) continue;
    for (const a of s.allocations) if (room.has(a.expenseId)) room.set(a.expenseId, room.get(a.expenseId) - a.amount);
  }
  for (const [k, v] of room) room.set(k, Math.max(0, v));
  return room;
}
