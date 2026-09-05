(() => {
  'use strict';

  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const CONFIG=window.TOGETHER_BUDGET_CONFIG||{};
  const API_URL=String(CONFIG.appsScriptUrl||'').trim();
  const ACTOR_KEY='twogether_actor_v1';
  const MONEY_KEYS=['accom','groceries','eat','travel','fuel','tolls','other'];
  let remoteState=null;
  let currentSig='';
  let devActive=false;
  let devMode='';
  let refreshBusy=false;
  let refreshQueued=false;
  let dragged=null;

  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const n=v=>{const x=Number(String(v??'').replace(',','.'));return Number.isFinite(x)?x:0;};
  const money=v=>'€'+n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const actor=()=>document.body.dataset.actor||localStorage.getItem(ACTOR_KEY)||'';
  const otherActor=()=>actor()==='Principessa'?'Principe':'Principessa';
  const fmtDate=v=>{if(!v)return '—';const [y,m,d]=String(v).split('-');return y&&m&&d?`${d}/${m}/${y}`:String(v);};
  const cssEscape=v=>window.CSS?.escape?CSS.escape(String(v)):String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&');

  function toast(msg,tone='ok'){
    const el=$('#toast');if(!el)return;
    el.textContent=msg;el.className='toast show '+tone;
    clearTimeout(el._v12);el._v12=setTimeout(()=>el.className='toast',2800);
  }

  function jsonp(params={}){
    return new Promise((resolve,reject)=>{
      if(!API_URL)return reject(new Error('Backend URL missing'));
      const cb='__tw_v12_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      const script=document.createElement('script');
      const timer=setTimeout(()=>done(new Error('Sync timed out')),10000);
      function done(err,data){clearTimeout(timer);try{delete window[cb];}catch{}script.remove();err?reject(err):resolve(data);}
      window[cb]=data=>done(null,data);
      const q=new URLSearchParams({...params,callback:cb,_:String(Date.now())});
      script.src=API_URL+(API_URL.includes('?')?'&':'?')+q.toString();
      script.onerror=()=>done(new Error('Could not reach backend'));
      document.head.appendChild(script);
    });
  }

  function post(action,payload){return window.TwogetherAPI.post(action,payload,actor());}

  function isLocked(trip){return !!(trip?.confirmed?.Principessa&&trip?.confirmed?.Principe);}
  function tripMeta(trip){return trip?.submissions?.[trip?.createdBy]||trip?.submissions?.Principessa||trip?.submissions?.Principe||{};}
  function submissionTotal(s){return MONEY_KEYS.reduce((sum,key)=>sum+n(s?.[key]),0);}
  function partialTotal(p){return MONEY_KEYS.reduce((sum,key)=>sum+n(p?.[key]),0);}

  function tripCurrentTotal(trip){
    const a=trip?.submissions?.Principessa,b=trip?.submissions?.Principe;
    if(a&&b){return MONEY_KEYS.reduce((sum,key)=>sum+(n(a[key])+n(b[key]))/2,0);}
    return submissionTotal(a||b||{});
  }

  function planSpent(plan,trip){
    if(trip?.submissions?.Principessa||trip?.submissions?.Principe)return {value:tripCurrentTotal(trip),approx:!isLocked(trip)};
    const p=partialTotal(plan?.partials?.Principessa||{}),q=partialTotal(plan?.partials?.Principe||{});
    return {value:Math.max(p,q),approx:!!(p||q)};
  }

  function planBudget(plan){
    const p=plan?.budgets?.Principessa,q=plan?.budgets?.Principe;
    const hasP=p!==''&&p!=null,hasQ=q!==''&&q!=null;
    if(!hasP&&!hasQ)return {value:0,label:'Not set',complete:false};
    const value=(hasP?n(p):0)+(hasQ?n(q):0);
    return {value,label:money(value),complete:hasP&&hasQ};
  }

  function locationLabel(meta){return meta?.location==='Other'?(meta.otherLocation||'Other'):(meta?.location||'—');}

  function hiddenPlanCard(planId){return $(`#budgetPlanGrid [data-v5-plan="${cssEscape(planId)}"]`);}
  function clickPlanAction(planId,selector){
    const target=hiddenPlanCard(planId)?.querySelector(selector);
    if(!target){toast('That action is not available yet','warn');return;}
    target.click();
  }
  function openTrip(tripId){
    if(window.TwogetherApp){window.TwogetherApp.open(tripId);return;}
    const target=$(`#tripGallery [data-open-trip="${cssEscape(tripId)}"]`);
    if(target){target.click();return;}
    toast('Could not open this trip yet','warn');
  }
  function openBudgetPlanner(){
    const btn=$('#budgetPlannerSection [data-v5-new-plan]')||$('[data-v5-new-plan]');
    if(btn){btn.click();return;}
    toast('Trip budgets are still loading','warn');
  }

  function ensureQuickBudgetButton(){
    const copy=$('#log .hero-copy');if(!copy||$('#twQuickBudget'))return;
    const wrap=document.createElement('div');wrap.className='tw-log-shortcuts';
    wrap.innerHTML='<button id="twQuickBudget" class="btn ghost" type="button">Plan a trip budget</button>';
    copy.appendChild(wrap);$('#twQuickBudget')?.addEventListener('click',openBudgetPlanner);
  }

  function ensureCurrentTripsShell(){
    const gallery=$('#log .trip-gallery-section');if(!gallery)return null;
    let section=$('#twCurrentTripsSection');
    if(!section){
      section=document.createElement('section');section.id='twCurrentTripsSection';section.className='tw-current-trips-section';
      section.innerHTML='<div class="tw-current-head"><div><span class="panel-kicker">NOW</span><h2 id="twCurrentTitle">Current Trips</h2><p>Keep planned trips and expenses in progress here.</p></div><button class="btn ghost" type="button" data-v12-plan>Plan a trip budget</button></div><div id="twCurrentTrips" class="tw-current-grid"></div>';
      gallery.parentNode.insertBefore(section,gallery);
      $('[data-v12-plan]',section)?.addEventListener('click',openBudgetPlanner);
    }
    return section;
  }

  function currentPlanCard(plan,trip){
    const meta=plan?.meta||{};
    const budget=planBudget(plan);
    const spent=planSpent(plan,trip);
    const a=actor();
    const ownBudget=plan?.budgets?.[a];
    const ownPartial=plan?.partials?.[a];
    const ownSub=trip?.submissions?.[a];
    const anySpent=spent.value>0;
    let status='Planned';
    if(trip||ownPartial||anySpent||Object.values(plan.sharedExpenses||{}).some(m=>m.mode?.Principessa||m.mode?.Principe))status='In progress';
    else if(!budget.complete)status='Waiting for both budgets';
    const budgetText=budget.complete?budget.label:(budget.value?`${budget.label} set so far`:'Not set');
    const spentText=spent.value?`${spent.approx?'~ ':''}${money(spent.value)}`:'€0.00';
    const canBudget=!ownPartial&&!ownSub;
    const canActual=true;
    const actualLabel=ownSub?'Edit expenses':ownPartial?'Continue expenses':'Add expenses';
    return `<article class="tw-current-card" data-current-plan="${esc(plan.id)}">
      <button class="tw-current-main" type="button" data-current-primary="${trip?.id?'trip':'actual'}">
        <div class="tw-current-top"><span class="trip-country">${esc(locationLabel(meta))}</span><span class="tw-current-status">${esc(status)}</span></div>
        <h3>${esc(meta.city||locationLabel(meta))}</h3><p>${fmtDate(meta.start)}–${fmtDate(meta.end)}</p>
        <div class="tw-current-numbers"><div><span>Total budget</span><strong>${esc(budgetText)}</strong></div><div><span>Trip so far</span><strong>${esc(spentText)}</strong></div></div>
      </button>
      <div class="tw-current-actions">
        ${true?`<button class="text-btn" type="button" data-current-budget>${ownBudget===''||ownBudget==null?'Add my budget':'Edit my budget'}</button>`:''}
        ${canActual?`<button class="btn ghost" type="button" data-current-actual>${esc(actualLabel)}</button>`:''}
        <button class="text-btn" type="button" data-current-open>Open trip</button>
      </div>
    </article>`;
  }

  function currentTripCard(trip){
    const meta=tripMeta(trip);const total=tripCurrentTotal(trip);
    return `<article class="tw-current-card" data-current-trip="${esc(trip.id)}">
      <button class="tw-current-main" type="button" data-current-open-standalone>
        <div class="tw-current-top"><span class="trip-country">${esc(locationLabel(meta))}</span><span class="tw-current-status">In progress</span></div>
        <h3>${esc(meta.city||locationLabel(meta))}</h3><p>${fmtDate(meta.start)}–${fmtDate(meta.end)}</p>
        <div class="tw-current-numbers"><div><span>Planned budget</span><strong>${trip?.budget?money(trip.budget):'Not set'}</strong></div><div><span>Trip so far</span><strong>${total?`~ ${money(total)}`:'€0.00'}</strong></div></div>
      </button>
      <div class="tw-current-actions"><button class="text-btn" type="button" data-current-open-standalone>Open trip</button></div>
    </article>`;
  }

  function renderCurrentTrips(){
    if(window.TwogetherDev?.active)return;
    const section=ensureCurrentTripsShell(),root=$('#twCurrentTrips');if(!section||!root||!remoteState)return;
    const trips=Array.isArray(remoteState.trips)?remoteState.trips:[];
    const plans=Array.isArray(remoteState.plans)?remoteState.plans:[];
    const tripMap=new Map(trips.map(t=>[t.id,t]));
    const linkedIds=new Set(plans.map(p=>p.linkedTripId).filter(Boolean));
    const activePlans=plans.filter(p=>!isLocked(tripMap.get(p.linkedTripId)));
    const standalone=trips.filter(t=>!isLocked(t)&&!linkedIds.has(t.id));
    const count=activePlans.length+standalone.length;
    const sig=JSON.stringify({a:actor(),plans:activePlans,trips:standalone.map(t=>({id:t.id,updatedAt:t.updatedAt,confirmed:t.confirmed,submissions:t.submissions,budget:t.budget}))});
    $('#twCurrentTitle').textContent=count===1?'Current Trip':'Current Trips';
    if(sig===currentSig){wireCurrentTrips();return;}
    currentSig=sig;
    if(!count){root.innerHTML='<div class="tw-current-empty"><strong>No current trips</strong><span>Plan a budget or start logging a trip when you are ready.</span></div>';wireCurrentTrips();return;}
    root.innerHTML=activePlans.map(p=>currentPlanCard(p,tripMap.get(p.linkedTripId))).join('')+standalone.map(currentTripCard).join('');
    wireCurrentTrips();
    if(devActive)decorateDevTargets();
  }

  function wireCurrentTrips(){
    $$('#twCurrentTrips [data-current-plan]').forEach(card=>{
      if(card.dataset.v12Wired==='1')return;card.dataset.v12Wired='1';
      const id=card.dataset.currentPlan;
      $('[data-current-budget]',card)?.addEventListener('click',()=>window.TwogetherWorkflow.budget(id));
      $('[data-current-actual]',card)?.addEventListener('click',()=>window.TwogetherWorkflow.start(id));
      $('[data-current-open]',card)?.addEventListener('click',()=>{const p=(remoteState?.plans||[]).find(x=>x.id===id);window.TwogetherOverview.open(p);});
      $('[data-current-primary]',card)?.addEventListener('click',()=>{const p=(remoteState?.plans||[]).find(x=>x.id===id);window.TwogetherOverview.open(p);});
    });
    $$('#twCurrentTrips [data-current-trip]').forEach(card=>{
      if(card.dataset.v12Wired==='1')return;card.dataset.v12Wired='1';const id=card.dataset.currentTrip;
      $$('[data-current-open-standalone]',card).forEach(btn=>btn.addEventListener('click',()=>openTrip(id)));
    });
  }

  function filterTripStories(){
    const root=$('#tripGallery');if(!root||!remoteState)return;
    const locked=new Set((remoteState.trips||[]).filter(isLocked).map(t=>t.id));
    let visible=0;
    $$('[data-open-trip]',root).forEach(card=>{const show=locked.has(card.dataset.openTrip);card.classList.toggle('tw-v12-hidden',!show);if(show)visible++;});
    root.querySelector('.tw-story-empty')?.remove();
    if(!visible){const e=document.createElement('div');e.className='empty-state gallery-empty tw-story-empty';e.innerHTML='<strong>No confirmed trips yet</strong><span>Trips move here after both of you confirm them.</span>';root.appendChild(e);}
    const heading=$('#log .trip-gallery-section .section-heading');
    if(heading){const kicker=$('.panel-kicker',heading),h=$('h2',heading),p=$('p',heading);if(kicker)kicker.textContent='CONFIRMED';if(h)h.textContent='Trip stories';if(p)p.textContent='Only finished and confirmed trips live here.';}
  }

  async function refreshRemote(){
    if(refreshBusy){refreshQueued=true;return;}refreshBusy=true;
    try{const res=await jsonp({action:'state'});if(res?.ok){remoteState=res.state||{};renderCurrentTrips();filterTripStories();}}
    catch{}
    finally{refreshBusy=false;if(refreshQueued){refreshQueued=false;setTimeout(refreshRemote,80);}}
  }

  function switchActor(){
    window.TwogetherDev?.exit();
    const next=otherActor();const choice=$(`.identity-choice[data-actor="${next}"]`);
    if(choice){choice.click();setTimeout(()=>{refreshRemote();syncBadge();},120);}
  }

  function syncBadge(){
    if(document.body.classList.contains('dev-playground'))return;
    const badge=$('#loggedUserBadge');if(!badge)return;
    badge.title=`Switch to ${otherActor()}`;badge.setAttribute('role','button');badge.setAttribute('tabindex','0');badge.setAttribute('aria-label',`Logged in as ${actor()}. Switch to ${otherActor()}`);
  }

  function installIdentitySwitch(){
    $('[data-tw-logout]')?.remove();syncBadge();
    document.addEventListener('click',e=>{if(e.target.closest?.('#loggedUserBadge')){e.preventDefault();e.stopImmediatePropagation();switchActor();}},true);
    document.addEventListener('keydown',e=>{if(e.target?.id==='loggedUserBadge'&&(e.key==='Enter'||e.key===' ')){e.preventDefault();switchActor();}},true);
  }

  function ensureDevToolbar(){
    if($('#twDevToolbar'))return;
    const bar=document.createElement('aside');bar.id='twDevToolbar';bar.innerHTML=`
      <div class="tw-dev-toolbar-head"><strong>Dev mode</strong><button type="button" data-dev-exit>Done</button></div>
      <p>Preview layout/design changes here. Real Delete actions still delete saved data.</p>
      <div class="tw-dev-tools">
        <button type="button" data-dev-mode="move">Move</button>
        <button type="button" data-dev-mode="text">Edit text</button>
        <button type="button" data-dev-mode="icons">Icons</button>
        <button type="button" data-dev-add="section">+ Section</button>
        <button type="button" data-dev-add="category">+ Category</button>
      </div>
      <div class="tw-dev-design"><label>Accent <input type="color" value="#a77700" data-dev-color></label><label>Spacing <select data-dev-density><option value="normal">Normal</option><option value="compact">Compact</option><option value="airy">Airy</option></select></label></div>
      <button class="tw-dev-reset" type="button" data-dev-reset>Reset preview</button>`;
    document.body.appendChild(bar);
    $('[data-dev-exit]',bar).addEventListener('click',()=>setDev(false));
    $$('[data-dev-mode]',bar).forEach(btn=>btn.addEventListener('click',()=>setDevMode(devMode===btn.dataset.devMode?'':btn.dataset.devMode)));
    $('[data-dev-add="section"]',bar).addEventListener('click',()=>addTestBlock('section'));
    $('[data-dev-add="category"]',bar).addEventListener('click',()=>addTestBlock('category'));
    $('[data-dev-color]',bar).addEventListener('input',e=>{document.documentElement.style.setProperty('--accent',e.target.value);document.documentElement.style.setProperty('--rose',e.target.value);});
    $('[data-dev-density]',bar).addEventListener('change',e=>{document.body.classList.remove('tw-dev-compact','tw-dev-airy');if(e.target.value!=='normal')document.body.classList.add('tw-dev-'+e.target.value);});
    $('[data-dev-reset]',bar).addEventListener('click',resetPreview);
  }

  function devTextTargets(){return $$('main h1,main h2,main h3,main .eyebrow,main .panel-kicker,main .section-heading p,main .page-heading p,main .finance-subpage-heading p,#twCurrentTripsSection p');}
  function movableTargets(){
    const active=$('.sheet.active');if(!active)return [];
    const scope=active.id==='finances'?$('.finance-subview.active',active)||active:active;
    const direct=[...scope.children].filter(el=>!el.matches('script,style'));
    const headings=$$('.section-heading>div>*:not(button),.page-heading>*,.finance-subpage-heading>*,.hero-copy>*',scope);
    return [...new Set([...direct,...headings])];
  }

  function setDevMode(mode){
    devMode=mode;document.body.classList.toggle('tw-dev-move',mode==='move');document.body.classList.toggle('tw-dev-text',mode==='text');document.body.classList.toggle('tw-dev-icons',mode==='icons');
    $$('#twDevToolbar [data-dev-mode]').forEach(b=>b.classList.toggle('active',b.dataset.devMode===mode));
    devTextTargets().forEach(el=>{if(mode==='text'){el.contentEditable='true';el.spellcheck=false;}else el.removeAttribute('contenteditable');});
    movableTargets().forEach(el=>{el.draggable=mode==='move';el.classList.toggle('tw-dev-draggable',mode==='move');});
  }

  function resetPreview(){
    $$('[data-dev-temp]').forEach(x=>x.remove());$$('.tw-dev-preview-hidden').forEach(x=>x.classList.remove('tw-dev-preview-hidden'));
    document.documentElement.style.removeProperty('--accent');document.documentElement.style.removeProperty('--rose');
    document.body.classList.remove('tw-dev-compact','tw-dev-airy');const density=$('[data-dev-density]');if(density)density.value='normal';
    setDevMode('');toast('Preview reset');
  }

  function addTestBlock(type){
    const active=$('.sheet.active');if(!active)return;const scope=active.id==='finances'?$('.finance-subview.active',active)||active:active;
    const name=prompt(type==='section'?'Name this test section':'Name this test category');if(!name)return;
    const el=document.createElement(type==='section'?'section':'div');el.dataset.devTemp='1';el.className=type==='section'?'tw-dev-test-block':'tw-dev-test-category';
    el.innerHTML=type==='section'?`<span>DEV PREVIEW</span><h2>${esc(name)}</h2><p>Temporary section. Move it, edit its text, or hide it while testing.</p>`:`<span>DEV CATEGORY</span><strong>${esc(name)}</strong><small>Temporary preview category</small>`;
    scope.appendChild(el);decorateDevTargets();toast(`${type==='section'?'Section':'Category'} added for preview`);
  }

  function addNodeTools(node,label='Block'){
    if(!devActive||node.querySelector(':scope > .tw-dev-node-tools'))return;
    node.classList.add('tw-dev-manageable');
    const tools=document.createElement('div');tools.className='tw-dev-node-tools';tools.innerHTML=`<span>${esc(label)}</span><button type="button" data-dev-hide>Hide preview</button>`;
    node.appendChild(tools);$('[data-dev-hide]',tools).addEventListener('click',e=>{e.preventDefault();e.stopPropagation();node.classList.add('tw-dev-preview-hidden');});
  }

  function decorateDevTargets(){
    if(!devActive)return;
    const active=$('.sheet.active');if(active){
      const scope=active.id==='finances'?$('.finance-subview.active',active)||active:active;
      [...scope.children].forEach(el=>{if(!el.matches('#twDevToolbar,script,style'))addNodeTools(el,el.querySelector('h1,h2,h3')?.textContent?.trim()||'Section');});
    }
    $$('#tripGallery [data-open-trip]:not(.tw-v12-hidden)').forEach(card=>{
      if(card.querySelector('.tw-dev-data-action'))return;
      const del=document.createElement('span');del.className='tw-dev-data-action';del.textContent='Delete trip';del.dataset.devDeleteTrip=card.dataset.openTrip;card.appendChild(del);
    });
    $$('#financeWishlist tbody tr[data-prio]').forEach(row=>{
      const cell=row.querySelector('.wishlist-edit-cell');if(!cell||cell.querySelector('.tw-dev-wish-delete'))return;
      const del=document.createElement('button');del.type='button';del.className='tw-dev-wish-delete';del.textContent='Delete';cell.appendChild(del);
    });
    $$('#financeMonths .finance-month.saved').forEach(btn=>{
      if(btn.querySelector('.tw-dev-month-delete'))return;const del=document.createElement('span');del.className='tw-dev-month-delete';del.textContent='Delete';btn.appendChild(del);
    });
    $$('#twCurrentTrips .tw-current-card').forEach(card=>{
      if(card.querySelector('.tw-dev-current-hide'))return;const del=document.createElement('button');del.type='button';del.className='tw-dev-current-hide';del.textContent='Hide preview';card.appendChild(del);
    });
  }

  function clearDevDecorations(){
    $$('.tw-dev-node-tools,.tw-dev-data-action,.tw-dev-wish-delete,.tw-dev-month-delete,.tw-dev-current-hide').forEach(x=>x.remove());
    $$('.tw-dev-manageable').forEach(x=>x.classList.remove('tw-dev-manageable'));
    resetPreview();
  }

  function setDev(on){
    devActive=!!on;document.body.classList.toggle('tw-dev-active',devActive);ensureDevToolbar();
    const btn=$('[data-tw-dev]');if(btn){btn.textContent=devActive?'Dev ✓':'Dev';btn.classList.toggle('active',devActive);}
    if(devActive){decorateDevTargets();toast('Dev mode on · design changes are preview-only');}
    else{clearDevDecorations();toast('Dev mode off');}
  }

  function installDevIntercept(){
    document.addEventListener('click',e=>{
      const dev=e.target.closest?.('[data-tw-dev]');if(dev){e.preventDefault();e.stopImmediatePropagation();setDev(!devActive);return;}
      if(!devActive)return;
      const tripDelete=e.target.closest?.('[data-dev-delete-trip]');
      if(tripDelete){e.preventDefault();e.stopImmediatePropagation();const id=tripDelete.dataset.devDeleteTrip;if(confirm('Delete this saved trip permanently?'))post('deleteTrip',{id}).then(()=>setTimeout(refreshRemote,950)).catch(err=>toast(err.message,'warn'));return;}
      const wishDelete=e.target.closest?.('.tw-dev-wish-delete');
      if(wishDelete){e.preventDefault();e.stopImmediatePropagation();if(!confirm('Delete this wishlist item permanently?'))return;const row=wishDelete.closest('tr');const edit=row?.querySelector('[data-wish-index]');edit?.click();setTimeout(()=>document.querySelector('[data-wish-delete]')?.click(),40);return;}
      const monthDelete=e.target.closest?.('.tw-dev-month-delete');
      if(monthDelete){e.preventDefault();e.stopImmediatePropagation();const month=monthDelete.closest('[data-fin-month]')?.dataset.finMonth;if(month&&confirm(`Delete ${month} finance data permanently?`))post('deleteFinanceMonth',{month}).then(()=>setTimeout(()=>location.reload(),950)).catch(err=>toast(err.message,'warn'));return;}
      const currentHide=e.target.closest?.('.tw-dev-current-hide');if(currentHide){e.preventDefault();e.stopImmediatePropagation();currentHide.closest('.tw-current-card')?.classList.add('tw-dev-preview-hidden');return;}
      if(devMode==='icons'){
        const icon=e.target.closest?.('.pick-icon,.brand-mark,.identity-heart');if(icon){e.preventDefault();e.stopImmediatePropagation();const value=prompt('Icon / symbol',icon.textContent.trim());if(value!=null)icon.textContent=value;}
      }
    },true);
  }

  function installDragHandlers(){
    document.addEventListener('dragstart',e=>{if(!devActive||devMode!=='move')return;const el=e.target.closest?.('.tw-dev-draggable');if(!el)return;dragged=el;el.classList.add('tw-dev-dragging');e.dataTransfer.effectAllowed='move';});
    document.addEventListener('dragend',()=>{dragged?.classList.remove('tw-dev-dragging');dragged=null;});
    document.addEventListener('dragover',e=>{if(!dragged)return;const parent=dragged.parentElement;if(!parent||!parent.contains(e.target))return;e.preventDefault();const siblings=[...parent.children].filter(x=>x!==dragged&&x.classList.contains('tw-dev-draggable'));const after=siblings.find(x=>e.clientY<x.getBoundingClientRect().top+x.getBoundingClientRect().height/2);if(after)parent.insertBefore(dragged,after);else parent.appendChild(dragged);});
  }

  function scheduleRefresh(){
    if(window.TwogetherDev?.active)return;
    if(refreshQueued)return;refreshQueued=true;requestAnimationFrame(()=>{refreshQueued=false;ensureQuickBudgetButton();ensureCurrentTripsShell();syncBadge();if(remoteState){renderCurrentTrips();filterTripStories();}if(devActive)decorateDevTargets();});
  }

  document.addEventListener('DOMContentLoaded',()=>{
    ensureQuickBudgetButton();ensureCurrentTripsShell();installIdentitySwitch();
    setTimeout(()=>{$('[data-tw-logout]')?.remove();syncBadge();refreshRemote();},200);
    setInterval(refreshRemote,5000);
    setInterval(scheduleRefresh,1000);
    document.addEventListener('twogether:finance-view',()=>setTimeout(()=>{scheduleRefresh();if(devActive)decorateDevTargets();},0));
  });
})();

