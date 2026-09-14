const assert=require('assert/strict');
const {backend}=require('./backend.cjs');

function run(){
  const b=backend();
  assert.equal(b.state().sharedJar.balance,870,'Shared Jar starts at €870');
  const plan=b.post('savePlan',{meta:{location:'Italy',city:'Desenzano',start:'2026-10-03',end:'2026-10-10'},budget:600},'Principessa');
  assert.equal(plan.ok,true);
  const id=plan.planId;

  let r=b.post('saveAccommodationExpense',{planId:id,total:500,useJar:true,paymentType:'shared',paidUpfront:true},'Principessa');
  assert.equal(r.ok,true);
  assert.equal(r.sharedExpense.accommodation.jarContribution,100);
  assert.equal(r.sharedExpense.accommodation.remaining,400);
  assert.equal(r.sharedExpense.accommodation.shareEach,200);
  assert.equal(r.sharedExpense.accommodation.repayment.debtor,'Principe');
  assert.equal(r.sharedExpense.accommodation.repayment.creditor,'Principessa');
  assert.equal(r.sharedExpense.accommodation.repayment.amount,200);
  assert.equal(r.sharedExpense.accommodation.repayment.status,'pending');
  assert.equal(r.sharedJar.balance,770);

  r=b.post('saveAccommodationExpense',{planId:id,total:600,useJar:true,paymentType:'shared',paidUpfront:true},'Principessa');
  assert.equal(r.ok,true);assert.equal(r.sharedJar.balance,750,'editing same trip replaces, not doubles, the Jar transaction');
  assert.equal(r.sharedExpense.accommodation.jarContribution,120);assert.equal(r.sharedExpense.accommodation.shareEach,240);

  r=b.post('confirmAccommodationRepayment',{planId:id,paidBack:true},'Principe');
  assert.equal(r.ok,true);assert.equal(r.sharedExpense.accommodation.repayment.status,'confirmed');
  assert.ok(r.sharedExpense.accommodation.repayment.confirmedAt);

  const solo=b.post('savePlan',{meta:{location:'Netherlands',city:'Tilburg',start:'2026-11-01',end:'2026-11-02'},budget:300},'Principe');
  r=b.post('saveAccommodationExpense',{planId:solo.planId,total:200,useJar:false,paymentType:'solo',paidUpfront:false},'Principe');
  assert.equal(r.ok,true);assert.equal(r.sharedExpense.accommodation.repayment.status,'none');assert.equal(r.sharedExpense.paid.Principe,200);

  r=b.post('saveTripPrep',{planId:id,prep:{packing:[{id:'p1',text:'Toothbrushes',done:true},{id:'p2',text:'Slippers',done:false}],reminders:[{id:'r1',text:'Take pictures of the Airbnb',done:false}]}},'Principessa');
  assert.equal(r.ok,true);assert.equal(r.prep.packing.length,2);assert.equal(r.prep.packing[0].done,true);assert.equal(b.state().plans.find(p=>p.id===id).prep.reminders[0].text,'Take pictures of the Airbnb');

  r=b.post('saveFinancePlanning',{month:'2026-09',planning:{openingSavings:6094.61,items:[
    {id:'salary',name:'Salary',kind:'income',group:'other',planner:1500,actual:1255,frequency:'monthly',paymentTiming:'',notes:'Usually €1,350–€1,600'},
    {id:'rent',name:'Rent',kind:'expense',group:'rent',planner:575,actual:575,frequency:'monthly',paymentTiming:'',notes:''},
    {id:'insurance',name:'Insurance',kind:'expense',group:'other',planner:600,actual:'',frequency:'yearly',paymentTiming:'later',notes:'Due yearly'}
  ]}},'Principe');
  assert.equal(r.ok,true);assert.equal(r.planning.openingSavings,6094.61);const insurance=r.planning.items.find(x=>x.name==='Insurance');assert.equal(insurance.reserveMonthly,50);assert.equal(insurance.actual,'');
  const month=b.state().finances.Principe.find(x=>x.month==='2026-09');assert.equal(month.incomes.find(x=>x.name==='Salary').amount,1255);assert.equal(month.expenses.find(x=>x.name==='Rent').amount,575);assert.equal(month.expenses.some(x=>x.name==='Insurance'),false,'yearly reserve is not falsely stored as Actual expense');

  console.log('v33 backend: Shared Jar, accommodation repayment, trip prep and Planner/Actual reserve checks passed.');
}
if(require.main===module)run();
