(() => {
  'use strict';

  const CONFIG = window.TOGETHER_BUDGET_CONFIG || {};
  const API_URL = String(CONFIG.appsScriptUrl || '').trim();
  const ACTOR_KEY = 'twogether_actor_v1';
  const ACTORS = ['Principessa','Principe'];
  const MONEY_FIELDS = ['accom','groceries','eat','travel','fuel','tolls','other'];
  const MONEY_LABELS = {
    accom:'Accommodation', groceries:'Groceries', eat:'Eating out',
    travel:'Flights / Train', fuel:'Fuel', tolls:'Tolls / Parking', other:'Other'
  };

  let sharedState = {version:0, plans:[], trips:[]};
  let refreshPromise = null;
  let lastTripId = '';
  let bypassNewTrip = false;
  let activeFlow = null;
  let budgetModalMode = '';
  let budgetModalPlanId = '';

  const $ = (s,r=document) => r.querySelector(s);
  const $$ = (s,r=document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const n = v => { const x=Number(String(v ?? '').replace(',','.')); return Number.isFinite(x) ? x : 0; };
  const money = v => '€' + n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtDate = v => { if(!v) return '—'; const [y,m,d]=String(v).split('-'); return y&&m&&d ? `${d}/${m}/${y}` : String(v); };

  function actor(){
    const current = document.body.dataset.actor || '';
    if(ACTORS.includes(current)) return current;
    try{
      const saved = localStorage.getItem(ACTOR_KEY) || '';
      return ACTORS.includes(saved) ? saved : '';
    }catch{}
    return '';
  }
  function otherActor(name){ return name === 'Principessa' ? 'Principe' : 'Principessa'; }
  function locationLabel(meta){ return meta?.location === 'Other' ? (meta.otherLocation || 'Other') : (meta?.location || '—'); }
  function toast(msg,tone='ok'){
    const el=$('#toast'); if(!el) return;
    el.textContent=msg; el.className='toast show '+tone;
    clearTimeout(el._v5t); el._v5t=setTimeout(()=>{el.className='toast';},2600);
  }

  function jsonp(params={}){
    return new Promise((resolve,reject)=>{
      if(!API_URL) return reject(new Error('Backend URL missing'));
      const cb='__twogether_v5_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      const script=document.createElement('script');
      const timer=setTimeout(()=>done(new Error('Sync timed out')),10000);
      function done(err,data){
        clearTimeout(timer);
        try{delete window[cb];}catch{}
        script.remove();
        err ? reject(err) : resolve(data);
      }
      window[cb]=data=>done(null,data);
      const q=new URLSearchParams({...params,callback:cb,_:String(Date.now())});
      script.src=API_URL+(API_URL.includes('?')?'&':'?')+q.toString();
      script.onerror=()=>done(new Error('Could not reach Apps Script'));
      document.head.appendChild(script);
    });
  }

  function post(action,payload,name=actor()){
    return new Promise((resolve,reject)=>{
      if(!API_URL) return reject(new Error('Backend URL missing'));
      if(!name) return reject(new Error('Choose your profile first'));
      const frame=document.querySelector('iframe[name="backendFrame"]');
      if(!frame) return reject(new Error('Backend frame missing'));
      const form=document.createElement('form');
      form.method='POST'; form.action=API_URL; form.target='backendFrame'; form.style.display='none';
      const fields={action,actor:name,payload:JSON.stringify(payload||{})};
      Object.entries(fields).forEach(([k,v])=>{
        const input=document.createElement('input'); input.type='hidden'; input.name=k; input.value=v; form.appendChild(input);
      });
      document.body.appendChild(form); form.submit(); form.remove();
      setTimeout(resolve,700);
    });
  }

  async function refreshState(){
    if(refreshPromise) return refreshPromise;
    refreshPromise=(async()=>{
      try{
        const res=await jsonp({action:'state'});
        if(res?.ok){
          sharedState={
            version:Number(res.state?.version||0),
            plans:Array.isArray(res.state?.plans)?res.state.plans:[],
            trips:Array.isArray(res.state?.trips)?res.state.trips:[]
          };
          renderBudgetPlans();
          decorateCoreWizard();
        }
        return sharedState;
      }finally{
        refreshPromise=null;
      }
    })();
    return refreshPromise;
  }

  function planById(id){ return sharedState.plans.find(p=>p.id===id); }
  function tripById(id){ return sharedState.trips.find(t=>t.id===id); }
  function tripForPlan(plan){ return plan?.linkedTripId ? tripById(plan.linkedTripId) : null; }
  function isLocked(trip){ return !!(trip?.confirmed?.Principessa && trip?.confirmed?.Principe); }

  function installStyles(){
    if($('#workflowV5Styles')) return;
    const style=document.createElement('style'); style.id='workflowV5Styles';
    style.textContent=`
      .v5-overlay{display:none;position:absolute;inset:0;z-index:8;background:var(--card,#fffefa);border-radius:29px;padding:22px;overflow:auto}.v5-overlay.show{display:flex;flex-direction:column}.wizard-card{position:relative}
      .v5-top{display:flex;justify-content:space-between;align-items:start;gap:18px}.v5-progress-side{flex:1}.v5-step{font-size:12px;font-weight:850;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.v5-progress{height:5px;background:#eee7df;border-radius:999px;margin-top:9px;overflow:hidden}.v5-progress span{display:block;height:100%;background:linear-gradient(90deg,var(--rose),var(--accent));border-radius:inherit;transition:width .2s ease}
      .v5-body{flex:1;display:flex}.v5-question{width:100%;display:flex;flex-direction:column;justify-content:center;padding:25px 18px 8px}.v5-question h2{font-size:clamp(30px,3vw,44px);font-weight:500;letter-spacing:-.035em;margin:0}.v5-question>p{color:var(--muted);margin:10px 0 22px;line-height:1.55}
      .v5-reference{background:#edf2e9;border:1px solid rgba(90,110,85,.12);border-radius:17px;padding:13px 15px;margin-bottom:12px}.v5-reference span{display:block;font-size:12px;color:var(--muted);margin-bottom:3px}.v5-reference strong{font-size:21px}.v5-reference small{display:block;color:var(--muted);margin-top:5px}
      .v5-choice-stack{display:grid;gap:10px}.v5-actions{display:flex;justify-content:space-between;gap:10px;margin-top:20px}.v5-use{width:100%;border:1px dashed #d4c9bd;background:#faf7f2;border-radius:14px;padding:10px 12px;margin-top:10px;cursor:pointer;color:var(--muted)}
      .v5-review{display:grid;gap:9px}.v5-review-row{display:flex;justify-content:space-between;gap:14px;background:#f6f2ed;border-radius:14px;padding:11px 13px}.v5-review-row span{color:var(--muted)}
      .budget-planner-section{margin:34px 0 30px}.budget-planner-head{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:15px}.budget-planner-head h2{margin:3px 0 0;font-size:30px}.budget-planner-head p{margin:5px 0 0;color:var(--muted);max-width:720px}.budget-plan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}
      .budget-plan-card{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:18px;box-shadow:0 10px 28px rgba(60,45,35,.055)}.budget-plan-top{display:flex;justify-content:space-between;gap:10px;align-items:start}.budget-plan-top h3{margin:2px 0 4px;font-size:23px}.budget-plan-top p{margin:0;color:var(--muted)}.budget-plan-status{font-size:11px;padding:6px 9px;border-radius:999px;background:#f1eee9;white-space:nowrap}.budget-plan-status.live{background:#edf2e9}.budget-plan-status.done{background:#e8f1e9}
      .budget-person-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:15px 0}.budget-person{background:#f7f3ee;border-radius:15px;padding:11px}.budget-person span{display:block;font-size:12px;color:var(--muted)}.budget-person strong{display:block;margin-top:3px;font-size:19px}.budget-person small{display:block;margin-top:4px;color:var(--muted);line-height:1.3}.budget-person.over small,.budget-total-check.over strong{color:#9d4b3e}.budget-person.under small,.budget-total-check.under strong{color:#4e7352}.budget-total-check{border-top:1px solid var(--line);padding-top:12px;display:flex;justify-content:space-between;gap:12px}.budget-total-check span{color:var(--muted)}.budget-plan-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.budget-empty{background:var(--card);border:1px dashed var(--line);border-radius:20px;padding:18px;color:var(--muted)}
      .v5-budget-modal{display:none;position:fixed;inset:0;z-index:195;place-items:center;padding:20px}.v5-budget-modal.show{display:grid}.v5-budget-backdrop{position:absolute;inset:0;background:rgba(40,34,30,.5);backdrop-filter:blur(7px)}.v5-budget-card{position:relative;width:min(690px,100%);max-height:calc(100vh - 40px);overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:28px;padding:24px;box-shadow:0 24px 80px rgba(60,45,35,.18)}.v5-budget-close{position:absolute;right:16px;top:12px;border:0;background:none;font-size:28px;cursor:pointer;color:var(--muted)}.v5-budget-card h2{margin:7px 36px 5px 0;font-size:32px}.v5-budget-card>p{color:var(--muted);margin:0 0 18px}.v5-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}.v5-field{display:grid;gap:5px}.v5-field.full{grid-column:1/-1}.v5-field label{font-size:12px;color:var(--muted)}.v5-field input,.v5-field select{width:100%;border:1px solid var(--line);background:#fff;border-radius:14px;padding:12px 13px;font:inherit;font-size:16px;outline:none}.v5-modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:18px}
      @media(max-width:640px){.budget-planner-head{align-items:start;flex-direction:column}.budget-person-grid,.v5-form{grid-template-columns:1fr}.v5-field.full{grid-column:auto}}
    `;
    document.head.appendChild(style);
  }

  function installUi(){
    installStyles();
    const card=$('#wizardCard');
    if(card && !$('#workflowV5Overlay')){
      const overlay=document.createElement('div'); overlay.id='workflowV5Overlay'; overlay.className='v5-overlay';
      card.appendChild(overlay);
    }
    if(!$('#budgetPlannerSection')){
      const gallery=$('.trip-gallery-section');
      if(gallery){
        const section=document.createElement('section'); section.id='budgetPlannerSection'; section.className='budget-planner-section hidden';
        section.innerHTML=`<div class="budget-planner-head"><div><span class="panel-kicker">BEFORE THE TRIP</span><h2>Trip budgets</h2><p>Each of you sets your own budget. After the trip, actual expenses are compared individually and together.</p></div><button class="btn primary" type="button" data-v5-new-plan>Plan a trip budget</button></div><div id="budgetPlanGrid" class="budget-plan-grid"></div>`;
        gallery.parentNode.insertBefore(section,gallery);
        $('[data-v5-new-plan]',section)?.addEventListener('click',openNewPlan);
      }
    }
    if(!$('#workflowBudgetModal')){
      const modal=document.createElement('div'); modal.id='workflowBudgetModal'; modal.className='v5-budget-modal'; modal.setAttribute('aria-hidden','true');
      modal.innerHTML='<div class="v5-budget-backdrop" data-v5-budget-close></div><div class="v5-budget-card"><button class="v5-budget-close" type="button" data-v5-budget-close>×</button><div id="workflowBudgetBody"></div></div>';
      document.body.appendChild(modal);
      $$('[data-v5-budget-close]',modal).forEach(el=>el.addEventListener('click',closeBudgetModal));
    }
  }

  function showOverlay(stepLabel,progress,title,help,content){
    installUi();
    const overlay=$('#workflowV5Overlay'); if(!overlay) return;
    overlay.innerHTML=`<div class="v5-top"><div class="v5-progress-side"><div class="v5-step">${esc(stepLabel)}</div><div class="v5-progress"><span style="width:${Math.max(8,Math.min(100,progress))}%"></span></div></div><button class="text-btn" type="button" data-v5-close>Start over</button></div><div class="v5-body"><div class="v5-question"><h2>${esc(title)}</h2>${help?`<p>${esc(help)}</p>`:''}${content}</div></div>`;
    overlay.classList.add('show');
    $('[data-v5-close]',overlay)?.addEventListener('click',closeOverlay);
  }

  function closeOverlay(){
    activeFlow=null;
    const overlay=$('#workflowV5Overlay');
    overlay?.classList.remove('show');
    if(overlay) overlay.innerHTML='';
  }

  function variance(budget,actual){
    if(budget===''||budget==null) return {text:'Budget not set',cls:''};
    if(actual===''||actual==null) return {text:'Actual spend not logged yet',cls:''};
    const d=n(budget)-n(actual);
    if(Math.abs(d)<.01) return {text:'Exactly on budget',cls:'under'};
    return d>0 ? {text:`${money(d)} under budget`,cls:'under'} : {text:`${money(Math.abs(d))} over budget`,cls:'over'};
  }

  function partialSummary(partial){
    if(!partial)return '';
    const parts=[];
    MONEY_FIELDS.forEach(key=>{
      if(partial[key]!==''&&partial[key]!=null){
        const note=key==='other'&&partial.otherNote?` (${partial.otherNote})`:'';
        parts.push(`${MONEY_LABELS[key]} ${money(partial[key])}${note}`);
      }
    });
    return parts.join(' · ');
  }

  function hasPartial(partial){
    return !!partialSummary(partial);
  }

  function renderBudgetPlans(){
    installUi();
    const section=$('#budgetPlannerSection'); const root=$('#budgetPlanGrid');
    if(!section||!root) return;
    if(sharedState.version<4){ section.classList.add('hidden'); root.innerHTML=''; return; }
    section.classList.remove('hidden');
    const plans=[...sharedState.plans].sort((a,b)=>String(b?.meta?.start||b.updatedAt||'').localeCompare(String(a?.meta?.start||a.updatedAt||'')));
    if(!plans.length){ root.innerHTML='<div class="budget-empty">No planned trip budgets yet. Create one before your next trip.</div>'; return; }
    const visiblePlans=plans.filter(plan=>!isLocked(tripForPlan(plan)));
    const a=actor();
    const emptyActive=visiblePlans.length?'':'<div class="budget-empty">No active trip budgets right now. Your confirmed budgets stay inside their trip pages.</div>';
    root.innerHTML=emptyActive+plans.map(plan=>{
      const meta=plan.meta||{}; const trip=tripForPlan(plan); const locked=isLocked(trip);
      const pBudget=plan?.budgets?.Principessa??''; const qBudget=plan?.budgets?.Principe??'';
      const pActual=trip?.submissions?.Principessa?.paid??''; const qActual=trip?.submissions?.Principe?.paid??'';
      const pPartial=plan?.partials?.Principessa||null; const qPartial=plan?.partials?.Principe||null;
      const pEarly=partialSummary(pPartial), qEarly=partialSummary(qPartial);
      const pv=variance(pBudget,pActual), qv=variance(qBudget,qActual);
      const bothBudgets=pBudget!==''&&qBudget!==''; const bothActual=pActual!==''&&qActual!=='';
      const totalVar=bothBudgets&&bothActual?variance(n(pBudget)+n(qBudget),n(pActual)+n(qActual)):{text:bothBudgets?'Waiting for both actual spends':'Waiting for both budgets',cls:''};
      const ownBudget=plan?.budgets?.[a]??''; const ownSub=trip?.submissions?.[a]||null;
      const ownPartial=plan?.partials?.[a]||null; const ownStarted=hasPartial(ownPartial);
      const anyPartial=hasPartial(pPartial)||hasPartial(qPartial);
      const status=trip?'Trip expenses in progress':anyPartial?'Some expenses logged':'Waiting for the trip';
      const combinedPlanned=bothBudgets ? money(n(pBudget)+n(qBudget)) : 'Waiting for both budgets';
      return `<article class="budget-plan-card ${locked?'hidden':''}" data-v5-plan="${esc(plan.id)}"><div class="budget-plan-top"><div><span class="trip-country">${esc(locationLabel(meta))}</span><h3>${esc(meta.city||locationLabel(meta))}</h3><p>${fmtDate(meta.start)}–${fmtDate(meta.end)}</p></div><span class="budget-plan-status ${trip||anyPartial?'live':''}">${esc(status)}</span></div><div class="v5-reference"><span>Combined planned budget</span><strong>${esc(combinedPlanned)}</strong></div><div class="budget-person-grid"><div class="budget-person ${pv.cls}"><span>Principessa</span><strong>${pBudget===''?'No budget':money(pBudget)}</strong><small>${esc(pv.text)}${pActual!==''?` · actual ${money(pActual)}`:''}${pEarly?` · saved early: ${esc(pEarly)}`:''}</small></div><div class="budget-person ${qv.cls}"><span>Principe</span><strong>${qBudget===''?'No budget':money(qBudget)}</strong><small>${esc(qv.text)}${qActual!==''?` · actual ${money(qActual)}`:''}${qEarly?` · saved early: ${esc(qEarly)}`:''}</small></div></div><div class="budget-total-check ${totalVar.cls}"><span>Combined</span><strong>${esc(totalVar.text)}</strong></div><div class="budget-plan-actions">${a&&!ownSub&&!ownStarted?`<button class="btn ghost" type="button" data-v5-own-budget>${ownBudget===''?'Add my budget':'Edit my budget'}</button>`:a&&(ownSub||ownStarted)?'<span class="budget-locked-note">Your planned budget is locked because you already started logging actual expenses.</span>':''}${a&&!locked&&ownBudget!==''?`<button class="btn primary" type="button" data-v5-actual>${ownSub?'Edit my actual expenses':ownStarted?'Continue actual expenses':'Log actual expenses'}</button>`:''}${trip?'<button class="btn ghost" type="button" data-v5-open-trip>Open trip</button>':''}</div></article>`;
    }).join('');
    $$('[data-v5-plan]',root).forEach(card=>{
      const id=card.dataset.v5Plan;
      $('[data-v5-own-budget]',card)?.addEventListener('click',()=>openBudgetOnly(id));
      $('[data-v5-actual]',card)?.addEventListener('click',()=>startActualChoice(id));
      $('[data-v5-open-trip]',card)?.addEventListener('click',()=>{
        const plan=planById(id); const tripId=plan?.linkedTripId;
        if(tripId) document.querySelector(`[data-open-trip="${CSS.escape(tripId)}"]`)?.click();
      });
    });
  }

  function closeBudgetModal(){
    budgetModalMode=''; budgetModalPlanId='';
    const modal=$('#workflowBudgetModal'); modal?.classList.remove('show'); modal?.setAttribute('aria-hidden','true');
  }
  function showBudgetModal(html){
    installUi(); const modal=$('#workflowBudgetModal'); const body=$('#workflowBudgetBody');
    if(body) body.innerHTML=html; modal?.classList.add('show'); modal?.setAttribute('aria-hidden','false');
  }

  function openNewPlan(){
    if(sharedState.version<4){ toast('Trip budgets are not available yet','warn'); return; }
    const a=actor(); if(!a){toast('Choose your profile first','warn');return;}
    budgetModalMode='new'; budgetModalPlanId='';
    showBudgetModal(`<span class="panel-kicker">PLAN BEFORE THE TRIP</span><h2>Create a trip budget</h2><p>Add the trip details and your individual budget. ${esc(otherActor(a))} can add theirs separately.</p><div class="v5-form"><div class="v5-field"><label>Country</label><select id="v5PlanLocation"><option>Italy</option><option>Netherlands</option><option>Portugal</option><option>Other</option></select></div><div class="v5-field"><label>If Other</label><input id="v5PlanOther" placeholder="e.g. Tunisia"></div><div class="v5-field full"><label>City / area</label><input id="v5PlanCity" placeholder="e.g. Lonato del Garda"></div><div class="v5-field"><label>Start date</label><input id="v5PlanStart" type="date"></div><div class="v5-field"><label>End date</label><input id="v5PlanEnd" type="date"></div><div class="v5-field full"><label>${esc(a)} individual budget</label><input id="v5PlanBudget" inputmode="decimal" placeholder="0.00"></div></div><div class="v5-modal-actions"><button class="btn primary" type="button" data-v5-save-plan>Save trip budget</button></div>`);
    $('[data-v5-save-plan]')?.addEventListener('click',saveNewPlan);
  }

  async function saveNewPlan(){
    const a=actor();
    const meta={location:$('#v5PlanLocation')?.value||'',otherLocation:$('#v5PlanOther')?.value||'',city:$('#v5PlanCity')?.value||'',start:$('#v5PlanStart')?.value||'',end:$('#v5PlanEnd')?.value||''};
    const budget=$('#v5PlanBudget')?.value||'';
    if(!meta.location||!meta.city||!meta.start||!meta.end){toast('Add the trip details first','warn');return;}
    if(!budget||!Number.isFinite(Number(budget.replace(',','.')))){toast('Enter your budget first','warn');return;}
    try{
      await post('savePlan',{meta,budget},a); closeBudgetModal(); toast('Your trip budget was saved');
      setTimeout(refreshState,750);
    }catch(err){toast(err.message||'Could not save budget','warn');}
  }

  function openBudgetOnly(id){
    const plan=planById(id); const a=actor(); if(!plan||!a)return;
    budgetModalMode='budget'; budgetModalPlanId=id;
    showBudgetModal(`<span class="panel-kicker">YOUR BUDGET</span><h2>${esc(plan.meta?.city||locationLabel(plan.meta))}</h2><p>${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)} · this only changes ${esc(a)}’s planned spending limit.</p><div class="v5-form"><div class="v5-field full"><label>${esc(a)} individual budget</label><input id="v5PlanBudget" inputmode="decimal" value="${esc(String(plan?.budgets?.[a]??''))}" placeholder="0.00"></div></div><div class="v5-modal-actions"><button class="btn primary" type="button" data-v5-save-budget>Save my budget</button></div>`);
    $('[data-v5-save-budget]')?.addEventListener('click',saveBudgetOnly);
  }

  async function saveBudgetOnly(){
    const plan=planById(budgetModalPlanId); const budget=$('#v5PlanBudget')?.value||'';
    if(!plan||!budget||!Number.isFinite(Number(budget.replace(',','.')))){toast('Enter a valid budget','warn');return;}
    try{
      await post('savePlan',{id:plan.id,budget}); closeBudgetModal(); toast('Your budget was updated');
      setTimeout(refreshState,750);
    }catch(err){toast(err.message||'Could not save budget','warn');}
  }

  function eligibleBudgetPlans(){
    const a=actor(); if(!a||sharedState.version<4) return [];
    return sharedState.plans.filter(plan=>{
      const ownBudget=plan?.budgets?.[a]; if(ownBudget===''||ownBudget==null) return false;
      const trip=tripForPlan(plan); if(isLocked(trip)) return false;
      return !trip?.submissions?.[a];
    });
  }

  function showNewTripChoice(originalButton){
    const plans=eligibleBudgetPlans();
    if(!plans.length){
      bypassNewTrip=true; originalButton.click(); bypassNewTrip=false; return;
    }
    activeFlow={type:'choosePlan',originalButton};
    const choices=`<div class="v5-choice-stack">${plans.map(plan=>`<button class="trip-pick" type="button" data-v5-plan-actual="${esc(plan.id)}"><span class="pick-icon">↔</span><div><strong>Yes · ${esc(plan.meta?.city||locationLabel(plan.meta))}</strong><small>${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)} · log the actual expenses</small></div></button>`).join('')}<button class="trip-pick new-trip-pick" type="button" data-v5-really-new><span class="pick-icon">＋</span><div><strong>No · this is a different trip</strong><small>Start the normal new-trip questions.</small></div></button></div>`;
    showOverlay('TRIP TYPE',12,'Is this one of your budgeted trips?','Choose the planned trip to enter its actual expenses, or start a completely new trip.',choices);
    $$('[data-v5-plan-actual]').forEach(btn=>btn.addEventListener('click',()=>startActualChoice(btn.dataset.v5PlanActual)));
    $('[data-v5-really-new]')?.addEventListener('click',()=>{
      const btn=activeFlow?.originalButton||originalButton; closeOverlay();
      bypassNewTrip=true; btn.click(); bypassNewTrip=false;
    });
  }

  function startActualChoice(planId){
    const plan=planById(planId); const a=actor();
    if(!plan||!a){ toast('Could not open this budgeted trip','warn'); return; }
    installUi();
    closeBudgetModal();
    document.querySelector('.tab[data-sheet="log"]')?.click();
    if(sharedState.version<7){
      startPlanActual(planId);
      return;
    }
    const partial=plan?.partials?.[a]||null;
    const saved=partialSummary(partial);
    requestAnimationFrame(()=>{
      const content=`${saved?`<div class="v5-reference"><span>Already saved for later</span><strong>${esc(saved)}</strong></div>`:''}<div class="v5-choice-stack"><button class="trip-pick" type="button" data-v5-actual-mode="full"><span class="pick-icon">✓</span><div><strong>Log everything now</strong><small>Use the normal full trip-expense wizard. Anything saved earlier is already filled in.</small></div></button><button class="trip-pick" type="button" data-v5-actual-mode="partial"><span class="pick-icon">＋</span><div><strong>Log some expenses now</strong><small>Save one or more expense categories now and finish the rest later.</small></div></button></div>`;
      showOverlay('ACTUAL EXPENSES',12,'How much do you want to log now?','Record a few expenses now or complete the whole trip.',content);
      $('[data-v5-actual-mode="full"]')?.addEventListener('click',()=>startPlanActual(planId));
      $('[data-v5-actual-mode="partial"]')?.addEventListener('click',()=>startPartialActual(planId));
      $('#wizardCard')?.scrollIntoView({behavior:'smooth',block:'center'});
    });
  }

  function startPartialActual(planId){
    const plan=planById(planId); const a=actor(); if(!plan||!a)return;
    const existing=plan?.partials?.[a]||{};
    const draft={otherNote:existing.otherNote||'',uncertain:{...(existing.uncertain||{})}};
    MONEY_FIELDS.forEach(key=>{draft[key]=existing[key]??'';});
    const hadSaved=hasPartial(existing);
    activeFlow={type:'partial',planId,stage:'choose',key:'',draft,expanded:hadSaved,mode:'new',entryAmount:'',entryUncertain:false,pendingAmount:null,pendingUncertain:false,entryName:''};
    closeBudgetModal();
    document.querySelector('.tab[data-sheet="log"]')?.click();
    renderPartialActual();
    $('#wizardCard')?.scrollIntoView({behavior:'smooth',block:'center'});
  }

  function partialHasValue(f,key){ return f?.draft?.[key]!=='' && f?.draft?.[key]!=null; }

  function beginPartialAmount(f,key,mode){
    f.key=key; f.mode=mode||'new'; f.stage='amount';
    f.entryAmount=f.mode==='replace'?String(f.draft[key]??''):'';
    f.entryUncertain=f.mode==='replace'?!!f.draft?.uncertain?.[key]:false;
    f.entryName=''; f.pendingAmount=null; f.pendingUncertain=false;
    renderPartialActual();
  }

  function commitPartialEntry(f,name){
    const key=f.key;
    const entered=n(f.pendingAmount==null?f.entryAmount:f.pendingAmount);
    const old=partialHasValue(f,key)?n(f.draft[key]):0;
    const oldUncertain=!!f.draft?.uncertain?.[key];
    const entryUncertain=f.pendingAmount==null?!!f.entryUncertain:!!f.pendingUncertain;
    const total=f.mode==='add'?old+entered:entered;
    f.draft[key]=String(total);
    f.draft.uncertain={...(f.draft.uncertain||{})};
    f.draft.uncertain[key]=f.mode==='add'?(oldUncertain||entryUncertain):entryUncertain;
    if(key==='other'){
      const clean=String(name||'').trim();
      if(f.mode==='add'&&String(f.draft.otherNote||'').trim())f.draft.otherNote=`${f.draft.otherNote} + ${clean}`;
      else f.draft.otherNote=clean;
    }
    f.entryAmount=''; f.entryName=''; f.pendingAmount=null; f.pendingUncertain=false; f.entryUncertain=false;
    f.stage='more';
    renderPartialActual();
  }

  function renderPartialActual(){
    const f=activeFlow; if(!f||f.type!=='partial')return;
    const plan=planById(f.planId); if(!plan)return closeOverlay();
    const saved=partialSummary(f.draft);
    const icons={accom:'⌂',groceries:'▣',eat:'♨',travel:'✈',fuel:'⛽',tolls:'↔',other:'＋'};
    const core=['accom','travel'];

    if(f.stage==='choose'){
      const partialOrder=['accom','travel','groceries','eat','fuel','tolls','other'];
      const unlogged=partialOrder.filter(key=>!partialHasValue(f,key));
      let selectable=f.expanded?unlogged:core.filter(key=>unlogged.includes(key));
      if(!selectable.length&&!f.expanded){f.expanded=true;selectable=unlogged;}
      const choices=selectable.map(key=>`<button class="trip-pick" type="button" data-v5-partial-key="${key}"><span class="pick-icon">${icons[key]||'＋'}</span><div><strong>${esc(MONEY_LABELS[key])}</strong><small>Add ${esc(MONEY_LABELS[key].toLowerCase())}</small></div></button>`).join('');
      const savedKeys=partialOrder.filter(key=>partialHasValue(f,key));
      const savedChoices=savedKeys.map(key=>`<button class="trip-pick" type="button" data-v5-partial-saved="${key}"><span class="pick-icon">↻</span><div><strong>${esc(MONEY_LABELS[key])}</strong><small>Saved total ${money(f.draft[key])} · add another or edit</small></div></button>`).join('');
      const intro=!f.expanded?'Start with accommodation and/or Flights / Train. After your first entry, you can add the other categories.':'Choose one of the remaining categories. Saved categories can still be updated below.';
      const content=`${saved?`<div class="v5-reference"><span>Saved so far</span><strong>${esc(saved)}</strong></div>`:''}${choices?`<div class="v5-choice-stack">${choices}</div>`:'<div class="budget-empty">All categories already have a saved amount.</div>'}${savedChoices?`<div class="v5-step" style="margin:18px 0 8px">ALREADY LOGGED · EDIT OR ADD</div><div class="v5-choice-stack">${savedChoices}</div>`:''}${saved?'<div class="v5-actions"><button class="btn ghost" type="button" data-v5-partial-cancel>Cancel</button><button class="btn primary big" type="button" data-v5-partial-save>Save for later</button></div>':''}`;
      showOverlay('PARTIAL EXPENSES',24,'What do you want to log?',intro,content);
      $$('[data-v5-partial-key]').forEach(btn=>btn.addEventListener('click',()=>beginPartialAmount(f,btn.dataset.v5PartialKey,'new')));
      $$('[data-v5-partial-saved]').forEach(btn=>btn.addEventListener('click',()=>{f.key=btn.dataset.v5PartialSaved;f.stage='savedAction';renderPartialActual();}));
      $('[data-v5-partial-cancel]')?.addEventListener('click',closeOverlay);
      $('[data-v5-partial-save]')?.addEventListener('click',savePartialActual);
      return;
    }

    if(f.stage==='savedAction'){
      const key=f.key; const label=MONEY_LABELS[key];
      const content=`<div class="v5-reference"><span>Current saved total</span><strong>${money(f.draft[key])}</strong></div><div class="v5-choice-stack"><button class="trip-pick" type="button" data-v5-saved-action="add"><span class="pick-icon">＋</span><div><strong>Add another ${esc(label.toLowerCase())} expense</strong><small>The new amount will be added to the current total.</small></div></button><button class="trip-pick" type="button" data-v5-saved-action="replace"><span class="pick-icon">✎</span><div><strong>Edit the saved total</strong><small>Replace ${money(f.draft[key])} with a corrected total.</small></div></button></div><div class="v5-actions"><button class="btn ghost" type="button" data-v5-saved-back>Back</button></div>`;
      showOverlay('PARTIAL EXPENSES',38,`Update ${label}`,`Twogether only stores the running total for this category.`,content);
      $$('[data-v5-saved-action]').forEach(btn=>btn.addEventListener('click',()=>beginPartialAmount(f,key,btn.dataset.v5SavedAction)));
      $('[data-v5-saved-back]')?.addEventListener('click',()=>{f.stage='choose';renderPartialActual();});
      return;
    }

    if(f.stage==='more'){
      const content=`<div class="v5-reference"><span>Saved so far</span><strong>${esc(saved||'—')}</strong></div><div class="v5-choice-stack"><button class="trip-pick" type="button" data-v5-partial-more="yes"><span class="pick-icon">＋</span><div><strong>Yes, log something else</strong><small>Show the remaining categories and anything already saved that you can update.</small></div></button><button class="trip-pick" type="button" data-v5-partial-more="no"><span class="pick-icon">✓</span><div><strong>No, that’s all for now</strong><small>Save these totals and continue another day.</small></div></button></div>`;
      showOverlay('PARTIAL EXPENSES',72,'Anything else to log now?','You can keep building these totals little by little until you complete the full trip.',content);
      $('[data-v5-partial-more="yes"]')?.addEventListener('click',()=>{f.expanded=true;f.stage='choose';f.key='';renderPartialActual();});
      $('[data-v5-partial-more="no"]')?.addEventListener('click',savePartialActual);
      return;
    }

    if(f.stage==='name'){
      const base=f.mode==='add'&&partialHasValue(f,'other')?String(f.draft.otherNote||''):'';
      const content=`<div class="v5-reference"><span>${f.mode==='add'?'Amount being added':'Other expense amount'}</span><strong>${money(f.pendingAmount)}</strong></div><div class="field-wrap"><input id="v5PartialOtherName" class="big-input" value="${esc(f.entryName||'')}" placeholder="e.g. museum tickets"></div>${base?`<small style="display:block;margin-top:8px;color:var(--muted)">Existing note: ${esc(base)}</small>`:''}<div class="v5-actions"><button class="btn ghost" type="button" data-v5-partial-name-back>Back</button><button class="btn primary big" type="button" data-v5-partial-name-next>Next</button></div>`;
      showOverlay('PARTIAL EXPENSES',58,'What was the other expense?','Give this expense a short name so you remember it later.',content);
      const name=$('#v5PartialOtherName'); name?.addEventListener('input',()=>{f.entryName=name.value;}); setTimeout(()=>name?.focus(),0);
      $('[data-v5-partial-name-back]')?.addEventListener('click',()=>{f.stage='amount';renderPartialActual();});
      $('[data-v5-partial-name-next]')?.addEventListener('click',()=>{const clean=String(f.entryName||'').trim();if(!clean){toast('Add the name of the expense first','warn');return;}commitPartialEntry(f,clean);});
      return;
    }

    const key=f.key; const label=MONEY_LABELS[key];
    const current=partialHasValue(f,key)?n(f.draft[key]):0;
    const value=f.entryAmount||'';
    const pot=key==='accom'?`<div id="v5JointPot" style="margin-top:10px;font-weight:800">20% = <strong>${money((f.mode==='add'?current+n(value):n(value))*.20)}</strong></div>`:'';
    const modeHelp=f.mode==='add'?`Current total: ${money(current)}. Enter only the new ${label.toLowerCase()} expense and Twogether will add it.`:f.mode==='replace'?`Correct the saved total for ${label.toLowerCase()}.`:`Budgeted trip: ${plan.meta?.city||locationLabel(plan.meta)} · ${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)}`;
    const content=`${f.mode==='add'?`<div class="v5-reference"><span>Current saved total</span><strong>${money(current)}</strong></div>`:''}<div class="money-input-wrap"><span>€</span><input id="v5PartialAmount" class="big-input money-field" inputmode="decimal" value="${esc(String(value))}" placeholder="0.00"></div><div class="certainty-row"><button class="certainty ${!f.entryUncertain?'active':''}" type="button" data-v5-partial-cert="exact">Exact</button><button class="certainty ${f.entryUncertain?'active':''}" type="button" data-v5-partial-cert="estimate">Not sure · estimate</button></div>${pot}<div class="v5-actions"><button class="btn ghost" type="button" data-v5-partial-back>Back</button><button class="btn primary big" type="button" data-v5-partial-next>Next</button></div>`;
    showOverlay('PARTIAL EXPENSES',48,`${f.mode==='add'?'Add another':'How much was'} ${label.toLowerCase()}?`,modeHelp,content);
    const input=$('#v5PartialAmount');
    input?.addEventListener('input',()=>{f.entryAmount=input.value;if(key==='accom'){const strong=$('#v5JointPot strong');if(strong){const shown=(f.mode==='add'?current+n(input.value):n(input.value))*.20;strong.textContent=money(shown);}}});
    setTimeout(()=>input?.focus(),0);
    $$('[data-v5-partial-cert]').forEach(btn=>btn.addEventListener('click',()=>{f.entryUncertain=btn.dataset.v5PartialCert==='estimate';renderPartialActual();}));
    $('[data-v5-partial-back]')?.addEventListener('click',()=>{f.stage=f.mode==='new'?'choose':'savedAction';renderPartialActual();});
    $('[data-v5-partial-next]')?.addEventListener('click',()=>{
      const raw=String(f.entryAmount||'').trim();
      if(!raw||!Number.isFinite(Number(raw.replace(',','.')))){toast('Enter a valid amount first','warn');return;}
      if(key==='other'){
        f.pendingAmount=n(raw); f.pendingUncertain=!!f.entryUncertain; f.entryName=f.mode==='replace'?String(f.draft.otherNote||''):''; f.stage='name'; renderPartialActual(); return;
      }
      commitPartialEntry(f,'');
    });
  }

  async function savePartialActual(){
    const f=activeFlow; if(!f||f.type!=='partial')return;
    if(!hasPartial(f.draft)){toast('Add at least one expense first','warn');return;}
    const btn=$('[data-v5-partial-save],[data-v5-partial-more="no"]'); if(btn)btn.disabled=true;
    const partial={otherNote:f.draft.otherNote||'',uncertain:{...(f.draft.uncertain||{})}};
    MONEY_FIELDS.forEach(key=>{partial[key]=f.draft[key]??'';});
    try{
      await post('savePlanPartial',{planId:f.planId,partial});
      const plan=planById(f.planId); const a=actor();
      if(plan&&a){
        plan.partials={...(plan.partials||{})};
        plan.partials[a]=JSON.parse(JSON.stringify(partial));
        renderBudgetPlans();
      }
      closeOverlay(); toast('Saved. You can keep adding expenses later.');
      setTimeout(refreshState,1600);
    }catch(err){toast(err.message||'Could not save partial expenses','warn');if(btn)btn.disabled=false;}
  }

  function startPlanActual(planId){
    const plan=planById(planId); const a=actor(); if(!plan||!a)return;
    const trip=tripForPlan(plan); const existing=trip?.submissions?.[a]||{}; const partial=plan?.partials?.[a]||{};
    activeFlow={
      type:'actual', planId, index:0, otherFlow:null,
      draft:{accom:'',groceries:'',eat:'',travel:'',fuel:'',tolls:'',other:'',otherNote:'',paid:'',uncertain:{},...partial,...existing,uncertain:{...(partial.uncertain||{}),...(existing.uncertain||{})}}
    };
    closeBudgetModal();
    document.querySelector('.tab[data-sheet="log"]')?.click();
    renderActualFlow();
    $('#wizardCard')?.scrollIntoView({behavior:'smooth',block:'center'});
  }

  function actualSteps(){
    const base=[
      ['accom','How much was accommodation?'],['groceries','How much on groceries?'],['eat','How much on eating out?'],['travel','How much on flights or trains?'],['fuel','How much on fuel?'],['tolls','How much on tolls or parking?']
    ].map(([key,title])=>({key,title,type:'money'}));
    base.push({key:'otherFlow',title:'Other expenses',type:'otherExpenses'});
    base.push({key:'paid',title:`How much did ${actor()} actually pay?`,type:'money',noUncertain:true});
    base.push({key:'review',title:'Ready to save your actual expenses?',type:'review'});
    return base;
  }

  function ensureActualOtherFlow(){
    if(!activeFlow.otherFlow){
      const existing=n(activeFlow.draft.other);
      activeFlow.otherFlow={stage:'amount',items:[],amount:existing>0?String(activeFlow.draft.other??existing):'',name:existing>0?String(activeFlow.draft.otherNote||''):'',uncertain:!!activeFlow.draft?.uncertain?.other};
    }
    return activeFlow.otherFlow;
  }

  function syncActualOtherDraft(){
    const f=ensureActualOtherFlow();
    activeFlow.draft.other=String(f.items.reduce((sum,item)=>sum+n(item.amount),0));
    activeFlow.draft.otherNote=f.items.map(item=>`${item.name} · ${money(item.amount)}`).join(' + ');
    activeFlow.draft.uncertain={...(activeFlow.draft.uncertain||{})};
    activeFlow.draft.uncertain.other=f.items.some(item=>!!item.uncertain);
  }

  function actualOtherList(){
    const f=ensureActualOtherFlow();
    return f.items.length?`<div class="v5-review">${f.items.map(item=>`<div class="v5-review-row"><span>${esc(item.name)}</span><strong>${item.uncertain?'~ ':''}${money(item.amount)}</strong></div>`).join('')}</div>`:'';
  }

  function renderActualOtherExpenses(plan,steps,qCount,qNum){
    const f=ensureActualOtherFlow();
    const list=actualOtherList();
    const title=f.stage==='name'?'What was this expense?':f.stage==='more'?'Any more other expenses?':f.items.length?'How much was the next other expense?':'Any other expenses?';
    let control='';
    if(f.stage==='name'){
      control=`${list}<div class="v5-reference"><span>Amount</span><strong>${f.uncertain?'~ ':''}${money(f.amount)}</strong></div><div class="field-wrap"><input id="v5OtherName" class="big-input" value="${esc(f.name||'')}" placeholder="e.g. museum tickets"></div><div class="v5-actions"><button class="btn ghost" type="button" data-v5-other-back>Back</button><button class="btn primary big" type="button" data-v5-other-next>Next</button></div>`;
    }else if(f.stage==='more'){
      control=`${list}<div class="v5-choice-stack"><button class="trip-pick" type="button" data-v5-other-more="yes"><span class="pick-icon">＋</span><div><strong>Yes, add another</strong><small>Add another amount and its name.</small></div></button><button class="trip-pick" type="button" data-v5-other-more="no"><span class="pick-icon">✓</span><div><strong>No, continue</strong><small>Continue to what you actually paid.</small></div></button></div>`;
    }else{
      control=`${list}<div class="${f.uncertain?'uncertain-mode':''}"><div class="money-input-wrap"><span>€</span><input id="v5OtherAmount" class="big-input money-field" inputmode="decimal" value="${esc(f.amount||'')}" placeholder="0.00"></div><div class="certainty-row"><button class="certainty ${!f.uncertain?'active':''}" type="button" data-v5-other-cert="exact">Exact</button><button class="certainty ${f.uncertain?'active':''}" type="button" data-v5-other-cert="estimate">Not sure · estimate</button></div>${f.items.length?'':'<button class="btn ghost full" type="button" data-v5-other-none>No other expenses</button>'}</div><div class="v5-actions"><button class="btn ghost" type="button" data-v5-other-back>Back</button><button class="btn primary big" type="button" data-v5-other-next>Next</button></div>`;
    }
    showOverlay(`QUESTION ${Math.max(1,qNum)} OF ${qCount}`,((activeFlow.index+1)/steps.length)*100,title,`Budgeted trip: ${plan.meta?.city||locationLabel(plan.meta)} · ${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)}`,control);
    const amount=$('#v5OtherAmount'),name=$('#v5OtherName');
    amount?.addEventListener('input',()=>{f.amount=amount.value;});name?.addEventListener('input',()=>{f.name=name.value;});setTimeout(()=>{(amount||name)?.focus();},0);
    $$('[data-v5-other-cert]').forEach(btn=>btn.addEventListener('click',()=>{f.uncertain=btn.dataset.v5OtherCert==='estimate';renderActualFlow();}));
    $('[data-v5-other-none]')?.addEventListener('click',()=>{f.items=[];activeFlow.draft.other='0';activeFlow.draft.otherNote='';activeFlow.draft.uncertain.other=false;activeFlow.index++;renderActualFlow();});
    $('[data-v5-other-more="yes"]')?.addEventListener('click',()=>{f.stage='amount';f.amount='';f.name='';f.uncertain=false;renderActualFlow();});
    $('[data-v5-other-more="no"]')?.addEventListener('click',()=>{syncActualOtherDraft();activeFlow.index++;renderActualFlow();});
    $('[data-v5-other-back]')?.addEventListener('click',()=>{
      if(f.stage==='name'){f.stage='amount';renderActualFlow();return;}
      if(f.stage==='more'){f.stage='name';const last=f.items.pop();if(last){f.amount=String(last.amount);f.name=last.name;f.uncertain=!!last.uncertain;syncActualOtherDraft();}renderActualFlow();return;}
      if(f.items.length){f.stage='more';renderActualFlow();return;}
      if(activeFlow.index===0)closeOverlay();else{activeFlow.index--;renderActualFlow();}
    });
    $('[data-v5-other-next]')?.addEventListener('click',()=>{
      if(f.stage==='amount'){
        const value=String(f.amount||'').trim();if(!value||!Number.isFinite(Number(value.replace(',','.')))){toast('Enter a valid amount first','warn');return;}f.stage='name';renderActualFlow();return;
      }
      if(f.stage==='name'){
        const expenseName=String(f.name||'').trim();if(!expenseName){toast('Add the name of the expense first','warn');return;}f.items.push({amount:String(f.amount),name:expenseName,uncertain:!!f.uncertain});syncActualOtherDraft();f.amount='';f.name='';f.uncertain=false;f.stage='more';renderActualFlow();
      }
    });
  }

  function renderActualFlow(){
    if(activeFlow?.type!=='actual')return;
    const plan=planById(activeFlow.planId); if(!plan)return closeOverlay();
    const steps=actualSteps(); if(activeFlow.index>=steps.length)activeFlow.index=steps.length-1;
    const step=steps[activeFlow.index]; const isReview=step.type==='review';
    const qCount=steps.filter(s=>s.type!=='review').length;
    const qNum=steps.slice(0,activeFlow.index+1).filter(s=>s.type!=='review').length;
    if(isReview){
      const total=MONEY_FIELDS.reduce((sum,k)=>sum+n(activeFlow.draft[k]),0);
      const content=`<div class="v5-reference"><span>${esc(plan.meta?.city||locationLabel(plan.meta))} · your planned budget</span><strong>${money(plan?.budgets?.[actor()])}</strong><small>${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)}</small></div><div class="v5-review">${MONEY_FIELDS.map(k=>`<div class="v5-review-row"><span>${esc(MONEY_LABELS[k])}</span><strong>${activeFlow.draft?.uncertain?.[k]?'~ ':''}${money(activeFlow.draft[k])}</strong></div>`).join('')}<div class="v5-review-row"><span>Total expenses</span><strong>${money(total)}</strong></div><div class="v5-review-row"><span>${esc(actor())} actually paid</span><strong>${money(activeFlow.draft.paid)}</strong></div></div><div class="v5-actions"><button class="btn ghost" type="button" data-v5-back>Back</button><button class="btn primary big" type="button" data-v5-save-actual>Save actual expenses</button></div>`;
      showOverlay('REVIEW',100,step.title,'The trip details come from your budget plan.',content);
      $('[data-v5-back]')?.addEventListener('click',()=>{activeFlow.index--;renderActualFlow();});
      $('[data-v5-save-actual]')?.addEventListener('click',savePlanActual);
      return;
    }
    if(step.type==='otherExpenses'){renderActualOtherExpenses(plan,steps,qCount,qNum);return;}
    const uncertain=!!activeFlow.draft?.uncertain?.[step.key];
    let control='';
    if(step.type==='text'){
      control=`<div class="field-wrap"><input id="v5FlowInput" class="big-input" type="text" value="${esc(activeFlow.draft[step.key]||'')}"></div>`;
    }else{
      const pot=step.key==='accom'?`<div id="v5FullJointPot" style="margin-top:10px;font-weight:800">20% = <strong>${money(n(activeFlow.draft.accom)*.20)}</strong></div>`:'';
      control=`<div class="${uncertain?'uncertain-mode':''}"><div class="money-input-wrap"><span>€</span><input id="v5FlowInput" class="big-input money-field" inputmode="decimal" value="${esc(String(activeFlow.draft[step.key]??''))}" placeholder="0.00"></div>${!step.noUncertain?`<div class="certainty-row"><button class="certainty ${!uncertain?'active':''}" type="button" data-v5-cert="exact">Exact</button><button class="certainty ${uncertain?'active':''}" type="button" data-v5-cert="estimate">Not sure · estimate</button></div>`:''}${pot}${step.key==='other'?'<button class="btn ghost full" type="button" data-v5-none>No other expenses</button>':''}</div>`;
    }
    control+=`<div class="v5-actions"><button class="btn ghost" type="button" data-v5-back>${activeFlow.index===0?'Cancel':'Back'}</button><button class="btn primary big" type="button" data-v5-next>Next</button></div>`;
    showOverlay(`QUESTION ${Math.max(1,qNum)} OF ${qCount}`,((activeFlow.index+1)/steps.length)*100,step.title,`Budgeted trip: ${plan.meta?.city||locationLabel(plan.meta)} · ${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)}`,control);
    const input=$('#v5FlowInput'); input?.addEventListener('input',()=>{activeFlow.draft[step.key]=input.value;if(step.key==='accom'){const strong=$('#v5FullJointPot strong');if(strong)strong.textContent=money(n(input.value)*.20);}}); setTimeout(()=>input?.focus(),0);
    $$('[data-v5-cert]').forEach(btn=>btn.addEventListener('click',()=>{activeFlow.draft.uncertain={...(activeFlow.draft.uncertain||{})};activeFlow.draft.uncertain[step.key]=btn.dataset.v5Cert==='estimate';renderActualFlow();}));
    $('[data-v5-none]')?.addEventListener('click',()=>{activeFlow.draft.other='0';activeFlow.draft.uncertain.other=false;activeFlow.index++;renderActualFlow();});
    $('[data-v5-back]')?.addEventListener('click',()=>{if(activeFlow.index===0)closeOverlay();else{activeFlow.index--;renderActualFlow();}});
    $('[data-v5-next]')?.addEventListener('click',()=>{
      const value=String(activeFlow.draft[step.key]??'').trim();
      if(step.type==='money'&&(!value||!Number.isFinite(Number(value.replace(',','.'))))){toast('Enter a valid amount first','warn');return;}
      activeFlow.index++;renderActualFlow();
    });
  }

  async function savePlanActual(){
    const flow=activeFlow; if(!flow||flow.type!=='actual')return;
    const btn=$('[data-v5-save-actual]'); if(btn)btn.disabled=true;
    try{
      await post('savePlanSubmission',{planId:flow.planId,submission:{...flow.draft,uncertain:{...(flow.draft.uncertain||{})}}});
      closeOverlay(); toast('Your actual expenses were saved');
      setTimeout(refreshState,750);
    }catch(err){toast(err.message||'Could not save expenses','warn');if(btn)btn.disabled=false;}
  }

  function mismatchSteps(trip,name){
    const own=trip?.submissions?.[name], other=trip?.submissions?.[otherActor(name)]; if(!own||!other)return[];
    const steps=[];
    MONEY_FIELDS.forEach(key=>{
      const amountDiff=Math.abs(n(own[key])-n(other[key]))>.01;
      const certaintyDiff=!!own?.uncertain?.[key]!==!!other?.uncertain?.[key];
      if(amountDiff || certaintyDiff)steps.push({key,label:MONEY_LABELS[key],type:'money'});
    });
    if(String(own.otherNote||'').trim().toLowerCase()!==String(other.otherNote||'').trim().toLowerCase())steps.push({key:'otherNote',label:'Other expense note',type:'text'});
    return steps;
  }

  async function startMatch(tripId){
    const a=actor(); if(!a)return toast('Choose your profile first','warn');
    let trip=tripById(tripId);
    if(!trip){
      showOverlay('MATCHING',12,'Opening your differences…','Loading the latest shared version.','');
      try{await refreshState();trip=tripById(tripId);}catch{}
    }
    if(!trip){closeOverlay();return toast('Trip not found','warn');}
    const own=trip?.submissions?.[a], otherName=otherActor(a), other=trip?.submissions?.[otherName];
    if(!own||!other)return toast('Both versions need to be logged first','warn');
    const steps=mismatchSteps(trip,a); if(!steps.length)return toast('Your calculations already match');
    activeFlow={type:'match',tripId,name:a,otherName,other:JSON.parse(JSON.stringify(other)),original:JSON.parse(JSON.stringify(own)),draft:JSON.parse(JSON.stringify(own)),steps,index:0};
    document.querySelector('.tab[data-sheet="log"]')?.click();
    renderMatchFlow();
    $('#wizardCard')?.scrollIntoView({behavior:'smooth',block:'center'});
  }

  function matchDisplay(step,submission){
    if(step.type==='money')return `${money(submission?.[step.key])}${submission?.uncertain?.[step.key]?' · estimate':' · exact'}`;
    if(step.type==='certainty')return submission?.uncertain?.[step.key]?'Estimate':'Exact';
    return String(submission?.[step.key]||'—');
  }

  function renderMatchFlow(){
    const f=activeFlow; if(!f||f.type!=='match')return;
    const total=f.steps.length;
    if(f.index>=total){
      const content=`<div class="v5-review">${f.steps.map(step=>`<div class="v5-review-row"><span>${esc(step.label)}</span><strong>${esc(matchDisplay(step,f.draft))}</strong></div>`).join('')}</div><div class="v5-actions"><button class="btn ghost" type="button" data-v5-match-back>Back</button><button class="btn primary big" type="button" data-v5-match-save>Save corrections</button></div>`;
      showOverlay('REVIEW',100,'Ready to update your version?','Only the answers that differed are being changed. Everything else stays untouched.',content);
      $('[data-v5-match-back]')?.addEventListener('click',()=>{f.index--;renderMatchFlow();});
      $('[data-v5-match-save]')?.addEventListener('click',saveMatch);
      return;
    }
    const step=f.steps[f.index]; const uncertain=!!f.draft?.uncertain?.[step.key];
    let control='';
    if(step.type==='money')control=`<div class="v5-reference"><span>${esc(f.otherName)} entered</span><strong>${esc(matchDisplay(step,f.other))}</strong><small>Your current answer: ${esc(matchDisplay(step,f.original))}</small></div><div class="money-input-wrap"><span>€</span><input id="v5MatchInput" class="big-input money-field" inputmode="decimal" value="${esc(String(f.draft?.[step.key]??''))}" placeholder="${esc(String(f.other?.[step.key]??'0.00'))}"></div><div class="certainty-row"><button class="certainty ${!uncertain?'active':''}" type="button" data-v5-match-cert="exact">Exact</button><button class="certainty ${uncertain?'active':''}" type="button" data-v5-match-cert="estimate">Estimate</button></div><button class="v5-use" type="button" data-v5-use-other>Use ${esc(f.otherName)}’s answer</button>`;
    else if(step.type==='certainty')control=`<div class="v5-reference"><span>${esc(f.otherName)} entered</span><strong>${esc(matchDisplay(step,f.other))}</strong><small>Your current answer: ${esc(matchDisplay(step,f.original))}</small></div><div class="certainty-row"><button class="certainty ${!uncertain?'active':''}" type="button" data-v5-match-cert="exact">Exact</button><button class="certainty ${uncertain?'active':''}" type="button" data-v5-match-cert="estimate">Estimate</button></div><button class="v5-use" type="button" data-v5-use-other>Use ${esc(f.otherName)}’s answer</button>`;
    else control=`<div class="v5-reference"><span>${esc(f.otherName)} entered</span><strong>${esc(matchDisplay(step,f.other))}</strong><small>Your current answer: ${esc(matchDisplay(step,f.original))}</small></div><div class="field-wrap"><input id="v5MatchInput" class="big-input" value="${esc(String(f.draft?.[step.key]||''))}" placeholder="${esc(String(f.other?.[step.key]||''))}"></div><button class="v5-use" type="button" data-v5-use-other>Use ${esc(f.otherName)}’s answer</button>`;
    control+=`<div class="v5-actions"><button class="btn ghost" type="button" data-v5-match-back>${f.index===0?'Cancel':'Back'}</button><button class="btn primary big" type="button" data-v5-match-next>Next</button></div>`;
    showOverlay(`MATCHING ${f.index+1} OF ${total}`,((f.index+1)/total)*100,step.label,`${f.otherName}’s answer is your reference. Only this field needs attention.`,control);
    const input=$('#v5MatchInput'); input?.addEventListener('input',()=>{f.draft[step.key]=input.value;}); setTimeout(()=>input?.focus(),0);
    $$('[data-v5-match-cert]').forEach(btn=>btn.addEventListener('click',()=>{f.draft.uncertain={...(f.draft.uncertain||{})};f.draft.uncertain[step.key]=btn.dataset.v5MatchCert==='estimate';renderMatchFlow();}));
    $('[data-v5-use-other]')?.addEventListener('click',()=>{
      if(step.type==='money'){f.draft[step.key]=String(f.other?.[step.key]??'');f.draft.uncertain={...(f.draft.uncertain||{})};f.draft.uncertain[step.key]=!!f.other?.uncertain?.[step.key];}
      else if(step.type==='certainty'){f.draft.uncertain={...(f.draft.uncertain||{})};f.draft.uncertain[step.key]=!!f.other?.uncertain?.[step.key];}
      else f.draft[step.key]=String(f.other?.[step.key]||'');
      renderMatchFlow();
    });
    $('[data-v5-match-back]')?.addEventListener('click',()=>{if(f.index===0)closeOverlay();else{f.index--;renderMatchFlow();}});
    $('[data-v5-match-next]')?.addEventListener('click',()=>{
      if(step.type==='money'){
        const value=String(f.draft?.[step.key]??'').trim();
        if(!value||!Number.isFinite(Number(value.replace(',','.')))){toast('Enter a valid amount first','warn');return;}
      }
      f.index++;renderMatchFlow();
    });
  }

  async function saveMatch(){
    const f=activeFlow; if(!f||f.type!=='match')return;
    const btn=$('[data-v5-match-save]'); if(btn)btn.disabled=true;
    try{
      await post('saveSubmission',{tripId:f.tripId,submission:{...f.draft,uncertain:{...(f.draft.uncertain||{})}}},f.name);
      closeOverlay(); toast('Your corrections were saved');
      setTimeout(refreshState,750);
    }catch(err){toast(err.message||'Could not save corrections','warn');if(btn)btn.disabled=false;}
  }

  function decorateCoreWizard(){
    const body=$('#wizardBody'); if(!body)return;
    $$('[data-edit-pick]',body).forEach(btn=>{
      const strong=$('strong',btn),small=$('small',btn);
      if(strong)strong.textContent=strong.textContent.replace(/^Fix your version/,'Match the differences');
      if(small)small.textContent='Only the answers that differ will be asked.';
    });
    const heading=$('h2',body);
    if(heading?.textContent.trim()==='What is your ideal total budget for this trip?'){
      setTimeout(()=>body.querySelector('[data-skip-budget]')?.click(),0);
    }
  }

  document.addEventListener('click',event=>{
    const actualBtn=event.target.closest?.('[data-v5-actual]');
    if(actualBtn){
      const card=actualBtn.closest('[data-v5-plan]');
      const id=card?.dataset?.v5Plan||'';
      if(id){
        event.preventDefault(); event.stopImmediatePropagation();
        startActualChoice(id); return;
      }
    }

    const tripCard=event.target.closest?.('[data-open-trip]');
    if(tripCard){
      lastTripId=tripCard.dataset.openTrip||'';
      refreshState().catch(()=>{});
      setTimeout(()=>{
        const edit=$('#tripModalBody [data-edit-own]');
        if(edit&&$('#tripModalBody .difference-list'))edit.textContent='Match the differences';
      },0);
    }

    const newBtn=event.target.closest?.('[data-trip-pick="new"]');
    if(newBtn&&!bypassNewTrip){
      const plans=eligibleBudgetPlans();
      if(plans.length){
        event.preventDefault();event.stopImmediatePropagation();showNewTripChoice(newBtn);return;
      }
    }

    const editPick=event.target.closest?.('[data-edit-pick]');
    if(editPick){
      event.preventDefault();event.stopImmediatePropagation();startMatch(editPick.dataset.editPick);return;
    }

    const modalEdit=event.target.closest?.('#tripModalBody [data-edit-own]');
    if(modalEdit&&lastTripId&&$('#tripModalBody .difference-list')){
      event.preventDefault();event.stopImmediatePropagation();
      $('#tripModal')?.classList.remove('show');
      startMatch(lastTripId);return;
    }
  },true);

  function init(){
    installUi();
    const wizardBody=$('#wizardBody');
    if(wizardBody){
      new MutationObserver(()=>decorateCoreWizard()).observe(wizardBody,{childList:true});
      decorateCoreWizard();
    }
    refreshState().catch(()=>{});
    window.addEventListener('focus',()=>refreshState().catch(()=>{}),{passive:true});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshState().catch(()=>{});});
  }

  document.addEventListener('DOMContentLoaded',init);
})();
