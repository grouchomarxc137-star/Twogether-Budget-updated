const {chromium}=require(process.env.TWOGETHER_PLAYWRIGHT||'playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {backend}=require('./backend.cjs');

(async()=>{
const b=backend();
// Seed a realistic current trip without creating frontend reward history.
const p=b.post('savePlan',{meta:{location:'Italy',city:'Lonato',start:'2026-09-03',end:'2026-09-04'},budget:300},'Principessa');
b.post('savePlan',{id:p.planId,budget:234},'Principe');
b.post('saveSharedExpense',{planId:p.planId,key:'accom',total:200,mode:'shared',paid:100},'Principessa');
b.post('saveSharedExpense',{planId:p.planId,key:'accom',total:200,mode:'shared',paid:100},'Principe');
b.post('saveSharedExpense',{planId:p.planId,key:'travel',total:120,mode:'shared',paid:60},'Principessa');
b.post('saveSharedExpense',{planId:p.planId,key:'travel',total:120,mode:'shared',paid:60},'Principe');
b.post('savePlanPartial',{planId:p.planId,partial:{groceries:20,eat:50}},'Principessa');
b.post('savePlanPartial',{planId:p.planId,partial:{groceries:20,eat:30}},'Principe');

const server=http.createServer((req,res)=>{let name=decodeURIComponent(req.url.split('?')[0]);if(name==='/')name='/index.html';const file=path.join(process.cwd(),name);if(!file.startsWith(process.cwd()))return res.writeHead(403).end();try{const data=fs.readFileSync(file);res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.TWOGETHER_BROWSER||undefined,headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://script.google.com/**',async route=>{const req=route.request();if(req.method()==='POST'){const q=new URLSearchParams(req.postData()),result=b.post(q.get('action'),JSON.parse(q.get('payload')),q.get('actor'));await route.fulfill({contentType:'text/html',body:`<script>window.top.postMessage(${JSON.stringify({type:'twogether:saved',requestId:q.get('requestId'),result})},'*')</script>`});}else{const u=new URL(req.url()),cb=u.searchParams.get('callback');await route.fulfill({contentType:'application/javascript',body:cb+'('+JSON.stringify({ok:true,state:b.state()})+')'});}});
await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));await page.route('https://fonts.gstatic.com/**',r=>r.abort());await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"></svg>'}));await page.route('https://images.unsplash.com/**',r=>r.abort());await page.route('https://upload.wikimedia.org/**',r=>r.abort());
await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.identity-choice[data-actor="Principessa"]').click();await page.locator('#shopHub').waitFor({timeout:15000});
await page.waitForFunction(()=>window.TwogetherShop?.getState?.().awards?.daily?.length===1,{timeout:12000});
assert.equal(await page.locator('#twDevToggle:visible').count(),0,'DEV remains unavailable');
let game=await page.evaluate(()=>window.TwogetherShop.getState());assert.equal(game.twos,200,'daily visit earns 200 Twos');assert.equal(game.lovis,0);

// Horizontal Current Trip design and non-table budget strip.
const card=page.locator('#twCurrentTrips .tw-current-card').first();await card.waitFor({timeout:12000});await page.waitForTimeout(500);
const geo=await card.evaluate(el=>{const c=el.getBoundingClientRect(),art=el.querySelector('.tw-trip-art').getBoundingClientRect(),main=el.querySelector('.tw-current-main').getBoundingClientRect(),nums=el.querySelector('.tw-current-numbers'),ns=getComputedStyle(nums),lefts=[...nums.children].map(x=>Math.round(x.getBoundingClientRect().left));return {w:c.width,h:c.height,artX:art.x,mainX:main.x,artW:art.width,display:getComputedStyle(el).display,numBorder:ns.borderTopWidth,numSides:[ns.borderLeftWidth,ns.borderRightWidth,ns.borderBottomWidth],lefts};});
assert.ok(geo.w>800&&geo.h<300,'desktop current trip is a wide compact card');assert.ok(geo.artX<geo.mainX&&geo.artW<180,'trip image sits to the left of content');assert.equal(new Set(geo.lefts).size,4,'four metrics sit across one row');assert.deepEqual(geo.numSides,['0px','0px','0px'],'budget summary has no outer box');

// Screenshot-inspired overview keeps matching logic and accommodation 20% calculation.
await card.locator('[data-current-open]').click();const dialog=page.locator('dialog.current-overview');await dialog.waitFor({timeout:8000});
const overviewText=await dialog.innerText();assert.match(overviewText,/ITALY/i);assert.match(overviewText,/Lonato/);assert.match(overviewText,/20% = €40\.00/);assert.match(overviewText,/Shared payments/);assert.equal(await dialog.locator('.overview-payment').count(),2);assert.ok(await dialog.locator('.overview-match.matched').count()>=1);assert.ok(await dialog.locator('.overview-match.different').count()>=1);
await dialog.locator('[data-overview-close]').click();

// Logging one new expense gives +5 Lovis and +100 Twos, but editing it again does not farm either.
await page.evaluate(id=>window.TwogetherAPI.post('savePlanPartial',{planId:id,partial:{fuel:10}},'Principessa'),p.planId);await page.waitForTimeout(350);
game=await page.evaluate(()=>window.TwogetherShop.getState());assert.equal(game.lovis,5);assert.equal(game.twos,300);
await page.evaluate(id=>window.TwogetherAPI.post('savePlanPartial',{planId:id,partial:{fuel:12}},'Principessa'),p.planId);await page.waitForTimeout(350);
game=await page.evaluate(()=>window.TwogetherShop.getState());assert.equal(game.lovis,5,'same partial log does not farm Lovis');assert.equal(game.twos,300,'same expense category does not farm Twos');

// Simulate reaching 30 visible minutes without making the test wait 30 minutes.
await page.evaluate(()=>{const d=new Date(),pad=n=>String(n).padStart(2,'0'),day=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;sessionStorage.setItem(`twogether_session_v26:Principessa:${day}`,'1800000');document.dispatchEvent(new Event('visibilitychange'));});
await page.waitForFunction(()=>window.TwogetherShop.getState().twos>=700,{timeout:8000});game=await page.evaluate(()=>window.TwogetherShop.getState());assert.equal(game.twos,700,'30-minute active session earns 400 Twos');
await page.reload();await page.waitForFunction(()=>window.TwogetherShop?.getState?.().awards?.daily?.length===1,{timeout:12000});assert.equal(await page.evaluate(()=>window.TwogetherShop.getState().twos),700,'daily reload does not farm daily or session Twos');

// Shop: dual wallet, scoreboard, Twos rewards and Principessa-only safe test mode.
await page.locator('#shopHub').click();await page.locator('#shopView').waitFor();const text=await page.locator('#shopView').innerText();assert.match(text,/Lovis/);assert.match(text,/Twos/);assert.match(text,/\+100 Twos/);assert.match(text,/\+200 Twos/);assert.match(text,/\+400 Twos/);assert.match(text,/Twogether scoreboard/);assert.match(text,/Principessa/);assert.match(text,/Principe/);assert.equal(await page.locator('.shop-test').count(),1);
await page.locator('[data-test-start]').click();await page.waitForTimeout(100);assert.match(await page.locator('#shopView').innerText(),/TEST MODE ACTIVE/);assert.match(await page.locator('#shopView').innerText(),/5,700/);
await page.locator('[data-test-all]').click();await page.locator('[data-send-heart]').click();await page.locator('#flyingMessage.show').waitFor({timeout:3000});assert.match(await page.locator('#flyingMessage').innerText(),/thinking about you/i);await page.locator('#flyingMessage button').click();
await page.locator('[data-send-note]').click();await page.locator('#flyingNoteText').fill('Thinking of you from the test lab');await page.locator('#sendFlyingNote').click();await page.locator('#flyingMessage.show').waitFor({timeout:3000});assert.match(await page.locator('#flyingMessage').innerText(),/Thinking of you from the test lab/);await page.locator('#flyingMessage button').click();
await page.locator('[data-test-end]').click();assert.equal((await page.evaluate(()=>window.TwogetherShop.getState().purchases.includes('flying-heart'))),false,'test unlocks never become real purchases');

await page.locator('#loggedUserBadge').click();await page.waitForTimeout(500);await page.locator('#shopHub').click();assert.equal(await page.locator('.shop-test').count(),0,'Principessa test lab is not shown for Principe');
assert.deepEqual(errors,[]);console.log('Browser v26: horizontal trips, refined overview/20%, Lovis+Twos, daily/session/expense dedupe, scoreboard and safe social previews passed.');
await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1);});
