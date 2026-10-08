import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';
import { openDatabase } from '../src/db/index.js';
import { recurringBudgetItems, budgetProgressForMonth } from '../../src/finances/main-budgets.js';

function setup(){
  const directory=mkdtempSync(join(tmpdir(),'twogether-recurring-budgets-'));
  const database=openDatabase(join(directory,'test.sqlite'));
  configureStateStore(database.store);
  return {database,cleanup(){database.close();rmSync(directory,{recursive:true,force:true});}};
}
function action(db,name,payload,actor='Principe'){
  return db.db.transaction(()=>runAction(name,payload,actor))();
}
const fuel={id:'fuel-budget',group:'variable',name:'Fuel',amount:350,day:'',isBudget:true};
const groceries={id:'groceries-budget',group:'variable',name:'Groceries',amount:200,day:'',isBudget:true};

test('recurring Fuel remains a monthly limit, not a new logged expense',()=>{
  const ctx=setup();
  try{
    assert.equal(action(ctx.database,'saveFinanceProfile',{profile:{recurring:{custom:true,incomes:[],expenses:[fuel,groceries]}}}).ok,true);
    const state=getState();
    assert.equal(state.financeProfiles.Principe.recurring.expenses[0].isBudget,true);
    assert.deepEqual(state.finances.Principe,[]);
    assert.equal(recurringBudgetItems(state.financeProfiles.Principe.recurring).length,2);
    assert.equal(recurringBudgetItems(state.financeProfiles.Principessa.recurring).length,0);
    assert.equal(budgetProgressForMonth(recurringBudgetItems(state.financeProfiles.Principe.recurring),null,[],'2026-10')[0].remaining,350);
  }finally{ctx.cleanup();}
});

test('Main Account purchases reduce separate recurring Fuel and Groceries allowances',()=>{
  const ctx=setup();
  try{
    assert.equal(action(ctx.database,'saveFinanceProfile',{profile:{recurring:{custom:true,expenses:[fuel,groceries]}}}).ok,true);
    const saved=action(ctx.database,'saveFinanceMonth',{monthData:{month:'2026-10',partialOnly:true,incomes:[],expenses:[
      {id:'finance-fuel',name:'Fuel',group:'variable',amount:100,date:'2026-10-03',paidFrom:'personal'},
      {id:'finance-shell',name:'Shell',group:'variable',amount:20,date:'2026-10-04',paidFrom:'personal',budgetCategoryId:'fuel-budget'},
      {id:'finance-food',name:'Groceries',group:'groceries',amount:30,date:'2026-10-05',paidFrom:'personal'},
      {id:'shared-jar',name:'Fuel',group:'variable',amount:50,date:'2026-10-06',paidFrom:'sharedJar'}
    ],extraSpends:[]}});
    assert.equal(saved.ok,true);
    const state=getState();
    const items=recurringBudgetItems(state.financeProfiles.Principe.recurring);
    const progress=budgetProgressForMonth(items,state.finances.Principe[0],[],'2026-10');
    assert.equal(progress[0].spent,120);
    assert.equal(progress[0].remaining,230);
    assert.equal(progress[1].remaining,170);
    assert.equal(state.finances.Principe[0].expenses.find(x=>x.id==='finance-shell').budgetCategoryId,'fuel-budget');
    assert.equal(budgetProgressForMonth(items,null,[],'2026-11')[0].remaining,350);
    const edited=action(ctx.database,'saveFinanceMonth',{monthData:{...state.finances.Principe[0],expenses:state.finances.Principe[0].expenses.map(x=>x.id==='finance-fuel'?{...x,amount:200}:x)}});
    assert.equal(edited.ok,true);
    assert.equal(budgetProgressForMonth(items,getState().finances.Principe[0],[],'2026-10')[0].remaining,130);
  }finally{ctx.cleanup();}
});

test('trip Fuel paid by Principe or both is included once and the same entry in Finances is deduplicated',()=>{
  const item=recurringBudgetItems({expenses:[fuel]});
  const record={month:'2026-10',expenses:[{id:'duplicate',name:'Fuel',amount:100,date:'2026-10-03',paidFrom:'personal'}]};
  const plans=[{id:'trip-1',expenseEntries:[
    {id:'duplicate-trip',category:'transport',transportType:'fuel',amount:100,date:'2026-10-03',paidBy:'Principe'},
    {id:'split-fuel',category:'transport',transportType:'fuel',amount:40,date:'2026-10-08',paidBy:'both'},
    {id:'hers',category:'transport',transportType:'fuel',amount:60,date:'2026-10-09',paidBy:'Principessa'},
    {id:'later',category:'transport',transportType:'fuel',amount:90,date:'2026-11-01',paidBy:'Principe'}
  ]}];
  const result=budgetProgressForMonth(item,record,plans,'2026-10')[0];
  assert.equal(result.spent,120);
  assert.equal(result.tripSpent,20);
  assert.equal(result.remaining,230);
  assert.equal(budgetProgressForMonth(item,record,plans,'2026-10','Principe',{financeExpenseId:'duplicate'})[0].spent,120);
  assert.equal(budgetProgressForMonth(item,record,plans,'2026-10','Principe',{tripPlanId:'trip-1',tripExpenseId:'duplicate-trip'})[0].spent,120);
  assert.equal(budgetProgressForMonth(item,null,plans,'2026-11')[0].remaining,260);
  const sharedDuplicate={month:'2026-10',expenses:[{id:'shared-double',name:'Fuel',amount:40,date:'2026-10-08',paidFrom:'personal'}]};
  const sharedTrip=[{id:'trip-1',expenseEntries:[{id:'shared-fuel',category:'transport',transportType:'fuel',amount:40,date:'2026-10-08',paidBy:'both'}]}];
  assert.equal(budgetProgressForMonth(item,sharedDuplicate,sharedTrip,'2026-10')[0].spent,40);
});

test('untracked categories, shared jar, legacy records and excluded expenses are safe',()=>{
  assert.deepEqual(recurringBudgetItems({expenses:[{...fuel,isBudget:false}]}),[]);
  assert.equal(budgetProgressForMonth([fuel],{expenses:[{name:'Fuel',amount:100,budgetCategoryId:'none'}]},[],'2026-10')[0].remaining,350);
  assert.equal(budgetProgressForMonth([fuel],{expenses:[{name:'Fuel',amount:400}]},[],'2026-10')[0].over,true);
  assert.equal(budgetProgressForMonth([fuel],{expenses:[{name:'Fuel',amount:400}]},[],'2026-10')[0].remaining,-50);
  assert.equal(budgetProgressForMonth([fuel],null,[{id:'a',expenseEntries:[{category:'transport',transportType:'tolls',amount:50,paidBy:'Principe',date:'2026-10-03'}]}],'2026-10')[0].spent,0);
});
