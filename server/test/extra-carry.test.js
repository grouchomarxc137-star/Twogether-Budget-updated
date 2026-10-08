import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';
import { openDatabase } from '../src/db/index.js';

test('Extra overspending keeps 50 next month and records only excess as self debt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twogether-extra-'));
  const database = openDatabase(join(dir, 'test.sqlite'));
  configureStateStore(database.store);
  const action = monthData => database.db.transaction(() => runAction('saveFinanceMonth', { monthData }, 'Principessa'))();
  const record = (month, extraSpends = [], finalized = false) => ({
    month, incomes: [], expenses: [{ group: 'extra', name: 'Extra', amount: 250 }],
    extraBudget: 250, extraSpends, finalized,
  });
  try {
    assert.equal(action(record('2026-10', [{ source: 'main', amount: 75 }])).ok, true);
    assert.equal(action(record('2026-11')).monthData.extraBudget, 175);
    assert.equal(getState().financeProfiles.Principessa.receivables.length, 0);
    assert.equal(action(record('2026-10', [{ source: 'main', amount: 240.25 }], true)).ok, true);
    const state = getState();
    const november = state.finances.Principessa.find(x => x.month === '2026-11');
    assert.equal(november.extraBudget, 50);
    assert.equal(november.expenses.find(x => x.group === 'extra').amount, 50);
    assert.deepEqual(state.financeProfiles.Principessa.receivables.map(x => ({
      id: x.id, person: x.person, principal: x.principal,
    })), [{ id: 'extra-overspend:2026-10', person: 'Myself', principal: 40.25 }]);
    assert.equal(action(record('2026-11', [], true)).ok, true);
    assert.equal(getState().financeProfiles.Principessa.receivables.length, 1);
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pending credit card charges do not reduce next month Extra', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twogether-extra-'));
  const database = openDatabase(join(dir, 'test.sqlite'));
  configureStateStore(database.store);
  const action = monthData => database.db.transaction(() => runAction('saveFinanceMonth', { monthData }, 'Principessa'))();
  try {
    assert.equal(action({ month: '2026-10', extraSpends: [{ source: 'creditcard', amount: 500, status: 'pending', pendingCounts: false }], finalized: true }).ok, true);
    const next = action({ month: '2026-11', extraSpends: [], finalized: false });
    assert.equal(next.monthData.extraBudget, 250);
    assert.equal(getState().financeProfiles.Principessa.receivables.length, 0);
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
