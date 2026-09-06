const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {backend}=require('./backend.cjs');
(async()=>{
  const b=backend();
  const plans=[
    [{location:'Italy',city:'Lonato',start:'2026-09-03',end:'2026-09-04'},234,'Principessa'],
    [{location:'Netherlands',city:'Amsterdam',start:'2026-09-07',end:'2026-09-13'},200,'Principessa'],
    [{location:'Tunisia',city:'Ariana',start:'2026-09-06',end:'2026-09-12'},200,'Principe']
  ];
  plans.forEach(([meta,budget,actor])=>b.post('savePlan',{meta,budget},actor));
  const server=http.createServer((req,res)=>{let name=decodeURIComponent(req.url.split('?')[0]);if(name==='/')name='/index.html';const file=path.join(process.cwd(),name);if(!file.startsWith(process.cwd()))return res.writeHead(403).end();try{const data=fs.readFileSync(file);res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://script.google.com/**',async route=>{const req=route.request();if(req.method()==='POST'){const q=new URLSearchParams(req.postData());const result=b.post(q.get('action'),JSON.parse(q.get('payload')),q.get('actor'));await route.fulfill({contentType:'text/html',body:`<script>window.top.postMessage(${JSON.stringify({type:'twogether:saved',requestId:q.get('requestId'),result})},'*')</script>`});}else{const u=new URL(req.url()),cb=u.searchParams.get('callback');await route.fulfill({contentType:'application/javascript',body:cb+'('+JSON.stringify({ok:true,state:b.state()})+')'});}});
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://cdnjs.cloudflare.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
  const pixel=Buffer.from('R0lGODlhAQABAAAAACw=','base64');
  await page.route('https://upload.wikimedia.org/**',r=>r.fulfill({contentType:'image/gif',body:pixel}));
  await page.route('https://images.unsplash.com/**',r=>r.fulfill({contentType:'image/gif',body:pixel}));
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="red"/></svg>'}));

  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.identity-choice[data-actor="Principessa"]').click();
  await page.waitForFunction(()=>!!window.TwogetherDevV21,{timeout:10000});
  const cards=page.locator('#twCurrentTrips .tw-current-card');await cards.first().waitFor({timeout:10000});assert.equal(await cards.count(),3);
  const b0=await cards.nth(0).boundingBox(),b1=await cards.nth(1).boundingBox();assert.ok(Math.abs(b0.y-b1.y)<8&&b1.x>b0.x,'Current trips render as neighboring story-sized blocks');
  const ariana=cards.filter({hasText:'Ariana'}).first();await ariana.waitFor();await page.waitForTimeout(80);const bg=await ariana.locator('.tw-trip-art').evaluate(el=>el.style.backgroundImage);assert.ok(bg.includes('Ariana_-_Tunisia.jpg'),'Ariana has a dedicated city image');assert.equal(await ariana.locator('.tw-trip-monogram').count(),0,'City initial monogram removed');
  const flagBg=await ariana.locator('.tw-trip-emoji').evaluate(el=>getComputedStyle(el).backgroundColor);assert.ok(flagBg==='rgba(0, 0, 0, 0)'||flagBg==='transparent','Flag has no white tile');

  await page.locator('#twDevToggle').click();assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('dev-v21')),true);assert.equal(await page.locator('#loggedUserBadge').innerText(),'DEV');assert.equal(await page.locator('.dev19-bottom').isVisible().catch(()=>false),false,'Legacy DEV controls stay hidden');
  await page.locator('[data-hub="finances"]').click();assert.equal(await page.locator('#finances').evaluate(e=>e.classList.contains('active')),true,'Single left click stays normal in DEV');await page.locator('[data-hub="trips"]').click();
  const title=page.locator('#twCurrentTitle');await title.scrollIntoViewIfNeeded();const original=(await title.innerText()).trim();await title.dblclick();assert.equal(await title.getAttribute('contenteditable'),'true');await page.keyboard.press('Control+A');await page.keyboard.type('DEV Current Trips');await page.keyboard.press('Enter');assert.equal((await title.innerText()).trim(),'DEV Current Trips');
  await title.click({button:'right'});await page.locator('.dev21-context').waitFor();assert.equal(await page.locator('.dev21-context').isVisible(),true,'Right-click opens advanced context menu');
  const section=page.locator('#twCurrentTripsSection');await section.scrollIntoViewIfNeeded();const sb=await section.boundingBox();await page.mouse.move(sb.x+12,sb.y+12);await page.mouse.down();await page.mouse.move(Math.min(1380,sb.x+sb.width-12),Math.min(930,sb.y+Math.min(sb.height-12,220)),{steps:8});await page.mouse.up();assert.equal(await page.locator('.dev21-selection').isVisible(),true,'Drag rectangle selects a section');
  await page.locator('.dev21-toolbar [data-exit]').click();assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('dev-v21')),false);assert.equal((await page.locator('#twCurrentTitle').innerText()).trim(),original,'DEV edits never leak into Principessa');
  await page.locator('#twDevToggle').click();assert.equal((await page.locator('#twCurrentTitle').innerText()).trim(),'DEV Current Trips','DEV edits persist when returning to DEV');await page.locator('.dev21-toolbar [data-exit]').click();

  await page.locator('[data-hub="finances"]').click();await page.locator('.finance-subnav [data-fin-subview="wishlist"]').click();await page.locator('[data-wish-add]').click();await page.locator('#wishName').fill('Pen');await page.locator('#wishName').press('Enter');await page.locator('#wishlistMiniModal').waitFor({state:'hidden'});await page.locator('.wishlist-item-name', {hasText:'Pen'}).waitFor();const row=page.locator('.wishlist-table tbody tr').filter({hasText:'Pen'});assert.equal((await row.locator('.wishlist-note-cell').innerText()).trim(),'','Empty note stays visually blank');const tw=await page.locator('.wishlist-table').boundingBox();assert.ok(tw.width<1000,'Wishlist table sizes to its content instead of filling the page');

  assert.deepEqual(errors,[]);console.log('v21 browser regression passed: compact trip blocks, Ariana media, clean flags, DEV marquee/right-click sandbox, instant wishlist Enter-save.');
  await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1);});
