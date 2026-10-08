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
    })), [{ id: 'extra-overspend:2026-10', person: 'Myself', principal: 240.25 }]);
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
      [{ id: 'personal-overspend:2026-10', person: 'Myself', principal: 80 }]
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
    assert.equal(getState().financeProfiles.Principe.receivables[0].principal, 70.01);
    assert.equal(save('2027-02', []).monthData.expenses[0].amount, 30);
    assert.equal(save('2027-03', [{ source: 'savings', amount: 4.5 }]).ok, false);
    assert.equal(save('2027-03', [{ source: 'main', amount: 4.5 }]).ok, true);
    assert.equal(save('2027-04', []).monthData.expenses[0].amount, 30);
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
    assert.equal(getState().financeProfiles.Principe.receivables[0].principal,120);
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Extra overspending is paid over future confirmed months without losing the minimum',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-ongoing-'));
  const database=openDatabase(join(dir,'test.sqlite'));
  configureStateStore(database.store);
  const save=(month,over=0,finalized=false)=>database.db.transaction(()=>runAction('saveFinanceMonth',{
    monthData:{month,finalized,incomes:[],extraSpends:over?[{source:'main',amount:over}]:[],
      expenses:[{group:'extra',name:'Extra',amount:250}]}
  },'Principessa'))();
  try{
    assert.equal(save('2026-10',500,true).ok,true);
    assert.equal(getState().financeProfiles.Principessa.receivables[0].principal,500);
    assert.equal(save('2026-11',0,true).monthData.extraBudget,50);
    assert.equal(save('2026-12',0,true).monthData.extraBudget,50);
    assert.equal(save('2027-01',0,true).monthData.extraBudget,150);
    assert.equal(save('2027-02').monthData.extraBudget,250);
    const loan=getState().financeProfiles.Principessa.receivables[0];
    assert.equal(loan.repayments.reduce((sum,p)=>sum+Number(p.amount),0),500);
    assert.equal(loan.repayments.length,3);
  }finally{database.close();rmSync(dir,{recursive:true,force:true});}
});

test('Principe overspending is combined with existing debt and repaid progressively',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-ongoing-'));
  const database=openDatabase(join(dir,'test.sqlite'));
  configureStateStore(database.store);
  const save=(month,over=0,finalized=false)=>database.db.transaction(()=>runAction('saveFinanceMonth',{
    monthData:{month,finalized,incomes:[],extraSpends:over?[{source:'main',amount:over}]:[],
      expenses:[{group:'variable',name:'Personal',amount:100}]}
  },'Principe'))();
  try{
    assert.equal(save('2026-10',200,true).ok,true);
    assert.equal(save('2026-11',50,true).monthData.expenses[0].amount,30);
    assert.equal(save('2026-12',0,true).monthData.expenses[0].amount,30);
    assert.equal(save('2027-01',0,true).monthData.expenses[0].amount,30);
    assert.equal(save('2027-02',0,true).monthData.expenses[0].amount,60);
    assert.equal(save('2027-03').monthData.expenses[0].amount,100);
    const loans=getState().financeProfiles.Principe.receivables;
    assert.equal(loans.reduce((total,x)=>total+Number(x.principal)-x.repayments.reduce((s,r)=>s+Number(r.amount),0),0),0);
  }finally{database.close();rmSync(dir,{recursive:true,force:true});}
});

test('drafts do not repay debt, and confirmed installments are not duplicated',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-ongoing-'));
  const database=openDatabase(join(dir,'test.sqlite'));
  configureStateStore(database.store);
  const save=(month,over=0,finalized=false)=>database.db.transaction(()=>runAction('saveFinanceMonth',{
    monthData:{month,finalized,incomes:[],extraSpends:over?[{source:'main',amount:over}]:[],
      expenses:[{group:'extra',name:'Extra',amount:250}]}
  },'Principessa'))();
  try{
    assert.equal(save('2026-10',500,true).ok,true);
    assert.equal(save('2026-11').monthData.extraBudget,50);
    assert.equal(save('2026-12').monthData.extraBudget,50);
    assert.equal(getState().financeProfiles.Principessa.receivables[0].repayments.length,0);
    assert.equal(save('2026-11',0,true).ok,true);
    assert.equal(getState().finances.Principessa.find(x=>x.month==='2026-12').extraBudget,50);
    assert.equal(getState().financeProfiles.Principessa.receivables[0].repayments.length,1);
    assert.equal(save('2026-12',0,true).ok,true);
    assert.equal(getState().financeProfiles.Principessa.receivables[0].repayments.length,2);
  }finally{database.close();rmSync(dir,{recursive:true,force:true});}
});

test('previous automatic self-loan values retain existing manual payments',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-ongoing-'));
  const database=openDatabase(join(dir,'test.sqlite'));
  configureStateStore(database.store);
  const save=(month,over=0,finalized=false)=>database.db.transaction(()=>runAction('saveFinanceMonth',{
    monthData:{month,finalized,incomes:[],extraSpends:over?[{source:'main',amount:over}]:[],
      expenses:[{group:'extra',name:'Extra',amount:250}]}
  },'Principessa'))();
  try{
    assert.equal(save('2026-10',500,true).ok,true);
    const profile=getState().financeProfiles.Principessa;
    profile.receivables[0].principal=300;
    profile.receivables[0].repayments=[{id:'manual',month:'2026-10',date:'2026-10-30',amount:20}];
    assert.equal(database.db.transaction(()=>runAction('saveFinanceProfile',{profile},'Principessa'))().ok,true);
    assert.equal(save('2026-11',0,true).ok,true);
    const loan=getState().financeProfiles.Principessa.receivables[0];
    assert.equal(loan.principal,500);
    assert.equal(loan.repayments.find(x=>x.id==='manual').amount,20);
    assert.equal(loan.repayments.find(x=>x.month==='2026-11').amount,200);
  }finally{database.close();rmSync(dir,{recursive:true,force:true});}
});
