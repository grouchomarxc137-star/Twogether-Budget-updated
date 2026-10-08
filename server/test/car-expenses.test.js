import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';
import { openDatabase } from '../src/db/index.js';
import { isCarExpense, carExpenseLabel, carExpenseBreakdown, carExpenseSubtype } from '../../src/trips/car-expenses.js';

function setup(){
  const directory=mkdtempSync(join(tmpdir(),'twogether-car-expenses-'));
  const db=openDatabase(join(directory,'test.sqlite'));
  configureStateStore(db.store);
  return {db,close(){db.close();rmSync(directory,{recursive:true,force:true});}};
}
function action(db,name,payload,actor='Principessa'){
  return db.db.transaction(()=>runAction(name,payload,actor))();
}
function expense(type,amount,paidBy='both',id=''){
  return {id,category:'transport',transportType:type,amount,paidBy,split:'shared',date:'2020-10-02'};
}
test('Car and Transport are separate while legacy categories remain readable',()=>{
  assert.equal(isCarExpense(expense('fuel',20)),true);
  assert.equal(isCarExpense(expense('tolls',20)),true);
  assert.equal(isCarExpense(expense('parking',20)),true);
  assert.equal(isCarExpense(expense('car-other',20)),true);
  assert.equal(isCarExpense(expense('parking-tolls',20)),true);
  assert.equal(isCarExpense(expense('flights-trains',20)),false);
  assert.equal(isCarExpense(expense('other',20)),false);
  assert.equal(carExpenseLabel(expense('fuel',20)),'Fuel');
  assert.equal(carExpenseLabel(expense('parking',20)),'Parking');
  assert.equal(carExpenseLabel(expense('car-other',20)),'Other');
  assert.equal(carExpenseLabel(expense('parking-tolls',20)),'Tolls / Parking');
  assert.equal(carExpenseSubtype('invalid'),'fuel');
});

test('Car breakdown keeps four new subtypes, individual purchases and payer shares',()=>{
  const entries=[
    {...expense('fuel',110,'Principe','fuel'),note:'Shell'},
    {...expense('tolls',35,'Principe','tolls'),note:'Autostrada'},
    {...expense('parking',25,'both','parking'),note:'City parking'},
    {...expense('car-other',10,'Principessa','other'),name:'Car wash'},
    {...expense('flights-trains',90,'Principe','travel')},
  ];
  const combined=carExpenseBreakdown(entries);
  assert.deepEqual(combined.map(x=>x.label),['Fuel','Tolls','Parking','Other']);
  assert.deepEqual(combined.map(x=>x.amount),[110,35,25,10]);
  assert.equal(combined[0].items[0].name,'Shell');
  assert.equal(combined[1].items[0].date,'2020-10-02');
  assert.deepEqual(carExpenseBreakdown(entries,{payer:'Principe'}).map(x=>x.amount),[110,35,12.5]);
  assert.deepEqual(carExpenseBreakdown(entries,{payer:'Principessa'}).map(x=>x.amount),[12.5,10]);
  assert.equal(carExpenseBreakdown(entries,{month:'2020-11'}).length,0);
});

test('trip API saves Car subtypes separately and confirms with old compatible totals',()=>{
  const ctx=setup();
  try{
    const created=action(ctx.db,'savePlan',{meta:{location:'Italy',city:'Verona',start:'2020-10-01',end:'2020-10-03'},budget:300});
    assert.equal(created.ok,true);
    for(const [type,amount] of [['fuel',110],['tolls',35],['parking',25],['car-other',10],['flights-trains',70]]){
      const saved=action(ctx.db,'saveTripExpense',{planId:created.planId,expense:expense(type,amount)});
      assert.equal(saved.ok,true,saved.error||type);
      assert.equal(saved.expense.transportType,type);
    }
    const plan=getState().plans.find(x=>x.id===created.planId);
    assert.deepEqual(carExpenseBreakdown(plan.expenseEntries).map(x=>x.amount),[110,35,25,10]);
    const first=action(ctx.db,'confirmPlanTrip',{planId:created.planId});
    assert.equal(first.ok,true,first.error);
    const second=action(ctx.db,'confirmPlanTrip',{planId:created.planId},'Principe');
    assert.equal(second.ok,true,second.error);
    const trip=getState().trips[0];
    assert.equal(trip.confirmed.Principessa,true);
    assert.equal(trip.confirmed.Principe,true);
    const totals=trip.submissions.Principessa;
    assert.equal(totals.travel,70);
    assert.equal(totals.fuel,110);
    assert.equal(totals.tolls,70);
    assert.equal(totals.other,0);
    assert.equal(totals.travel+totals.fuel+totals.tolls,250);
  }finally{ctx.close();}
});

test('legacy Tolls/Parking is still a Car expense and updating a subtype preserves its identity',()=>{
  const ctx=setup();
  try{
    const plan=action(ctx.db,'savePlan',{meta:{location:'Italy',city:'Rome',start:'2020-10-01',end:'2020-10-03'},budget:300});
    const old=action(ctx.db,'saveTripExpense',{planId:plan.planId,expense:expense('parking-tolls',18,'Principessa')});
    assert.equal(old.ok,true);
    assert.equal(carExpenseBreakdown([old.expense])[0].label,'Tolls / Parking');
    const edit=action(ctx.db,'saveTripExpense',{planId:plan.planId,expense:{...old.expense,transportType:'parking',amount:22}});
    assert.equal(edit.ok,true);
    assert.equal(edit.expense.id,old.expense.id);
    assert.equal(carExpenseBreakdown([edit.expense])[0].label,'Parking');
    assert.equal(getState().plans[0].expenseEntries.length,1);
  }finally{ctx.close();}
});
