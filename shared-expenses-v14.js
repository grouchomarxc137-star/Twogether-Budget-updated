(() => {
  'use strict';

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const CONFIG = window.TOGETHER_BUDGET_CONFIG || {};
  const API_URL = String(CONFIG.appsScriptUrl || '').trim();
  const ACTOR_KEY = 'twogether_actor_v1';
  const LABELS = {accom:'Accommodation', travel:'Flights / Train'};
  let state = null;
  let activePlanId = '';
  let bypass = false;
  let refreshBusy = false;
  let scheduled = false;

  function actor(){ return document.body.dataset.actor || localStorage.getItem(ACTOR_KEY) || ''; }
  function otherActor(){ return actor()==='Principessa' ? 'Principe' : 'Principessa'; }
  function n(v){ const x=Number(String(v ?? '').replace(',','.')); return Number.isFinite(x) ? x : 0; }
  function money(v){ return '€'+n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function css(v){ return window.CSS?.escape ? CSS.escape(String(v)) : String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&'); }
  function toast(msg,tone='ok'){ const el=$('#toast'); if(!el)return; el.textContent=msg; el.className='toast show '+tone; clearTimeout(el._shared14); el._shared14=setTimeout(()=>el.className='toast',2800); }

  function jsonp(params={}){
    return new Promise((resolve,reject)=>{
      if(!API_URL) return reject(new Error('Backend URL missing'));
      const cb='__tw_shared14_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      const script=document.createElement('script');
      const timer=setTimeout(()=>done(new Error('Sync timed out')),10000);
      function done(err,data){ clearTimeout(timer); try{delete window[cb];}catch{} script.remove(); err?reject(err):resolve(data); }
      window[cb]=data=>done(null,data);
      const q=new URLSearchParams({...params,callback:cb,_:String(Date.now())});
      script.src=API_URL+(API_URL.includes('?')?'&':'?')+q.toString();
      script.onerror=()=>done(new Error('Could not reach backend'));
      document.head.appendChild(script);
    });
  }

  function post(action,payload){
    return new Promise((resolve,reject)=>{
      const a=actor(); if(!API_URL)return reject(new Error('Backend URL missing')); if(!a)return reject(new Error('Choose a profile first'));
      const frame=$('iframe[name="backendFrame"]'); if(!frame)return reject(new Error('Backend frame missing'));
      const form=document.createElement('form'); form.method='POST'; form.action=API_URL; form.target='backendFrame'; form.style.display='none';
      Object.entries({action,actor:a,payload:JSON.stringify(payload||{})}).forEach(([k,v])=>{ const i=document.createElement('input'); i.type='hidden'; i.name=k; i.value=v; form.appendChild(i); });
      document.body.appendChild(form); form.submit(); form.remove(); setTimeout(resolve,900);
    });
  }

  async function refresh(){
    if(refreshBusy || !API_URL) return;
    refreshBusy=true;
    try{
      const res=await jsonp({action:'state'});
      if(res?.ok){ state=res.state||{}; decorateCurrentCards(); schedulePrepare(); }
    }catch{}
    finally{ refreshBusy=false; }
  }

  function planById(id){ return (state?.plans||[]).find(p=>p.id===id); }
  function sharedMeta(plan,key){
    const m=plan?.sharedExpenses?.[key] || {};
    return {
      total:m.total ?? '',
      totalUncertain:!!m.totalUncertain,
      mode:{Principessa:m.mode?.Principessa||'',Principe:m.mode?.Principe||''},
      paid:{Principessa:m.paid?.Principessa ?? '',Principe:m.paid?.Principe ?? ''},
      unknown:{Principessa:!!m.unknown?.Principessa,Principe:!!m.unknown?.Principe}
    };
  }

  function backendReady(){ return Number(state?.version||0) >= 16; }

  function detectKey(){
    const overlay=$('#workflowV5Overlay');
    if(!overlay?.classList.contains('show') || $('#v5MatchInput',overlay)) return '';
    const h=$('h2',overlay)?.textContent?.toLowerCase() || '';
    if(h.includes('accommodation')) return 'accom';
    if(h.includes('flight') || h.includes('train')) return 'travel';
    return '';
  }

  function flowInput(){ return $('#workflowV5Overlay #v5FlowInput') || $('#workflowV5Overlay #v5PartialAmount'); }
  function flowNext(){ return $('#workflowV5Overlay [data-v5-next]') || $('#workflowV5Overlay [data-v5-partial-next]'); }
  function certaintyEstimate(){ return $('#workflowV5Overlay [data-v5-cert="estimate"]') || $('#workflowV5Overlay [data-v5-partial-cert="estimate"]'); }

  function schedulePrepare(){
    if(scheduled) return;
    scheduled=true;
    requestAnimationFrame(()=>{ scheduled=false; prepareStep(); });
  }

  function setUnderlying(input,next,total,unknown){
    bypass=true;
    input.removeAttribute('data-shared14-pay');
    input.value=String(total===''?0:total);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    if(unknown){ certaintyEstimate()?.click(); setTimeout(()=>{ bypass=true; next.click(); bypass=false; },30); }
    else { next.click(); bypass=false; }
  }

  async function saveShared(key,{total='',mode='',paid='',unknown=false,totalUncertain=false}){
    if(!activePlanId) throw new Error('Trip plan not found');
    await post('saveSharedExpense',{planId:activePlanId,key,total,mode,paid,unknown,totalUncertain});
    await new Promise(r=>setTimeout(r,250));
    await refresh();
  }

  function removePanel(){ $('#sharedExpenseV14Panel')?.remove(); }

  function showOwnership(key,total,input,next){
    removePanel();
    const overlay=$('#workflowV5Overlay'); if(!overlay)return;
    const panel=document.createElement('div'); panel.id='sharedExpenseV14Panel'; panel.className='shared14-panel';
    panel.innerHTML=`<div class="shared14-card"><span class="panel-kicker">${esc(LABELS[key])}</span><h2>Who paid this?</h2><p>Total: <strong>${money(total)}</strong>${key==='accom'?` · 20% = <strong>${money(n(total)*.20)}</strong>`:''}</p><div class="shared14-choices"><button type="button" data-shared14-mode="full"><strong>I paid it fully myself</strong><small>${esc(otherActor())} will not be asked this category.</small></button><button type="button" data-shared14-mode="shared"><strong>It’s shared</strong><small>Enter how much you paid; the remaining share is suggested to ${esc(otherActor())}.</small></button></div><button class="btn ghost" type="button" data-shared14-cancel>Back</button></div>`;
    overlay.appendChild(panel);
    $('[data-shared14-cancel]',panel)?.addEventListener('click',removePanel);
    $('[data-shared14-mode="full"]',panel)?.addEventListener('click',async()=>{
      try{ await saveShared(key,{total,mode:'full',paid:total,unknown:false}); removePanel(); setUnderlying(input,next,total,false); }
      catch(err){ toast(err.message||'Could not save payment details','warn'); }
    });
    $('[data-shared14-mode="shared"]',panel)?.addEventListener('click',()=>showPaid(key,total,input,next,false));
  }

  function showPaid(key,total,input,next,unknown){
    const panel=$('#sharedExpenseV14Panel'); if(!panel)return;
    const plan=planById(activePlanId),m=sharedMeta(plan,key),other=otherActor();
    const otherPaid=m.paid?.[other]!==''?n(m.paid[other]):0;
    const suggested=total!==''?Math.max(0,n(total)-otherPaid):'';
    panel.innerHTML=`<div class="shared14-card"><span class="panel-kicker">${esc(LABELS[key])}</span><h2>How much did you pay?</h2><p>${total!==''?`Total ${esc(LABELS[key].toLowerCase())}: <strong>${money(total)}</strong>${otherPaid?` · ${esc(other)} already logged ${money(otherPaid)}`:''}.`:'The total is still unknown. Your payment will be saved and the total can be filled in later.'}${key==='accom'&&total!==''?` 20% = <strong>${money(n(total)*.20)}</strong>.`:''}</p><div class="money-input-wrap"><span>€</span><input id="shared14Paid" class="big-input money-field" inputmode="decimal" value="${esc(String(suggested))}" placeholder="0.00"></div><div class="shared14-actions"><button class="btn ghost" type="button" data-shared14-back>Back</button><button class="btn primary big" type="button" data-shared14-save>Save & continue</button></div></div>`;
    const pay=$('#shared14Paid',panel); setTimeout(()=>pay?.focus(),0);
    $('[data-shared14-back]',panel)?.addEventListener('click',()=>{ unknown?showUnknown(key,input,next):showOwnership(key,total,input,next); });
    $('[data-shared14-save]',panel)?.addEventListener('click',async()=>{
      const raw=String(pay?.value||'').trim(); if(!raw||!Number.isFinite(Number(raw.replace(',','.')))){toast('Enter how much you paid','warn');return;}
      try{ await saveShared(key,{total,mode:'shared',paid:raw,unknown,totalUncertain:unknown}); removePanel(); setUnderlying(input,next,total,unknown); }
      catch(err){ toast(err.message||'Could not save payment details','warn'); }
    });
  }

  function showUnknown(key,input,next){
    removePanel(); const overlay=$('#workflowV5Overlay'); if(!overlay)return;
    const panel=document.createElement('div'); panel.id='sharedExpenseV14Panel'; panel.className='shared14-panel';
    panel.innerHTML=`<div class="shared14-card"><span class="panel-kicker">${esc(LABELS[key])}</span><h2>Total not known yet</h2><p>You can still save what you personally paid. ${esc(otherActor())} can fill in the total later if they know it.</p><div class="money-input-wrap"><span>€</span><input id="shared14UnknownPaid" class="big-input money-field" inputmode="decimal" placeholder="What you paid"></div><div class="shared14-actions"><button class="btn ghost" type="button" data-shared14-cancel>Back</button><button class="btn primary big" type="button" data-shared14-unknown-save>Save & continue</button></div></div>`;
    overlay.appendChild(panel);
    const pay=$('#shared14UnknownPaid',panel); setTimeout(()=>pay?.focus(),0);
    $('[data-shared14-cancel]',panel)?.addEventListener('click',removePanel);
    $('[data-shared14-unknown-save]',panel)?.addEventListener('click',async()=>{
      const raw=String(pay?.value||'').trim(); if(!raw||!Number.isFinite(Number(raw.replace(',','.')))){toast('Enter how much you paid','warn');return;}
      try{ await saveShared(key,{total:'',mode:'shared',paid:raw,unknown:true,totalUncertain:true}); removePanel(); setUnderlying(input,next,'',true); }
      catch(err){ toast(err.message||'Could not save payment details','warn'); }
    });
  }

  function prepareStep(){
    if(!backendReady() || !activePlanId || bypass) return;
    const key=detectKey(),input=flowInput(),next=flowNext(); if(!key||!input||!next)return;
    const plan=planById(activePlanId); if(!plan)return;
    const m=sharedMeta(plan,key),other=otherActor();
    if(input.dataset.shared14Prepared==='1') return;
    input.dataset.shared14Prepared='1';

    if(m.mode?.[other]==='full' && m.total!==''){
      const note=document.createElement('div'); note.className='shared14-skip-note'; note.textContent=`${other} paid this fully. Skipping ${LABELS[key].toLowerCase()} for you.`;
      input.closest('.money-input-wrap')?.insertAdjacentElement('beforebegin',note);
      setTimeout(()=>setUnderlying(input,next,m.total,false),80); return;
    }

    if(m.mode?.[other]==='shared'){
      const total=m.total!==''?String(m.total):'';
      if(total!==''){
        const expected=Math.max(0,n(total)-n(m.paid?.[other]));
        const heading=$('#workflowV5Overlay h2'); if(heading)heading.textContent=`How much did you pay for ${LABELS[key].toLowerCase()}?`;
        input.dataset.shared14Pay='1'; input.dataset.shared14Total=total; input.dataset.shared14PayValue=String(m.paid?.[actor()]!==''?m.paid[actor()]:expected); input.value=input.dataset.shared14PayValue;
        const note=document.createElement('div'); note.className='shared14-share-note'; note.innerHTML=`Total: <strong>${money(total)}</strong> · ${esc(other)} paid ${money(m.paid?.[other])}. Suggested remaining share: <strong>${money(expected)}</strong>${key==='accom'?` · 20% = <strong>${money(n(total)*.20)}</strong>`:''}.`;
        input.closest('.money-input-wrap')?.insertAdjacentElement('beforebegin',note);
      } else {
        const note=document.createElement('div'); note.className='shared14-share-note'; note.innerHTML=`${esc(other)} already marked this as shared but did not know the total. Enter the total here if you know it, or use <strong>I don’t know the total</strong>.`;
        input.closest('.money-input-wrap')?.insertAdjacentElement('beforebegin',note);
      }
    }

    if(m.mode?.[actor()]==='full' && m.total!==''){
      input.value=String(m.total); input.dispatchEvent(new Event('input',{bubbles:true}));
    }

    if(!$('#workflowV5Overlay [data-shared14-unknown]') && m.total===''){
      const b=document.createElement('button'); b.type='button'; b.className='btn ghost full shared14-unknown'; b.dataset.shared14Unknown='1'; b.textContent='I don’t know the total';
      input.closest('.money-input-wrap')?.insertAdjacentElement('afterend',b);
      b.addEventListener('click',()=>showUnknown(key,input,next));
    }
  }

  function installInterceptors(){
    document.addEventListener('input',e=>{
      const input=e.target;
      if(!(input instanceof HTMLInputElement) || !input.matches('[data-shared14-pay]') || bypass) return;
      input.dataset.shared14PayValue=input.value;
      e.stopImmediatePropagation();
    },true);

    document.addEventListener('click',e=>{
      const planCard=e.target.closest?.('[data-current-plan]');
      if(planCard && (e.target.closest('[data-current-actual]')||e.target.closest('.tw-current-main'))) activePlanId=planCard.dataset.currentPlan||'';
      const hidden=e.target.closest?.('[data-v5-plan]');
      if(hidden && e.target.closest('[data-v5-actual]')) activePlanId=hidden.dataset.v5Plan||'';

      const next=e.target.closest?.('#workflowV5Overlay [data-v5-next], #workflowV5Overlay [data-v5-partial-next]');
      if(!next || bypass || !backendReady() || !activePlanId)return;
      const key=detectKey(),input=flowInput(); if(!key||!input)return;
      const plan=planById(activePlanId),m=sharedMeta(plan,key),other=otherActor();

      if(input.matches('[data-shared14-pay]')){
        e.preventDefault(); e.stopImmediatePropagation();
        const raw=String(input.dataset.shared14PayValue ?? input.value).trim(); if(!raw||!Number.isFinite(Number(raw.replace(',','.')))){toast('Enter how much you paid','warn');return;}
        const total=String(input.dataset.shared14Total||m.total||'');
        saveShared(key,{total,mode:'shared',paid:raw,unknown:false}).then(()=>setUnderlying(input,next,total,false)).catch(err=>toast(err.message||'Could not save','warn'));
        return;
      }

      const raw=String(input.value||'').trim();
      if(!raw || !Number.isFinite(Number(raw.replace(',','.')))) return;

      if(m.mode?.[other]==='shared' && m.total===''){
        e.preventDefault(); e.stopImmediatePropagation(); showOwnership(key,raw,input,next); return;
      }
      if(!m.mode?.[actor()]){
        e.preventDefault(); e.stopImmediatePropagation(); showOwnership(key,raw,input,next); return;
      }
    },true);
  }

  function decorateCurrentCards(){
    if(!state)return;
    $$('#twCurrentTrips [data-current-plan]').forEach(card=>{
      const plan=planById(card.dataset.currentPlan); if(!plan)return;
      const nums=$('.tw-current-numbers',card); if(!nums)return;
      const p=plan?.budgets?.Principessa, q=plan?.budgets?.Principe;
      const pHas=p!==''&&p!=null, qHas=q!==''&&q!=null;
      const total=(pHas?n(p):0)+(qHas?n(q):0);
      const tripSoFar=(()=>{
        const trip=(state.trips||[]).find(t=>t.id===plan.linkedTripId);
        if(trip?.submissions?.Principessa&&trip?.submissions?.Principe){return ['accom','groceries','eat','travel','fuel','tolls','other'].reduce((s,k)=>s+(n(trip.submissions.Principessa[k])+n(trip.submissions.Principe[k]))/2,0);}
        const pp=plan?.partials?.Principessa||{},qq=plan?.partials?.Principe||{};
        return Math.max(['accom','groceries','eat','travel','fuel','tolls','other'].reduce((s,k)=>s+n(pp[k]),0),['accom','groceries','eat','travel','fuel','tolls','other'].reduce((s,k)=>s+n(qq[k]),0));
      })();
      nums.classList.add('shared14-four');
      nums.innerHTML=`<div><span>Principessa budget</span><strong>${pHas?money(p):'Not set'}</strong></div><div><span>Principe budget</span><strong>${qHas?money(q):'Not set'}</strong></div><div><span>Total budget</span><strong>${pHas||qHas?money(total):'Not set'}</strong></div><div><span>Trip so far</span><strong>${money(tripSoFar)}</strong></div>`;
    });
  }

  function installMatchHotfix(){
    document.addEventListener('keydown',e=>{
      if(e.key==='Enter' && e.target?.id==='v5MatchInput'){ e.preventDefault(); $('#workflowV5Overlay [data-v5-match-next]')?.click(); }
    },true);
  }

  function init(){
    installInterceptors(); installMatchHotfix(); refresh(); setInterval(refresh,3500);
    const overlay=$('#workflowV5Overlay');
    if(overlay){ new MutationObserver(schedulePrepare).observe(overlay,{childList:true,subtree:true}); }
    window.addEventListener('focus',refresh,{passive:true});
  }

  document.addEventListener('DOMContentLoaded',init);
})();