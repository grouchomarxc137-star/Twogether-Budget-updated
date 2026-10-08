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

test('Principe personal overspending reduces next month to at least 30 and creates a self debt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twogether-personal-'));
  const database = openDatabase(join(dir, 'test.sqlite'));
  configureStateStore(database.store);
  const save = (month, spends = [], finalized = false) =>
    database.db.transaction(() => runAction('saveFinanceMonth', {
      monthData: { month, incomes: [], extraSpends: spends, finalized,
        expenses: [{ group: 'variable', name: 'Personal', amount: 100 },
          { id: 'rent-row', group: 'fixed', name: 'Rent', amount: 575 }]
      }
    }, 'Principe'))();
  try {
    assert.equal(save('2026-10', [{ source: 'main', amount: 20 }]).ok, true);
    assert.equal(save('2026-11').monthData.expenses.find(x => x.name === 'Personal').amount, 80);
    assert.equal(getState().financeProfiles.Principe.receivables.length, 0);
    assert.equal(save('2026-10', [{ source: 'main', amount: 80 }], true).ok, true);
    const state = getState();
    const november = state.finances.Principe.find(x => x.month === '2026-11');
    assert.equal(november.expenses.find(x => x.name === 'Personal').amount, 30);
    assert.equal(november.expenses.find(x => x.name === 'Rent').amount, 575);
    assert.deepEqual(state.financeProfiles.Principe.receivables.map(x =>
      ({ id: x.id, person: x.person, principal: x.principal })),
      [{ id: 'personal-overspend:2026-10', person: 'Myself', principal: 10 }]
    );
    assert.equal(save('2026-11', [], true).ok, true);
    assert.equal(getState().finances.Principe.find(x => x.month === '2026-11').expenses.find(x => x.name === 'Personal').amount, 30);
    assert.equal(getState().financeProfiles.Principe.receivables.length, 1);
    assert.equal(getState().financeProfiles.Principessa.receivables.length, 0);
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Principe personal overspending respects cents, month boundaries, and draft vs final debts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twogether-personal-'));
  const database = openDatabase(join(dir, 'test.sqlite'));
  configureStateStore(database.store);
  const save = (month, extraSpends, finalized = false, expenses) =>
    database.db.transaction(() => runAction('saveFinanceMonth', {
      monthData: { month, incomes: [], extraSpends, finalized,
        expenses: expenses ?? [{ group: 'variable', name: 'Personal', amount: 100 }],
      }
    }, 'Principe'))();
  try {
    assert.equal(save('2026-12', [{ source: 'main', amount: 70.01 }]).ok, true);
    assert.equal(save('2027-01', []).monthData.expenses[0].amount, 30);
    assert.equal(getState().financeProfiles.Principe.receivables.length, 0);
    assert.equal(save('2026-12', [{ source: 'main', amount: 70.01 }], true).ok, true);
    assert.equal(getState().financeProfiles.Principe.receivables[0].principal, 0.01);
    assert.equal(save('2027-02', []).monthData.expenses[0].amount, 100);
    assert.equal(save('2027-03', [{ source: 'savings', amount: 4.5 }]).ok, false);
    assert.equal(save('2027-03', [{ source: 'main', amount: 4.5 }]).ok, true);
    assert.equal(save('2027-04', []).monthData.expenses[0].amount, 95.5);
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Principe partial-only months do not gain an unrequested Personal expense', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twogether-personal-'));
  const database = openDatabase(join(dir, 'test.sqlite'));
  configureStateStore(database.store);
  const save = data => database.db.transaction(() => runAction('saveFinanceMonth', { monthData: data }, 'Principe'))();
  try {
    assert.equal(save({month:'2026-10',extraSpends:[{source:'main',amount:120}],expenses:[],partialOnly:true}).ok,true);
    const november=save({month:'2026-11',extraSpends:[],expenses:[],partialOnly:true});
    assert.equal(november.ok,true);
    assert.deepEqual(november.monthData.expenses,[]);
    assert.equal(save({month:'2026-10',extraSpends:[{source:'main',amount:120}],expenses:[],partialOnly:true,finalized:true}).ok,true);
    assert.equal(getState().financeProfiles.Principe.receivables[0].principal,50);
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
