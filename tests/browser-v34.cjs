const {chromium}=require(process.env.TWOGETHER_PLAYWRIGHT||'playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {backend}=require('./backend.cjs');

(async()=>{
  const apiSource=fs.readFileSync('api.js','utf8');
  const bridgeSource=fs.readFileSync('trip-wizard-bridge-v15.js','utf8');
  assert.ok(!apiSource.includes('const current=await remoteState();'),'saving must not block on a state preflight');
  assert.ok(!bridgeSource.includes('const before=await getState();'),'new trip save must not fetch state before writing');
  assert.ok(!bridgeSource.includes('for(let i=0;i<10 && !created;i++)'),'new trip save must not poll state ten times');

  const b=backend();
  const server=http.createServer((req,res)=>{
    let name=decodeURIComponent(req.url.split('?')[0]);if(name==='/')name='/index.html';
    const file=path.join(process.cwd(),name);if(!file.startsWith(process.cwd()))return res.writeHead(403).end();
    try{const data=fs.readFileSync(file);res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.webmanifest')?'application/manifest+json':name.endsWith('.svg')?'image/svg+xml':'text/html');res.end(data);}catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));

  const browser=await chromium.launch({executablePath:process.env.TWOGETHER_BROWSER||undefined,headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:[]});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));

  let failState=false,postCount=0;
  const armedOrder=[];
  await page.route('https://script.google.com/**',async route=>{
    const req=route.request();
    if(req.method()==='POST'){
      const q=new URLSearchParams(req.postData());
      if(failState)armedOrder.push('POST:'+q.get('action'));
      postCount++;
      const result=b.post(q.get('action'),JSON.parse(q.get('payload')),q.get('actor'));
      return route.fulfill({contentType:'text/html',body:`<script>window.top.postMessage(${JSON.stringify({type:'twogether:saved',requestId:q.get('requestId'),result})},'*')</script>`});
    }
    if(failState){armedOrder.push('GET:state');return route.abort('failed');}
    const u=new URL(req.url()),cb=u.searchParams.get('callback');
    return route.fulfill({contentType:'application/javascript',body:cb+'('+JSON.stringify({ok:true,state:b.state()})+')'});
  });
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://fonts.gstatic.com/**',r=>r.abort());
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"></svg>'}));
  await page.route('https://images.unsplash.com/**',r=>r.abort());

  const base='http://127.0.0.1:'+server.address().port;
  await page.goto(base);
  await page.locator('.identity-choice[data-actor="Principessa"]').click();
  await page.waitForSelector('[data-trip-pick="new"]',{timeout:10000});
  await page.locator('[data-trip-pick="new"]').click();
  await page.locator('[data-choice="Italy"]').click();
  await page.fill('#wizardInput','Lonato del Garda');await page.click('[data-wizard-next]');
  await page.fill('#wizardInput','2026-10-20');await page.click('[data-wizard-next]');
  await page.fill('#wizardInput','2026-10-24');await page.click('[data-wizard-next]');
  await page.fill('#wizardInput','500');

  // Simulate the state endpoint becoming unavailable exactly when the user saves.
  // The POST must still happen first and the successful save must not be lost behind a GET timeout.
  failState=true;
  await page.click('[data-wizard-next]');
  await page.waitForFunction(()=>/What do you want to log now\?/.test(document.querySelector('#wizardBody h2')?.textContent||''),{timeout:5000});

  const plans=b.state().plans;
  assert.equal(plans.length,1,'trip plan is persisted even when state refresh is unavailable');
  assert.equal(plans[0].meta.city,'Lonato del Garda');
  assert.equal(plans[0].budgets.Principessa,500);
  assert.equal(postCount,1,'creating a trip uses one save request');
  assert.equal(armedOrder[0],'POST:savePlan','save is not blocked by a state request');
  assert.deepEqual(errors,[]);

  console.log('Browser v34 trip save timeout recovery and single-write flow passed.');
  await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1);});
