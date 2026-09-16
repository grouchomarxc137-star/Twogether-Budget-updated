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
