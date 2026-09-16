import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { SUPPORTED_ACTIONS } from '../server/src/core.js';
import {
  applyActionToState,
  normalizeStateDocument,
  runStateTransaction,
} from '../src/lib/state-document.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : (path.endsWith('.js') ? [path] : []);
  });
}

function createOptimisticDocument(initialState) {
  let state = clone(initialState);
  let revision = 0;
  return {
    async transaction(update) {
      for (;;) {
        const seenRevision = revision;
        const snapshot = clone(state);
        const next = update(snapshot);
        await new Promise((resolvePromise) => setImmediate(resolvePromise));
        if (seenRevision !== revision) continue;
        state = clone(next);
        revision += 1;
        return;
      }
    },
    read: () => clone(state),
  };
}

test('creates and reloads a complete empty Firestore state document', () => {
  const initial = normalizeStateDocument({});
  const reloaded = normalizeStateDocument(clone(initial));
  assert.equal(reloaded.version, 18);
  assert.deepEqual(reloaded.trips, []);
  assert.deepEqual(reloaded.plans, []);
  assert.deepEqual(reloaded.finances, { Principessa: [], Principe: [] });
  assert.equal(reloaded.sharedJar.balance, 870);
  assert.equal(reloaded.game.Principessa.twos, 0);
  assert.equal(reloaded.game.Principe.twos, 0);
});

test('preserves trip, shared jar, game, finance, and wishlist behavior', () => {
  let state = normalizeStateDocument({});
  const act = (action, payload, actor = 'Principessa') => {
    const applied = applyActionToState(state, action, payload, actor);
    state = applied.state;
    return applied.result;
  };

  const meta = { location: 'Italy', city: 'Verona', start: '2026-10-01', end: '2026-10-03' };
  const created = act('savePlan', { meta, budget: 500 });
  act('savePlan', { id: created.planId, budget: 500 }, 'Principe');
  const accommodation = act('saveAccommodationExpense', {
    planId: created.planId, total: 500, useJar: true, paymentType: 'shared', paidUpfront: true,
  });
  assert.equal(accommodation.sharedJar.balance, 770);
  assert.equal(accommodation.sharedExpense.accommodation.repayment.amount, 200);
  act('confirmAccommodationRepayment', { planId: created.planId, paidBack: true }, 'Principe');

  const submission = {
    ...meta, accom: 500, travel: 0, groceries: 0, eat: 0, fuel: 0,
    tolls: 0, other: 0, otherNote: '', paid: 200, uncertain: {},
  };
  const first = act('savePlanSubmission', { planId: created.planId, submission });
  act('savePlanSubmission', { planId: created.planId, submission }, 'Principe');
  act('confirmTrip', { id: first.tripId });
  act('confirmTrip', { id: first.tripId }, 'Principe');

  const month = act('saveFinanceMonth', {
    monthData: {
      month: '2026-09', incomes: [{ name: 'Income', amount: 1000 }],
      expenses: [{ group: 'rent', name: 'Rent', amount: 100 }],
      extraBudget: 250, extraSpends: [], finalized: true,
    },
  });
  assert.equal(month.twosDelta, 650);
  act('saveFinanceProfile', {
    profile: {
      bankAccounts: [], savingsTotal: '', savingsReserved: [], receivables: [], scenarios: [], compareLab: {},
      wishlist: [{ id: 'wish-1', name: 'Weekend bag', price: 40, priority: 2, createdAt: '2026-09-01T00:00:00Z' }],
    },
  });
  act('wishlistCheckout', { ids: ['wish-1'] });

  const reloaded = normalizeStateDocument(clone(state));
  assert.equal(reloaded.trips[0].confirmed.Principessa, true);
  assert.equal(reloaded.trips[0].confirmed.Principe, true);
  assert.equal(reloaded.finances.Principessa.length, 1);
  assert.equal(reloaded.financeProfiles.Principessa.wishlist[0].unlockedBy, 'Principessa');
  assert.equal(reloaded.game.Principessa.twos, 910);
  assert.equal(reloaded.game.Principessa.lovis, 8);
});

test('transaction retries preserve simultaneous Principessa and Principe writes', async () => {
  const initial = normalizeStateDocument({});
  const created = applyActionToState(initial, 'savePlan', {
    meta: { location: 'Italy', city: 'Rome', start: '2026-11-01', end: '2026-11-02' },
    budget: 300,
  }, 'Principessa');
  const document = createOptimisticDocument(created.state);

  await Promise.all([
    runStateTransaction(document.transaction, 'savePlan', { id: created.result.planId, budget: 350 }, 'Principessa'),
    runStateTransaction(document.transaction, 'savePlan', { id: created.result.planId, budget: 425 }, 'Principe'),
  ]);

  const plan = document.read().plans[0];
  assert.equal(plan.budgets.Principessa, 350);
  assert.equal(plan.budgets.Principe, 425);
});

test('every literal frontend action is handled by the centralized engine', () => {
  const actions = new Set();
  for (const file of sourceFiles(resolve('src'))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:TwogetherAPI\.)?post(?:Action)?\(\s*['"]([^'"]+)['"]/g)) actions.add(match[1]);
  }
  assert.deepEqual([...actions].filter((action) => !SUPPORTED_ACTIONS.has(action)), []);
  assert.deepEqual([...SUPPORTED_ACTIONS].filter((action) => !actions.has(action)), []);
});

test('production frontend has no localhost backend dependency', () => {
  const files = ['api.js', 'config.js', 'index.html', ...sourceFiles(resolve('src'))];
  for (const file of files) assert.equal(readFileSync(file, 'utf8').includes('localhost:4310'), false, file);
});
