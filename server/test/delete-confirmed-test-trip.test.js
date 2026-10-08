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

test('confirmed Test trips from any date may be deleted without touching real trips',()=>{
  const ctx=setup();
  const oldTest=ctx.createConfirmed('Test','2026-08-01','2026-08-02');
  const laterTest=ctx.createConfirmed(' tEsT ','2026-09-05','2026-09-06');
  const real=ctx.createConfirmed('Lonato','2025-10-17','2025-10-20');
  const before=getState();
  const old=before.plans.find(p=>p.id===oldTest);
  const later=before.plans.find(p=>p.id===laterTest);
  const lonato=before.plans.find(p=>p.id===real);
  const lonatoRecord=JSON.stringify(before.trips.find(t=>t.id===lonato.linkedTripId));
  assert.equal(ctx.action('deleteConfirmedTestTrip',{tripId:lonato.linkedTripId}).ok,false);
  assert.equal(ctx.action('deleteConfirmedTestTrip',{tripId:'nonexistent'}).ok,false);
  assert.equal(ctx.action('deleteConfirmedTestTrip',{tripId:old.linkedTripId}).ok,true);
  assert.equal(ctx.action('deleteConfirmedTestTrip',{tripId:later.linkedTripId},'Principe').ok,true);
  const after=getState();
  assert.equal(after.trips.length,1);
  assert.equal(after.plans.length,1);
  assert.equal(after.trips[0].id,lonato.linkedTripId);
  assert.equal(JSON.stringify(after.trips[0]),lonatoRecord);
  assert.equal(after.plans[0].id,real);
  assert.equal(after.game.Principessa.twos,before.game.Principessa.twos-200);
  assert.equal(after.game.Principe.twos,before.game.Principe.twos);
  assert.equal(after.game.Principessa.awards.tripSettlements.includes('trip:Principessa:'+old.linkedTripId),false);
  assert.equal(after.game.Principessa.awards.tripSettlements.includes('trip:Principessa:'+later.linkedTripId),false);
  assert.equal(ctx.action('deleteConfirmedTestTrip',{tripId:old.linkedTripId}).ok,false);
});

test('unconfirmed Test and real confirmed trips are protected, including old delete actions',()=>{
  const ctx=setup();
  const draft=ctx.action('savePlan',{meta:{
    location:'Italy',city:'Test',start:'2025-08-01',end:'2025-08-02'
  },budget:100});
  assert.equal(draft.ok,true);
  assert.equal(ctx.action('deleteConfirmedTestTrip',{tripId:draft.planId}).ok,false);
  const real=ctx.createConfirmed('Lonato','2025-10-17','2025-10-20');
  const confirmed=ctx.createConfirmed('Test','2026-08-01','2026-08-02');
  const state=getState();
  const tripId=state.plans.find(p=>p.id===confirmed).linkedTripId;
  const lonatoTrip=state.plans.find(p=>p.id===real).linkedTripId;
  assert.equal(ctx.action('deleteCurrentTrip',{kind:'trip',id:tripId}).ok,false);
  assert.equal(ctx.action('deleteCurrentTrip',{kind:'plan',id:confirmed}).ok,false);
  assert.equal(ctx.action('deleteConfirmedTestTrip',{tripId:lonatoTrip}).ok,false);
});
