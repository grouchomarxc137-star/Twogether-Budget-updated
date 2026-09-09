const {chromium}=require(process.env.TWOGETHER_PLAYWRIGHT||'playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {backend}=require('./backend.cjs');

(async()=>{
 const b=backend();
 const current=b.post('savePlan',{meta:{location:'Italy',city:'Lonato',start:'2026-09-29',end:'2026-09-30'},budget:500},'Principessa');
 b.post('savePlan',{id:current.planId,budget:450},'Principe');
 b.post('saveFinanceProfile',{profile:{bankAccounts:[{name:'Main',balance:900}],savingsTotal:1200,savingsReserved:[{name:'Trip',amount:200}],receivables:[{person:'Friend',reason:'Dinner',principal:50,repayments:[]}],scenarios:[],compareLab:{},wishlist:[
  {id:'wish-a',name:'Laptop',price:510,note:'For creative projects',priority:1},
  {id:'wish-b',name:'Headphones',price:120,note:'For quiet evenings',priority:2},
  {id:'wish-c',name:'Trip to Lisbon',price:300,note:'A little weekend together',priority:3}
 ]}},'Principessa');
 const seeded=b.state();seeded.game.Principessa.twos=180;seeded.game.Principessa.lovis=140;seeded.game.Principe.lovis=80;b.seed(seeded);

 const server=http.createServer((req,res)=>{let name=decodeURIComponent(req.url.split('?')[0]);if(name==='/')name='/index.html';const file=path.join(process.cwd(),name);if(!file.startsWith(process.cwd()))return res.writeHead(403).end();try{const data=fs.readFileSync(file);res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TWOGETHER_BROWSER||undefined,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://script.google.com/**',async route=>{const req=route.request();if(req.method()==='POST'){const q=new URLSearchParams(req.postData()),result=b.post(q.get('action'),JSON.parse(q.get('payload')),q.get('actor'));await route.fulfill({contentType:'text/html',body:`<script>window.top.postMessage(${JSON.stringify({type:'twogether:saved',requestId:q.get('requestId'),result})},'*')</script>`});}else{const u=new URL(req.url()),cb=u.searchParams.get('callback');await route.fulfill({contentType:'application/javascript',body:cb+'('+JSON.stringify({ok:true,state:b.state()})+')'});}});
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));await page.route('https://fonts.gstatic.com/**',r=>r.abort());await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"></svg>'}));await page.route('https://images.unsplash.com/**',r=>r.abort());await page.route('https://upload.wikimedia.org/**',r=>r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.identity-choice[data-actor="Principessa"]').click();
 await page.waitForFunction(()=>document.querySelector('#wishlistHub')&&document.querySelector('#shopHub')&&document.querySelector('#twCurrentTrips .tw-current-card')&&document.querySelector('link[href*="v30.css"]')&&document.querySelector('link[href*="v30-readable.css"]'),{timeout:15000});await page.waitForTimeout(700);

 const trip=await page.locator('#twCurrentTrips .tw-current-card').first().evaluate(el=>({font:getComputedStyle(el.querySelector('h3')).fontFamily,shadow:getComputedStyle(el.querySelector('h3')).textShadow,small:parseFloat(getComputedStyle(el.querySelector('.tw-current-numbers span')).fontSize),numbersBg:getComputedStyle(el.querySelector('.tw-current-numbers')).backgroundImage}));
 assert.match(trip.font,/Crimson Pro/i,'Current Trips uses Crimson Pro');assert.notEqual(trip.shadow,'none','trip card text has a readability treatment');assert.ok(trip.small>=13,'Current Trips microcopy is readable');assert.notEqual(trip.numbersBg,'none','trip numbers have a soft reading layer');

 await page.evaluate(()=>document.querySelector('#financeSubnav [data-fin-subview="balances"]')?.click());await page.waitForFunction(()=>document.querySelector('[data-fin-view="balances"]')?.classList.contains('active')&&document.querySelectorAll('#financeCurrent .finance-current-card').length===4);await page.waitForTimeout(120);
 const balances=await page.locator('#financeCurrent .finance-current-card').first().evaluate(el=>({bg:getComputedStyle(el).backgroundImage,radius:parseFloat(getComputedStyle(el).borderRadius),after:getComputedStyle(el,'::after').content,font:getComputedStyle(el.querySelector('h3')).fontFamily,small:parseFloat(getComputedStyle(el.querySelector('.finance-current-title span')).fontSize)}));
 assert.notEqual(balances.bg,'none','Balances cards have the refined calm treatment');assert.ok(balances.radius>=20);assert.notEqual(balances.after,'none','Balances cards keep the playful decorative detail');assert.match(balances.font,/Crimson Pro/i);assert.ok(balances.small>=13,'Balances labels are readable');

 await page.locator('#wishlistHub').click();await page.waitForFunction(()=>document.querySelectorAll('#financeWishlist .v27-wish-card').length===3);await page.waitForTimeout(180);
 const wish=await page.locator('#financeWishlist .v27-wish-card').first().evaluate(el=>({font:getComputedStyle(el.querySelector('h3')).fontFamily,note:parseFloat(getComputedStyle(el.querySelector('.v28-wish-note')).fontSize),priorityBg:getComputedStyle(el.querySelector('.v27-wish-top span')).backgroundColor}));
 assert.match(wish.font,/Crimson Pro/i,'Wishlist uses the site font');assert.ok(wish.note>=13,'Wishlist small copy is readable');assert.ok(wish.priorityBg,'Wishlist keeps a calm priority treatment');

 await page.locator('#shopHub').click();await page.locator('#shopView.active').waitFor();await page.waitForTimeout(220);
 const shop=await page.evaluate(()=>{const root=document.querySelector('#shopView'),grid=root.querySelector('.v27-shop-grid'),item=root.querySelector('.v27-shop-item'),wallet=root.querySelector('.v27-wallet'),score=root.querySelector('.v27-score');return {title:root.querySelector('.v27-shop-hero h1')?.textContent||'',hero:root.querySelector('.v27-shop-hero')?.textContent||'',wallet:wallet?.textContent||'',scoreTitle:score?.querySelector('h2')?.textContent||'',score:score?.textContent||'',cols:getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,itemDisplay:getComputedStyle(item).display,itemH:item.getBoundingClientRect().height,font:getComputedStyle(item.querySelector('h3')).fontFamily,small:parseFloat(getComputedStyle(item.querySelector('p')).fontSize)};});
 assert.match(shop.title,/Gentle rewards/i,'Shop hero copy is calmer');assert.doesNotMatch(shop.wallet,/Twos/i,'Shop hero wallet is Lovis-only');assert.equal(shop.scoreTitle,'Our Lovis journey');assert.doesNotMatch(shop.score,/Twos/i,'Lovis journey does not mix in Twos');assert.equal(shop.cols,1,'Rewards are arranged in rows');assert.equal(shop.itemDisplay,'grid');assert.ok(shop.itemH<130,'Reward rows stay compact');assert.match(shop.font,/Crimson Pro/i);assert.ok(shop.small>=13,'Shop supporting text is readable');

 assert.deepEqual(errors,[]);console.log('Browser v30 typography, trip readability, balances, Wishlist and Lovis-shop checks passed.');
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1);});