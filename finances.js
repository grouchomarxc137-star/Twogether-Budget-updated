(() => {
  'use strict';

  const CONFIG = window.TOGETHER_BUDGET_CONFIG || {};
  const API_URL = String(CONFIG.appsScriptUrl || '').trim();
  const ACTOR_KEY = 'twogether_actor_v1';
  const ACTORS = ['Principessa','Principe'];
  const MONTHS = [
    ['2026-01','Jan 2026'],['2026-02','Feb 2026'],['2026-03','Mar 2026'],['2026-04','Apr 2026'],
    ['2026-05','May 2026'],['2026-06','Jun 2026'],['2026-07','Jul 2026'],['2026-08','Aug 2026'],
    ['2026-09','Sep 2026'],['2026-10','Oct 2026'],['2026-11','Nov 2026'],['2026-12','Dec 2026']
  ];
  const GROUPS = [
    {key:'medical',label:'Medical',example:'e.g. Zorgverzekering',tone:'medical',named:true},
    {key:'subscriptions',label:'Subscriptions',example:'e.g. Spotify',tone:'subscriptions',named:true},
    {key:'rent',label:'Rent',defaultName:'Rent',tone:'budgets'},
    {key:'groceries',label:'Groceries',defaultName:'Groceries',tone:'budgets'},
    {key:'extra',label:'Extra',defaultName:'Extra',tone:'budgets',optionalName:true},
    {key:'savings',label:'Save up',defaultName:'Save up',tone:'wealth'},
    {key:'investments',label:'Investments',defaultName:'Investments',tone:'wealth'},
    {key:'other',label:'Other',example:'e.g. Gift',tone:'other',named:true}
  ];
  const RECURRING_INCOMES = [
    {name:'Neways',amount:2051},
    {name:'Belastingdienst',amount:129}
  ];
  const RECURRING_EXPENSES = [
    {group:'medical',name:'Zorgverzekering',amount:158},
    {group:'medical',name:'Liability Insurance',amount:4},
    {group:'rent',name:'Rent',amount:50},
    {group:'subscriptions',name:'Chatgpt Plus',amount:23},
    {group:'subscriptions',name:'Sportcity',amount:28},
    {group:'subscriptions',name:'Spotify',amount:8.5},
    {group:'subscriptions',name:'iCloud',amount:3},
    {group:'subscriptions',name:'NS',amount:100},
    {group:'subscriptions',name:'Oranje Pakketje',amount:4},
    {group:'subscriptions',name:'Odido',amount:30},
    {group:'groceries',name:'Groceries',amount:255},
    {group:'extra',name:'Extra',amount:250},
    {group:'investments',name:'Investments',amount:550},
    {group:'savings',name:'Save up',amount:500}
  ];
  const CATEGORY_ORDER=['medical','subscriptions','budgets','wealth','other'];
  const CATEGORY_LABELS={medical:'Medical',subscriptions:'Subscriptions',budgets:'Budgets',wealth:'Savings / Investments',other:'Other'};

  let financeState = {
    version:0,
    finances:{Principessa:[],Principe:[]},
    financeProfiles:{Principessa:freshProfile(),Principe:freshProfile()}
  };
  let flow = null;
  let selectedMonth = '2026-09';
  let loading = false;

  const $ = (s,r=document) => r.querySelector(s);
  const $$ = (s,r=document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g,ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const n = v => { const x = Number(String(v ?? '').replace(',','.')); return Number.isFinite(x) ? x : 0; };
  const money = v => '€' + n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const signedMoney = v => `${n(v)>=0?'+':'−'}${money(Math.abs(n(v)))}`;
  const monthLabel = m => MONTHS.find(x=>x[0]===m)?.[1] || m;
  const uid = () => (globalThis.crypto?.randomUUID?.() || `fin_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  function actor(){
    const current = document.body.dataset.actor || '';
    if(ACTORS.includes(current)) return current;
    try{
      const saved = localStorage.getItem(ACTOR_KEY) || '';
      return ACTORS.includes(saved) ? saved : '';
    }catch{return '';}
  }

  function normalizeGroup(value){
    const g = String(value || 'other');
    if(g === 'health') return 'medical';
    if(g === 'living') return 'rent';
    if(g === 'transport') return 'subscriptions';
    return GROUPS.some(x=>x.key===g) ? g : 'other';
  }
  function groupMeta(value){
    const key = normalizeGroup(value);
    return GROUPS.find(x=>x.key===key) || GROUPS[GROUPS.length-1];
  }
  function groupLabel(value){ return groupMeta(value).label; }
  function groupTone(value){ return groupMeta(value).tone; }

  function freshProfile(){
    return {bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],updatedAt:'',updatedBy:''};
  }
  function normalizeProfile(profile){
    const p = profile && typeof profile === 'object' ? profile : {};
    return {
      bankAccounts:Array.isArray(p.bankAccounts)?p.bankAccounts.map(x=>({id:x.id||uid(),name:String(x.name||''),balance:x.balance??''})):[],
      savingsTotal:p.savingsTotal??'',
      savingsReserved:Array.isArray(p.savingsReserved)?p.savingsReserved.map(x=>({id:x.id||uid(),name:String(x.name||''),amount:x.amount??''})):[],
      receivables:Array.isArray(p.receivables)?p.receivables.map(x=>({id:x.id||uid(),person:String(x.person||''),reason:String(x.reason||''),amount:x.amount??''})):[],
      updatedAt:p.updatedAt||'',updatedBy:p.updatedBy||''
    };
  }
  function profile(){
    const a = actor();
    return a ? normalizeProfile(financeState.financeProfiles?.[a]) : freshProfile();
  }

  function toast(msg,tone='ok'){
    const el = $('#toast'); if(!el) return;
    el.textContent = msg; el.className = 'toast show ' + tone;
    clearTimeout(el._financeT); el._financeT = setTimeout(()=>el.className='toast',2600);
  }

  function jsonp(params={}){
    return new Promise((resolve,reject)=>{
      if(!API_URL) return reject(new Error('Backend URL missing'));
      const cb='__twogether_fin_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      const script=document.createElement('script');
      const timer=setTimeout(()=>done(new Error('Sync timed out')),10000);
      function done(err,data){
        clearTimeout(timer); try{delete window[cb];}catch{} script.remove(); err?reject(err):resolve(data);
      }
      window[cb]=data=>done(null,data);
      const q=new URLSearchParams({...params,callback:cb,_:String(Date.now())});
      script.src=API_URL+(API_URL.includes('?')?'&':'?')+q.toString();
      script.onerror=()=>done(new Error('Could not reach Apps Script'));
      document.head.appendChild(script);
    });
  }

  function post(action,payload){
    return new Promise((resolve,reject)=>{
      const a=actor();
      if(!API_URL) return reject(new Error('Backend URL missing'));
      if(!a) return reject(new Error('Choose your profile first'));
      const frame=document.querySelector('iframe[name="backendFrame"]');
      if(!frame) return reject(new Error('Backend frame missing'));
      const form=document.createElement('form');
      form.method='POST'; form.action=API_URL; form.target='backendFrame'; form.style.display='none';
      Object.entries({action,actor:a,payload:JSON.stringify(payload||{})}).forEach(([k,v])=>{
        const input=document.createElement('input'); input.type='hidden'; input.name=k; input.value=v; form.appendChild(input);
      });
      document.body.appendChild(form); form.submit(); form.remove(); setTimeout(resolve,700);
    });
  }

  function ownMonths(){ return financeState.finances?.[actor()] || []; }
  function recordFor(month){ return ownMonths().find(x=>x.month===month) || null; }
  function hasValue(v){ return v !== '' && v != null; }

  function calc(rec){
    const incomes=Array.isArray(rec?.incomes)?rec.incomes:[];
    const expenses=Array.isArray(rec?.expenses)?rec.expenses:[];
    const income=incomes.reduce((s,x)=>s+n(x.amount),0);
    const outflow=expenses.reduce((s,x)=>s+n(x.amount),0);
    const savings=expenses.filter(x=>normalizeGroup(x.group)==='savings').reduce((s,x)=>s+n(x.amount),0);
    const investmentContribution=expenses.filter(x=>normalizeGroup(x.group)==='investments').reduce((s,x)=>s+n(x.amount),0);
    const extraSpent=expenses.filter(x=>normalizeGroup(x.group)==='extra').reduce((s,x)=>s+n(x.amount),0);
    const rawExtraBudget=hasValue(rec?.extraBudget)?n(rec.extraBudget):255;
    const extraBudget=rawExtraBudget>0?rawExtraBudget:255;
    const extraDelta=extraBudget-extraSpent;
    const leftover=income-outflow;
    const investmentTotal=hasValue(rec?.investmentTotal)?n(rec.investmentTotal):null;
    const sisterInvestments=hasValue(rec?.sisterInvestments)?n(rec.sisterInvestments):0;
    const ownInvestments=investmentTotal==null?null:Math.max(0,investmentTotal-sisterInvestments);
    return {
      income,outflow,savings,investmentContribution,leftover,overspent:Math.max(0,-leftover),
      extraSpent,extraBudget,extraDelta,extraOver:Math.max(0,-extraDelta),
      investmentTotal,sisterInvestments,ownInvestments
    };
  }

  function investmentGL(rec){
    const current=calc(rec||{});
    if(current.ownInvestments==null) return null;
    const previous=[...ownMonths()]
      .filter(x=>x.month<rec.month && hasValue(x.investmentTotal))
      .sort((a,b)=>String(b.month).localeCompare(String(a.month)))[0];
    if(!previous) return null;
    const prev=calc(previous);
    if(prev.ownInvestments==null) return null;
    return {value:current.ownInvestments-prev.ownInvestments,previousMonth:previous.month,previousValue:prev.ownInvestments};
  }

  function profileStats(){
    const p=profile();
    const bankTotal=p.bankAccounts.reduce((s,x)=>s+n(x.balance),0);
    const savingsTotal=n(p.savingsTotal);
    const heldTotal=p.savingsReserved.reduce((s,x)=>s+n(x.amount),0);
    const availableSavings=savingsTotal-heldTotal;
    const owedTotal=p.receivables.reduce((s,x)=>s+n(x.amount),0);
    const latestInvestment=[...ownMonths()].filter(x=>hasValue(x.investmentTotal)).sort((a,b)=>String(b.month).localeCompare(String(a.month)))[0]||null;
    const inv=latestInvestment?calc(latestInvestment):{investmentTotal:null,sisterInvestments:0,ownInvestments:null};
    const gl=latestInvestment?investmentGL(latestInvestment):null;
    const ownInvestments=inv.ownInvestments==null?0:inv.ownInvestments;
    const netWorth=availableSavings+ownInvestments;
    return {p,bankTotal,savingsTotal,heldTotal,availableSavings,owedTotal,latestInvestment,inv,gl,netWorth};
  }

  async function loadState(){
    if(loading||!actor()) return;
    loading=true;
    try{
      const res=await jsonp({action:'state'});
      if(res?.ok){
        financeState={
          version:Number(res.state?.version||0),
          finances:{
            Principessa:Array.isArray(res.state?.finances?.Principessa)?res.state.finances.Principessa:[],
            Principe:Array.isArray(res.state?.finances?.Principe)?res.state.finances.Principe:[]
          },
          financeProfiles:{
            Principessa:normalizeProfile(res.state?.financeProfiles?.Principessa),
            Principe:normalizeProfile(res.state?.financeProfiles?.Principe)
          }
        };
        renderPage();
      }
    }catch{}
    finally{loading=false;}
  }

  function renderPage(){
    const sheet=$('#finances'); if(!sheet) return;
    const months=[...ownMonths()].sort((a,b)=>String(a.month).localeCompare(String(b.month)));
    const latest=months[months.length-1]||null;
    const summary=calc(latest||{});
    const ps=profileStats();
    const latestGl=latest?investmentGL(latest):null;
    const summaryRoot=$('#financeSummary');
    if(summaryRoot){
      summaryRoot.innerHTML=`
        <div class="finance-kpi"><span>${latest?monthLabel(latest.month):'Latest month'}</span><strong>${latest?(latest.finalized?'Final':'Draft'):'Not logged'}</strong></div>
        <div class="finance-kpi"><span>Total income</span><strong>${money(summary.income)}</strong></div>
        <div class="finance-kpi"><span>Total outflow</span><strong>${money(summary.outflow)}</strong></div>
        <div class="finance-kpi ${summary.leftover<0?'bad':summary.income?'good':''}"><span>${summary.leftover<0?'Overspent':'Leftover'}</span><strong>${money(Math.abs(summary.leftover))}</strong></div>
        <div class="finance-kpi wealth"><span>Current net worth</span><strong>${money(ps.netWorth)}</strong><small>Available savings + your investments</small></div>
        <div class="finance-kpi ${latestGl?.value<0?'bad':latestGl?.value>0?'good':''}"><span>Investment G/L p/m</span><strong>${latestGl?signedMoney(latestGl.value):'—'}</strong><small>${latestGl?`vs ${monthLabel(latestGl.previousMonth)}`:'Log 2 months to compare'}</small></div>`;
    }
    renderCurrentPanel();

    const root=$('#financeMonths'); if(!root) return;
    root.innerHTML=MONTHS.map(([key,label])=>{
      const rec=recordFor(key),c=calc(rec||{}),gl=rec?investmentGL(rec):null;
      const extraWarn=rec&&c.extraOver>0?`<em class="finance-warning">⚠ Extra ${money(c.extraOver)} over</em>`:'';
      const glText=gl?`<em class="finance-month-gl ${gl.value<0?'down':'up'}">${gl.value<0?'▼':'▲'} ${money(Math.abs(gl.value))}</em>`:'';
      return `<button class="finance-month ${rec?'saved':''} ${key==='2026-09'?'current':''}" type="button" data-fin-month="${key}"><span>${esc(label)}</span><strong>${rec?money(c.leftover):'Not logged'}</strong><small>${rec?`${rec.finalized?'Final':'Draft'} · ${money(c.income)} in · ${money(c.outflow)} out`:'Tap to start'}</small>${extraWarn}${glText}</button>`;
    }).join('');
    $$('[data-fin-month]',root).forEach(btn=>btn.addEventListener('click',()=>{
      selectedMonth=btn.dataset.finMonth;
      const rec=recordFor(selectedMonth);
      rec?renderDetail(rec):startMonth(selectedMonth,true);
    }));
    const detail=$('#financeDetail'); if(detail&&!recordFor(selectedMonth)) detail.innerHTML='';
  }

  function renderCurrentPanel(){
    const root=$('#financeCurrent'); if(!root) return;
    const {p,bankTotal,savingsTotal,heldTotal,availableSavings,owedTotal,latestInvestment,inv,gl,netWorth}=profileStats();
    const banks=p.bankAccounts.length?p.bankAccounts.map((x,i)=>`<button class="finance-current-row" type="button" data-fin-edit-bank="${i}"><span>${esc(x.name)}</span><strong>${money(x.balance)}</strong></button>`).join(''):'<div class="finance-current-empty">No bank balances added yet.</div>';
    const holds=p.savingsReserved.length?p.savingsReserved.map((x,i)=>`<button class="finance-current-row" type="button" data-fin-edit-hold="${i}"><span>${esc(x.name)}</span><strong>${money(x.amount)}</strong></button>`).join(''):'<div class="finance-current-empty">Nothing earmarked yet.</div>';
    const owed=p.receivables.length?p.receivables.map((x,i)=>`<button class="finance-current-row" type="button" data-fin-edit-owed="${i}"><span>${esc(x.person)}<small>${x.reason?esc(x.reason):'Reason not added'}</small></span><strong>${money(x.amount)}</strong></button>`).join(''):'<div class="finance-current-empty">Nobody logged as owing you money.</div>';
    root.innerHTML=`
      <div class="finance-current-head"><div><span class="panel-kicker">CURRENT POSITION</span><h2>${esc(actor())}’s balances</h2><p>Bank balances are informational only. Net worth follows your savings + investment method.</p></div></div>
      <div class="finance-current-grid">
        <article class="finance-current-card tone-other"><div class="finance-current-title"><div><span>BANKS</span><h3>Current cash</h3></div><strong>${money(bankTotal)}</strong></div>${banks}<button class="btn ghost finance-add" type="button" data-fin-add-bank>+ Add bank</button><small class="finance-card-note">Not included in net worth.</small></article>
        <article class="finance-current-card tone-wealth"><div class="finance-current-title"><div><span>SAVINGS</span><h3>Saved up</h3></div><strong>${money(availableSavings)}</strong></div><div class="finance-current-metrics"><div><span>Total saved</span><strong>${money(savingsTotal)}</strong></div><div><span>On hold</span><strong>${money(heldTotal)}</strong></div><div class="${availableSavings<0?'negative':''}"><span>Actually available</span><strong>${money(availableSavings)}</strong></div></div>${holds}<div class="finance-card-actions"><button class="btn ghost" type="button" data-fin-edit-savings>Edit saved total</button><button class="btn ghost" type="button" data-fin-add-hold>+ Add hold</button></div></article>
        <article class="finance-current-card tone-receivable"><div class="finance-current-title"><div><span>PAYBACK</span><h3>Money owed to me</h3></div><strong>${money(owedTotal)}</strong></div>${owed}<button class="btn ghost finance-add" type="button" data-fin-add-owed>+ Add money owed</button><small class="finance-card-note">Who owes you, how much, and why you lent it.</small></article>
        <article class="finance-current-card tone-wealth"><div class="finance-current-title"><div><span>INVESTMENTS</span><h3>Your investment value</h3></div><strong>${money(inv.ownInvestments||0)}</strong></div><div class="finance-current-metrics"><div><span>Total account</span><strong>${inv.investmentTotal==null?'—':money(inv.investmentTotal)}</strong></div><div><span>Sis</span><strong>${inv.investmentTotal==null?'—':money(inv.sisterInvestments)}</strong></div><div class="${gl?.value<0?'negative':'positive'}"><span>G/L p/m</span><strong>${gl?signedMoney(gl.value):'—'}</strong></div></div><div class="finance-networth"><span>Current net worth</span><strong>${money(netWorth)}</strong><small>${latestInvestment?`Investment snapshot: ${monthLabel(latestInvestment.month)}`:'Log an investment snapshot in a month'}</small></div></article>
      </div>`;
    $('[data-fin-add-bank]',root)?.addEventListener('click',()=>openBankModal(-1));
    $$('[data-fin-edit-bank]',root).forEach(btn=>btn.addEventListener('click',()=>openBankModal(Number(btn.dataset.finEditBank))));
    $('[data-fin-edit-savings]',root)?.addEventListener('click',openSavingsModal);
    $('[data-fin-add-hold]',root)?.addEventListener('click',()=>openHoldModal(-1));
    $$('[data-fin-edit-hold]',root).forEach(btn=>btn.addEventListener('click',()=>openHoldModal(Number(btn.dataset.finEditHold))));
    $('[data-fin-add-owed]',root)?.addEventListener('click',()=>openOwedModal(-1));
    $$('[data-fin-edit-owed]',root).forEach(btn=>btn.addEventListener('click',()=>openOwedModal(Number(btn.dataset.finEditOwed))));
  }

  function renderDetail(rec){
    const root=$('#financeDetail'); if(!root) return;
    const c=calc(rec),gl=investmentGL(rec);
    const expenses=groupedExpenseHtml(rec.expenses||[],false);
    const incomes=(rec.incomes||[]).map(x=>`<div class="finance-breakdown-row"><span>${esc(x.name)}</span><strong>${money(x.amount)}</strong></div>`).join('');
    const extraStatus=c.extraOver>0?`<div class="finance-alert bad">⚠ You spent ${money(c.extraOver)} more than your Extra budget.</div>`:`<div class="finance-alert good">Extra budget: ${money(c.extraBudget)} · ${money(Math.max(0,c.extraDelta))} left</div>`;
    const investmentBlock=c.investmentTotal!=null?`<div class="finance-review-section"><h3>Investment snapshot</h3><div class="finance-breakdown-row finance-tone-wealth"><span>Total investment account</span><strong>${money(c.investmentTotal)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Sis</span><strong>${money(c.sisterInvestments)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Your investments</span><strong>${money(c.ownInvestments)}</strong></div><div class="finance-breakdown-row ${gl?.value<0?'finance-negative':'finance-positive'}"><span>G/L p/m${gl?` vs ${monthLabel(gl.previousMonth)}`:''}</span><strong>${gl?signedMoney(gl.value):'—'}</strong></div></div>`:'';
    root.innerHTML=`<div class="finance-detail-head"><div><span class="panel-kicker">${esc(actor())}</span><h3>${esc(monthLabel(rec.month))}</h3></div>${rec.finalized?'<span class="finance-final-badge">Final · locked</span>':'<div class="finance-detail-actions"><button class="btn ghost" type="button" data-fin-edit>Edit draft</button><button class="btn primary" type="button" data-fin-finalize-existing>Confirm month</button></div>'}</div><div class="finance-summary-line"><div class="finance-summary-mini"><span>Income</span><strong>${money(c.income)}</strong></div><div class="finance-summary-mini"><span>Outflow</span><strong>${money(c.outflow)}</strong></div><div class="finance-summary-mini"><span>${c.leftover<0?'Overspent':'Leftover'}</span><strong>${money(Math.abs(c.leftover))}</strong></div></div>${extraStatus}${incomes?`<div class="finance-review-section"><h3>Income</h3>${incomes}</div>`:''}${expenses?`<div class="finance-review-section"><h3>Monthly outflow</h3>${expenses}</div>`:''}<div class="finance-review-section"><h3>Monthly allocation</h3><div class="finance-breakdown-row finance-tone-wealth"><span>Save up</span><strong>${money(c.savings)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Investments contribution</span><strong>${money(c.investmentContribution)}</strong></div></div>${investmentBlock}`;
    $('[data-fin-edit]',root)?.addEventListener('click',()=>startEdit(rec));
    $('[data-fin-finalize-existing]',root)?.addEventListener('click',()=>confirmExistingMonth(rec));
  }

  function ensureMiniModal(){
    if($('#financeMiniModal')) return;
    const modal=document.createElement('div');
    modal.id='financeMiniModal'; modal.className='finance-mini-modal'; modal.setAttribute('aria-hidden','true');
    modal.innerHTML='<div class="finance-mini-backdrop" data-fin-mini-close></div><div class="finance-mini-card"><button class="finance-mini-close" type="button" data-fin-mini-close>×</button><div id="financeMiniBody"></div></div>';
    document.body.appendChild(modal);
    $$('[data-fin-mini-close]',modal).forEach(el=>el.addEventListener('click',closeMini));
  }
  function showMini(html){ ensureMiniModal(); $('#financeMiniBody').innerHTML=html; $('#financeMiniModal').classList.add('show'); $('#financeMiniModal').setAttribute('aria-hidden','false'); }
  function closeMini(){ const modal=$('#financeMiniModal'); modal?.classList.remove('show'); modal?.setAttribute('aria-hidden','true'); }

  async function saveProfile(next,message='Balances updated'){
    const a=actor(); if(!a) return;
    const normalized=normalizeProfile(next);
    financeState.financeProfiles[a]=normalized;
    renderPage(); closeMini();
    try{ await post('saveFinanceProfile',{profile:normalized}); toast(message); setTimeout(loadState,1200); }
    catch(err){ toast(err.message||'Could not save','warn'); }
  }

  function openBankModal(index){
    const p=profile(),item=index>=0?p.bankAccounts[index]:null;
    showMini(`<span class="panel-kicker">BANK BALANCE</span><h2>${item?'Edit bank':'Add bank'}</h2><p>Informational only — this does not change your net worth calculation.</p><div class="finance-mini-fields"><label>Bank / account<input id="finMiniName" value="${esc(item?.name||'')}" placeholder="e.g. ING"></label><label>Current balance<div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(item?.balance??''))}" placeholder="0.00"></div></label></div><div class="finance-mini-actions">${item?'<button class="btn ghost" type="button" data-fin-mini-delete>Delete</button>':'<span></span>'}<button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`);
    $('[data-fin-mini-save]')?.addEventListener('click',()=>{
      const name=String($('#finMiniName')?.value||'').trim(),amount=$('#finMiniAmount')?.value||'';
      if(!name)return toast('Add the bank name first','warn'); if(amount===''||!Number.isFinite(Number(amount.replace(',','.'))))return toast('Enter a valid balance','warn');
      const next=profile(); const row={id:item?.id||uid(),name,balance:n(amount)}; if(index>=0)next.bankAccounts[index]=row;else next.bankAccounts.push(row); saveProfile(next,'Bank balance saved');
    });
    $('[data-fin-mini-delete]')?.addEventListener('click',()=>{const next=profile();next.bankAccounts.splice(index,1);saveProfile(next,'Bank removed');});
  }

  function openSavingsModal(){
    const p=profile();
    showMini(`<span class="panel-kicker">SAVED UP</span><h2>Update total savings</h2><p>Enter the full saved-up amount before Twogether subtracts the money you have earmarked/on hold.</p><div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(p.savingsTotal??''))}" placeholder="0.00"></div><div class="finance-mini-actions"><span></span><button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`);
    $('[data-fin-mini-save]')?.addEventListener('click',()=>{const amount=$('#finMiniAmount')?.value||'';if(amount===''||!Number.isFinite(Number(amount.replace(',','.'))))return toast('Enter a valid savings total','warn');const next=profile();next.savingsTotal=n(amount);saveProfile(next,'Savings total updated');});
  }

  function openHoldModal(index){
    const p=profile(),item=index>=0?p.savingsReserved[index]:null;
    showMini(`<span class="panel-kicker">SAVINGS ON HOLD</span><h2>${item?'Edit earmarked money':'Add savings on hold'}</h2><p>This stays inside your total savings, but is subtracted from the amount you consider actually available.</p><div class="finance-mini-fields"><label>What is it reserved for?<input id="finMiniName" value="${esc(item?.name||'')}" placeholder="e.g. Driving licence"></label><label>Amount<div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(item?.amount??''))}" placeholder="0.00"></div></label></div><div class="finance-mini-actions">${item?'<button class="btn ghost" type="button" data-fin-mini-delete>Delete</button>':'<span></span>'}<button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`);
    $('[data-fin-mini-save]')?.addEventListener('click',()=>{const name=String($('#finMiniName')?.value||'').trim(),amount=$('#finMiniAmount')?.value||'';if(!name)return toast('Add what this money is for','warn');if(amount===''||!Number.isFinite(Number(amount.replace(',','.'))))return toast('Enter a valid amount','warn');const next=profile();const row={id:item?.id||uid(),name,amount:n(amount)};if(index>=0)next.savingsReserved[index]=row;else next.savingsReserved.push(row);saveProfile(next,'Savings hold saved');});
    $('[data-fin-mini-delete]')?.addEventListener('click',()=>{const next=profile();next.savingsReserved.splice(index,1);saveProfile(next,'Savings hold removed');});
  }

  function openOwedModal(index){
    const p=profile(),item=index>=0?p.receivables[index]:null;
    showMini(`<span class="panel-kicker">PAYBACK</span><h2>${item?'Edit money owed':'Add money someone owes you'}</h2><p>This is money still expected back from someone — not money you owe.</p><div class="finance-mini-fields"><label>Who owes you?<input id="finMiniPerson" value="${esc(item?.person||'')}" placeholder="e.g. Sis"></label><label>Amount<div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(item?.amount??''))}" placeholder="0.00"></div></label><label class="full">Why did you lend it?<input id="finMiniReason" value="${esc(item?.reason||'')}" placeholder="e.g. Flight ticket"></label></div><div class="finance-mini-actions">${item?'<button class="btn ghost" type="button" data-fin-mini-delete>Delete</button>':'<span></span>'}<button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`);
    $('[data-fin-mini-save]')?.addEventListener('click',()=>{const person=String($('#finMiniPerson')?.value||'').trim(),reason=String($('#finMiniReason')?.value||'').trim(),amount=$('#finMiniAmount')?.value||'';if(!person)return toast('Add who owes you first','warn');if(!reason)return toast('Add why you lent it','warn');if(amount===''||!Number.isFinite(Number(amount.replace(',','.'))))return toast('Enter a valid amount','warn');const next=profile();const row={id:item?.id||uid(),person,reason,amount:n(amount)};if(index>=0)next.receivables[index]=row;else next.receivables.push(row);saveProfile(next,'Money owed saved');});
    $('[data-fin-mini-delete]')?.addEventListener('click',()=>{const next=profile();next.receivables.splice(index,1);saveProfile(next,'Money owed removed');});
  }

  function freshRecord(month){ return {month,incomes:[],expenses:[],extraBudget:255,investmentTotal:'',sisterInvestments:'',finalized:false,finalizedAt:''}; }
  function cloneRecord(rec){
    const copy=JSON.parse(JSON.stringify(rec));
    copy.expenses=(copy.expenses||[]).map(x=>({...x,group:normalizeGroup(x.group)}));
    if(!hasValue(copy.extraBudget)||n(copy.extraBudget)<=0)copy.extraBudget=255;
    copy.finalized=copy.finalized===true; if(!copy.finalizedAt)copy.finalizedAt='';
    if(copy.investmentTotal==null)copy.investmentTotal=''; if(copy.sisterInvestments==null)copy.sisterInvestments='';
    return copy;
  }
  function startMonth(month='2026-09',skipMonth=false){ const target=month||selectedMonth; if(skipMonth){startRecurringMonth(target);return;} flow={data:freshRecord(target),stage:'month',temp:{}}; renderWizard(); }
  function startEdit(rec){ if(rec?.finalized===true)return toast('This month is final and locked','warn'); flow={data:cloneRecord(rec),stage:'review',temp:{}}; renderWizard(); }
  function resetWizard(){ flow=null; renderWizard(); }
  function setProgress(label,pct){ const step=$('#financeWizardStep'),bar=$('#financeWizardProgress'); if(step)step.textContent=label; if(bar)bar.style.width=Math.max(8,Math.min(100,pct))+'%'; }
  function wizardHtml(title,help,body){ return `<div class="finance-question"><h2>${esc(title)}</h2>${help?`<p>${esc(help)}</p>`:''}${body}</div>`; }
  function bindBack(next){ $('[data-fin-back]')?.addEventListener('click',next); }
  function listHtml(items,labelFn){ return items?.length?`<div class="finance-list">${items.map(x=>`<div class="finance-list-row"><span>${esc(labelFn(x))}</span><strong>${money(x.amount)}</strong></div>`).join('')}</div>`:''; }

  function latestPriorMonth(month){
    return [...ownMonths()].filter(x=>String(x.month)<String(month)).sort((a,b)=>String(b.month).localeCompare(String(a.month)))[0]||null;
  }
  function recurringValue(previous,kind,name,fallback){
    if(!previous) return fallback;
    const list=kind==='income'?(previous.incomes||[]):(previous.expenses||[]);
    const match=list.find(x=>String(x.name||'').trim().toLowerCase()===String(name).trim().toLowerCase());
    return match&&hasValue(match.amount)?n(match.amount):fallback;
  }
  function seededRecord(month){
    const previous=latestPriorMonth(month),d=freshRecord(month);
    d.incomes=RECURRING_INCOMES.map(x=>({name:x.name,amount:recurringValue(previous,'income',x.name,x.amount)}));
    d.expenses=RECURRING_EXPENSES.map(x=>({group:x.group,name:x.name,amount:recurringValue(previous,'expense',x.name,x.amount)}));
    if(previous&&hasValue(previous.extraBudget)&&n(previous.extraBudget)>0) d.extraBudget=n(previous.extraBudget);
    return d;
  }
  function buildRecurringQueue(d){
    return [
      ...(d.incomes||[]).map((_,index)=>({kind:'income',index})),
      ...(d.expenses||[]).map((_,index)=>({kind:'expense',index}))
    ];
  }
  function recurringSource(item,d){ return item?.kind==='income'?d.incomes?.[item.index]:d.expenses?.[item.index]; }
  function startRecurringMonth(month){
    const d=seededRecord(month||selectedMonth);
    flow={data:d,stage:'recurringCheck',temp:{},recurringQueue:buildRecurringQueue(d),recurringIndex:0};
    renderWizard();
  }
  function groupedExpenseHtml(items,removable=false){
    const rows=(items||[]).map((x,index)=>({...x,index,group:normalizeGroup(x.group),tone:groupTone(x.group)}));
    const grouped={};
    rows.forEach(x=>(grouped[x.tone]||(grouped[x.tone]=[])).push(x));
    return CATEGORY_ORDER.filter(tone=>grouped[tone]?.length).map(tone=>{
      const group=grouped[tone],total=group.reduce((sum,x)=>sum+n(x.amount),0);
      const itemRows=group.map(x=>{
        const label=x.group==='extra'&&x.name&&x.name!=='Extra'?`Extra · ${esc(x.name)}`:esc(x.name||groupLabel(x.group));
        const remove=removable?` <button class="text-btn" data-fin-remove-expense="${x.index}">×</button>`:'';
        return `<div class="finance-category-item"><span>${label}</span><strong>${money(x.amount)}${remove}</strong></div>`;
      }).join('');
      return `<div class="finance-category-bubble finance-tone-${tone}"><div class="finance-category-head"><strong>${esc(CATEGORY_LABELS[tone]||tone)}</strong><span>${money(total)}</span></div>${itemRows}</div>`;
    }).join('');
  }

  function renderWizard(){
    const body=$('#financeWizardBody'); if(!body) return;
    if(!actor()){ setProgress('PERSONAL FINANCES',8); body.innerHTML=wizardHtml('Choose your profile first','Your monthly finances are kept separately for Principessa and Principe.',''); return; }
    if(!flow){
      setProgress('MONTHLY FINANCES',8);
      body.innerHTML=wizardHtml(`Track ${actor()}’s month`,'One question at a time, just like trip logging.',`<div class="finance-choice-stack"><button class="finance-choice" type="button" data-fin-start><div><strong>Start a monthly check-in</strong><small>Income, colored expenses, €255 Extra budget, savings and investments.</small></div><span>→</span></button></div>`);
      $('[data-fin-start]')?.addEventListener('click',()=>startMonth(selectedMonth,false)); return;
    }
    const d=flow.data,t=flow.temp||{};

    if(flow.stage==='month'){
      setProgress('QUESTION 1',10);
      body.innerHTML=wizardHtml('Which month are you logging?','Choose the month these numbers belong to.',`<select class="finance-select" id="finMonthSelect">${MONTHS.map(([k,l])=>`<option value="${k}" ${k===d.month?'selected':''}>${l}</option>`).join('')}</select><div class="finance-actions"><button class="btn ghost" data-fin-back>Cancel</button><button class="btn primary big" data-fin-next>Next</button></div>`);
      bindBack(resetWizard); $('[data-fin-next]')?.addEventListener('click',()=>{const chosen=$('#finMonthSelect')?.value||d.month;startRecurringMonth(chosen);}); return;
    }

    if(flow.stage==='recurringCheck'){
      const queue=flow.recurringQueue||buildRecurringQueue(d),idx=Number(flow.recurringIndex||0);
      if(idx>=queue.length){flow.stage='extraBudget';renderWizard();return;}
      const item=queue[idx],source=recurringSource(item,d);
      if(!source){flow.recurringIndex=idx+1;renderWizard();return;}
      const meta=item.kind==='income'?{label:'Income',tone:'other'}:{label:CATEGORY_LABELS[groupTone(source.group)]||groupLabel(source.group),tone:groupTone(source.group)};
      const pct=12+Math.round(((idx+1)/Math.max(1,queue.length))*48);
      setProgress(`CHECKING ${idx+1} OF ${queue.length}`,pct);
      body.innerHTML=wizardHtml(`${source.name} · ${money(source.amount)}?`,`Recurring ${item.kind==='income'?'income':meta.label.toLowerCase()}. Confirm it if it is still correct, or edit only the amount.`,`<div class="finance-reference finance-tone-${meta.tone}"><span>${esc(meta.label)}</span><strong>${esc(source.name)}</strong><small>Usual amount · ${money(source.amount)}</small></div><div class="finance-actions"><button class="btn ghost" type="button" data-fin-recurring-edit>Edit</button><button class="btn primary big" type="button" data-fin-recurring-confirm>Confirm</button></div>`);
      $('[data-fin-recurring-confirm]')?.addEventListener('click',()=>{flow.recurringIndex=idx+1;renderWizard();});
      $('[data-fin-recurring-edit]')?.addEventListener('click',()=>{flow.temp={recurringItem:item};flow.stage='recurringEdit';renderWizard();});
      return;
    }

    if(flow.stage==='recurringEdit'){
      const item=t.recurringItem,source=recurringSource(item,d),idx=Number(flow.recurringIndex||0);
      if(!item||!source){flow.stage='recurringCheck';renderWizard();return;}
      setProgress(`EDITING ${idx+1} OF ${(flow.recurringQueue||[]).length}`,20+Math.round(((idx+1)/Math.max(1,(flow.recurringQueue||[]).length))*40));
      body.innerHTML=wizardHtml(`Update ${source.name}`,'Change only this month’s amount. The value you save becomes next month’s suggestion.',`<div class="finance-reference"><span>Current suggestion</span><strong>${money(source.amount)}</strong></div><div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(source.amount??''))}" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Save & continue</button></div>`);
      bindBack(()=>{flow.stage='recurringCheck';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid amount','warn');source.amount=n(v);flow.temp={};flow.recurringIndex=idx+1;flow.stage='recurringCheck';renderWizard();});
      return;
    }

    if(flow.stage==='incomeSource'){
      setProgress('INCOME',20);
      body.innerHTML=wizardHtml(d.incomes.length?'Add another income source':'What income did you receive?','Salary, benefits, reimbursements or any other money that came in.',`${listHtml(d.incomes,x=>x.name)}<input class="finance-input" id="finText" placeholder="e.g. Neways"><div class="finance-actions"><button class="btn ghost" data-fin-back>${d.incomes.length?'Done with income':'Cancel'}</button><button class="btn primary big" data-fin-next>Next</button></div>`);
      bindBack(()=>{if(d.incomes.length){flow.stage='expenseGroup';renderWizard();}else resetWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=String($('#finText')?.value||'').trim();if(!v)return toast('Add the income source first','warn');t.name=v;flow.stage='incomeAmount';renderWizard();}); return;
    }

    if(flow.stage==='incomeAmount'){
      setProgress('INCOME',27);
      body.innerHTML=wizardHtml(`How much came from ${t.name}?`,'Enter the amount you actually received.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);
      bindBack(()=>{flow.stage='incomeSource';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid amount','warn');d.incomes.push({name:t.name,amount:n(v)});flow.temp={};flow.stage='incomeMore';renderWizard();}); return;
    }

    if(flow.stage==='incomeMore'){
      setProgress('INCOME',31);
      body.innerHTML=wizardHtml('Any more income this month?','You can add as many sources as you need.',`${listHtml(d.incomes,x=>x.name)}<div class="finance-choice-stack"><button class="finance-choice" data-fin-yes><div><strong>Yes, add another</strong></div><span>＋</span></button><button class="finance-choice" data-fin-no><div><strong>No, continue to expenses</strong></div><span>→</span></button></div>`);
      $('[data-fin-yes]')?.addEventListener('click',()=>{flow.stage='incomeSource';renderWizard();}); $('[data-fin-no]')?.addEventListener('click',()=>{flow.stage='expenseGroup';renderWizard();}); return;
    }

    if(flow.stage==='expenseGroup'){
      setProgress('EXPENSES',42);
      body.innerHTML=wizardHtml(d.expenses.length?'What kind of expense are you adding?':'What did you spend or set aside?','Colors follow your spreadsheet groups: Medical, Subscriptions, Budgets, Savings/Investments and Other.',`${listHtml(d.expenses,x=>`${x.name} · ${groupLabel(x.group)}`)}<div class="finance-group-grid">${GROUPS.map(g=>`<button class="finance-choice finance-tone-${g.tone}" data-fin-group="${g.key}"><div><strong>${esc(g.label)}</strong><small>${g.example?esc(g.example):g.defaultName?'Name filled automatically':''}</small></div><span>→</span></button>`).join('')}</div>${d.expenses.length?'<div class="finance-actions"><button class="btn ghost" data-fin-exp-done>Done with expenses</button></div>':''}`);
      $$('[data-fin-group]').forEach(btn=>btn.addEventListener('click',()=>{
        const meta=groupMeta(btn.dataset.finGroup); flow.temp={group:meta.key};
        if(meta.optionalName){flow.temp.name=meta.defaultName;flow.stage='expenseOptionalName';}
        else if(meta.defaultName){flow.temp.name=meta.defaultName;flow.stage='expenseAmount';}
        else flow.stage='expenseName';
        renderWizard();
      }));
      $('[data-fin-exp-done]')?.addEventListener('click',()=>{flow.stage='extraBudget';renderWizard();}); return;
    }

    if(flow.stage==='expenseName'){
      const meta=groupMeta(t.group); setProgress('EXPENSES',49);
      body.innerHTML=wizardHtml(`Name this ${meta.label.toLowerCase()} expense`,meta.example||'Use whatever label makes sense to you.',`<input class="finance-input" id="finText" placeholder="${esc(meta.example||'Expense name')}"><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);
      bindBack(()=>{flow.stage='expenseGroup';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=String($('#finText')?.value||'').trim();if(!v)return toast('Add the expense name first','warn');t.name=v;flow.stage='expenseAmount';renderWizard();}); return;
    }

    if(flow.stage==='expenseOptionalName'){
      setProgress('EXPENSES',49);
      body.innerHTML=wizardHtml('What was this Extra spend for?','Optional. Leave it as “Extra”, or add a subcategory/reason such as clothes, games or going out.',`<input class="finance-input" id="finText" placeholder="e.g. Clothes"><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn ghost" data-fin-skip>Skip · use Extra</button><button class="btn primary big" data-fin-next>Next</button></div>`);
      bindBack(()=>{flow.stage='expenseGroup';renderWizard();});
      $('[data-fin-skip]')?.addEventListener('click',()=>{t.name='Extra';flow.stage='expenseAmount';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=String($('#finText')?.value||'').trim();t.name=v||'Extra';flow.stage='expenseAmount';renderWizard();}); return;
    }

    if(flow.stage==='expenseAmount'){
      const meta=groupMeta(t.group); setProgress('EXPENSES',56);
      body.innerHTML=wizardHtml(`How much was ${t.name}?`,meta.key==='extra'?`This counts toward your ${money(hasValue(d.extraBudget)?d.extraBudget:255)} monthly Extra budget.`:'Enter the amount for this month.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);
      bindBack(()=>{if(meta.optionalName)flow.stage='expenseOptionalName';else if(meta.defaultName)flow.stage='expenseGroup';else flow.stage='expenseName';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid amount','warn');d.expenses.push({group:t.group,name:t.name,amount:n(v)});flow.temp={};flow.stage='expenseMore';renderWizard();}); return;
    }

    if(flow.stage==='expenseMore'){
      setProgress('EXPENSES',60);
      body.innerHTML=wizardHtml('Anything else this month?','Keep adding expenses, Save up or Investments until the month is complete.',`${listHtml(d.expenses,x=>`${x.name} · ${groupLabel(x.group)}`)}<div class="finance-choice-stack"><button class="finance-choice" data-fin-yes><div><strong>Yes, add another</strong></div><span>＋</span></button><button class="finance-choice" data-fin-no><div><strong>No, continue</strong></div><span>→</span></button></div>`);
      $('[data-fin-yes]')?.addEventListener('click',()=>{flow.stage='expenseGroup';renderWizard();}); $('[data-fin-no]')?.addEventListener('click',()=>{flow.stage='extraBudget';renderWizard();}); return;
    }

    if(flow.stage==='extraBudget'){
      setProgress('EXTRA BUDGET',70);
      body.innerHTML=wizardHtml('What is your Extra budget this month?','Default is €255. You can change it for a specific month. Twogether will warn you if your Extra spending goes above it.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(hasValue(d.extraBudget)?d.extraBudget:255))}" placeholder="255.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);
      bindBack(()=>{flow.stage='expenseGroup';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid Extra budget','warn');d.extraBudget=n(v);flow.stage='investmentTotal';renderWizard();}); return;
    }

    if(flow.stage==='investmentTotal'){
      setProgress('INVESTMENTS',80);
      body.innerHTML=wizardHtml('What is the investment account worth now?','Enter the full current investment value for this month. This is separate from how much you contributed this month.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(d.investmentTotal??''))}" placeholder="0.00"></div><button class="btn ghost full" type="button" data-fin-skip style="margin-top:10px">Skip investment snapshot this month</button><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);
      bindBack(()=>{flow.stage='extraBudget';renderWizard();});
      $('[data-fin-skip]')?.addEventListener('click',()=>{d.investmentTotal='';d.sisterInvestments='';flow.stage='review';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid investment total','warn');d.investmentTotal=n(v);flow.stage='sisterInvestments';renderWizard();}); return;
    }

    if(flow.stage==='sisterInvestments'){
      setProgress('INVESTMENTS',88);
      body.innerHTML=wizardHtml('How much of that belongs to Sis?','Twogether subtracts Sis’s amount from the total to calculate your own investment value.',`<div class="finance-reference"><span>Total investment account</span><strong>${money(d.investmentTotal)}</strong></div><div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(d.sisterInvestments??0))}" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Review</button></div>`);
      bindBack(()=>{flow.stage='investmentTotal';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'0';if(!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid amount','warn');d.sisterInvestments=n(v);if(n(d.sisterInvestments)>n(d.investmentTotal))return toast('Sis’s amount cannot be higher than the investment total','warn');flow.stage='review';renderWizard();}); return;
    }

    renderReview();
  }

  function renderReview(){
    const body=$('#financeWizardBody'); if(!body||!flow) return;
    const d=flow.data,c=calc(d),gl=investmentGL(d); setProgress('REVIEW',100);
    const incomeRows=d.incomes.map((x,i)=>`<div class="finance-list-row"><span>${esc(x.name)}</span><strong>${money(x.amount)} <button class="text-btn" data-fin-remove-income="${i}">×</button></strong></div>`).join('')||'<div class="finance-empty">No income added.</div>';
    const expenseRows=groupedExpenseHtml(d.expenses,true)||'<div class="finance-empty">No expenses added.</div>';
    const extraLine=c.extraOver>0?`<div class="finance-alert bad">⚠ Extra budget exceeded by ${money(c.extraOver)} · spent ${money(c.extraSpent)} of ${money(c.extraBudget)}</div>`:`<div class="finance-alert good">Extra: ${money(c.extraSpent)} spent of ${money(c.extraBudget)} · ${money(Math.max(0,c.extraDelta))} left</div>`;
    const investmentLines=c.investmentTotal==null?'<div class="finance-breakdown-row"><span>Investment snapshot</span><strong>Skipped</strong></div>':`<div class="finance-breakdown-row finance-tone-wealth"><span>Total investments</span><strong>${money(c.investmentTotal)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Sis</span><strong>${money(c.sisterInvestments)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Your investments</span><strong>${money(c.ownInvestments)}</strong></div><div class="finance-breakdown-row ${gl?.value<0?'finance-negative':'finance-positive'}"><span>G/L p/m${gl?` vs ${monthLabel(gl.previousMonth)}`:''}</span><strong>${gl?signedMoney(gl.value):'—'}</strong></div>`;
    body.innerHTML=wizardHtml(`Ready to save ${monthLabel(d.month)}?`,'Review your personal monthly picture before saving.',`<div class="finance-summary-line"><div class="finance-summary-mini"><span>Income</span><strong>${money(c.income)}</strong></div><div class="finance-summary-mini"><span>Outflow</span><strong>${money(c.outflow)}</strong></div><div class="finance-summary-mini"><span>${c.leftover<0?'Overspent':'Leftover'}</span><strong>${money(Math.abs(c.leftover))}</strong></div></div>${extraLine}<div class="finance-review-section"><h3>Income</h3>${incomeRows}<button class="btn ghost" data-fin-add-income>Add income</button></div><div class="finance-review-section"><h3>Outflow</h3>${expenseRows}<button class="btn ghost" data-fin-add-expense>Add expense</button></div><div class="finance-review-section"><h3>Monthly allocation</h3><div class="finance-breakdown-row finance-tone-wealth"><span>Save up</span><strong>${money(c.savings)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Investments contribution</span><strong>${money(c.investmentContribution)}</strong></div><div class="finance-breakdown-row"><span>Extra budget</span><strong>${money(c.extraBudget)} <button class="text-btn" data-fin-edit-extra>Edit</button></strong></div></div><div class="finance-review-section"><h3>Investment tracking</h3>${investmentLines}<button class="btn ghost" data-fin-edit-investments>Edit investment snapshot</button></div><div class="finance-actions finance-save-actions"><button class="btn ghost" data-fin-cancel>Cancel</button><div><button class="btn ghost" data-fin-save-draft>Save draft</button><button class="btn primary big" data-fin-finalize>Confirm month</button></div></div>`);
    $$('[data-fin-remove-income]').forEach(btn=>btn.addEventListener('click',()=>{d.incomes.splice(Number(btn.dataset.finRemoveIncome),1);renderReview();}));
    $$('[data-fin-remove-expense]').forEach(btn=>btn.addEventListener('click',()=>{d.expenses.splice(Number(btn.dataset.finRemoveExpense),1);renderReview();}));
    $('[data-fin-add-income]')?.addEventListener('click',()=>{flow.stage='incomeSource';renderWizard();});
    $('[data-fin-add-expense]')?.addEventListener('click',()=>{flow.stage='expenseGroup';renderWizard();});
    $('[data-fin-edit-extra]')?.addEventListener('click',()=>{flow.stage='extraBudget';renderWizard();});
    $('[data-fin-edit-investments]')?.addEventListener('click',()=>{flow.stage='investmentTotal';renderWizard();});
    $('[data-fin-cancel]')?.addEventListener('click',resetWizard);
    $('[data-fin-save-draft]')?.addEventListener('click',()=>saveMonth(false));
    $('[data-fin-finalize]')?.addEventListener('click',()=>saveMonth(true));
  }

  async function confirmExistingMonth(rec){
    if(!rec||rec.finalized===true)return;
    if(financeState.version<10)return toast('Final locking needs the latest backend deployment','warn');
    const d=cloneRecord(rec); d.finalized=true; d.finalizedAt=new Date().toISOString();
    try{
      await post('saveFinanceMonth',{monthData:d});
      const list=financeState.finances[actor()]||[]; const idx=list.findIndex(x=>x.month===d.month);
      const saved={...d,updatedAt:new Date().toISOString(),updatedBy:actor()};
      if(idx>=0)list[idx]=saved; else list.push(saved);
      renderPage(); renderDetail(saved); toast('Month confirmed and locked'); setTimeout(loadState,1200);
    }catch(err){toast(err.message||'Could not confirm month','warn');}
  }

  async function saveMonth(finalize=false){
    if(!flow) return;
    const d=cloneRecord(flow.data); if(!d.month) return toast('Choose a month first','warn');
    if(finalize&&financeState.version<10)return toast('Final locking needs the latest backend deployment','warn');
    d.finalized=!!finalize; d.finalizedAt=finalize?new Date().toISOString():'';
    const btn=$(finalize?'[data-fin-finalize]':'[data-fin-save-draft]'); if(btn) btn.disabled=true;
    try{
      await post('saveFinanceMonth',{monthData:d});
      const list=financeState.finances[actor()]||[];
      const idx=list.findIndex(x=>x.month===d.month);
      const saved={...d,updatedAt:new Date().toISOString(),updatedBy:actor()};
      if(idx>=0)list[idx]=saved;else list.push(saved);
      list.sort((a,b)=>String(a.month).localeCompare(String(b.month)));
      selectedMonth=d.month; flow=null; renderPage(); renderWizard(); renderDetail(saved); toast(finalize?'Month confirmed and locked':'Draft saved — you can keep editing it'); setTimeout(loadState,1400);
    }catch(err){ toast(err.message||'Could not save month','warn'); if(btn)btn.disabled=false; }
  }

  function init(){
    const tab=$('.tab[data-sheet="finances"]'); if(!tab) return;
    ensureMiniModal();
    tab.addEventListener('click',()=>{renderWizard();renderPage();setTimeout(loadState,50);});
    $('#restartFinanceWizard')?.addEventListener('click',resetWizard);
    const obs=new MutationObserver(()=>{if($('#finances')?.classList.contains('active')){flow=null;renderWizard();renderPage();setTimeout(loadState,40);}});
    obs.observe(document.body,{attributes:true,attributeFilter:['data-actor']});
    renderWizard(); renderPage();
  }

  document.addEventListener('DOMContentLoaded',init);
})();