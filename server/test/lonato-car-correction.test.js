import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';
import { openDatabase } from '../src/db/index.js';

function setup() {
  const directory=mkdtempSync(join(tmpdir(),'twogether-lonato-reclassify-'));
  const db=openDatabase(join(directory,'test.sqlite'));
  configureStateStore(db.store);
  return {db,cleanup(){db.close();rmSync(directory,{recursive:true,force:true});}};
}
function action(db,name,payload,actor='Principessa') {
  return db.db.transaction(()=>runAction(name,payload,actor))();
}
const data=(city='Lonato del Garda')=>({
  meta:{location:'Italy',city,start:'2025-10-17',end:'2025-10-20'},budget:605,
});
test('confirmed Lonato reclassification preserves both payers, ids, total, and locked status',()=>{
  const ctx=setup();
  try{
    const plan=action(ctx.db,'savePlan',data());
    assert.equal(plan.ok,true);
    for(const [kind,amount,payer] of [
      ['fuel',40,'Principessa'],['fuel',20,'Principe'],['parking-tolls',10,'Principessa'],['flights-trains',30,'both']
    ]){
      const expense=action(ctx.db,'saveTripExpense',{planId:plan.planId,expense:{
        category:'transport',transportType:kind,amount,paidBy:payer,
        split:payer==='both'?'shared':'personal',forActor:payer==='both'?'':payer,date:'2025-10-18'
      }});
      assert.equal(expense.ok,true);
    }
    const first=action(ctx.db,'confirmPlanTrip',{planId:plan.planId});
    assert.equal(first.ok,true);
    const second=action(ctx.db,'confirmPlanTrip',{planId:plan.planId},'Principe');
    assert.equal(second.ok,true);
    assert.equal(second.locked,true);
    const before=getState();
    const oldPlan=before.plans.find(p=>p.id===plan.planId);
    const oldTrip=before.trips.find(t=>t.id===oldPlan.linkedTripId);
    const saved=oldPlan.expenseEntries.map(({id,amount,paidBy,split,forActor,date,loggedBy,createdAt})=>({
      id,amount,paidBy,split,forActor,date,loggedBy,createdAt
    }));
    assert.equal(oldTrip.submissions.Principessa.fuel,60);
    assert.equal(oldTrip.submissions.Principessa.tolls,10);
    const result=action(ctx.db,'correctLonatoCarTolls',{planId:plan.planId});
    assert.equal(result.ok,true);
    assert.equal(result.reclassified,2);
    const after=getState();
    const newPlan=after.plans.find(p=>p.id===plan.planId);
    const newTrip=after.trips.find(t=>t.id===newPlan.linkedTripId);
    assert.deepEqual(newPlan.expenseEntries.map(({id,amount,paidBy,split,forActor,date,loggedBy,createdAt})=>({
      id,amount,paidBy,split,forActor,date,loggedBy,createdAt
    })),saved);
    assert.deepEqual(newPlan.expenseEntries.map(x=>x.transportType),['tolls','tolls','parking-tolls','flights-trains']);
    assert.deepEqual(newTrip.confirmed,{Principessa:true,Principe:true});
    for(const person of ['Principessa','Principe']){
      assert.equal(newTrip.submissions[person].fuel,0);
      assert.equal(newTrip.submissions[person].tolls,70);
      assert.equal(newTrip.submissions[person].travel,30);
      assert.equal(newTrip.submissions[person].paid,oldTrip.submissions[person].paid);
    }
    assert.equal(action(ctx.db,'correctLonatoCarTolls',{planId:plan.planId}).alreadyCorrected,true);
  }finally{ctx.cleanup();}
});

test('Lonato correction never applies to unrelated or unlocked trips',()=>{
  const ctx=setup();
  try{
    const other=action(ctx.db,'savePlan',data('Venice'));
    assert.equal(other.ok,true);
    assert.equal(action(ctx.db,'correctLonatoCarTolls',{planId:other.planId}).ok,false);
    const unlocked=action(ctx.db,'savePlan',data());
    assert.equal(unlocked.ok,true);
    assert.equal(action(ctx.db,'correctLonatoCarTolls',{planId:unlocked.planId}).ok,false);
    const wrongMonth=action(ctx.db,'savePlan',{
      meta:{location:'Italy',city:'Lonato',start:'2025-09-17',end:'2025-09-20'},budget:605,
    });
    assert.equal(wrongMonth.ok,true);
    assert.equal(action(ctx.db,'correctLonatoCarTolls',{planId:wrongMonth.planId}).ok,false);
  }finally{ctx.cleanup();}
});
