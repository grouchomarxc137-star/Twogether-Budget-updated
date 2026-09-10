const {chromium}=require(process.env.TWOGETHER_PLAYWRIGHT||'playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {backend}=require('./backend.cjs');

(async()=>{
 const b=backend();
 const plan=b.post('savePlan',{meta:{location:'Italy',city:'Venice',start:'2026-09-29',end:'2026-09-30'},budget:500},'Principessa');
 b.post('savePlan',{id:plan.planId,budget:450},'Principe');
 b.post('savePlanPartial',{planId:plan.planId,partial:{accom:200,groceries:20}},'Principe');
 b.post('saveFinanceProfile',{profile:{bankAccounts:[{name:'Main',balance:900}],savingsTotal:1200,savingsReserved:[],receivables:[],scenarios:[],compareLab:{},wishlist:[]}},'Principessa');
 const seeded=b.state();seeded.game.Principessa.lovis=70;seeded.game.Principe.lovis=18;b.seed(seeded);
 let delayState=false;
 const server=http.createServer((req,res)=>{let name=decodeURIComponent(req.url.split('?')[0]);if(name==='/')name='/index.html';const file=path.join(process.cwd(),name);if(!file.startsWith(process.cwd()))return res.writeHead(403).end();try{const data=fs.readFileSync(file);res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TWOGETHER_BROWSER||undefined,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://script.google.com/**',async route=>{const req=route.request();if(req.method()==='POST'){const q=new URLSearchParams(req.postData()),result=b.post(q.get('action'),JSON.parse(q.get('payload')),q.get('actor'));await route.fulfill({contentType:'text/html',body:`<script>window.top.postMessage(${JSON.stringify({type:'twogether:saved',requestId:q.get('requestId'),result})},'*')</script>`});}else{if(delayState)await new Promise(r=>setTimeout(r,500));const u=new URL(req.url()),cb=u.searchParams.get('callback');await route.fulfill({contentType:'application/javascript',body:cb+'('+JSON.stringify({ok:true,state:b.state()})+')'});}});
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));await page.route('https://fonts.gstatic.com/**',r=>r.abort());await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"></svg>'}));await page.route('https://images.unsplash.com/**',r=>r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.identity-choice[data-actor="Principessa"]').click();
 await page.waitForFunction(()=>document.querySelector('#twCurrentTrips .tw-current-card')&&document.querySelector('link[href*="v32.css"]')&&document.querySelector('script[src*="v32.js"]'),{timeout:15000});await page.waitForTimeout(650);

 const activity=page.locator('#log .activity-card');const activityInfo=await activity.evaluate(el=>({w:el.getBoundingClientRect().width,overflow:getComputedStyle(el).overflowY,bg:getComputedStyle(el).backgroundColor,visible:[...el.querySelectorAll('.activity-item')].filter(x=>getComputedStyle(x).display!=='none').length}));
 assert.ok(activityInfo.w<=240,`activity stays compact (${activityInfo.w})`);assert.notEqual(activityInfo.overflow,'auto','activity card has no internal scrollbar');assert.notEqual(activityInfo.overflow,'scroll','activity card has no internal scrollbar');assert.ok(activityInfo.visible<=2,'only the two newest activities are shown in compact view');

 await page.locator('[data-hub="finances"]').click();await page.waitForTimeout(60);await page.locator('#financeSubnav [data-fin-subview="balances"]').click();
 await page.waitForFunction(()=>document.querySelector('#financeCurrent .v31-finance-love-note')&&document.querySelector('#financeCurrent .v31-birds[data-v32-birds="1"]'),{timeout:4000});
 const inv=page.locator('#financeCurrent .finance-current-card').filter({hasText:'INVESTMENTS'}).locator('.finance-current-title h3');assert.equal((await inv.innerText()).trim(),'My investments');
 const invLine=await inv.evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth,white:getComputedStyle(el).whiteSpace}));assert.equal(invLine.white,'nowrap','My investments is kept on one line');assert.ok(invLine.scroll<=invLine.client+1,'My investments fits its heading area');
 const birdInfo=await page.locator('#financeCurrent .v31-birds svg').evaluate(svg=>({paths:svg.querySelectorAll('path').length,eyes:svg.querySelectorAll('.v32-bird-eye').length}));assert.ok(birdInfo.paths>=10&&birdInfo.eyes===2,'bird art has two recognizable illustrated birds');

 delayState=true;await page.locator('#shopHub').click();
 await page.waitForFunction(()=>document.querySelector('#shopView.active .v31-journey-path')&&document.querySelector('#shopView.active .v31-rewards-layout'),{timeout:250});
 assert.equal((await page.locator('#shopView .v27-score h2').innerText()).trim(),'Our Lovis journey','new Shop appears immediately');
 await page.waitForTimeout(750);assert.equal(await page.locator('#shopView .v31-journey-path').count(),1,'Shop journey survives the delayed legacy refresh');assert.equal(await page.locator('#shopView .v31-rewards-layout').count(),1,'reward side layout survives the delayed legacy refresh');
 await page.evaluate(()=>window.TwogetherV27?.renderAll?.());await page.waitForTimeout(80);assert.equal(await page.locator('#shopView .v31-journey-path').count(),1,'Shop remains polished after a direct renderAll');assert.equal(await page.locator('#shopView .v31-rewards-layout').count(),1,'reward layout remains polished after a direct renderAll');delayState=false;

 await page.setViewportSize({width:390,height:844});
 await page.locator('[data-hub="trips"]').click();await page.waitForTimeout(35);assert.equal(await page.locator('#tripSubnav').isVisible(),true,'mobile Trips opens immediately');
 await page.locator('#tripSubnav [data-sheet="monthly"]').click();await page.waitForTimeout(35);assert.equal(await page.locator('#monthly').evaluate(el=>el.classList.contains('active')),true,'mobile Trip subcategory opens');
 await page.locator('[data-hub="finances"]').click();await page.waitForTimeout(35);assert.equal(await page.locator('#financeSubnav').isVisible(),true,'mobile My finances opens immediately');
 await page.locator('#financeSubnav [data-fin-subview="balances"]').click();await page.waitForTimeout(35);assert.equal(await page.locator('[data-fin-view="balances"]').evaluate(el=>el.classList.contains('active')),true,'mobile Finance subcategory opens');
 const mobileWidth=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,inner:innerWidth}));assert.ok(mobileWidth.scroll<=mobileWidth.inner+1,`mobile page does not overflow (${mobileWidth.scroll}/${mobileWidth.inner})`);

 assert.deepEqual(errors,[]);console.log('Browser v32 Shop stability, balances, activity and mobile navigation checks passed.');
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1);});
