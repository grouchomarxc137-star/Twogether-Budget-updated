import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Use the actual UI renderer: a future change must not break opening cards.
const source=readFileSync(new URL('../../src/finances/finances.js',import.meta.url),'utf8');
const start=source.indexOf('function financeMonthTimeline(rec) {');
const end=source.indexOf('function resetFinanceMonthSwipeVisual(',start);
assert.ok(start>=0&&end>start,'Finance timeline must exist');
const body=source.slice(start,end);
function render(person,record){
  const ctx={
    actor:()=>person,profile:()=>({futureBills:[]}),
    pendingFutureBillsForMonth:()=>[],ownMonths:()=>[],
    tripTimelineHtml:(groups,options)=>groups.map(g=>g.items.map(options.rowHtml).join('\n')).join('\n'),
    groupTone:x=>x,financeMonthDayLabel:x=>x||'No date',
    extraSourceShortLabel:x=>x,categoryLabel:x=>x,financeDateLabel:x=>x,
    normalizeGroup:x=>x,tripExpenseRowHtml:x=>JSON.stringify(x),
    financeMonthToneIcon:()=>'$',
    money:x=>'€'+x,esc:x=>String(x)
  };
  return new Function(...Object.keys(ctx),'rec',body+'\nreturn financeMonthTimeline(rec);')(...Object.values(ctx),record);
}
test('Principessa draft finance card with Extra opens',()=>{
  assert.match(render('Principessa',{month:'2026-11',finalized:false,
    expenses:[{name:'Extra',group:'extra',amount:50}]}),/Extra/);
});
test('Principessa locked finance card with Pay back opens',()=>{
  const html=render('Principessa',{month:'2026-11',finalized:true,
    expenses:[{name:'Extra',group:'extra',amount:50},
      {id:'allowance-payback:2026-11',name:'Pay back Extra',group:'other',amount:200}],
    allowanceSpends:[{id:'a',amount:25,date:'2026-11-01'}]});
  assert.match(html,/Self-debt repayment/);
  assert.match(html,/Pay back Extra/);
  assert.match(html,/Extra spending/);
});
test('Principe draft and locked Personal finance cards open',()=>{
  assert.match(render('Principe',{month:'2026-11',expenses:[
    {name:'Personal',group:'variable',amount:30},{name:'Rent',group:'fixed',amount:575}]
  }),/Rent/);
  assert.match(render('Principe',{month:'2026-11',finalized:true,expenses:[
    {name:'Personal',group:'variable',amount:30},
    {id:'allowance-payback:2026-11',name:'Pay back Personal',group:'other',amount:70}]
  }),/Self-debt repayment/);
});
test('Empty and income-only finance cards still render',()=>{
  assert.equal(render('Principessa',{month:'2026-11',expenses:[],incomes:[]}), '');
  assert.match(render('Principessa',{month:'2026-11',expenses:[],incomes:[
    {name:'Salary',amount:1000}
  ]}),/Salary/);
});
