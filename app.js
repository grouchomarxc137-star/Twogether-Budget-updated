(() => {
  'use strict';

  const CONFIG = window.TOGETHER_BUDGET_CONFIG || {};
  const API_URL = String(CONFIG.appsScriptUrl || '').trim();
  const SYNC_MS = 3500;
  const ACTOR_KEY = 'twogether_actor_v1';
  const ACTORS = ['Principessa','Principe'];

  const DEFAULT_COMPARE = {
    rent:600, utilities:120, condo:0, stilltravel:180, food:250,
    carpay:250, insurance:90, tax:45, carfuel:120, maintenance:50
  };
  const MONEY_FIELDS = ['accom','groceries','eat','travel','fuel','tolls','other'];
  const MONEY_LABELS = {
    accom:'Accommodation', groceries:'Groceries', eat:'Eating out',
    travel:'Flights / Train', fuel:'Fuel', tolls:'Tolls / Parking', other:'Other'
  };
  const MONTHS = [
    ['2026-01','Jan 2026'],['2026-02','Feb 2026'],['2026-03','Mar 2026'],['2026-04','Apr 2026'],
    ['2026-05','May 2026'],['2026-06','Jun 2026'],['2026-07','Jul 2026'],['2026-08','Aug 2026'],
    ['2026-09','Sep 2026'],['2026-10','Oct 2026'],['2026-11','Nov 2026'],['2026-12','Dec 2026']
  ];
  const RENT_DEFS = [
    ['Rent','rent'],['Utilities + Wi-Fi','utilities'],['Condo fees','condo'],
    ['Still-needed travel','stilltravel'],['Groceries / eating out','food']
  ];
  const CAR_DEFS = [
    ['Car payment / saving','carpay'],['Insurance','insurance'],['Road tax','tax'],
    ['Fuel','carfuel'],['Maintenance reserve','maintenance']
  ];

  let actor = '';
  let state = normalizeState({});
  let backendV3 = false;
  let syncBusy = false;
  let syncTimer = null;
  let lastServerStamp = '';
  let openTripId = '';
  let wizard = freshWizard();

  const $ = (s,r=document) => r.querySelector(s);
  const $$ = (s,r=document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[ch]));
  const n = v => {
    const x = Number(String(v ?? '').replace(',','.'));
    return Number.isFinite(x) ? x : 0;
  };
  const money = v => '€' + n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtDate = v => {
    if(!v) return '—';
    const [y,m,d] = String(v).split('-');
    return y && m && d ? `${d}/${m}/${y}` : String(v);
  };
  const otherActor = () => actor === 'Principessa' ? 'Principe' : 'Principessa';

  function freshDraft(){
    return {
      location:'',otherLocation:'',city:'',start:'',end:'',budget:'',
      accom:'',groceries:'',eat:'',travel:'',fuel:'',tolls:'',other:'',otherNote:'',
      paid:'',uncertain:{}
    };
  }

  function freshWizard(){
    return {mode:null,tripId:'',draft:freshDraft(),index:0,otherFlow:null};
  }

  function normalizeState(s){
    return {
      version:Number(s?.version || 1),
      trips:Array.isArray(s?.trips) ? s.trips.map(t => ({
        ...t,
        submissions:{Principessa:t?.submissions?.Principessa || null,Principe:t?.submissions?.Principe || null},
        confirmed:{Principessa:!!t?.confirmed?.Principessa,Principe:!!t?.confirmed?.Principe},
        budget:t?.budget ?? ''
      })) : [],
      compare:{...DEFAULT_COMPARE,...(s?.compare || {})},
      audit:Array.isArray(s?.audit) ? s.audit.slice(-2) : [],
      updatedAt:s?.updatedAt || ''
    };
  }

  function toast(msg,tone='ok'){
    const el = $('#toast');
    if(!el) return;
    el.textContent = msg;
    el.className = 'toast show ' + tone;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.className='toast', 2600);
  }

  function locationLabel(s){
    return s?.location === 'Other' ? (s.otherLocation || 'Other') : (s?.location || '—');
  }

  function tripMeta(t){
    if(!t) return {};
    const preferred = t?.submissions?.[t.createdBy];
    return preferred || t?.submissions?.Principessa || t?.submissions?.Principe || {};
  }

  function isLocked(t){
    return !!(t?.confirmed?.Principessa && t?.confirmed?.Principe);
  }

  function tripTotalSubmission(s){
    return MONEY_FIELDS.reduce((sum,k)=>sum+n(s?.[k]),0);
  }

  function differences(t){
    const a = t?.submissions?.Principessa;
    const b = t?.submissions?.Principe;
    if(!a || !b) return [];
    const out = [];

    MONEY_FIELDS.forEach(k => {
      const amountDiff = Math.abs(n(a[k])-n(b[k])) > .01;
      const certaintyDiff = !!a?.uncertain?.[k] !== !!b?.uncertain?.[k];
      if(amountDiff){
        out.push({key:k,label:MONEY_LABELS[k],a:money(a[k]),b:money(b[k]),type:'money'});
      } else if(certaintyDiff){
        out.push({
          key:k+'Certainty',label:MONEY_LABELS[k]+' certainty',
          a:a?.uncertain?.[k] ? 'Estimated' : 'Exact',
          b:b?.uncertain?.[k] ? 'Estimated' : 'Exact',type:'text'
        });
      }
    });

    if(String(a.otherNote||'').trim().toLowerCase() !== String(b.otherNote||'').trim().toLowerCase()){
      out.push({key:'otherNote',label:'Other expense note',a:a.otherNote||'—',b:b.otherNote||'—',type:'text'});
    }
    return out;
  }

  function effectiveTrip(t){
    const a = t?.submissions?.Principessa;
    const b = t?.submissions?.Principe;
    const meta = tripMeta(t);
    const out = {
      id:t?.id || '',
      location:meta.location||'',otherLocation:meta.otherLocation||'',city:meta.city||'',
      start:meta.start||'',end:meta.end||'',budget:n(t?.budget),
      uncertain:{},provisional:!(a&&b),mismatch:false,locked:isLocked(t)
    };

    MONEY_FIELDS.forEach(k => {
      if(a && b){
        const same = Math.abs(n(a[k])-n(b[k])) <= .01;
        out[k] = same ? n(a[k]) : (n(a[k])+n(b[k]))/2;
        out.uncertain[k] = !!(a?.uncertain?.[k] || b?.uncertain?.[k] || !same);
      } else {
        const s = a || b || {};
        out[k] = n(s[k]);
        out.uncertain[k] = !!s?.uncertain?.[k];
      }
    });

    out.mismatch = !!(a && b && differences(t).length);
    out.total = MONEY_FIELDS.reduce((sum,k)=>sum+n(out[k]),0);
    out.paidPrincipessa = n(a?.paid);
    out.paidPrincipe = n(b?.paid);
    out.estimated = out.provisional || out.mismatch || !out.locked || Object.values(out.uncertain).some(Boolean);
    return out;
  }

  function budgetInfo(t){
    const e = effectiveTrip(t);
    if(!e.budget) return {has:false,label:'No planned budget',delta:0,tone:'neutral'};
    const delta = e.budget - e.total;
    if(Math.abs(delta) < .01) return {has:true,label:'Exactly on budget',delta:0,tone:'ok'};
    if(delta > 0) return {has:true,label:`${money(delta)} under budget`,delta,tone:'ok'};
    return {has:true,label:`${money(Math.abs(delta))} over budget`,delta,tone:'warn'};
  }

  function jsonp(params={}){
    return new Promise((resolve,reject)=>{
      if(!API_URL) return reject(new Error('Backend URL missing'));
      const cb = '__twogether_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(()=>done(new Error('Sync timed out')),12000);

      function done(err,data){
        clearTimeout(timer);
        try{ delete window[cb]; }catch{}
        script.remove();
        err ? reject(err) : resolve(data);
      }

      window[cb] = data => done(null,data);
      const q = new URLSearchParams({...params,callback:cb,_:Date.now().toString()});
      script.src = API_URL + (API_URL.includes('?') ? '&' : '?') + q.toString();
      script.onerror = () => done(new Error('Could not reach Apps Script'));
      document.head.appendChild(script);
    });
  }

  async function postAction(action,payload){const result=await window.TwogetherAPI.post(action,payload,actor);await syncNow(true);return result;}

  async function syncNow(showErrors=false){
    if(!API_URL || syncBusy) return;
    syncBusy = true;
    try{
      const res = await jsonp({action:'state'});
      if(!res?.ok) throw new Error(res?.error || 'Sync failed');
      const next = normalizeState(res.state);
      const stamp = next.updatedAt || JSON.stringify({trips:next.trips,compare:next.compare,audit:next.audit});
      backendV3 = next.version >= 3;
      const notice = $('#backendUpgrade');
      if(notice){
        notice.classList.toggle('hidden',backendV3);
        if(!backendV3){
          notice.innerHTML = '<strong>Backend update needed.</strong><span>Redeploy the latest <code>backend/Code.gs</code> to enable editing/confirmation and trip budgets.</span>';
        }
      }

      if(stamp !== lastServerStamp){
        state = next;
        lastServerStamp = stamp;
        renderDataViews();
        if(actor && wizard.mode === null) renderWizard();
        if(openTripId && $('#tripModal')?.classList.contains('show')) renderTripModal(openTripId);
      }
    }catch(err){
      if(showErrors) toast(err.message || 'Could not sync','warn');
    }finally{
      syncBusy = false;
    }
  }

  function showIdentity(){
    const modal = $('#identityModal');
    modal?.classList.add('show');
    modal?.setAttribute('aria-hidden','false');
  }

  function chooseIdentity(name,{persist=true}={}){
    if(!ACTORS.includes(name)) return;
    actor = name;
    if(persist){
      try{ localStorage.setItem(ACTOR_KEY,name); }catch{}
    }
    document.body.dataset.actor = name;
    const badge = $('#loggedUserBadge');
    if(badge){
      badge.textContent = name;
      badge.classList.remove('hidden');
      badge.style.pointerEvents = 'none';
      badge.style.cursor = 'default';
    }
    $('#identityModal')?.classList.remove('show');
    $('#identityModal')?.setAttribute('aria-hidden','true');
    wizard = freshWizard();
    renderWizard();
    syncNow(true);
    if(syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(()=>syncNow(false),SYNC_MS);
  }

  function openSheet(id){
    $$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.sheet===id));
    $$('.sheet').forEach(x=>x.classList.toggle('active',x.id===id));
  }

  function pendingForActor(){
    return state.trips.filter(t => !isLocked(t) && !t?.submissions?.[actor] && t?.submissions?.[otherActor()]);
  }

  function editableForActor(){
    return state.trips.filter(t => !isLocked(t) && !!t?.submissions?.[actor]);
  }

  function beginNew(){
    wizard = {mode:'new',tripId:'',draft:freshDraft(),index:0,otherFlow:null};
    renderWizard();
  }

  function beginJoin(id){
    const plan=window.TwogetherWorkflow?.state.plans.find(p=>p.linkedTripId===id);
    if(plan){window.TwogetherWorkflow.start(plan.id);return;}
    const t = state.trips.find(x=>x.id===id);
    if(!t || isLocked(t)) return;
    const meta = tripMeta(t);
    wizard = {
      mode:'join',tripId:id,index:0,otherFlow:null,
      draft:{...freshDraft(),...meta,budget:t.budget ?? '',uncertain:{}}
    };
    renderWizard();
  }

  function beginEdit(id){
    const plan=window.TwogetherWorkflow?.state.plans.find(p=>p.linkedTripId===id);
    if(plan){window.TwogetherWorkflow.start(plan.id);return;}
    const t = state.trips.find(x=>x.id===id);
    const own = t?.submissions?.[actor];
    if(!t || !own || isLocked(t)) return;
    const meta = tripMeta(t);
    wizard = {
      mode:'edit',tripId:id,index:0,otherFlow:null,
      draft:{...freshDraft(),...meta,...own,budget:t.budget ?? '',uncertain:{...(own.uncertain||{})}}
    };
    closeTripModal();
    openSheet('log');
    renderWizard();
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function flowSteps(){
    if(wizard.mode === null){
      return [{key:'tripChoice',title:'Which trip are you logging?',type:'tripChoice'}];
    }

    const moneySteps = [
      {key:'accom',title:'How much was accommodation?',type:'money'},
      {key:'groceries',title:'How much on groceries?',type:'money'},
      {key:'eat',title:'How much on eating out?',type:'money'},
      {key:'travel',title:'How much on flights or trains?',type:'money'},
      {key:'fuel',title:'How much on fuel?',type:'money'},
      {key:'tolls',title:'How much on tolls or parking?',type:'money'},
      {key:'otherFlow',title:'Other expenses',type:'otherExpenses'},
      {key:'paid',title:`How much did ${actor} actually pay?`,type:'money',optional:true,noUncertain:true},
      {key:'review',title:wizard.mode==='edit' ? 'Save your corrected version?' : 'Ready to save your version?',type:'review'}
    ];

    if(wizard.mode === 'join' || wizard.mode === 'edit') return moneySteps.filter(s=>!s.when || s.when(wizard.draft));

    const locationExample = wizard.draft.location === 'Italy' ? 'Lonato del Garda' :
      wizard.draft.location === 'Portugal' ? 'Lisbon' :
      wizard.draft.location === 'Netherlands' ? 'Tilburg' : 'your city or area';

    return [
      {key:'location',title:'Where was this trip?',help:'Choose the main country.',type:'choice',options:['Italy','Netherlands','Portugal','Other']},
      {key:'otherLocation',title:'What country or place was it?',type:'text',placeholder:'e.g. Tunisia',when:d=>d.location==='Other'},
      {key:'city',title:'Which city or area?',help:`For example: ${locationExample}.`,type:'text',placeholder:`e.g. ${locationExample}`},
      {key:'start',title:'When did the trip start?',type:'date'},
      {key:'end',title:'When did it end?',type:'date'},
      {key:'budget',title:'What is your ideal total budget for this trip?',help:'Enter your own budget. Your partner adds theirs separately.',type:'budget',optional:true},
      ...moneySteps
    ].filter(s=>!s.when || s.when(wizard.draft));
  }

  function currentStep(){
    const steps = flowSteps();
    if(wizard.index >= steps.length) wizard.index = Math.max(0,steps.length-1);
    return steps[wizard.index];
  }

  function contextBanner(){
    if(wizard.mode !== 'join' && wizard.mode !== 'edit') return '';
    const t = state.trips.find(x=>x.id===wizard.tripId);
    const m = tripMeta(t);
    const verb = wizard.mode === 'edit' ? 'Editing your calculations for' : 'Adding your calculations to';
    return `<div class="existing-trip-context"><strong>${verb} ${esc(m.city || locationLabel(m))}</strong><span>${esc(locationLabel(m))} · ${fmtDate(m.start)}–${fmtDate(m.end)}</span></div>`;
  }

  function ensureOtherFlow(){
    if(!wizard.otherFlow){
      const existing=n(wizard.draft.other);
      wizard.otherFlow={
        stage:'amount',items:[],
        amount:existing>0 ? String(wizard.draft.other ?? existing) : '',
        name:existing>0 ? String(wizard.draft.otherNote || '') : '',
        uncertain:!!wizard.draft?.uncertain?.other
      };
    }
    return wizard.otherFlow;
  }

  function syncOtherDraft(){
    const f=ensureOtherFlow();
    const total=f.items.reduce((sum,item)=>sum+n(item.amount),0);
    wizard.draft.other=String(total);
    wizard.draft.otherNote=f.items.map(item=>`${item.name} · ${money(item.amount)}`).join(' + ');
    wizard.draft.uncertain={...(wizard.draft.uncertain||{})};
    wizard.draft.uncertain.other=f.items.some(item=>!!item.uncertain);
  }

  function otherFlowTitle(){
    const f=ensureOtherFlow();
    if(f.stage==='name') return 'What was this expense?';
    if(f.stage==='more') return 'Any more other expenses?';
    return f.items.length ? 'How much was the next other expense?' : 'Any other expenses?';
  }

  function otherCollectedHtml(){
    const f=ensureOtherFlow();
    if(!f.items.length) return '';
    return `<div class="v5-review">${f.items.map(item=>`<div class="v5-review-row"><span>${esc(item.name)}</span><strong>${item.uncertain?'~ ':''}${money(item.amount)}</strong></div>`).join('')}</div>`;
  }

  function otherExpensesControl(){
    const f=ensureOtherFlow();
    const list=otherCollectedHtml();
    if(f.stage==='name'){
      return `${list}<div class="v5-reference"><span>Amount</span><strong>${f.uncertain?'~ ':''}${money(f.amount)}</strong></div><div class="field-wrap"><input id="wizardOtherName" class="big-input" type="text" value="${esc(f.name||'')}" placeholder="e.g. museum tickets"></div><div class="wizard-actions"><button class="btn ghost" type="button" data-other-back>Back</button><button class="btn primary big" type="button" data-other-next>Next</button></div>`;
    }
    if(f.stage==='more'){
      return `${list}<div class="choice-grid"><button class="choice" type="button" data-other-more="yes">Yes, add another</button><button class="choice" type="button" data-other-more="no">No, continue</button></div>`;
    }
    return `${list}<div class="${f.uncertain?'uncertain-mode':''}"><div class="money-input-wrap"><span>€</span><input id="wizardOtherAmount" class="big-input money-field" inputmode="decimal" value="${esc(f.amount||'')}" placeholder="0.00"></div><div class="certainty-row"><button class="certainty ${!f.uncertain?'active':''}" type="button" data-other-certainty="exact">Exact</button><button class="certainty ${f.uncertain?'active':''}" type="button" data-other-certainty="estimate">Not sure · estimate</button></div>${f.items.length?'':'<button class="btn ghost full" type="button" data-other-none>No other expenses</button>'}</div><div class="wizard-actions"><button class="btn ghost" type="button" data-other-back>Back</button><button class="btn primary big" type="button" data-other-next>Next</button></div>`;
  }

  function renderWizard(){
    const body = $('#wizardBody');
    if(!body || !actor) return;
    const steps = flowSteps();
    const s = currentStep();
    if(s.type==='otherExpenses') s.title=otherFlowTitle();
    const stepEl = $('#wizardStep');
    const progress = $('#wizardProgress');

    if(s.type === 'review'){
      if(stepEl) stepEl.textContent = 'Review';
    }else{
      const questionCount = steps.filter(x=>x.type!=='review').length;
      const questionNumber = steps.slice(0,wizard.index+1).filter(x=>x.type!=='review').length;
      if(stepEl) stepEl.textContent = `Question ${Math.max(1,questionNumber)} of ${Math.max(1,questionCount)}`;
    }
    if(progress) progress.style.width = `${Math.max(8,((wizard.index+1)/Math.max(1,steps.length))*100)}%`;

    let control = '';
    if(s.type === 'otherExpenses'){
      control = otherExpensesControl();
    } else if(s.type === 'tripChoice'){
      const pending = pendingForActor();
      const editable = editableForActor().filter(t => t.submissions?.Principessa && t.submissions?.Principe && differences(t).length);
      control = `<div class="trip-choice-stack">
        <button class="trip-pick new-trip-pick" data-trip-pick="new" type="button"><span class="pick-icon">＋</span><div><strong>Start a new trip</strong><small>Log location, dates, planned budget and your expenses.</small></div></button>
        ${pending.map(t=>{
          const m=tripMeta(t);
          return `<button class="trip-pick" data-trip-pick="${esc(t.id)}" type="button"><span class="pick-icon">↔</span><div><strong>Add your version · ${esc(m.city||locationLabel(m))}</strong><small>${fmtDate(m.start)}–${fmtDate(m.end)} · only expense questions</small></div></button>`;
        }).join('')}
        ${editable.map(t=>{
          const m=tripMeta(t);
          return `<button class="trip-pick" data-edit-pick="${esc(t.id)}" type="button"><span class="pick-icon">✎</span><div><strong>Fix your version · ${esc(m.city||locationLabel(m))}</strong><small>Your two calculations currently differ.</small></div></button>`;
        }).join('')}
      </div>`;
    } else if(s.type === 'choice'){
      control = `<div class="choice-grid">${s.options.map(o=>`<button class="choice" type="button" data-choice="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
    } else if(s.type === 'text' || s.type === 'date'){
      control = `<div class="field-wrap"><input id="wizardInput" class="big-input" type="${s.type==='date'?'date':'text'}" value="${esc(wizard.draft[s.key]||'')}" placeholder="${esc(s.placeholder||'')}"></div>`;
    } else if(s.type === 'money' || s.type === 'moneyOrNone' || s.type === 'budget'){
      const value = wizard.draft[s.key] ?? '';
      const isUncertain = !!wizard.draft.uncertain?.[s.key];
      control = `<div class="${isUncertain?'uncertain-mode':''}">
        <div class="money-input-wrap"><span>€</span><input id="wizardInput" class="big-input money-field" inputmode="decimal" value="${esc(value)}" placeholder="0.00"></div>
        ${(!s.noUncertain && MONEY_FIELDS.includes(s.key)) ? `<div class="certainty-row"><button class="certainty ${!isUncertain?'active':''}" type="button" data-certainty="exact">Exact</button><button class="certainty ${isUncertain?'active':''}" type="button" data-certainty="estimate">Not sure · estimate</button></div>` : ''}
        ${isUncertain ? '<div class="estimate-note">This amount will count in totals but stay marked as an estimate.</div>' : ''}
        ${s.type==='moneyOrNone' ? '<button class="btn ghost full" type="button" data-none> No other expenses </button>' : ''}
        ${s.type==='budget' ? '<button class="btn ghost full" type="button" data-skip-budget>Skip budget</button>' : ''}
      </div>`;
    } else if(s.type === 'review'){
      control = reviewHtml();
    }

    const help = s.type==='tripChoice'
      ? `Start a new trip, or add your version to one ${otherActor()} already logged.`
      : (s.help || (wizard.mode==='join' ? 'The trip details are already shared. Only enter your expense calculations.' : wizard.mode==='edit' ? 'Correct only the calculations that need changing.' : ''));

    body.innerHTML = `<div class="question-stage">${contextBanner()}<h2>${esc(s.title)}</h2>${help?`<p>${esc(help)}</p>`:''}${control}${wizardActions(s)}</div>`;
    bindWizard(s);
  }

  function wizardActions(s){
    if(s.type === 'tripChoice' || s.type === 'choice' || s.type === 'review' || s.type === 'otherExpenses') return '';
    const back = `<button class="btn ghost" type="button" data-wizard-back>Back</button>`;
    const optional = s.optional;
    return `<div class="wizard-actions">${back}<button class="btn primary big" type="button" data-wizard-next>${optional?'Continue':'Next'}</button></div>`;
  }

  function reviewHtml(){
    const d = wizard.draft;
    const total = MONEY_FIELDS.reduce((sum,k)=>sum+n(d[k]),0);
    const estimate = MONEY_FIELDS.some(k=>d?.uncertain?.[k]);
    const submitLabel = wizard.mode==='edit' ? 'Update my version' : 'Save my version';
    return `<div class="review-card">
      <div class="review-total ${estimate?'estimate-total':''}"><span>Your trip calculation</span><strong>${estimate?'~ ':''}${money(total)}</strong><small>${d.budget ? `Planned budget ${money(d.budget)}` : 'No planned budget'}</small></div>
      <div class="review-grid">
        <div><span>Trip</span><strong>${esc(d.city||locationLabel(d))}</strong></div>
        <div><span>Dates</span><strong>${fmtDate(d.start)}–${fmtDate(d.end)}</strong></div>
        ${MONEY_FIELDS.map(k=>`<div class="${d?.uncertain?.[k]?'uncertain-review':''}"><span>${esc(MONEY_LABELS[k])}</span><strong>${d?.uncertain?.[k]?'~ ':''}${money(d[k])}</strong></div>`).join('')}
        <div><span>${esc(actor)} paid</span><strong>${money(d.paid)}</strong></div>
      </div>
    </div><div class="wizard-actions"><button class="btn ghost" type="button" data-wizard-back>Back</button><button class="btn primary big" type="button" data-save-version>${esc(submitLabel)}</button></div>`;
  }

  function bindWizard(s){
    $$('[data-trip-pick]').forEach(btn=>btn.addEventListener('click',()=>{
      const id=btn.dataset.tripPick;
      id==='new' ? beginNew() : beginJoin(id);
    }));
    $$('[data-edit-pick]').forEach(btn=>btn.addEventListener('click',()=>beginEdit(btn.dataset.editPick)));
    $$('[data-choice]').forEach(btn=>btn.addEventListener('click',()=>{
      wizard.draft[s.key]=btn.dataset.choice;
      wizard.index++;
      renderWizard();
    }));



    if(s.type==='otherExpenses'){
      const f=ensureOtherFlow();
      const amountInput=$('#wizardOtherAmount');
      const nameInput=$('#wizardOtherName');
      amountInput?.addEventListener('input',()=>{f.amount=amountInput.value;});
      nameInput?.addEventListener('input',()=>{f.name=nameInput.value;});
      setTimeout(()=>{(amountInput||nameInput)?.focus();},0);
      $$('[data-other-certainty]').forEach(btn=>btn.addEventListener('click',()=>{
        f.uncertain=btn.dataset.otherCertainty==='estimate';renderWizard();
      }));
      $('[data-other-none]')?.addEventListener('click',()=>{
        f.items=[];wizard.draft.other='0';wizard.draft.otherNote='';wizard.draft.uncertain.other=false;wizard.index++;renderWizard();
      });
      $('[data-other-more="yes"]')?.addEventListener('click',()=>{
        f.stage='amount';f.amount='';f.name='';f.uncertain=false;renderWizard();
      });
      $('[data-other-more="no"]')?.addEventListener('click',()=>{
        syncOtherDraft();wizard.index++;renderWizard();
      });
      $('[data-other-back]')?.addEventListener('click',()=>{
        if(f.stage==='name'){f.stage='amount';renderWizard();return;}
        if(f.stage==='more'){f.stage='name';const last=f.items.pop();if(last){f.amount=String(last.amount);f.name=last.name;f.uncertain=!!last.uncertain;syncOtherDraft();}renderWizard();return;}
        if(f.items.length){f.stage='more';renderWizard();return;}
        if(wizard.index>0){wizard.index--;renderWizard();}else{wizard=freshWizard();renderWizard();}
      });
      $('[data-other-next]')?.addEventListener('click',()=>{
        if(f.stage==='amount'){
          const value=String(f.amount||'').trim();
          if(!value||!Number.isFinite(Number(value.replace(',','.')))){toast('Enter a valid amount','warn');return;}
          f.stage='name';renderWizard();return;
        }
        if(f.stage==='name'){
          const name=String(f.name||'').trim();
          if(!name){toast('Add the name of the expense first','warn');return;}
          f.items.push({amount:String(f.amount),name,uncertain:!!f.uncertain});
          syncOtherDraft();f.amount='';f.name='';f.uncertain=false;f.stage='more';renderWizard();
        }
      });
      return;
    }

    const input = $('#wizardInput');
    if(input){
      input.addEventListener('input',()=>{
        let v=input.value;
        if(MONEY_FIELDS.includes(s.key) || s.key==='paid' || s.key==='budget'){
          if(v === '-'){
            if(MONEY_FIELDS.includes(s.key)) wizard.draft.uncertain[s.key]=true;
            v='';input.value='';
          }
        }
        wizard.draft[s.key]=v;
      });
      input.addEventListener('keydown',e=>{
        if(e.key==='Enter' && s.type!=='date'){
          e.preventDefault();
          $('[data-wizard-next]')?.click();
        }
      });
      setTimeout(()=>input.focus(),0);
    }

    $$('[data-certainty]').forEach(btn=>btn.addEventListener('click',()=>{
      wizard.draft.uncertain[s.key] = btn.dataset.certainty==='estimate';
      renderWizard();
    }));
    $('[data-none]')?.addEventListener('click',()=>{
      wizard.draft.other='0';wizard.draft.uncertain.other=false;wizard.index++;renderWizard();
    });
    $('[data-skip-budget]')?.addEventListener('click',()=>{
      wizard.draft.budget='';wizard.index++;renderWizard();
    });
    $('[data-wizard-back]')?.addEventListener('click',()=>{
      if(wizard.index>0){ wizard.index--; renderWizard(); }
      else { wizard=freshWizard(); renderWizard(); }
    });
    $('[data-wizard-next]')?.addEventListener('click',()=>{
      const value = String(wizard.draft[s.key] ?? '').trim();
      if(!s.optional && !value){ toast('Add an answer first','warn'); return; }
      if((MONEY_FIELDS.includes(s.key) || s.key==='paid' || s.key==='budget') && value && !Number.isFinite(Number(value.replace(',','.')))){
        toast('Enter a valid amount','warn');return;
      }
      wizard.index++;
      renderWizard();
    });
    $('[data-save-version]')?.addEventListener('click',saveWizardVersion);
  }

  async function saveWizardVersion(){
    const btn = $('[data-save-version]');
    if(btn) btn.disabled=true;
    const payload = {
      tripId:wizard.mode==='new' ? '' : wizard.tripId,
      submission:{...wizard.draft,uncertain:{...wizard.draft.uncertain}},
      budget:wizard.mode==='new' ? wizard.draft.budget : undefined
    };
    try{
      await postAction('saveSubmission',payload);
      toast(wizard.mode==='edit' ? 'Your version was updated' : 'Your version was saved');
      wizard=freshWizard();
      renderWizard();
    }catch(err){
      toast(err.message || 'Could not save','warn');
      if(btn) btn.disabled=false;
    }
  }

  function renderTripGallery(){
    const root = $('#tripGallery');
    if(!root) return;
    if(!state.trips.length){
      root.innerHTML='<div class="empty-state gallery-empty"><strong>No trips yet</strong><span>Your shared trips will appear here.</span></div>';
      return;
    }

    const sorted=state.trips.filter(isLocked).sort((a,b)=>String(tripMeta(b).start||b.updatedAt||'').localeCompare(String(tripMeta(a).start||a.updatedAt||'')));
    root.innerHTML=sorted.map(t=>{
      const e=effectiveTrip(t),m=tripMeta(t),d= differences(t),budget=budgetInfo(t);
      let status='';let statusClass='status-wait';
      if(isLocked(t)){status='Confirmed';statusClass='status-ok';}
      else if(t.submissions.Principessa && t.submissions.Principe && d.length){status='Needs discussion';statusClass='status-warn';}
      else if(t.submissions.Principessa && t.submissions.Principe){status='Awaiting confirmation';statusClass='status-wait';}
      else {status=`Waiting for ${t.submissions.Principessa?'Principe':'Principessa'}`;}
      return `<button class="trip-story-card" type="button" data-open-trip="${esc(t.id)}">
        <div class="trip-card-top"><span class="trip-country">${esc(locationLabel(m))}</span><span class="trip-status ${statusClass}">${esc(status)}</span></div>
        <h3>${esc(m.city||locationLabel(m))}</h3><p>${fmtDate(m.start)}–${fmtDate(m.end)}</p>
        <div class="trip-card-bottom"><strong>${e.estimated?'~ ':''}${money(e.total)}</strong><span>${budget.has?esc(budget.label):'No budget set'}</span></div>
        ${!t.submissions?.[actor] && !isLocked(t) ? '<div class="your-version-needed">Your version is still needed</div>' : ''}
      </button>`;
    }).join('');
    $$('[data-open-trip]',root).forEach(btn=>btn.addEventListener('click',()=>openTripModal(btn.dataset.openTrip)));
  }

  function openTripModal(id){
    openTripId=id;
    renderTripModal(id);
    $('#tripModal')?.classList.add('show');
    $('#tripModal')?.setAttribute('aria-hidden','false');
  }

  function closeTripModal(){
    openTripId='';
    $('#tripModal')?.classList.remove('show');
    $('#tripModal')?.setAttribute('aria-hidden','true');
  }

  function renderTripModal(id){
    const root=$('#tripModalBody');
    const t=state.trips.find(x=>x.id===id);
    if(!root || !t) return;
    const e=effectiveTrip(t),m=tripMeta(t),diff=differences(t),budget=budgetInfo(t);
    const both=!!(t.submissions.Principessa && t.submissions.Principe);
    const locked=isLocked(t);
    const own=!!t.submissions?.[actor];
    const canConfirm=backendV3 && both && !diff.length && !locked && !t.confirmed?.[actor];

    let statusHtml='';
    if(locked){
      statusHtml='<div class="match-box ok"><strong>Confirmed by both of you.</strong><span>This trip is now locked and treated as final.</span></div>';
    }else if(!both){
      statusHtml=`<div class="match-box"><strong>Waiting for ${t.submissions.Principessa?'Principe':'Principessa'}.</strong><span>Matching can be checked after both versions are logged.</span></div>`;
    }else if(diff.length){
      statusHtml=`<div class="match-box warn"><strong>Your calculations differ.</strong><span>Discuss the highlighted amounts, then each person can edit their own version until they match.</span></div>`;
    }else{
      const p=t.confirmed?.Principessa?'✓':'○',q=t.confirmed?.Principe?'✓':'○';
      statusHtml=`<div class="match-box ok"><strong>Your calculations match.</strong><span>${p} Principessa confirmed · ${q} Principe confirmed. Both confirmations lock the trip.</span></div>`;
    }

    root.innerHTML=`
      <div class="trip-modal-heading"><span class="eyebrow">${esc(locationLabel(m))}</span><h2>${esc(m.city||locationLabel(m))}</h2><p>${fmtDate(m.start)}–${fmtDate(m.end)}</p></div>
      <div class="trip-modal-total"><span>Current trip total</span><strong>${e.estimated?'~ ':''}${money(e.total)}</strong></div>
      ${statusHtml}
      <div class="budget-check ${budget.tone}"><div><span>Planned budget</span><strong>${e.budget?money(e.budget):'Not set'}</strong></div><div><span>Actual / current total</span><strong>${money(e.total)}</strong></div><div class="budget-result"><span>Budget check</span><strong>${esc(budget.label)}</strong></div></div>
      ${diff.length ? `<div class="difference-list"><h3>What differs</h3>${diff.map(x=>`<div class="difference-row"><strong>${esc(x.label)}</strong><span>Principessa: ${esc(x.a)}</span><span>Principe: ${esc(x.b)}</span></div>`).join('')}</div>` : ''}
      <div class="submission-grid">${submissionCard('Principessa',t.submissions.Principessa)}${submissionCard('Principe',t.submissions.Principe)}</div>
      <div class="trip-modal-actions">
        ${!locked && own ? '<button class="btn" type="button" data-edit-own>Edit my calculations</button>' : ''}
        ${!locked && !own && t.submissions?.[otherActor()] ? '<button class="btn" type="button" data-add-own>Add my version</button>' : ''}
        ${canConfirm ? '<button class="btn primary" type="button" data-confirm-own>Confirm my version</button>' : ''}
        ${!backendV3 && both && !diff.length ? '<span class="backend-inline-note">Backend v3 is needed before confirmation can be saved.</span>' : ''}
      </div>`;

    $('[data-edit-own]',root)?.addEventListener('click',()=>beginEdit(id));
    $('[data-add-own]',root)?.addEventListener('click',()=>{closeTripModal();openSheet('log');beginJoin(id);window.scrollTo({top:0,behavior:'smooth'});});
    $('[data-confirm-own]',root)?.addEventListener('click',async()=>{
      try{ await postAction('confirmTrip',{id}); toast('Your confirmation was saved'); await syncNow(true); }
      catch(err){ toast(err.message || 'Could not confirm','warn'); }
    });
  }

  function submissionCard(name,s){
    if(!s) return `<div class="submission-card missing"><span>${esc(name)}</span><strong>Not logged yet</strong></div>`;
    return `<div class="submission-card"><span>${esc(name)}</span><strong>${money(tripTotalSubmission(s))}</strong><small>Paid: ${money(s.paid)}</small><div class="submission-mini">${MONEY_FIELDS.map(k=>`<div><span>${esc(MONEY_LABELS[k])}</span><b>${s?.uncertain?.[k]?'~ ':''}${money(s[k])}</b></div>`).join('')}</div></div>`;
  }

  function renderMonthly(){
    const body=$('#monthlyBody');
    if(!body) return;
    const trips=state.trips.map(effectiveTrip);
    const stats=MONTHS.map(([key,label])=>{
      const monthTrips=trips.filter(t=>String(t.start||'').slice(0,7)===key);
      const s={key,label,trips:monthTrips.length,accom:0,groceries:0,eat:0,travel:0,fuel:0,tolls:0,other:0,total:0,estimated:false};
      monthTrips.forEach(t=>{
        MONEY_FIELDS.forEach(k=>s[k]+=n(t[k]));
        s.total+=t.total;s.estimated=s.estimated||t.estimated;
      });
      return s;
    });

    body.innerHTML=stats.map(s=>`<tr><td>${s.label}</td><td>${s.trips}</td>${MONEY_FIELDS.map(k=>`<td>${money(s[k])}</td>`).join('')}<td>${s.estimated?'~ ':''}${money(s.total)}</td><td>${s.estimated?'~ ':''}${money(s.total/2)}</td></tr>`).join('');
    const total=stats.reduce((sum,m)=>sum+m.total,0);
    const tripCount=stats.reduce((sum,m)=>sum+m.trips,0);
    const activeMonths=stats.filter(m=>m.trips>0).length||1;
    $('#kpiTotal').textContent=money(total);
    $('#kpiMonth').textContent=money(total/activeMonths);
    $('#kpiPerson').textContent=money(total/activeMonths/2);
    $('#kpiTrip').textContent=money(tripCount?total/tripCount:0);
    $('#kpiTrips').textContent=String(tripCount);
  }

  function actualCurrentSituation(){
    const trips=state.trips.filter(t=>{
      const start=tripMeta(t).start||'';
      return start>='2026-01-01' && start<='2026-12-31';
    });
    const months=new Set(trips.map(t=>String(tripMeta(t).start||'').slice(0,7)).filter(Boolean));
    const divisor=months.size||1;
    const p=trips.reduce((sum,t)=>sum+n(t?.submissions?.Principessa?.paid),0)/divisor;
    const q=trips.reduce((sum,t)=>sum+n(t?.submissions?.Principe?.paid),0)/divisor;
    return {principessa:p,principe:q,total:p+q,trips:trips.length};
  }

  function renderCompare(){
    const rentRoot=$('#rentRows'),carRoot=$('#carRows');
    if(rentRoot) rentRoot.innerHTML=compareRowsHtml(RENT_DEFS);
    if(carRoot) carRoot.innerHTML=compareRowsHtml(CAR_DEFS);
    $$('[data-compare-key]').forEach(input=>input.addEventListener('change',async()=>{
      const key=input.dataset.compareKey;
      const value=n(input.value);
      state.compare[key]=value;
      renderCompareNumbers();
      try{ await postAction('updateCompare',{key,value}); }
      catch(err){ toast('Could not save comparison','warn'); }
    }));
    renderCompareNumbers();
  }

  function compareRowsHtml(defs){
    return defs.map(([label,key])=>`<div class="r"><span>${esc(label)}</span><strong class="editable"><input type="number" min="0" step="1" data-compare-key="${esc(key)}" value="${esc(state.compare[key])}"></strong></div>`).join('');
  }

  function renderCompareNumbers(){
    const current=actualCurrentSituation();
    const rent=RENT_DEFS.reduce((sum,[,k])=>sum+n(state.compare[k]),0);
    const car=CAR_DEFS.reduce((sum,[,k])=>sum+n(state.compare[k]),0);
    if($('#currentAvg')) $('#currentAvg').textContent=money(current.total);
    if($('#yourShare')) $('#yourShare').textContent=money(current.principessa);
    if($('#hisShare')) $('#hisShare').textContent=money(current.principe);
    if($('#tripAvg')) $('#tripAvg').textContent=String(current.trips);

    const values={
      snapCurrent:current.total,
      snapCurrentCar:current.total+car,
      snapRent:rent,
      snapRentCar:rent+car,
      snapCurrentRent:current.total+rent,
      snapAll:current.total+rent+car
    };
    Object.entries(values).forEach(([id,val])=>{const el=$('#'+id);if(el)el.textContent=money(val);});
  }

  function renderActivity(){
    const root=$('#activityList');
    if(!root) return;
    const items=[...(state.audit||[])].slice(-2).reverse();
    if(!items.length){root.innerHTML='<div class="activity-empty">No recent changes yet.</div>';return;}
    root.innerHTML=items.map(a=>{
      const t=state.trips.find(x=>x.id===a.ref);
      const place=t ? (tripMeta(t).city||locationLabel(tripMeta(t))) : '';
      const labels={
        addSubmission:'added a trip version',updateSubmission:'edited a trip version',confirmTrip:'confirmed a trip',
        updateTripBudget:'updated a trip budget',updateCompare:'updated the comparison',deleteTrip:'deleted a trip'
      };
      const action=labels[a.action]||String(a.action||'made a change');
      return `<div class="activity-item"><span class="avatar-mini">${esc(String(a.actor||'?').slice(0,1))}</span><div><strong>${esc(a.actor||'Unknown')}</strong> ${esc(action)}${place?` · ${esc(place)}`:''}<small>${formatTime(a.at)}</small></div></div>`;
    }).join('');
  }

  function formatTime(value){
    if(!value) return '';
    const d=new Date(value);
    if(Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
  }

  function renderDataViews(){
    renderTripGallery();
    renderMonthly();
    renderCompare();
    renderActivity();
  }

  function bindStatic(){
    $$('.tab').forEach(tab=>tab.addEventListener('click',()=>openSheet(tab.dataset.sheet)));
    $$('.identity-choice[data-actor]').forEach(btn=>btn.addEventListener('click',()=>chooseIdentity(btn.dataset.actor)));
    $('#restartWizard')?.addEventListener('click',()=>{wizard=freshWizard();renderWizard();});
    $$('[data-close-trip]').forEach(el=>el.addEventListener('click',closeTripModal));
    const brand=$('#brandMark');
    if(brand){brand.removeAttribute('title');brand.style.cursor='default';}
  }

  window.TwogetherApp={open:openTripModal};

  function init(){
    document.addEventListener('twogether:saved',()=>syncNow(false));
    bindStatic();
    renderDataViews();
    let saved='';
    try{saved=localStorage.getItem(ACTOR_KEY)||'';}catch{}
    if(ACTORS.includes(saved)) chooseIdentity(saved,{persist:false});
    else showIdentity();
  }

  document.addEventListener('DOMContentLoaded',init);
})();

