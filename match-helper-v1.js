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

  let lastOpenTripId = '';
  let session = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
  const n = value => {
    const x = Number(String(value ?? '').replace(',','.'));
    return Number.isFinite(x) ? x : 0;
  };
  const money = value => '€' + n(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});

  function actor(){
    const fromBody = document.body.dataset.actor || '';
    if(ACTORS.includes(fromBody)) return fromBody;
    try{
      const saved = localStorage.getItem(ACTOR_KEY) || '';
      return ACTORS.includes(saved) ? saved : '';
    }catch{}
    return '';
  }

  function otherActor(name){
    return name === 'Principessa' ? 'Principe' : 'Principessa';
  }

  function toast(message,tone='ok'){
    const el = document.getElementById('toast');
    if(!el) return;
    el.textContent = message;
    el.className = 'toast show ' + tone;
    clearTimeout(el._matchTimer);
    el._matchTimer = setTimeout(() => { el.className = 'toast'; }, 2800);
  }

  function jsonp(params={}){
    return new Promise((resolve,reject) => {
      if(!API_URL) return reject(new Error('Backend URL missing'));
      const cb = '__twogether_match_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(() => done(new Error('Sync timed out')), 12000);
      function done(err,data){
        clearTimeout(timer);
        try{ delete window[cb]; }catch{}
        script.remove();
        err ? reject(err) : resolve(data);
      }
      window[cb] = data => done(null,data);
      const q = new URLSearchParams({...params,callback:cb,_:String(Date.now())});
      script.src = API_URL + (API_URL.includes('?') ? '&' : '?') + q.toString();
      script.onerror = () => done(new Error('Could not reach Apps Script'));
      document.head.appendChild(script);
    });
  }

  function postSubmission(name,tripId,submission){
    return new Promise((resolve,reject) => {
      if(!API_URL) return reject(new Error('Backend not configured'));
      const frame = document.querySelector('iframe[name="backendFrame"]');
      if(!frame) return reject(new Error('Backend frame missing'));

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = API_URL;
      form.target = 'backendFrame';
      form.style.display = 'none';
      const fields = {
        action:'saveSubmission',
        actor:name,
        payload:JSON.stringify({tripId,submission})
      };
      Object.entries(fields).forEach(([key,value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = value;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
      form.remove();
      setTimeout(resolve,1000);
    });
  }

  function mismatchSteps(trip,name){
    const own = trip?.submissions?.[name];
    const otherName = otherActor(name);
    const other = trip?.submissions?.[otherName];
    if(!own || !other) return [];
    const out = [];

    MONEY_FIELDS.forEach(key => {
      const amountDiff = Math.abs(n(own[key]) - n(other[key])) > .01;
      const certaintyDiff = !!own?.uncertain?.[key] !== !!other?.uncertain?.[key];
      if(amountDiff){
        out.push({key,label:MONEY_LABELS[key],type:'money',amountDiff:true,certaintyDiff});
      }else if(certaintyDiff){
        out.push({key,label:MONEY_LABELS[key],type:'certainty',amountDiff:false,certaintyDiff:true});
      }
    });

    if(String(own.otherNote||'').trim().toLowerCase() !== String(other.otherNote||'').trim().toLowerCase()){
      out.push({key:'otherNote',label:'Other expense note',type:'text'});
    }
    return out;
  }

  function installStyles(){
    if(document.getElementById('matchHelperStyles')) return;
    const style = document.createElement('style');
    style.id = 'matchHelperStyles';
    style.textContent = `
      .match-helper-modal{display:none;position:fixed;inset:0;z-index:180;place-items:center;padding:20px}
      .match-helper-modal.show{display:grid}
      .match-helper-backdrop{position:absolute;inset:0;background:rgba(40,34,30,.54);backdrop-filter:blur(7px)}
      .match-helper-card{position:relative;width:min(650px,100%);max-height:min(760px,calc(100vh - 40px));overflow:auto;background:var(--card,#fffefa);border:1px solid var(--line,#e6ded4);border-radius:28px;box-shadow:0 24px 80px rgba(60,45,35,.18);padding:24px}
      .match-helper-close{position:absolute;right:17px;top:14px;border:0;background:transparent;font-size:28px;cursor:pointer;color:var(--muted,#79746d)}
      .match-helper-kicker{font-size:11.5px;letter-spacing:.09em;text-transform:uppercase;font-weight:800;color:var(--accent,#8d6e63)}
      .match-helper-card h2{font-family:inherit;margin:8px 40px 5px 0;font-size:32px;font-weight:600}
      .match-helper-sub{color:var(--muted,#79746d);margin:0 0 20px;line-height:1.5}
      .match-helper-progress{height:5px;background:#eee7df;border-radius:999px;overflow:hidden;margin:12px 0 24px}
      .match-helper-progress span{display:block;height:100%;background:var(--accent,#8d6e63);border-radius:999px;transition:width .2s ease}
      .match-reference{background:var(--sage-soft,#e8eee5);border:1px solid rgba(90,110,85,.12);border-radius:18px;padding:15px 16px;margin:0 0 14px}
      .match-reference span{display:block;font-size:12px;color:var(--muted,#79746d);margin-bottom:4px}
      .match-reference strong{display:block;font-size:22px;font-weight:700}
      .match-reference small{display:block;margin-top:6px;color:var(--muted,#79746d)}
      .match-helper-input{display:flex;align-items:center;background:#fff;border:1px solid #dfd7ce;border-radius:18px;overflow:hidden}
      .match-helper-input>span{padding-left:17px;font-size:20px;color:var(--muted,#79746d)}
      .match-helper-input input,.match-helper-input textarea{width:100%;border:0;outline:0;background:transparent;padding:16px 17px;font:inherit;font-size:18px;resize:vertical}
      .match-helper-input textarea{min-height:95px}
      .match-certainty{display:flex;gap:9px;margin-top:11px}
      .match-certainty button{border:1px solid var(--line,#e6ded4);background:#fff;padding:9px 13px;border-radius:999px;cursor:pointer}
      .match-certainty button.active{background:var(--sage-soft,#e8eee5);font-weight:800}
      .match-use-answer{width:100%;border:1px dashed #d4c9bd;background:#faf7f2;border-radius:14px;padding:10px 12px;margin-top:11px;cursor:pointer;color:var(--muted,#79746d)}
      .match-helper-actions{display:flex;justify-content:space-between;gap:10px;margin-top:22px}
      .match-helper-review{display:grid;gap:9px}
      .match-review-row{display:grid;grid-template-columns:1fr auto;gap:12px;background:#f6f2ed;border-radius:14px;padding:12px 14px;align-items:center}
      .match-review-row span{color:var(--muted,#79746d);font-size:12px}
      .match-review-row strong{text-align:right}
      .match-review-row small{grid-column:1/-1;color:var(--muted,#79746d)}
      .match-helper-note{font-size:12px;color:var(--muted,#79746d);margin-top:12px}
    `;
    document.head.appendChild(style);
  }

  function ensureModal(){
    installStyles();
    let modal = document.getElementById('matchHelperModal');
    if(modal) return modal;
    modal = document.createElement('div');
    modal.id = 'matchHelperModal';
    modal.className = 'match-helper-modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML = '<div class="match-helper-backdrop" data-match-close></div><div class="match-helper-card" role="dialog" aria-modal="true"><button class="match-helper-close" type="button" data-match-close>×</button><div id="matchHelperBody"></div></div>';
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-match-close]').forEach(el => el.addEventListener('click',closeResolver));
    return modal;
  }

  function closeResolver(){
    session = null;
    const modal = document.getElementById('matchHelperModal');
    modal?.classList.remove('show');
    modal?.setAttribute('aria-hidden','true');
  }

  function referenceValue(step,submission){
    if(step.type === 'money'){
      return `${money(submission?.[step.key])}${submission?.uncertain?.[step.key] ? ' · estimate' : ' · exact'}`;
    }
    if(step.type === 'certainty') return submission?.uncertain?.[step.key] ? 'Estimate' : 'Exact';
    return String(submission?.[step.key] || '—');
  }

  function rawOtherValue(step){
    const other = session.otherSubmission;
    if(step.type === 'money') return String(other?.[step.key] ?? '');
    if(step.type === 'certainty') return !!other?.uncertain?.[step.key];
    return String(other?.[step.key] || '');
  }

  function renderResolver(){
    if(!session) return;
    const modal = ensureModal();
    const root = document.getElementById('matchHelperBody');
    if(!root) return;

    const totalSteps = session.steps.length;
    if(session.index >= totalSteps){
      const rows = session.steps.map(step => {
        const newValue = referenceValue(step,session.draft);
        const targetValue = referenceValue(step,session.otherSubmission);
        return `<div class="match-review-row"><div><span>${esc(step.label)}</span><strong>${esc(newValue)}</strong></div><strong>Target: ${esc(targetValue)}</strong></div>`;
      }).join('');
      root.innerHTML = `
        <span class="match-helper-kicker">CHECK YOUR CORRECTIONS</span>
        <h2>Ready to update your version?</h2>
        <p class="match-helper-sub">Only the fields that were different are shown here. Everything that already matched stays unchanged.</p>
        <div class="match-helper-review">${rows}</div>
        <p class="match-helper-note">Saving an edit resets confirmations until both versions match and are confirmed again.</p>
        <div class="match-helper-actions"><button class="btn ghost" type="button" data-match-back>Back</button><button class="btn primary big" type="button" data-match-save>Save corrections</button></div>`;
      root.querySelector('[data-match-back]')?.addEventListener('click',()=>{session.index=Math.max(0,session.index-1);renderResolver();});
      root.querySelector('[data-match-save]')?.addEventListener('click',saveResolver);
      modal.classList.add('show');
      modal.setAttribute('aria-hidden','false');
      return;
    }

    const step = session.steps[session.index];
    const otherValue = referenceValue(step,session.otherSubmission);
    const ownValue = referenceValue(step,session.originalOwn);
    const progress = ((session.index+1)/Math.max(1,totalSteps))*100;
    let control = '';

    if(step.type === 'money'){
      const value = String(session.draft?.[step.key] ?? '');
      const uncertain = !!session.draft?.uncertain?.[step.key];
      control = `
        <div class="match-helper-input"><span>€</span><input id="matchHelperInput" inputmode="decimal" value="${esc(value)}" placeholder="${esc(String(session.otherSubmission?.[step.key] ?? '0.00'))}"></div>
        <div class="match-certainty"><button type="button" data-match-certainty="exact" class="${!uncertain?'active':''}">Exact</button><button type="button" data-match-certainty="estimate" class="${uncertain?'active':''}">Estimate</button></div>
        <button class="match-use-answer" type="button" data-use-other>Use ${esc(session.otherName)}’s answer</button>`;
    }else if(step.type === 'certainty'){
      const uncertain = !!session.draft?.uncertain?.[step.key];
      control = `<div class="match-certainty"><button type="button" data-match-certainty="exact" class="${!uncertain?'active':''}">Exact</button><button type="button" data-match-certainty="estimate" class="${uncertain?'active':''}">Estimate</button></div><button class="match-use-answer" type="button" data-use-other>Use ${esc(session.otherName)}’s answer</button>`;
    }else{
      const value = String(session.draft?.[step.key] || '');
      control = `<div class="match-helper-input"><textarea id="matchHelperInput" placeholder="${esc(String(session.otherSubmission?.[step.key] || ''))}">${esc(value)}</textarea></div><button class="match-use-answer" type="button" data-use-other>Use ${esc(session.otherName)}’s answer</button>`;
    }

    root.innerHTML = `
      <span class="match-helper-kicker">MATCHING · ${session.index+1} OF ${totalSteps}</span>
      <h2>${esc(step.label)}</h2>
      <p class="match-helper-sub">This is one of the answers that does not match. ${esc(session.otherName)}’s answer is shown first as your reference.</p>
      <div class="match-helper-progress"><span style="width:${progress}%"></span></div>
      <div class="match-reference"><span>${esc(session.otherName)} entered</span><strong>${esc(otherValue)}</strong><small>Your current answer: ${esc(ownValue)}</small></div>
      ${control}
      <div class="match-helper-actions"><button class="btn ghost" type="button" data-match-back>${session.index===0?'Cancel':'Back'}</button><button class="btn primary big" type="button" data-match-next>Next</button></div>`;

    const input = root.querySelector('#matchHelperInput');
    if(input){
      input.addEventListener('input',()=>{session.draft[step.key]=input.value;});
      setTimeout(()=>{input.focus(); if(typeof input.select==='function' && step.type==='money') input.select();},0);
    }
    root.querySelectorAll('[data-match-certainty]').forEach(btn => btn.addEventListener('click',()=>{
      session.draft.uncertain = {...(session.draft.uncertain||{})};
      session.draft.uncertain[step.key] = btn.dataset.matchCertainty === 'estimate';
      renderResolver();
    }));
    root.querySelector('[data-use-other]')?.addEventListener('click',()=>{
      if(step.type === 'money'){
        session.draft[step.key] = rawOtherValue(step);
        session.draft.uncertain = {...(session.draft.uncertain||{})};
        session.draft.uncertain[step.key] = !!session.otherSubmission?.uncertain?.[step.key];
      }else if(step.type === 'certainty'){
        session.draft.uncertain = {...(session.draft.uncertain||{})};
        session.draft.uncertain[step.key] = rawOtherValue(step);
      }else{
        session.draft[step.key] = rawOtherValue(step);
      }
      renderResolver();
    });
    root.querySelector('[data-match-back]')?.addEventListener('click',()=>{
      if(session.index===0) closeResolver();
      else {session.index--;renderResolver();}
    });
    root.querySelector('[data-match-next]')?.addEventListener('click',()=>{
      if(step.type === 'money'){
        const value = String(session.draft?.[step.key] ?? '').trim();
        if(!value || !Number.isFinite(Number(value.replace(',','.')))){
          toast('Enter a valid amount first','warn');return;
        }
      }
      session.index++;
      renderResolver();
    });

    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
  }

  async function startResolver(tripId){
    const name = actor();
    if(!name){ toast('Choose your profile first','warn'); return; }
    try{
      const res = await jsonp({action:'state'});
      if(!res?.ok) throw new Error(res?.error || 'Could not load trip');
      const trip = (res.state?.trips || []).find(t => t.id === tripId);
      if(!trip) throw new Error('Trip not found');
      const own = trip?.submissions?.[name];
      const otherName = otherActor(name);
      const other = trip?.submissions?.[otherName];
      if(!own || !other) throw new Error('Both versions need to be logged first');
      const steps = mismatchSteps(trip,name);
      if(!steps.length){ toast('Your calculations already match'); return; }
      session = {
        tripId,
        name,
        otherName,
        steps,
        index:0,
        originalOwn:JSON.parse(JSON.stringify(own)),
        otherSubmission:JSON.parse(JSON.stringify(other)),
        draft:JSON.parse(JSON.stringify(own))
      };
      renderResolver();
    }catch(err){
      toast(err.message || 'Could not open matching','warn');
    }
  }

  async function saveResolver(){
    if(!session) return;
    const btn = document.querySelector('[data-match-save]');
    if(btn) btn.disabled = true;
    try{
      await postSubmission(session.name,session.tripId,session.draft);
      const name = session.name;
      closeResolver();
      toast(`${name}’s corrections were saved`);
    }catch(err){
      toast(err.message || 'Could not save corrections','warn');
      if(btn) btn.disabled = false;
    }
  }

  function decorateDynamicUi(){
    document.querySelectorAll('[data-edit-pick]').forEach(btn => {
      const strong = btn.querySelector('strong');
      const small = btn.querySelector('small');
      if(strong && !strong.dataset.matchDecorated){
        strong.dataset.matchDecorated = '1';
        strong.textContent = strong.textContent.replace(/^Fix your version/, 'Match the differences');
      }
      if(small) small.textContent = 'Only the answers that differ will be asked.';
    });

    const tripRoot = document.getElementById('tripModalBody');
    const edit = tripRoot?.querySelector('[data-edit-own]');
    if(edit && tripRoot.querySelector('.difference-list')){
      edit.dataset.resolveOwn = '1';
      edit.textContent = 'Match the differences';
    }
  }

  document.addEventListener('click',event => {
    const card = event.target.closest?.('[data-open-trip]');
    if(card) lastOpenTripId = card.dataset.openTrip || '';

    const pick = event.target.closest?.('[data-edit-pick]');
    if(pick){
      event.preventDefault();
      event.stopImmediatePropagation();
      startResolver(pick.dataset.editPick);
      return;
    }

    const resolve = event.target.closest?.('[data-resolve-own]');
    if(resolve && lastOpenTripId){
      event.preventDefault();
      event.stopImmediatePropagation();
      startResolver(lastOpenTripId);
    }
  },true);

  const observer = new MutationObserver(decorateDynamicUi);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',()=>{
    ensureModal();
    decorateDynamicUi();
  });
})();
