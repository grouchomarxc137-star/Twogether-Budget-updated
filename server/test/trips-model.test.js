import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseMoneyToCents, formatCents, cleanTrip, cleanExpense, deriveTrip, expenseEffect,
  jarSuggestion, timeline, tripStatus, validateExpense, categoryOf,
} from '../../shared/trips-model.js';

const trip = (over = {}) => cleanTrip({
  id: 't1', place: { city: 'Amsterdam' }, start: '2026-09-20', end: '2026-09-27',
  plannedBudgets: { Principessa: 90000, Principe: 85000 }, expenses: [], settlements: [], ...over,
});
const exp = (over) => cleanExpense({ id: over.id || Math.random().toString(36).slice(2), date: '2026-09-21', category: 'eating-out', paidBy: 'Principessa', split: 'shared', ...over });

test('parses the amounts people actually type', () => {
  const cases = {
    '12': 1200, '12,5': 1250, '12,50': 1250, '12.50': 1250, '0,99': 99, '1.234,56': 123456,
    '1,234.56': 123456, '1.234': 123400, '1,234': 123400, '€ 1 234,56': 123456, '0.500': null,
    '': null, 'abc': null, '-5': null, '12,345,6': null, '1.2.3': null, '12.345.678': 1234567800,
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(parseMoneyToCents(input), expected, input);
});

test('formats money one way everywhere', () => {
  assert.equal(formatCents(123456), '€1.234,56');
  assert.equal(formatCents(175000, { whole: true }), '€1.750');
  assert.equal(formatCents(175050, { whole: true }), '€1.750,50');
  assert.equal(formatCents(-12000), '−€120,00');
  assert.equal(formatCents(5), '€0,05');
});

test('combined budget is the sum of the budgets that are set', () => {
  assert.equal(deriveTrip(trip()).available, 175000);
  assert.equal(deriveTrip(trip({ plannedBudgets: { Principessa: 90000 } })).available, 90000);
  assert.equal(deriveTrip(trip({ plannedBudgets: {} })).available, null);
  assert.equal(deriveTrip(trip({ plannedBudgets: {} })).left, null);
  assert.equal(deriveTrip(trip({ plannedBudgets: { Principe: 0 } })).available, 0);
});

test('a shared expense paid by one person makes the other owe half', () => {
  const d = deriveTrip(trip({ expenses: [exp({ amount: 6200, paidBy: 'Principe' })] }));
  assert.equal(d.spent, 6200);
  assert.equal(d.left, 175000 - 6200);
  assert.equal(d.debtor, 'Principessa');
  assert.equal(d.creditor, 'Principe');
  assert.equal(d.owed, 3100);
});

test('the payer keeps the odd cent', () => {
  const fx = expenseEffect(exp({ amount: 1001, paidBy: 'Principessa' }));
  assert.deepEqual(fx.share, { Principessa: 501, Principe: 500 });
  const d = deriveTrip(trip({ expenses: [exp({ amount: 1001, paidBy: 'Principessa' })] }));
  assert.equal(d.owed, 500);
});

test('personal expenses, each-paid-half and jar-paid expenses', () => {
  const forPartner = deriveTrip(trip({ expenses: [exp({ amount: 3000, paidBy: 'Principessa', split: 'Principe' })] }));
  assert.equal(forPartner.debtor, 'Principe');
  assert.equal(forPartner.owed, 3000);
  const ownThing = deriveTrip(trip({ expenses: [exp({ amount: 3000, paidBy: 'Principessa', split: 'Principessa' })] }));
  assert.equal(ownThing.owed, 0);
  const each = deriveTrip(trip({ expenses: [exp({ amount: 3001, paidBy: 'each' })] }));
  assert.equal(each.owed, 0);
  const jar = deriveTrip(trip({ expenses: [exp({ amount: 5000, paidBy: 'jar' })] }));
  assert.equal(jar.owed, 0);
  assert.equal(jar.spent, 5000);
  assert.equal(jar.jarUsed, 5000);
});

test('the Jar part of a Stay expense is not split between the two of you', () => {
  const d = deriveTrip(trip({ expenses: [exp({ amount: 72000, category: 'stay', paidBy: 'Principessa', jarAmount: 14400 })] }));
  assert.equal(d.spent, 72000);
  assert.equal(d.jarUsed, 14400);
  assert.equal(d.owed, 28800);
  assert.equal(d.debtor, 'Principe');
});

test('repayments are events that reduce the balance, and overpaying flips it', () => {
  const expenses = [exp({ amount: 72000, category: 'stay', paidBy: 'Principessa', jarAmount: 14400 })];
  const partial = deriveTrip(trip({ expenses, settlements: [{ id: 's1', from: 'Principe', to: 'Principessa', amount: 10000, date: '2026-09-28' }] }));
  assert.equal(partial.owed, 18800);
  assert.equal(partial.debtor, 'Principe');
  const full = deriveTrip(trip({ expenses, settlements: [{ id: 's1', from: 'Principe', to: 'Principessa', amount: 28800, date: '2026-09-28' }] }));
  assert.equal(full.owed, 0);
  assert.equal(full.debtor, null);
  const over = deriveTrip(trip({ expenses, settlements: [{ id: 's1', from: 'Principe', to: 'Principessa', amount: 30000, date: '2026-09-28' }] }));
  assert.equal(over.debtor, 'Principessa');
  assert.equal(over.owed, 1200);
});

test('deleted expenses and repayments count for nothing', () => {
  const d = deriveTrip(trip({
    expenses: [exp({ amount: 5000, deletedAt: '2026-09-22T10:00:00Z' }), exp({ amount: 1000 })],
    settlements: [{ id: 's', from: 'Principe', to: 'Principessa', amount: 500, date: '2026-09-22', deletedAt: 'x' }],
  }));
  assert.equal(d.spent, 1000);
  assert.equal(d.owed, 500);
  assert.equal(d.expenseCount, 1);
});

test('Jar suggestion is 20% capped at what the Jar has', () => {
  assert.equal(jarSuggestion(72000, 87000), 14400);
  assert.equal(jarSuggestion(72000, 5000), 5000);
  assert.equal(jarSuggestion(72000, 0), 0);
  assert.equal(jarSuggestion(0, 87000), 0);
});

test('status comes from the dates', () => {
  const t = trip();
  assert.equal(tripStatus(t, '2026-09-10'), 'upcoming');
  assert.equal(tripStatus(t, '2026-09-22'), 'ongoing');
  assert.equal(tripStatus(t, '2026-09-30'), 'ended');
  assert.equal(deriveTrip(t, { today: '2026-09-22' }).dayOf, 3);
  assert.equal(deriveTrip(t, { today: '2026-09-15' }).daysUntil, 5);
});

test('timeline is newest first and groups by day', () => {
  const t = trip({
    expenses: [exp({ id: 'a', date: '2026-09-20', createdAt: '1' }), exp({ id: 'b', date: '2026-09-21', createdAt: '2' }), exp({ id: 'c', date: '2026-09-21', createdAt: '3' })],
    settlements: [{ id: 's', from: 'Principe', to: 'Principessa', amount: 100, date: '2026-09-22', createdAt: '4' }],
  });
  const groups = timeline(t);
  assert.deepEqual(groups.map((g) => g.date), ['2026-09-22', '2026-09-21', '2026-09-20']);
  assert.deepEqual(groups[1].items.map((x) => x.item.id), ['c', 'b']);
});

test('cleaning never substitutes a financial meaning, and validation rejects the result', () => {
  const e = cleanExpense({ id: 'x', amount: 12.5, category: 'nope', subcategory: 'fuel', paidBy: 'someone', split: 'weird', jarAmount: 999999, date: '2026-02-30' });
  assert.equal(e.amount, 0);
  assert.equal(e.category, null, 'an unknown category is not turned into Other');
  assert.equal(e.subcategory, null);
  assert.equal(e.paidBy, null);
  assert.equal(e.split, null, 'an unknown split is not turned into shared');
  assert.equal(e.jarAmount, 999999, 'the Jar part is not silently clamped');
  assert.equal(e.date, '');
  assert.notEqual(validateExpense(e), '');
  assert.equal(cleanExpense({ id: 'y', amount: 1000, category: 'car', subcategory: 'fuel' }).subcategory, 'fuel');
  assert.equal(categoryOf('nope').label, 'Uncategorised');
  // A record with an unknown split moves no money and marks the balance incomplete.
  const d = deriveTrip(trip({ expenses: [cleanExpense({ id: 'z', amount: 1000, category: 'stay', paidBy: 'Principessa', split: 'weird', date: '2026-09-21' })] }));
  assert.equal(d.owed, 0);
  assert.equal(d.balanceComplete, false);
});

test('budgets never change who owes whom or how much', () => {
  const expenses = [exp({ amount: 60000, paidBy: 'Principessa' }), exp({ amount: 8000, paidBy: 'Principe' })];
  const results = [
    { Principessa: 90000, Principe: 85000 },
    { Principessa: 1, Principe: 999999 },
    { Principessa: 90000 },
    {},
  ].map((plannedBudgets) => deriveTrip(trip({ plannedBudgets, expenses })));
  for (const d of results) {
    assert.equal(d.debtor, 'Principe');
    assert.equal(d.owed, 26000);
    assert.equal(d.spent, 68000);
  }
  assert.deepEqual(results.map((d) => d.available), [175000, 1000000, 90000, null]);
  assert.deepEqual(results.map((d) => d.left), [107000, 932000, 22000, null]);
});
