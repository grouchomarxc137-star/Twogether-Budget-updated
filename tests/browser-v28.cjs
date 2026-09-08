const {chromium}=require(process.env.TWOGETHER_PLAYWRIGHT||'playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {backend}=require('./backend.cjs');

(async()=>{
 const b=backend();
 const current=b.post('savePlan',{meta:{location:'Italy',city:'Lonato',start:'2026-09-29',end:'2026-09-30'},budget:300},'Principessa');
 b.post('savePlan',{id:current.planId,budget:234},'Principe');
 b.post('savePlanPartial',{planId:current.planId,partial:{groceries:20,eat:30}},'Principessa');
 const history=b.post('savePlan',{meta:{location:'Netherlands',city:'Tilburg',start:'2026-09-07',end:'2026-09-13'},budget:200},'Principessa');
 b.post('savePlan',{id:history.planId,budget:150},'Principe');
 const sub={travel:0,accom:0,fuel:0,groceries:0,eat:0,tolls:0,other:0,otherNote:'',paid:0,uncertain:{}};
 const saved=b.post('savePlanSubmission',{planId:history.planId,submission:sub},'Principessa');
 b.post('savePlanSubmission',{planId:history.planId,submission:sub},'Principe');
 assert.equal(b.post('confirmTrip',{id:saved.tripId},'Principessa').ok,true);
 assert.equal(b.post('confirmTrip',{id:saved.tripId},'Principe').ok,true);
 b.post('saveFinanceProfile',{profile:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],compareLab:{},wishlist:[
  {id:'wish-one',name:'Weekend camera',price:350,note:'For our little trips',priority:1},
  {id:'wish-two',name:'Dinner by the lake',price:60,note:'A date for us',priority:2},
  {id:'wish-three',name:'Soft blanket',price:35,note:'For slow Sundays',priority:3}
 ]}},'Principessa');
 const seeded=b.state();seeded.game.Principessa.purchases=['packing-list'];seeded.game.Principessa.twos=100;b.seed(seeded);

 const server=http.createServer((req,res)=>{let name=decodeURIComponent(req.url.split('?')[0]);if(name==='/')name='/index.html';const file=path.join(process.cwd(),name);if(!file.startsWith(process.cwd()))return res.writeHead(403).end();try{const data=fs.readFileSync(file);res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TWOGETHER_BROWSER||undefined,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://script.google.com/**',async route=>{const req=route.request();if(req.method()==='POST'){const q=new URLSearchParams(req.postData()),result=b.post(q.get('action'),JSON.parse(q.get('payload')),q.get('actor'));await route.fulfill({contentType:'text/html',body:`<script>window.top.postMessage(${JSON.stringify({type:'twogether:saved',requestId:q.get('requestId'),result})},'*')</script>`});}else{const u=new URL(req.url()),cb=u.searchParams.get('callback');await route.fulfill({contentType:'application/javascript',body:cb+'('+JSON.stringify({ok:true,state:b.state()})+')'});}});
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));await page.route('https://fonts.gstatic.com/**',r=>r.abort());await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"></svg>'}));await page.route('https://images.unsplash.com/**',r=>r.abort());await page.route('https://upload.wikimedia.org/**',r=>r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.identity-choice[data-actor="Principessa"]').click();
 await page.waitForFunction(()=>window.TwogetherV27&&document.querySelector('#twCurrentTrips .tw-current-card'),{timeout:15000});await page.waitForTimeout(900);

 assert.equal((await page.locator('#log .hero-copy h1').innerText()).trim(),'Log your most recent trip');
 assert.match(await page.locator('#log .hero-copy .eyebrow').innerText(),/SHARED BETWEEN PRINCIPE AND PRINCIPESSA/);
 const geo=await page.evaluate(()=>{const w=document.querySelector('#wizardCard').getBoundingClientRect(),s=document.querySelector('#twCurrentTripsSection').getBoundingClientRect(),c=document.querySelector('#twCurrentTrips .tw-current-card').getBoundingClientRect();return {wizard:w.width,current:s.width,cardH:c.height,small:parseFloat(getComputedStyle(document.querySelector('#twCurrentTrips .tw-current-numbers span')).fontSize)};});
 assert.ok(geo.wizard>geo.current*1.3,'wizard gets roughly 60% and Current Trips about 40%');
 assert.ok(geo.cardH<240,'Current Trip cards stay compact');
 assert.ok(geo.small>=12,'small Current Trip labels are readable');

 await page.waitForFunction(()=>document.querySelector('#tripGallery .trip-story-card')?.dataset.v28Background==='1',{timeout:6000});
 const story=await page.locator('#tripGallery .trip-story-card').first().evaluate(el=>({bg:getComputedStyle(el).backgroundImage,font:parseFloat(getComputedStyle(el.querySelector('p')).fontSize)}));
 assert.match(story.bg,/url\(/,'confirmed Trip Story uses destination background imagery');assert.ok(story.font>=12,'Trip Story small text stays readable');

 await page.locator('#twCurrentTrips .tw-current-card').first().locator('[data-current-open]').click();const dialog=page.locator('dialog.current-overview');await dialog.waitFor();
 const table=await dialog.evaluate(d=>{const wrap=d.querySelector('.overview-table'),t=wrap.querySelector('table'),ths=[...t.querySelectorAll('thead th')],td=t.querySelector('tbody td'),country=d.querySelector('.overview-country');return {scroll:t.scrollWidth,client:wrap.clientWidth,widths:ths.map(x=>x.getBoundingClientRect().width),font:parseFloat(getComputedStyle(td).fontSize),country:parseFloat(getComputedStyle(country).fontSize)};});
 assert.ok(table.scroll<=table.client+2,'trip comparison table fits without horizontal scrolling on desktop');
 assert.ok(table.widths[3]<table.widths[1]&&table.widths[3]<table.widths[2],'Match column remains the smallest');assert.ok(table.font>=12.5&&table.country>=11.5,'only small overview type was enlarged');
 await dialog.locator('[data-overview-close]').click();

 await page.evaluate(()=>document.querySelector('.trip-subnav [data-sheet="monthly"]').click());await page.waitForTimeout(200);
 const monthly=await page.locator('#monthly .table-wrap').evaluate(w=>{const t=w.querySelector('table'),td=t.querySelector('td');return {scroll:t.scrollWidth,client:w.clientWidth,font:parseFloat(getComputedStyle(td).fontSize)};});
 assert.ok(monthly.scroll<=monthly.client+2,'monthly table fits desktop width');assert.ok(monthly.font>=12.5,'monthly values are readable');

 await page.evaluate(()=>document.querySelector('.trip-subnav [data-sheet="log"]').click());await page.waitForTimeout(180);
 await page.waitForFunction(()=>document.querySelector('#twCurrentTrips [data-v27-pack]'),{timeout:5000});
 const pack=page.locator('#twCurrentTrips [data-v27-pack]').first();await pack.click();await page.locator('#v27Modal:not([hidden]) #v28PackInput').waitFor();await page.locator('#v28PackInput').fill('Phone charger');await page.locator('#v28PackAdd').click();await page.waitForTimeout(450);
 assert.ok(b.state().game.Principessa.packing[current.planId]?.some(x=>x.text==='Phone charger'),'packing reward saves an item for the current trip');
 await page.locator('#v27Modal [data-v27-close]').click();

 await page.evaluate(()=>document.querySelector('.finance-subnav [data-fin-subview="wishlist"]').click());await page.waitForFunction(()=>document.querySelectorAll('#financeWishlist .v27-wish-card').length===3,{timeout:5000});
 const wish=await page.evaluate(()=>{const grid=document.querySelector('#financeWishlist .v27-wish-grid'),card=grid.querySelector('.v27-wish-card'),small=card.querySelector('.v28-wish-readiness');return {cols:getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,h:card.getBoundingClientRect().height,title:parseFloat(getComputedStyle(card.querySelector('h3')).fontSize),small:parseFloat(getComputedStyle(small).fontSize),overflow:document.documentElement.scrollWidth-innerWidth};});
 assert.ok(wish.cols>=3,'Wishlist uses a compact three-column boutique on wide screens');assert.ok(wish.h<250,'Wishlist cards are smaller');assert.ok(wish.title<=24&&wish.small>=12,'Wishlist hierarchy is balanced and small text readable');assert.ok(wish.overflow<=1,'Wishlist does not create page-wide horizontal overflow');
 assert.deepEqual(errors,[]);console.log('Browser v28 balance/readability/history/packing/Wishlist checks passed.');
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1);});
