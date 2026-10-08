import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';
import { openDatabase } from '../src/db/index.js';
import { billOccurrenceDate, dueFutureBills, pendingFutureBillsForMonth } from '../../src/finances/future-bills.js';

function setup() {
  const directory=mkdtempSync(join(tmpdir(),'twogether-future-bills-'));
  const database=openDatabase(join(directory,'test.sqlite'));
  configureStateStore(database.store);
  return {
    database,
    cleanup() { database.close(); rmSync(directory,{recursive:true,force:true}); }
  };
}
function action(db,name,payload,actor='Principessa') {
  return db.db.transaction(()=>runAction(name,payload,actor))();
}
const insurance={id:'insurance-2027',name:'Car insurance',amount:500,date:'2027-10-15',repeat:'yearly',group:'fixed'};

test('future bills are separate from expenses until marked paid',()=>{
  const context=setup();
  try {
    assert.equal(action(context.database,'saveFinanceProfile',{profile:{futureBills:[insurance]}}).ok,true);
    const state=getState();
    assert.equal(state.financeProfiles.Principessa.futureBills[0].date,'2027-10-15');
    assert.deepEqual(state.finances.Principessa,[]);
    assert.equal(pendingFutureBillsForMonth(state.financeProfiles.Principessa.futureBills,'2027-10',state.finances.Principessa).length,1);
    assert.equal(pendingFutureBillsForMonth(state.financeProfiles.Principessa.futureBills,'2027-09',state.finances.Principessa).length,0);
    assert.equal(dueFutureBills(state.financeProfiles.Principessa.futureBills,'2027-10-14',state.finances.Principessa).length,0);
    assert.equal(dueFutureBills(state.financeProfiles.Principessa.futureBills,'2027-10-15',state.finances.Principessa).length,1);
  } finally { context.cleanup(); }
});

test('confirmation creates a single editable expense and repeats yearly',()=>{
  const context=setup();
  try {
    assert.equal(action(context.database,'saveFinanceProfile',{profile:{futureBills:[insurance]}}).ok,true);
    const first=action(context.database,'confirmFutureBill',{billId:insurance.id,dueDate:'2027-10-15',paidDate:'2027-10-18',amount:525});
    assert.equal(first.ok,true);
    assert.equal(first.monthData.partialOnly,true);
    assert.equal(first.monthData.expenses.length,1);
    assert.equal(first.monthData.expenses[0].amount,525);
    assert.equal(first.monthData.expenses[0].date,'2027-10-18');
    assert.equal(first.monthData.expenses[0].futureBillId,insurance.id);
    assert.equal(first.monthData.expenses[0].futureBillDueDate,'2027-10-15');
    const duplicate=action(context.database,'confirmFutureBill',{billId:insurance.id,dueDate:'2027-10-15'});
    assert.equal(duplicate.alreadyPaid,true);
    assert.equal(getState().finances.Principessa.find((item)=>item.month==='2027-10').expenses.length,1);
    assert.equal(pendingFutureBillsForMonth(getState().financeProfiles.Principessa.futureBills,'2027-10',getState().finances.Principessa).length,0);
    assert.equal(pendingFutureBillsForMonth(getState().financeProfiles.Principessa.futureBills,'2028-10',getState().finances.Principessa).length,1);
    const second=action(context.database,'confirmFutureBill',{billId:insurance.id,dueDate:'2028-10-15'});
    assert.equal(second.ok,true);
    assert.equal(getState().finances.Principessa.length,2);
    const edited=action(context.database,'saveFinanceMonth',{monthData:{...first.monthData,expenses:first.monthData.expenses.map((expense)=>({...expense,amount:530}))}});
    assert.equal(edited.ok,true);
    assert.equal(getState().finances.Principessa.find((item)=>item.month==='2027-10').expenses[0].futureBillId,insurance.id);
  } finally { context.cleanup(); }
});

test('deleted payment returns pending, locked months and other actors cannot be charged',()=>{
  const context=setup();
  try {
    assert.equal(action(context.database,'saveFinanceProfile',{profile:{futureBills:[insurance]}}).ok,true);
    assert.equal(action(context.database,'confirmFutureBill',{billId:insurance.id,dueDate:'2026-10-15'}).ok,false);
    assert.equal(action(context.database,'confirmFutureBill',{billId:insurance.id,dueDate:'2027-10-15'},'Principe').ok,false);
    const first=action(context.database,'confirmFutureBill',{billId:insurance.id,dueDate:'2027-10-15'});
    assert.equal(first.ok,true);
    assert.equal(action(context.database,'saveFinanceMonth',{monthData:{...first.monthData,expenses:[]}}).ok,true);
    assert.equal(pendingFutureBillsForMonth(getState().financeProfiles.Principessa.futureBills,'2027-10',getState().finances.Principessa).length,1);
    const locked=action(context.database,'saveFinanceMonth',{monthData:{...getState().finances.Principessa[0],finalized:true}});
    assert.equal(locked.ok,true);
    assert.equal(action(context.database,'confirmFutureBill',{billId:insurance.id,dueDate:'2027-10-15'}).ok,false);
  } finally { context.cleanup(); }
});

test('yearly leap-day future bill rolls to February 28 on non-leap years',()=>{
  const leap={id:'leap',name:'Leap renewal',date:'2028-02-29',amount:50,group:'fixed',repeat:'yearly'};
  assert.equal(billOccurrenceDate(leap,2028),'2028-02-29');
  assert.equal(billOccurrenceDate(leap,2029),'2029-02-28');
  assert.equal(billOccurrenceDate({...leap,repeat:'none'},2029),'');
});
