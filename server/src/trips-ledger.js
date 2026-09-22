// Server actions for the redesigned Trips (Trip -> Expenses + Settlements ->
// calculated Balance). Each action edits one trip document in
// state.tripLedger; core.js runs it inside the same read -> write
// transaction as every other action and persists the result only when the
// action succeeds.
//
// Rules applied to every action:
// - Records are never physically removed: delete sets deletedAt/deletedBy,
//   restore clears them and changes nothing else.
// - Every change to an existing record must name the revision it was based
//   on (`rev`). A mismatch fails with STALE instead of acting on a newer
//   version.
// - Creates are addressed by a client-chosen id, so a retried create returns
//   the record that already exists instead of adding a second one.
// - Input is validated as given. Unknown payers, splits, categories, types or
//   people are rejected, never mapped to something else.
// - Money is integer cents throughout, including Shared Jar usage.
import {
  ACTORS, PAYERS, SPLITS, cleanTrip, cleanExpense, cleanSettlement, validateExpense,
  validateSettlement, validateTripDetails, parseMoneyToCents, localToday, ledgerJarUsage,
  ALLOCATION_MODES, autoAllocate, allocationRoom, datePhase,
} from '../../shared/trips-model.js';

export const TRIP_LEDGER_ACTIONS = new Set([
  'tripCreate', 'tripUpdate', 'tripSetBudget', 'tripClose', 'tripReopen',
  'tripExpenseSave', 'tripExpenseDelete', 'tripExpenseRestore',
  'tripSettlementSave', 'tripSettlementDelete', 'tripSettlementRestore',
]);

class LedgerError extends Error {
  constructor(message, code = 'INVALID') { super(message); this.code = code; }
}

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const blank = (v) => v === undefined || v === null || v === '';

// Money input: integer cents, or a typed amount string ("62,50"). Anything
// else (including fractional numbers, which would be ambiguous) is invalid.
// Returns null for "not set" and undefined for invalid.
function centsOrNull(value) {
  if (blank(value)) return null;
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const parsed = parseMoneyToCents(value);
  return parsed === null ? undefined : parsed;
}

function requireRev(rev) {
  if (!Number.isInteger(rev) || rev < 1) throw new LedgerError('Missing version of the record being changed');
}

function stale(what) {
  return new LedgerError(`This ${what} was just changed on the other phone. Showing the latest version.`, 'STALE');
}

function findTrip(state, tripId) {
  const trip = state.tripLedger.find((t) => t.id === tripId);
  if (!trip) throw new LedgerError('Trip not found', 'NOT_FOUND');
  if (trip.deletedAt) throw new LedgerError('This trip was deleted', 'TRIP_DELETED');
  return trip;
}

function assertOpen(trip) {
  if (trip.closedAt) throw new LedgerError('This trip is closed. Reopen it to change expenses.', 'TRIP_CLOSED');
}

function touch(record, actor, now) {
  record.updatedAt = now;
  record.updatedBy = actor;
}

// ---- Shared Jar (integer cents) ---------------------------------------------
// Available = what the older trip flows have not used (helpers.jarBaseCents)
// minus the Jar amounts of every active ledger expense, excluding the one
// being saved.
function jarAvailableCents(state, helpers, tripId, expenseId) {
  return helpers.jarBaseCents(state) - ledgerJarUsage(state.tripLedger, { excludeTripId: tripId, excludeExpenseId: expenseId });
}

// ---- Trips ------------------------------------------------------------------

function tripCreate(state, payload, actor, now, helpers) {
  const input = payload.trip || {};
  const id = text(input.id, 80) || helpers.uuid();
  const existing = state.tripLedger.find((t) => t.id === id);
  if (existing) return { ok: true, trip: existing, duplicate: true };
  const budget = centsOrNull(payload.budget);
  if (budget === undefined) throw new LedgerError('Enter a valid budget, or leave it empty');
  const trip = cleanTrip({
    id, rev: 1,
    place: { city: input.city, country: input.country },
    start: input.start, end: input.end,
    plannedBudgets: { Principessa: null, Principe: null, unassigned: null, [actor]: budget },
    expenses: [], settlements: [],
    lifecycle: [{ event: 'created', at: now, by: actor }],
    createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor,
  });
  const problem = validateTripDetails(trip);
  if (problem) throw new LedgerError(problem);
  state.tripLedger.push(trip);
  return { ok: true, trip };
}

function tripUpdate(state, payload, actor, now) {
  const trip = findTrip(state, text(payload.tripId, 80));
  assertOpen(trip);
  requireRev(payload.rev);
  if (payload.rev !== trip.rev) throw stale('trip');
  const next = cleanTrip({ ...trip, place: { city: payload.city, country: payload.country ?? trip.place.country }, start: payload.start, end: payload.end });
  const problem = validateTripDetails(next);
  if (problem) throw new LedgerError(problem);
  trip.place = next.place; trip.start = next.start; trip.end = next.end;
  trip.rev += 1;
  touch(trip, actor, now);
  return { ok: true, trip };
}

// Each person sets only their own planned budget. Budgets are trip-level
// fields, so they share the trip's revision.
function tripSetBudget(state, payload, actor, now) {
  const trip = findTrip(state, text(payload.tripId, 80));
  assertOpen(trip);
  requireRev(payload.rev);
  if (payload.rev !== trip.rev) throw stale('trip');
  const amount = centsOrNull(payload.amount);
  if (amount === undefined) throw new LedgerError('Enter a valid budget, or leave it empty');
  trip.plannedBudgets[actor] = amount;
  trip.rev += 1;
  touch(trip, actor, now);
  return { ok: true, trip };
}

// ---- Lifecycle: close / reopen ----------------------------------------------
// Close freezes normal trip activity (trip details, budgets, expenses); it is
// not a financial reconciliation, and repayments stay allowed. Either person
// can close or reopen, without confirmation from the other.
//
// Both are revision-checked like every other trip change, with one narrow
// exception for duplicate intent: if the trip is already in the requested
// state (both phones pressed Close on rev 5; the first one produced rev 6),
// the late request succeeds with the current trip and changes nothing -- no
// new revision, no second history event. If the trip is NOT already in the
// requested state, a stale revision fails as usual.
//
// A trip that has not started yet cannot be closed (cancelling a trip is a
// separate feature). "Today" is the server's local date.
function tripSetClosed(state, payload, actor, now, closing) {
  const trip = findTrip(state, text(payload.tripId, 80));
  requireRev(payload.rev);
  if (!!trip.closedAt === closing) return { ok: true, trip, duplicate: true };
  if (payload.rev !== trip.rev) throw stale('trip');
  if (closing && datePhase(trip, localToday(new Date(now))) === 'upcoming') {
    throw new LedgerError('This trip hasn’t started yet, so it can’t be closed.', 'TRIP_NOT_STARTED');
  }
  trip.closedAt = closing ? now : '';
  trip.closedBy = closing ? actor : '';
  // History is append-only: reopening keeps the earlier "closed" event.
  trip.lifecycle.push({ event: closing ? 'closed' : 'reopened', at: now, by: actor });
  trip.rev += 1;
  touch(trip, actor, now);
  return { ok: true, trip };
}

// ---- Expenses ---------------------------------------------------------------

// Checks the fields exactly as sent, before any cleaning. Omitted optional
// fields take their defaults; values that are present must be valid.
function checkRawExpense(raw) {
  const amount = centsOrNull(raw.amount);
  if (amount === undefined || amount === null || amount <= 0) throw new LedgerError('Enter an amount above zero');
  const jarAmount = blank(raw.jarAmount) ? 0 : centsOrNull(raw.jarAmount);
  if (jarAmount === undefined) throw new LedgerError('Invalid Shared Jar amount');
  if (!blank(raw.paidBy) && !PAYERS.includes(raw.paidBy)) throw new LedgerError('Unknown payer');
  if (!blank(raw.split) && !SPLITS.includes(raw.split)) throw new LedgerError('Unknown split');
  if (blank(raw.category)) throw new LedgerError('Choose a category');
  if (!blank(raw.subcategory) && typeof raw.subcategory !== 'string') throw new LedgerError('Unknown type for this category');
  if (!blank(raw.date) && typeof raw.date !== 'string') throw new LedgerError('Choose a valid date');
  if (raw.estimated !== undefined && typeof raw.estimated !== 'boolean') throw new LedgerError('Invalid estimate flag');
  if (raw.note !== undefined && raw.note !== null && typeof raw.note !== 'string') throw new LedgerError('Invalid note');
  return { amount, jarAmount };
}

function tripExpenseSave(state, payload, actor, now, helpers) {
  const trip = findTrip(state, text(payload.tripId, 80));
  assertOpen(trip);
  const raw = payload.expense && typeof payload.expense === 'object' ? payload.expense : {};
  const id = text(raw.id, 80);
  if (!id) throw new LedgerError('Missing expense id');
  const existing = trip.expenses.find((e) => e.id === id);
  if (existing) {
    // A retried create (same id, no revision) returns the stored record
    // unchanged: one financial entry per id, however often it is sent.
    if (raw.rev === undefined) return { ok: true, expense: existing, trip, duplicate: true };
    requireRev(raw.rev);
    if (raw.rev !== existing.rev) throw stale('expense');
    if (existing.deletedAt) throw new LedgerError('This expense was deleted', 'DELETED');
  } else if (raw.rev !== undefined) {
    throw new LedgerError('Expense not found', 'NOT_FOUND');
  }
  const { amount, jarAmount } = checkRawExpense(raw);
  const paidBy = blank(raw.paidBy) ? actor : raw.paidBy;
  const expense = cleanExpense({
    id,
    amount,
    category: raw.category,
    subcategory: blank(raw.subcategory) ? null : raw.subcategory,
    paidBy,
    split: blank(raw.split) ? 'shared' : raw.split,
    jarAmount: paidBy === 'jar' && blank(raw.jarAmount) ? amount : jarAmount,
    date: blank(raw.date) ? localToday() : raw.date,
    note: raw.note ?? '',
    estimated: raw.estimated === true,
    rev: existing ? existing.rev + 1 : 1,
    createdAt: existing ? existing.createdAt : now,
    createdBy: existing ? existing.createdBy : actor,
    updatedAt: now, updatedBy: actor,
  });
  if (!blank(raw.subcategory) && expense.subcategory === null) throw new LedgerError('Unknown type for this category');
  const problem = validateExpense(expense);
  if (problem) throw new LedgerError(problem);

  // The Jar never blocks a save and is never changed silently: if it cannot
  // cover the requested part, the expense is stored without a Jar part and
  // jarShortfall records what was asked for, so the screen can say so.
  const requested = expense.jarAmount;
  const available = jarAvailableCents(state, helpers, trip.id, id);
  let jarNotApplied = null;
  if (requested > 0 && requested > available) {
    if (expense.paidBy === 'jar') expense.paidBy = actor;
    expense.jarAmount = 0;
    expense.jarShortfall = requested;
    jarNotApplied = { requested, available: Math.max(0, available) };
  } else {
    expense.jarShortfall = 0;
  }

  if (existing) trip.expenses[trip.expenses.indexOf(existing)] = expense;
  else trip.expenses.push(expense);
  touch(trip, actor, now);
  return { ok: true, expense, trip, jarNotApplied };
}

// Delete and restore only flip the deleted markers. Restoring brings back
// the exact stored record -- amount, payer, split and Jar part -- without
// re-running any rule, so Undo is an exact restoration.
function setDeleted(record, what, payload, actor, now, deleted) {
  requireRev(payload.rev);
  if (payload.rev !== record.rev) throw stale(what);
  if (!!record.deletedAt === deleted) throw new LedgerError(deleted ? `This ${what} is already deleted` : `This ${what} is not deleted`, 'STALE');
  record.deletedAt = deleted ? now : '';
  record.deletedBy = deleted ? actor : '';
  record.rev += 1;
  touch(record, actor, now);
}

function tripExpenseSetDeleted(state, payload, actor, now, deleted) {
  const trip = findTrip(state, text(payload.tripId, 80));
  assertOpen(trip);
  const expense = trip.expenses.find((e) => e.id === text(payload.expenseId, 80));
  if (!expense) throw new LedgerError('Expense not found', 'NOT_FOUND');
  setDeleted(expense, 'expense', payload, actor, now, deleted);
  touch(trip, actor, now);
  return { ok: true, expense, trip };
}

// ---- Settlements ------------------------------------------------------------
// Settlements are allowed on open and closed trips alike.

function tripSettlementSave(state, payload, actor, now) {
  const trip = findTrip(state, text(payload.tripId, 80));
  const raw = payload.settlement && typeof payload.settlement === 'object' ? payload.settlement : {};
  const id = text(raw.id, 80);
  if (!id) throw new LedgerError('Missing settlement id');
  const existing = trip.settlements.find((s) => s.id === id);
  if (existing) {
    if (raw.rev === undefined) return { ok: true, settlement: existing, trip, duplicate: true };
    requireRev(raw.rev);
    if (raw.rev !== existing.rev) throw stale('settlement');
    if (existing.deletedAt) throw new LedgerError('This settlement was deleted', 'DELETED');
  } else if (raw.rev !== undefined) {
    throw new LedgerError('Settlement not found', 'NOT_FOUND');
  }
  if (!ACTORS.includes(raw.from) || !ACTORS.includes(raw.to) || raw.from === raw.to) throw new LedgerError('Choose who paid whom');
  const amount = centsOrNull(raw.amount);
  if (amount === undefined || amount === null || amount <= 0) throw new LedgerError('Enter an amount above zero');
  if (!blank(raw.date) && typeof raw.date !== 'string') throw new LedgerError('Choose a valid date');
  const allocationMode = blank(raw.allocationMode) ? 'none' : raw.allocationMode;
  if (!ALLOCATION_MODES.includes(allocationMode)) throw new LedgerError('Unknown allocation mode');
  const allocations = settlementAllocations(trip, id, raw, allocationMode, amount);
  const settlement = cleanSettlement({
    id, from: raw.from, to: raw.to, amount,
    date: blank(raw.date) ? localToday() : raw.date,
    note: raw.note ?? '',
    allocations, allocationMode,
    rev: existing ? existing.rev + 1 : 1,
    createdAt: existing ? existing.createdAt : now,
    createdBy: existing ? existing.createdBy : actor,
    updatedAt: now, updatedBy: actor,
  });
  const problem = validateSettlement(settlement);
  if (problem) throw new LedgerError(problem);
  if (existing) trip.settlements[trip.settlements.indexOf(existing)] = settlement;
  else trip.settlements.push(settlement);
  touch(trip, actor, now);
  return { ok: true, settlement, trip };
}

// Which expense claims a settlement is recorded as covering. This is
// explanatory metadata: it is stored with the settlement but never used for
// the balance.
// - auto:   worked out here from the ledger as it is now (without this
//           settlement), oldest still-open claims first -- the same rule the
//           screen previews, so both phones agree.
// - manual: exactly what was chosen, checked against the ledger.
// - none:   a general settlement, tied to no expense.
function settlementAllocations(trip, settlementId, raw, mode, amount) {
  if (mode === 'none') {
    if (Array.isArray(raw.allocations) && raw.allocations.length) throw new LedgerError('A general repayment cannot cover specific expenses');
    return [];
  }
  const others = { ...trip, settlements: trip.settlements.filter((s) => s.id !== settlementId) };
  if (mode === 'auto') return autoAllocate(others, amount, raw.from, raw.to).allocations;

  if (!Array.isArray(raw.allocations) || !raw.allocations.length) throw new LedgerError('Choose at least one expense, or record a general repayment');
  const room = allocationRoom(trip, raw.from, { excludeSettlementId: settlementId });
  const seen = new Set();
  let total = 0;
  const out = [];
  for (const a of raw.allocations) {
    const expenseId = a && typeof a.expenseId === 'string' ? a.expenseId : '';
    if (!expenseId || seen.has(expenseId)) throw new LedgerError('Each expense can be chosen once');
    seen.add(expenseId);
    const share = centsOrNull(a.amount);
    if (share === undefined || share === null || share <= 0) throw new LedgerError('Enter an amount above zero for each chosen expense');
    if (!room.has(expenseId)) throw new LedgerError('That expense has nothing this repayment can cover');
    if (share > room.get(expenseId)) throw new LedgerError('That is more than is left on this expense');
    total += share;
    out.push({ expenseId, amount: share });
  }
  if (total > amount) throw new LedgerError('The chosen expenses add up to more than the repayment');
  return out;
}

function tripSettlementSetDeleted(state, payload, actor, now, deleted) {
  const trip = findTrip(state, text(payload.tripId, 80));
  const settlement = trip.settlements.find((s) => s.id === text(payload.settlementId, 80));
  if (!settlement) throw new LedgerError('Settlement not found', 'NOT_FOUND');
  setDeleted(settlement, 'settlement', payload, actor, now, deleted);
  touch(trip, actor, now);
  return { ok: true, settlement, trip };
}

// Entry point used by core.js. Returns the action result; on { ok:false }
// core.js does not save, so a rejected action leaves storage unchanged.
export function runTripLedgerAction(state, action, payload, actor, helpers) {
  if (!ACTORS.includes(actor)) return { ok: false, error: 'Choose Principessa or Principe first', code: 'NO_ACTOR' };
  state.tripLedger = (Array.isArray(state.tripLedger) ? state.tripLedger : []).map(cleanTrip);
  const now = helpers.now();
  const p = payload && typeof payload === 'object' ? payload : {};
  try {
    switch (action) {
      case 'tripCreate': return tripCreate(state, p, actor, now, helpers);
      case 'tripUpdate': return tripUpdate(state, p, actor, now);
      case 'tripSetBudget': return tripSetBudget(state, p, actor, now);
      case 'tripClose': return tripSetClosed(state, p, actor, now, true);
      case 'tripReopen': return tripSetClosed(state, p, actor, now, false);
      case 'tripExpenseSave': return tripExpenseSave(state, p, actor, now, helpers);
      case 'tripExpenseDelete': return tripExpenseSetDeleted(state, p, actor, now, true);
      case 'tripExpenseRestore': return tripExpenseSetDeleted(state, p, actor, now, false);
      case 'tripSettlementSave': return tripSettlementSave(state, p, actor, now);
      case 'tripSettlementDelete': return tripSettlementSetDeleted(state, p, actor, now, true);
      case 'tripSettlementRestore': return tripSettlementSetDeleted(state, p, actor, now, false);
      default: return { ok: false, error: 'Unknown action', code: 'UNKNOWN' };
    }
  } catch (error) {
    if (error instanceof LedgerError) return { ok: false, error: error.message, code: error.code };
    throw error;
  }
}
