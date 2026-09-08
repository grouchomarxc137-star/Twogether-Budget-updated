const assert=require('assert/strict');
const {backend}=require('./backend.cjs');

function submission(total,paid){return {location:'Italy',city:'Test',start:'2026-09-01',end:'2026-09-02',accom:0,groceries:0,eat:0,travel:0,fuel:0,tolls:0,other:total,otherNote:'',paid,uncertain:{}};}
function confirmedTrip(b,pBudget,qBudget,total,pPaid,qPaid,tag){
  const plan=b.post('savePlan',{meta:{location:'Italy',city:'Trip '+tag,start:'2026-09-01',end:'2026-09-02'},budget:pBudget},'Principessa');assert.equal(plan.ok,true);
  assert.equal(b.post('savePlan',{id:plan.planId,budget:qBudget},'Principe').ok,true);
  const t=b.post('savePlanSubmission',{planId:plan.planId,submission:submission(total,pPaid)},'Principessa');assert.equal(t.ok,true);
  assert.equal(b.post('savePlanSubmission',{planId:plan.planId,submission:submission(total,qPaid)},'Principe').ok,true);
  const rp=b.post('confirmTrip',{id:t.tripId},'Principessa');assert.equal(rp.ok,true);
  const rq=b.post('confirmTrip',{id:t.tripId},'Principe');assert.equal(rq.ok,true);
  return {planId:plan.planId,tripId:t.tripId,rp,rq};
}

// v26 Twos are deliberately not carried into the new budget-performance model.
const legacy=backend();legacy.seed({version:17,trips:[],plans:[],finances:{Principessa:[],Principe:[]},financeProfiles:{Principessa:{},Principe:{}},game:{Principessa:{lovis:7,twos:999,purchases:[],awards:{}},Principe:{lovis:2,twos:500,purchases:[],awards:{}},signals:[]},compare:{},audit:[]});
let state=legacy.state();assert.equal(state.version,18);assert.equal(state.game.Principessa.lovis,7);assert.equal(state.game.Principessa.twos,0);assert.equal(state.game.Principessa.twosModel,'budget-v27');

const b=backend();
// Trip 1: Principessa €500 budget and €450 paid -> +50 Twos.
let one=confirmedTrip(b,500,450,900,450,450,'under');assert.equal(one.rp.twosDelta,50);assert.equal(one.rq.twosDelta,0);assert.equal(b.state().game.Principessa.twos,50);
// Trip 2: Principessa €600 budget and €700 paid -> -100 Twos. Net -50.
let two=confirmedTrip(b,600,700,1400,700,700,'over');assert.equal(two.rp.twosDelta,-100);assert.equal(b.state().game.Principessa.twos,-50);
// A repeated confirmation is a no-op settlement.
let repeat=b.post('confirmTrip',{id:two.tripId},'Principessa');assert.equal(repeat.ok,true);assert.equal(repeat.twosDelta,0);assert.equal(b.state().game.Principessa.twos,-50);

// Monthly leftover is added/subtracted directly as Twos.
let month=b.post('saveFinanceMonth',{monthData:{month:'2026-10',incomes:[{name:'Income',amount:1000}],expenses:[{group:'rent',name:'Rent',amount:570}],extraBudget:250,extraSpends:[],finalized:true}},'Principessa');assert.equal(month.ok,true);assert.equal(month.twosDelta,180);assert.equal(b.state().game.Principessa.twos,130);
month=b.post('saveFinanceMonth',{monthData:{month:'2026-11',incomes:[{name:'Income',amount:1000}],expenses:[{group:'rent',name:'Rent',amount:825}],extraBudget:250,extraSpends:[],finalized:true}},'Principessa');assert.equal(month.ok,true);assert.equal(month.twosDelta,-75);assert.equal(b.state().game.Principessa.twos,55);

// Expenses now reward Lovis, never Twos; old daily/session reward kinds are rejected.
let reward=b.post('shopAward',{kind:'expense',key:'expense:unique'},'Principessa');assert.equal(reward.ok,true);assert.equal(reward.awarded,2);assert.equal(reward.currency,'lovis');assert.equal(b.state().game.Principessa.twos,55);
assert.equal(b.post('shopAward',{kind:'daily',key:'old-daily'},'Principessa').ok,false);assert.equal(b.post('shopAward',{kind:'session',key:'old-session'},'Principessa').ok,false);

// New Wishlist goal earns 3 Lovis. Checkout spends Twos and earns 5 Lovis.
let fp={bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],compareLab:{},wishlist:[{id:'wish-headphones',name:'Headphones',price:40,note:'Cute pair',priority:2,createdAt:'2026-09-08T00:00:00Z'}]};
let saved=b.post('saveFinanceProfile',{profile:fp},'Principessa');assert.equal(saved.ok,true);assert.equal(saved.wishlistAwarded,3);let beforeCheckout=b.state().game.Principessa.lovis;assert.equal(beforeCheckout,5);
let checkout=b.post('wishlistCheckout',{ids:['wish-headphones']},'Principessa');assert.equal(checkout.ok,true);assert.equal(checkout.spentTwos,40);assert.equal(b.state().game.Principessa.twos,15);assert.equal(b.state().game.Principessa.lovis,10);assert.ok(b.state().financeProfiles.Principessa.wishlist[0].unlockedAt);
let duplicate=b.post('wishlistCheckout',{ids:['wish-headphones']},'Principessa');assert.equal(duplicate.ok,false,'earned Wishlist item cannot be bought twice');

// Custom comparison: +4 first side, then +4 +6 when the pair becomes meaningful.
let lab={id:'compare-trip-options',titleA:'Train + hotel',titleB:'Drive + apartment',rowsA:[{id:'a1',name:'Train',amount:90}],rowsB:[{id:'b1',name:'Fuel',amount:''}]};
let cmp=b.post('saveCompareLab',{lab,side:'A'},'Principessa');assert.equal(cmp.ok,true);assert.equal(cmp.awarded,4);assert.equal(cmp.compareCompleteAwarded,false);
lab.rowsB[0].amount=120;cmp=b.post('saveCompareLab',{lab,side:'B'},'Principessa');assert.equal(cmp.ok,true);assert.equal(cmp.awarded,10);assert.equal(cmp.compareCompleteAwarded,true);
cmp=b.post('saveCompareLab',{lab,side:'B'},'Principessa');assert.equal(cmp.awarded,0,'comparison rewards are deduped');

// Removed v26 rewards are gone; retained/new rewards still purchase with Lovis.
b.post('shopSync',{local:{lovis:500,twos:9999,twosModel:'budget-v27',purchases:[],awards:{}}},'Principessa');assert.equal(b.post('shopPurchase',{id:'gold-heart'},'Principessa').ok,false);assert.equal(b.post('shopPurchase',{id:'cute-icons'},'Principessa').ok,false);assert.equal(b.post('shopPurchase',{id:'trip-planner-plus'},'Principessa').ok,false);assert.equal(b.post('shopPurchase',{id:'date-night-jar'},'Principessa').ok,true);assert.equal(b.post('shopPurchase',{id:'world-map'},'Principessa').ok,true);

console.log('v27 backend: signed Twos settlements, Lovis activity rewards, Wishlist checkout, comparison rewards and revised catalog passed.');
