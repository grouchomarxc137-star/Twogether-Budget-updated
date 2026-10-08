import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const source=readFileSync(new URL('../../src/trips/current-trips.js',import.meta.url),'utf8');
function section(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Could not find checklist behavior '+start);
 return source.slice(a,b);
}
function headerHandlers(){
 const main=section('async function openSimplifiedChecklist(', 'function openRecurrentChecklistItems(');
 const click=main.slice(main.indexOf("const header=e.target.closest('[data-check-personal-toggle]');"),
   main.indexOf("const b=e.target.closest('button');",main.indexOf("const header=e.target.closest('[data-check-personal-toggle]');")));
 const key=main.slice(main.indexOf("if(e.target.matches?.('[data-check-personal-toggle]')"),
   main.indexOf("const input=e.target.closest('[data-check-new]');",main.indexOf("if(e.target.matches?.('[data-check-personal-toggle]')")));
 assert.ok(click.includes('state.packingMine=!state.packingMine'));
 assert.ok(key.includes('state.packingMine=!state.packingMine'));
 return {
  click:new Function('e','state','render',click),
  key:new Function('e','state','render',key),
  main
 };
}
test('tapping checklist title toggles My Checklist and During Trip without a separate switch',()=>{
 const {click,main}=headerHandlers();
 const state={packingMine:true},draws=[];
 const render=()=>draws.push(state.packingMine);
 const title={closest(selector){return selector==='[data-check-personal-toggle]'?{}:null;}};
 click({target:title},state,render);
 assert.equal(state.packingMine,false);
 click({target:title},state,render);
 assert.equal(state.packingMine,true);
 assert.deepEqual(draws,[false,true]);
 assert.ok(main.includes("personal?'My checklist':'During Trip'"));
 assert.ok(!main.includes('data-check-view-toggle'));
 const recurrent={closest(selector){return selector==='[data-check-personal-toggle]'||selector==='button,input,label,a,select,textarea'?{}:null;}};
 click({target:recurrent},state,render);
 assert.equal(state.packingMine,true,'Recurrent button must not switch views');
});
test('keyboard can switch checklist but unrelated keys cannot',()=>{
 const {key}=headerHandlers(),state={packingMine:true};
 const header={matches:selector=>selector==='[data-check-personal-toggle]'};
 let draws=0,prevented=0;
 key({target:header,key:'Enter',preventDefault(){prevented++;}},state,()=>draws++);
 assert.equal(state.packingMine,false);
 key({target:header,key:' ',preventDefault(){prevented++;}},state,()=>draws++);
 assert.equal(state.packingMine,true);
 key({target:header,key:'Tab',preventDefault(){prevented++;}},state,()=>draws++);
 assert.equal(state.packingMine,true);
 assert.equal(draws,2);
 assert.equal(prevented,2);
});
function simulateSwipe({recurrent,movement}){
 const code=section('function bindChecklistSwipeDown(layer, sheet) {','function resetCardSwipeVisual(row, animate = true) {');
 const handler={};let dismissed=0,returned=0;
 const backdrop={style:{}};
 const sheet={scrollTop:0,isConnected:true,style:{},classList:{contains(){return false;}},
    addEventListener(name,fn){handler[name]=fn;}};
 const layer={dataset:{},querySelector:selector=>selector==='.tv2-backdrop'?backdrop:null,remove(){}};
 if(recurrent)layer.__tv2SwipeBack=()=>returned++;
 const fakeWindow={matchMedia:()=>({matches:true}),innerHeight:800,innerWidth:390};
 const bind=new Function('window','setTimeout','closeSimplifiedSheet','simplifiedLayer',
   code+'return bindChecklistSwipeDown;')(fakeWindow,callback=>{callback();return 1;},()=>dismissed++,layer);
 bind(layer,sheet);
 const target={closest:selector=>selector==='.tv2-sheet-head'?{}:null};
 const event=y=>({target,touches:[{clientX:30,clientY:y}],preventDefault(){}});
 handler.touchstart(event(15));
 handler.touchmove(event(15+movement));
 handler.touchend(event(15+movement));
 return {dismissed,returned};
}
test('swiping down from Recurrent Items returns to personal checklist',()=>{
 assert.deepEqual(simulateSwipe({recurrent:true,movement:180}),{dismissed:0,returned:1});
});
test('normal checklist still closes and a short recurrent swipe does nothing',()=>{
 assert.deepEqual(simulateSwipe({recurrent:false,movement:180}),{dismissed:1,returned:0});
 assert.deepEqual(simulateSwipe({recurrent:true,movement:28}),{dismissed:0,returned:0});
});
