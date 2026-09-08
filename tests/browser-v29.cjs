const {chromium}=require(process.env.TWOGETHER_PLAYWRIGHT||'playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {backend}=require('./backend.cjs');

(async()=>{
 const b=backend();
 const current=b.post('savePlan',{meta:{location:'Italy',city:'Lonato',start:'2026-09-29',end:'2026-09-30'},budget:500},'Principessa');
 b.post('savePlan',{id:current.planId,budget:450},'Principe');
 b.post('saveFinanceProfile',{profile:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],compareLab:{},wishlist:[
  {id:'wish-a',name:'Laptop',price:510,note:'For creative projects',priority:1},
  {id:'wish-b',name:'Headphones',price:120,note:'For quiet evenings',priority:2},
  {id:'wish-c',name:'Trip to Lisbon',price:300,note:'A little weekend together',priority:3}
 ]}},'Principessa');
 const seeded=b.state();seeded.game.Principessa.twos=180;seeded.game.Principessa.lovis=140;b.seed(seeded);

 const server=http.createServer((req,res)=>{let name=decodeURIComponent(req.url.split('?')[0]);if(name==='/')name='/index.html';const file=path.join(process.cwd(),name);if(!file.startsWith(process.cwd()))return res.writeHead(403).end();try{const data=fs.readFileSync(file);res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TWOGETHER_BROWSER||undefined,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://script.google.com/**',async route=>{const req=route.request();if(req.method()==='POST'){const q=new URLSearchParams(req.postData()),result=b.post(q.get('action'),JSON.parse(q.get('payload')),q.get('actor'));await route.fulfill({contentType:'text/html',body:`<script>window.top.postMessage(${JSON.stringify({type:'twogether:saved',requestId:q.get('requestId'),result})},'*')</script>`});}else{const u=new URL(req.url()),cb=u.searchParams.get('callback');await route.fulfill({contentType:'application/javascript',body:cb+'('+JSON.stringify({ok:true,state:b.state()})+')'});}});
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));await page.route('https://fonts.gstatic.com/**',r=>r.abort());await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"></svg>'}));await page.route('https://images.unsplash.com/**',r=>r.abort());await page.route('https://upload.wikimedia.org/**',r=>r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.identity-choice[data-actor="Principessa"]').click();
 await page.waitForFunction(()=>document.querySelector('#wishlistHub')&&document.querySelector('#shopHub')&&document.querySelector('#twCurrentTrips .tw-current-card')&&document.querySelector('link[href*="v29.css"]'),{timeout:15000});await page.waitForTimeout(600);

 const nav=await page.locator('.hub-tabs .hub-tab').allTextContents();assert.deepEqual(nav.map(x=>x.replace(/\s+/g,' ').trim().replace(/\d+\s*♡$/,'').trim()),['Trips','My finances','Wishlist','Shop']);
 const layout=await page.evaluate(()=>{const w=document.querySelector('#wizardCard').getBoundingClientRect(),s=document.querySelector('#twCurrentTripsSection').getBoundingClientRect();return {ww:w.width,sw:s.width,wt:w.top,st:s.top,wb:w.bottom,sb:s.bottom};});
 assert.ok(layout.ww/layout.sw>2.45,'wizard is roughly 75% and Current Trips roughly 25%');assert.ok(Math.abs(layout.wt-layout.st)<8,'Current Trips starts with the wizard card');assert.ok(Math.abs(layout.wb-layout.sb)<8,'Current Trips ends with the wizard card');

 const expense=page.locator('#twCurrentTrips [data-current-expenses]').first();await expense.click();await page.locator('#workflowV5Overlay.show').waitFor({timeout:5000});await page.waitForTimeout(80);
 const flow=await page.evaluate(()=>{const o=document.querySelector('#workflowV5Overlay'),w=document.querySelector('#wizardCard'),or=o.getBoundingClientRect(),wr=w.getBoundingClientRect();return {title:o.querySelector('h2')?.textContent||'',choice:!!o.querySelector('[data-v5-actual-mode]'),ow:or.width,oh:or.height,ww:wr.width,wh:wr.height,left:or.left-wr.left,top:or.top-wr.top};});
 assert.match(flow.title,/Accommodation/i,'Add expenses goes straight into the normal expense wizard');assert.equal(flow.choice,false,'No extra full/partial choice screen appears');assert.ok(flow.ow<=flow.ww+2&&flow.oh<=flow.wh+2&&Math.abs(flow.left)<3&&Math.abs(flow.top)<3,'expense wizard stays inside the wizard card');
 await page.evaluate(()=>window.TwogetherWorkflow.close());

 await page.locator('#twCurrentTrips [data-current-open]').first().click();const dialog=page.locator('dialog.current-overview');await dialog.waitFor();
 const table=await dialog.evaluate(d=>{const wrap=d.querySelector('.overview-table'),t=wrap.querySelector('table');return {dialog:d.getBoundingClientRect().width,scroll:t.scrollWidth,client:wrap.clientWidth,pad:getComputedStyle(t.querySelector('td')).paddingLeft};});
 assert.ok(table.dialog<=945,'trip detail stays compact');assert.ok(table.scroll<=table.client+2,'trip table fits without desktop horizontal scroll');assert.ok(parseFloat(table.pad)<=7,'trip table cell whitespace is reduced');await dialog.locator('[data-overview-close]').click();

 await page.locator('#wishlistHub').click();await page.waitForFunction(()=>document.querySelector('[data-fin-view="wishlist"]')?.classList.contains('active'));await page.waitForTimeout(180);
 assert.equal(await page.locator('#financeSubnav.hidden').count(),1,'Wishlist is its own main destination');assert.equal(await page.locator('#financeSubnav [data-fin-subview="wishlist"]').count(),0,'Wishlist is removed from the finance subnav');
 const wish=await page.evaluate(()=>({values:document.querySelectorAll('#financeWishlist .v29-wish-values span').length,icons:document.querySelectorAll('#financeWishlist .v29-wish-icon').length,progress:document.querySelectorAll('#financeWishlist .v29-wish-progress').length,cols:getComputedStyle(document.querySelector('#financeWishlist .v27-wish-grid')).gridTemplateColumns.split(' ').filter(Boolean).length}));
 assert.equal(wish.values,3);assert.equal(wish.icons,3);assert.equal(wish.progress,3);assert.ok(wish.cols>=3,'Wishlist keeps a compact boutique grid');

 await page.locator('#shopHub').click();await page.locator('#shopView.active').waitFor();await page.waitForTimeout(100);
 const shop=await page.evaluate(()=>({ribbon:!!document.querySelector('#shopView .v29-shop-ribbon'),cols:getComputedStyle(document.querySelector('#shopView .v27-shop-grid')).gridTemplateColumns.split(' ').filter(Boolean).length,radius:parseFloat(getComputedStyle(document.querySelector('#shopView .v27-shop-item')).borderRadius)}));
 assert.equal(shop.ribbon,true);assert.ok(shop.cols>=4,'Shop uses a playful reward cabinet grid');assert.ok(shop.radius>=18);
 assert.deepEqual(errors,[]);console.log('Browser v29 wizard/layout/table/Wishlist/Shop checks passed.');
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1);});
