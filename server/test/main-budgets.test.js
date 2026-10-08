import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';
import { openDatabase } from '../src/db/index.js';
import { budgetItemsForMonth, budgetSnapshotForMonth, budgetProgressForMonth } from '../../src/finances/main-budgets.js';

function setup(){
  const directory=mkdtempSync(join(tmpdir(),'twogether-main-budgets-'));
  const database=openDatabase(join(directory,'test.sqlite'));
  configureStateStore(database.store);
  return {database,cleanup(){database.close();rmSync(directory,{recursive:true,force:true});}};
}
function action(db,name,payload,actor='Principe'){
  return db.db.transaction(()=>runAction(name,payload,actor))();
}
const fuel={id:'fuel-category',name:'Fuel',amount:350};
const groceries={id:'groceries-category',name:'Groceries',amount:200};

test('Main Account budgets carry forward while preserving earlier monthly limits',()=>{
  const ctx=setup();
  try{
    const initial=budgetSnapshotForMonth([],'2026-10',[fuel,groceries]);
    assert.equal(action(ctx.database,'saveFinanceProfile',{profile:{mainBudgets:initial}}).ok,true);
    let state=getState();
    assert.deepEqual(budgetItemsForMonth(state.financeProfiles.Principe.mainBudgets,'2026-09'),[]);
    assert.equal(budgetItemsForMonth(state.financeProfiles.Principe.mainBudgets,'2026-10')[0].amount,350);
    assert.equal(budgetItemsForMonth(state.financeProfiles.Principe.mainBudgets,'2026-11')[0].amount,350);
    const changed=budgetSnapshotForMonth(state.financeProfiles.Principe.mainBudgets,'2026-11',[{...fuel,amount:400},groceries]);
    assert.equal(action(ctx.database,'saveFinanceProfile',{profile:{...state.financeProfiles.Principe,mainBudgets:changed}}).ok,true);
    state=getState();
    assert.equal(budgetItemsForMonth(state.financeProfiles.Principe.mainBudgets,'2026-10')[0].amount,350);
    assert.equal(budgetItemsForMonth(state.financeProfiles.Principe.mainBudgets,'2026-11')[0].amount,400);
    assert.equal(budgetItemsForMonth(state.financeProfiles.Principe.mainBudgets,'2026-12')[0].amount,400);
    assert.deepEqual(state.financeProfiles.Principessa.mainBudgets,[]);
    const invalid=action(ctx.database,'saveFinanceProfile',{profile:{mainBudgets:changed}},'Principessa');
    assert.equal(invalid.ok,true);
    assert.deepEqual(getState().financeProfiles.Principessa.mainBudgets,[]);
  }finally{ctx.cleanup();}
});

test('fuel and groceries track actual personal monthly expense rows and edit safely',()=>{
  const ctx=setup();
  try{
    assert.equal(action(ctx.database,'saveFinanceProfile',{profile:{mainBudgets:budgetSnapshotForMonth([],'2026-10',[fuel,groceries])}}).ok,true);
    const saved=action(ctx.database,'saveFinanceMonth',{monthData:{
      month:'2026-10',partialOnly:true,incomes:[],expenses:[
        {id:'fuel-1',group:'variable',name:'Fuel',amount:100,date:'2026-10-10',paidFrom:'personal'},
        {id:'fuel-2',group:'variable',name:'Shell Station',amount:30,date:'2026-10-11',paidFrom:'personal',budgetCategoryId:fuel.id},
        {id:'food-1',group:'variable',name:'Groceries',amount:50,date:'2026-10-12',paidFrom:'personal'},
        {id:'shared-1',group:'variable',name:'Fuel',amount:20,date:'2026-10-13',paidFrom:'sharedJar'},
      ],extraSpends:[]
    }});
    assert.equal(saved.ok,true);
    const record=getState().finances.Principe[0];
    const current=budgetItemsForMonth(getState().financeProfiles.Principe.mainBudgets,'2026-10');
    const result=budgetProgressForMonth(current,record);
    assert.equal(result[0].spent,130);
    assert.equal(result[0].remaining,220);
    assert.equal(result[1].spent,50);
    assert.equal(result[1].remaining,150);
    assert.equal(record.expenses.find(x=>x.id==='fuel-2').budgetCategoryId,fuel.id);
    const edited=action(ctx.database,'saveFinanceMonth',{monthData:{
      ...record,expenses:record.expenses.map(x=>x.id==='fuel-1'?{...x,amount:250}:x)
    }});
    assert.equal(edited.ok,true);
    const refreshed=budgetProgressForMonth(current,getState().finances.Principe[0]);
    assert.equal(refreshed[0].remaining,70);
    assert.equal(refreshed[1].remaining,150);
  }finally{ctx.cleanup();}
});

test('overspending shows negative remaining and monthly spending restarts',()=>{
  const rows=budgetProgressForMonth([fuel,groceries],{month:'2026-10',expenses:[
    {name:'Fuel',amount:400,paidFrom:'personal'},
    {name:'Groceries',amount:20,budgetCategoryId:'none',paidFrom:'personal'}
  ]});
  assert.equal(rows[0].spent,400);
  assert.equal(rows[0].remaining,-50);
  assert.equal(rows[0].over,true);
  assert.equal(rows[0].percentage,100);
  assert.equal(rows[1].spent,0);
  assert.equal(budgetProgressForMonth([fuel],{month:'2026-11',expenses:[]})[0].remaining,350);
});

test('legacy records and malformed budget rows do not break the finance profile',()=>{
  const ctx=setup();
  try{
    assert.equal(action(ctx.database,'saveFinanceProfile',{profile:{mainBudgets:[
      {month:'2026-10',items:[fuel,{id:'broken',name:'',amount:300},{id:'fuel-category',name:'duplicate',amount:20}]},
      {month:'not-a-month',items:[groceries]}
    ]}}).ok,true);
    const history=getState().financeProfiles.Principe.mainBudgets;
    assert.equal(history.length,1);
    assert.equal(history[0].items.length,1);
    assert.equal(history[0].items[0].name,'Fuel');
  }finally{ctx.cleanup();}
});
