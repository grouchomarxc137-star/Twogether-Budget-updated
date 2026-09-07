const {chromium}=require(process.env.TWOGETHER_PLAYWRIGHT||'playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {backend}=require('./backend.cjs');

(async()=>{
  const b=backend();
  const server=http.createServer((req,res)=>{
    let name=decodeURIComponent(req.url.split('?')[0]);if(name==='/')name='/index.html';
    const file=path.join(process.cwd(),name);if(!file.startsWith(process.cwd())){res.writeHead(403).end();return;}
    try{const data=fs.readFileSync(file);res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.TWOGETHER_BROWSER||undefined,headless:true});
  const page=await browser.newPage({viewport:{width:1360,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://script.google.com/**',async route=>{
    const req=route.request();
    if(req.method()==='POST'){
      const q=new URLSearchParams(req.postData());const result=b.post(q.get('action'),JSON.parse(q.get('payload')),q.get('actor'));
      await route.fulfill({contentType:'text/html',body:`<script>window.top.postMessage(${JSON.stringify({type:'twogether:saved',requestId:q.get('requestId'),result})},'*')</script>`});
    }else{
      const u=new URL(req.url()),cb=u.searchParams.get('callback');await route.fulfill({contentType:'application/javascript',body:cb+'('+JSON.stringify({ok:true,state:b.state()})+')'});
    }
  });
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"></svg>'}));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('.identity-choice[data-actor="Principessa"]').click();
  await page.locator('#shopHub').waitFor({timeout:10000});await page.waitForTimeout(250);
  assert.equal(await page.locator('#twDevToggle').count(),0,'DEV button is removed');
  assert.equal(await page.locator('script[src*="dev-"]').count(),0,'No DEV runtime is loaded');
  assert.equal(await page.evaluate(()=>window.TwogetherShop.getState().tokens),0);

  const plan=await page.evaluate(()=>window.TwogetherAPI.post('savePlan',{meta:{location:'Italy',city:'Verona',start:'2026-09-20',end:'2026-09-22'},budget:200},'Principessa'));
  assert.equal(await page.evaluate(()=>window.TwogetherShop.getState().tokens),5,'new trip log earns 5');
  await page.evaluate(id=>window.TwogetherAPI.post('saveSharedExpense',{planId:id,key:'accom',total:100,mode:'full',paid:100},'Principessa'),plan.planId);
  assert.equal(await page.evaluate(()=>window.TwogetherShop.getState().tokens),10,'distinct expense log earns 5');
  await page.evaluate(id=>window.TwogetherAPI.post('saveSharedExpense',{planId:id,key:'accom',total:100,mode:'full',paid:100},'Principessa'),plan.planId);
  assert.equal(await page.evaluate(()=>window.TwogetherShop.getState().tokens),10,'editing the same log does not farm tokens');

  const sub={location:'Italy',city:'Rome',start:'2026-10-01',end:'2026-10-02',accom:0,travel:0,groceries:0,eat:0,fuel:0,tolls:0,other:0,otherNote:'',paid:0,uncertain:{}};
  const tripId=b.post('saveSubmission',{submission:sub},'Principessa').tripId;b.post('saveSubmission',{tripId,submission:sub},'Principe');
  const confirm=await page.evaluate(id=>window.TwogetherAPI.post('confirmTrip',{id},'Principessa'),tripId);assert.equal(confirm.ok,true);
  assert.equal(await page.evaluate(()=>window.TwogetherShop.getState().tokens),20,'trip confirmation earns 10');

  const month={month:'2026-09',incomes:[{name:'Salary',amount:1000}],expenses:[{group:'rent',name:'Rent',amount:100}],extraBudget:250,extraSpends:[],investmentTotal:'',sisterInvestments:'',finalized:false};
  const draft=await page.evaluate(m=>window.TwogetherAPI.post('saveFinanceMonth',{monthData:m},'Principessa'),month);assert.equal(draft.ok,true);
  assert.equal(await page.evaluate(()=>window.TwogetherShop.getState().tokens),25,'monthly finance log earns 5');
  month.finalized=true;month.finalizedAt=new Date().toISOString();
  const fin=await page.evaluate(m=>window.TwogetherAPI.post('saveFinanceMonth',{monthData:m},'Principessa'),month);assert.equal(fin.ok,true);
  assert.equal(await page.evaluate(()=>window.TwogetherShop.getState().tokens),40,'monthly finance confirmation earns 15');

  await page.locator('#shopHub').click();await page.locator('#shopView').waitFor();
  assert.match(await page.locator('#shopView').innerText(),/5 tokens/);assert.match(await page.locator('#shopView').innerText(),/10 tokens/);assert.match(await page.locator('#shopView').innerText(),/15 tokens/);
  await page.locator('[data-buy="gold-heart"]').click();
  assert.equal(await page.evaluate(()=>window.TwogetherShop.getState().tokens),20);assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('shop-gold-heart')),true);
  assert.deepEqual(errors,[]);
  console.log('Browser v24: DEV absent; +5 log, +10 trip confirm, +15 month confirm, no duplicate farming, shop purchase passed.');
  await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1);});
