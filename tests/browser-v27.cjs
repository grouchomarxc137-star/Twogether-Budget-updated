const {chromium}=require(process.env.TWOGETHER_PLAYWRIGHT||'playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {backend}=require('./backend.cjs');

(async()=>{
const b=backend();
// Seed one realistic current plan for layout/overview without using the frontend reward wrapper.
const p=b.post('savePlan',{meta:{location:'Italy',city:'Lonato',start:'2026-09-29',end:'2026-09-30'},budget:300},'Principessa');
b.post('savePlan',{id:p.planId,budget:234},'Principe');
b.post('saveSharedExpense',{planId:p.planId,key:'accom',total:200,mode:'full',paid:200},'Principessa');
b.post('savePlanPartial',{planId:p.planId,partial:{groceries:20,eat:50}},'Principessa');
b.post('savePlanPartial',{planId:p.planId,partial:{groceries:20,eat:30}},'Principe');
// Give Principessa 100 Twos through the new real monthly-leftover model, and seed one wish.
b.post('saveFinanceMonth',{monthData:{month:'2026-08',incomes:[{name:'Income',amount:500}],expenses:[{group:'rent',name:'Rent',amount:150}],extraBudget:250,extraSpends:[],finalized:true}},'Principessa');
b.post('saveFinanceProfile',{profile:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],compareLab:{},wishlist:[{id:'wish-bag',name:'Weekend bag',price:40,note:'For little trips together',priority:2,createdAt:'2026-09-08T00:00:00Z'}]}},'Principessa');

const server=http.createServer((req,res)=>{let name=decodeURIComponent(req.url.split('?')[0]);if(name==='/')name='/index.html';const file=path.join(process.cwd(),name);if(!file.startsWith(process.cwd()))return res.writeHead(403).end();try{const data=fs.readFileSync(file);res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.TWOGETHER_BROWSER||undefined,headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://script.google.com/**',async route=>{const req=route.request();if(req.method()==='POST'){const q=new URLSearchParams(req.postData()),result=b.post(q.get('action'),JSON.parse(q.get('payload')),q.get('actor'));await route.fulfill({contentType:'text/html',body:`<script>window.top.postMessage(${JSON.stringify({type:'twogether:saved',requestId:q.get('requestId'),result})},'*')</script>`});}else{const u=new URL(req.url()),cb=u.searchParams.get('callback');await route.fulfill({contentType:'application/javascript',body:cb+'('+JSON.stringify({ok:true,state:b.state()})+')'});}});
await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));await page.route('https://fonts.gstatic.com/**',r=>r.abort());await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"></svg>'}));await page.route('https://images.unsplash.com/**',r=>r.abort());await page.route('https://upload.wikimedia.org/**',r=>r.abort());
await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.identity-choice[data-actor="Principessa"]').click();
await page.waitForFunction(()=>window.TwogetherV27&&document.querySelector('#twCurrentTrips .tw-current-card'),{timeout:15000});await page.waitForTimeout(1100);
assert.equal(await page.locator('#twDevToggle:visible').count(),0,'DEV stays removed from the live UI');

// Current Trips now share the hero workspace with the wizard and use destination imagery as card atmosphere.
await page.waitForFunction(()=>document.querySelector('#twCurrentTripsSection')?.parentElement?.classList.contains('v27-trip-workspace'),{timeout:8000});
const layout=await page.evaluate(()=>{const grid=document.querySelector('#log .hero-grid'),w=document.querySelector('#wizardCard'),s=document.querySelector('#twCurrentTripsSection'),c=document.querySelector('#twCurrentTrips .tw-current-card'),art=c.querySelector('.tw-trip-art'),wr=w.getBoundingClientRect(),sr=s.getBoundingClientRect(),cr=c.getBoundingClientRect(),cs=getComputedStyle(c),as=getComputedStyle(art);return {grid:grid.className,wx:wr.x,sx:sr.x,sw:sr.width,cw:cr.width,ch:cr.height,bg:cs.backgroundImage,artW:parseFloat(as.width),artOpacity:as.opacity};});
assert.match(layout.grid,/v27-trip-workspace/);assert.ok(layout.wx<layout.sx,'wizard is left of Current Trips on desktop');assert.ok(layout.sw>500&&layout.ch<260,'Current Trip side is compact');assert.match(layout.bg,/linear-gradient/i);assert.ok(layout.artW<=2&&Number(layout.artOpacity)===0,'separate image tile is visually replaced by card background');

// Plan a trip must really invoke the existing wizard reset/new-trip flow.
await page.evaluate(()=>{window.__planReset=0;document.querySelector('#restartWizard').addEventListener('click',()=>window.__planReset++);});
await page.locator('#twCurrentTripsSection [data-v18-new-trip]').click();await page.waitForTimeout(180);assert.ok(await page.evaluate(()=>window.__planReset)>=1,'Plan a trip invokes the trip wizard');assert.ok(await page.locator('#wizardCard').isVisible());

// Current-trip overview: larger readable type, narrower Match column, proper Accommodation icon, 20% retained.
await page.locator('#twCurrentTrips .tw-current-card').first().locator('[data-current-open]').click();const dialog=page.locator('dialog.current-overview');await dialog.waitFor({timeout:5000});
const overviewText=await dialog.innerText();assert.match(overviewText,/20% = €40\.00/);assert.match(overviewText,/Shared payments/);
const ov=await dialog.evaluate(d=>{const th=[...d.querySelectorAll('.overview-table thead th')],cells=[...d.querySelectorAll('.overview-table tbody tr:first-child>*')],pay=d.querySelector('.overview-payment[data-kind="accom"]'),pstyle=getComputedStyle(pay,'::before');return {headers:th.map(x=>x.getBoundingClientRect().width),font:parseFloat(getComputedStyle(cells[1]).fontSize),metric:parseFloat(getComputedStyle(d.querySelector('.overview-metrics strong')).fontSize),payFont:parseFloat(getComputedStyle(pay.querySelector('p')).fontSize),icon:pstyle.backgroundImage,content:pstyle.content};});
assert.ok(ov.headers[3]<ov.headers[1]&&ov.headers[3]<ov.headers[2],'Match column is narrower');assert.ok(ov.font>=11.5&&ov.metric>=15&&ov.payFont>=11,'overview typography is larger');assert.notEqual(ov.icon,'none','Accommodation has a real icon');
await dialog.locator('[data-overview-close]').click();

// Monthly table: denser rows but larger text.
await page.evaluate(()=>document.querySelector('.trip-subnav [data-sheet="monthly"]').click());await page.waitForTimeout(250);const monthCell=page.locator('#monthly #monthlyBody tr').first().locator('td').first();await monthCell.waitFor();const monthGeo=await monthCell.evaluate(el=>({font:parseFloat(getComputedStyle(el).fontSize),h:el.getBoundingClientRect().height,pad:getComputedStyle(el).paddingTop}));assert.ok(monthGeo.font>=11&&monthGeo.h<45,'monthly breakdown is readable and compact');

// Custom comparison lab: two editable scenarios, totals/verdict and Lovis rewards.
await page.evaluate(()=>document.querySelector('.trip-subnav [data-sheet="compare"]').click());const lab=page.locator('#v27CompareLab');await lab.waitFor();assert.equal(await lab.locator('.v27-scenario').count(),2);
const cards=lab.locator('.v27-scenario');await cards.nth(0).locator('.v27-scenario-title').fill('Train + Hotel');await cards.nth(0).locator('[data-row-amount]').first().fill('90');await cards.nth(0).locator('[data-save-scenario]').click();await page.waitForTimeout(450);
await cards.nth(1).locator('.v27-scenario-title').fill('Drive + Airbnb');await cards.nth(1).locator('[data-row-amount]').first().fill('120');await cards.nth(1).locator('[data-save-scenario]').click();await page.waitForTimeout(550);
assert.match(await page.locator('#v27CompareVerdict').innerText(),/Train \+ Hotel is cheaper/i);assert.match(await page.locator('#v27CompareVerdict').innerText(),/€30\.00/);let game=await page.evaluate(()=>window.TwogetherV27.getState().profile);assert.ok(game.lovis>=17,'Wishlist seed + comparison rewards create Lovis');

// Wishlist is a Twos-based product/cart experience, not a table. Priority filtering and fake checkout work.
await page.evaluate(()=>document.querySelector('.finance-subnav [data-fin-subview="wishlist"]').click());await page.locator('#finances.active').waitFor();const wish=page.locator('#financeWishlist');await wish.waitFor();await page.waitForFunction(()=>document.querySelectorAll('#financeWishlist .v27-wish-card').length>0,{timeout:5000});assert.equal(await wish.locator('table').count(),0);assert.match(await wish.innerText(),/Available Twos/i);assert.match(await wish.innerText(),/Weekend bag/);
await wish.locator('[data-priority="1"]').click();assert.equal(await wish.locator('.v27-wish-card:visible').count(),0,'priority filter hides other priorities');await wish.locator('[data-priority="2"]').click();assert.equal(await wish.locator('.v27-wish-card:visible').count(),1);
await wish.locator('[data-cart-toggle="wish-bag"]').click();assert.match(await wish.innerText(),/Ready to unlock/);await wish.locator('[data-checkout]').click();await page.locator('#v27Modal:not([hidden]) .v27-receipt').waitFor({timeout:5000});assert.match(await page.locator('.v27-receipt').innerText(),/You earned this/);await page.locator('#v27Modal [data-v27-close]').click();await page.waitForTimeout(350);await page.evaluate(()=>window.TwogetherV27.refresh(true));await page.waitForTimeout(350);assert.match(await wish.innerText(),/Earned/);game=await page.evaluate(()=>window.TwogetherV27.getState().profile);assert.equal(game.twos,60,'€40 wishlist checkout uses 40 of the seeded 100 Twos');

// Shop is Lovis-only for purchases, removed filler rewards stay gone, and improved map/theme rewards are present.
await page.locator('#shopHub').click();const shop=page.locator('#shopView.active');await shop.waitFor();const shopText=await shop.innerText();assert.match(shopText,/Lovis only/);assert.doesNotMatch(shopText,/Golden Heart|Cute Icon Pack|Soft Sparkles|Trip Planner\+|Custom Home Dashboard/);assert.match(shopText,/Cozy \+ Night Atelier/);assert.match(shopText,/Twogether World Map/);assert.match(shopText,/Date Night Jar/);assert.match(shopText,/Lovis race/);assert.equal(await shop.locator('.v27-test').count(),1);
await shop.locator('[data-test-start]').click();await page.waitForTimeout(120);await shop.locator('[data-test-all]').click();await page.waitForTimeout(180);assert.equal(await shop.locator('.v27-world svg').count(),1,'World Map renders as a map graphic');assert.equal(await shop.locator('.v27-theme-switch').count(),1,'improved theme controls appear in preview');

assert.deepEqual(errors,[]);console.log('Browser v27: compact trip workspace/backgrounds, overview readability/20%, monthly density, compare lab, Twos Wishlist cart, Lovis Shop and test previews passed.');
await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1);});
