(() => {
  'use strict';

  const $ = (s, r=document) => r.querySelector(s);
  const CONFIG = window.TOGETHER_BUDGET_CONFIG || {};
  const API_URL = String(CONFIG.appsScriptUrl || '').trim();
  const ACTOR_KEY = 'twogether_actor_v1';

  let meta = {};
  let creating = false;

  function actor(){ return document.body.dataset.actor || localStorage.getItem(ACTOR_KEY) || ''; }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function n(v){ const x=Number(String(v ?? '').replace(',','.')); return Number.isFinite(x) ? x : 0; }
  function money(v){ return '€'+n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function toast(msg,tone='ok'){
    const el=$('#toast'); if(!el)return;
    el.textContent=msg; el.className='toast show '+tone;
    clearTimeout(el._bridge15); el._bridge15=setTimeout(()=>el.className='toast',2800);
  }

  function heading(){ return $('#wizardBody h2')?.textContent?.trim() || ''; }

  function jsonp(params={}){
    return new Promise((resolve,reject)=>{
      if(!API_URL) return reject(new Error('Backend URL missing'));
      const cb='__tw_bridge15_'+Date.now()+'_'+Math.random().toString(36).slice(2);
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
      const a=actor();
      if(!API_URL) return reject(new Error('Backend URL missing'));
      if(!a) return reject(new Error('Choose Principessa or Principe first'));
      const frame=$('iframe[name="backendFrame"]');
      if(!frame) return reject(new Error('Backend frame missing'));
      const form=document.createElement('form');
      form.method='POST'; form.action=API_URL; form.target='backendFrame'; form.style.display='none';
      Object.entries({action,actor:a,payload:JSON.stringify(payload||{})}).forEach(([k,v])=>{
        const i=document.createElement('input'); i.type='hidden'; i.name=k; i.value=v; form.appendChild(i);
      });
      document.body.appendChild(form); form.submit(); form.remove();
      setTimeout(resolve,900);
    });
  }

  async function getState(){
    const res=await jsonp({action:'state'});
    if(!res?.ok) throw new Error(res?.error || 'Could not load trip data');
    return res.state || {};
  }

  function resetMeta(){ meta={}; }

  function captureCurrent(){
    const h=heading();
    const input=$('#wizardInput');
    if(!input) return;
    if(/country or place/i.test(h)) meta.otherLocation=input.value;
    else if(/Which city or area/i.test(h)) meta.city=input.value;
    else if(/trip start/i.test(h)) meta.start=input.value;
    else if(/When did it end/i.test(h)) meta.end=input.value;
  }

  function validMeta(){
    const location=meta.location || '';
    const otherLocation=location==='Other' ? String(meta.otherLocation||'').trim() : '';
    return {
      location,
      otherLocation,
      city:String(meta.city||'').trim(),
      start:String(meta.start||'').trim(),
      end:String(meta.end||'').trim()
    };
  }

  async function createPlanFromMainWizard(budget){
    if(creating) return;
    const a=actor();
    const m=validMeta();
    if(!a){ toast('Choose a profile first','warn'); return; }
    if(!m.location || !m.city || !m.start || !m.end || (m.location==='Other' && !m.otherLocation)){
      toast('Trip details are incomplete. Go back and check location and dates.','warn');
      return;
    }

    creating=true;
    const body=$('#wizardBody');
    if(body) body.innerHTML='<div class="bridge15-saving"><strong>Saving your current trip…</strong><span>One moment.</span></div>';

    try{
      const before=await getState();
      const beforeIds=new Set((before.plans||[]).map(p=>p.id));
      await post('savePlan',{meta:m,budget:String(budget)});

      let created=null;
      for(let i=0;i<10 && !created;i++){
        await sleep(i===0?650:350);
        const s=await getState();
        created=(s.plans||[]).find(p=>!beforeIds.has(p.id) && p.createdBy===a && p?.meta?.city===m.city && p?.meta?.start===m.start && p?.meta?.end===m.end) || null;
      }
      if(!created) throw new Error('The trip was saved, but Twogether could not open it yet. Refresh once and try again.');

      showScope(created);
      window.dispatchEvent(new Event('focus'));
    }catch(err){
      toast(err.message || 'Could not save the trip','warn');
      $('#restartWizard')?.click();
    }finally{
      creating=false;
    }
  }

  function showScope(plan){
    const body=$('#wizardBody'); if(!body)return;
    const city=plan?.meta?.city || 'this trip';
    const step=$('#wizardStep'); if(step) step.textContent='Trip saved';
    const progress=$('#wizardProgress'); if(progress) progress.style.width='100%';
    body.innerHTML=`<div class="question-stage bridge15-scope-stage">
      <h2>What do you want to log now?</h2>
      <p><strong>${esc(city)}</strong> is now under Current Trips. You can stop here or add expenses now.</p>
      <div class="bridge15-scope">
        <button class="trip-pick" type="button" data-bridge15-scope="budget"><span class="pick-icon">✓</span><div><strong>Budget only for now</strong><small>Add expenses later from Current Trips.</small></div></button>
        <button class="trip-pick" type="button" data-bridge15-scope="some"><span class="pick-icon">＋</span><div><strong>Log some expenses</strong><small>Choose only the categories you want to add now.</small></div></button>
        <button class="trip-pick" type="button" data-bridge15-scope="all"><span class="pick-icon">→</span><div><strong>Log all expenses</strong><small>Continue through the full trip expense flow.</small></div></button>
      </div>
    </div>`;

    body.querySelectorAll('[data-bridge15-scope]').forEach(btn=>btn.addEventListener('click',()=>{
      const mode=btn.dataset.bridge15Scope;
      if(mode==='budget'){
        $('#restartWizard')?.click();
        setTimeout(()=>$('#twCurrentTripsSection')?.scrollIntoView({behavior:'smooth',block:'start'}),120);
        return;
      }
      launchPlanExpenses(plan.id,mode);
    }));
  }

  async function launchPlanExpenses(planId,mode){
    window.dispatchEvent(new Event('focus'));
    let actual=null;
    for(let i=0;i<36 && !actual;i++){
      actual=$(`#budgetPlanGrid [data-v5-plan="${window.CSS?.escape?CSS.escape(planId):planId}"] [data-v5-actual]`);
      if(!actual) await sleep(140);
    }
    if(!actual){ toast('The trip is saved. Use Add expenses under Current Trips.','warn'); return; }
    actual.click();

    const wanted=mode==='some'?'partial':'full';
    for(let i=0;i<30;i++){
      await sleep(100);
      const btn=$(`[data-v5-actual-mode="${wanted}"]`);
      if(btn){ btn.click(); return; }
    }
    toast('The trip is saved. Open it from Current Trips to add expenses.','warn');
  }

  function enhanceAccommodation20(){
    const h=heading();
    const input=$('#wizardInput');
    if(!/How much was accommodation/i.test(h) || !input) return;
    const wrap=input.closest('.money-input-wrap');
    if(!wrap) return;
    let calc=$('#bridge15Accommodation20');
    if(!calc){
      calc=document.createElement('div');
      calc.id='bridge15Accommodation20';
      calc.className='bridge15-20';
      wrap.insertAdjacentElement('afterend',calc);
    }
    const update=()=>{ calc.innerHTML=`20% = <strong>${money(n(input.value)*.20)}</strong>`; };
    if(input.dataset.bridge15Calc!=='1'){
      input.dataset.bridge15Calc='1';
      input.addEventListener('input',update);
    }
    update();
  }

  function install(){
    document.addEventListener('click',e=>{
      const newTrip=e.target.closest?.('[data-trip-pick="new"]');
      if(newTrip){ resetMeta(); return; }

      const choice=e.target.closest?.('#wizardBody [data-choice]');
      if(choice && /Where was this trip/i.test(heading())) meta.location=choice.dataset.choice || '';

      const target=e.target.closest?.('#wizardBody [data-wizard-next], #wizardBody [data-skip-budget]');
      if(!target) return;

      const h=heading();
      if(!/ideal total budget/i.test(h)){
        if(target.matches('[data-wizard-next]')) captureCurrent();
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();
      const input=$('#wizardInput');
      const skipped=target.matches('[data-skip-budget]');
      const raw=String(input?.value||'').trim();
      if(!skipped && (!raw || !Number.isFinite(Number(raw.replace(',','.'))))){ toast('Enter a valid budget, or choose Skip budget.','warn'); return; }
      createPlanFromMainWizard(skipped ? '0' : raw);
    },true);

    document.addEventListener('click',e=>{
      if(e.target.closest?.('#restartWizard')) resetMeta();
    },false);

    const body=$('#wizardBody');
    if(body){ new MutationObserver(()=>requestAnimationFrame(enhanceAccommodation20)).observe(body,{childList:true,subtree:true}); }
    enhanceAccommodation20();
  }

  document.addEventListener('DOMContentLoaded',install);
})();
