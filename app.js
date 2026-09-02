(() => {
  const ROWS = 60;
  const months = [
    ['2026-09','Sep 2026'],['2026-10','Oct 2026'],['2026-11','Nov 2026'],['2026-12','Dec 2026'],
    ['2027-01','Jan 2027'],['2027-02','Feb 2027'],['2027-03','Mar 2027'],['2027-04','Apr 2027'],
    ['2027-05','May 2027'],['2027-06','Jun 2027'],['2027-07','Jul 2027'],['2027-08','Aug 2027']
  ];

  const rows = Array.from({length:ROWS},(_,i)=>({
    tripno:String(i+1), start:'', end:'', location:'', city:'',
    accom:'', groceries:'', eat:'', travel:'', fuel:'', tolls:'', other:'',
    totalOverride:'', personOverride:'', you:'', him:''
  }));

  const rentDefs = [
    ['Rent','rent',600],['Utilities + Wi-Fi','utilities',120],['Condo fees','condo',0],
    ['Still-needed travel','stilltravel',180],['Groceries / eating out','food',250]
  ];
  const carDefs = [
    ['Car payment / saving','carpay',250],['Insurance','insurance',90],['Road tax','tax',45],
    ['Fuel','carfuel',120],['Maintenance reserve','maintenance',50]
  ];
  const compareVals = {};
  [...rentDefs,...carDefs].forEach(x=>compareVals[x[1]]=String(x[2]));

  const STORAGE_KEY = 'togetherBudgetWorkbook.v2';

  function n(v){ const x=Number(String(v??'').replace(',','.')); return Number.isFinite(x)?x:0; }
  function money(v){ return '€'+n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }

  function tripTotal(i){
    const r=rows[i];
    if(String(r.totalOverride).trim()!=='') return n(r.totalOverride);
    return ['accom','groceries','eat','travel','fuel','tolls','other'].reduce((s,k)=>s+n(r[k]),0);
  }
  function tripPerson(i){
    const r=rows[i];
    if(String(r.personOverride).trim()!=='') return n(r.personOverride);
    return tripTotal(i)/2;
  }

  function saveState(){
    try{ localStorage.setItem(STORAGE_KEY,JSON.stringify({rows,compareVals})); }catch{}
  }
  function restoreState(){
    try{
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
      if(!saved) return;
      if(Array.isArray(saved.rows)) saved.rows.slice(0,ROWS).forEach((src,i)=>Object.assign(rows[i],src||{}));
      Object.assign(compareVals,saved.compareVals||{});
    }catch{}
  }

  function buildTrip(){
    const body=document.getElementById('tripBody');
    body.innerHTML='';
    for(let i=0;i<ROWS;i++){
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td><input inputmode="numeric" class="cell-input" data-r="${i}" data-k="tripno"></td>
        <td><input class="cell-date" type="date" data-r="${i}" data-k="start"></td>
        <td><input class="cell-date" type="date" data-r="${i}" data-k="end"></td>
        <td><select class="cell-select" data-r="${i}" data-k="location"><option value=""></option><option>Italy</option><option>Netherlands</option><option>Portugal</option><option>Other</option></select></td>
        <td><input class="cell-input" data-r="${i}" data-k="city"></td>
        <td><input inputmode="decimal" class="cell-input money" data-r="${i}" data-k="accom"></td>
        <td><input inputmode="decimal" class="cell-input money" data-r="${i}" data-k="groceries"></td>
        <td><input inputmode="decimal" class="cell-input money" data-r="${i}" data-k="eat"></td>
        <td><input inputmode="decimal" class="cell-input money" data-r="${i}" data-k="travel"></td>
        <td><input inputmode="decimal" class="cell-input money" data-r="${i}" data-k="fuel"></td>
        <td><input inputmode="decimal" class="cell-input money" data-r="${i}" data-k="tolls"></td>
        <td><input inputmode="decimal" class="cell-input money" data-r="${i}" data-k="other"></td>
        <td><input inputmode="decimal" class="cell-input money formula-cell" data-r="${i}" data-k="totalOverride" placeholder="Auto"></td>
        <td><input inputmode="decimal" class="cell-input money formula-cell" data-r="${i}" data-k="personOverride" placeholder="Auto"></td>
        <td><input inputmode="decimal" class="cell-input money" data-r="${i}" data-k="you"></td>
        <td><input inputmode="decimal" class="cell-input money" data-r="${i}" data-k="him"></td>`;
      body.appendChild(tr);
    }

    body.querySelectorAll('input,select').forEach(el=>{
      el.addEventListener('input',()=>capture(el));
      el.addEventListener('change',()=>capture(el));
    });
  }

  function capture(el){
    const i=Number(el.dataset.r), k=el.dataset.k;
    rows[i][k]=el.value;
    refresh();
    saveState();
  }

  function syncTripInputs(){
    document.querySelectorAll('#tripBody input,#tripBody select').forEach(el=>{
      const i=Number(el.dataset.r), k=el.dataset.k;
      if(document.activeElement===el) return;
      el.value=rows[i][k]??'';
    });
  }

  function buildMonthly(){
    const body=document.getElementById('monthlyBody');
    body.innerHTML='';
    months.forEach(([key,label])=>{
      const tr=document.createElement('tr');
      tr.dataset.month=key;
      tr.innerHTML=`<td style="background:#f8fafc;font-weight:700;padding:0 8px">${label}</td>`+
        Array.from({length:10},()=>`<td class="formula-cell">€0.00</td>`).join('');
      body.appendChild(tr);
    });
  }

  function monthlyStats(){
    return months.map(([key,label])=>{
      const matches=rows.map((r,i)=>({r,i})).filter(x=>x.r.start && x.r.start.slice(0,7)===key);
      const s={accom:0,groceries:0,eat:0,travel:0,fuel:0,tolls:0,other:0,total:0,person:0};
      matches.forEach(({r,i})=>{
        s.accom+=n(r.accom); s.groceries+=n(r.groceries); s.eat+=n(r.eat); s.travel+=n(r.travel);
        s.fuel+=n(r.fuel); s.tolls+=n(r.tolls); s.other+=n(r.other); s.total+=tripTotal(i); s.person+=tripPerson(i);
      });
      return {key,label,trips:matches.length,...s};
    });
  }

  function buildCompareInputs(){
    const make=(container,defs)=>{
      const root=document.getElementById(container); root.innerHTML='';
      defs.forEach(([label,key])=>{
        const row=document.createElement('div'); row.className='r';
        row.innerHTML=`<div>${label}</div><div class="editable"><input inputmode="decimal" data-cmp="${key}"></div>`;
        root.appendChild(row);
      });
      const total=document.createElement('div'); total.className='r';
      total.innerHTML=`<div><b>${container==='rentRows'?'Total with rental':'Total car cost'}</b></div><div class="val formula-cell" id="${container==='rentRows'?'rentTotal':'carTotal'}">€0.00</div>`;
      root.appendChild(total);
      root.querySelectorAll('input').forEach(inp=>{
        inp.value=compareVals[inp.dataset.cmp]??'';
        inp.addEventListener('input',()=>{ compareVals[inp.dataset.cmp]=inp.value; refresh(); saveState(); });
      });
    };
    make('rentRows',rentDefs); make('carRows',carDefs);
  }

  function compareValue(key){ return n(compareVals[key]); }

  function refresh(){
    // Trip totals display as calculated numbers unless user overrides them.
    rows.forEach((r,i)=>{
      const totalInput=document.querySelector(`#tripBody [data-r="${i}"][data-k="totalOverride"]`);
      const personInput=document.querySelector(`#tripBody [data-r="${i}"][data-k="personOverride"]`);
      if(totalInput && document.activeElement!==totalInput){
        if(String(r.totalOverride).trim()==='') totalInput.value=money(tripTotal(i));
      }
      if(personInput && document.activeElement!==personInput){
        if(String(r.personOverride).trim()==='') personInput.value=money(tripPerson(i));
      }
    });

    const stats=monthlyStats();
    document.querySelectorAll('#monthlyBody tr').forEach((tr,idx)=>{
      const s=stats[idx], cells=tr.querySelectorAll('td');
      const vals=[s.trips,s.accom,s.groceries,s.eat,s.travel,s.fuel,s.tolls,s.other,s.total,s.person];
      vals.forEach((v,i)=>cells[i+1].textContent=i===0?String(v):money(v));
    });

    const total=stats.reduce((a,m)=>a+m.total,0);
    const trips=stats.reduce((a,m)=>a+m.trips,0);
    const activeMonths=stats.filter(m=>m.trips>0).length;
    const monthDivisor=activeMonths||12;
    const avg=total/monthDivisor;
    const personTotal=stats.reduce((a,m)=>a+m.person,0);
    const personAvg=personTotal/monthDivisor;

    document.getElementById('kpiTotal').textContent=money(total);
    document.getElementById('kpiMonth').textContent=money(avg);
    document.getElementById('kpiPerson').textContent=money(personAvg);
    document.getElementById('kpiTrip').textContent=money(trips?total/trips:0);
    document.getElementById('kpiTrips').textContent=(trips/monthDivisor).toFixed(1);

    document.getElementById('currentAvg').textContent=money(avg);
    document.getElementById('yourShare').textContent=money(personAvg);
    document.getElementById('hisShare').textContent=money(personAvg);
    document.getElementById('tripAvg').textContent=(trips/monthDivisor).toFixed(1);

    const rent=rentDefs.reduce((a,x)=>a+compareValue(x[1]),0);
    const car=carDefs.reduce((a,x)=>a+compareValue(x[1]),0);
    document.getElementById('rentTotal').textContent=money(rent);
    document.getElementById('carTotal').textContent=money(car);
    document.getElementById('snapCurrent').textContent=money(avg);
    document.getElementById('snapRent').textContent=money(rent);
    document.getElementById('snapBoth').textContent=money(rent+car);
    document.getElementById('snapDiffRent').textContent=money(rent-avg);
    document.getElementById('snapDiffBoth').textContent=money(rent+car-avg);
    document.getElementById('snapPerson').textContent=money((rent+car)/2);
  }

  document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.sheet').forEach(x=>x.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.sheet).classList.add('active');
  }));

  document.getElementById('clearAll').addEventListener('click',()=>{
    if(!confirm('Clear all trip data and reset comparison values?')) return;
    rows.forEach((r,i)=>Object.assign(r,{tripno:String(i+1),start:'',end:'',location:'',city:'',accom:'',groceries:'',eat:'',travel:'',fuel:'',tolls:'',other:'',totalOverride:'',personOverride:'',you:'',him:''}));
    [...rentDefs,...carDefs].forEach(x=>compareVals[x[1]]=String(x[2]));
    buildCompareInputs(); syncTripInputs(); refresh(); saveState();
  });

  document.getElementById('loadDemo').addEventListener('click',()=>{
    Object.assign(rows[0],{start:'2026-09-05',end:'2026-09-12',location:'Italy',city:'Lonato del Garda',accom:'420',groceries:'95',eat:'80',travel:'145',fuel:'55',tolls:'25',you:'410',him:'410'});
    Object.assign(rows[1],{start:'2026-09-20',end:'2026-09-24',location:'Italy',city:'Desenzano',accom:'260',groceries:'70',eat:'65',travel:'120',fuel:'40',tolls:'20'});
    syncTripInputs(); refresh(); saveState();
  });

  document.getElementById('downloadJson').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify({rows,compareVals},null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='together-budget-data.json'; a.click(); URL.revokeObjectURL(a.href);
  });

  restoreState();
  buildTrip();
  buildMonthly();
  buildCompareInputs();
  syncTripInputs();
  refresh();
})();
