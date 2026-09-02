(() => {
  const ROWS=60;
  const months=[
    ['2026-09','Sep 2026'],['2026-10','Oct 2026'],['2026-11','Nov 2026'],['2026-12','Dec 2026'],
    ['2027-01','Jan 2027'],['2027-02','Feb 2027'],['2027-03','Mar 2027'],['2027-04','Apr 2027'],
    ['2027-05','May 2027'],['2027-06','Jun 2027'],['2027-07','Jul 2027'],['2027-08','Aug 2027']
  ];
  const rows=Array.from({length:ROWS},(_,i)=>({
    tripno:String(i+1),start:'',end:'',location:'',otherLocation:'',city:'',
    accom:'',groceries:'',eat:'',travel:'',fuel:'',tolls:'',other:'',you:'',him:'',totalOverride:'',personOverride:''
  }));
  const rentDefs=[['Rent','rent',600],['Utilities + Wi-Fi','utilities',120],['Condo fees','condo',0],['Still-needed travel','stilltravel',180],['Groceries / eating out','food',250]];
  const carDefs=[['Car payment / saving','carpay',250],['Insurance','insurance',90],['Road tax','tax',45],['Fuel','carfuel',120],['Maintenance reserve','maintenance',50]];
  const compareVals={}; [...rentDefs,...carDefs].forEach(x=>compareVals[x[1]]=String(x[2]));
  const STORAGE_KEY='togetherBudgetWorkbook.v3';
  const legacyKeys=['togetherBudgetWorkbook.v2','togetherBudgetWorkbook.v1'];
  let wizardIndex=0;
  let draft=blankDraft();

  function blankDraft(){return{start:'',end:'',location:'',otherLocation:'',city:'',accom:'',groceries:'',eat:'',travel:'',fuel:'',tolls:'',hasOther:'No',other:'',you:'',him:''}}
  function n(v){const x=Number(String(v??'').replace(',','.'));return Number.isFinite(x)?x:0}
  function money(v){return '€'+n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
  function displayLocation(r){return r.location==='Other'?(r.otherLocation||'Other'):r.location}
  function tripTotal(i){const r=rows[i];if(String(r.totalOverride).trim()!=='')return n(r.totalOverride);return ['accom','groceries','eat','travel','fuel','tolls','other'].reduce((s,k)=>s+n(r[k]),0)}
  function tripPerson(i){const r=rows[i];if(String(r.personOverride).trim()!=='')return n(r.personOverride);return tripTotal(i)/2}
  function draftTotal(){return ['accom','groceries','eat','travel','fuel','tolls','other'].reduce((s,k)=>s+n(draft[k]),0)}
  function saveState(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({rows,compareVals}))}catch{}}
  function restoreState(){
    try{
      let saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
      if(!saved){for(const k of legacyKeys){saved=JSON.parse(localStorage.getItem(k)||'null');if(saved)break}}
      if(!saved)return;
      if(Array.isArray(saved.rows))saved.rows.slice(0,ROWS).forEach((src,i)=>Object.assign(rows[i],src||{}));
      Object.assign(compareVals,saved.compareVals||{});
    }catch{}
  }
  function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1800)}
  function switchSheet(id){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.sheet===id));document.querySelectorAll('.sheet').forEach(x=>x.classList.toggle('active',x.id===id));if(id==='log')renderWizard()}

  const questions=[
    {key:'start',title:'When did the trip start?',help:'Pick the first day of this trip.',type:'date'},
    {key:'end',title:'When did the trip end?',help:'Pick the last day of this trip.',type:'date'},
    {key:'location',title:'What country was the trip in?',help:'Choose one. Selecting Other will ask you to type it.',type:'choice',options:['Italy','Netherlands','Portugal','Other']},
    {key:'otherLocation',title:'What was the other country or location?',help:'Type the location you want saved.',type:'text',show:()=>draft.location==='Other'},
    {key:'city',title:'Which city or area?',help:'For example: Lonato del Garda, Tilburg, Lisbon…',type:'text'},
    {key:'accom',title:'How much did accommodation cost?',help:'Enter the total for this trip.',type:'money'},
    {key:'groceries',title:'How much did you spend on groceries?',help:'Enter 0 if there were none.',type:'money'},
    {key:'eat',title:'How much did you spend eating out?',help:'Restaurants, takeaway, cafés, etc.',type:'money'},
    {key:'travel',title:'How much were flights or trains?',help:'Enter the total travel-ticket cost.',type:'money'},
    {key:'fuel',title:'How much did you spend on fuel?',help:'Enter 0 if not applicable.',type:'money'},
    {key:'tolls',title:'How much were tolls and parking?',help:'Combine them here.',type:'money'},
    {key:'hasOther',title:'Were there any other expenses?',help:'Choose Yes to add an amount.',type:'choice',options:['No','Yes']},
    {key:'other',title:'How much were the other expenses?',help:'Enter the combined amount.',type:'money',show:()=>draft.hasOther==='Yes'},
    {key:'you',title:'How much did you pay?',help:'Optional — useful for comparing who paid what.',type:'money',optional:true},
    {key:'him',title:'How much did Principe pay?',help:'Optional — leave blank if you do not want to track this.',type:'money',optional:true},
    {key:'review',title:'Review this trip',help:'Check the details before saving.',type:'review'}
  ];
  function visibleQuestions(){return questions.filter(q=>!q.show||q.show())}
  function currentQuestion(){const qs=visibleQuestions();wizardIndex=Math.min(wizardIndex,qs.length-1);return{q:qs[wizardIndex],qs}}
  function moveWizard(dir){const {qs}=currentQuestion();wizardIndex=Math.max(0,Math.min(qs.length-1,wizardIndex+dir));renderWizard()}
  function validateCurrent(){const {q}=currentQuestion();if(q.type==='review')return true;const v=String(draft[q.key]??'').trim();if(q.optional)return true;if(q.type==='money')return v!==''&&n(v)>=0;if(!v){toast('Please answer this question first.');return false}return true}

  function renderWizard(){
    const body=document.getElementById('wizardBody');if(!body)return;
    const {q,qs}=currentQuestion();
    document.getElementById('wizardStep').textContent=q.type==='review'?'Final review':`Question ${wizardIndex+1} of ${qs.length-1}`;
    document.getElementById('wizardProgress').style.width=((wizardIndex+1)/qs.length*100)+'%';
    let control='';
    if(q.type==='date')control=`<input class="wizard-input" id="wizardInput" type="date" value="${draft[q.key]||''}">`;
    if(q.type==='text')control=`<input class="wizard-input" id="wizardInput" type="text" value="${escapeHtml(draft[q.key]||'')}" placeholder="Type your answer">`;
    if(q.type==='money')control=`<input class="wizard-input" id="wizardInput" type="number" min="0" step="0.01" inputmode="decimal" value="${draft[q.key]||''}" placeholder="0.00">`;
    if(q.type==='choice')control=`<div class="choice-grid">${q.options.map(o=>`<button type="button" class="choice ${draft[q.key]===o?'selected':''}" data-choice="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('')}</div>`;
    if(q.type==='review'){
      const pairs=[['Dates',`${draft.start||'—'} → ${draft.end||'—'}`],['Location',draft.location==='Other'?(draft.otherLocation||'Other'):draft.location],['City / Area',draft.city||'—'],['Accommodation',money(draft.accom)],['Groceries',money(draft.groceries)],['Eating Out',money(draft.eat)],['Flights / Train',money(draft.travel)],['Fuel',money(draft.fuel)],['Tolls / Parking',money(draft.tolls)],['Other',money(draft.other)],['You Paid',draft.you===''?'—':money(draft.you)],['Principe Paid',draft.him===''?'—':money(draft.him)]];
      control=`<div class="summary-grid">${pairs.map(([a,b])=>`<div class="summary-item"><div class="summary-label">${a}</div><div class="summary-value">${escapeHtml(String(b))}</div></div>`).join('')}</div><div class="trip-total-box"><span>Trip total</span><span>${money(draftTotal())}</span></div>`;
    }
    body.innerHTML=`<h2 class="question-title">${q.title}</h2><p class="question-help">${q.help}</p>${control}<div class="wizard-actions"><button type="button" class="btn" id="wizardBack" ${wizardIndex===0?'disabled':''}>Back</button><div class="right">${q.type==='review'?'<button type="button" class="btn primary" id="saveTrip">Save Trip</button>':'<button type="button" class="btn primary" id="wizardNext">Continue</button>'}</div></div>`;
    const input=document.getElementById('wizardInput');
    if(input){input.focus({preventScroll:true});input.addEventListener('input',()=>draft[q.key]=input.value);input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(validateCurrent())moveWizard(1)}})}
    body.querySelectorAll('[data-choice]').forEach(btn=>btn.addEventListener('click',()=>{draft[q.key]=btn.dataset.choice;if(q.key==='hasOther'&&draft.hasOther==='No')draft.other='';if(q.key==='location'&&draft.location!=='Other')draft.otherLocation='';moveWizard(1)}));
    document.getElementById('wizardBack').addEventListener('click',()=>moveWizard(-1));
    const next=document.getElementById('wizardNext');if(next)next.addEventListener('click',()=>{if(validateCurrent())moveWizard(1)});
    const save=document.getElementById('saveTrip');if(save)save.addEventListener('click',saveDraftTrip);
  }
  function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  function saveDraftTrip(){
    const i=rows.findIndex(r=>!r.start&&!r.end&&!r.city&&!r.location&&['accom','groceries','eat','travel','fuel','tolls','other'].every(k=>String(r[k]).trim()===''));
    if(i<0){toast('Trip list is full.');return}
    Object.assign(rows[i],{tripno:String(i+1),start:draft.start,end:draft.end,location:draft.location,otherLocation:draft.otherLocation,city:draft.city,accom:draft.accom,groceries:draft.groceries,eat:draft.eat,travel:draft.travel,fuel:draft.fuel,tolls:draft.tolls,other:draft.hasOther==='Yes'?draft.other:'',you:draft.you,him:draft.him,totalOverride:'',personOverride:''});
    saveState();syncTripInputs();refresh();renderRecent();draft=blankDraft();wizardIndex=0;renderWizard();toast('Trip saved');
  }

  function buildTrip(){
    const body=document.getElementById('tripBody');body.innerHTML='';
    for(let i=0;i<ROWS;i++){
      const tr=document.createElement('tr');
      tr.innerHTML=`<td><input class="cell-input" inputmode="numeric" data-r="${i}" data-k="tripno"></td><td><input class="cell-date" type="date" data-r="${i}" data-k="start"></td><td><input class="cell-date" type="date" data-r="${i}" data-k="end"></td><td><select class="cell-select" data-r="${i}" data-k="location"><option value=""></option><option>Italy</option><option>Netherlands</option><option>Portugal</option><option>Other</option></select></td><td><input class="cell-input" data-r="${i}" data-k="otherLocation"></td><td><input class="cell-input" data-r="${i}" data-k="city"></td>${['accom','groceries','eat','travel','fuel','tolls','other'].map(k=>`<td><input class="cell-input money" inputmode="decimal" data-r="${i}" data-k="${k}"></td>`).join('')}<td class="formula-cell" data-total="${i}">${money(0)}</td><td class="formula-cell" data-person="${i}">${money(0)}</td><td><input class="cell-input money" inputmode="decimal" data-r="${i}" data-k="you"></td><td><input class="cell-input money" inputmode="decimal" data-r="${i}" data-k="him"></td>`;
      body.appendChild(tr);
    }
    body.querySelectorAll('input,select').forEach(el=>{el.addEventListener('input',()=>capture(el));el.addEventListener('change',()=>capture(el))});
  }
  function capture(el){const i=Number(el.dataset.r),k=el.dataset.k;rows[i][k]=el.value;if(k==='location'&&el.value!=='Other')rows[i].otherLocation='';saveState();refresh();renderRecent()}
  function syncTripInputs(){document.querySelectorAll('#tripBody input,#tripBody select').forEach(el=>{if(document.activeElement===el)return;el.value=rows[Number(el.dataset.r)][el.dataset.k]??''})}

  function buildMonthly(){const body=document.getElementById('monthlyBody');body.innerHTML='';months.forEach(([key,label])=>{const tr=document.createElement('tr');tr.dataset.month=key;tr.innerHTML=`<td style="background:#f8fafc;font-weight:700;padding:0 8px">${label}</td>`+Array.from({length:10},()=>'<td class="formula-cell">€0.00</td>').join('');body.appendChild(tr)})}
  function monthlyStats(){return months.map(([key,label])=>{const matches=rows.map((r,i)=>({r,i})).filter(x=>x.r.start&&x.r.start.slice(0,7)===key);const s={accom:0,groceries:0,eat:0,travel:0,fuel:0,tolls:0,other:0,total:0,person:0};matches.forEach(({r,i})=>{s.accom+=n(r.accom);s.groceries+=n(r.groceries);s.eat+=n(r.eat);s.travel+=n(r.travel);s.fuel+=n(r.fuel);s.tolls+=n(r.tolls);s.other+=n(r.other);s.total+=tripTotal(i);s.person+=tripPerson(i)});return{key,label,trips:matches.length,...s}})}
  function buildCompareInputs(){const make=(container,defs)=>{const root=document.getElementById(container);root.innerHTML='';defs.forEach(([label,key])=>{const row=document.createElement('div');row.className='r';row.innerHTML=`<div>${label}</div><div class="editable"><input inputmode="decimal" data-cmp="${key}"></div>`;root.appendChild(row)});const total=document.createElement('div');total.className='r';total.innerHTML=`<div><b>${container==='rentRows'?'Total with rental':'Total car cost'}</b></div><div class="val formula-cell" id="${container==='rentRows'?'rentTotal':'carTotal'}">€0.00</div>`;root.appendChild(total);root.querySelectorAll('input').forEach(inp=>{inp.value=compareVals[inp.dataset.cmp]??'';inp.addEventListener('input',()=>{compareVals[inp.dataset.cmp]=inp.value;saveState();refresh()})})};make('rentRows',rentDefs);make('carRows',carDefs)}
  function renderRecent(){const root=document.getElementById('recentTrips');if(!root)return;const used=rows.map((r,i)=>({r,i})).filter(x=>x.r.start||x.r.city||x.r.location||tripTotal(x.i)>0).slice(-5).reverse();root.innerHTML=used.length?used.map(({r,i})=>`<div class="recent-row"><div><b>Trip ${escapeHtml(r.tripno||String(i+1))}</b><div class="muted">${escapeHtml(r.start||'No date')}${r.end?' → '+escapeHtml(r.end):''}</div></div><div><b>${escapeHtml(displayLocation(r)||'No location')}</b><div class="muted">${escapeHtml(r.city||'No city / area')}</div></div><div style="text-align:right"><b>${money(tripTotal(i))}</b><div class="muted">${money(tripPerson(i))} each</div></div></div>`).join(''):'<div class="empty-state">No trips logged yet. Use the questions above to add your first one.</div>'}
  function refresh(){
    rows.forEach((r,i)=>{const a=document.querySelector(`[data-total="${i}"]`),b=document.querySelector(`[data-person="${i}"]`);if(a)a.textContent=money(tripTotal(i));if(b)b.textContent=money(tripPerson(i))});
    const stats=monthlyStats();document.querySelectorAll('#monthlyBody tr').forEach((tr,idx)=>{const s=stats[idx],cells=tr.querySelectorAll('td'),vals=[s.trips,s.accom,s.groceries,s.eat,s.travel,s.fuel,s.tolls,s.other,s.total,s.person];vals.forEach((v,i)=>cells[i+1].textContent=i===0?String(v):money(v))});
    const total=stats.reduce((a,m)=>a+m.total,0),trips=stats.reduce((a,m)=>a+m.trips,0),activeMonths=stats.filter(m=>m.trips>0).length,monthDivisor=activeMonths||12,avg=total/monthDivisor,personTotal=stats.reduce((a,m)=>a+m.person,0),personAvg=personTotal/monthDivisor;
    document.getElementById('kpiTotal').textContent=money(total);document.getElementById('kpiMonth').textContent=money(avg);document.getElementById('kpiPerson').textContent=money(personAvg);document.getElementById('kpiTrip').textContent=money(trips?total/trips:0);document.getElementById('kpiTrips').textContent=(trips/monthDivisor).toFixed(1);
    document.getElementById('currentAvg').textContent=money(avg);document.getElementById('yourShare').textContent=money(personAvg);document.getElementById('hisShare').textContent=money(personAvg);document.getElementById('tripAvg').textContent=(trips/monthDivisor).toFixed(1);
    const rent=rentDefs.reduce((a,x)=>a+n(compareVals[x[1]]),0),car=carDefs.reduce((a,x)=>a+n(compareVals[x[1]]),0);document.getElementById('rentTotal').textContent=money(rent);document.getElementById('carTotal').textContent=money(car);document.getElementById('snapCurrent').textContent=money(avg);document.getElementById('snapRent').textContent=money(rent);document.getElementById('snapBoth').textContent=money(rent+car);document.getElementById('snapDiffRent').textContent=money(rent-avg);document.getElementById('snapDiffBoth').textContent=money(rent+car-avg);document.getElementById('snapPerson').textContent=money((rent+car)/2);renderRecent()
  }

  document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>switchSheet(btn.dataset.sheet)));
  document.getElementById('openDetails').addEventListener('click',()=>switchSheet('details'));
  document.getElementById('restartWizard').addEventListener('click',()=>{if(confirm('Start this trip entry over?')){draft=blankDraft();wizardIndex=0;renderWizard()}});
  document.getElementById('clearAll').addEventListener('click',()=>{if(!confirm('Clear all saved trip data and reset comparison values?'))return;rows.forEach((r,i)=>Object.assign(r,{tripno:String(i+1),start:'',end:'',location:'',otherLocation:'',city:'',accom:'',groceries:'',eat:'',travel:'',fuel:'',tolls:'',other:'',you:'',him:'',totalOverride:'',personOverride:''}));[...rentDefs,...carDefs].forEach(x=>compareVals[x[1]]=String(x[2]));draft=blankDraft();wizardIndex=0;buildCompareInputs();syncTripInputs();saveState();refresh();renderWizard();toast('Everything cleared')});
  document.getElementById('loadDemo').addEventListener('click',()=>{Object.assign(rows[0],{start:'2026-09-05',end:'2026-09-12',location:'Italy',city:'Lonato del Garda',accom:'420',groceries:'95',eat:'80',travel:'145',fuel:'55',tolls:'25',you:'410',him:'410'});Object.assign(rows[1],{start:'2026-09-20',end:'2026-09-24',location:'Other',otherLocation:'Switzerland',city:'Lugano',accom:'260',groceries:'70',eat:'65',travel:'120',fuel:'40',tolls:'20',other:'15'});syncTripInputs();saveState();refresh();toast('Example trips loaded')});
  document.getElementById('downloadJson').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({rows,compareVals},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='together-budget-data.json';a.click();URL.revokeObjectURL(a.href)});

  restoreState();buildTrip();buildMonthly();buildCompareInputs();syncTripInputs();refresh();renderWizard();
})();
