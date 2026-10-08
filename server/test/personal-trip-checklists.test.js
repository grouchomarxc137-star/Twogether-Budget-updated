import assert from 'node:assert/strict';
import test from 'node:test';
import {configureStateStore,getState,runAction} from '../src/core.js';

function setup() {
  let saved={},writes=0;
  const copy=x=>JSON.parse(JSON.stringify(x));
  configureStateStore({read:()=>copy(saved),write:x=>{saved=copy(x);writes++;}});
  return {run:(action,payload={},person='Principessa')=>runAction(action,payload,person),state:()=>getState(),writes:()=>writes,
    mutate:fn=>fn(saved)};
}
function plan(ctx,name='Bergamo') {
  const result=ctx.run('savePlan',{meta:{location:'Italy',city:name,start:'2026-11-12',end:'2026-11-15'},budget:200});
  assert.equal(result.ok,true,result.error);
  return result.planId;
}

test('old recurrent packing is migrated to independent personal lists without losing customizations',()=>{
  const ctx=setup(),id=plan(ctx);
  const original=ctx.state().plans.find(x=>x.id===id);
  const old=original.prep;
  old.packing[0].done=true;
  old.packing[0].personal={Principessa:{done:true,text:'My toothbrush'},
    Principe:{done:false,text:'His toothbrush'}};
  old.packing[1].personal={Principe:{done:true}};
  const saved=ctx.run('saveTripPrep',{planId:id,prep:old});
  assert.equal(saved.ok,true,saved.error);
  const converted=ctx.run('personalizeTripChecklists',{},'Principe');
  assert.equal(converted.ok,true,converted.error);
  assert.equal(converted.personalized,true);
  const state=ctx.state();
  const defaults=state.tripPrepDefaults;
  const trip=state.plans.find(x=>x.id===id);
  assert.equal(defaults.personalRecurrentV1,true);
  assert.equal(defaults.legacyRecurrentBackup.packing.length,7);
  assert.equal(trip.prep.legacyRecurrentBackup.packing.length,7);
  assert.equal(defaults.packing.filter(x=>x.personalFor==='Principessa').length,7);
  assert.equal(defaults.packing.filter(x=>x.personalFor==='Principe').length,7);
  assert.equal(trip.prep.packing.length,14);
  assert.equal(trip.prep.packing.find(x=>x.text==='My toothbrush').done,true);
  assert.equal(trip.prep.packing.find(x=>x.text==='His toothbrush').done,false);
  assert.equal(trip.prep.packing.find(x=>x.personalFor==='Principe'&&x.text==='Slippers').done,true);
  assert.equal(new Set(trip.prep.packing.map(x=>x.id)).size,14);
  assert.ok(trip.prep.packing.every(item=>
    defaults.packing.some(def=>def.id===item.recurrentId&&def.personalFor===item.personalFor)));
  const writes=ctx.writes();
  assert.equal(ctx.run('personalizeTripChecklists',{}).alreadyPersonal,true);
  assert.equal(ctx.writes(),writes);
  assert.equal(ctx.state().tripPrepDefaults.legacyRecurrentBackup.packing.length,7);
});

test('personal recurrence editing cannot overwrite the other person, including trip customizations',()=>{
  const ctx=setup(),id=plan(ctx);
  assert.equal(ctx.run('personalizeTripChecklists',{}).ok,true);
  const defaults=ctx.state().tripPrepDefaults;
  const her=defaults.packing.filter(x=>x.personalFor==='Principessa');
  const changed=ctx.run('saveTripPrepDefaults',{prep:{
    packing:her.map(x=>({...x,text:'Her '+x.text})),
    reminders:defaults.reminders.filter(x=>x.personalFor==='Principessa'),
    packingSections:defaults.packingSections,
  }},'Principessa');
  assert.equal(changed.ok,true,changed.error);
  const next=ctx.state();
  assert.equal(next.tripPrepDefaults.packing.filter(x=>x.personalFor==='Principe').length,7);
  assert.ok(next.tripPrepDefaults.packing.filter(x=>x.personalFor==='Principe')
    .every(x=>!x.text.startsWith('Her ')));
  assert.ok(next.tripPrepDefaults.packing.filter(x=>x.personalFor==='Principessa')
    .every(x=>x.text.startsWith('Her ')));
  const previousPlan=next.plans.find(x=>x.id===id);
  assert.ok(previousPlan.prep.packing.some(x=>x.personalFor==='Principe'&&x.text==='Toothbrushes'));
  // A stale client attempts to edit Principe's entry from Principessa's account.
  const injected=ctx.run('saveTripPrepDefaults',{prep:{
    packing:[{...next.tripPrepDefaults.packing.find(x=>x.personalFor==='Principe'),text:'Overwrite his items'}],
    reminders:[],
    packingSections:defaults.packingSections,
  }},'Principessa');
  assert.equal(injected.ok,true,injected.error);
  assert.equal(ctx.state().tripPrepDefaults.packing.some(x=>x.text==='Overwrite his items'),false);
});

test('During Trip entries stay shared in that trip and never become recurrent templates',()=>{
  const ctx=setup(),id=plan(ctx);
  assert.equal(ctx.run('personalizeTripChecklists',{}).ok,true);
  const trip=ctx.state().plans.find(x=>x.id===id),item={id:'shared-grocery',text:'Buy pasta',
    done:false,personalFor:'',addedBy:'Principessa',personal:{}};
  const prep={...trip.prep,packing:trip.prep.packing.concat(item)};
  const result=ctx.run('saveTripPrep',{planId:id,prep});
  assert.equal(result.ok,true,result.error);
  assert.ok(ctx.state().plans.find(x=>x.id===id).prep.packing.some(x=>x.text==='Buy pasta'&&!x.personalFor));
  assert.equal(ctx.state().tripPrepDefaults.packing.some(x=>x.text==='Buy pasta'),false);
  assert.equal(ctx.state().tripPrepDefaults.personalRecurrentV1,true);
  assert.ok(ctx.state().plans.find(x=>x.id===id).prep.reminders.every(x=>x.personalFor));
});

test('personalization and return packing reset remain compatible and confirmed trip data stays safe',()=>{
  const ctx=setup(),id=plan(ctx);
  const today=new Date().toISOString().slice(0,10);
  const newDate=offset=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
  const due=ctx.run('savePlan',{id,meta:{location:'Italy',city:'Bergamo',start:newDate(-1),end:newDate(1)},budget:200});
  assert.equal(due.ok,true,due.error);
  assert.equal(ctx.run('personalizeTripChecklists',{}).ok,true);
  const original=ctx.state().plans.find(x=>x.id===id).prep;
  assert.equal(ctx.run('saveTripPrep',{planId:id,prep:{
    ...original,packing:original.packing.map(x=>({...x,done:true}))
  }}).ok,true);
  const reset=ctx.run('resetReturnPacking',{planId:id,localDate:today});
  assert.equal(reset.ok,true,reset.error);
  assert.ok(ctx.state().plans.find(x=>x.id===id).prep.packing.every(x=>!x.done));
  assert.equal(ctx.state().plans.find(x=>x.id===id).prep.returnPackingResetEnd,newDate(1));
});

test('simultaneous personal edits cannot overwrite the partner checklist or templates',()=>{
  const ctx=setup(),id=plan(ctx);
  assert.equal(ctx.run('personalizeTripChecklists',{}).ok,true);
  const original=ctx.state().plans.find(p=>p.id===id).prep;
  const her=original.packing.find(x=>x.personalFor==='Principessa');
  const his=original.packing.find(x=>x.personalFor==='Principe');
  const hisResult=ctx.run('saveTripPrep',{planId:id,prep:{...original,
    packing:original.packing.map(x=>x.id===his.id?{...x,done:true,text:'His kit'}:x)}},'Principe');
  assert.equal(hisResult.ok,true,hisResult.error);
  const herResult=ctx.run('saveTripPrep',{planId:id,prep:{...original,
    packing:original.packing.map(x=>x.id===her.id?{...x,done:true,text:'Her kit'}:x)}},'Principessa');
  assert.equal(herResult.ok,true,herResult.error);
  const now=ctx.state().plans.find(p=>p.id===id).prep.packing;
  assert.equal(now.find(x=>x.id===her.id).text,'Her kit');
  assert.equal(now.find(x=>x.id===his.id).text,'His kit');
  assert.equal(now.find(x=>x.id===her.id).done,true);
  assert.equal(now.find(x=>x.id===his.id).done,true);
});

test('migrating recurring templates does not modify confirmed Lonato records',()=>{
  const ctx=setup(),id=plan(ctx,'Lonato');
  ctx.mutate(state=>{
    const trip=state.plans.find(x=>x.id===id);
    trip.linkedTripId='locked-lonato-trip';
    state.trips.push({
      id:'locked-lonato-trip',
      confirmed:{Principessa:true,Principe:true},
      submissions:{
        Principessa:{location:'Italy',city:'Lonato',start:'2026-10-17',end:'2026-10-20'},
        Principe:{location:'Italy',city:'Lonato',start:'2026-10-17',end:'2026-10-20'},
      }
    });
  });
  const before=ctx.state().plans.find(x=>x.id===id);
  const original=JSON.stringify(before.prep);
  assert.equal(ctx.run('personalizeTripChecklists',{}).ok,true);
  assert.equal(JSON.stringify(ctx.state().plans.find(x=>x.id===id).prep),original);
});
