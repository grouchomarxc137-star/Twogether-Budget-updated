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


test('Extra spending stays capped and only explicit Pay back reduces €500 debt',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-repay-'));
  const db=openDatabase(join(dir,'test.sqlite'));configureStateStore(db.store);
  const run=(name,payload,actor='Principessa')=>db.db.transaction(()=>runAction(name,payload,actor))();
  const month=(m,extra=0,finalized=false,allowanceSpends=[])=>({
    month:m,incomes:[],finalized,allowanceSpends,expenses:[{name:'Extra',group:'extra',amount:250}],
    extraSpends:extra?[{source:'main',amount:extra}]:[],
  });
  try{
    assert.equal(run('saveFinanceMonth',{monthData:month('2026-10',500,true)}).ok,true);
    assert.equal(run('saveFinanceMonth',{monthData:month('2026-11')}).monthData.extraBudget,50);
    assert.equal(run('saveFinanceMonth',{monthData:month('2026-11',0,false,[{amount:51}])}).ok,false);
    assert.equal(run('saveFinanceMonth',{monthData:month('2026-11',0,false,[{id:'one',amount:40}])}).ok,true);
    assert.equal(getState().finances.Principessa.find(x=>x.month==='2026-11').allowanceSpends[0].amount,40);
    assert.equal(getState().financeProfiles.Principessa.receivables[0].repayments.length,0);
    const first=run('repayFinanceCarry',{month:'2026-11'});
    assert.equal(first.ok,true);assert.equal(first.paid,200);
    assert.equal(run('repayFinanceCarry',{month:'2026-11'}).ok,false);
    assert.equal(run('saveFinanceMonth',{monthData:month('2026-11',0,true,[{id:'one',amount:40}])}).ok,true);
    assert.equal(getState().financeProfiles.Principessa.receivables[0].repayments.length,1);
    assert.equal(run('saveFinanceMonth',{monthData:month('2026-12')}).monthData.extraBudget,50);
    assert.equal(run('repayFinanceCarry',{month:'2026-12'}).paid,200);
    assert.equal(run('saveFinanceMonth',{monthData:month('2026-12',0,true)}).ok,true);
    assert.equal(run('saveFinanceMonth',{monthData:month('2027-01')}).monthData.extraBudget,150);
    assert.equal(run('repayFinanceCarry',{month:'2027-01'}).paid,100);
    assert.equal(run('saveFinanceMonth',{monthData:month('2027-01',0,true)}).ok,true);
    assert.equal(run('saveFinanceMonth',{monthData:month('2027-02')}).monthData.extraBudget,250);
    const loan=getState().financeProfiles.Principessa.receivables[0];
    assert.equal(loan.repayments.reduce((sum,x)=>sum+Number(x.amount),0),500);
    assert.equal(loan.repayments.length,3);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('Principe Personal logs obey €30 minimum and repay button uses €70 maximum',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-repay-'));
  const db=openDatabase(join(dir,'test.sqlite'));configureStateStore(db.store);
  const run=(name,payload)=>db.db.transaction(()=>runAction(name,payload,'Principe'))();
  const month=(m,extra=0,finalized=false,allowanceSpends=[])=>({
    month:m,incomes:[],finalized,allowanceSpends,
    expenses:[{group:'variable',name:'Personal',amount:100},{id:'rent',group:'fixed',name:'Rent',amount:575}],
    extraSpends:extra?[{source:'main',amount:extra}]:[],
  });
  try{
    assert.equal(run('saveFinanceMonth',{monthData:month('2026-10',200,true)}).ok,true);
    const nov=run('saveFinanceMonth',{monthData:month('2026-11',50,false,[{amount:30}])});
    assert.equal(nov.monthData.expenses.find(x=>x.name==='Personal').amount,30);
    assert.equal(nov.monthData.expenses.find(x=>x.name==='Rent').amount,575);
    assert.equal(run('saveFinanceMonth',{monthData:month('2026-11',50,false,[{amount:31}])}).ok,false);
    assert.equal(run('repayFinanceCarry',{month:'2026-11'}).paid,70);
    assert.equal(run('saveFinanceMonth',{monthData:month('2026-11',50,true,[{amount:30}])}).ok,true);
    assert.equal(run('saveFinanceMonth',{monthData:month('2026-12')}).monthData.expenses[0].amount,30);
    assert.equal(run('repayFinanceCarry',{month:'2026-12'}).paid,70);
    assert.equal(run('saveFinanceMonth',{monthData:month('2026-12',0,true)}).ok,true);
    assert.equal(run('saveFinanceMonth',{monthData:month('2027-01')}).monthData.expenses[0].amount,30);
    assert.equal(run('repayFinanceCarry',{month:'2027-01'}).paid,70);
    assert.equal(run('saveFinanceMonth',{monthData:month('2027-01',0,true)}).ok,true);
    assert.equal(run('saveFinanceMonth',{monthData:month('2027-02')}).monthData.expenses[0].amount,60);
    assert.equal(run('repayFinanceCarry',{month:'2027-02'}).paid,40);
    assert.equal(run('saveFinanceMonth',{monthData:month('2027-02',0,true)}).ok,true);
    assert.equal(run('saveFinanceMonth',{monthData:month('2027-03')}).monthData.expenses[0].amount,100);
    const outstanding=getState().financeProfiles.Principe.receivables.reduce((sum,loan)=>sum+Number(loan.principal)-(loan.repayments||[]).reduce((n,p)=>n+Number(p.amount),0),0);
    assert.equal(outstanding,0);
    assert.equal(getState().financeProfiles.Principessa.receivables.length,0);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('confirming month never pays back automatically and locked months reject new repayments',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-repay-'));
  const db=openDatabase(join(dir,'test.sqlite'));configureStateStore(db.store);
  const run=(name,payload)=>db.db.transaction(()=>runAction(name,payload,'Principessa'))();
  const m=(month,extra=0,finalized=false)=>({month,finalized,expenses:[{group:'extra',name:'Extra',amount:250}],incomes:[],extraSpends:extra?[{source:'main',amount:extra}]:[]});
  try{
    assert.equal(run('saveFinanceMonth',{monthData:m('2026-10',500,true)}).ok,true);
    assert.equal(run('saveFinanceMonth',{monthData:m('2026-11',0,true)}).ok,true);
    assert.equal(getState().financeProfiles.Principessa.receivables[0].repayments.length,0);
    assert.equal(run('repayFinanceCarry',{month:'2026-11'}).ok,false);
    assert.equal(run('saveFinanceMonth',{monthData:m('2026-12',0,false)}).monthData.extraBudget,50);
    assert.equal(run('repayFinanceCarry',{month:'2026-12'}).paid,200);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('a legacy duplicate Extra charge is cleaned without changing legitimate expenses',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-repay-'));
  const db=openDatabase(join(dir,'test.sqlite'));configureStateStore(db.store);
  try{
    const result=db.db.transaction(()=>runAction('saveFinanceMonth',{monthData:{
      month:'2026-11',incomes:[],extraSpends:[],expenses:[
        {group:'extra',name:'Extra',amount:250},
        {group:'variable',name:'Extra',amount:250},
        {group:'variable',name:'Groceries',amount:85}
      ],allowanceSpends:[{id:'allowance-1',amount:25}]
    }},'Principessa'))();
    assert.equal(result.ok,true);
    const rec=getState().finances.Principessa[0];
    assert.equal(rec.expenses.filter(x=>x.name==='Extra').length,1);
    assert.equal(rec.expenses.find(x=>x.name==='Groceries').amount,85);
    assert.equal(rec.allowanceSpends[0].amount,25);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('older self-debt and repayments stay safe after enabling manual Pay back',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-repay-'));
  const db=openDatabase(join(dir,'test.sqlite'));configureStateStore(db.store);
  const run=(name,payload)=>db.db.transaction(()=>runAction(name,payload,'Principessa'))();
  const m=(month,extra=0)=>({month,incomes:[],expenses:[{group:'extra',name:'Extra',amount:250}],extraSpends:extra?[{source:'main',amount:extra}]:[]});
  try{
    assert.equal(run('saveFinanceMonth',{monthData:{...m('2026-10',500),finalized:true}}).ok,true);
    const profile=getState().financeProfiles.Principessa;
    profile.receivables[0].principal=300;
    profile.receivables[0].repayments=[{id:'old-payment',month:'2026-10',date:'2026-10-30',amount:20}];
    assert.equal(run('saveFinanceProfile',{profile}).ok,true);
    assert.equal(run('saveFinanceMonth',{monthData:m('2026-11')}).ok,true);
    assert.equal(run('repayFinanceCarry',{month:'2026-11'}).paid,200);
    const loan=getState().financeProfiles.Principessa.receivables[0];
    assert.equal(loan.principal,500);
    assert.equal(loan.repayments.find(p=>p.id==='old-payment').amount,20);
    assert.equal(loan.repayments.find(p=>p.month==='2026-11').amount,200);
    assert.equal(loan.repayments.length,2);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('Pay back creates exactly one ordinary outflow record, and later saves preserve it',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-ledger-'));
  const database=openDatabase(join(dir,'test.sqlite'));
  configureStateStore(database.store);
  const action=(name,payload)=>database.db.transaction(()=>runAction(name,payload,'Principessa'))();
  const month=(name,extra=0,finalized=false)=>({month:name,finalized,incomes:[{name:'Salary',amount:1000}],
    expenses:[{group:'extra',name:'Extra',amount:250}],
    extraSpends:extra?[{source:'main',amount:extra}]:[]});
  try{
    assert.equal(action('saveFinanceMonth',{monthData:month('2026-10',500,true)}).ok,true);
    assert.equal(action('saveFinanceMonth',{monthData:month('2026-11')}).ok,true);
    const first=action('repayFinanceCarry',{month:'2026-11'});
    assert.equal(first.paid,200);
    assert.equal(first.monthData.expenses.find(x=>x.id==='allowance-payback:2026-11').amount,200);
    assert.equal(first.monthData.expenses.reduce((total,x)=>total+Number(x.amount),0),250);
    assert.equal(action('repayFinanceCarry',{month:'2026-11'}).ok,false);
    const stale=action('saveFinanceMonth',{monthData:month('2026-11')});
    assert.equal(stale.ok,true);
    assert.equal(stale.monthData.expenses.filter(x=>x.id==='allowance-payback:2026-11').length,1);
    assert.equal(stale.monthData.expenses.reduce((total,x)=>total+Number(x.amount),0),250);
    const confirmed=action('saveFinanceMonth',{monthData:month('2026-11',0,true)});
    assert.equal(confirmed.twosDelta,750);
    assert.equal(getState().financeProfiles.Principessa.receivables[0].repayments.length,1);
  }finally{database.close();rmSync(dir,{recursive:true,force:true});}
});

test('Principe Pay back is a Personal monthly outflow, not a second Personal allocation',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-ledger-'));
  const database=openDatabase(join(dir,'test.sqlite'));
  configureStateStore(database.store);
  const action=(name,payload)=>database.db.transaction(()=>runAction(name,payload,'Principe'))();
  const month=(name,extra=0,finalized=false)=>({month:name,finalized,incomes:[],
    expenses:[{group:'variable',name:'Personal',amount:100}],
    extraSpends:extra?[{source:'main',amount:extra}]:[]});
  try{
    assert.equal(action('saveFinanceMonth',{monthData:month('2026-10',120,true)}).ok,true);
    assert.equal(action('saveFinanceMonth',{monthData:month('2026-11')}).ok,true);
    const repaid=action('repayFinanceCarry',{month:'2026-11'});
    assert.equal(repaid.paid,70);
    assert.equal(repaid.monthData.expenses.find(x=>x.id==='allowance-payback:2026-11').amount,70);
    assert.equal(repaid.monthData.expenses.reduce((total,x)=>total+Number(x.amount),0),100);
    assert.equal(repaid.monthData.expenses.filter(x=>x.name==='Personal').length,1);
  }finally{database.close();rmSync(dir,{recursive:true,force:true});}
});

test('delete confirmed finance month removes its debt and derived payback in later drafts',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-delete-finance-'));
  const database=openDatabase(join(dir,'test.sqlite'));configureStateStore(database.store);
  const action=(type,data,owner='Principessa')=>database.db.transaction(()=>runAction(type,data,owner))();
  const month=(month,spent=0,finalized=false)=>({month,finalized,incomes:[{name:'Income',amount:1000}],
    expenses:[{group:'extra',name:'Extra',amount:250}],
    extraSpends:spent?[{source:'main',amount:spent}]:[]});
  try{
    assert.equal(action('saveFinanceMonth',{monthData:month('2026-10',500,true)}).ok,true);
    assert.equal(action('saveFinanceMonth',{monthData:month('2026-11')}).ok,true);
    assert.equal(action('repayFinanceCarry',{month:'2026-11'}).paid,200);
    assert.equal(action('deleteFinanceMonth',{month:'2026-10'}).ok,true);
    const state=getState(),nov=state.finances.Principessa[0];
    assert.equal(state.finances.Principessa.length,1);
    assert.equal(nov.month,'2026-11');
    assert.equal(nov.extraBudget,250);
    assert.equal(nov.expenses.some(x=>String(x.id).startsWith('allowance-payback:')),false);
    assert.equal(state.financeProfiles.Principessa.receivables.length,0);
    assert.equal(state.game.Principessa.awards.financeSettlements.length,0);
    assert.equal(state.game.Principessa.twos,0);
    assert.equal(action('deleteFinanceMonth',{month:'2026-11'}).ok,false);
  }finally{database.close();rmSync(dir,{recursive:true,force:true});}
});

test('delete confirmed months newest first to preserve later locked history',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-delete-finance-'));
  const database=openDatabase(join(dir,'test.sqlite'));configureStateStore(database.store);
  const action=(type,data)=>database.db.transaction(()=>runAction(type,data,'Principessa'))();
  const month=(month,spent=0,finalized=false)=>({month,finalized,incomes:[],
    expenses:[{group:'extra',name:'Extra',amount:250}],
    extraSpends:spent?[{source:'main',amount:spent}]:[]});
  try{
    assert.equal(action('saveFinanceMonth',{monthData:month('2026-10',500,true)}).ok,true);
    assert.equal(action('saveFinanceMonth',{monthData:month('2026-11')}).ok,true);
    assert.equal(action('repayFinanceCarry',{month:'2026-11'}).paid,200);
    assert.equal(action('saveFinanceMonth',{monthData:month('2026-11',0,true)}).ok,true);
    const blocked=action('deleteFinanceMonth',{month:'2026-10'});
    assert.equal(blocked.ok,false);
    assert.match(blocked.error,/newer confirmed/i);
    assert.equal(action('deleteFinanceMonth',{month:'2026-11'}).ok,true);
    assert.equal(getState().financeProfiles.Principessa.receivables[0].repayments.length,0);
    assert.equal(action('deleteFinanceMonth',{month:'2026-10'}).ok,true);
    assert.deepEqual(getState().finances.Principessa,[]);
  }finally{database.close();rmSync(dir,{recursive:true,force:true});}
});

test('deleting one person finance month restores Saved up and Shared Jar without touching partner',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-delete-finance-'));
  const database=openDatabase(join(dir,'test.sqlite'));configureStateStore(database.store);
  const action=(type,data,owner='Principessa')=>database.db.transaction(()=>runAction(type,data,owner))();
  try{
    assert.equal(action('saveFinanceProfile',{profile:{savingsTotal:100,receivables:[
      {id:'family-loan',person:'Family',reason:'Unrelated',principal:75}
    ]}}).ok,true);
    assert.equal(action('saveFinanceMonth',{monthData:{month:'2026-10',finalized:true,
      incomes:[],expenses:[
        {group:'extra',name:'Extra',amount:250},
        {id:'jar-1',group:'other',name:'Household',amount:25,paidFrom:'sharedJar'}
      ],extraSpends:[{source:'savings',amount:40}]
    }}).ok,true);
    assert.equal(action('saveFinanceMonth',{monthData:{month:'2026-10',finalized:true,incomes:[],
      expenses:[{group:'variable',name:'Personal',amount:100}],extraSpends:[]}},'Principe').ok,true);
    assert.equal(getState().financeProfiles.Principessa.savingsTotal,60);
    assert.equal(getState().sharedJar.balance,845);
    assert.equal(action('deleteFinanceMonth',{month:'2026-10'}).ok,true);
    const state=getState();
    assert.equal(state.financeProfiles.Principessa.savingsTotal,100);
    assert.equal(state.sharedJar.balance,870);
    assert.equal(state.financeProfiles.Principessa.receivables.some(x=>x.id==='family-loan'),true);
    assert.equal(state.finances.Principe.length,1);
    assert.equal(state.game.Principe.awards.financeSettlements.length,1);
    assert.equal(state.finances.Principessa.length,0);
  }finally{database.close();rmSync(dir,{recursive:true,force:true});}
});

test('manual repayments from an older finance loan prevent destructive month deletion',()=>{
  const dir=mkdtempSync(join(tmpdir(),'twogether-delete-finance-'));
  const database=openDatabase(join(dir,'test.sqlite'));configureStateStore(database.store);
  const action=(type,data)=>database.db.transaction(()=>runAction(type,data,'Principessa'))();
  try{
    assert.equal(action('saveFinanceMonth',{monthData:{month:'2026-10',finalized:true,
      incomes:[],expenses:[{group:'extra',name:'Extra',amount:250}],
      extraSpends:[{source:'main',amount:500}]}}).ok,true);
    const profile=getState().financeProfiles.Principessa;
    profile.receivables[0].repayments=[{id:'manual-repay',month:'2026-11',date:'2026-11-10',amount:15}];
    assert.equal(action('saveFinanceProfile',{profile}).ok,true);
    const blocked=action('deleteFinanceMonth',{month:'2026-10'});
    assert.equal(blocked.ok,false);
    assert.match(blocked.error,/manually recorded/i);
    assert.equal(getState().finances.Principessa[0].finalized,true);
    assert.equal(getState().financeProfiles.Principessa.receivables[0].repayments[0].amount,15);
  }finally{database.close();rmSync(dir,{recursive:true,force:true});}
});
