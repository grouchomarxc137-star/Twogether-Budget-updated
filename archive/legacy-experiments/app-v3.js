(() => {
  'use strict';

  const CONFIG = window.TOGETHER_BUDGET_CONFIG || {};
  const API_URL = String(CONFIG.appsScriptUrl || '').trim();
  const SYNC_MS = 3500;

  const DEFAULT_COMPARE = {
    rent: 600, utilities: 120, condo: 0, stilltravel: 180, food: 250,
    carpay: 250, insurance: 90, tax: 45, carfuel: 120, maintenance: 50
  };

  const MONEY_FIELDS = ['accom','groceries','eat','travel','fuel','tolls','other'];
  const MONEY_LABELS = {
    accom:'Accommodation', groceries:'Groceries', eat:'Eating out',
    travel:'Flights / Train', fuel:'Fuel', tolls:'Tolls / Parking', other:'Other'
  };
  const MONTHS = [
    ['2026-09','Sep 2026'],['2026-10','Oct 2026'],['2026-11','Nov 2026'],['2026-12','Dec 2026'],
    ['2027-01','Jan 2027'],['2027-02','Feb 2027'],['2027-03','Mar 2027'],['2027-04','Apr 2027'],
    ['2027-05','May 2027'],['2027-06','Jun 2027'],['2027-07','Jul 2027'],['2027-08','Aug 2027']
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
  let state = {version:2,trips:[],compare:{...DEFAULT_COMPARE},audit:[],updatedAt:''};
  let wizard = freshDraft();
  let wizardStep = 0;
  let wizardTripId = '';
  let syncBusy = false;
  let syncTimer = null;
  let backendV2 = false;
  let lastServerStamp = '';
  let openTripId = '';

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
      location:'', otherLocation:'', city:'', start:'', end:'',
      accom:'', groceries:'', eat:'', travel:'', fuel:'', tolls:'',
      other:'', otherNote:'', paid:'', uncertain:{}
    };
  }

  function toast(msg,tone='ok'){
    const el = $('#toast');
    if(!el) return;
    el.textContent = msg;
    el.className = 'toast show ' + tone;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.className='toast', 2400);
  }

  function locationLabel(s){
    return s?.location === 'Other' ? (s.otherLocation || 'Other') : (s?.location || '—');
  }

  function tripTotalSubmission(s){
    return MONEY_FIELDS.reduce((sum,k)=>sum+n(s?.[k]),0);
  }

  function hasUncertain(s){
    return MONEY_FIELDS.some(k=>s?.uncertain?.[k] === true);
  }

  function normalizeState(s){
    return {
      version:Number(s?.version || 1),
      trips:Array.isArray(s?.trips) ? s.trips : [],
      compare:{...DEFAULT_COMPARE,...(s?.compare || {})},
      audit:Array.isArray(s?.audit) ? s.audit : [],
      updatedAt:s?.updatedAt || ''
    };
  }

  function getSubs(t){
    return {
      Principessa:t?.submissions?.Principessa || null,
      Principe:t?.submissions?.Principe || null
    };
  }

  function differences(t){
    const {Principessa:a,Principe:b} = getSubs(t);
    if(!a || !b) return [];

    const out = [];
    const textFields = [
      ['location','Location'],['otherLocation','Other location'],['city','City / Area'],
      ['start','Start date'],['end','End date']
    ];

    textFields.forEach(([k,label])=>{
      if(String(a[k]||'').trim().toLowerCase() !== String(b[k]||'').trim().toLowerCase()){
        out.push({key:k,label,a:a[k]||'—',b:b[k]||'—',type:'text'});
      }
    });

    MONEY_FIELDS.forEach(k=>{
      const amountDiff = Math.abs(n(a[k])-n(b[k])) > .01;
      const certaintyDiff = !!a?.uncertain?.[k] !== !!b?.uncertain?.[k];
      if(amountDiff){
        out.push({key:k,label:MONEY_LABELS[k],a:money(a[k]),b:money(b[k]),type:'money'});
      }else if(certaintyDiff){
        out.push({
          key:k+'Certainty',
          label:MONEY_LABELS[k] + ' certainty',
          a:a?.uncertain?.[k] ? 'Estimated' : 'Exact',
          b:b?.uncertain?.[k] ? 'Estimated' : 'Exact',
          type:'text'
        });
      }
    });
    return out;
  }

  function effectiveTrip(t){
    const {Principessa:a,Principe:b} = getSubs(t);
    const source = a || b || {};
    const out = {
      id:t.id,
      location:source.location||'', otherLocation:source.otherLocation||'',
      city:source.city||'', start:source.start||'', end:source.end||'',
      uncertain:{}, provisional:!(a&&b), mismatch:false
    };

    if(a && b){
      const latest = String(a.submittedAt||'') >= String(b.submittedAt||'') ? a : b;
      ['location','otherLocation','city','start','end'].forEach(k=>{
        out[k] = latest[k] || a[k] || b[k] || '';
      });
    }

    MONEY_FIELDS.forEach(k=>{
      if(a && b){
        out[k] = (n(a[k]) + n(b[k])) / 2;
        out.uncertain[k] = !!(
          a?.uncertain?.[k] ||
          b?.uncertain?.[k] ||
          Math.abs(n(a[k])-n(b[k])) > .01
        );
      }else{
        out[k] = n(source[k]);
        out.uncertain[k] = !!source?.uncertain?.[k];
      }
    });

    out.mismatch = a && b ? differences(t).length > 0 : false;
    out.estimated = Object.values(out.uncertain).some(Boolean) || out.mismatch;
    out.total = MONEY_FIELDS.reduce((s,k)=>s+n(out[k]),0);
    out.paidPrincipessa = n(a?.paid);
    out.paidPrincipe = n(b?.paid);
    return out;
  }

  function jsonp(params={}){
    return new Promise((resolve,reject)=>{
      if(!API_URL) return reject(new Error('Backend URL missing'));

      const cb = '__tb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
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

  function postAction(action,payload){
    return new Promise((resolve,reject)=>{
      if(!API_URL) return reject(new Error('Backend not configured'));

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = API_URL;
      form.target = 'backendFrame';
      form.style.display = 'none';

      const fields = {action,actor,payload:JSON.stringify(payload||{})};
      Object.entries(fields).forEach(([k,v])=>{
        const input = document.createElement('input');
        input.type='hidden';
        input.name=k;
        input.value=v;
        form.appendChild(input);
      });

      document.body.appendChild(form);
      form.submit();
      form.remove();

      setTimeout(async()=>{
        try{
          await syncNow(true);
          resolve();
        }catch(err){
          reject(err);
        }
      },800);
    });
  }

  async function syncNow(showErrors=false){
    if(!API_URL || syncBusy) return;
    syncBusy = true;
    try{
      const res = await jsonp({action:'state'});
      if(!res?.ok) throw new Error(res?.error || 'Sync failed');

      const next = normalizeState(res.state);
      const nextStamp = next.updatedAt || JSON.stringify({
        trips:next.trips,
        compare:next.compare,
        audit:next.audit
      });

      backendV2 = next.version >= 2;
      $('#backendUpgrade')?.classList.toggle('hidden', backendV2);

      if(nextStamp !== lastServerStamp){
        state = next;
        lastServerStamp = nextStamp;
        renderDataViews();

        if(actor && currentStep()?.type === 'tripChoice'){
          renderWizard();
        }

        if(openTripId && $('#tripModal')?.classList.contains('show')){
          renderTripModal(openTripId);
        }
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

  function chooseIdentity(name){
    actor = name;
    $('#identityModal')?.classList.remove('show');
    $('#identityModal')?.setAttribute('aria-hidden','true');

    wizard = freshDraft();
    wizardStep = 0;
    wizardTripId = '';
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
    return state.trips.filter(t=>!t?.submissions?.[actor] && t?.submissions?.[otherActor()]);
  }

  function startForTrip(id){
    wizard = freshDraft();
    wizardStep = 0;
    wizardTripId = id || '';
    openSheet('log');
    renderWizard();
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function steps(){
    const cityExample =
      wizard.location === 'Italy' ? 'Lonato del Garda' :
      wizard.location === 'Portugal' ? 'Lisbon' :
      wizard.location === 'Netherlands' ? 'Tilburg' :
      'your city or area';

    return [
      {
        key:'tripChoice',
        title:'Which trip are you logging?',
        help:'Start a new trip, or add your version to one the other person already logged.',
        type:'tripChoice'
      },
      {
        key:'location', title:'Where was this trip?', help:'Choose the main country.',
        type:'choice', options:['Italy','Netherlands','Portugal','Other']
      },
      {
        key:'otherLocation', title:'What country or place was it?',
        type:'text', placeholder:'e.g. Tunisia', when:d=>d.location==='Other'
      },
      {
        key:'city', title:'Which city or area?',
        help:`For example: ${cityExample}.`,
        type:'text', placeholder:`e.g. ${cityExample}`
      },
      {key:'start',title:'When did the trip start?',type:'date'},
      {key:'end',title:'When did it end?',type:'date'},
      {
        key:'accom',title:'How much was accommodation?',type:'money',
        help:'If you only know roughly, mark it as uncertain and give your best estimate.'
      },
      {key:'groceries',title:'How much on groceries?',type:'money'},
      {key:'eat',title:'How much on eating out?',type:'money'},
      {key:'travel',title:'How much on flights or trains?',type:'money'},
      {key:'fuel',title:'How much on fuel?',type:'money'},
      {key:'tolls',title:'How much on tolls or parking?',type:'money'},
      {
        key:'other',title:'Any other expenses?',type:'moneyOrNone',
        help:'Add them if there were any, or skip this completely.'
      },
      {
        key:'otherNote',title:'What were the other expenses?',type:'text',
        placeholder:'e.g. museum tickets',optional:true,when:d=>n(d.other)>0
      },
      {
        key:'paid',title:`How much did ${actor || 'you'} pay?`,
        help:`Only your own payment is recorded while you are logged in as ${actor || 'this user'}.`,
        type:'money',optional:true,noUncertain:true
      },
      {key:'review',title:'Ready to save your version?',type:'review'}
    ];
  }

  function visibleSteps(){
    return steps().filter(s=>!s.when || s.when(wizard));
  }

  function currentStep(){
    const v = visibleSteps();
    return v[Math.min(wizardStep,v.length-1)];
  }

  function renderWizard(){
    const body = $('#wizardBody');
    if(!body || !actor) return;

    const vis = visibleSteps();
    if(wizardStep >= vis.length) wizardStep = vis.length-1;
    const s = currentStep();
    const idx = vis.indexOf(s);

    $('#wizardStep').textContent = s.type==='review' ? 'Review' : `Question ${idx+1} of ${vis.length-1}`;
    $('#wizardProgress').style.width = `${Math.max(8,((idx+1)/vis.length)*100)}%`;

    let control = '';

    if(s.type==='tripChoice'){
      const pending = pendingForActor();
      control = `
        <div class="trip-choice-stack">
          <button class="trip-pick new-trip-pick" data-trip-pick="new" type="button">
            <span class="pick-icon">＋</span>
            <div><strong>Start a new trip</strong><small>Neither of you has logged this trip yet</small></div>
          </button>
          ${pending.map(t=>{
            const other = t.submissions[otherActor()];
            return `
              <button class="trip-pick" data-trip-pick="${esc(t.id)}" type="button">
                <span class="pick-icon">↔</span>
                <div>
                  <strong>${esc(locationLabel(other))}${other.city?` · ${esc(other.city)}`:''}</strong>
                  <small>${fmtDate(other.start)} → ${fmtDate(other.end)} · ${otherActor()} already logged this</small>
                </div>
              </button>`;
          }).join('')}
        </div>`;
    }else if(s.type==='choice'){
      control = `<div class="choice-grid">${
        s.options.map(o=>`<button class="choice" data-choice="${esc(o)}" type="button">${esc(o)}</button>`).join('')
      }</div>`;
    }else if(s.type==='date'){
      control = `<div class="field-wrap"><input class="big-input" id="wizardInput" type="date" value="${esc(wizard[s.key])}"></div>`;
    }else if(s.type==='text'){
      control = `<div class="field-wrap"><input class="big-input" id="wizardInput" type="text" placeholder="${esc(s.placeholder||'')}" value="${esc(wizard[s.key])}"></div>`;
    }else if(s.type==='money' || s.type==='moneyOrNone'){
      const uncertain = !!wizard.uncertain[s.key];
      control = `
        <div class="money-mode ${uncertain?'uncertain-mode':''}">
          ${s.type==='moneyOrNone' ? `
            <button type="button" class="choice skip-expense" id="skipOtherExpense">No other expenses</button>
            <div style="height:10px"></div>
          ` : ''}
          <div class="money-input-wrap">
            <span>€</span>
            <input class="big-input money-field" id="wizardInput" inputmode="decimal"
              placeholder="${uncertain?'best estimate':'0.00'}" value="${esc(wizard[s.key])}">
          </div>
          ${s.noUncertain ? '' : `
            <div class="certainty-row">
              <button type="button" class="certainty ${!uncertain?'active':''}" data-certainty="exact">Exact</button>
              <button type="button" class="certainty ${uncertain?'active':''}" data-certainty="uncertain">Not sure · estimate</button>
            </div>
            ${uncertain ? '<div class="estimate-note">~ This amount counts in totals as an estimate, not as an exact value.</div>' : ''}
          `}
        </div>`;
    }else if(s.type==='review'){
      control = reviewMarkup();
    }

    body.innerHTML = `
      <div class="question-stage">
        <div class="question-icon">${stepIcon(s)}</div>
        <h2>${esc(s.title)}</h2>
        ${s.help?`<p>${esc(s.help)}</p>`:''}
        ${control}
        <div class="wizard-actions">
          <button class="btn ghost" id="wizardBack" type="button" ${wizardStep===0?'disabled':''}>Back</button>
          ${s.type==='review'
            ? `<button class="btn primary big" id="saveTrip" type="button" ${backendV2?'':'disabled'}>Save my version</button>`
            : (['choice','tripChoice'].includes(s.type)
              ? ''
              : `<button class="btn primary big" id="wizardNext" type="button">Continue</button>`)
          }
        </div>
        ${s.type==='review' && !backendV2
          ? '<div class="inline-warning">The Apps Script backend needs the new version before this can be saved.</div>'
          : ''
        }
      </div>`;

    $('#wizardBack')?.addEventListener('click',()=>{
      wizardStep = Math.max(0,wizardStep-1);
      renderWizard();
    });

    $$('.trip-pick',body).forEach(btn=>btn.addEventListener('click',()=>{
      wizardTripId = btn.dataset.tripPick === 'new' ? '' : btn.dataset.tripPick;
      wizardStep++;
      renderWizard();
    }));

    $$('.choice[data-choice]',body).forEach(btn=>btn.addEventListener('click',()=>{
      wizard[s.key] = btn.dataset.choice;
      wizardStep++;
      setTimeout(renderWizard,80);
    }));

    $$('.certainty',body).forEach(btn=>btn.addEventListener('click',()=>{
      wizard.uncertain[s.key] = btn.dataset.certainty === 'uncertain';
      renderWizard();
    }));

    $('#skipOtherExpense')?.addEventListener('click',()=>{
      wizard.other = '';
      wizard.otherNote = '';
      wizard.uncertain.other = false;
      wizardStep++;
      renderWizard();
    });

    const input = $('#wizardInput');
    if(input){
      input.focus();

      input.addEventListener('input',()=>{
        if(input.value.trim()==='-' && !s.noUncertain){
          wizard.uncertain[s.key] = true;
          input.value = '';
          toast('Marked uncertain — enter your best estimate.','warn');
        }
      });

      input.addEventListener('keydown',e=>{
        if(e.key==='Enter'){
          e.preventDefault();
          advanceInput(s,input);
        }
      });

      if(s.type==='date'){
        input.addEventListener('change',()=>{
          if(input.value){
            wizard[s.key] = input.value;
            wizardStep++;
            renderWizard();
          }
        });
      }
    }

    $('#wizardNext')?.addEventListener('click',()=>advanceInput(s,input));
    $('#saveTrip')?.addEventListener('click',saveWizard);
  }

  function advanceInput(s,input){
    const v = String(input?.value || '').trim();
    if(!s.optional && !v) return toast('Please answer this question first.','warn');
    if((s.type==='money' || s.type==='moneyOrNone') && v && !Number.isFinite(Number(v.replace(',','.')))){
      return toast('Enter a valid amount or mark it as an estimate.','warn');
    }
    wizard[s.key] = v;
    wizardStep++;
    renderWizard();
  }

  function stepIcon(s){
    return ({
      tripChoice:'↔',location:'✦',otherLocation:'⌖',city:'⌖',start:'◷',end:'◷',
      accom:'⌂',groceries:'▣',eat:'◇',travel:'✈',fuel:'◉',tolls:'P',
      other:'＋',otherNote:'✎',paid:'♡',review:'✓'
    })[s.key] || '•';
  }

  function reviewMarkup(){
    const total = tripTotalSubmission(wizard);
    const est = hasUncertain(wizard);
    return `
      <div class="review-card">
        <div class="review-total ${est?'estimate-total':''}">
          <span>${est?'Estimated trip total':'Trip total'}</span>
          <strong>${est?'~ ':''}${money(total)}</strong>
          <small>${money(total/2)} each</small>
        </div>
        <div class="review-grid">
          <div><span>Location</span><strong>${esc(locationLabel(wizard))}</strong></div>
          <div><span>City</span><strong>${esc(wizard.city||'—')}</strong></div>
          <div><span>Dates</span><strong>${fmtDate(wizard.start)} → ${fmtDate(wizard.end)}</strong></div>
          <div><span>${esc(actor)} paid</span><strong>${money(wizard.paid)}</strong></div>
          ${MONEY_FIELDS.map(k=>`
            <div class="${wizard.uncertain[k]?'uncertain-review':''}">
              <span>${MONEY_LABELS[k]}</span>
              <strong>${wizard.uncertain[k]?'~ ':''}${money(wizard[k])}</strong>
            </div>`).join('')}
        </div>
      </div>`;
  }

  async function saveWizard(){
    if(!backendV2) return toast('Redeploy the new Apps Script backend first.','warn');

    const btn = $('#saveTrip');
    if(btn){
      btn.disabled = true;
      btn.textContent = 'Saving…';
    }

    try{
      await postAction('saveSubmission',{tripId:wizardTripId,submission:wizard});
      toast('Your version was saved ♡');
      wizard = freshDraft();
      wizardTripId = '';
      wizardStep = 0;
      renderWizard();
    }catch(err){
      toast('Could not save the trip.','warn');
      if(btn){
        btn.disabled = false;
        btn.textContent = 'Save my version';
      }
    }
  }

  function renderTripGallery(){
    const root = $('#tripGallery');
    if(!root) return;

    const trips = [...state.trips].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
    if(!trips.length){
      root.innerHTML = '<div class="empty-state gallery-empty"><div>♡</div><strong>No trips yet</strong><span>Your first saved trip will become a card here.</span></div>';
      return;
    }

    root.innerHTML = trips.map(t=>{
      const e = effectiveTrip(t);
      const diff = differences(t);
      const subs = getSubs(t);
      const waiting =
        !subs.Principessa ? 'Waiting for Principessa' :
        !subs.Principe ? 'Waiting for Principe' : '';
      const status =
        waiting || (diff.length ? `${diff.length} difference${diff.length===1?'':'s'}` : 'Matched');
      const cls = waiting ? 'status-wait' : diff.length ? 'status-warn' : 'status-ok';

      return `
        <button class="trip-story-card" data-open-trip="${esc(t.id)}" type="button">
          <div class="trip-card-top">
            <span class="trip-country">${esc(locationLabel(e))}</span>
            <span class="trip-status ${cls}">${esc(status)}</span>
          </div>
          <h3>${esc(e.city||locationLabel(e))}</h3>
          <p>${fmtDate(e.start)} → ${fmtDate(e.end)}</p>
          <div class="trip-card-bottom">
            <strong>${e.estimated?'~ ':''}${money(e.total)}</strong>
            <span>${e.estimated?'estimated total':'total'}</span>
          </div>
          ${!subs[actor] ? '<div class="your-version-needed">Add your version →</div>' : ''}
        </button>`;
    }).join('');

    $$('[data-open-trip]',root).forEach(b=>b.addEventListener('click',()=>openTripModal(b.dataset.openTrip)));
  }

  function openTripModal(id){
    openTripId = id;
    renderTripModal(id);
    $('#tripModal')?.classList.add('show');
    $('#tripModal')?.setAttribute('aria-hidden','false');
  }

  function renderTripModal(id){
    const t = state.trips.find(x=>x.id===id);
    if(!t) return closeTripModal();

    const e = effectiveTrip(t);
    const diff = differences(t);
    const subs = getSubs(t);
    const bothLogged = !!(subs.Principessa && subs.Principe);
    const total = Math.max(e.total,0.01);

    const segments = MONEY_FIELDS
      .map(k=>({k,label:MONEY_LABELS[k],v:n(e[k]),pct:n(e[k])/total*100}))
      .filter(x=>x.v>0)
      .sort((a,b)=>b.v-a.v);

    let deg = 0;
    const colors = ['#8d6e63','#c8909c','#7f927a','#c09a5b','#7f91a8','#a98572','#b7a390'];
    const stops = segments.map((x,i)=>{
      const start = deg;
      deg += x.pct*3.6;
      return `${colors[i%colors.length]} ${start}deg ${deg}deg`;
    }).join(',');

    let statusHtml = '';
    if(!bothLogged){
      const waitingFor = !subs.Principessa ? 'Principessa' : 'Principe';
      statusHtml = `
        <div class="mismatch-box" style="background:#f4ead9;border-color:#e7d2aa">
          <div class="mismatch-title">Waiting for ${waitingFor}</div>
          <p>Only one version has been logged so far. Matching cannot be checked until both of you submit this trip.</p>
        </div>`;
    }else if(diff.length){
      statusHtml = `
        <div class="mismatch-box">
          <div class="mismatch-title">⚠ Your versions don’t fully match</div>
          <p>Talk through these before treating the trip as final.</p>
          ${diff.map(d=>`
            <div class="mismatch-row">
              <strong>${esc(d.label)}</strong>
              <span><b>Principessa:</b> ${esc(d.a)}</span>
              <span><b>Principe:</b> ${esc(d.b)}</span>
            </div>`).join('')}
        </div>`;
    }else{
      statusHtml = '<div class="match-box">✓ Both versions match on the shared trip details.</div>';
    }

    const body = $('#tripModalBody');
    if(!body) return;

    body.innerHTML = `
      <div class="trip-detail-hero">
        <span class="eyebrow">TRIP STORY</span>
        <h2>${esc(e.city||locationLabel(e))}</h2>
        <p>${esc(locationLabel(e))} · ${fmtDate(e.start)} → ${fmtDate(e.end)}</p>
        <div class="detail-total">
          <strong>${e.estimated?'~ ':''}${money(e.total)}</strong>
          <span>${e.estimated?'Estimated total':'Total spent'}</span>
        </div>
      </div>

      <div class="trip-analysis-grid">
        <div class="spend-chart-card">
          <h3>Where the money went</h3>
          ${segments.length ? `
            <div class="donut" style="background:conic-gradient(${stops})">
              <div><strong>${money(e.total)}</strong><span>total</span></div>
            </div>
            <div class="legend">
              ${segments.map((x,i)=>`
                <div>
                  <i style="background:${colors[i%colors.length]}"></i>
                  <span>${esc(x.label)}</span>
                  <strong>${e.uncertain[x.k]?'~ ':''}${money(x.v)}</strong>
                  <small>${x.pct.toFixed(0)}%</small>
                </div>`).join('')}
            </div>` :
            '<div class="empty-state">No spending entered yet.</div>'
          }
        </div>

        <div class="trip-meta-card">
          <h3>At a glance</h3>
          <div class="meta-stat"><span>Biggest category</span><strong>${segments[0]?esc(segments[0].label):'—'}</strong></div>
          <div class="meta-stat"><span>Principessa paid</span><strong>${money(e.paidPrincipessa)}</strong></div>
          <div class="meta-stat"><span>Principe paid</span><strong>${money(e.paidPrincipe)}</strong></div>
          <div class="meta-stat"><span>Data quality</span><strong>${
            !bothLogged ? 'Waiting for both versions' :
            e.estimated ? 'Estimate / needs review' : 'Exact & matched'
          }</strong></div>
          ${!subs[actor] ? '<button class="btn primary full" id="addMyVersion">Add my version</button>' : ''}
        </div>
      </div>

      ${statusHtml}

      <div class="submission-grid">
        ${['Principessa','Principe'].map(name=>{
          const s = subs[name];
          return `
            <div class="submission-card">
              <span>${name}</span>
              ${s ? `
                <strong>${money(tripTotalSubmission(s))}</strong>
                <small>${hasUncertain(s)?'Contains estimates':'Marked exact'} · paid ${money(s.paid)}</small>
              ` : `
                <strong>Not logged yet</strong>
                <small>Waiting for their version</small>
              `}
            </div>`;
        }).join('')}
      </div>`;

    $('#addMyVersion')?.addEventListener('click',()=>{
      closeTripModal();
      startForTrip(id);
    });
  }

  function closeTripModal(){
    openTripId = '';
    $('#tripModal')?.classList.remove('show');
    $('#tripModal')?.setAttribute('aria-hidden','true');
  }

  function monthlyStats(){
    return MONTHS.map(([key,label])=>{
      const trips = state.trips.map(t=>effectiveTrip(t)).filter(e=>e.start?.slice(0,7)===key);
      const s = {trips:trips.length,accom:0,groceries:0,eat:0,travel:0,fuel:0,tolls:0,other:0,total:0,estimated:false};

      trips.forEach(e=>{
        MONEY_FIELDS.forEach(k=>s[k]+=n(e[k]));
        s.total += e.total;
        s.estimated = s.estimated || e.estimated || e.provisional;
      });

      return {key,label,...s};
    });
  }

  function renderMonthly(){
    const body = $('#monthlyBody');
    if(!body) return;

    const stats = monthlyStats();
    body.innerHTML = stats.map(s=>`
      <tr>
        <td>${s.label}</td>
        <td>${s.trips}</td>
        ${MONEY_FIELDS.map(k=>`<td>${money(s[k])}</td>`).join('')}
        <td>${s.estimated?'~ ':''}${money(s.total)}</td>
        <td>${s.estimated?'~ ':''}${money(s.total/2)}</td>
      </tr>`).join('');

    const total = stats.reduce((a,m)=>a+m.total,0);
    const trips = state.trips.length;
    const active = stats.filter(m=>m.trips).length || 1;
    const estimatedTrips = state.trips.map(effectiveTrip).filter(e=>e.estimated || e.provisional).length;

    $('#kpiTotal').textContent = money(total);
    $('#kpiMonth').textContent = money(total/active);
    $('#kpiPerson').textContent = money(total/active/2);
    $('#kpiTrip').textContent = money(trips?total/trips:0);
    $('#kpiTrips').textContent = String(estimatedTrips);
  }

  function renderCompare(){
    const stats = monthlyStats();
    const total = stats.reduce((a,m)=>a+m.total,0);
    const active = stats.filter(m=>m.trips).length || 1;
    const avg = total/active;

    $('#currentAvg').textContent = money(avg);
    $('#yourShare').textContent = money(avg/2);
    $('#hisShare').textContent = money(avg/2);
    $('#tripAvg').textContent = String(state.trips.length);

    const rent = RENT_DEFS.reduce((a,x)=>a+n(state.compare[x[1]]),0);
    const car = CAR_DEFS.reduce((a,x)=>a+n(state.compare[x[1]]),0);

    $('#snapCurrent').textContent = money(avg);
    $('#snapRent').textContent = money(rent);
    $('#snapBoth').textContent = money(rent+car);
    $('#snapDiffRent').textContent = money(rent-avg);
    $('#snapDiffBoth').textContent = money(rent+car-avg);
    $('#snapPerson').textContent = money((rent+car)/2);
    $('#rentTotal').textContent = money(rent);
    $('#carTotal').textContent = money(car);
  }

  function ensureCompareInputs(){
    const make = (id,defs)=>{
      const root = $(id);
      if(!root || root.dataset.ready==='1') return;

      root.innerHTML = defs.map(([label,key])=>`
        <div class="r">
          <span>${esc(label)}</span>
          <div class="editable"><input data-cmp="${key}" inputmode="decimal"></div>
        </div>`).join('') +
        `<div class="r total-row"><span>Total</span><strong id="${id==='#rentRows'?'rentTotal':'carTotal'}">€0.00</strong></div>`;

      root.dataset.ready='1';

      $$('[data-cmp]',root).forEach(inp=>inp.addEventListener('change',async()=>{
        const key = inp.dataset.cmp;
        const val = n(inp.value);
        state.compare[key] = val;
        renderCompare();
        try{
          await postAction('updateCompare',{key,value:val});
        }catch{
          toast('Could not save that comparison value.','warn');
        }
      }));
    };

    make('#rentRows',RENT_DEFS);
    make('#carRows',CAR_DEFS);
  }

  function syncCompareInputValues(){
    $$('[data-cmp]').forEach(inp=>{
      if(document.activeElement !== inp){
        inp.value = state.compare[inp.dataset.cmp] ?? '';
      }
    });
  }

  function renderActivity(){
    const root = $('#activityList');
    if(!root) return;

    const arr = [...state.audit].sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,12);
    if(!arr.length){
      root.innerHTML = '<div class="activity-empty">No shared activity yet.</div>';
      return;
    }

    const labels = {
      addSubmission:'logged their version of a trip',
      updateSubmission:'updated their trip version',
      createTrip:'created a trip',
      updateTrip:'updated a trip',
      deleteTrip:'deleted a trip',
      updateCompare:'changed a comparison value'
    };

    root.innerHTML = arr.map(a=>`
      <div class="activity-item">
        <span class="avatar-mini">P</span>
        <div>
          <strong>${esc(a.actor||'Someone')}</strong> ${esc(labels[a.action]||a.action)}
          <small>${new Date(a.at).toLocaleString()}</small>
        </div>
      </div>`).join('');
  }

  function renderDataViews(){
    ensureCompareInputs();
    syncCompareInputValues();
    renderTripGallery();
    renderMonthly();
    renderCompare();
    renderActivity();
  }

  $$('.tab').forEach(b=>b.addEventListener('click',()=>openSheet(b.dataset.sheet)));
  $$('.identity-choice').forEach(b=>b.addEventListener('click',()=>chooseIdentity(b.dataset.actor)));
  $('#restartWizard')?.addEventListener('click',()=>{
    wizard=freshDraft();
    wizardStep=0;
    wizardTripId='';
    renderWizard();
  });
  $('#brandMark')?.addEventListener('click',showIdentity);
  $$('.brand-mark').forEach(x=>x.addEventListener('click',showIdentity));
  $$('[data-close-trip]').forEach(x=>x.addEventListener('click',closeTripModal));
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeTripModal(); });

  renderDataViews();
  showIdentity();
})();
