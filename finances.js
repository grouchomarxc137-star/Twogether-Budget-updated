(() => {
  'use strict';

  const CONFIG=window.TOGETHER_BUDGET_CONFIG||{};
  const API_URL=String(CONFIG.appsScriptUrl||'').trim();
  const ACTOR_KEY='twogether_actor_v1';
  const ACTORS=['Principessa','Principe'];
  const MONTHS=[['2026-01','Jan 2026'],['2026-02','Feb 2026'],['2026-03','Mar 2026'],['2026-04','Apr 2026'],['2026-05','May 2026'],['2026-06','Jun 2026'],['2026-07','Jul 2026'],['2026-08','Aug 2026'],['2026-09','Sep 2026'],['2026-10','Oct 2026'],['2026-11','Nov 2026'],['2026-12','Dec 2026']];
  const GROUPS=[['health','Medical / insurance'],['subscriptions','Subscriptions'],['living','Rent / household'],['transport','Transport'],['groceries','Groceries'],['extra','Extra / flexible'],['savings','Save up'],['investments','Investments'],['other','Other']];

  let financeState={version:0,finances:{Principessa:[],Principe:[]}};
  let flow=null;
  let selectedMonth='2026-09';
  let loading=false;

  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const n=v=>{const x=Number(String(v??'').replace(',','.'));return Number.isFinite(x)?x:0;};
  const money=v=>'€'+n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const monthLabel=m=>MONTHS.find(x=>x[0]===m)?.[1]||m;
  const groupLabel=g=>GROUPS.find(x=>x[0]===g)?.[1]||g;

  function actor(){
    const current=document.body.dataset.actor||'';
    if(ACTORS.includes(current))return current;
    try{const saved=localStorage.getItem(ACTOR_KEY)||'';return ACTORS.includes(saved)?saved:'';}catch{return '';}
  }
  function toast(msg,tone='ok'){
    const el=$('#toast');if(!el)return;
    el.textContent=msg;el.className='toast show '+tone;clearTimeout(el._financeT);el._financeT=setTimeout(()=>el.className='toast',2600);
  }
  function jsonp(params={}){
    return new Promise((resolve,reject)=>{
      if(!API_URL)return reject(new Error('Backend URL missing'));
      const cb='__twogether_fin_'+Date.now()+'_'+Math.random().toString(36).slice(2),script=document.createElement('script');
      const timer=setTimeout(()=>done(new Error('Sync timed out')),10000);
      function done(err,data){clearTimeout(timer);try{delete window[cb];}catch{}script.remove();err?reject(err):resolve(data);}
      window[cb]=data=>done(null,data);
      const q=new URLSearchParams({...params,callback:cb,_:String(Date.now())});script.src=API_URL+(API_URL.includes('?')?'&':'?')+q.toString();script.onerror=()=>done(new Error('Could not reach Apps Script'));document.head.appendChild(script);
    });
  }
  function post(action,payload){
    return new Promise((resolve,reject)=>{
      const a=actor();if(!API_URL)return reject(new Error('Backend URL missing'));if(!a)return reject(new Error('Choose your profile first'));
      const frame=document.querySelector('iframe[name="backendFrame"]');if(!frame)return reject(new Error('Backend frame missing'));
      const form=document.createElement('form');form.method='POST';form.action=API_URL;form.target='backendFrame';form.style.display='none';
      Object.entries({action,actor:a,payload:JSON.stringify(payload||{})}).forEach(([k,v])=>{const input=document.createElement('input');input.type='hidden';input.name=k;input.value=v;form.appendChild(input);});
      document.body.appendChild(form);form.submit();form.remove();setTimeout(resolve,700);
    });
  }

  function ownMonths(){return financeState.finances?.[actor()]||[];}
  function recordFor(month){return ownMonths().find(x=>x.month===month)||null;}
  function calc(rec){
    const incomes=Array.isArray(rec?.incomes)?rec.incomes:[],expenses=Array.isArray(rec?.expenses)?rec.expenses:[],reserved=Array.isArray(rec?.reserved)?rec.reserved:[];
    const income=incomes.reduce((s,x)=>s+n(x.amount),0),outflow=expenses.reduce((s,x)=>s+n(x.amount),0);
    const savings=expenses.filter(x=>x.group==='savings').reduce((s,x)=>s+n(x.amount),0),investments=expenses.filter(x=>x.group==='investments').reduce((s,x)=>s+n(x.amount),0);
    const extraSpent=expenses.filter(x=>x.group==='extra').reduce((s,x)=>s+n(x.amount),0),extraBudget=n(rec?.extraBudget),leftover=income-outflow,reservedTotal=reserved.reduce((s,x)=>s+n(x.amount),0);
    return {income,outflow,savings,investments,leftover,overspent:Math.max(0,-leftover),extraSpent,extraBudget,extraRemaining:Math.max(0,extraBudget-extraSpent),reservedTotal};
  }

  async function loadState(){
    if(loading||!actor())return;loading=true;
    try{const res=await jsonp({action:'state'});if(res?.ok){financeState={version:Number(res.state?.version||0),finances:{Principessa:Array.isArray(res.state?.finances?.Principessa)?res.state.finances.Principessa:[],Principe:Array.isArray(res.state?.finances?.Principe)?res.state.finances.Principe:[]}};renderPage();}}
    catch{}
    finally{loading=false;}
  }

  function renderPage(){
    const sheet=$('#finances');if(!sheet)return;
    const months=[...ownMonths()].sort((a,b)=>String(a.month).localeCompare(String(b.month)));
    const latest=months[months.length-1]||null,summary=calc(latest||{});
    const summaryRoot=$('#financeSummary');
    if(summaryRoot)summaryRoot.innerHTML=`<div class="finance-kpi"><span>${latest?monthLabel(latest.month):'Latest month'}</span><strong>${latest?'Saved':'Not logged'}</strong></div><div class="finance-kpi"><span>Total income</span><strong>${money(summary.income)}</strong></div><div class="finance-kpi"><span>Total outflow</span><strong>${money(summary.outflow)}</strong></div><div class="finance-kpi ${summary.leftover<0?'bad':summary.income?'good':''}"><span>${summary.leftover<0?'Overspent':'Leftover'}</span><strong>${money(Math.abs(summary.leftover))}</strong></div>`;
    const root=$('#financeMonths');if(!root)return;
    root.innerHTML=MONTHS.map(([key,label])=>{const rec=recordFor(key),c=calc(rec||{});return `<button class="finance-month ${rec?'saved':''} ${key==='2026-09'?'current':''}" type="button" data-fin-month="${key}"><span>${esc(label)}</span><strong>${rec?money(c.leftover):'Not logged'}</strong><small>${rec?`${money(c.income)} in · ${money(c.outflow)} out`:'Tap to start'}</small></button>`;}).join('');
    $$('[data-fin-month]',root).forEach(btn=>btn.addEventListener('click',()=>{selectedMonth=btn.dataset.finMonth;const rec=recordFor(selectedMonth);rec?renderDetail(rec):startMonth(selectedMonth);}));
    const detail=$('#financeDetail');if(detail&&!recordFor(selectedMonth))detail.innerHTML='';
  }

  function renderDetail(rec){
    const root=$('#financeDetail');if(!root)return;const c=calc(rec);
    const expenses=(rec.expenses||[]).map(x=>`<div class="finance-breakdown-row"><span>${esc(x.name)} · ${esc(groupLabel(x.group))}</span><strong>${money(x.amount)}</strong></div>`).join('');
    const incomes=(rec.incomes||[]).map(x=>`<div class="finance-breakdown-row"><span>${esc(x.name)}</span><strong>${money(x.amount)}</strong></div>`).join('');
    root.innerHTML=`<div class="finance-detail-head"><div><span class="panel-kicker">${esc(actor())}</span><h3>${esc(monthLabel(rec.month))}</h3></div><button class="btn ghost" type="button" data-fin-edit>Edit month</button></div><div class="finance-summary-line"><div class="finance-summary-mini"><span>Income</span><strong>${money(c.income)}</strong></div><div class="finance-summary-mini"><span>Outflow</span><strong>${money(c.outflow)}</strong></div><div class="finance-summary-mini"><span>${c.leftover<0?'Overspent':'Leftover'}</span><strong>${money(Math.abs(c.leftover))}</strong></div></div>${incomes?`<div class="finance-review-section"><h3>Income</h3>${incomes}</div>`:''}${expenses?`<div class="finance-review-section"><h3>Monthly outflow</h3>${expenses}</div>`:''}<div class="finance-review-section"><h3>At a glance</h3><div class="finance-breakdown-row"><span>Saved</span><strong>${money(c.savings)}</strong></div><div class="finance-breakdown-row"><span>Invested</span><strong>${money(c.investments)}</strong></div><div class="finance-breakdown-row"><span>Extra budget left</span><strong>${money(c.extraRemaining)}</strong></div>${c.reservedTotal?`<div class="finance-breakdown-row"><span>Reserved / not mine</span><strong>${money(c.reservedTotal)}</strong></div>`:''}</div>`;
    $('[data-fin-edit]',root)?.addEventListener('click',()=>startEdit(rec));
  }

  function freshRecord(month){return {month,incomes:[],expenses:[],extraBudget:'',reserved:[]};}
  function cloneRecord(rec){return JSON.parse(JSON.stringify(rec));}
  function startMonth(month='2026-09'){flow={data:freshRecord(month),stage:'incomeSource',temp:{}};renderWizard();}
  function startEdit(rec){flow={data:cloneRecord(rec),stage:'review',temp:{}};renderWizard();}
  function resetWizard(){flow=null;renderWizard();}
  function setProgress(label,pct){const step=$('#financeWizardStep'),bar=$('#financeWizardProgress');if(step)step.textContent=label;if(bar)bar.style.width=Math.max(8,Math.min(100,pct))+'%';}
  function wizardHtml(title,help,body){return `<div class="finance-question"><h2>${esc(title)}</h2>${help?`<p>${esc(help)}</p>`:''}${body}</div>`;}
  function bindBack(next){$('[data-fin-back]')?.addEventListener('click',next);}
  function listHtml(items,labelFn){return items?.length?`<div class="finance-list">${items.map((x,i)=>`<div class="finance-list-row"><span>${esc(labelFn(x))}</span><strong>${money(x.amount)}</strong></div>`).join('')}</div>`:'';}

  function renderWizard(){
    const body=$('#financeWizardBody');if(!body)return;
    if(!actor()){setProgress('PERSONAL FINANCES',8);body.innerHTML=wizardHtml('Choose your profile first','Your monthly finances are kept separately for Principessa and Principe.','');return;}
    if(!flow){setProgress('MONTHLY FINANCES',8);body.innerHTML=wizardHtml(`Track ${actor()}’s month`,'Use the same one-question-at-a-time style as your trip logging.',`<div class="finance-choice-stack"><button class="finance-choice" type="button" data-fin-start><div><strong>Start a monthly check-in</strong><small>Add income, expenses, savings and investments.</small></div><span>→</span></button></div>`);$('[data-fin-start]')?.addEventListener('click',()=>startMonth(selectedMonth));return;}
    const d=flow.data,t=flow.temp||{};
    if(flow.stage==='month'){
      setProgress('QUESTION 1',10);body.innerHTML=wizardHtml('Which month are you logging?','Choose the month these numbers belong to.',`<select class="finance-select" id="finMonthSelect">${MONTHS.map(([k,l])=>`<option value="${k}" ${k===d.month?'selected':''}>${l}</option>`).join('')}</select><div class="finance-actions"><button class="btn ghost" data-fin-back>Cancel</button><button class="btn primary big" data-fin-next>Next</button></div>`);bindBack(resetWizard);$('[data-fin-next]')?.addEventListener('click',()=>{d.month=$('#finMonthSelect')?.value||d.month;flow.stage='incomeSource';renderWizard();});return;
    }
    if(flow.stage==='incomeSource'){
      setProgress('INCOME',20);body.innerHTML=wizardHtml(d.incomes.length?'Add another income source':'What income did you receive?','Salary, benefits, reimbursements or any other money that came in.',`${listHtml(d.incomes,x=>x.name)}<input class="finance-input" id="finText" placeholder="e.g. Neways"><div class="finance-actions"><button class="btn ghost" data-fin-back>${d.incomes.length?'Done with income':'Cancel'}</button><button class="btn primary big" data-fin-next>Next</button></div>`);bindBack(()=>{if(d.incomes.length){flow.stage='expenseGroup';renderWizard();}else resetWizard();});$('[data-fin-next]')?.addEventListener('click',()=>{const v=String($('#finText')?.value||'').trim();if(!v)return toast('Add the income source first','warn');t.name=v;flow.stage='incomeAmount';renderWizard();});return;
    }
    if(flow.stage==='incomeAmount'){
      setProgress('INCOME',27);body.innerHTML=wizardHtml(`How much came from ${t.name}?`,'Enter the amount you actually received.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);bindBack(()=>{flow.stage='incomeSource';renderWizard();});$('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(!v||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid amount','warn');d.incomes.push({name:t.name,amount:n(v)});flow.temp={};flow.stage='incomeMore';renderWizard();});return;
    }
    if(flow.stage==='incomeMore'){
      setProgress('INCOME',31);body.innerHTML=wizardHtml('Any more income this month?','You can add as many sources as you need.',`${listHtml(d.incomes,x=>x.name)}<div class="finance-choice-stack"><button class="finance-choice" data-fin-yes><div><strong>Yes, add another</strong></div><span>＋</span></button><button class="finance-choice" data-fin-no><div><strong>No, continue to expenses</strong></div><span>→</span></button></div>`);$('[data-fin-yes]')?.addEventListener('click',()=>{flow.stage='incomeSource';renderWizard();});$('[data-fin-no]')?.addEventListener('click',()=>{flow.stage='expenseGroup';renderWizard();});return;
    }
    if(flow.stage==='expenseGroup'){
      setProgress('EXPENSES',42);body.innerHTML=wizardHtml(d.expenses.length?'What kind of expense are you adding?':'What did you spend or set aside?','Savings and investments count as monthly outflow too, just like in your spreadsheet.',`${listHtml(d.expenses,x=>`${x.name} · ${groupLabel(x.group)}`)}<div class="finance-group-grid">${GROUPS.map(([k,l])=>`<button class="finance-choice" data-fin-group="${k}"><div><strong>${esc(l)}</strong></div><span>→</span></button>`).join('')}</div>${d.expenses.length?'<div class="finance-actions"><button class="btn ghost" data-fin-exp-done>Done with expenses</button></div>':''}`);$$('[data-fin-group]').forEach(btn=>btn.addEventListener('click',()=>{t.group=btn.dataset.finGroup;flow.stage='expenseName';renderWizard();}));$('[data-fin-exp-done]')?.addEventListener('click',()=>{flow.stage='extraBudget';renderWizard();});return;
    }
    if(flow.stage==='expenseName'){
      setProgress('EXPENSES',49);body.innerHTML=wizardHtml(`Name this ${groupLabel(t.group).toLowerCase()} expense`,'Use whatever label makes sense to you.',`<input class="finance-input" id="finText" placeholder="e.g. Spotify"><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);bindBack(()=>{flow.stage='expenseGroup';renderWizard();});$('[data-fin-next]')?.addEventListener('click',()=>{const v=String($('#finText')?.value||'').trim();if(!v)return toast('Add the expense name first','warn');t.name=v;flow.stage='expenseAmount';renderWizard();});return;
    }
    if(flow.stage==='expenseAmount'){
      setProgress('EXPENSES',56);body.innerHTML=wizardHtml(`How much was ${t.name}?`,'Enter the amount for this month.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);bindBack(()=>{flow.stage='expenseName';renderWizard();});$('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(!v||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid amount','warn');d.expenses.push({group:t.group,name:t.name,amount:n(v)});flow.temp={};flow.stage='expenseMore';renderWizard();});return;
    }
    if(flow.stage==='expenseMore'){
      setProgress('EXPENSES',60);body.innerHTML=wizardHtml('Anything else this month?','Keep adding expenses, savings or investments until the month is complete.',`${listHtml(d.expenses,x=>`${x.name} · ${groupLabel(x.group)}`)}<div class="finance-choice-stack"><button class="finance-choice" data-fin-yes><div><strong>Yes, add another</strong></div><span>＋</span></button><button class="finance-choice" data-fin-no><div><strong>No, continue</strong></div><span>→</span></button></div>`);$('[data-fin-yes]')?.addEventListener('click',()=>{flow.stage='expenseGroup';renderWizard();});$('[data-fin-no]')?.addEventListener('click',()=>{flow.stage='extraBudget';renderWizard();});return;
    }
    if(flow.stage==='extraBudget'){
      setProgress('BUDGET',70);body.innerHTML=wizardHtml('Did you give yourself an extra spending budget?','This is the flexible amount you allow yourself beyond the planned categories.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(d.extraBudget??''))}" placeholder="0.00"></div><button class="btn ghost full" type="button" data-fin-none style="margin-top:10px">No extra budget</button><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);bindBack(()=>{flow.stage='expenseGroup';renderWizard();});$('[data-fin-none]')?.addEventListener('click',()=>{d.extraBudget=0;flow.stage='reservedAsk';renderWizard();});$('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v&&!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid amount','warn');d.extraBudget=n(v);flow.stage='reservedAsk';renderWizard();});return;
    }
    if(flow.stage==='reservedAsk'){
      setProgress('RESERVED MONEY',78);body.innerHTML=wizardHtml('Any money you’re holding that isn’t really yours?','Optional — useful for things like cash to give back, shared money or paybacks.',`${listHtml(d.reserved,x=>x.name)}<div class="finance-choice-stack"><button class="finance-choice" data-fin-yes><div><strong>Yes, add reserved money</strong></div><span>＋</span></button><button class="finance-choice" data-fin-no><div><strong>No, continue to review</strong></div><span>→</span></button></div>`);$('[data-fin-yes]')?.addEventListener('click',()=>{flow.stage='reservedName';renderWizard();});$('[data-fin-no]')?.addEventListener('click',()=>{flow.stage='review';renderWizard();});return;
    }
    if(flow.stage==='reservedName'){
      setProgress('RESERVED MONEY',82);body.innerHTML=wizardHtml('What is this reserved money for?','Give it a label so you remember why it is excluded.',`<input class="finance-input" id="finText" placeholder="e.g. Payback to sister"><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);bindBack(()=>{flow.stage='reservedAsk';renderWizard();});$('[data-fin-next]')?.addEventListener('click',()=>{const v=String($('#finText')?.value||'').trim();if(!v)return toast('Add a label first','warn');t.name=v;flow.stage='reservedAmount';renderWizard();});return;
    }
    if(flow.stage==='reservedAmount'){
      setProgress('RESERVED MONEY',86);body.innerHTML=wizardHtml(`How much is reserved for ${t.name}?`,'This does not count as monthly spending.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);bindBack(()=>{flow.stage='reservedName';renderWizard();});$('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(!v||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid amount','warn');d.reserved.push({name:t.name,amount:n(v)});flow.temp={};flow.stage='reservedAsk';renderWizard();});return;
    }
    renderReview();
  }

  function renderReview(){
    const body=$('#financeWizardBody');if(!body||!flow)return;const d=flow.data,c=calc(d);setProgress('REVIEW',100);
    const incomeRows=d.incomes.map((x,i)=>`<div class="finance-list-row"><span>${esc(x.name)}</span><strong>${money(x.amount)} <button class="text-btn" data-fin-remove-income="${i}">×</button></strong></div>`).join('')||'<div class="finance-empty">No income added.</div>';
    const expenseRows=d.expenses.map((x,i)=>`<div class="finance-list-row"><span>${esc(x.name)} · ${esc(groupLabel(x.group))}</span><strong>${money(x.amount)} <button class="text-btn" data-fin-remove-expense="${i}">×</button></strong></div>`).join('')||'<div class="finance-empty">No expenses added.</div>';
    body.innerHTML=wizardHtml(`Ready to save ${monthLabel(d.month)}?`,'Review your personal monthly picture before saving.',`<div class="finance-summary-line"><div class="finance-summary-mini"><span>Income</span><strong>${money(c.income)}</strong></div><div class="finance-summary-mini"><span>Outflow</span><strong>${money(c.outflow)}</strong></div><div class="finance-summary-mini"><span>${c.leftover<0?'Overspent':'Leftover'}</span><strong>${money(Math.abs(c.leftover))}</strong></div></div><div class="finance-review-section"><h3>Income</h3>${incomeRows}<button class="btn ghost" data-fin-add-income>Add income</button></div><div class="finance-review-section"><h3>Outflow</h3>${expenseRows}<button class="btn ghost" data-fin-add-expense>Add expense</button></div><div class="finance-review-section"><h3>Plans & pots</h3><div class="finance-breakdown-row"><span>Extra spending budget</span><strong>${money(d.extraBudget)}</strong></div><div class="finance-breakdown-row"><span>Saved</span><strong>${money(c.savings)}</strong></div><div class="finance-breakdown-row"><span>Invested</span><strong>${money(c.investments)}</strong></div><div class="finance-breakdown-row"><span>Reserved / not mine</span><strong>${money(c.reservedTotal)}</strong></div></div><div class="finance-actions"><button class="btn ghost" data-fin-cancel>Cancel</button><button class="btn primary big" data-fin-save>Save month</button></div>`);
    $$('[data-fin-remove-income]').forEach(btn=>btn.addEventListener('click',()=>{d.incomes.splice(Number(btn.dataset.finRemoveIncome),1);renderReview();}));
    $$('[data-fin-remove-expense]').forEach(btn=>btn.addEventListener('click',()=>{d.expenses.splice(Number(btn.dataset.finRemoveExpense),1);renderReview();}));
    $('[data-fin-add-income]')?.addEventListener('click',()=>{flow.stage='incomeSource';renderWizard();});$('[data-fin-add-expense]')?.addEventListener('click',()=>{flow.stage='expenseGroup';renderWizard();});$('[data-fin-cancel]')?.addEventListener('click',resetWizard);$('[data-fin-save]')?.addEventListener('click',saveMonth);
  }

  async function saveMonth(){
    if(!flow)return;const d=cloneRecord(flow.data);if(!d.month)return toast('Choose a month first','warn');
    const btn=$('[data-fin-save]');if(btn)btn.disabled=true;
    try{await post('saveFinanceMonth',{monthData:d});const list=financeState.finances[actor()]||[];const idx=list.findIndex(x=>x.month===d.month);const saved={...d,updatedAt:new Date().toISOString(),updatedBy:actor()};if(idx>=0)list[idx]=saved;else list.push(saved);selectedMonth=d.month;flow=null;renderPage();renderWizard();renderDetail(saved);toast('Monthly finances saved');setTimeout(loadState,1400);}catch(err){toast(err.message||'Could not save month','warn');if(btn)btn.disabled=false;}
  }

  function init(){
    const tab=$('.tab[data-sheet="finances"]');if(!tab)return;
    tab.addEventListener('click',()=>{renderWizard();renderPage();setTimeout(loadState,50);});
    $('#restartFinanceWizard')?.addEventListener('click',resetWizard);
    const obs=new MutationObserver(()=>{if($('#finances')?.classList.contains('active')){renderWizard();renderPage();}});obs.observe(document.body,{attributes:true,attributeFilter:['data-actor']});
    renderWizard();renderPage();
  }
  document.addEventListener('DOMContentLoaded',init);
})();