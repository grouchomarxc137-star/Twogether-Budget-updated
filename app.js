(() => {
  'use strict';

  const CONFIG = window.TOGETHER_BUDGET_CONFIG || {};
  const API_URL = String(CONFIG.appsScriptUrl || '').trim();
  const SYNC_MS = 3000;
  const DEFAULT_COMPARE = {
    rent: 600, utilities: 120, condo: 0, stilltravel: 180, food: 250,
    carpay: 250, insurance: 90, tax: 45, carfuel: 120, maintenance: 50
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
  let state = { trips: [], compare: {...DEFAULT_COMPARE}, audit: [], updatedAt: '' };
  let wizard = freshDraft();
  let wizardStep = 0;
  let syncTimer = null;
  let syncBusy = false;

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
  const n = v => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
  const money = v => '€' + n(v).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const tripTotal = t => ['accom','groceries','eat','travel','fuel','tolls','other'].reduce((s,k)=>s+n(t[k]),0);
  const tripPerson = t => tripTotal(t)/2;
  const locationLabel = t => t.location === 'Other' ? (t.otherLocation || 'Other') : (t.location || '—');

  function freshDraft(){
    return {
      id:'', location:'', otherLocation:'', city:'', start:'', end:'',
      accom:'', groceries:'', eat:'', travel:'', fuel:'', tolls:'',
      hasOther:'No', other:'', otherNote:'', you:'', him:''
    };
  }

  function toast(message, tone='ok'){
    const el = $('#toast');
    el.textContent = message;
    el.className = 'toast show ' + tone;
    clearTimeout(el._timer);
    el._timer = setTimeout(()=> el.className='toast', 2600);
  }

  function setConnection(text, tone='neutral'){
    const el = $('#connectionStatus');
    if(!el) return;
    el.textContent = text;
    el.dataset.tone = tone;
  }

  function showIdentity(){
    const modal = $('#identityModal');
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
  }

  function chooseIdentity(name){
    actor = name;
    $('#identityModal').classList.remove('show');
    $('#identityModal').setAttribute('aria-hidden','true');
    $('#whoBadge').textContent = name;
    $('#whoBadge').classList.remove('hidden');
    if(API_URL){
      syncNow(true);
      if(syncTimer) clearInterval(syncTimer);
      syncTimer = setInterval(()=>syncNow(false), SYNC_MS);
    } else {
      setConnection('Backend setup needed', 'warn');
      $('#setupNotice').classList.remove('hidden');
    }
    renderWizard();
  }

  function jsonp(params={}){
    return new Promise((resolve,reject)=>{
      if(!API_URL) return reject(new Error('Apps Script URL not configured'));
      const cb = '__tb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(()=>cleanup(new Error('Sync timed out')), 12000);
      function cleanup(err, data){
        clearTimeout(timer);
        delete window[cb];
        script.remove();
        err ? reject(err) : resolve(data);
      }
      window[cb] = data => cleanup(null, data);
      const q = new URLSearchParams({...params, callback:cb, _:Date.now().toString()});
      script.src = API_URL + (API_URL.includes('?') ? '&' : '?') + q.toString();
      script.onerror = () => cleanup(new Error('Could not reach Apps Script'));
      document.head.appendChild(script);
    });
  }

  function postAction(action, payload){
    if(!API_URL){
      toast('Connect the Apps Script backend first.', 'warn');
      return Promise.reject(new Error('Backend not configured'));
    }
    return new Promise(resolve=>{
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = API_URL;
      form.target = 'backendFrame';
      form.style.display = 'none';
      const fields = { action, actor, payload: JSON.stringify(payload || {}) };
      Object.entries(fields).forEach(([k,v])=>{
        const input = document.createElement('input');
        input.type='hidden'; input.name=k; input.value=v;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
      form.remove();
      setTimeout(async()=>{ await syncNow(true); resolve(); }, 850);
    });
  }

  async function syncNow(showErrors=false){
    if(!API_URL || syncBusy) return;
    syncBusy = true;
    setConnection('Syncing…', 'sync');
    try{
      const res = await jsonp({action:'state'});
      if(!res || !res.ok) throw new Error((res && res.error) || 'Sync failed');
      state = normalizeState(res.state);
      renderAll();
      setConnection('Live · synced', 'ok');
    }catch(err){
      setConnection('Offline', 'warn');
      if(showErrors) toast(err.message || 'Could not sync', 'warn');
    }finally{
      syncBusy = false;
    }
  }

  function normalizeState(s){
    return {
      trips: Array.isArray(s?.trips) ? s.trips : [],
      compare: {...DEFAULT_COMPARE, ...(s?.compare || {})},
      audit: Array.isArray(s?.audit) ? s.audit : [],
      updatedAt: s?.updatedAt || ''
    };
  }

  function openSheet(id){
    $$('.tab').forEach(x=>x.classList.toggle('active', x.dataset.sheet===id));
    $$('.sheet').forEach(x=>x.classList.toggle('active', x.id===id));
    if(id==='details') renderDetails();
  }

  const steps = [
    { key:'location', title:'Where was this trip?', help:'Choose the main country/location.', type:'choice', options:['Italy','Netherlands','Portugal','Other'] },
    { key:'otherLocation', title:'What location was it?', help:'Type the country or place.', type:'text', placeholder:'e.g. Tunisia', when:d=>d.location==='Other' },
    { key:'city', title:'Which city or area?', help:'This can be a city, town or area.', type:'text', placeholder:'e.g. Lonato del Garda' },
    { key:'start', title:'When did the trip start?', help:'Pick the first day.', type:'date' },
    { key:'end', title:'When did it end?', help:'Pick the last day.', type:'date' },
    { key:'accom', title:'How much was accommodation?', help:'Airbnb, hotel, apartment, etc.', type:'money' },
    { key:'groceries', title:'How much did you spend on groceries?', help:'Food and household shopping for the trip.', type:'money' },
    { key:'eat', title:'How much on eating out?', help:'Restaurants, takeaway, cafés.', type:'money' },
    { key:'travel', title:'How much on flights or trains?', help:'Enter 0 if none.', type:'money' },
    { key:'fuel', title:'How much on fuel?', help:'Enter 0 if none.', type:'money' },
    { key:'tolls', title:'How much on tolls or parking?', help:'Enter 0 if none.', type:'money' },
    { key:'hasOther', title:'Any other expenses?', help:'Anything not covered above?', type:'choice', options:['No','Yes'] },
    { key:'other', title:'How much were the other expenses?', help:'Enter the combined amount.', type:'money', when:d=>d.hasOther==='Yes' },
    { key:'otherNote', title:'What were those other expenses?', help:'Optional short note.', type:'text', placeholder:'e.g. museum tickets', optional:true, when:d=>d.hasOther==='Yes' },
    { key:'you', title:'How much did Principessa pay?', help:'Optional — useful for splitting costs.', type:'money', optional:true },
    { key:'him', title:'How much did Principe pay?', help:'Optional — useful for splitting costs.', type:'money', optional:true },
    { key:'review', title:'Ready to save this trip?', type:'review' }
  ];

  function visibleSteps(){ return steps.filter(s=>!s.when || s.when(wizard)); }
  function currentStep(){ return visibleSteps()[Math.min(wizardStep, visibleSteps().length-1)]; }

  function renderWizard(){
    const body = $('#wizardBody');
    if(!body) return;
    const vis = visibleSteps();
    if(wizardStep >= vis.length) wizardStep = vis.length-1;
    const s = currentStep();
    const index = vis.indexOf(s);
    $('#wizardStep').textContent = s.type==='review' ? 'Review' : `Question ${index+1} of ${vis.length-1}`;
    $('#wizardProgress').style.width = `${Math.max(8, ((index+1)/vis.length)*100)}%`;

    let control='';
    if(s.type==='choice'){
      control = `<div class="choice-grid">${s.options.map(opt=>`<button type="button" class="choice ${wizard[s.key]===opt?'selected':''}" data-choice="${esc(opt)}">${esc(opt)}</button>`).join('')}</div>`;
    } else if(s.type==='date'){
      control = `<div class="field-wrap"><input class="big-input" id="wizardInput" type="date" value="${esc(wizard[s.key])}"></div>`;
    } else if(s.type==='money'){
      control = `<div class="money-input-wrap"><span>€</span><input class="big-input money-field" id="wizardInput" inputmode="decimal" placeholder="0.00" value="${esc(wizard[s.key])}"></div>`;
    } else if(s.type==='text'){
      control = `<div class="field-wrap"><input class="big-input" id="wizardInput" type="text" autocomplete="off" placeholder="${esc(s.placeholder||'')}" value="${esc(wizard[s.key])}"></div>`;
    } else if(s.type==='review'){
      control = reviewMarkup();
    }

    body.innerHTML = `
      <div class="question-stage">
        <div class="question-icon">${stepIcon(s)}</div>
        <h2>${esc(s.title)}</h2>
        ${s.help ? `<p>${esc(s.help)}</p>` : ''}
        ${control}
        <div class="wizard-actions">
          <button type="button" class="btn ghost" id="wizardBack" ${wizardStep===0?'disabled':''}>Back</button>
          ${s.type==='review'
            ? `<button type="button" class="btn primary big" id="saveTrip" ${API_URL?'':'disabled'}>Save trip</button>`
            : s.type==='choice'
              ? ''
              : `<button type="button" class="btn primary big" id="wizardNext">Continue</button>`}
        </div>
        ${!API_URL && s.type==='review' ? `<div class="inline-warning">Apps Script is not connected yet, so saving is disabled until you add the Web App URL.</div>` : ''}
      </div>`;

    const back = $('#wizardBack');
    if(back) back.addEventListener('click',()=>{ wizardStep=Math.max(0,wizardStep-1); renderWizard(); });

    $$('.choice', body).forEach(btn=>btn.addEventListener('click',()=>{
      wizard[s.key]=btn.dataset.choice;
      if(s.key==='hasOther' && wizard.hasOther==='No'){ wizard.other=''; wizard.otherNote=''; }
      setTimeout(()=>{ wizardStep++; renderWizard(); }, 120);
    }));

    const input = $('#wizardInput');
    if(input){
      input.focus();
      input.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault(); advanceFromInput(s,input);} });
      if(s.type==='date') input.addEventListener('change',()=>{ if(input.value){ wizard[s.key]=input.value; setTimeout(()=>{wizardStep++;renderWizard();},120); } });
    }
    const next = $('#wizardNext');
    if(next) next.addEventListener('click',()=>advanceFromInput(s,input));
    const save = $('#saveTrip');
    if(save) save.addEventListener('click',saveWizardTrip);
  }

  function advanceFromInput(s,input){
    const value = String(input?.value || '').trim();
    if(!s.optional && value==='') return toast('Please answer this question first.', 'warn');
    if(s.type==='money' && value!=='' && !Number.isFinite(Number(value.replace(',','.')))) return toast('Enter a valid amount.', 'warn');
    wizard[s.key]=value;
    wizardStep++;
    renderWizard();
  }

  function stepIcon(s){
    const icons={location:'✦',otherLocation:'⌖',city:'⌖',start:'◷',end:'◷',accom:'⌂',groceries:'▣',eat:'◇',travel:'✈',fuel:'◉',tolls:'P',hasOther:'＋',other:'＋',otherNote:'✎',you:'♡',him:'♡',review:'✓'};
    return icons[s.key] || '•';
  }

  function reviewMarkup(){
    const total = tripTotal(wizard);
    const items = [
      ['Location', locationLabel(wizard)], ['City / Area', wizard.city||'—'],
      ['Dates', `${wizard.start||'—'} → ${wizard.end||'—'}`],
      ['Accommodation', money(wizard.accom)], ['Groceries', money(wizard.groceries)],
      ['Eating out', money(wizard.eat)], ['Flights / Train', money(wizard.travel)],
      ['Fuel', money(wizard.fuel)], ['Tolls / Parking', money(wizard.tolls)],
      ['Other', wizard.hasOther==='Yes' ? `${money(wizard.other)}${wizard.otherNote?` · ${esc(wizard.otherNote)}`:''}` : money(0)],
      ['Principessa paid', money(wizard.you)], ['Principe paid', money(wizard.him)]
    ];
    return `<div class="review-card">
      <div class="review-total"><span>Trip total</span><strong>${money(total)}</strong><small>${money(total/2)} each</small></div>
      <div class="review-grid">${items.map(([a,b])=>`<div><span>${esc(a)}</span><strong>${b}</strong></div>`).join('')}</div>
    </div>`;
  }

  async function saveWizardTrip(){
    const btn = $('#saveTrip');
    if(btn){btn.disabled=true;btn.textContent='Saving…';}
    const trip = {...wizard};
    delete trip.hasOther;
    trip.other = wizard.hasOther==='Yes' ? wizard.other : '';
    trip.id = trip.id || '';
    try{
      await postAction('upsertTrip', {trip});
      toast('Trip saved and synced.');
      wizard = freshDraft(); wizardStep = 0; renderWizard();
    }catch(err){
      toast(err.message || 'Could not save trip', 'warn');
      if(btn){btn.disabled=false;btn.textContent='Save trip';}
    }
  }

  function renderRecent(){
    const root = $('#recentTrips');
    if(!root) return;
    const trips = [...state.trips].sort((a,b)=>String(b.updatedAt||b.start).localeCompare(String(a.updatedAt||a.start))).slice(0,4);
    if(!trips.length){
      root.innerHTML='<div class="empty-state"><div>✦</div><strong>No trips yet</strong><span>Your saved trips will appear here.</span></div>';
      return;
    }
    root.innerHTML = trips.map(t=>`<article class="recent-trip">
      <div class="recent-date"><b>${formatShortDate(t.start)}</b><span>${formatShortDate(t.end)}</span></div>
      <div class="recent-main"><strong>${esc(t.city || locationLabel(t))}</strong><span>${esc(locationLabel(t))} · ${esc(t.updatedBy || t.createdBy || '—')}</span></div>
      <div class="recent-cost"><strong>${money(tripTotal(t))}</strong><span>${money(tripPerson(t))} each</span></div>
    </article>`).join('');
  }

  function formatShortDate(v){
    if(!v) return '—';
    const [y,m,d] = v.slice(0,10).split('-');
    if(!y||!m||!d) return v;
    return `${d}/${m}/${y.slice(2)}`;
  }

  function monthlyStats(){
    return MONTHS.map(([key,label])=>{
      const matches = state.trips.filter(t=>t.start && String(t.start).slice(0,7)===key);
      const s={accom:0,groceries:0,eat:0,travel:0,fuel:0,tolls:0,other:0,total:0,person:0};
      matches.forEach(t=>{
        ['accom','groceries','eat','travel','fuel','tolls','other'].forEach(k=>s[k]+=n(t[k]));
        s.total+=tripTotal(t); s.person+=tripPerson(t);
      });
      return {key,label,trips:matches.length,...s};
    });
  }

  function buildMonthlyRows(){
    const body=$('#monthlyBody');
    if(body.children.length) return;
    body.innerHTML=MONTHS.map(([key,label])=>`<tr data-month="${key}"><td>${label}</td>${'<td>€0.00</td>'.repeat(10)}</tr>`).join('');
  }

  function renderMonthly(){
    buildMonthlyRows();
    const stats=monthlyStats();
    $$('#monthlyBody tr').forEach((tr,i)=>{
      const s=stats[i], cells=$$('td',tr);
      const vals=[s.trips,s.accom,s.groceries,s.eat,s.travel,s.fuel,s.tolls,s.other,s.total,s.person];
      vals.forEach((v,j)=>cells[j+1].textContent=j===0?String(v):money(v));
    });
    const total=stats.reduce((a,m)=>a+m.total,0), trips=stats.reduce((a,m)=>a+m.trips,0);
    const active=Math.max(1,stats.filter(m=>m.trips>0).length);
    const avg=total/active, personTotal=stats.reduce((a,m)=>a+m.person,0), personAvg=personTotal/active;
    $('#kpiTotal').textContent=money(total); $('#kpiMonth').textContent=money(avg); $('#kpiPerson').textContent=money(personAvg);
    $('#kpiTrip').textContent=money(trips?total/trips:0); $('#kpiTrips').textContent=(trips/active).toFixed(1);
    $('#currentAvg').textContent=money(avg); $('#yourShare').textContent=money(personAvg); $('#hisShare').textContent=money(personAvg); $('#tripAvg').textContent=(trips/active).toFixed(1);
    return {avg, personAvg};
  }

  function buildCompare(){
    function make(id,defs,totalId,totalLabel){
      const root=$(id); if(root.children.length) return;
      root.innerHTML=defs.map(([label,key])=>`<div class="r"><span>${esc(label)}</span><div class="editable"><input inputmode="decimal" data-cmp="${key}"></div></div>`).join('')+
        `<div class="r total-row"><span><b>${totalLabel}</b></span><div class="val" id="${totalId}">€0.00</div></div>`;
      $$('input',root).forEach(inp=>{
        inp.addEventListener('change',()=>saveCompare(inp));
        inp.addEventListener('keydown',e=>{if(e.key==='Enter'){inp.blur();}});
      });
    }
    make('#rentRows',RENT_DEFS,'rentTotal','Total with rental');
    make('#carRows',CAR_DEFS,'carTotal','Total car cost');
  }

  async function saveCompare(input){
    const key=input.dataset.cmp, value=n(input.value);
    state.compare[key]=value;
    renderCompare();
    try{ await postAction('updateCompare',{key,value}); toast('Shared budget option updated.'); }
    catch{}
  }

  function renderCompare(monthlyResult){
    buildCompare();
    $$('[data-cmp]').forEach(inp=>{ if(document.activeElement!==inp) inp.value=n(state.compare[inp.dataset.cmp]); });
    const rent=RENT_DEFS.reduce((s,[,k])=>s+n(state.compare[k]),0), car=CAR_DEFS.reduce((s,[,k])=>s+n(state.compare[k]),0);
    $('#rentTotal').textContent=money(rent); $('#carTotal').textContent=money(car);
    const avg=(monthlyResult||renderMonthly()).avg;
    $('#snapCurrent').textContent=money(avg); $('#snapRent').textContent=money(rent); $('#snapBoth').textContent=money(rent+car);
    $('#snapDiffRent').textContent=money(rent-avg); $('#snapDiffBoth').textContent=money(rent+car-avg); $('#snapPerson').textContent=money((rent+car)/2);
  }

  function renderDetails(){
    const body=$('#tripBody');
    const trips=[...state.trips].sort((a,b)=>String(b.start||'').localeCompare(String(a.start||'')));
    if(!trips.length){ body.innerHTML='<tr><td colspan="18" class="table-empty">No trips saved yet.</td></tr>'; return; }
    body.innerHTML=trips.map((t,i)=>`<tr data-id="${esc(t.id)}">
      <td>${i+1}</td>
      <td><input type="date" data-k="start" value="${esc(t.start)}"></td>
      <td><input type="date" data-k="end" value="${esc(t.end)}"></td>
      <td><select data-k="location"><option></option>${['Italy','Netherlands','Portugal','Other'].map(x=>`<option ${t.location===x?'selected':''}>${x}</option>`).join('')}</select></td>
      <td><input data-k="otherLocation" value="${esc(t.otherLocation)}"></td>
      <td><input data-k="city" value="${esc(t.city)}"></td>
      ${['accom','groceries','eat','travel','fuel','tolls','other'].map(k=>`<td><input inputmode="decimal" data-k="${k}" value="${esc(t[k])}"></td>`).join('')}
      <td class="calculated">${money(tripTotal(t))}</td><td class="calculated">${money(tripPerson(t))}</td>
      <td><input inputmode="decimal" data-k="you" value="${esc(t.you)}"></td>
      <td><input inputmode="decimal" data-k="him" value="${esc(t.him)}"></td>
      <td class="who-cell"><span>${esc(t.updatedBy||t.createdBy||'—')}</span><button type="button" class="icon-btn delete-trip" title="Delete trip">×</button></td>
    </tr>`).join('');

    $$('tr[data-id]',body).forEach(tr=>{
      $$('input,select',tr).forEach(el=>el.addEventListener('change',()=>updateTripFromRow(tr)));
      $('.delete-trip',tr).addEventListener('click',()=>deleteTrip(tr.dataset.id));
    });
  }

  async function updateTripFromRow(tr){
    const trip=state.trips.find(x=>x.id===tr.dataset.id); if(!trip) return;
    $$('[data-k]',tr).forEach(el=>trip[el.dataset.k]=el.value);
    try{ await postAction('upsertTrip',{trip}); toast('Trip updated and synced.'); }
    catch{ toast('Could not update trip.','warn'); }
  }

  async function deleteTrip(id){
    if(!confirm('Delete this trip for both of you?')) return;
    try{ await postAction('deleteTrip',{id}); toast('Trip deleted.'); }
    catch{ toast('Could not delete trip.','warn'); }
  }

  function renderActivity(){
    const root=$('#activityList'); if(!root) return;
    const items=(state.audit||[]).slice(-6).reverse();
    if(!items.length){root.innerHTML='<div class="activity-empty">No shared activity yet.</div>';return;}
    root.innerHTML=items.map(a=>`<div class="activity-item"><span class="avatar-mini">P</span><div><strong>${esc(a.actor||'Someone')}</strong> ${esc(activityText(a.action))}<small>${esc(formatTime(a.at))}</small></div></div>`).join('');
  }
  function activityText(action){return ({createTrip:'added a trip',updateTrip:'edited a trip',deleteTrip:'deleted a trip',updateCompare:'changed a comparison value'})[action]||'made a change';}
  function formatTime(v){try{return new Date(v).toLocaleString([], {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}catch{return v||'';}}

  function renderAll(){
    const monthly=renderMonthly();
    renderCompare(monthly);
    renderRecent();
    renderActivity();
    if($('#details').classList.contains('active')) renderDetails();
  }

  $$('.tab').forEach(btn=>btn.addEventListener('click',()=>openSheet(btn.dataset.sheet)));
  $('#openDetails').addEventListener('click',()=>openSheet('details'));
  $('#restartWizard').addEventListener('click',()=>{wizard=freshDraft();wizardStep=0;renderWizard();});
  $('#syncNow').addEventListener('click',()=>syncNow(true));
  $('#switchUser').addEventListener('click',showIdentity);
  $$('.identity-choice').forEach(btn=>btn.addEventListener('click',()=>chooseIdentity(btn.dataset.actor)));

  $('#clearAll').addEventListener('click',()=>{
    toast('Shared data can only be deleted trip-by-trip, to avoid accidental loss.', 'warn');
  });
  $('#loadDemo').addEventListener('click',()=>{
    toast('Example mode was removed so it cannot overwrite shared data.', 'warn');
  });
  $('#downloadJson').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='together-budget-backup.json';a.click();URL.revokeObjectURL(a.href);
  });

  buildMonthlyRows(); buildCompare(); renderAll(); renderWizard(); showIdentity();
  if(!API_URL) setConnection('Backend setup needed','warn');
})();
