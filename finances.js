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
    {key:'rent',label:'Rent',defaultName:'Rent',tone:'subscriptions'},
    {key:'groceries',label:'Groceries',defaultName:'Groceries',tone:'budgets'},
    {key:'extra',label:'Extra',defaultName:'Extra',tone:'budgets',optionalName:true,manual:false},
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
    return {bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],wishlist:[],compareLab:{},updatedAt:'',updatedBy:''};
  }
  function normalizeProfile(profile){
    const p = profile && typeof profile === 'object' ? profile : {};
    return {
      bankAccounts:Array.isArray(p.bankAccounts)?p.bankAccounts.map(x=>({id:x.id||uid(),name:String(x.name||''),balance:x.balance??''})):[],
      savingsTotal:p.savingsTotal??'',
      savingsReserved:Array.isArray(p.savingsReserved)?p.savingsReserved.map(x=>({id:x.id||uid(),name:String(x.name||''),amount:x.amount??''})):[],
      receivables:Array.isArray(p.receivables)?p.receivables.map(x=>({
        id:x.id||uid(),person:String(x.person||''),reason:String(x.reason||''),
        principal:x.principal??x.amount??'',
        repayments:Array.isArray(x.repayments)?x.repayments.map(r=>({id:r.id||uid(),month:String(r.month||''),amount:r.amount??'',at:String(r.at||'')})):[]
      })):[],
      scenarios:Array.isArray(p.scenarios)?p.scenarios.map(x=>({id:x.id||uid(),name:String(x.name||''),upfront:x.upfront??'',monthly:x.monthly??''})):[],
      wishlist:Array.isArray(p.wishlist)?JSON.parse(JSON.stringify(p.wishlist)):[],
      compareLab:p.compareLab&&typeof p.compareLab==='object'?JSON.parse(JSON.stringify(p.compareLab)):{},
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

  function post(action,payload){return window.TwogetherAPI.post(action,payload,actor());}

  function ownMonths(){ return financeState.finances?.[actor()] || []; }
  function recordFor(month){ return ownMonths().find(x=>x.month===month) || null; }
  function hasValue(v){ return v !== '' && v != null; }
  function normalizeFinanceRecord(rec){
    const copy=JSON.parse(JSON.stringify(rec||{}));
    copy.expenses=Array.isArray(copy.expenses)?copy.expenses.map(x=>({...x,group:normalizeGroup(x.group)})):[];
    const fixedExtras=copy.expenses.filter(x=>normalizeGroup(x.group)==='extra' && String(x.name||'').trim().toLowerCase()==='extra');
    const storedBudget=hasValue(copy.extraBudget)?n(copy.extraBudget):(fixedExtras.length&&hasValue(fixedExtras[0].amount)?n(fixedExtras[0].amount):250);
    copy.extraBudget=storedBudget;
    copy.expenses=copy.expenses.filter(x=>normalizeGroup(x.group)!=='extra' || String(x.name||'').trim().toLowerCase()!=='extra' || x===fixedExtras[0]);
    if(!copy.expenses.some(x=>normalizeGroup(x.group)==='extra' && String(x.name||'').trim().toLowerCase()==='extra')) copy.expenses.push({group:'extra',name:'Extra',amount:storedBudget});
    copy.expenses.forEach(x=>{ if(normalizeGroup(x.group)==='extra' && String(x.name||'').trim().toLowerCase()==='extra') x.amount=storedBudget; });
    copy.extraSpends=Array.isArray(copy.extraSpends)?copy.extraSpends.map(x=>({id:x.id||uid(),source:['creditcard','savings','main'].includes(String(x.source||''))?String(x.source):'',amount:n(x.amount)})).filter(x=>x.source&&x.amount>0):[];
    if(!copy.extraSpends.length){
      const legacySource=['creditcard','savings','main'].includes(String(copy.extraOverspendSource||''))?String(copy.extraOverspendSource):'';
      const legacyAmount=hasValue(copy.extraOverspendAmount)?Math.max(0,n(copy.extraOverspendAmount)):0;
      if(legacySource&&legacyAmount>0) copy.extraSpends.push({id:uid(),source:legacySource,amount:legacyAmount});
    }
    const legacyFirst=copy.extraSpends[0]||null;
    copy.extraOverspendSource=legacyFirst?.source||'';
    copy.extraOverspendAmount=copy.extraSpends.reduce((sum,x)=>sum+n(x.amount),0);
    return copy;
  }

  function extraSourceLabel(source){
    if(source==='savings') return 'From Saved Up';
    if(source==='main') return 'From Main account leftover';
    return 'Credit Card';
  }

  function previousMonthKey(month){
    const match=/^(\d{4})-(\d{2})$/.exec(String(month||''));
    if(!match) return '';
    let y=Number(match[1]),m=Number(match[2])-1;
    if(m===0){y-=1;m=12;}
    return `${y}-${String(m).padStart(2,'0')}`;
  }

  function extraSpendsTotal(rec){ return (rec?.extraSpends||[]).reduce((sum,x)=>sum+n(x.amount),0); }

  function extraCarryInfo(month){
    const prevMonth=previousMonthKey(month),prev=prevMonth?recordFor(prevMonth):null;
    const over=prev?extraSpendsTotal(prev):0;
    return {
      prevMonth,
      over,
      budget:over>0?Math.max(100,250-Math.min(150,over)):250,
      debt:Math.max(0,over-150)
    };
  }

  function mainAccountLeftover(){ return ownMonths().reduce((sum,rec)=>sum+calc(rec).leftover,0); }

  function extraSpendSummary(rec){
    const grouped={creditcard:0,savings:0,main:0};
    (rec?.extraSpends||[]).forEach(x=>{ if(Object.prototype.hasOwnProperty.call(grouped,x.source)) grouped[x.source]+=n(x.amount); });
    return Object.entries(grouped).filter(([,amount])=>amount>0).map(([source,amount])=>({source,amount}));
  }

  function loanPaid(item){ return (item?.repayments||[]).reduce((sum,r)=>sum+n(r.amount),0); }
  function loanRemaining(item){ return Math.max(0,n(item?.principal)-loanPaid(item)); }
  function calc(rec){
    const incomes=Array.isArray(rec?.incomes)?rec.incomes:[];
    const expenses=Array.isArray(rec?.expenses)?rec.expenses:[];
    const income=incomes.reduce((sum,x)=>sum+n(x.amount),0);
    const normalOutflow=expenses.reduce((sum,x)=>sum+n(x.amount),0);
    const extraOverspendAmount=extraSpendsTotal(rec);
    const outflow=normalOutflow+extraOverspendAmount;
    const savings=expenses.filter(x=>normalizeGroup(x.group)==='savings').reduce((sum,x)=>sum+n(x.amount),0);
    const investmentContribution=expenses.filter(x=>normalizeGroup(x.group)==='investments').reduce((sum,x)=>sum+n(x.amount),0);
    const extraBudget=hasValue(rec?.extraBudget)?n(rec.extraBudget):250;
    const extraSpent=extraBudget+extraOverspendAmount;
    const extraDelta=-extraOverspendAmount;
    const leftover=income-outflow;
    const investmentTotal=hasValue(rec?.investmentTotal)?n(rec.investmentTotal):null;
    const sisterInvestments=hasValue(rec?.sisterInvestments)?n(rec.sisterInvestments):0;
    const ownInvestments=investmentTotal==null?null:Math.max(0,investmentTotal-sisterInvestments);
    return {
      income,outflow,savings,investmentContribution,leftover,overspent:Math.max(0,-leftover),
      extraSpent,extraBudget,extraDelta,extraOver:extraOverspendAmount,extraOverspendAmount,
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
    const bankTotal=p.bankAccounts.reduce((sum,x)=>sum+n(x.balance),0);
    const savingsTotal=n(p.savingsTotal);
    const heldTotal=p.savingsReserved.reduce((sum,x)=>sum+n(x.amount),0);
    const availableSavings=savingsTotal-heldTotal;
    const owedTotal=p.receivables.reduce((sum,x)=>sum+loanRemaining(x),0);
    const latestInvestment=[...ownMonths()].filter(x=>hasValue(x.investmentTotal)).sort((a,b)=>String(b.month).localeCompare(String(a.month)))[0]||null;
    const inv=latestInvestment?calc(latestInvestment):{investmentTotal:null,sisterInvestments:0,ownInvestments:null};
    const gl=latestInvestment?investmentGL(latestInvestment):null;
    const ownInvestments=inv.ownInvestments==null?0:inv.ownInvestments;
    const netWorth=availableSavings+ownInvestments;
    const mainLeftover=mainAccountLeftover();
    return {p,bankTotal,savingsTotal,heldTotal,availableSavings,owedTotal,latestInvestment,inv,gl,netWorth,mainLeftover};
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
            Principessa:(Array.isArray(res.state?.finances?.Principessa)?res.state.finances.Principessa:[]).map(normalizeFinanceRecord),
            Principe:(Array.isArray(res.state?.finances?.Principe)?res.state.finances.Principe:[]).map(normalizeFinanceRecord)
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
      const statusClass=latest?(latest.finalized?'status-final':'status-draft'):'status-empty';
      summaryRoot.innerHTML=`
        <div class="finance-kpi month-status ${statusClass}"><strong>${latest?monthLabel(latest.month):'No month logged'}</strong></div>
        <div class="finance-kpi"><span>Total income</span><strong>${money(summary.income)}</strong></div>
        <div class="finance-kpi"><span>Total outflow</span><strong>${money(summary.outflow)}</strong></div>
        <div class="finance-kpi ${summary.leftover<0?'bad':summary.income?'good':''}"><span>${summary.leftover<0?'Overspent':'Leftover'}</span><strong>${money(Math.abs(summary.leftover))}</strong></div>
        <div class="finance-kpi wealth"><span>Current net worth</span><strong>${money(ps.netWorth)}</strong><small>Available savings + your investments</small></div>
        <div class="finance-kpi ${latestGl?.value<0?'bad':latestGl?.value>0?'good':''}"><span>Investment G/L p/m</span><strong>${latestGl?signedMoney(latestGl.value):'—'}</strong><small>${latestGl?`vs ${monthLabel(latestGl.previousMonth)}`:'Log 2 months to compare'}</small></div>`;
    }
    renderCurrentPanel();
    renderScenarioPanel();

    const root=$('#financeMonths'); if(!root) return;
    root.innerHTML=MONTHS.map(([key,label])=>{
      const rec=recordFor(key),c=calc(rec||{}),gl=rec?investmentGL(rec):null;
      const statusClass=rec?(rec.finalized?'status-final':'status-draft'):'status-empty';
      const extraWarn=rec&&c.extraOver>0?`<em class="finance-warning">⚠ Extra ${money(c.extraOver)} over</em>`:'';
      const glText=gl?`<em class="finance-month-gl ${gl.value<0?'down':'up'}">${gl.value<0?'▼':'▲'} ${money(Math.abs(gl.value))}</em>`:'';
      return `<button class="finance-month ${rec?'saved':''} ${statusClass} ${key==='2026-09'?'current':''}" type="button" data-fin-month="${key}"><span>${esc(label)}</span><strong>${rec?money(c.leftover):'Not logged'}</strong><small>${rec?`${money(c.income)} in · ${money(c.outflow)} out`:'Tap to start'}</small>${extraWarn}${glText}</button>`;
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
    const owed=p.receivables.length?p.receivables.map((x,i)=>{const paid=loanPaid(x),remaining=loanRemaining(x);return `<button class="finance-current-row" type="button" data-fin-edit-owed="${i}"><span>${esc(x.person)}<small>${esc(x.reason||'Reason not added')} · Lent ${money(x.principal)} · Repaid ${money(paid)}</small></span><strong>${money(remaining)}</strong></button>`;}).join(''):'<div class="finance-current-empty">Nobody logged as owing you money.</div>';
    root.innerHTML=`
      <div class="finance-current-head"><div><span class="panel-kicker">CURRENT POSITION</span><h2>${esc(actor())}’s balances</h2><p>Bank balances are informational only. Loan repayments go back into Saved up automatically, but never count as monthly income.</p></div></div>
      <div class="finance-current-grid">
        <article class="finance-current-card tone-other"><div class="finance-current-title"><div><span>BANKS</span><h3>Current cash</h3></div><strong>${money(bankTotal)}</strong></div>${banks}<button class="btn ghost finance-add" type="button" data-fin-add-bank>+ Add bank</button><small class="finance-card-note">Not included in net worth.</small></article>
        <article class="finance-current-card tone-wealth"><div class="finance-current-title"><div><span>SAVINGS</span><h3>Saved up</h3></div><strong>${money(availableSavings)}</strong></div><div class="finance-current-metrics"><div><span>Total saved</span><strong>${money(savingsTotal)}</strong></div><div><span>On hold</span><strong>${money(heldTotal)}</strong></div><div class="${availableSavings<0?'negative':''}"><span>Actually available</span><strong>${money(availableSavings)}</strong></div></div>${holds}<div class="finance-card-actions"><button class="btn ghost" type="button" data-fin-edit-savings>Edit saved total</button><button class="btn ghost" type="button" data-fin-add-hold>+ Add hold</button></div></article>
        <article class="finance-current-card tone-receivable"><div class="finance-current-title"><div><span>PAYBACK</span><h3>Money owed to me</h3></div><strong>${money(owedTotal)}</strong></div>${owed}<button class="btn ghost finance-add" type="button" data-fin-add-owed>+ Add loan</button><small class="finance-card-note">Tap a loan to see original amount, repayment history and what is still left.</small></article>
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

  function renderScenarioPanel(){
    const root=$('#financeScenarios'); if(!root) return;
    const ps=profileStats(),p=ps.p;
    const latest=[...ownMonths()].sort((a,b)=>String(b.month).localeCompare(String(a.month)))[0]||null;
    const monthlyLeft=latest?calc(latest).leftover:0;
    const currentMain=ps.mainLeftover;
    const cards=p.scenarios.length?p.scenarios.map((x,i)=>{
      const upfront=n(x.upfront),monthly=n(x.monthly);
      const rawMainAfter=currentMain-upfront;
      const fromSavings=Math.max(0,-rawMainAfter);
      const mainAfter=Math.max(0,rawMainAfter);
      const savingsAfter=ps.availableSavings-fromSavings;
      const afterMonth=monthlyLeft-monthly;
      const type=monthly>0?'Purchase + Monthly cost':'Purchase';
      const cls=savingsAfter<0||afterMonth<0?'bad':fromSavings>0?'warn':'good';
      const verdict=savingsAfter<0?'Not fully covered by Main account + available savings':afterMonth<0?'Purchase fits, but the monthly cost exceeds your usual leftover':fromSavings>0?'Purchase needs some of your available savings':'Fits your current Main account leftover';
      const monthlyRows=monthly>0?`<div class="scenario-row"><span>Monthly cost</span><strong>${money(monthly)}</strong></div><div class="scenario-row"><span>Monthly leftover after</span><strong>${money(afterMonth)}</strong></div>`:'';
      const savingsRows=fromSavings>0?`<div class="scenario-row scenario-alert-row"><span>Needed from saved up</span><strong>${money(fromSavings)}</strong></div><div class="scenario-row"><span>Available savings after</span><strong>${money(savingsAfter)}</strong></div>`:'';
      return `<button class="finance-scenario-card ${cls}" type="button" data-fin-scenario="${i}"><span class="panel-kicker">${esc(type)}</span><h3>${esc(x.name)}</h3><div class="scenario-row"><span>Purchase price</span><strong>${money(upfront)}</strong></div><div class="scenario-row"><span>Current Main account leftover</span><strong>${money(currentMain)}</strong></div><div class="scenario-row"><span>Main account leftover after</span><strong>${money(mainAfter)}</strong></div>${monthlyRows}${savingsRows}<div class="scenario-verdict">${esc(verdict)}</div></button>`;
    }).join(''):'<div class="finance-current-empty">No purchase scenarios yet.</div>';
    root.innerHTML=`<div class="finance-scenario-wrap"><div class="finance-scenario-head"><div><span class="panel-kicker">WHAT IF?</span><h2>Purchase test scenarios</h2><p>Your Main account leftover is the sum of your logged monthly leftovers. Purchases use that first; any shortfall can come from actually available savings.</p></div><button class="btn primary" type="button" data-fin-add-scenario>+ Test a purchase</button></div><div class="finance-scenario-grid">${cards}</div></div>`;
    $('[data-fin-add-scenario]',root)?.addEventListener('click',()=>openScenarioModal(-1));
    $$('[data-fin-scenario]',root).forEach(btn=>btn.addEventListener('click',()=>openScenarioModal(Number(btn.dataset.finScenario))));
  }

  function openScenarioModal(index){
    const p=profile(),item=index>=0?p.scenarios[index]:null;
    showMini(`<span class="panel-kicker">TEST SCENARIO</span><h2>${item?'Edit purchase test':'Test a purchase'}</h2><p>Purchase price is tested against your accumulated Main account leftover. If that is not enough, Twogether uses your actually available savings. A monthly cost only reduces your usual monthly leftover.</p><div class="finance-mini-fields"><label>What are you considering?<input id="finMiniScenarioName" value="${esc(item?.name||'')}" placeholder="e.g. New laptop"></label><label>Purchase price<div class="finance-money mini"><span>€</span><input id="finMiniScenarioUpfront" inputmode="decimal" value="${esc(String(item?.upfront??''))}" placeholder="0.00"></div></label><label>Monthly cost, if any<div class="finance-money mini"><span>€</span><input id="finMiniScenarioMonthly" inputmode="decimal" value="${esc(String(item?.monthly??0))}" placeholder="0.00"></div></label></div><div class="finance-mini-actions">${item?'<button class="btn ghost" type="button" data-fin-mini-delete>Delete</button>':'<span></span>'}<button class="btn primary" type="button" data-fin-mini-save>Save scenario</button></div>`);
    $('[data-fin-mini-save]')?.addEventListener('click',()=>{
      const name=String($('#finMiniScenarioName')?.value||'').trim(),upfront=$('#finMiniScenarioUpfront')?.value||'',monthly=$('#finMiniScenarioMonthly')?.value||'0';
      if(!name)return toast('Add what you want to test','warn');
      if(upfront===''||!Number.isFinite(Number(upfront.replace(',','.'))))return toast('Enter a valid purchase price','warn');
      if(monthly!==''&&!Number.isFinite(Number(monthly.replace(',','.'))))return toast('Enter a valid monthly cost','warn');
      const next=profile(),row={id:item?.id||uid(),name,upfront:n(upfront),monthly:n(monthly)}; if(index>=0)next.scenarios[index]=row;else next.scenarios.push(row); saveProfile(next,'Scenario saved');
    });
    $('[data-fin-mini-delete]')?.addEventListener('click',()=>{const next=profile();next.scenarios.splice(index,1);saveProfile(next,'Scenario removed');});
  }

  function renderDetail(rec){
    const root=$('#financeDetail'); if(!root) return;
    const c=calc(rec),gl=investmentGL(rec),carry=extraCarryInfo(rec.month);
    const expenses=groupedExpenseHtml(rec.expenses||[],false,rec.extraSpends||[]);
    const incomes=(rec.incomes||[]).map(x=>`<div class="finance-breakdown-row"><span>${esc(x.name)}</span><strong>${money(x.amount)}</strong></div>`).join('');
    const extraStatus=c.extraOver>0?`<div class="finance-alert bad">⚠ ${money(c.extraOver)} spent beyond this month’s Extra budget.</div>`:'';
    const debtStatus=carry.debt>0?`<div class="finance-carry-note">You still owe yourself ${money(carry.debt)} from ${esc(monthLabel(carry.prevMonth))}.</div>`:'';
    const investmentBlock=c.investmentTotal!=null?`<div class="finance-review-section"><h3>Investment snapshot</h3><div class="finance-breakdown-row finance-tone-wealth"><span>Total investment account</span><strong>${money(c.investmentTotal)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Sis</span><strong>${money(c.sisterInvestments)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Your investments</span><strong>${money(c.ownInvestments)}</strong></div><div class="finance-breakdown-row ${gl?.value<0?'finance-negative':'finance-positive'}"><span>G/L p/m${gl?` vs ${monthLabel(gl.previousMonth)}`:''}</span><strong>${gl?signedMoney(gl.value):'—'}</strong></div></div>`:'';
    root.innerHTML=`<div class="finance-detail-head"><div><span class="panel-kicker">${esc(actor())}</span><h3>${esc(monthLabel(rec.month))}</h3></div>${rec.finalized?'<span class="finance-final-badge">Locked</span>':'<div class="finance-detail-actions"><button class="btn ghost" type="button" data-fin-edit>Edit draft</button><button class="btn primary" type="button" data-fin-finalize-existing>Confirm month</button></div>'}</div><div class="finance-summary-line"><div class="finance-summary-mini"><span>Income</span><strong>${money(c.income)}</strong></div><div class="finance-summary-mini"><span>Outflow</span><strong>${money(c.outflow)}</strong></div><div class="finance-summary-mini"><span>${c.leftover<0?'Overspent':'Leftover'}</span><strong>${money(Math.abs(c.leftover))}</strong></div></div>${extraStatus}${debtStatus}${incomes?`<div class="finance-review-section"><h3>Income</h3>${incomes}</div>`:''}${expenses?`<div class="finance-review-section"><h3>Monthly outflow</h3>${expenses}</div>`:''}${investmentBlock}`;
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
    if(!item){
      showMini(`<span class="panel-kicker">NEW LOAN</span><h2>Add money someone owes you</h2><p>Track the original amount you lent. Repayments will be recorded separately.</p><div class="finance-mini-fields"><label>Who owes you?<input id="finMiniPerson" placeholder="e.g. Sis"></label><label>Original amount lent<div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" placeholder="0.00"></div></label><label class="full">Why did you lend it?<input id="finMiniReason" placeholder="e.g. IP17"></label></div><div class="finance-mini-actions"><span></span><button class="btn primary" type="button" data-fin-mini-save>Save loan</button></div>`);
      $('[data-fin-mini-save]')?.addEventListener('click',()=>{const person=String($('#finMiniPerson')?.value||'').trim(),reason=String($('#finMiniReason')?.value||'').trim(),amount=$('#finMiniAmount')?.value||'';if(!person)return toast('Add who owes you first','warn');if(!reason)return toast('Add why you lent it','warn');if(amount===''||!Number.isFinite(Number(amount.replace(',','.'))))return toast('Enter a valid amount','warn');const next=profile();next.receivables.push({id:uid(),person,reason,principal:n(amount),repayments:[]});saveProfile(next,'Loan added');});
      return;
    }
    const paid=loanPaid(item),remaining=loanRemaining(item);
    const grouped={}; (item.repayments||[]).forEach(r=>{const key=r.month||'Other';grouped[key]=(grouped[key]||0)+n(r.amount);});
    const history=Object.keys(grouped).sort().reverse().map(month=>`<div class="loan-history-row"><span>${esc(monthLabel(month))}</span><strong>${money(grouped[month])}</strong></div>`).join('')||'<div class="finance-current-empty">No repayments logged yet.</div>';
    showMini(`<span class="panel-kicker">PAYBACK TRACKER</span><h2>${esc(item.person)}</h2><p>${esc(item.reason)}</p><div class="loan-stats"><div><span>Originally lent</span><strong>${money(item.principal)}</strong></div><div><span>Repaid</span><strong>${money(paid)}</strong></div><div><span>Still left</span><strong>${money(remaining)}</strong></div></div><h3>Repayment history</h3><div class="loan-history">${history}</div><div class="finance-mini-actions"><button class="btn ghost" type="button" data-fin-loan-edit>Edit loan</button><button class="btn ghost" type="button" data-fin-mini-delete>Delete</button><button class="btn primary" type="button" data-fin-loan-repay ${remaining<=0?'disabled':''}>+ Add repayment</button></div>`);
    $('[data-fin-loan-edit]')?.addEventListener('click',()=>openLoanEdit(index));
    $('[data-fin-loan-repay]')?.addEventListener('click',()=>openLoanRepayment(index));
    $('[data-fin-mini-delete]')?.addEventListener('click',()=>{const next=profile();next.receivables.splice(index,1);saveProfile(next,'Loan removed');});
  }

  function openLoanEdit(index){
    const p=profile(),item=p.receivables[index]; if(!item)return;
    showMini(`<span class="panel-kicker">EDIT LOAN</span><h2>${esc(item.person)}</h2><div class="finance-mini-fields"><label>Who owes you?<input id="finMiniPerson" value="${esc(item.person)}"></label><label>Original amount lent<div class="finance-money mini"><span>€</span><input id="finMiniAmount" inputmode="decimal" value="${esc(String(item.principal??''))}"></div></label><label class="full">Reason<input id="finMiniReason" value="${esc(item.reason)}"></label></div><div class="finance-mini-actions"><button class="btn ghost" type="button" data-fin-mini-back>Back</button><button class="btn primary" type="button" data-fin-mini-save>Save</button></div>`);
    $('[data-fin-mini-back]')?.addEventListener('click',()=>openOwedModal(index));
    $('[data-fin-mini-save]')?.addEventListener('click',()=>{const person=String($('#finMiniPerson')?.value||'').trim(),reason=String($('#finMiniReason')?.value||'').trim(),amount=$('#finMiniAmount')?.value||'';if(!person||!reason||amount===''||!Number.isFinite(Number(amount.replace(',','.'))))return toast('Complete the loan details','warn');if(n(amount)<loanPaid(item))return toast('Original amount cannot be below what has already been repaid','warn');const next=profile();next.receivables[index]={...next.receivables[index],person,reason,principal:n(amount)};saveProfile(next,'Loan updated');});
  }

  function openLoanRepayment(index){
    const p=profile(),item=p.receivables[index]; if(!item)return; const remaining=loanRemaining(item);
    showMini(`<span class="panel-kicker">REPAYMENT</span><h2>Add repayment from ${esc(item.person)}</h2><p>${money(remaining)} is still outstanding. This repayment will increase Saved up but will not count as income.</p><div class="finance-mini-fields"><label>Month<select id="finMiniRepayMonth">${MONTHS.map(([k,l])=>`<option value="${k}" ${k===selectedMonth?'selected':''}>${l}</option>`).join('')}</select></label><label>Amount repaid<div class="finance-money mini"><span>€</span><input id="finMiniRepayAmount" inputmode="decimal" placeholder="0.00"></div></label></div><div class="finance-mini-actions"><button class="btn ghost" type="button" data-fin-mini-back>Back</button><button class="btn primary" type="button" data-fin-mini-save>Save repayment</button></div>`);
    $('[data-fin-mini-back]')?.addEventListener('click',()=>openOwedModal(index));
    $('[data-fin-mini-save]')?.addEventListener('click',()=>{const amount=$('#finMiniRepayAmount')?.value||'',month=$('#finMiniRepayMonth')?.value||selectedMonth;if(amount===''||!Number.isFinite(Number(amount.replace(',','.')))||n(amount)<=0)return toast('Enter a valid repayment','warn');if(n(amount)>remaining)return toast('Repayment is higher than the amount still owed','warn');const next=profile();next.receivables[index].repayments=[...(next.receivables[index].repayments||[]),{id:uid(),month,amount:n(amount),at:new Date().toISOString()}];next.savingsTotal=n(next.savingsTotal)+n(amount);saveProfile(next,`Repayment saved · ${money(amount)} added to savings`);});
  }

  function freshRecord(month){ return {month,incomes:[],expenses:[],extraBudget:250,extraSpends:[],extraOverspendSource:'',extraOverspendAmount:0,investmentTotal:'',sisterInvestments:'',finalized:false,finalizedAt:''}; }
  function cloneRecord(rec){
    const copy=normalizeFinanceRecord(rec);
    copy.extraBudget=hasValue(copy.extraBudget)?n(copy.extraBudget):250;
    copy.extraSpends=Array.isArray(copy.extraSpends)?copy.extraSpends.map(x=>({...x,id:x.id||uid()})):[];
    copy.extraOverspendSource=copy.extraSpends[0]?.source||'';
    copy.extraOverspendAmount=copy.extraSpends.reduce((sum,x)=>sum+n(x.amount),0);
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
    const previous=latestPriorMonth(month),d=freshRecord(month),carry=extraCarryInfo(month);
    d.extraBudget=carry.budget;
    d.incomes=RECURRING_INCOMES.map(x=>({name:x.name,amount:recurringValue(previous,'income',x.name,x.amount)}));
    d.expenses=RECURRING_EXPENSES.map(x=>({group:x.group,name:x.name,amount:x.group==='extra'?carry.budget:recurringValue(previous,'expense',x.name,x.amount)}));
    d.extraSpends=[];
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
  function groupedExpenseHtml(items,removable=false,extraSpends=[]){
    const rows=(items||[]).map((x,index)=>({...x,index,group:normalizeGroup(x.group),tone:groupTone(x.group),isExtraSpend:false}));
    extraSpendSummary({extraSpends}).forEach(x=>rows.push({group:'extra',tone:'budgets',name:extraSourceLabel(x.source),amount:x.amount,isExtraSpend:true,extraSource:x.source,index:-1}));
    const grouped={};
    rows.forEach(x=>(grouped[x.tone]||(grouped[x.tone]=[])).push(x));
    return CATEGORY_ORDER.filter(tone=>grouped[tone]?.length).map(tone=>{
      const group=grouped[tone],total=group.reduce((sum,x)=>sum+n(x.amount),0);
      const itemRows=group.map(x=>{
        const fixedExtra=!x.isExtraSpend&&normalizeGroup(x.group)==='extra'&&String(x.name||'').trim().toLowerCase()==='extra';
        const rowClass=x.isExtraSpend?' finance-extra-spend-row':fixedExtra&&n(x.amount)<250?' finance-reduced-extra':'';
        const controls=removable&&!x.isExtraSpend?` <button class="text-btn" data-fin-edit-expense="${x.index}">Edit</button> <button class="text-btn" data-fin-remove-expense="${x.index}">×</button>`:'';
        return `<div class="finance-category-item${rowClass}"><span>${esc(x.name||groupLabel(x.group))}</span><strong>${money(x.amount)}${controls}</strong></div>`;
      }).join('');
      return `<div class="finance-category-bubble finance-tone-${tone}"><div class="finance-category-head"><strong>${esc(CATEGORY_LABELS[tone]||tone)}</strong><span>${money(total)}</span></div>${itemRows}</div>`;
    }).join('');
  }

  function renderWizard(){
    const body=$('#financeWizardBody'); if(!body) return;
    if(!actor()){ setProgress('PERSONAL FINANCES',8); body.innerHTML=wizardHtml('Choose your profile first','Your monthly finances are kept separately for Principessa and Principe.',''); return; }
    if(!flow){
      setProgress('MONTHLY FINANCES',8);
      body.innerHTML=wizardHtml(`Track ${actor()}’s month`,'One question at a time, just like trip logging.',`<div class="finance-choice-stack"><button class="finance-choice" type="button" data-fin-start><div><strong>Start a monthly check-in</strong><small>Income, colored expenses, €250 Extra budget, savings and investments.</small></div><span>→</span></button></div>`);
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
      if(idx>=queue.length){flow.stage='extraSpentAsk';renderWizard();return;}
      const item=queue[idx],source=recurringSource(item,d);
      if(!source){flow.recurringIndex=idx+1;renderWizard();return;}
      const isFixedExtra=item.kind==='expense'&&normalizeGroup(source.group)==='extra'&&String(source.name||'').trim().toLowerCase()==='extra';
      const meta=item.kind==='income'?{label:'Income',tone:'other'}:{label:CATEGORY_LABELS[groupTone(source.group)]||groupLabel(source.group),tone:groupTone(source.group)};
      const pct=12+Math.round(((idx+1)/Math.max(1,queue.length))*48);
      setProgress(`CHECKING ${idx+1} OF ${queue.length}`,pct);
      const carry=extraCarryInfo(d.month);
      const help=isFixedExtra?(n(d.extraBudget)<250?`Your normal €250 Extra is reduced this month because you used extra money in ${monthLabel(carry.prevMonth)}.${carry.debt>0?` You still owe yourself ${money(carry.debt)} from last month.`:''}`:'This is your normal monthly Extra allocation. You do not need to itemize what the budget itself is spent on.'):`Recurring ${item.kind==='income'?'income':meta.label.toLowerCase()}. Confirm it if it is still correct, or edit only the amount.`;
      const editButton=isFixedExtra?'':`<button class="btn ghost" type="button" data-fin-recurring-edit>Edit</button>`;
      const extraClass=isFixedExtra&&n(d.extraBudget)<250?' finance-extra-budget-reduced':'';
      body.innerHTML=wizardHtml(`${source.name} · ${money(source.amount)}?`,help,`<div class="finance-reference finance-tone-${meta.tone}${extraClass}"><span>${esc(meta.label)}</span><strong>${esc(source.name)}</strong><small>${isFixedExtra?'Monthly Extra budget':'Usual amount'} · ${money(source.amount)}</small></div><div class="finance-actions">${editButton}<button class="btn primary big" type="button" data-fin-recurring-confirm>Confirm</button></div>`);
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

    if(flow.stage==='extraSpentAsk'){
      setProgress('EXTRA',64);
      const entries=d.extraSpends||[];
      const saved=entries.length?`<div class="finance-list">${entries.map((x,i)=>`<div class="finance-list-row finance-extra-saved"><span>${esc(extraSourceLabel(x.source))}</span><strong>${money(x.amount)} <button class="text-btn" data-fin-extra-edit="${i}">Edit</button> <button class="text-btn" data-fin-extra-remove="${i}">×</button></strong></div>`).join('')}</div>`:'';
      body.innerHTML=wizardHtml('Any extra money spent?','Only log money used beyond your Extra budget for this month.',`${saved}<div class="finance-choice-stack"><button class="finance-choice" data-fin-extra-yes><div><strong>Yes</strong><small>Add credit card, saved-up, or Main account spending.</small></div><span>→</span></button><button class="finance-choice" data-fin-extra-no><div><strong>${entries.length?'No more':'No'}</strong><small>${entries.length?'Continue with what is saved.':'Nothing beyond the Extra budget.'}</small></div><span>→</span></button></div>`);
      $$('[data-fin-extra-edit]').forEach(btn=>btn.addEventListener('click',()=>{flow.temp={extraEditIndex:Number(btn.dataset.finExtraEdit)};flow.stage='extraEditAmount';renderWizard();}));
      $$('[data-fin-extra-remove]').forEach(btn=>btn.addEventListener('click',()=>{d.extraSpends.splice(Number(btn.dataset.finExtraRemove),1);renderWizard();}));
      $('[data-fin-extra-yes]')?.addEventListener('click',()=>{flow.stage='extraSourceAsk';renderWizard();});
      $('[data-fin-extra-no]')?.addEventListener('click',()=>{flow.stage=flow.extraReturn==='review'?'review':'investmentTotal';flow.extraReturn='';renderWizard();});
      return;
    }

    if(flow.stage==='extraSourceAsk'){
      setProgress('EXTRA',67);
      body.innerHTML=wizardHtml('Where did the extra money come from?','Choose the source for this extra spending.',`<div class="finance-choice-stack"><button class="finance-choice" data-fin-extra-source="creditcard"><div><strong>Credit Card</strong><small>Extra spending charged to your credit card.</small></div><span>→</span></button><button class="finance-choice" data-fin-extra-source="savings"><div><strong>From Saved Up</strong><small>Money taken from your savings.</small></div><span>→</span></button><button class="finance-choice" data-fin-extra-source="main"><div><strong>From Main account leftover</strong><small>Extra money used from your accumulated Main account leftover.</small></div><span>→</span></button></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button></div>`);
      bindBack(()=>{flow.stage='extraSpentAsk';renderWizard();});
      $$('[data-fin-extra-source]').forEach(btn=>btn.addEventListener('click',()=>{flow.temp={extraSource:btn.dataset.finExtraSource};flow.stage='extraAmount';renderWizard();}));
      return;
    }

    if(flow.stage==='extraAmount'){
      const source=t.extraSource||'creditcard'; setProgress('EXTRA',70);
      body.innerHTML=wizardHtml(`How much from ${extraSourceLabel(source)}?`,'Enter the amount used so far. You can add another extra source afterwards.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Save</button></div>`);
      bindBack(()=>{flow.stage='extraSourceAsk';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.')))||n(v)<=0)return toast('Enter a valid amount','warn');d.extraSpends.push({id:uid(),source,amount:n(v)});flow.temp={};flow.stage='extraMoreAsk';renderWizard();});
      return;
    }

    if(flow.stage==='extraMoreAsk'){
      setProgress('EXTRA',72);
      const total=extraSpendsTotal(d);
      body.innerHTML=wizardHtml('Any more extra money spent?','You can keep adding extra spending from a different or the same source.',`<div class="finance-reference finance-tone-budgets"><span>Extra money logged so far</span><strong>${money(total)}</strong></div><div class="finance-choice-stack"><button class="finance-choice" data-fin-extra-more><div><strong>Yes, add another</strong></div><span>＋</span></button><button class="finance-choice" data-fin-extra-done><div><strong>No, continue</strong></div><span>→</span></button></div>`);
      $('[data-fin-extra-more]')?.addEventListener('click',()=>{flow.stage='extraSourceAsk';renderWizard();});
      $('[data-fin-extra-done]')?.addEventListener('click',()=>{flow.stage=flow.extraReturn==='review'?'review':'investmentTotal';flow.extraReturn='';renderWizard();});
      return;
    }

    if(flow.stage==='extraEditAmount'){
      const idx=Number(t.extraEditIndex),item=d.extraSpends?.[idx];
      if(!item){flow.temp={};flow.stage='extraSpentAsk';renderWizard();return;}
      setProgress('EDIT EXTRA',70);
      body.innerHTML=wizardHtml(`Edit ${extraSourceLabel(item.source)}`,'Update this extra amount. It remains editable until the month is confirmed.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(item.amount??''))}" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Save change</button></div>`);
      bindBack(()=>{flow.temp={};flow.stage='extraSpentAsk';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.')))||n(v)<=0)return toast('Enter a valid amount','warn');item.amount=n(v);flow.temp={};flow.stage='extraSpentAsk';renderWizard();});
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

    if(flow.stage==='editExistingExpense'){
      const idx=Number(t.editExpenseIndex),item=d.expenses?.[idx];
      if(!item){flow.temp={};flow.stage='review';renderWizard();return;}
      setProgress('EDIT EXPENSE',58);
      body.innerHTML=wizardHtml(`Edit ${item.name||groupLabel(item.group)}`,'Update this saved draft expense. You can keep changing it until the month is confirmed.',`<div class="finance-reference finance-tone-${groupTone(item.group)}"><span>${esc(CATEGORY_LABELS[groupTone(item.group)]||groupLabel(item.group))}</span><strong>${esc(item.name||groupLabel(item.group))}</strong></div><div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(item.amount??''))}" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Save change</button></div>`);
      bindBack(()=>{flow.temp={};flow.stage='review';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid amount','warn');item.amount=n(v);flow.temp={};flow.stage='review';renderWizard();});
      return;
    }

    if(flow.stage==='expenseGroup'){
      setProgress('EXPENSES',42);
      body.innerHTML=wizardHtml(d.expenses.length?'What kind of expense are you adding?':'What did you spend or set aside?','Colors follow your spreadsheet groups: Medical, Subscriptions, Budgets, Savings/Investments and Other.',`${listHtml(d.expenses,x=>`${x.name} · ${groupLabel(x.group)}`)}<div class="finance-group-grid">${GROUPS.filter(g=>g.manual!==false).map(g=>`<button class="finance-choice finance-tone-${g.tone}" data-fin-group="${g.key}"><div><strong>${esc(g.label)}</strong><small>${g.example?esc(g.example):g.defaultName?'Name filled automatically':''}</small></div><span>→</span></button>`).join('')}</div>${d.expenses.length?'<div class="finance-actions"><button class="btn ghost" data-fin-exp-done>Done with expenses</button></div>':''}`);
      $$('[data-fin-group]').forEach(btn=>btn.addEventListener('click',()=>{
        const meta=groupMeta(btn.dataset.finGroup); flow.temp={group:meta.key};
        if(meta.optionalName){flow.temp.name=meta.defaultName;flow.stage='expenseOptionalName';}
        else if(meta.defaultName){flow.temp.name=meta.defaultName;flow.stage='expenseAmount';}
        else flow.stage='expenseName';
        renderWizard();
      }));
      $('[data-fin-exp-done]')?.addEventListener('click',()=>{flow.stage='extraSpentAsk';renderWizard();}); return;
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
      body.innerHTML=wizardHtml(`How much was ${t.name}?`,meta.key==='extra'?`This counts toward your ${money(hasValue(d.extraBudget)?d.extraBudget:250)} monthly Extra budget.`:'Enter the amount for this month.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);
      bindBack(()=>{if(meta.optionalName)flow.stage='expenseOptionalName';else if(meta.defaultName)flow.stage='expenseGroup';else flow.stage='expenseName';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid amount','warn');d.expenses.push({group:t.group,name:t.name,amount:n(v)});flow.temp={};flow.stage='expenseMore';renderWizard();}); return;
    }

    if(flow.stage==='expenseMore'){
      setProgress('EXPENSES',60);
      body.innerHTML=wizardHtml('Anything else this month?','Keep adding expenses, Save up or Investments until the month is complete.',`${listHtml(d.expenses,x=>`${x.name} · ${groupLabel(x.group)}`)}<div class="finance-choice-stack"><button class="finance-choice" data-fin-yes><div><strong>Yes, add another</strong></div><span>＋</span></button><button class="finance-choice" data-fin-no><div><strong>No, continue</strong></div><span>→</span></button></div>`);
      $('[data-fin-yes]')?.addEventListener('click',()=>{flow.stage='expenseGroup';renderWizard();}); $('[data-fin-no]')?.addEventListener('click',()=>{flow.stage='extraSpentAsk';renderWizard();}); return;
    }

    if(flow.stage==='extraBudget'){
      setProgress('EXTRA BUDGET',70);
      body.innerHTML=wizardHtml('What is your Extra spending limit this month?','Default is €250. You can change it for a specific month. This is a limit, not an expense. Twogether will warn you when your actual Extra purchases go above it.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(hasValue(d.extraBudget)?d.extraBudget:250))}" placeholder="250.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);
      bindBack(()=>{flow.stage='expenseGroup';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid Extra budget','warn');d.extraBudget=250;flow.stage='extraSpentAsk';renderWizard();}); return;
    }

    if(flow.stage==='investmentTotal'){
      setProgress('INVESTMENTS',80);
      body.innerHTML=wizardHtml('What is the investment account worth now?','Enter the full current investment value for this month. This is separate from how much you contributed this month.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(d.investmentTotal??''))}" placeholder="0.00"></div><button class="btn ghost full" type="button" data-fin-skip style="margin-top:10px">Skip investment snapshot this month</button><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Next</button></div>`);
      bindBack(()=>{flow.stage='extraSpentAsk';renderWizard();});
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
    const d=flow.data,c=calc(d),gl=investmentGL(d),carry=extraCarryInfo(d.month); setProgress('REVIEW',100);
    const incomeRows=d.incomes.map((x,i)=>`<div class="finance-list-row"><span>${esc(x.name)}</span><strong>${money(x.amount)} <button class="text-btn" data-fin-remove-income="${i}">×</button></strong></div>`).join('')||'<div class="finance-empty">No income added.</div>';
    const expenseRows=groupedExpenseHtml(d.expenses,true,d.extraSpends||[])||'<div class="finance-empty">No expenses added.</div>';
    const extraLine=c.extraOver>0?`<div class="finance-alert bad">⚠ ${money(c.extraOver)} spent beyond this month’s Extra budget.</div>`:'';
    const debtLine=carry.debt>0?`<div class="finance-carry-note">You still owe yourself ${money(carry.debt)} from ${esc(monthLabel(carry.prevMonth))}.</div>`:'';
    const investmentLines=c.investmentTotal==null?'<div class="finance-breakdown-row"><span>Investment snapshot</span><strong>Skipped</strong></div>':`<div class="finance-breakdown-row finance-tone-wealth"><span>Total investments</span><strong>${money(c.investmentTotal)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Sis</span><strong>${money(c.sisterInvestments)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Your investments</span><strong>${money(c.ownInvestments)}</strong></div><div class="finance-breakdown-row ${gl?.value<0?'finance-negative':'finance-positive'}"><span>G/L p/m${gl?` vs ${monthLabel(gl.previousMonth)}`:''}</span><strong>${gl?signedMoney(gl.value):'—'}</strong></div>`;
    body.innerHTML=wizardHtml(`Ready to save ${monthLabel(d.month)}?`,'Review your personal monthly picture before saving.',`<div class="finance-summary-line"><div class="finance-summary-mini"><span>Income</span><strong>${money(c.income)}</strong></div><div class="finance-summary-mini"><span>Outflow</span><strong>${money(c.outflow)}</strong></div><div class="finance-summary-mini"><span>${c.leftover<0?'Overspent':'Leftover'}</span><strong>${money(Math.abs(c.leftover))}</strong></div></div>${extraLine}${debtLine}<div class="finance-review-section"><h3>Income</h3>${incomeRows}<button class="btn ghost" data-fin-add-income>Add income</button></div><div class="finance-review-section"><h3>Outflow</h3>${expenseRows}<button class="btn ghost" data-fin-add-expense>Add expense</button>${c.extraOver>0?'<button class="btn ghost" type="button" data-fin-edit-extra-spend>Edit extra money used</button>':'<button class="btn ghost" type="button" data-fin-edit-extra-spend>Log extra money used</button>'}</div><div class="finance-review-section"><h3>Investment tracking</h3>${investmentLines}<button class="btn ghost" data-fin-edit-investments>Edit investment snapshot</button></div><div class="finance-actions finance-save-actions"><button class="btn ghost" data-fin-cancel>Cancel</button><div><button class="btn ghost" data-fin-save-draft>Save draft</button><button class="btn primary big" data-fin-finalize>Confirm month</button></div></div>`);
    $$('[data-fin-remove-income]').forEach(btn=>btn.addEventListener('click',()=>{d.incomes.splice(Number(btn.dataset.finRemoveIncome),1);renderReview();}));
    $$('[data-fin-edit-expense]').forEach(btn=>btn.addEventListener('click',()=>{flow.temp={editExpenseIndex:Number(btn.dataset.finEditExpense)};flow.stage='editExistingExpense';renderWizard();}));
    $$('[data-fin-remove-expense]').forEach(btn=>btn.addEventListener('click',()=>{d.expenses.splice(Number(btn.dataset.finRemoveExpense),1);renderReview();}));
    $('[data-fin-add-income]')?.addEventListener('click',()=>{flow.stage='incomeSource';renderWizard();});
    $('[data-fin-add-expense]')?.addEventListener('click',()=>{flow.stage='expenseGroup';renderWizard();});
    $('[data-fin-edit-extra-spend]')?.addEventListener('click',()=>{flow.extraReturn='review';flow.stage='extraSpentAsk';renderWizard();});
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
