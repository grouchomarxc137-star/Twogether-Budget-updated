import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmedPieCategories } from '../../src/trips/confirmed-spend.js';

const entry=(transportType,amount,paidBy='both')=>({
  id:transportType,category:'transport',transportType,amount,paidBy,date:'2025-10-18'
});

test('confirmed spending groups Car exactly once and renames Flights/Train to Transport',()=>{
  const rows=[{label:'Accommodation',amount:330},{label:'Flights / Train',amount:62.54},{label:'Car',amount:75}];
  const pie=confirmedPieCategories(rows,{expenseEntries:[entry('fuel',40),entry('tolls',35)]},{snapshot:{fuel:40,tolls:35}});
  assert.deepEqual(pie.categories.map(x=>x.label),['Accommodation','Car','Transport']);
  assert.equal(pie.categories.find(x=>x.car).amount,75);
  assert.equal(pie.categories.reduce((sum,row)=>sum+row.amount,0),467.54);
  assert.deepEqual(pie.carGroups.map(x=>x.label),['Fuel','Tolls']);
  assert.equal(pie.hasCarBreakdown,true);
});

test('one Car subtype is labeled Tolls directly, and remains correct in both personal views',()=>{
  const entries=[entry('tolls',18,'Principe'),entry('tolls',25,'Principessa')];
  const full=confirmedPieCategories([{label:'Car',amount:43}],{expenseEntries:entries},{snapshot:{fuel:0,tolls:43}});
  assert.deepEqual(full.categories,[{label:'Tolls',amount:43,car:true}]);
  assert.equal(full.hasCarBreakdown,false);
  for(const [person,amount] of [['Principe',18],['Principessa',25]]){
    const pie=confirmedPieCategories([{label:'Car',amount}],{expenseEntries:entries},{person});
    assert.equal(pie.categories[0].label,'Tolls');
    assert.equal(pie.categories[0].amount,amount);
  }
});

test('Car drilldown has only spent types and avoids double-counting saved snapshots',()=>{
  const entries=[entry('fuel',40),entry('tolls',22),entry('parking',13),entry('car-other',5)];
  const pie=confirmedPieCategories([{label:'Car',amount:80}],{expenseEntries:entries},{snapshot:{fuel:40,tolls:40}});
  assert.equal(pie.carGroups.length,4);
  assert.deepEqual(pie.carGroups.map(x=>x.label),['Fuel','Tolls','Parking','Other']);
  assert.equal(pie.carGroups.reduce((sum,row)=>sum+row.amount,0),80);
  assert.equal(pie.categories[0].amount,80);
});

test('older confirmed trip snapshot can still show known Car types without itemized entries',()=>{
  const pie=confirmedPieCategories([
    {label:'Travel',amount:62.54},{label:'Fuel',amount:45},{label:'Tolls / Parking',amount:10}
  ],null,{snapshot:{fuel:45,tolls:10}});
  assert.equal(pie.categories.find(x=>x.label==='Transport').amount,62.54);
  assert.equal(pie.categories.find(x=>x.label==='Car').amount,55);
  assert.equal(pie.carGroups.length,2);
  assert.equal(pie.carGroups.reduce((sum,row)=>sum+row.amount,0),55);
  const fuelOnly=confirmedPieCategories([{label:'Car',amount:45}],null,{snapshot:{fuel:45,tolls:0}});
  assert.equal(fuelOnly.categories[0].label,'Fuel');
});

test('when itemized Tolls and an old snapshot disagree, the confirmed amount is not duplicated',()=>{
  const pie=confirmedPieCategories([{label:'Car',amount:40}],{
    expenseEntries:[entry('tolls',40)]
  },{snapshot:{fuel:40,tolls:0}});
  assert.equal(pie.categories[0].label,'Tolls');
  assert.equal(pie.carGroups.reduce((sum,row)=>sum+row.amount,0),40);
});
