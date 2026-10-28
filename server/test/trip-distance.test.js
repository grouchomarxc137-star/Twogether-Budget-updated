import assert from 'node:assert/strict';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';
import { distanceStats, loggedTripFuel, readDistanceInput, renderTripDistance } from '../../src/trips/trip-distance.js';

function setup() {
  let saved={};
  const copy=value=>JSON.parse(JSON.stringify(value));
  configureStateStore({read:()=>copy(saved),write:state=>{saved=copy(state);}});
  return {seed:state=>{saved=copy(state);}};
}
function createPlan(end='2000-10-20') {
  const result=runAction('savePlan',{
    meta:{location:'Italy',city:'Lonato',start:'2000-10-17',end},
    budget:250
  },'Principessa');
  assert.equal(result.ok,true,result.error);
  return result.planId;
}
function confirmedTrip(id='confirmed-trip') {
  const meta={location:'Italy',city:'Lonato',start:'2000-10-17',end:'2000-10-20',fuel:75};
  return {id,createdBy:'Principessa',confirmed:{Principessa:true,Principe:true},
    submissions:{Principessa:meta,Principe:meta}};
}

test('trip distance saves and survives sanitizing without touching expenses',()=>{
  setup();
  const planId=createPlan();
  const result=runAction('saveTripDistance',{planId,distanceKm:375},'Principessa');
  assert.equal(result.ok,true,result.error);
  const plan=getState().plans.find(x=>x.id===planId);
  assert.equal(plan.distanceKm,375);
  assert.deepEqual(plan.expenseEntries,[]);
});

test('invalid and future distances do not overwrite trip history',()=>{
  setup();
  const planId=createPlan();
  assert.equal(runAction('saveTripDistance',{planId,distanceKm:420},'Principessa').ok,true);
  for (const wrong of ['hello',-5,0,1000001,'15.55','']) {
    assert.equal(runAction('saveTripDistance',{planId,distanceKm:wrong},'Principe').ok,false);
    assert.equal(getState().plans.find(x=>x.id===planId).distanceKm,420);
  }
  const futureId=createPlan('2099-10-20');
  const blocked=runAction('saveTripDistance',{planId:futureId,distanceKm:12},'Principessa');
  assert.equal(blocked.ok,false);
  assert.equal(getState().plans.find(x=>x.id===futureId).distanceKm,'');
});

test('confirmed linked trip accepts kilometre edits without reopening confirmation',()=>{
  const store=setup();
  const planId=createPlan();
  const state=getState();
  state.plans.find(x=>x.id===planId).linkedTripId='confirmed-trip';
  state.trips.push(confirmedTrip());
  store.seed(state);
  const saved=runAction('saveTripDistance',{tripId:'confirmed-trip',distanceKm:'420,5'},'Principe');
  assert.equal(saved.ok,true,saved.error);
  const after=getState();
  assert.equal(after.plans.find(x=>x.id===planId).distanceKm,420.5);
  assert.equal(after.trips[0].confirmed.Principessa,true);
  assert.equal(after.trips[0].confirmed.Principe,true);
  assert.equal(after.trips[0].distanceKm,'');
});

test('standalone confirmed trips retain their kilometres too',()=>{
  const store=setup();
  const state=getState();
  state.trips.push(confirmedTrip('standalone'));
  store.seed(state);
  const saved=runAction('saveTripDistance',{tripId:'standalone',distanceKm:120},'Principessa');
  assert.equal(saved.ok,true,saved.error);
  assert.equal(getState().trips[0].distanceKm,120);
});

test('kilometres use logged fuel only, including changing prices',()=>{
  const plan={distanceKm:375,expenseEntries:[
    {category:'transport',transportType:'fuel',amount:40},
    {category:'transport',transportType:'fuel',amount:35},
    {category:'transport',transportType:'tolls',amount:18},
    {category:'transport',transportType:'flights-trains',amount:150},
  ]};
  const fuel=loggedTripFuel(plan);
  assert.equal(fuel,75);
  const summary=distanceStats(plan,null,fuel);
  assert.equal(summary.distanceKm,375);
  assert.equal(summary.fuelSpent,75);
  assert.equal(summary.costPerKm,0.2);
  assert.match(renderTripDistance(plan,null,fuel),/€0\.20\/km/);
  assert.match(renderTripDistance(plan,null,fuel),/€75/);
  assert.equal(readDistanceInput('375,5'),375.5);
  assert.equal(readDistanceInput('-20'),null);
  assert.equal(readDistanceInput(''),null);
});

test('no kilometres or no fuel displays no invented per-kilometre cost',()=>{
  const blank=renderTripDistance({},null,75);
  assert.match(blank,/Not logged/);
  assert.match(blank,/Cost per km/);
  assert.doesNotMatch(blank,/€0\.00\/km/);
  const fuelUnknown=renderTripDistance({distanceKm:200},null,0);
  assert.match(fuelUnknown,/No fuel logged/);
  assert.doesNotMatch(fuelUnknown,/€0\.00\/km/);
});
