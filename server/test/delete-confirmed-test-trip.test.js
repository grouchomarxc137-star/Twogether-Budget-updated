import assert from 'node:assert/strict';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';

function setup() {
  let state={};
  const copy=(value)=>JSON.parse(JSON.stringify(value));
  configureStateStore({
    read:()=>copy(state),
    write:(updated)=>{state=copy(updated);}
  });
  const action=(name,payload,actor='Principessa')=>runAction(name,payload,actor);
  function createConfirmed(city,start,end) {
    const created=action('savePlan',{meta:{location:'Italy',city,start,end},budget:200});
    assert.equal(created.ok,true,created.error);
    const expense=action('saveTripExpense',{planId:created.planId,expense:{
      category:'transport',transportType:'fuel',amount:100,paidBy:'Principessa',
      split:'personal',forActor:'Principessa',date:start
    }});
    assert.equal(expense.ok,true,expense.error);
    const first=action('confirmPlanTrip',{planId:created.planId});
    assert.equal(first.ok,true,first.error);
    const second=action('confirmPlanTrip',{planId:created.planId},'Principe');
    assert.equal(second.ok,true,second.error);
    assert.equal(second.locked,true);
    return created.planId;
  }
  return {action,createConfirmed};
}

test('only confirmed Test trip August 1–2 2026 and its test records may be deleted',()=>{
  const ctx=setup();
  const testPlan=ctx.createConfirmed('Test','2026-08-01','2026-08-02');
  const realPlan=ctx.createConfirmed('Lonato','2026-08-01','2026-08-02');
  const laterTest=ctx.createConfirmed('Test','2026-08-05','2026-08-06');
  const before=getState();
  const target=before.plans.find(p=>p.id===testPlan);
  const real=before.plans.find(p=>p.id===realPlan);
  const later=before.plans.find(p=>p.id===laterTest);
  assert.equal(ctx.action('deleteConfirmedTestTrip',{tripId:real.linkedTripId}).ok,false);
  assert.equal(ctx.action('deleteConfirmedTestTrip',{tripId:later.linkedTripId}).ok,false);
  assert.equal(ctx.action('deleteConfirmedTestTrip',{tripId:'nonexistent'}).ok,false);
  const award='trip:Principessa:'+target.linkedTripId;
  assert.equal(before.game.Principessa.awards.tripSettlements.includes(award),true);
  const result=ctx.action('deleteConfirmedTestTrip',{tripId:target.linkedTripId});
  assert.equal(result.ok,true,result.error);
  assert.equal(result.deletedPlanId,testPlan);
  const after=getState();
  assert.equal(after.trips.length,2);
  assert.equal(after.plans.length,2);
  assert.equal(after.trips.some(t=>t.id===target.linkedTripId),false);
  assert.equal(after.plans.some(p=>p.id===testPlan),false);
  assert.equal(after.trips.some(t=>t.id===real.linkedTripId),true);
  assert.equal(after.trips.some(t=>t.id===later.linkedTripId),true);
  assert.equal(after.game.Principessa.twos,before.game.Principessa.twos-100);
  assert.equal(after.game.Principessa.awards.tripSettlements.includes(award),false);
  assert.equal(after.game.Principe.twos,before.game.Principe.twos);
  assert.equal(ctx.action('deleteConfirmedTestTrip',{tripId:target.linkedTripId}).ok,false);
});

test('unconfirmed Test trip is protected; ordinary confirmed-trip deletion stays blocked',()=>{
  const ctx=setup();
  const pending=ctx.action('savePlan',{meta:{
    location:'Italy',city:'Test',start:'2026-08-01',end:'2026-08-02'
  },budget:100});
  assert.equal(pending.ok,true);
  assert.equal(ctx.action('deleteConfirmedTestTrip',{tripId:pending.planId}).ok,false);
  const confirmed=ctx.createConfirmed('Test','2026-08-01','2026-08-02');
  const tripId=getState().plans.find(p=>p.id===confirmed).linkedTripId;
  assert.equal(ctx.action('deleteCurrentTrip',{kind:'trip',id:tripId}).ok,false);
  assert.equal(ctx.action('deleteCurrentTrip',{kind:'plan',id:confirmed}).ok,false);
});
