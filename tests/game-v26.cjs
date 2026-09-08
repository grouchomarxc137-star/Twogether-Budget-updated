const assert=require('assert/strict');
const {backend}=require('./backend.cjs');

const b=backend();
let s=b.state();
assert.ok(s.game,'shared game state exists');
assert.equal(s.game.Principessa.lovis,0);assert.equal(s.game.Principessa.twos,0);

let r=b.post('shopAward',{kind:'daily',key:'daily:Principessa:2026-09-08'},'Principessa');
assert.equal(r.ok,true);assert.equal(r.awarded,200);assert.equal(r.currency,'twos');
r=b.post('shopAward',{kind:'daily',key:'daily:Principessa:2026-09-08'},'Principessa');
assert.equal(r.awarded,0,'daily award is deduped');

r=b.post('shopAward',{kind:'expense',key:'plan-a:groceries:Principessa'},'Principessa');assert.equal(r.awarded,100);
r=b.post('shopAward',{kind:'expense',key:'plan-a:groceries:Principessa'},'Principessa');assert.equal(r.awarded,0,'same expense is not farmable');
r=b.post('shopAward',{kind:'session',key:'session:Principessa:2026-09-08'},'Principessa');assert.equal(r.awarded,400);
r=b.post('shopAward',{kind:'session',key:'session:Principessa:2026-09-08'},'Principessa');assert.equal(r.awarded,0,'30-minute daily session is deduped');
r=b.post('shopAward',{kind:'log',key:'plan:one'},'Principessa');assert.equal(r.awarded,5);
r=b.post('shopAward',{kind:'tripConfirm',key:'trip:Principessa:one'},'Principessa');assert.equal(r.awarded,10);
r=b.post('shopAward',{kind:'financeConfirm',key:'month:Principessa:2026-09'},'Principessa');assert.equal(r.awarded,15);

s=b.state();assert.equal(s.game.Principessa.twos,700);assert.equal(s.game.Principessa.lovis,30);
assert.equal(b.post('shopPurchase',{id:'soft-sparkles'},'Principessa').ok,false,'cannot overspend Twos');
for(let i=0;i<5;i++)b.post('shopAward',{kind:'expense',key:`bonus:${i}`},'Principessa');
r=b.post('shopPurchase',{id:'flying-heart'},'Principessa');assert.equal(r.ok,true);assert.ok(r.game.Principessa.purchases.includes('flying-heart'));assert.equal(r.game.Principessa.twos,0);

r=b.post('shopSendSignal',{type:'heart'},'Principessa');assert.equal(r.ok,true);let heart=r.game.signals.at(-1);assert.equal(heart.from,'Principessa');assert.equal(heart.to,'Principe');assert.equal(heart.type,'heart');assert.equal(heart.seenAt,'');
r=b.post('shopMarkSignalsSeen',{},'Principe');assert.equal(r.ok,true);assert.ok(r.game.signals.at(-1).seenAt);

// Sync migrates old/local Lovis without reducing a shared balance.
r=b.post('shopSync',{local:{lovis:45,twos:250,purchases:['gold-heart'],awards:{logs:['legacy-plan']}}},'Principe');assert.equal(r.ok,true);assert.equal(r.game.Principe.lovis,45);assert.equal(r.game.Principe.twos,250);assert.ok(r.game.Principe.purchases.includes('gold-heart'));

console.log('v26 backend: Lovis/Twos awards, dedupe, purchase guard, shared scoreboard state and partner signal flow passed.');
