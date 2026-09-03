(() => {
  'use strict';

  const CONFIG=window.TOGETHER_BUDGET_CONFIG||{};
  const API_URL=String(CONFIG.appsScriptUrl||'').trim();
  const ACTOR_KEY='twogether_actor_v1';
  const ACTORS=['Principessa','Principe'];
  const FIELDS=[
    ['accom','Accommodation'],['groceries','Groceries'],['eat','Eating out'],
    ['travel','Flights / Train'],['fuel','Fuel'],['tolls','Tolls / Parking'],['other','Other']
  ];

  let state={version:1,plans:[],trips:[]};
  let busy=false;
  let modalMode='';
  let activePlanId='';

  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const n=v=>{const x=Number(String(v??'').replace(',','.'));return Number.isFinite(x)?x:0;};
  const money=v=>'€'+n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtDate=v=>{if(!v)return '—';const [y,m,d]=String(v).split('-');return y&&m&&d?`${d}/${m}/${y}`:String(v);};

  function actor(){
    const a=document.body.dataset.actor||'';
    if(ACTORS.includes(a)) return a;
    try{const saved=localStorage.getItem(ACTOR_KEY)||'';return ACTORS.includes(saved)?saved:'';}catch{}
    return '';
  }
  function otherActor(a){return a==='Principessa'?'Principe':'Principessa';}
  function toast(msg,tone='ok'){
    const el=document.getElementById('toast');if(!el)return;
    el.textContent=msg;el.className='toast show '+tone;clearTimeout(el._budgetT);el._budgetT=setTimeout(()=>el.className='toast',2600);
  }
  function locationLabel(meta){return meta?.location==='Other'?(meta.otherLocation||'Other'):(meta?.location||'—');}

  function jsonp(params={}){
    return new Promise((resolve,reject)=>{
      if(!API_URL)return reject(new Error('Backend URL missing'));
      const cb='__twogether_budget_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      const s=document.createElement('script');const timer=setTimeout(()=>done(new Error('Sync timed out')),12000);
      function done(err,data){clearTimeout(timer);try{delete window[cb];}catch{}s.remove();err?reject(err):resolve(data);}
      window[cb]=data=>done(null,data);
      const q=new URLSearchParams({...params,callback:cb,_:String(Date.now())});
      s.src=API_URL+(API_URL.includes('?')?'&':'?')+q.toString();s.onerror=()=>done(new Error('Could not reach Apps Script'));document.head.appendChild(s);
    });
  }

  function post(action,payload){
    return new Promise((resolve,reject)=>{
      const a=actor();if(!a)return reject(new Error('Choose your profile first'));
      const frame=document.querySelector('iframe[name="backendFrame"]');if(!frame)return reject(new Error('Backend frame missing'));
      const form=document.createElement('form');form.method='POST';form.action=API_URL;form.target='backendFrame';form.style.display='none';
      const fields={action,actor:a,payload:JSON.stringify(payload||{})};
      Object.entries(fields).forEach(([k,v])=>{const input=document.createElement('input');input.type='hidden';input.name=k;input.value=v;form.appendChild(input);});
      document.body.appendChild(form);form.submit();form.remove();setTimeout(resolve,1000);
    });
  }

  function installStyles(){
    if(document.getElementById('budgetPlannerStyles'))return;
    const style=document.createElement('style');style.id='budgetPlannerStyles';style.textContent=`
      .budget-planner-section{margin:34px 0 30px}.budget-planner-head{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:15px}.budget-planner-head h2{margin:3px 0 0;font-size:30px}.budget-planner-head p{margin:5px 0 0;color:var(--muted);max-width:720px}
      .budget-plan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}.budget-plan-card{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:18px;box-shadow:0 10px 28px rgba(60,45,35,.055)}
      .budget-plan-top{display:flex;justify-content:space-between;gap:10px;align-items:start}.budget-plan-top h3{margin:2px 0 4px;font-size:23px}.budget-plan-top p{margin:0;color:var(--muted)}.budget-plan-status{font-size:11px;padding:6px 9px;border-radius:999px;background:#f1eee9;white-space:nowrap}.budget-plan-status.live{background:#edf2e9}.budget-plan-status.done{background:#e8f1e9}
      .budget-person-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:15px 0}.budget-person{background:#f7f3ee;border-radius:15px;padding:11px}.budget-person span{display:block;font-size:12px;color:var(--muted)}.budget-person strong{display:block;margin-top:3px;font-size:19px}.budget-person small{display:block;margin-top:4px;color:var(--muted);line-height:1.25}.budget-person.over small,.budget-total-check.over strong{color:#9d4b3e}.budget-person.under small,.budget-total-check.under strong{color:#4e7352}
      .budget-total-check{border-top:1px solid var(--line);padding-top:12px;display:flex;justify-content:space-between;gap:12px}.budget-total-check span{color:var(--muted)}.budget-plan-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
      .budget-empty{background:var(--card);border:1px dashed var(--line);border-radius:20px;padding:18px;color:var(--muted)}
      .budget-modal{display:none;position:fixed;inset:0;z-index:185;place-items:center;padding:20px}.budget-modal.show{display:grid}.budget-modal-backdrop{position:absolute;inset:0;background:rgba(40,34,30,.5);backdrop-filter:blur(7px)}.budget-modal-card{position:relative;width:min(690px,100%);max-height:calc(100vh - 40px);overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:28px;padding:24px;box-shadow:0 24px 80px rgba(60,45,35,.18)}.budget-close{position:absolute;right:16px;top:12px;border:0;background:none;font-size:28px;cursor:pointer;color:var(--muted)}
      .budget-modal-card h2{margin:7px 36px 5px 0;font-size:32px}.budget-modal-card>p{color:var(--muted);margin:0 0 18px}.budget-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.budget-field{display:grid;gap:5px}.budget-field.full{grid-column:1/-1}.budget-field label{font-size:12px;color:var(--muted)}.budget-field input,.budget-field select,.budget-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--line);background:#fff;border-radius:14px;padding:12px 13px;font:inherit;font-size:16px;outline:none}.budget-field textarea{min-height:80px;resize:vertical}.budget-modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:18px}.budget-backend-note{background:#fff4df;border:1px solid #efd8aa;border-radius:16px;padding:12px 14px;margin-bottom:14px;color:#765a2f}
      .trip-modal .budget-check{display:none!important}
      @media(max-width:640px){.budget-planner-head{align-items:start;flex-direction:column}.budget-form-grid,.budget-person-grid{grid-template-columns:1fr}.budget-field.full{grid-column:auto}}
    `;document.head.appendChild(style);
  }

  function installUi(){
    installStyles();
    if(!document.getElementById('budgetPlannerSection')){
      const target=document.querySelector('.trip-gallery-section');
      if(target){
        const section=document.createElement('section');section.id='budgetPlannerSection';section.className='budget-planner-section';
        section.innerHTML=`<div class="budget-planner-head"><div><span class="panel-kicker">BEFORE THE TRIP</span><h2>Trip budgets</h2><p>Each of you sets your own budget first. After the trip, log the actual expenses and Twogether compares each budget individually and together.</p></div><button class="btn primary" type="button" data-new-budget-plan>Plan a trip budget</button></div><div id="budgetPlanGrid" class="budget-plan-grid"></div>`;
        target.parentNode.insertBefore(section,target);
        section.querySelector('[data-new-budget-plan]')?.addEventListener('click',()=>openNewPlan());
      }
    }
    if(!document.getElementById('budgetPlannerModal')){
      const modal=document.createElement('div');modal.id='budgetPlannerModal';modal.className='budget-modal';modal.setAttribute('aria-hidden','true');modal.innerHTML='<div class="budget-modal-backdrop" data-budget-close></div><div class="budget-modal-card"><button class="budget-close" type="button" data-budget-close>×</button><div id="budgetPlannerModalBody"></div></div>';
      document.body.appendChild(modal);modal.querySelectorAll('[data-budget-close]').forEach(el=>el.addEventListener('click',closeModal));
    }
  }

  function closeModal(){modalMode='';activePlanId='';const m=document.getElementById('budgetPlannerModal');m?.classList.remove('show');m?.setAttribute('aria-hidden','true');}
  function showModal(html){installUi();const m=document.getElementById('budgetPlannerModal');const body=document.getElementById('budgetPlannerModalBody');if(body)body.innerHTML=html;m?.classList.add('show');m?.setAttribute('aria-hidden','false');}

  function planById(id){return (state.plans||[]).find(x=>x.id===id);}
  function tripForPlan(plan){return plan?.linkedTripId?(state.trips||[]).find(t=>t.id===plan.linkedTripId):null;}
  function variance(budget,actual){
    if(budget===''||budget==null)return {text:'Budget not set',cls:''};
    if(actual===''||actual==null)return {text:'Actual spend not logged yet',cls:''};
    const d=n(budget)-n(actual);if(Math.abs(d)<.01)return {text:'Exactly on budget',cls:'under'};
    if(d>0)return {text:`${money(d)} under budget`,cls:'under'};
    return {text:`${money(Math.abs(d))} over budget`,cls:'over'};
  }

  function renderPlans(){
    installUi();const root=document.getElementById('budgetPlanGrid');if(!root)return;
    if(state.version<4){root.innerHTML='<div class="budget-backend-note">Redeploy the newest Apps Script backend to activate individual trip budgets.</div>';return;}
    const plans=[...(state.plans||[])].sort((a,b)=>String(b?.meta?.start||b.updatedAt||'').localeCompare(String(a?.meta?.start||a.updatedAt||'')));
    if(!plans.length){root.innerHTML='<div class="budget-empty">No planned trip budgets yet. Create one before your next trip, then each of you can add your own spending limit.</div>';return;}
    const a=actor();
    root.innerHTML=plans.map(plan=>{
      const meta=plan.meta||{};const trip=tripForPlan(plan);const locked=!!(trip?.confirmed?.Principessa&&trip?.confirmed?.Principe);
      const pBudget=plan?.budgets?.Principessa??'';const qBudget=plan?.budgets?.Principe??'';
      const pActual=trip?.submissions?.Principessa?.paid??'';const qActual=trip?.submissions?.Principe?.paid??'';
      const pv=variance(pBudget,pActual),qv=variance(qBudget,qActual);
      const bothBudgets=pBudget!==''&&qBudget!=='';const bothActual=pActual!==''&&qActual!=='';
      const totalVar=bothBudgets&&bothActual?variance(n(pBudget)+n(qBudget),n(pActual)+n(qActual)):{text:bothBudgets?'Waiting for both actual spends':'Waiting for both budgets',cls:''};
      const status=locked?'Budget checked':trip?'Trip expenses in progress':'Waiting for the trip';
      const ownBudget=plan?.budgets?.[a];const ownActual=trip?.submissions?.[a];
      return `<article class="budget-plan-card" data-plan-card="${esc(plan.id)}"><div class="budget-plan-top"><div><span class="trip-country">${esc(locationLabel(meta))}</span><h3>${esc(meta.city||locationLabel(meta))}</h3><p>${fmtDate(meta.start)}–${fmtDate(meta.end)}</p></div><span class="budget-plan-status ${locked?'done':trip?'live':''}">${esc(status)}</span></div><div class="budget-person-grid"><div class="budget-person ${pv.cls}"><span>Principessa</span><strong>${pBudget===''?'No budget':money(pBudget)}</strong><small>${esc(pv.text)}${pActual!==''?` · actual ${money(pActual)}`:''}</small></div><div class="budget-person ${qv.cls}"><span>Principe</span><strong>${qBudget===''?'No budget':money(qBudget)}</strong><small>${esc(qv.text)}${qActual!==''?` · actual ${money(qActual)}`:''}</small></div></div><div class="budget-total-check ${totalVar.cls}"><span>Combined</span><strong>${esc(totalVar.text)}</strong></div><div class="budget-plan-actions">${a&&ownBudget===''?'<button class="btn" type="button" data-add-own-budget>Add my budget</button>':''}${a&&ownBudget!==''&&!ownActual?'<button class="btn ghost" type="button" data-edit-own-budget>Edit my budget</button>':''}${a&&!ownActual?'<button class="btn primary" type="button" data-log-plan-actual>Log my actual expenses</button>':''}${trip?'<button class="btn ghost" type="button" data-open-linked-trip>Open trip</button>':''}</div></article>`;
    }).join('');

    root.querySelectorAll('[data-plan-card]').forEach(card=>{
      const id=card.dataset.planCard;
      card.querySelector('[data-add-own-budget]')?.addEventListener('click',()=>openBudgetOnly(id));
      card.querySelector('[data-edit-own-budget]')?.addEventListener('click',()=>openBudgetOnly(id));
      card.querySelector('[data-log-plan-actual]')?.addEventListener('click',()=>openActuals(id));
      card.querySelector('[data-open-linked-trip]')?.addEventListener('click',()=>{
        const plan=planById(id);const tripId=plan?.linkedTripId;const tripCard=tripId?document.querySelector(`[data-open-trip="${CSS.escape(tripId)}"]`):null;tripCard?.click();
      });
    });
    decorateTripCards();
  }

  function openNewPlan(){
    if(state.version<4)return toast('Redeploy the newest Apps Script backend first','warn');
    modalMode='new';activePlanId='';const a=actor();if(!a)return toast('Choose your profile first','warn');
    showModal(`<span class="panel-kicker">PLAN BEFORE THE TRIP</span><h2>Create a trip budget</h2><p>Add the trip details and only <strong>your own</strong> budget. ${esc(otherActor(a))} can add theirs separately.</p><div class="budget-form-grid"><div class="budget-field"><label>Country</label><select id="bpLocation"><option>Italy</option><option>Netherlands</option><option>Portugal</option><option>Other</option></select></div><div class="budget-field"><label>If Other</label><input id="bpOther" placeholder="e.g. Tunisia"></div><div class="budget-field full"><label>City / area</label><input id="bpCity" placeholder="e.g. Lonato del Garda"></div><div class="budget-field"><label>Start date</label><input id="bpStart" type="date"></div><div class="budget-field"><label>End date</label><input id="bpEnd" type="date"></div><div class="budget-field full"><label>${esc(a)} individual budget</label><input id="bpBudget" inputmode="decimal" placeholder="€ 0.00"></div></div><div class="budget-modal-actions"><button class="btn ghost" type="button" data-budget-cancel>Cancel</button><button class="btn primary" type="button" data-budget-save-plan>Save my budget</button></div>`);
    document.querySelector('[data-budget-cancel]')?.addEventListener('click',closeModal);document.querySelector('[data-budget-save-plan]')?.addEventListener('click',saveNewPlan);
  }

  async function saveNewPlan(){
    const location=document.getElementById('bpLocation')?.value||'';const otherLocation=document.getElementById('bpOther')?.value||'';const city=document.getElementById('bpCity')?.value||'';const start=document.getElementById('bpStart')?.value||'';const end=document.getElementById('bpEnd')?.value||'';const budget=document.getElementById('bpBudget')?.value||'';
    if(!city||!start||!end||!budget)return toast('Add the trip details and your budget first','warn');
    try{await post('savePlan',{meta:{location,otherLocation,city,start,end},budget});closeModal();toast('Your trip budget was saved');setTimeout(refresh,500);}catch(err){toast(err.message||'Could not save budget','warn');}
  }

  function openBudgetOnly(id){
    const plan=planById(id);const a=actor();if(!plan||!a)return;activePlanId=id;modalMode='budget';const current=plan?.budgets?.[a]??'';
    showModal(`<span class="panel-kicker">YOUR INDIVIDUAL BUDGET</span><h2>${esc(plan.meta?.city||locationLabel(plan.meta))}</h2><p>${esc(otherActor(a))}’s budget stays separate. Enter only what <strong>you</strong> want to allow yourself for this trip.</p><div class="budget-field"><label>${esc(a)} budget</label><input id="bpOwnBudget" inputmode="decimal" value="${esc(current)}" placeholder="€ 0.00"></div><div class="budget-modal-actions"><button class="btn ghost" type="button" data-budget-cancel>Cancel</button><button class="btn primary" type="button" data-budget-save-own>Save budget</button></div>`);
    document.querySelector('[data-budget-cancel]')?.addEventListener('click',closeModal);document.querySelector('[data-budget-save-own]')?.addEventListener('click',saveOwnBudget);
  }

  async function saveOwnBudget(){
    const budget=document.getElementById('bpOwnBudget')?.value||'';if(!budget)return toast('Enter your budget first','warn');
    try{await post('savePlan',{id:activePlanId,budget});closeModal();toast('Your budget was updated');setTimeout(refresh,500);}catch(err){toast(err.message||'Could not save budget','warn');}
  }

  function openActuals(id){
    const plan=planById(id);const a=actor();if(!plan||!a)return;activePlanId=id;modalMode='actual';const trip=tripForPlan(plan);const own=trip?.submissions?.[a]||{};
    showModal(`<span class="panel-kicker">AFTER THE TRIP</span><h2>Log your actual expenses</h2><p>${esc(plan.meta?.city||locationLabel(plan.meta))} · ${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)}. Trip details are already fixed, so only the calculations are asked.</p><div class="budget-form-grid">${FIELDS.map(([key,label])=>`<div class="budget-field"><label>${esc(label)}</label><input data-actual-field="${esc(key)}" inputmode="decimal" value="${esc(own?.[key]??'')}" placeholder="€ 0.00"></div>`).join('')}<div class="budget-field full"><label>Other expense note</label><textarea id="bpActualNote">${esc(own?.otherNote||'')}</textarea></div><div class="budget-field full"><label>How much did ${esc(a)} actually pay?</label><input id="bpActualPaid" inputmode="decimal" value="${esc(own?.paid??'')}" placeholder="€ 0.00"></div></div><div class="budget-modal-actions"><button class="btn ghost" type="button" data-budget-cancel>Cancel</button><button class="btn primary" type="button" data-budget-save-actual>Save actual expenses</button></div>`);
    document.querySelector('[data-budget-cancel]')?.addEventListener('click',closeModal);document.querySelector('[data-budget-save-actual]')?.addEventListener('click',saveActuals);
  }

  async function saveActuals(){
    const submission={uncertain:{}};document.querySelectorAll('[data-actual-field]').forEach(input=>{submission[input.dataset.actualField]=input.value||'0';});submission.otherNote=document.getElementById('bpActualNote')?.value||'';submission.paid=document.getElementById('bpActualPaid')?.value||'';
    if(!submission.paid)return toast('Add how much you actually paid','warn');
    try{await post('savePlanSubmission',{planId:activePlanId,submission});closeModal();toast('Your actual expenses were saved');setTimeout(()=>location.reload(),700);}catch(err){toast(err.message||'Could not save actual expenses','warn');}
  }

  function decorateTripCards(){
    (state.plans||[]).forEach(plan=>{
      if(!plan.linkedTripId)return;const card=document.querySelector(`[data-open-trip="${CSS.escape(plan.linkedTripId)}"]`);if(!card)return;
      const second=card.querySelector('.trip-card-bottom span');if(!second)return;const trip=tripForPlan(plan);const pB=plan?.budgets?.Principessa??'',qB=plan?.budgets?.Principe??'',pA=trip?.submissions?.Principessa?.paid??'',qA=trip?.submissions?.Principe?.paid??'';
      if(pB!==''&&qB!==''&&pA!==''&&qA!=='')second.textContent=variance(n(pB)+n(qB),n(pA)+n(qA)).text;else second.textContent='Individual budgets linked';
    });
  }

  function skipLegacySharedBudget(){
    const body=document.getElementById('wizardBody');const h2=body?.querySelector('h2');if(h2?.textContent.trim()==='What is your ideal total budget for this trip?')body.querySelector('[data-skip-budget]')?.click();
  }

  async function refresh(){
    if(busy||!API_URL)return;busy=true;try{const res=await jsonp({action:'state'});if(res?.ok){state=res.state||state;renderPlans();}}catch{}finally{busy=false;}
  }

  document.addEventListener('DOMContentLoaded',()=>{installUi();refresh();setInterval(refresh,4000);setInterval(skipLegacySharedBudget,180);});
})();
