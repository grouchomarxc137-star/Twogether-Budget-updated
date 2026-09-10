const {chromium}=require(process.env.TWOGETHER_PLAYWRIGHT||'playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {backend}=require('./backend.cjs');

(async()=>{
 const b=backend();
 const current=b.post('savePlan',{meta:{location:'Italy',city:'Venice',start:'2026-09-29',end:'2026-09-30'},budget:500},'Principessa');
 b.post('savePlan',{id:current.planId,budget:450},'Principe');
 b.post('savePlanPartial',{planId:current.planId,partial:{accom:200,groceries:20}},'Principe');
 b.post('saveFinanceProfile',{profile:{bankAccounts:[{name:'Main',balance:900}],savingsTotal:1200,savingsReserved:[{name:'Lake Garda',amount:200}],receivables:[{person:'Friend',reason:'Dinner',principal:50,repayments:[]}],scenarios:[],compareLab:{},wishlist:[
  {id:'wish-a',name:'Laptop',price:510,note:'For creative projects',priority:1},
  {id:'wish-b',name:'Headphones',price:120,note:'For quiet evenings',priority:2},
  {id:'wish-c',name:'Trip to Lisbon',price:300,note:'A little weekend together',priority:3}
 ]}},'Principessa');
 const seeded=b.state();seeded.game.Principessa.twos=180;seeded.game.Principessa.lovis=70;seeded.game.Principe.lovis=18;b.seed(seeded);

 const server=http.createServer((req,res)=>{let name=decodeURIComponent(req.url.split('?')[0]);if(name==='/')name='/index.html';const file=path.join(process.cwd(),name);if(!file.startsWith(process.cwd()))return res.writeHead(403).end();try{const data=fs.readFileSync(file);res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TWOGETHER_BROWSER||undefined,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://script.google.com/**',async route=>{const req=route.request();if(req.method()==='POST'){const q=new URLSearchParams(req.postData()),result=b.post(q.get('action'),JSON.parse(q.get('payload')),q.get('actor'));await route.fulfill({contentType:'text/html',body:`<script>window.top.postMessage(${JSON.stringify({type:'twogether:saved',requestId:q.get('requestId'),result})},'*')</script>`});}else{const u=new URL(req.url()),cb=u.searchParams.get('callback');await route.fulfill({contentType:'application/javascript',body:cb+'('+JSON.stringify({ok:true,state:b.state()})+')'});}});
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));await page.route('https://fonts.gstatic.com/**',r=>r.abort());await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"></svg>'}));await page.route('https://images.unsplash.com/**',r=>r.abort());await page.route('https://upload.wikimedia.org/**',r=>r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.identity-choice[data-actor="Principessa"]').click();
 await page.waitForFunction(()=>document.querySelector('#twCurrentTrips .tw-current-card')&&document.querySelector('link[href*="v31.css"]')&&document.querySelector('script[src*="v31.js"]'),{timeout:15000});await page.waitForTimeout(900);

 async function minVisibleTextFont(scope='body'){
  return page.evaluate(sel=>{const root=document.querySelector(sel);let min=999,which='';if(!root)return {min:0,which:'missing'};for(const el of root.querySelectorAll('*')){const cs=getComputedStyle(el),r=el.getBoundingClientRect();if(cs.display==='none'||cs.visibility==='hidden'||r.width<=0||r.height<=0)continue;const own=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own)continue;const n=parseFloat(cs.fontSize);if(Number.isFinite(n)&&n<min){min=n;which=`${el.tagName.toLowerCase()}.${el.className||''}:${el.textContent.trim().slice(0,45)}`;}}return {min,which};},scope);
 }

 const activity=await page.locator('#log .activity-card').evaluate(el=>({w:el.getBoundingClientRect().width,bg:getComputedStyle(el).backgroundColor,opacity:parseFloat(getComputedStyle(el).opacity)}));
 assert.ok(activity.w<=300,'activity card is less intrusive');assert.ok(activity.opacity<1,'activity card is slightly translucent');
 const openBtn=page.locator('#twCurrentTrips [data-current-open]').first();const openStyle=await openBtn.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,blur:getComputedStyle(el).backdropFilter||getComputedStyle(el).webkitBackdropFilter}));
 assert.doesNotMatch(openStyle.bg,/rgba\([^)]*,\s*0\)/,'Open trip has a visible background');assert.notEqual(openStyle.blur,'none','Open trip has a frosted reading layer');

 await openBtn.click();const dialog=page.locator('dialog.current-overview');await dialog.waitFor({state:'visible'});await page.waitForTimeout(120);
 const tripDetail=await dialog.evaluate(d=>{const wrap=d.querySelector('.overview-table'),table=wrap?.querySelector('table'),td=table?.querySelector('td');return {width:d.getBoundingClientRect().width,scroll:table?.scrollWidth||0,client:wrap?.clientWidth||0,font:getComputedStyle(td).fontFamily,size:parseFloat(getComputedStyle(td).fontSize)};});
 assert.ok(tripDetail.width>=1050,'Open Trip uses more of the desktop canvas');assert.ok(tripDetail.scroll<=tripDetail.client+2,'the full comparison table fits without horizontal scrolling');assert.match(tripDetail.font,/Crimson Pro/i,'trip table uses the site font');assert.ok(tripDetail.size>=12,'trip table text respects the 12px floor');
 const detailMin=await minVisibleTextFont('dialog.current-overview');assert.ok(detailMin.min>=12,`trip dialog has no text below 12px (${detailMin.which} = ${detailMin.min})`);await dialog.locator('[data-overview-close]').click();

 await page.locator('[data-hub="finances"]').click();await page.waitForTimeout(80);await page.evaluate(()=>document.querySelector('#financeSubnav [data-fin-subview="balances"]')?.click());await page.waitForFunction(()=>document.querySelectorAll('#financeCurrent .v31-fin-icon').length===4&&document.querySelector('#financeCurrent .v31-finance-love-note'),{timeout:5000});
 assert.equal(await page.locator('#financeCurrent .v31-fin-icon').count(),4,'Balances & loans has four reference-style icons');assert.equal(await page.locator('#financeCurrent .v31-birds').count(),1,'Balances & loans has the little birds footer');

 await page.locator('#wishlistHub').click();await page.waitForFunction(()=>document.querySelectorAll('#financeWishlist .v27-wish-card').length===3);await page.waitForTimeout(160);
 const wishFont=await page.locator('#financeWishlist .v27-wish-card h3').first().evaluate(el=>getComputedStyle(el).fontFamily);assert.match(wishFont,/Crimson Pro/i,'Wishlist title font matches the site');
 const wishMin=await minVisibleTextFont('#financeWishlist');assert.ok(wishMin.min>=12,`Wishlist has no text below 12px (${wishMin.which} = ${wishMin.min})`);

 await page.locator('#shopHub').click();await page.waitForFunction(()=>document.querySelector('#shopView .v31-journey-path')&&document.querySelector('#shopView .v31-rewards-layout'));await page.waitForTimeout(180);
 const shop=await page.evaluate(()=>{const layout=document.querySelector('#shopView .v31-rewards-layout'),side=layout.querySelector('.v31-reward-side'),grid=layout.querySelector('.v27-shop-grid'),journey=document.querySelector('#shopView .v31-journey-path');return {cols:getComputedStyle(layout).gridTemplateColumns.split(' ').filter(Boolean).length,side:!!side,journey:!!journey,gridW:grid.getBoundingClientRect().width,layoutW:layout.getBoundingClientRect().width};});
 assert.equal(shop.cols,2,'Rewards use a compact main column plus interactive side column');assert.ok(shop.side&&shop.journey,'journey and reward companion are present');assert.ok(shop.gridW<shop.layoutW,'reward rows are shorter because of the side section');
 await page.locator('[data-v31-surprise]').click();await page.waitForTimeout(120);assert.equal(await page.locator('#shopView .v31-surprise-pick').count(),1,'Surprise me interactively highlights a reward');
 const shopMin=await minVisibleTextFont('#shopView');assert.ok(shopMin.min>=12,`Shop has no text below 12px (${shopMin.which} = ${shopMin.min})`);

 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.locator('[data-hub="trips"]').click();await page.waitForTimeout(100);
 const tripSub=page.locator('#tripSubnav');assert.equal(await tripSub.isVisible(),true,'Trip subcategories are touch-visible on mobile');await tripSub.locator('[data-sheet="monthly"]').click();await page.waitForTimeout(100);assert.equal(await page.locator('#monthly').evaluate(el=>el.classList.contains('active')),true,'mobile Trip subcategory opens');
 await page.locator('[data-hub="finances"]').click();await page.waitForTimeout(120);const finSub=page.locator('#financeSubnav');assert.equal(await finSub.isVisible(),true,'Finance subcategories are touch-visible on mobile');await finSub.locator('[data-fin-subview="balances"]').click();await page.waitForTimeout(120);assert.equal(await page.locator('[data-fin-view="balances"]').evaluate(el=>el.classList.contains('active')),true,'mobile Finance subcategory opens');
 await page.locator('#wishlistHub').click();await page.waitForTimeout(80);await page.locator('#shopHub').click();await page.waitForTimeout(180);
 const mobile=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,inner:innerWidth,activityPos:getComputedStyle(document.querySelector('#log .lower-grid.single-activity')).position,menu:getComputedStyle(document.querySelector('.tw-nav-menu')).display}));
 assert.ok(mobile.scroll<=mobile.inner+1,`mobile page has no page-wide horizontal overflow (${mobile.scroll}/${mobile.inner})`);assert.equal(mobile.activityPos,'static','activity no longer floats over mobile content');assert.equal(mobile.menu,'none','hover-only dropdown is disabled on touch layout');

 assert.deepEqual(errors,[]);console.log('Browser v31 activity, trip detail, typography, balances, Wishlist, Lovis journey, rewards and mobile checks passed.');
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1);});
