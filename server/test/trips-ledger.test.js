import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';
import { openDatabase } from '../src/db/index.js';
import { deriveTrip } from '../../shared/trips-model.js';

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'twogether-ledger-'));
  const database = openDatabase(join(directory, 'test.sqlite'));
  configureStateStore(database.store);
  const act = (name, payload, actor = 'Principessa') => database.db.transaction(() => runAction(name, payload, actor))();
  // Everything persisted, read straight from SQLite -- used to prove that a
  // rejected action leaves storage byte-for-byte unchanged.
  const snapshot = () => JSON.stringify(database.db.prepare('SELECT key, json FROM app_state ORDER BY key').all())
    + JSON.stringify(database.db.prepare('SELECT id, json FROM trip_ledger ORDER BY id').all());
  return { database, act, snapshot, cleanup() { database.close(); rmSync(directory, { recursive: true, force: true }); } };
}

function newTrip(act, budget = '900') {
  const r = act('tripCreate', { trip: { id: 'trip-1', city: 'Amsterdam', start: '2026-09-20', end: '2026-09-27' }, budget });
  assert.equal(r.ok, true, r.error);
  return r.trip;
}

const ledgerTrip = () => getState().tripLedger.find((t) => t.id === 'trip-1');
const expenseById = (id) => ledgerTrip().expenses.find((e) => e.id === id);
const addExpense = (act, expense, actor) => {
  const r = act('tripExpenseSave', { tripId: 'trip-1', expense }, actor);
  assert.equal(r.ok, true, r.error);
  return r.expense;
};
const jarCents = () => getState().sharedJar.availableCents;

// ---------------------------------------------------------------- trips & budgets

test('creating a trip stores one shared trip with the creator’s own budget', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    const trip = ledgerTrip();
    assert.equal(trip.place.city, 'Amsterdam');
    assert.deepEqual(trip.plannedBudgets, { Principessa: 90000, Principe: null, unassigned: null });
    assert.equal(trip.createdBy, 'Principessa');
    assert.equal(ctx.database.db.prepare('SELECT COUNT(*) AS n FROM trip_ledger').get().n, 1);
  } finally { ctx.cleanup(); }
});

test('trip details are validated and skipping the budget stores “not set”, not zero', () => {
  const ctx = setup();
  try {
    assert.equal(ctx.act('tripCreate', { trip: { city: '', start: '2026-09-20', end: '2026-09-27' } }).ok, false);
    assert.equal(ctx.act('tripCreate', { trip: { city: 'X', start: '2026-09-27', end: '2026-09-20' } }).ok, false);
    assert.equal(ctx.act('tripCreate', { trip: { id: 't', city: 'X', start: '2026-09-20', end: '2026-09-21' }, budget: '' }).trip.plannedBudgets.Principessa, null);
  } finally { ctx.cleanup(); }
});

test('each person sets only their own budget; the combined amount is derived', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    assert.equal(ctx.act('tripSetBudget', { tripId: 'trip-1', rev: ledgerTrip().rev, amount: '850' }, 'Principe').ok, true);
    const trip = ledgerTrip();
    assert.deepEqual(trip.plannedBudgets, { Principessa: 90000, Principe: 85000, unassigned: null });
    assert.equal(deriveTrip(trip).available, 175000);
    assert.equal(ctx.act('tripSetBudget', { tripId: 'trip-1', rev: ledgerTrip().rev, amount: 'abc' }, 'Principe').ok, false);
  } finally { ctx.cleanup(); }
});

test('changing either budget changes available and left, but never who owes whom or how much', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act, '900');
    addExpense(ctx.act, { id: 'stay', amount: 60000, category: 'stay' });
    addExpense(ctx.act, { id: 'dinner', amount: 8000, category: 'eating-out' }, 'Principe');
    const before = deriveTrip(ledgerTrip());
    assert.equal(before.available, 90000);
    assert.equal(before.left, 90000 - 68000);
    assert.equal(before.debtor, 'Principe');
    assert.equal(before.owed, 26000);

    ctx.act('tripSetBudget', { tripId: 'trip-1', rev: ledgerTrip().rev, amount: '850' }, 'Principe');
    const partnerBudget = deriveTrip(ledgerTrip());
    assert.equal(partnerBudget.available, 175000);
    assert.equal(partnerBudget.left, 175000 - 68000);
    assert.equal(partnerBudget.debtor, before.debtor);
    assert.equal(partnerBudget.owed, before.owed);

    ctx.act('tripSetBudget', { tripId: 'trip-1', rev: ledgerTrip().rev, amount: '100' }, 'Principessa');
    const smaller = deriveTrip(ledgerTrip());
    assert.equal(smaller.available, 95000);
    assert.equal(smaller.left, 95000 - 68000);
    assert.equal(smaller.debtor, before.debtor);
    assert.equal(smaller.owed, before.owed);

    ctx.act('tripSetBudget', { tripId: 'trip-1', rev: ledgerTrip().rev, amount: '' }, 'Principessa');
    ctx.act('tripSetBudget', { tripId: 'trip-1', rev: ledgerTrip().rev, amount: '' }, 'Principe');
    const none = deriveTrip(ledgerTrip());
    assert.equal(none.available, null);
    assert.equal(none.left, null);
    assert.equal(none.debtor, before.debtor);
    assert.equal(none.owed, before.owed);
  } finally { ctx.cleanup(); }
});

// ---------------------------------------------------------------- expenses

test('an expense needs only amount and category; payer, split and date default', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    const e = addExpense(ctx.act, { id: 'e1', amount: '62,00', category: 'eating-out' }, 'Principe');
    assert.equal(e.amount, 6200);
    assert.equal(e.paidBy, 'Principe');
    assert.equal(e.split, 'shared');
    assert.equal(e.estimated, false);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(e.createdBy, 'Principe');
    const d = deriveTrip(ledgerTrip());
    assert.equal(d.debtor, 'Principessa');
    assert.equal(d.owed, 3100);
  } finally { ctx.cleanup(); }
});

test('invalid financial values are rejected and leave storage unchanged', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    addExpense(ctx.act, { id: 'ok', amount: 5000, category: 'groceries' });
    const before = ctx.snapshot();
    const bad = [
      { id: 'b1', amount: 1000, category: 'nonsense' },
      { id: 'b2', amount: 1000 },
      { id: 'b3', amount: 1000, category: 'stay', paidBy: 'Someone' },
      { id: 'b4', amount: 1000, category: 'stay', split: 'mostly-me' },
      { id: 'b5', amount: 1000, category: 'stay', paidBy: 'each', split: 'Principe' },
      { id: 'b6', amount: 1000, category: 'car', subcategory: 'spaceship' },
      { id: 'b7', amount: 1000, category: 'stay', subcategory: 'fuel' },
      { id: 'b8', amount: 0, category: 'stay' },
      { id: 'b9', amount: 12.5, category: 'stay' },
      { id: 'b10', amount: '-5', category: 'stay' },
      { id: 'b11', amount: 1000, category: 'stay', jarAmount: 2000 },
      { id: 'b12', amount: 1000, category: 'stay', paidBy: 'jar', jarAmount: 500 },
      { id: 'b13', amount: 1000, category: 'stay', date: '2026-02-30' },
      { id: 'b14', amount: 1000, category: 'stay', estimated: 'yes' },
      { amount: 1000, category: 'stay' },
    ];
    for (const expense of bad) {
      const r = ctx.act('tripExpenseSave', { tripId: 'trip-1', expense });
      assert.equal(r.ok, false, `accepted ${JSON.stringify(expense)}`);
    }
    // An existing expense cannot be edited into an invalid one either.
    const edit = ctx.act('tripExpenseSave', { tripId: 'trip-1', expense: { ...expenseById('ok'), paidBy: 'Nobody' } });
    assert.equal(edit.ok, false);
    const badSettlements = [
      { id: 's1', from: 'Principe', to: 'Principe', amount: 100 },
      { id: 's2', from: 'Principe', to: 'Someone', amount: 100 },
      { id: 's3', from: '', to: 'Principessa', amount: 100 },
      { id: 's4', from: 'Principe', to: 'Principessa', amount: 0 },
      { id: 's5', from: 'Principe', to: 'Principessa', amount: 10.5 },
    ];
    for (const settlement of badSettlements) {
      const r = ctx.act('tripSettlementSave', { tripId: 'trip-1', settlement });
      assert.equal(r.ok, false, `accepted ${JSON.stringify(settlement)}`);
    }
    assert.equal(ctx.snapshot(), before);
    // "Other" is stored only when Other was actually chosen.
    assert.equal(addExpense(ctx.act, { id: 'other', amount: 100, category: 'other' }).category, 'other');
  } finally { ctx.cleanup(); }
});

test('a retried create with the same id never creates a second financial entry', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    const payload = { tripId: 'trip-1', expense: { id: 'once', amount: 72000, category: 'stay', jarAmount: 14400 } };
    const first = ctx.act('tripExpenseSave', payload);
    assert.equal(first.ok, true);
    const jarAfterFirst = jarCents();
    // The response was "lost"; the app sends the very same request again.
    const retry = ctx.act('tripExpenseSave', payload);
    assert.equal(retry.ok, true);
    assert.equal(retry.duplicate, true);
    assert.equal(ledgerTrip().expenses.length, 1);
    assert.equal(deriveTrip(ledgerTrip()).spent, 72000);
    assert.equal(jarCents(), jarAfterFirst);

    const s = { tripId: 'trip-1', settlement: { id: 'pay-once', from: 'Principe', to: 'Principessa', amount: 28800 } };
    assert.equal(ctx.act('tripSettlementSave', s, 'Principe').ok, true);
    assert.equal(ctx.act('tripSettlementSave', s, 'Principe').duplicate, true);
    assert.equal(ledgerTrip().settlements.length, 1);
    assert.equal(deriveTrip(ledgerTrip()).owed, 0);

    const t = { trip: { id: 'trip-2', city: 'Porto', start: '2026-10-01', end: '2026-10-02' } };
    ctx.act('tripCreate', t);
    assert.equal(ctx.act('tripCreate', t).duplicate, true);
    assert.equal(getState().tripLedger.length, 2);
  } finally { ctx.cleanup(); }
});

// ---------------------------------------------------------------- concurrency

test('stale changes fail instead of acting on a newer version', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    addExpense(ctx.act, { id: 'e1', amount: 6200, category: 'eating-out' });
    const seenByPrincipessa = expenseById('e1');

    // Principe edits first.
    assert.equal(ctx.act('tripExpenseSave', { tripId: 'trip-1', expense: { ...seenByPrincipessa, amount: 7000 } }, 'Principe').ok, true);
    const latest = expenseById('e1');
    assert.equal(latest.rev, 2);
    assert.equal(latest.createdBy, 'Principessa');
    assert.equal(latest.updatedBy, 'Principe');

    const before = ctx.snapshot();
    // Principessa's screen still shows revision 1.
    for (const [action, payload] of [
      ['tripExpenseSave', { tripId: 'trip-1', expense: { ...seenByPrincipessa, amount: 1 } }],
      ['tripExpenseDelete', { tripId: 'trip-1', expenseId: 'e1', rev: seenByPrincipessa.rev }],
      ['tripExpenseDelete', { tripId: 'trip-1', expenseId: 'e1' }],
    ]) {
      const r = ctx.act(action, payload);
      assert.equal(r.ok, false, action);
    }
    assert.equal(ctx.act('tripExpenseDelete', { tripId: 'trip-1', expenseId: 'e1', rev: 1 }).code, 'STALE');
    assert.equal(ctx.snapshot(), before);
    assert.equal(expenseById('e1').amount, 7000);
    assert.equal(expenseById('e1').deletedAt, '');
  } finally { ctx.cleanup(); }
});

test('stale budget, trip, restore and settlement operations fail without changes', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    const tripRev = ledgerTrip().rev;
    assert.equal(ctx.act('tripSetBudget', { tripId: 'trip-1', rev: tripRev, amount: '850' }, 'Principe').ok, true);
    const before = ctx.snapshot();
    assert.equal(ctx.act('tripSetBudget', { tripId: 'trip-1', rev: tripRev, amount: '10' }).code, 'STALE');
    assert.equal(ctx.act('tripSetBudget', { tripId: 'trip-1', amount: '10' }).ok, false);
    assert.equal(ctx.act('tripUpdate', { tripId: 'trip-1', rev: tripRev, city: 'Elsewhere', start: '2026-09-20', end: '2026-09-27' }).code, 'STALE');
    assert.equal(ctx.snapshot(), before);

    addExpense(ctx.act, { id: 'e1', amount: 6200, category: 'eating-out' });
    ctx.act('tripExpenseDelete', { tripId: 'trip-1', expenseId: 'e1', rev: 1 });
    const deleted = expenseById('e1');
    // Restoring with the revision from before the delete is stale.
    assert.equal(ctx.act('tripExpenseRestore', { tripId: 'trip-1', expenseId: 'e1', rev: 1 }).code, 'STALE');
    assert.ok(expenseById('e1').deletedAt);
    // A second delete of an already-deleted expense is refused, not re-applied.
    assert.equal(ctx.act('tripExpenseDelete', { tripId: 'trip-1', expenseId: 'e1', rev: deleted.rev }).ok, false);

    ctx.act('tripSettlementSave', { tripId: 'trip-1', settlement: { id: 's1', from: 'Principe', to: 'Principessa', amount: 1000 } });
    ctx.act('tripSettlementSave', { tripId: 'trip-1', settlement: { id: 's1', rev: 1, from: 'Principe', to: 'Principessa', amount: 1200 } }, 'Principe');
    const beforeSettlement = ctx.snapshot();
    assert.equal(ctx.act('tripSettlementDelete', { tripId: 'trip-1', settlementId: 's1', rev: 1 }).code, 'STALE');
    assert.equal(ctx.act('tripSettlementSave', { tripId: 'trip-1', settlement: { id: 's1', rev: 1, from: 'Principe', to: 'Principessa', amount: 5 } }).code, 'STALE');
    assert.equal(ctx.snapshot(), beforeSettlement);
    assert.equal(ctx.act('tripSettlementDelete', { tripId: 'trip-1', settlementId: 's1', rev: 2 }).ok, true);
    assert.equal(ctx.act('tripSettlementRestore', { tripId: 'trip-1', settlementId: 's1', rev: 2 }).code, 'STALE');
    assert.equal(ctx.act('tripSettlementRestore', { tripId: 'trip-1', settlementId: 's1', rev: 3 }).ok, true);
    assert.equal(deriveTrip(ledgerTrip()).repaid.Principe, 1200);
  } finally { ctx.cleanup(); }
});

// ---------------------------------------------------------------- delete & exact undo

test('deleting is a soft delete; restoring brings back the exact record', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    addExpense(ctx.act, { id: 'e1', amount: 6200, category: 'eating-out', note: 'Dinner', estimated: true }, 'Principe');
    const original = expenseById('e1');
    const del = ctx.act('tripExpenseDelete', { tripId: 'trip-1', expenseId: 'e1', rev: original.rev }, 'Principessa');
    assert.equal(del.ok, true);
    assert.ok(expenseById('e1').deletedAt);
    assert.equal(expenseById('e1').deletedBy, 'Principessa');
    assert.equal(deriveTrip(ledgerTrip()).spent, 0);
    assert.equal(ctx.act('tripExpenseRestore', { tripId: 'trip-1', expenseId: 'e1', rev: del.expense.rev }).ok, true);
    const restored = expenseById('e1');
    for (const key of ['amount', 'category', 'subcategory', 'paidBy', 'split', 'jarAmount', 'jarShortfall', 'date', 'note', 'estimated', 'createdAt', 'createdBy']) {
      assert.deepEqual(restored[key], original[key], key);
    }
    assert.equal(restored.deletedAt, '');
    assert.equal(deriveTrip(ledgerTrip()).owed, 3100);
  } finally { ctx.cleanup(); }
});

test('undo restores the exact Jar part even if the Jar changed in between', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    assert.equal(jarCents(), 87000);
    // A: Stay with a Jar part of €144,00.
    const a = addExpense(ctx.act, { id: 'a', amount: 72000, category: 'stay', jarAmount: 14400 });
    assert.equal(jarCents(), 72600);
    const balanceWithA = deriveTrip(ledgerTrip());
    const delA = ctx.act('tripExpenseDelete', { tripId: 'trip-1', expenseId: 'a', rev: a.rev });
    assert.equal(jarCents(), 87000);
    // Meanwhile the Jar is spent almost completely by another Stay.
    const b = addExpense(ctx.act, { id: 'b', amount: 430000, category: 'stay', jarAmount: 86000 });
    assert.equal(b.jarAmount, 86000);
    assert.equal(jarCents(), 1000);
    // Undo restores A's €144,00 Jar part exactly -- no recalculation against
    // the Jar's current €10,00.
    assert.equal(ctx.act('tripExpenseRestore', { tripId: 'trip-1', expenseId: 'a', rev: delA.expense.rev }).ok, true);
    assert.equal(expenseById('a').jarAmount, 14400);
    assert.equal(expenseById('a').jarShortfall, 0);
    assert.equal(jarCents(), 1000 - 14400);
    // Remove B again: the state is exactly the one before A was deleted.
    ctx.act('tripExpenseDelete', { tripId: 'trip-1', expenseId: 'b', rev: expenseById('b').rev });
    const after = deriveTrip(ledgerTrip());
    assert.equal(after.spent, balanceWithA.spent);
    assert.equal(after.owed, balanceWithA.owed);
    assert.equal(after.debtor, balanceWithA.debtor);
    assert.equal(after.jarUsed, balanceWithA.jarUsed);
    assert.equal(jarCents(), 72600);
  } finally { ctx.cleanup(); }
});

test('undo of an expense that had no Jar part never adds one', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    // Asked for more than the Jar has: saved without a Jar part (shortfall).
    const big = ctx.act('tripExpenseSave', { tripId: 'trip-1', expense: { id: 'big', amount: 900000, category: 'stay', jarAmount: 180000 } });
    assert.deepEqual(big.jarNotApplied, { requested: 180000, available: 87000 });
    assert.equal(expenseById('big').jarAmount, 0);
    const plain = addExpense(ctx.act, { id: 'plain', amount: 50000, category: 'stay', jarAmount: 0 });
    const delBig = ctx.act('tripExpenseDelete', { tripId: 'trip-1', expenseId: 'big', rev: expenseById('big').rev });
    const delPlain = ctx.act('tripExpenseDelete', { tripId: 'trip-1', expenseId: 'plain', rev: plain.rev });
    assert.equal(jarCents(), 87000);
    ctx.act('tripExpenseRestore', { tripId: 'trip-1', expenseId: 'big', rev: delBig.expense.rev });
    ctx.act('tripExpenseRestore', { tripId: 'trip-1', expenseId: 'plain', rev: delPlain.expense.rev });
    assert.equal(expenseById('big').jarAmount, 0);
    assert.equal(expenseById('big').jarShortfall, 180000);
    assert.equal(expenseById('plain').jarAmount, 0);
    assert.equal(jarCents(), 87000);
  } finally { ctx.cleanup(); }
});

// ---------------------------------------------------------------- Shared Jar

test('Shared Jar: integer cents, one allocation per expense, edits recalculate', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    assert.equal(jarCents(), 87000);
    assert.equal(getState().sharedJar.balance, 870);
    const e = addExpense(ctx.act, { id: 'stay', amount: 72000, category: 'stay', jarAmount: 14400 });
    assert.equal(jarCents(), 72600);
    assert.equal(getState().sharedJar.balance, 726);
    assert.equal(getState().sharedJar.transactions.length, 0, 'the ledger writes no decimal-euro Jar transactions');
    assert.ok(Number.isInteger(expenseById('stay').jarAmount));
    assert.equal(deriveTrip(ledgerTrip()).owed, 28800);
    // Editing the Jar part and the amount recalculates Jar usage and balance.
    addExpense(ctx.act, { ...e, amount: 60000, jarAmount: 10000 });
    assert.equal(jarCents(), 77000);
    assert.equal(deriveTrip(ledgerTrip()).owed, 25000);
    ctx.act('tripExpenseDelete', { tripId: 'trip-1', expenseId: 'stay', rev: expenseById('stay').rev });
    assert.equal(jarCents(), 87000);
    assert.equal(deriveTrip(ledgerTrip()).owed, 0);
  } finally { ctx.cleanup(); }
});

test('Shared Jar never blocks a save: a shortfall is recorded and reported', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    const r = ctx.act('tripExpenseSave', { tripId: 'trip-1', expense: { id: 'big', amount: 900000, category: 'stay', jarAmount: 180000 } });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.jarNotApplied, { requested: 180000, available: 87000 });
    assert.equal(expenseById('big').jarAmount, 0);
    assert.equal(expenseById('big').jarShortfall, 180000);
    assert.equal(jarCents(), 87000);
  } finally { ctx.cleanup(); }
});

test('setting the Jar balance in Finances accounts for Jar money used by trips', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    addExpense(ctx.act, { id: 'stay', amount: 72000, category: 'stay', jarAmount: 14400 });
    assert.equal(ctx.act('updateSharedJarBalance', { balance: '500' }).ok, true);
    assert.equal(jarCents(), 50000);
    assert.equal(getState().sharedJar.balance, 500);
    ctx.act('tripExpenseDelete', { tripId: 'trip-1', expenseId: 'stay', rev: expenseById('stay').rev });
    assert.equal(jarCents(), 64400);
  } finally { ctx.cleanup(); }
});

// ---------------------------------------------------------------- settlements & isolation

test('settlements are recorded events; the balance is derived and history is kept', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    addExpense(ctx.act, { id: 'e1', amount: 60000, category: 'stay' });
    assert.equal(deriveTrip(ledgerTrip()).owed, 30000);
    const r = ctx.act('tripSettlementSave', { tripId: 'trip-1', settlement: { id: 's1', from: 'Principe', to: 'Principessa', amount: 30000 } }, 'Principe');
    assert.equal(r.ok, true, r.error);
    assert.equal(deriveTrip(ledgerTrip()).owed, 0);
    assert.equal(expenseById('e1').amount, 60000, 'a settlement never edits an expense');
    ctx.act('tripSettlementDelete', { tripId: 'trip-1', settlementId: 's1', rev: 1 });
    assert.equal(deriveTrip(ledgerTrip()).owed, 30000);
    assert.ok(ledgerTrip().settlements[0].deletedAt);
  } finally { ctx.cleanup(); }
});

test('trip actions leave the old trip data untouched', () => {
  const ctx = setup();
  try {
    const legacy = ctx.act('savePlan', { meta: { location: 'Italy', city: 'Lonato', start: '2026-05-01', end: '2026-05-04' }, budget: '500' });
    assert.equal(legacy.ok, true);
    const before = JSON.stringify(getState().plans);
    newTrip(ctx.act);
    addExpense(ctx.act, { id: 'e1', amount: 1000, category: 'groceries' });
    assert.equal(JSON.stringify(getState().plans), before);
    ctx.act('savePlan', { id: legacy.planId, budget: '600' });
    assert.equal(getState().tripLedger.length, 1);
  } finally { ctx.cleanup(); }
});
