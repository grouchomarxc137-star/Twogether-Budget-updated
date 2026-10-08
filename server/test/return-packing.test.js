import assert from 'node:assert/strict';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';

function setup() {
  let stored={},writes=0;
  const clone=value=>JSON.parse(JSON.stringify(value));
  configureStateStore({read:()=>clone(stored),write:value=>{stored=clone(value);writes++;}});
  return {
    action:(name,payload={},actor='Principessa')=>runAction(name,payload,actor),
    read:()=>getState(),
    mutate:fn=>fn(stored),
    writes:()=>writes
  };
}
const today=()=>new Date().toISOString().slice(0,10);
function dayFromToday(offset) {
  const date=new Date(today()+'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()+offset);
  return date.toISOString().slice(0,10);
}
function plan(ctx,city,start,end) {
  const created=ctx.action('savePlan',{meta:{location:'Italy',city,start,end},budget:300});
  assert.equal(created.ok,true,created.error);
  return created.planId;
}

test('return packing resets all personal and shared checkmarks once without changing items or reminders',()=>{
  const ctx=setup(),id=plan(ctx,'Garda',dayFromToday(-1),dayFromToday(1));
  const packing=[
    {id:'shared',text:'Toothbrush',done:true,section:'toiletries',
      personal:{Principessa:{done:true,text:'My toothbrush'},Principe:{done:true,text:'His toothbrush'}}},
    {id:'mine',text:'Shoes',done:true,personalFor:'Principessa'},
    {id:'his',text:'Jacket',done:true,personalFor:'Principe'},
    {id:'not-done',text:'Charger',done:false}
  ];
  const reminders=[{id:'reminder',text:'Take a photo',done:true}];
  const first=ctx.action('saveTripPrep',{planId:id,prep:{packing,reminders}});
  assert.equal(first.ok,true,first.error);
  const result=ctx.action('resetReturnPacking',{planId:id,localDate:today()});
  assert.equal(result.ok,true,result.error);
  assert.equal(result.reset,true);
  const after=ctx.read().plans.find(p=>p.id===id);
  assert.equal(after.prep.returnPackingResetEnd,dayFromToday(1));
  assert.deepEqual(after.prep.packing.map(item=>item.text),packing.map(item=>item.text));
  assert.ok(after.prep.packing.every(item=>item.done===false));
  assert.ok(after.prep.packing.every(item=>
    Object.values(item.personal||{}).every(override=>override.done!==true)));
  assert.equal(after.prep.packing[0].personal.Principessa.text,'My toothbrush');
  assert.equal(after.prep.packing[0].personal.Principe.text,'His toothbrush');
  assert.equal(after.prep.reminders[0].done,true);

  const savedState={...after.prep,packing:after.prep.packing.map(item=>({...item}))};
  savedState.packing[0].done=true;
  savedState.packing[0].personal={...savedState.packing[0].personal,Principessa:{
    ...savedState.packing[0].personal.Principessa,done:true
  }};
  const resave=ctx.action('saveTripPrep',{planId:id,prep:savedState});
  assert.equal(resave.ok,true,resave.error);
  const writes=ctx.writes();
  const repeat=ctx.action('resetReturnPacking',{planId:id,localDate:today()},'Principe');
  assert.equal(repeat.alreadyReset,true);
  assert.equal(ctx.writes(),writes);
  assert.equal(ctx.read().plans.find(p=>p.id===id).prep.packing[0].done,true);
  assert.equal(ctx.read().plans.find(p=>p.id===id).prep.packing[0].personal.Principessa.done,true);

  const stale=ctx.action('saveTripPrep',{planId:id,prep:{packing,reminders}});
  assert.equal(stale.ok,false);
  assert.match(stale.error,/reopen your checklist/i);
  assert.equal(ctx.read().plans.find(p=>p.id===id).prep.packing[0].done,true);
});

test('a reset cannot run early or after a trip, nor change confirmed trips',()=>{
  const ctx=setup();
  const future=plan(ctx,'Future',dayFromToday(1),dayFromToday(3));
  assert.equal(ctx.action('resetReturnPacking',{planId:future,localDate:today()}).notDue,true);
  const old=plan(ctx,'Old',dayFromToday(-8),dayFromToday(-4));
  assert.equal(ctx.action('resetReturnPacking',{planId:old,localDate:today()}).notDue,true);
  const endToday=plan(ctx,'Ends today',dayFromToday(-3),today());
  assert.equal(ctx.action('resetReturnPacking',{planId:endToday,localDate:today()}).reset,true);
  const locked=plan(ctx,'Locked',dayFromToday(-4),dayFromToday(1));
  ctx.mutate(state=>{
    const p=state.plans.find(row=>row.id===locked);
    p.linkedTripId='locked-trip-id';
    state.trips.push({id:'locked-trip-id',budget:300,
      submissions:{Principessa:{city:'Locked',start:dayFromToday(-4),end:dayFromToday(1)},
        Principe:{city:'Locked',start:dayFromToday(-4),end:dayFromToday(1)}},
      confirmed:{Principessa:true,Principe:true}});
  });
  assert.equal(ctx.action('resetReturnPacking',{planId:locked,localDate:today()}).notDue,true);
  assert.equal(ctx.action('resetReturnPacking',{planId:endToday,localDate:dayFromToday(8)}).ok,false);
  assert.equal(ctx.action('resetReturnPacking',{planId:future,localDate:'invalid'}).ok,false);
});

test('private Shop packing lists reset for each partner and do not reset after rechecking',()=>{
  const ctx=setup(),id=plan(ctx,'Test trip',dayFromToday(-1),dayFromToday(1));
  ctx.mutate(state=>{
    for(const who of ['Principessa','Principe']){
      state.game[who].purchases.push('packing-list');
      state.game[who].packing[id]=[{text:'Shoes',done:true},{text:'Toothbrush',done:false}];
    }
  });
  assert.equal(ctx.action('resetReturnPacking',{planId:id,localDate:today()}).reset,true);
  for(const who of ['Principessa','Principe']){
    const item=ctx.read().game[who].packing[id][0];
    assert.equal(item.text,'Shoes');
    assert.equal(item.done,false);
    assert.ok(ctx.read().game[who].purchases.includes('packing-list'));
  }
  ctx.mutate(state=>{state.game.Principe.packing[id][0].done=true;});
  assert.equal(ctx.action('resetReturnPacking',{planId:id,localDate:today()},'Principe').alreadyReset,true);
  assert.equal(ctx.read().game.Principe.packing[id][0].done,true);
});

test('changing a trip end date preserves reset history and can reset once for the new end',()=>{
  const ctx=setup(),id=plan(ctx,'Rescheduled',dayFromToday(-3),dayFromToday(1));
  assert.equal(ctx.action('resetReturnPacking',{planId:id,localDate:today()}).reset,true);
  const changed=ctx.action('savePlan',{id,meta:{city:'Rescheduled',location:'Italy',
    start:dayFromToday(-3),end:dayFromToday(2)},budget:300});
  assert.equal(changed.ok,true,changed.error);
  const saved=ctx.read().plans.find(item=>item.id===id);
  assert.equal(saved.prep.returnPackingResetEnd,dayFromToday(1));
  assert.equal(ctx.action('resetReturnPacking',{planId:id,localDate:today()}).notDue,true);
});
