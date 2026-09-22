import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';
import { openDatabase } from '../src/db/index.js';

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'twogether-db-'));
  const database = openDatabase(join(directory, 'test.sqlite'));
  configureStateStore(database.store);
  return {
    database,
    cleanup() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function action(database, name, payload, actor = 'Principessa') {
  return database.db.transaction(() => runAction(name, payload, actor))();
}

test('starts with a complete empty state stored in SQLite tables', () => {
  const context = setup();
  try {
    const state = getState();
    assert.equal(state.version, 18);
    assert.deepEqual(state.trips, []);
    assert.deepEqual(state.plans, []);
    assert.equal(state.sharedJar.balance, 870);
    assert.deepEqual(
      context.database.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name),
      ['app_state', 'finance_months', 'finance_profiles', 'game_profiles', 'plans', 'trips'],
    );
  } finally {
    context.cleanup();
  }
});

test('creates a trip plan without a budget when budget is skipped', () => {
  const context = setup();
  try {
    const created = action(context.database, 'savePlan', {
      meta: { location: 'Italy', city: 'Desenzano', start: '2026-10-01', end: '2026-10-08' },
      budget: '',
    });
    assert.equal(created.ok, true);
    const plan = getState().plans.find((item) => item.id === created.planId);
    assert.ok(plan);
    assert.equal(plan.budgets.Principessa, '');
    assert.equal(plan.meta.start, '2026-10-01');
    assert.equal(plan.meta.end, '2026-10-08');
  } finally {
    context.cleanup();
  }
});

test('persists plans, shared expenses, trip confirmation and rewards', () => {
  const context = setup();
  try {
    const meta = { location: 'Italy', city: 'Verona', start: '2026-10-01', end: '2026-10-03' };
    const created = action(context.database, 'savePlan', { meta, budget: 500 });
    assert.equal(created.ok, true);
    assert.equal(action(context.database, 'savePlan', { id: created.planId, budget: 500 }, 'Principe').ok, true);

    assert.equal(action(context.database, 'saveSharedExpense', {
      planId: created.planId, key: 'accom', total: 800, mode: 'shared', paid: 400, expectedTotal: '',
    }).ok, true);
    assert.equal(action(context.database, 'saveSharedExpense', {
      planId: created.planId, key: 'accom', total: 800, mode: 'shared', paid: 400, expectedTotal: 800,
    }, 'Principe').ok, true);

    const submission = {
      ...meta, accom: 800, travel: 0, groceries: 0, eat: 0, fuel: 0,
      tolls: 0, other: 0, otherNote: '', paid: 400, uncertain: {},
    };
    const first = action(context.database, 'savePlanSubmission', { planId: created.planId, submission });
    assert.equal(first.ok, true);
    assert.equal(action(context.database, 'savePlanSubmission', { planId: created.planId, submission }, 'Principe').ok, true);
    assert.equal(action(context.database, 'confirmTrip', { id: first.tripId }).ok, true);
    assert.equal(action(context.database, 'confirmTrip', { id: first.tripId }, 'Principe').ok, true);

    const state = getState();
    assert.equal(state.trips[0].confirmed.Principessa, true);
    assert.equal(state.trips[0].confirmed.Principe, true);
    assert.equal(state.game.Principessa.twos, 100);
    assert.equal(state.game.Principe.twos, 100);
    assert.ok(state.updatedAt);
  } finally {
    context.cleanup();
  }
});

test('handles the shared jar and repayment confirmation', () => {
  const context = setup();
  try {
    const created = action(context.database, 'savePlan', {
      meta: { location: 'Italy', city: 'Rome', start: '2026-11-01', end: '2026-11-02' },
      budget: 300,
    });
    const saved = action(context.database, 'saveAccommodationExpense', {
      planId: created.planId, total: 500, useJar: true, paymentType: 'shared', paidUpfront: true,
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.sharedJar.balance, 770);
    assert.equal(saved.sharedExpense.accommodation.repayment.amount, 200);
    assert.equal(saved.sharedExpense.accommodation.repayment.status, 'pending');

    const confirmed = action(context.database, 'confirmAccommodationRepayment', {
      planId: created.planId, paidBack: true,
    }, 'Principe');
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.sharedExpense.accommodation.repayment.status, 'confirmed');
  } finally {
    context.cleanup();
  }
});

test('edits the Shared Jar balance without breaking accommodation deductions', () => {
  const context = setup();
  try {
    const created = action(context.database, 'savePlan', {
      meta: { location: 'Italy', city: 'Bergamo', start: '2026-11-10', end: '2026-11-12' },
      budget: 400,
    });
    const first = action(context.database, 'saveAccommodationExpense', {
      planId: created.planId, total: 500, useJar: true, paymentType: 'shared', paidUpfront: true,
    });
    assert.equal(first.sharedJar.balance, 770);
    assert.equal(first.sharedJar.transactions.length, 1);

    const edited = action(context.database, 'updateSharedJarBalance', { balance: 600 });
    assert.equal(edited.ok, true);
    assert.equal(edited.sharedJar.balance, 600);
    assert.equal(edited.sharedJar.initialBalance, 700);
    assert.equal(edited.sharedJar.transactions.length, 1);

    const changedAccommodation = action(context.database, 'saveAccommodationExpense', {
      planId: created.planId, total: 1000, useJar: true, paymentType: 'shared', paidUpfront: true,
    });
    assert.equal(changedAccommodation.sharedJar.balance, 500);
    assert.equal(changedAccommodation.sharedJar.transactions[0].amount, 200);
  } finally {
    context.cleanup();
  }
});

test('persists finance and wishlist data independently', () => {
  const context = setup();
  try {
    const month = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-09', incomes: [{ name: 'Income', amount: 1000 }],
        expenses: [{ group: 'rent', name: 'Rent', amount: 100 }],
        extraBudget: 250, extraSpends: [], finalized: true,
      },
    });
    assert.equal(month.ok, true);
    assert.equal(month.twosDelta, 650);

    const profile = {
      bankAccounts: [], savingsTotal: '', savingsReserved: [], receivables: [], scenarios: [], compareLab: {},
      wishlist: [{ id: 'wish-1', name: 'Weekend bag', price: 40, priority: 2, createdAt: '2026-09-01T00:00:00Z' }],
    };
    assert.equal(action(context.database, 'saveFinanceProfile', { profile }).ok, true);
    assert.equal(action(context.database, 'wishlistCheckout', { ids: ['wish-1'] }).ok, true);

    const state = getState();
    assert.equal(state.finances.Principessa.length, 1);
    assert.equal(state.financeProfiles.Principessa.wishlist[0].unlockedBy, 'Principessa');
    assert.equal(state.game.Principessa.twos, 610);
    assert.equal(state.game.Principessa.lovis, 8);
  } finally {
    context.cleanup();
  }
});

test('partial finance drafts keep only the expenses explicitly logged', () => {
  const context = setup();
  try {
    const result = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-09',
        incomes: [],
        expenses: [{ group: 'rent', name: 'Rent', amount: 50 }],
        extraBudget: 250,
        extraSpends: [],
        partialOnly: true,
        finalized: false,
      },
    });
    assert.equal(result.ok, true);
    const saved = getState().finances.Principessa[0];
    assert.equal(saved.partialOnly, true);
    assert.deepEqual(saved.expenses.map((x) => x.name), ['Rent']);
  } finally {
    context.cleanup();
  }
});

test('Principe Saved up spending is savings-only and adjusts the saved total by the edit delta', () => {
  const context = setup();
  try {
    assert.equal(action(context.database, 'saveFinanceProfile', { profile: { savingsTotal: 1000 } }, 'Principe').ok, true);

    const first = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-09',
        incomes: [{ name: 'Salary', amount: 1550 }],
        expenses: [{ group: 'rent', name: 'Rent', amount: 575 }],
        extraSpends: [
          { source: 'savings', amount: 120 },
          { source: 'creditcard', amount: 50 },
        ],
        finalized: false,
      },
    }, 'Principe');
    assert.equal(first.ok, true);
    assert.equal(first.financeProfile.savingsTotal, 880);
    assert.deepEqual(getState().finances.Principe[0].extraSpends.map((x) => x.source), ['savings']);

    const edited = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-09',
        incomes: [{ name: 'Salary', amount: 1550 }],
        expenses: [{ group: 'rent', name: 'Rent', amount: 575 }],
        extraSpends: [{ source: 'savings', amount: 70 }],
        finalized: false,
      },
    }, 'Principe');
    assert.equal(edited.ok, true);
    assert.equal(edited.financeProfile.savingsTotal, 930);

    const removed = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-09',
        incomes: [{ name: 'Salary', amount: 1550 }],
        expenses: [{ group: 'rent', name: 'Rent', amount: 575 }],
        extraSpends: [],
        finalized: false,
      },
    }, 'Principe');
    assert.equal(removed.ok, true);
    assert.equal(removed.financeProfile.savingsTotal, 1000);

    const tooMuch = action(context.database, 'saveFinanceMonth', {
      monthData: { month: '2026-10', incomes: [], expenses: [], extraSpends: [{ source: 'savings', amount: 1200 }], finalized: false },
    }, 'Principe');
    assert.equal(tooMuch.ok, false);
    assert.match(tooMuch.error, /Saved up only has/);
    assert.equal(getState().financeProfiles.Principe.savingsTotal, 1000);
  } finally {
    context.cleanup();
  }
});

test('keeps optional finance dates and recurring usual days', () => {
  const context = setup();
  try {
    const profileResult = action(context.database, 'saveFinanceProfile', {
      profile: {
        recurring: {
          custom: true,
          incomes: [{ id: 'income-salary', name: 'Salary', amount: 1550, day: 24 }],
          expenses: [
            { id: 'expense-phone', group: 'subscriptions', name: 'Odido', amount: 30, day: 30 },
            { id: 'expense-flex', group: 'other', name: 'Flexible', amount: 12, day: 40 },
          ],
        },
      },
    });
    assert.equal(profileResult.ok, true);

    const monthResult = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-09',
        incomes: [{ name: 'Salary', amount: 1550, date: '2026-09-24' }],
        expenses: [
          { group: 'subscriptions', name: 'Odido', amount: 30, date: '2026-09-30' },
          { group: 'other', name: 'Wrong month', amount: 5, date: '2026-10-01' },
        ],
        finalized: false,
      },
    });
    assert.equal(monthResult.ok, true);

    const state = getState();
    assert.equal(state.financeProfiles.Principessa.recurring.incomes[0].day, 24);
    assert.equal(state.financeProfiles.Principessa.recurring.expenses[0].day, 30);
    assert.equal(state.financeProfiles.Principessa.recurring.expenses[1].day, '');
    assert.equal(state.finances.Principessa[0].incomes[0].date, '2026-09-24');
    assert.equal(state.finances.Principessa[0].expenses.find((x) => x.name === 'Odido').date, '2026-09-30');
    assert.equal(state.finances.Principessa[0].expenses.find((x) => x.name === 'Wrong month').date, '');
  } finally {
    context.cleanup();
  }
});

test('keeps saved data after the database is closed and reopened', () => {
  const directory = mkdtempSync(join(tmpdir(), 'twogether-reopen-'));
  const databasePath = join(directory, 'test.sqlite');
  try {
    let database = openDatabase(databasePath);
    configureStateStore(database.store);
    const saved = action(database, 'savePlan', {
      meta: { location: 'Italy', city: 'Milan', start: '2026-12-01', end: '2026-12-02' },
      budget: 275,
    });
    assert.equal(saved.ok, true);
    database.close();

    database = openDatabase(databasePath);
    configureStateStore(database.store);
    assert.equal(getState().plans[0].id, saved.planId);
    assert.equal(getState().plans[0].budgets.Principessa, 275);
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('trip expense entries save one at a time, keep Food types, and restrict Shared Jar to accommodation', () => {
  const c = setup();
  try {
    const p = action(c.database, 'savePlan', { meta: { location: 'Italy', city: 'Lonato', start: '2026-09-19', end: '2026-09-22' }, budget: 500 });
    const groceries = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'food', foodType: 'groceries', amount: 42, paidBy: 'Principessa', split: 'shared', date: '2026-09-20', useJar: true } });
    assert.equal(groceries.expense.foodType, 'groceries');
    assert.equal(groceries.expense.useJar, false);
    assert.equal(groceries.sharedJar.balance, 870);

    const eatingOut = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'food', foodType: 'eating-out', amount: 18, paidBy: 'Principe', split: 'shared', date: '2026-09-21' } });
    assert.equal(eatingOut.expense.foodType, 'eating-out');
    const foodTypes = getState().plans[0].expenseEntries.filter((x) => x.category === 'food').map((x) => x.foodType);
    assert.deepEqual(foodTypes, ['groceries', 'eating-out']);

    const tolls = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'transport', transportType: 'tolls', amount: 12, paidBy: 'Principessa', split: 'shared', date: '2026-09-21' } });
    const fuel = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'transport', transportType: 'fuel', amount: 55, paidBy: 'Principe', split: 'shared', date: '2026-09-21' } });
    const transportOther = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'transport', transportType: 'other', amount: 9, paidBy: 'Principessa', split: 'personal', forActor: 'Principessa', date: '2026-09-21' } });
    assert.equal(tolls.expense.transportType, 'tolls');
    assert.equal(fuel.expense.transportType, 'fuel');
    assert.equal(transportOther.expense.transportType, 'other');
    const transportTypes = getState().plans[0].expenseEntries.filter((x) => x.category === 'transport').map((x) => x.transportType);
    assert.deepEqual(transportTypes, ['tolls', 'fuel', 'other']);

    const flights = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'transport', transportType: 'flights-trains', amount: 70, paidBy: 'Principessa', split: 'shared', date: '2026-09-21' } });
    const parking = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'transport', transportType: 'parking-tolls', amount: 14, paidBy: 'Principe', split: 'shared', date: '2026-09-21' } });
    const foodOther = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'food', foodType: 'other', name: 'Picnic supplies', amount: 11, paidBy: 'Principessa', split: 'shared', date: '2026-09-21' } });
    const namedOther = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'other', name: 'Souvenirs', amount: 25, paidBy: 'Principe', split: 'personal', forActor: 'Principe', date: '2026-09-21' } });
    assert.equal(flights.expense.transportType, 'flights-trains');
    assert.equal(parking.expense.transportType, 'parking-tolls');
    assert.equal(foodOther.expense.foodType, 'other');
    assert.equal(foodOther.expense.name, 'Picnic supplies');
    assert.equal(namedOther.expense.name, 'Souvenirs');

    const a = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'accommodation', foodType: 'groceries', amount: 500, paidBy: 'Principessa', split: 'shared', date: '2026-09-20', useJar: true } });
    assert.equal(a.expense.foodType, '');
    assert.equal(a.expense.transportType, '');
    assert.equal(a.expense.jarContribution, 100);
    assert.equal(a.sharedJar.balance, 770);
    const d = action(c.database, 'deleteTripExpense', { planId: p.planId, expenseId: a.expense.id });
    assert.equal(d.sharedJar.balance, 870);
  } finally {
    c.cleanup();
  }
});

test('deletes an unfinished current trip safely and restores Shared Jar usage', () => {
  const c = setup();
  try {
    const p = action(c.database, 'savePlan', {
      meta: { location: 'Italy', city: 'Lonato', start: '2026-09-19', end: '2026-09-22' },
      budget: 500,
    });
    const stay = action(c.database, 'saveTripExpense', {
      planId: p.planId,
      expense: { category: 'accommodation', amount: 500, paidBy: 'Principessa', split: 'shared', date: '2026-09-20', useJar: true },
    });
    assert.equal(stay.sharedJar.balance, 770);

    const linked = action(c.database, 'savePlanSubmission', {
      planId: p.planId,
      submission: {
        location: 'Italy', city: 'Lonato', start: '2026-09-19', end: '2026-09-22',
        accom: 0, travel: 0, groceries: 0, eat: 0, fuel: 0, tolls: 0, other: 0,
        otherNote: '', paid: 0, uncertain: {},
      },
    });
    assert.ok(linked.tripId);
    assert.equal(getState().plans.length, 1);
    assert.equal(getState().trips.length, 1);

    const removed = action(c.database, 'deleteCurrentTrip', { kind: 'plan', id: p.planId });
    assert.equal(removed.ok, true);
    assert.equal(removed.sharedJar.balance, 870);
    assert.equal(getState().plans.length, 0);
    assert.equal(getState().trips.length, 0);
  } finally {
    c.cleanup();
  }
});

test('deletes standalone unfinished trips but protects confirmed trips', () => {
  const c = setup();
  try {
    const standalone = action(c.database, 'saveSubmission', {
      submission: {
        location: 'Italy', city: 'Bergamo', start: '2026-10-01', end: '2026-10-02',
        accom: 10, travel: 0, groceries: 0, eat: 0, fuel: 0, tolls: 0, other: 0,
        otherNote: '', paid: 10, uncertain: {},
      },
      budget: 100,
    });
    assert.equal(action(c.database, 'deleteCurrentTrip', { kind: 'trip', id: standalone.tripId }).ok, true);
    assert.equal(getState().trips.length, 0);

    const p = action(c.database, 'savePlan', {
      meta: { location: 'Italy', city: 'Rome', start: '2026-11-01', end: '2026-11-02' },
      budget: 300,
    });
    action(c.database, 'savePlan', { id: p.planId, budget: 300 }, 'Principe');
    const submission = {
      location: 'Italy', city: 'Rome', start: '2026-11-01', end: '2026-11-02',
      accom: 0, travel: 0, groceries: 0, eat: 0, fuel: 0, tolls: 0, other: 0,
      otherNote: '', paid: 0, uncertain: {},
    };
    const first = action(c.database, 'savePlanSubmission', { planId: p.planId, submission });
    action(c.database, 'savePlanSubmission', { planId: p.planId, submission }, 'Principe');
    action(c.database, 'confirmTrip', { id: first.tripId });
    action(c.database, 'confirmTrip', { id: first.tripId }, 'Principe');

    const blocked = action(c.database, 'deleteCurrentTrip', { kind: 'plan', id: p.planId });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /Confirmed trips cannot be deleted/);
    assert.equal(getState().plans.length, 1);
    assert.equal(getState().trips.length, 1);
  } finally {
    c.cleanup();
  }
});

