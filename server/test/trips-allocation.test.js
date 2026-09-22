import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';
import { openDatabase } from '../src/db/index.js';
import {
  cleanTrip, cleanExpense, cleanSettlement, deriveTrip, balanceBreakdown, autoAllocate,
  claimOf, repaymentsFor,
} from '../../shared/trips-model.js';

const P = 'Principessa', Q = 'Principe';

// ---------------------------------------------------------------- model

const exp = (id, date, over) => cleanExpense({ id, date, createdAt: `${date}T10:00:00Z`, category: 'other', split: 'shared', ...over });
const settle = (id, from, amount, over = {}) => cleanSettlement({ id, from, to: from === P ? Q : P, amount, date: '2026-09-25', ...over });
const tripWith = (expenses, settlements = []) => cleanTrip({ id: 't', place: { city: 'X' }, start: '2026-09-18', end: '2026-09-26', expenses, settlements });

// The example from the review: Q owes P 86 after offsets and a general repayment.
function reviewExample(settlements = [settle('s0', Q, 20000)]) {
  return tripWith([
    exp('airbnb', '2026-09-18', { amount: 57600, paidBy: P, category: 'stay' }), // Q's share 288
    exp('groceries', '2026-09-19', { amount: 4200, paidBy: P }), // 21
    exp('dinner', '2026-09-20', { amount: 3200, paidBy: P }), // 16
    exp('fuel', '2026-09-20', { amount: 5800, paidBy: Q }), // P's share 29 -> offset
    exp('activity', '2026-09-21', { amount: 2000, paidBy: Q }), // 10 -> offset
  ], settlements);
}

test('claims: who covered whose share, and only when money moves between you', () => {
  assert.deepEqual(claimOf(exp('a', '2026-09-18', { amount: 1001, paidBy: P })), { from: Q, to: P, amount: 500 });
  assert.deepEqual(claimOf(exp('b', '2026-09-18', { amount: 3000, paidBy: P, split: Q })), { from: Q, to: P, amount: 3000 });
  assert.equal(claimOf(exp('c', '2026-09-18', { amount: 3000, paidBy: P, split: P })), null);
  assert.equal(claimOf(exp('d', '2026-09-18', { amount: 3000, paidBy: 'each' })), null);
  assert.equal(claimOf(exp('e', '2026-09-18', { amount: 3000, paidBy: 'jar', jarAmount: 3000 })), null);
  assert.deepEqual(claimOf(exp('f', '2026-09-18', { amount: 72000, paidBy: P, jarAmount: 14400 })), { from: Q, to: P, amount: 28800 });
  assert.equal(claimOf(exp('g', '2026-09-18', { amount: 3000, paidBy: P, deletedAt: 'x' })), null);
});

test('offsets and earlier repayments settle the oldest claims first; still open adds up to the balance', () => {
  const t = reviewExample();
  const d = deriveTrip(t);
  assert.equal(d.debtor, Q);
  assert.equal(d.owed, 8600);
  const b = balanceBreakdown(t);
  assert.equal(b.coveredTotal, 32500);
  assert.equal(b.offsetTotal, 3900);
  assert.equal(b.paidTotal, 20000);
  assert.deepEqual(b.stillOpen.map((x) => [x.expense.id, x.amount]), [['airbnb', 4900], ['groceries', 2100], ['dinner', 1600]]);
  assert.equal(b.stillOpenTotal, d.owed);
});

test('automatic allocation: oldest still-open claims first, partial and over-payment', () => {
  const t = reviewExample();
  assert.deepEqual(autoAllocate(t, 8600, Q, P), { allocations: [{ expenseId: 'airbnb', amount: 4900 }, { expenseId: 'groceries', amount: 2100 }, { expenseId: 'dinner', amount: 1600 }], general: 0 });
  assert.deepEqual(autoAllocate(t, 6000, Q, P), { allocations: [{ expenseId: 'airbnb', amount: 4900 }, { expenseId: 'groceries', amount: 1100 }], general: 0 });
  assert.deepEqual(autoAllocate(t, 10000, Q, P).general, 1400);
  // Paying in the direction nobody owes stays general.
  assert.deepEqual(autoAllocate(t, 1000, P, Q), { allocations: [], general: 1000 });
});

test('allocations never change the net balance', () => {
  const variants = [
    [settle('s0', Q, 20000)],
    [settle('s0', Q, 20000, { allocationMode: 'manual', allocations: [{ expenseId: 'airbnb', amount: 20000 }] })],
    [settle('s0', Q, 20000, { allocationMode: 'manual', allocations: [{ expenseId: 'dinner', amount: 1600 }, { expenseId: 'groceries', amount: 2100 }] })],
    [settle('s0', Q, 20000, { allocationMode: 'manual', allocations: [{ expenseId: 'deleted-or-unknown', amount: 20000 }] })],
    [settle('s0', Q, 20000, { allocationMode: 'manual', allocations: [{ expenseId: 'fuel', amount: 2900 }] })],
  ];
  const results = variants.map((s) => { const t = reviewExample(s); return [deriveTrip(t).net, balanceBreakdown(t).stillOpenTotal]; });
  for (const r of results) assert.deepEqual(r, [8600, 8600]);
});

test('an explicit allocation marks that expense as repaid; the net stays the truth', () => {
  const t = reviewExample([settle('s0', Q, 20000, { allocationMode: 'manual', allocations: [{ expenseId: 'dinner', amount: 1600 }] })]);
  const b = balanceBreakdown(t);
  assert.equal(b.covered.find((r) => r.expense.id === 'dinner').allocated, 1600);
  assert.equal(b.stillOpen.some((x) => x.expense?.id === 'dinner'), false);
  assert.equal(b.stillOpenTotal, 8600);
  assert.deepEqual(repaymentsFor(t, 'dinner').map((x) => x.amount), [1600]);
});

test('when the net balance is zero nothing is shown as open, even with gross claims both ways', () => {
  const t = tripWith([
    exp('a', '2026-09-18', { amount: 4000, paidBy: P }),
    exp('b', '2026-09-19', { amount: 4000, paidBy: Q }),
  ]);
  const b = balanceBreakdown(t);
  assert.equal(b.even, true);
  assert.equal(b.coveredTotal, 2000);
  assert.equal(b.offsetTotal, 2000);
  assert.deepEqual(b.stillOpen, []);
});

test('money sent the other way increases what is owed without being tied to an expense', () => {
  const t = tripWith([exp('a', '2026-09-18', { amount: 2000, paidBy: P })], [settle('s', P, 500)]);
  const b = balanceBreakdown(t);
  assert.equal(deriveTrip(t).owed, 1500);
  assert.deepEqual(b.stillOpen.map((x) => [x.expense?.id ?? null, x.amount]), [['a', 1000], [null, 500]]);
  assert.equal(b.stillOpenTotal, 1500);
});

// Deterministic pseudo-random ledgers: still open always equals the net.
function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }
test('property: still-open amounts always add up exactly to the net balance', () => {
  const r = rng(7);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  for (let round = 0; round < 400; round++) {
    const expenses = [], settlements = [];
    const n = 1 + Math.floor(r() * 10);
    for (let i = 0; i < n; i++) {
      const amount = 1 + Math.floor(r() * 50000);
      const paidBy = pick([P, Q, P, Q, 'each', 'jar']);
      expenses.push(exp(`e${i}`, `2026-09-${String(10 + Math.floor(r() * 18)).padStart(2, '0')}`, {
        amount, paidBy,
        split: paidBy === 'each' || paidBy === 'jar' ? 'shared' : pick(['shared', 'shared', P, Q]),
        jarAmount: paidBy === 'jar' ? amount : r() < 0.2 ? Math.floor(amount * 0.2) : 0,
        deletedAt: r() < 0.1 ? 'x' : '',
      }));
    }
    const m = Math.floor(r() * 4);
    for (let i = 0; i < m; i++) {
      const from = pick([P, Q]);
      const allocations = r() < 0.5 ? [{ expenseId: pick(expenses).id, amount: 1 + Math.floor(r() * 30000) }] : [];
      settlements.push(settle(`s${i}`, from, 1 + Math.floor(r() * 40000), { allocations, allocationMode: allocations.length ? 'manual' : 'none', deletedAt: r() < 0.1 ? 'x' : '' }));
    }
    const t = tripWith(expenses, settlements);
    const d = deriveTrip(t), b = balanceBreakdown(t);
    assert.equal(b.stillOpenTotal, d.owed, `round ${round}`);
    assert.equal(b.even, d.net === 0);
    for (const x of b.stillOpen) assert.ok(x.amount > 0);
    // Removing every allocation never changes the net.
    const bare = tripWith(expenses, settlements.map((s) => ({ ...s, allocations: [] })));
    assert.equal(deriveTrip(bare).net, d.net);
  }
});

// ---------------------------------------------------------------- server

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'twogether-alloc-'));
  const database = openDatabase(join(directory, 'test.sqlite'));
  configureStateStore(database.store);
  const act = (name, payload, actor = P) => database.db.transaction(() => runAction(name, payload, actor))();
  const snapshot = () => JSON.stringify(database.db.prepare('SELECT id, json FROM trip_ledger ORDER BY id').all());
  return { act, snapshot, cleanup() { database.close(); rmSync(directory, { recursive: true, force: true }); } };
}
const trip = () => cleanTrip(getState().tripLedger.find((t) => t.id === 'trip'));
function seed(act) {
  assert.equal(act('tripCreate', { trip: { id: 'trip', city: 'Lisbon', start: '2026-09-18', end: '2026-09-26' } }).ok, true);
  const add = (id, date, amount, actor, over = {}) => assert.equal(act('tripExpenseSave', { tripId: 'trip', expense: { id, date, amount, category: 'other', ...over } }, actor).ok, true);
  add('airbnb', '2026-09-18', 57600, P, { category: 'stay' });
  add('groceries', '2026-09-19', 4200, P);
  add('dinner', '2026-09-20', 3200, P);
  add('fuel', '2026-09-20', 5800, Q);
  add('activity', '2026-09-21', 2000, Q);
  assert.equal(act('tripSettlementSave', { tripId: 'trip', settlement: { id: 's0', from: Q, to: P, amount: 20000 } }, Q).ok, true);
}

test('server: an automatic repayment stores the oldest-first explanation and evens the balance', () => {
  const ctx = setup();
  try {
    seed(ctx.act);
    assert.equal(deriveTrip(trip()).owed, 8600);
    const r = ctx.act('tripSettlementSave', { tripId: 'trip', settlement: { id: 's1', from: Q, to: P, amount: 8600, allocationMode: 'auto' } }, Q);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.settlement.allocationMode, 'auto');
    assert.deepEqual(r.settlement.allocations, [{ expenseId: 'airbnb', amount: 4900 }, { expenseId: 'groceries', amount: 2100 }, { expenseId: 'dinner', amount: 1600 }]);
    const b = balanceBreakdown(trip());
    assert.equal(b.even, true);
    assert.deepEqual(b.stillOpen, []);
    assert.equal(deriveTrip(trip()).net, 0);
  } finally { ctx.cleanup(); }
});

test('server: manual allocations are checked and a bad choice changes nothing', () => {
  const ctx = setup();
  try {
    seed(ctx.act);
    const before = ctx.snapshot();
    const bad = [
      [{ expenseId: 'fuel', amount: 100 }], // the other direction
      [{ expenseId: 'nope', amount: 100 }],
      [{ expenseId: 'airbnb', amount: 28801 }], // more than the claim
      [{ expenseId: 'airbnb', amount: 3000 }, { expenseId: 'airbnb', amount: 1000 }],
      [{ expenseId: 'airbnb', amount: 0 }],
      [{ expenseId: 'airbnb', amount: 5000 }, { expenseId: 'groceries', amount: 2100 }], // > settlement amount
      [],
    ];
    for (const allocations of bad) {
      const r = ctx.act('tripSettlementSave', { tripId: 'trip', settlement: { id: 'm', from: Q, to: P, amount: 6000, allocationMode: 'manual', allocations } }, Q);
      assert.equal(r.ok, false, JSON.stringify(allocations));
    }
    assert.equal(ctx.act('tripSettlementSave', { tripId: 'trip', settlement: { id: 'm', from: Q, to: P, amount: 6000, allocationMode: 'none', allocations: [{ expenseId: 'airbnb', amount: 1 }] } }, Q).ok, false);
    assert.equal(ctx.act('tripSettlementSave', { tripId: 'trip', settlement: { id: 'm', from: Q, to: P, amount: 6000, allocationMode: 'sometimes' } }, Q).ok, false);
    assert.equal(ctx.snapshot(), before);

    const ok = ctx.act('tripSettlementSave', { tripId: 'trip', settlement: { id: 'm', from: Q, to: P, amount: 6000, allocationMode: 'manual', allocations: [{ expenseId: 'airbnb', amount: 4000 }, { expenseId: 'dinner', amount: 1600 }] } }, Q);
    assert.equal(ok.ok, true, ok.error);
    assert.deepEqual(repaymentsFor(trip(), 'airbnb').map((x) => x.amount), [4000]);
    // 400 of the 6000 is general; the net only sees 6000.
    assert.equal(deriveTrip(trip()).owed, 2600);
    assert.equal(balanceBreakdown(trip()).stillOpenTotal, 2600);
    // A second repayment against the same expense is limited by what is left.
    assert.equal(ctx.act('tripSettlementSave', { tripId: 'trip', settlement: { id: 'm2', from: Q, to: P, amount: 30000, allocationMode: 'manual', allocations: [{ expenseId: 'airbnb', amount: 24801 }] } }, Q).ok, false);
    assert.equal(ctx.act('tripSettlementSave', { tripId: 'trip', settlement: { id: 'm2', from: Q, to: P, amount: 2000, allocationMode: 'manual', allocations: [{ expenseId: 'airbnb', amount: 2000 }] } }, Q).ok, true);
    assert.deepEqual(repaymentsFor(trip(), 'airbnb').map((x) => x.amount), [4000, 2000]);
  } finally { ctx.cleanup(); }
});

test('server: editing, deleting and restoring allocated records keeps the balance and history intact', () => {
  const ctx = setup();
  try {
    seed(ctx.act);
    ctx.act('tripSettlementSave', { tripId: 'trip', settlement: { id: 's1', from: Q, to: P, amount: 5000, allocationMode: 'manual', allocations: [{ expenseId: 'groceries', amount: 2100 }, { expenseId: 'dinner', amount: 1600 }] } }, Q);
    const check = () => { const t = trip(); assert.equal(balanceBreakdown(t).stillOpenTotal, deriveTrip(t).owed); return t; };

    // Edit the dinner down below what was repaid toward it: the allocation is
    // kept as recorded, the extra counts as general, the net follows the edit.
    const dinner = trip().expenses.find((e) => e.id === 'dinner');
    assert.equal(ctx.act('tripExpenseSave', { tripId: 'trip', expense: { ...dinner, amount: 1000 } }).ok, true);
    let t = check();
    assert.deepEqual(t.settlements.find((s) => s.id === 's1').allocations, [{ expenseId: 'groceries', amount: 2100 }, { expenseId: 'dinner', amount: 1600 }]);
    assert.equal(balanceBreakdown(t).covered.find((r) => r.expense.id === 'dinner').overAllocated, 1100);

    // Delete groceries: its allocation becomes general; restore reattaches it.
    const groceries = t.expenses.find((e) => e.id === 'groceries');
    const del = ctx.act('tripExpenseDelete', { tripId: 'trip', expenseId: 'groceries', rev: groceries.rev });
    t = check();
    assert.equal(balanceBreakdown(t).covered.some((r) => r.expense.id === 'groceries'), false);
    ctx.act('tripExpenseRestore', { tripId: 'trip', expenseId: 'groceries', rev: del.expense.rev });
    t = check();
    assert.equal(balanceBreakdown(t).covered.find((r) => r.expense.id === 'groceries').allocated, 2100);

    // Delete and restore the settlement: allocations travel with it.
    const s1 = t.settlements.find((s) => s.id === 's1');
    const netBefore = deriveTrip(t).net;
    const sd = ctx.act('tripSettlementDelete', { tripId: 'trip', settlementId: 's1', rev: s1.rev });
    t = check();
    assert.equal(repaymentsFor(t, 'groceries').length, 0);
    ctx.act('tripSettlementRestore', { tripId: 'trip', settlementId: 's1', rev: sd.settlement.rev });
    t = check();
    assert.equal(deriveTrip(t).net, netBefore);
    assert.deepEqual(t.settlements.find((s) => s.id === 's1').allocations.map((a) => a.expenseId), ['groceries', 'dinner']);
  } finally { ctx.cleanup(); }
});
