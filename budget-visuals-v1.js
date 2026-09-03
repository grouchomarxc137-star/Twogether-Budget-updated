(() => {
  'use strict';

  const CONFIG=window.TOGETHER_BUDGET_CONFIG||{};
  const API_URL=String(CONFIG.appsScriptUrl||'').trim();
  const ACTOR_KEY='twogether_actor_v1';
  let lastTripId='';
  let stateCache=null;
  let statePromise=null;

  const money=v=>'€'+Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const n=v=>{const x=Number(String(v??'').replace(',','.'));return Number.isFinite(x)?x:0;};
  const has=v=>v!==''&&v!=null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function actor(){
    const a=document.body.dataset.actor||'';
    if(a==='Principessa'||a==='Principe')return a;
    try{const saved=localStorage.getItem(ACTOR_KEY)||'';return saved==='Principessa'||saved==='Principe'?saved:'';}catch{}
    return '';
  }

  function jsonp(){
    return new Promise((resolve,reject)=>{
      if(!API_URL)return reject(new Error('Backend missing'));
      const cb='__twogether_budget_visual_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      const s=document.createElement('script');
      const timer=setTimeout(()=>done(new Error('timeout')),9000);
      function done(err,data){clearTimeout(timer);try{delete window[cb];}catch{}s.remove();err?reject(err):resolve(data);}
      window[cb]=data=>done(null,data);
      const q=new URLSearchParams({action:'state',callback:cb,_:String(Date.now())});
      s.src=API_URL+(API_URL.includes('?')?'&':'?')+q.toString();
      s.onerror=()=>done(new Error('unreachable'));
      document.head.appendChild(s);
    });
  }

  function getState(force=false){
    if(stateCache&&!force)return Promise.resolve(stateCache);
    if(statePromise)return statePromise;
    statePromise=jsonp().then(res=>{
      if(res?.ok)stateCache=res.state||{};
      return stateCache||{};
    }).finally(()=>{statePromise=null;});
    return statePromise;
  }

  function variance(budget,actual){
    if(!has(budget))return {cls:'',text:'Budget not set'};
    if(!has(actual))return {cls:'',text:'Actual spend not logged yet'};
    const d=n(budget)-n(actual);
    if(Math.abs(d)<.01)return {cls:'on',text:'Exactly on budget'};
    return d>0?{cls:'under',text:`${money(d)} under budget`}:{cls:'over',text:`${money(Math.abs(d))} over budget`};
  }

  function item(label,budget,actual){
    const v=variance(budget,actual);
    const budgetText=has(budget)?money(budget):'Not set';
    const actualText=has(actual)?money(actual):'Not logged';
    return `<div class="confirmed-budget-item ${v.cls}"><span>${esc(label)}</span><strong>${budgetText}</strong><small>${esc(v.text)} · actual ${actualText}</small></div>`;
  }

  function decorateConfirmedBudget(state,tripId){
    const root=document.getElementById('tripModalBody');
    if(!root||!tripId)return;
    const trip=(state?.trips||[]).find(t=>t.id===tripId);
    const plan=(state?.plans||[]).find(p=>p.linkedTripId===tripId);
    if(!trip||!plan||!(trip?.confirmed?.Principessa&&trip?.confirmed?.Principe))return;

    const pb=plan?.budgets?.Principessa??'';
    const qb=plan?.budgets?.Principe??'';
    const pa=trip?.submissions?.Principessa?.paid??'';
    const qa=trip?.submissions?.Principe?.paid??'';
    const combinedBudget=has(pb)&&has(qb)?n(pb)+n(qb):'';
    const combinedActual=has(pa)&&has(qa)?n(pa)+n(qa):'';
    const combinedVar=variance(combinedBudget,combinedActual);

    const old=root.querySelector('.confirmed-budget-comparison');
    if(old)old.remove();
    const box=document.createElement('section');
    box.className='confirmed-budget-comparison';
    box.innerHTML=`<h3>Budget comparison</h3><p>Your planned limits compared with what each of you actually paid.</p><div class="confirmed-budget-grid">${item('Principessa',pb,pa)}${item('Principe',qb,qa)}${item('Combined',combinedBudget,combinedActual)}</div>`;

    const analysis=root.querySelector('.confirmed-spend-overview');
    const submissions=root.querySelector('.submission-grid');
    const anchor=analysis||submissions;
    if(anchor)anchor.parentNode.insertBefore(box,anchor);
    else root.appendChild(box);

    const summary=root.querySelector('.budget-check');
    if(summary){
      const cells=[...summary.children];
      if(cells[0]){
        const span=cells[0].querySelector('span'),strong=cells[0].querySelector('strong');
        if(span)span.textContent='Planned budgets';
        if(strong)strong.textContent=has(combinedBudget)?money(combinedBudget):'Not fully set';
      }
      if(cells[1]){
        const span=cells[1].querySelector('span'),strong=cells[1].querySelector('strong');
        if(span)span.textContent='Combined actually paid';
        if(strong)strong.textContent=has(combinedActual)?money(combinedActual):'Waiting for both';
      }
      if(cells[2]){
        const span=cells[2].querySelector('span'),strong=cells[2].querySelector('strong');
        if(span)span.textContent='Budget check';
        if(strong)strong.textContent=combinedVar.text;
      }
      summary.classList.remove('ok','warn');
      if(combinedVar.cls==='under'||combinedVar.cls==='on')summary.classList.add('ok');
      if(combinedVar.cls==='over')summary.classList.add('warn');
    }
  }

  function lockSubmittedBudgetButtons(){
    const a=actor();
    if(!a)return;
    const grid=document.getElementById('budgetPlanGrid');
    if(!grid)return;
    const personIndex=a==='Principessa'?0:1;
    [...grid.querySelectorAll('[data-v5-plan]')].forEach(card=>{
      const people=[...card.querySelectorAll('.budget-person')];
      const mine=people[personIndex];
      const hasActual=/\bactual\s+€/i.test(mine?.querySelector('small')?.textContent||'');
      const edit=card.querySelector('[data-v5-own-budget]');
      let note=card.querySelector('.budget-locked-note');
      if(hasActual){
        if(edit)edit.style.display='none';
        if(!note){
          note=document.createElement('div');note.className='budget-locked-note';note.textContent='Your planned budget is locked because you already logged your actual expenses.';
          card.querySelector('.budget-plan-actions')?.appendChild(note);
        }
        const header=document.querySelector('[data-v5-new-plan]');
        if(header&&header.dataset.v6PlanId===card.dataset.v5Plan){
          header.textContent='Budget locked';header.disabled=true;
        }
      }else{
        if(edit)edit.style.display='';
        note?.remove();
      }
    });
  }

  document.addEventListener('click',event=>{
    const tripCard=event.target.closest?.('[data-open-trip]');
    if(!tripCard)return;
    lastTripId=tripCard.dataset.openTrip||'';
    getState(true).then(state=>decorateConfirmedBudget(state,lastTripId)).catch(()=>{});
  },true);

  document.addEventListener('DOMContentLoaded',()=>{
    const grid=document.getElementById('budgetPlanGrid');
    if(grid){
      lockSubmittedBudgetButtons();
      new MutationObserver(()=>setTimeout(lockSubmittedBudgetButtons,0)).observe(grid,{childList:true});
    }else{
      setTimeout(()=>{
        const later=document.getElementById('budgetPlanGrid');
        if(!later)return;
        lockSubmittedBudgetButtons();
        new MutationObserver(()=>setTimeout(lockSubmittedBudgetButtons,0)).observe(later,{childList:true});
      },0);
    }
  });
})();
