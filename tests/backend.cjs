const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto');
function backend(){let data={};const ctx=vm.createContext({console,Date,JSON,Math,Number,String,Array,Object,Error,isFinite,Utilities:{getUuid:()=>crypto.randomUUID()},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>data[k]||null,setProperty:(k,v)=>data[k]=v,deleteProperty:k=>delete data[k]})},ContentService:{MimeType:{JSON:'json',JAVASCRIPT:'js'},createTextOutput:s=>({getContent:()=>s,setMimeType(){return this;}})}});vm.runInContext(fs.readFileSync('backend/Code.gs','utf8'),ctx);return {state:()=>JSON.parse(JSON.stringify(ctx.readState_())),post:(action,payload,actor='Principessa')=>JSON.parse(ctx.handlePost_({parameter:{action,actor,payload:JSON.stringify(payload)}}).getContent()),seed:s=>{data.TOGETHER_BUDGET_STATE_V1=JSON.stringify(s);},ctx};}
function run(){const b=backend();const p=b.post('savePlan',{meta:{location:'Italy',city:'Lonato',start:'2026-09-01',end:'2026-09-03'},budget:200});assert.equal(p.ok,true);const id=p.planId;
let r=b.post('saveSharedExpense',{planId:id,key:'accom',total:800,mode:'full',paid:800});assert.equal(r.ok,true);assert.equal(r.sharedExpense.paid.Principe,0);
r=b.post('saveSharedExpense',{planId:id,key:'accom',total:800,mode:'shared',paid:400});assert.equal(r.ok,true);
r=b.post('saveSharedExpense',{planId:id,key:'accom',total:800,mode:'shared',paid:350},'Principe');assert.equal(r.ok,true);assert.equal(r.sharedExpense.paid.Principessa,400);
r=b.post('saveSharedExpense',{planId:id,key:'travel',total:'',unknown:true,mode:'shared',paid:100});assert.equal(r.ok,true);assert.equal(r.sharedExpense.total,'');
r=b.post('saveSharedExpense',{planId:id,key:'travel',total:200,mode:'shared',paid:100},'Principe');assert.equal(r.ok,true);assert.equal(r.sharedExpense.total,200);
assert.equal(b.post('saveSharedExpense',{planId:id,key:'fuel',total:2,mode:'full',paid:2}).ok,false);
assert.equal(b.post('saveSharedExpense',{planId:id,key:'accom',total:800,mode:'shared',paid:-1}).ok,false);
const sub={accom:800,travel:200,groceries:0,eat:0,fuel:0,tolls:0,other:0,otherNote:'',paid:500,uncertain:{}};
const trip=b.post('savePlanSubmission',{planId:id,submission:sub});assert.equal(trip.ok,true);assert.equal(b.post('savePlanSubmission',{planId:id,submission:sub},'Principe').ok,true);
assert.equal(b.post('confirmTrip',{id:trip.tripId}).ok,false,'unreconciled shared payments block confirmation');
b.post('saveSharedExpense',{planId:id,key:'accom',total:800,mode:'shared',paid:400},'Principe');
assert.equal(b.post('confirmTrip',{id:trip.tripId}).ok,true);assert.equal(b.post('confirmTrip',{id:trip.tripId},'Principe').ok,true);
assert.equal(b.post('saveSharedExpense',{planId:id,key:'accom',total:800,mode:'shared',paid:400}).ok,false);
assert.equal(b.state().plans[0].meta.city,'Lonato');console.log('Backend: shared/full/unknown/negative/category/reconciliation/confirmation/locking checks passed.');}
if(require.main===module)run();module.exports={backend};
