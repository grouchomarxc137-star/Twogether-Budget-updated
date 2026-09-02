(() => {
  const app=document.getElementById('app');
  const ROWS=60;
  const months=[
    ['2026-09','Sep 2026'],['2026-10','Oct 2026'],['2026-11','Nov 2026'],['2026-12','Dec 2026'],
    ['2027-01','Jan 2027'],['2027-02','Feb 2027'],['2027-03','Mar 2027'],['2027-04','Apr 2027'],
    ['2027-05','May 2027'],['2027-06','Jun 2027'],['2027-07','Jul 2027'],['2027-08','Aug 2027']
  ];
  const cols=['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P'];
  const rows=Array.from({length:ROWS},(_,i)=>({
    tripno:String(i+1),start:'',end:'',location:'',city:'',
    accom:'',groceries:'',eat:'',travel:'',fuel:'',tolls:'',other:'',
    you:'',him:'',total:'',person:''
  }));
  const formulas=new Map();
  let active={sheet:'trip',addr:'F5',input:null};
  const nameBox=document.getElementById('nameBox');
  const formulaBar=document.getElementById('formulaBar');
  const status=document.getElementById('status');

  const rentDefs=[
    ['Rent','rent',600],['Utilities + Wi-Fi','utilities',120],['Condo fees','condo',0],
    ['Still-needed travel','stilltravel',180],['Groceries / eating out','food',250]
  ];
  const carDefs=[
    ['Car payment / saving','carpay',250],['Insurance','insurance',90],['Road tax','tax',45],
    ['Fuel','carfuel',120],['Maintenance reserve','maintenance',50]
  ];
  const compareVals={};
  [...rentDefs,...carDefs].forEach(x=>compareVals[x[1]]=String(x[2]));

  const STORAGE_KEY='togetherBudgetWorkbook.v1';
  function saveState(){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify({rows,formulas:Object.fromEntries(formulas),compareVals}));}catch{}
  }
  function restoreState(){
    try{
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
      if(!saved)return;
      if(Array.isArray(saved.rows)) saved.rows.slice(0,ROWS).forEach((src,i)=>Object.assign(rows[i],src||{}));
      formulas.clear(); Object.entries(saved.formulas||{}).forEach(([k,v])=>formulas.set(k,v));
      Object.assign(compareVals,saved.compareVals||{});
    }catch{}
  }

  function money(v){return '€'+(Number(v)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
  function n(v){const x=Number(String(v??'').replace(',','.'));return Number.isFinite(x)?x:0}

  function tripAddress(rowIndex,colLetter){return colLetter+(rowIndex+5)}
  function rowFromAddress(addr){
    const m=/^([A-P])(\d+)$/i.exec(addr); if(!m)return null;
    const r=Number(m[2])-5; if(r<0||r>=ROWS)return null;
    return {c:m[1].toUpperCase(),r};
  }
  function rawTripValue(addr){
    if(formulas.has(addr))return formulas.get(addr);
    const p=rowFromAddress(addr); if(!p)return '';
    const r=rows[p.r];
    const map={
      A:'tripno',B:'start',C:'end',D:'location',E:'city',
      F:'accom',G:'groceries',H:'eat',I:'travel',J:'fuel',K:'tolls',L:'other',
      M:'total',N:'person',O:'you',P:'him'
    };
    if(p.c==='M') return r.total || `=SUM(F${p.r+5}:L${p.r+5})`;
    if(p.c==='N') return r.person || `=M${p.r+5}/2`;
    return r[map[p.c]]??'';
  }
  function tripTotal(i){
    const addr=tripAddress(i,'M');
    const raw=rawTripValue(addr);
    if(typeof raw==='string' && raw.startsWith('=')) return formulaEval(raw,[addr]);
    if(raw!=='' && raw!==null && raw!==undefined) return n(raw);
    return ['F','G','H','I','J','K','L'].reduce((s,c)=>s+valueOfEditable(tripAddress(i,c)),0);
  }
  function tripPerson(i){
    const addr=tripAddress(i,'N');
    const raw=rawTripValue(addr);
    if(typeof raw==='string' && raw.startsWith('=')) return formulaEval(raw,[addr]);
    if(raw!=='' && raw!==null && raw!==undefined) return n(raw);
    return tripTotal(i)/2;
  }

  function splitArgs(s){
    const out=[];let cur='',depth=0,q=null;
    for(const ch of s){
      if(q){cur+=ch;if(ch===q)q=null;continue}
      if(ch==='"'||ch==="'"){q=ch;cur+=ch;continue}
      if(ch==='(')depth++; if(ch===')')depth--;
      if(ch===','&&depth===0){out.push(cur.trim());cur=''} else cur+=ch;
    }
    if(cur.trim())out.push(cur.trim()); return out;
  }
  function formulaEval(expr,stack=[]){
    expr=String(expr).trim();
    if(!expr.startsWith('='))return n(expr);
    let body=expr.slice(1).trim();

    body=body.replace(/\b(SUM|AVERAGE|MIN|MAX|COUNT)\s*\(([^()]*)\)/gi,(all,fn,inside)=>{
      const vals=[];
      splitArgs(inside).forEach(part=>{
        const rm=/^([A-P]\d+):([A-P]\d+)$/i.exec(part);
        if(rm){
          const a=rowFromAddress(rm[1]),b=rowFromAddress(rm[2]);
          if(a&&b&&a.c===b.c){
            for(let r=Math.min(a.r,b.r);r<=Math.max(a.r,b.r);r++) vals.push(valueOfEditable(a.c+(r+5),stack));
          }
        } else if(/^[A-P]\d+$/i.test(part)) vals.push(valueOfEditable(part.toUpperCase(),stack));
        else vals.push(n(part));
      });
      const nums=vals.map(n);
      fn=fn.toUpperCase();
      if(fn==='SUM')return String(nums.reduce((a,b)=>a+b,0));
      if(fn==='AVERAGE')return String(nums.length?nums.reduce((a,b)=>a+b,0)/nums.length:0);
      if(fn==='MIN')return String(nums.length?Math.min(...nums):0);
      if(fn==='MAX')return String(nums.length?Math.max(...nums):0);
      if(fn==='COUNT')return String(nums.length);
      return '0';
    });

    body=body.replace(/\b([A-P]\d+)\b/gi,m=>String(valueOfEditable(m.toUpperCase(),stack)));
    if(!/^[0-9+\-*/().%\s]+$/.test(body))return 0;
    try{return n(Function('"use strict";return ('+body+')')())}catch{return 0}
  }
  function valueOfEditable(addr,stack=[]){
    if(stack.includes(addr))return 0;
    const raw=rawTripValue(addr);
    return typeof raw==='string'&&raw.startsWith('=')?formulaEval(raw,[...stack,addr]):n(raw);
  }

  function buildTrip(){
    const body=document.getElementById('tripBody'); body.innerHTML='';
    for(let i=0;i<ROWS;i++){
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td><input inputmode="numeric" class="cell-input" data-r="${i}" data-k="tripno" data-addr="${tripAddress(i,'A')}" value="${i+1}"></td>
        <td><input class="cell-date" type="date" data-r="${i}" data-k="start" data-addr="${tripAddress(i,'B')}"></td>
        <td><input class="cell-date" type="date" data-r="${i}" data-k="end" data-addr="${tripAddress(i,'C')}"></td>
        <td><select class="cell-select" data-r="${i}" data-k="location" data-addr="${tripAddress(i,'D')}">
          <option value=""></option><option>Italy</option><option>Netherlands</option><option>Portugal</option><option>Other</option>
        </select></td>
        <td><input class="cell-input" data-r="${i}" data-k="city" data-addr="${tripAddress(i,'E')}" placeholder=""></td>
        ${['F','G','H','I','J','K','L'].map((c,idx)=>`<td><input inputmode="decimal" class="cell-input money" data-r="${i}" data-money="1" data-addr="${tripAddress(i,c)}"></td>`).join('')}
        <td><input class="cell-input money formula-cell" data-r="${i}" data-money="1" data-k="total" data-addr="${tripAddress(i,'M')}" value="=SUM(F${i+5}:L${i+5})"></td>
        <td><input class="cell-input money formula-cell" data-r="${i}" data-money="1" data-k="person" data-addr="${tripAddress(i,'N')}" value="=M${i+5}/2"></td>
        <td><input inputmode="decimal" class="cell-input money" data-r="${i}" data-k="you" data-addr="${tripAddress(i,'O')}"></td>
        <td><input inputmode="decimal" class="cell-input money" data-r="${i}" data-k="him" data-addr="${tripAddress(i,'P')}"></td>`;
      body.appendChild(tr);
    }
    body.querySelectorAll('input,select').forEach(el=>{
      el.addEventListener('focus',()=>setActive(el.dataset.addr,el));
      el.addEventListener('change',()=>capture(el));
      if(el.tagName==='INPUT')el.addEventListener('input',()=>capture(el,true));
    });
    body.querySelectorAll('.formula-cell').forEach(el=>el.addEventListener('click',()=>setActive(el.dataset.addr,null)));
  }

  function capture(el,soft=false){
    const i=Number(el.dataset.r), k=el.dataset.k, addr=el.dataset.addr;
    if(k){
      rows[i][k]=el.value;
      if(el.value.trim().startsWith('=')) formulas.set(addr,el.value.trim());
      else formulas.delete(addr);
    } else if(el.dataset.money==='1'){
      const c=addr[0];
      const map={F:'accom',G:'groceries',H:'eat',I:'travel',J:'fuel',K:'tolls',L:'other',M:'total',N:'person',O:'you',P:'him'};
      if(map[c]){
        rows[i][map[c]]=el.value;
        if(el.value.trim().startsWith('=')) formulas.set(addr,el.value.trim());
        else formulas.delete(addr);
      }
    }
    if(!soft)status.textContent='Updated';
    refresh();saveState();
  }
  function setActive(addr,input){
    active={sheet:'trip',addr,input}; nameBox.value=addr;
    formulaBar.value=formulas.has(addr)?formulas.get(addr):String(rawTripValue(addr)??'');
    document.querySelectorAll('.selected-cell').forEach(x=>x.classList.remove('selected-cell'));
    const target=input||document.querySelector(`[data-addr="${addr}"]`); if(target)target.classList.add('selected-cell');
  }
  formulaBar.addEventListener('keydown',e=>{
    if(e.key==='Enter'){applyFormula();e.preventDefault()}
  });
  formulaBar.addEventListener('change',applyFormula);
  function applyFormula(){
    const addr=nameBox.value.trim().toUpperCase(), p=rowFromAddress(addr);
    if(!p)return;
    if(['B','C','D'].includes(p.c)){status.textContent='Use the calendar/dropdown directly for this column';return}
    const v=formulaBar.value.trim();
    const r=rows[p.r], map={
      A:'tripno',E:'city',F:'accom',G:'groceries',H:'eat',I:'travel',J:'fuel',
      K:'tolls',L:'other',M:'total',N:'person',O:'you',P:'him'
    };
    if(v.startsWith('=')) formulas.set(addr,v); else formulas.delete(addr);
    if(map[p.c]) r[map[p.c]]=v;
    syncTripInputs();refresh();saveState();status.textContent='Formula/value applied';
  }

  function syncTripInputs(){
    document.querySelectorAll('#tripBody input,#tripBody select').forEach(el=>{
      const i=Number(el.dataset.r),k=el.dataset.k,addr=el.dataset.addr;
      if(document.activeElement===el)return;
      const c=addr[0];
      if(k){
        if(c==='M') el.value=formulas.has(addr)?formulas.get(addr):(rows[i].total||`=SUM(F${i+5}:L${i+5})`);
        else if(c==='N') el.value=formulas.has(addr)?formulas.get(addr):(rows[i].person||`=M${i+5}/2`);
        else el.value=formulas.has(addr)?formulas.get(addr):(rows[i][k]??'');
      } else if(el.dataset.money==='1'){
        const map={F:'accom',G:'groceries',H:'eat',I:'travel',J:'fuel',K:'tolls',L:'other',M:'total',N:'person',O:'you',P:'him'};
        el.value=formulas.has(addr)?formulas.get(addr):(rows[i][map[c]]??'');
      }
    });
  }

  function buildMonthly(){
    const body=document.getElementById('monthlyBody');body.innerHTML='';
    months.forEach(([key,label])=>{
      const tr=document.createElement('tr');
      tr.dataset.month=key;
      tr.innerHTML=`<td style="background:#f8fafc;font-weight:700;padding:0 8px">${label}</td>`+
        Array.from({length:10},(_,i)=>`<td class="formula-cell" data-mi="${i}">€0.00</td>`).join('');
      body.appendChild(tr);
    });
  }
  function monthlyStats(){
    return months.map(([key,label])=>{
      const rs=rows.map((r,i)=>({r,i})).filter(x=>x.r.start&&x.r.start.slice(0,7)===key);
      const sums={accom:0,groceries:0,eat:0,travel:0,fuel:0,tolls:0,other:0,total:0};
      rs.forEach(({i})=>{
        sums.accom+=valueOfEditable(tripAddress(i,'F'));sums.groceries+=valueOfEditable(tripAddress(i,'G'));
        sums.eat+=valueOfEditable(tripAddress(i,'H'));sums.travel+=valueOfEditable(tripAddress(i,'I'));
        sums.fuel+=valueOfEditable(tripAddress(i,'J'));sums.tolls+=valueOfEditable(tripAddress(i,'K'));
        sums.other+=valueOfEditable(tripAddress(i,'L'));sums.total+=tripTotal(i);
      });
      const person=rs.reduce((s,{i})=>s+tripPerson(i),0);
      return {key,label,trips:rs.length,...sums,person};
    });
  }

  function buildCompareInputs(){
    const make=(container,defs)=>{
      const el=document.getElementById(container);el.innerHTML='';
      defs.forEach(([label,key])=>{
        const row=document.createElement('div');row.className='r';
        row.innerHTML=`<div>${label}</div><div class="editable"><input inputmode="decimal" data-cmp="${key}" value="${compareVals[key]}"></div>`;
        el.appendChild(row);
      });
      const total=document.createElement('div');total.className='r';
      total.innerHTML=`<div><b>Total ${container==='rentRows'?'with rental':'car cost'}</b></div><div class="val formula-cell" id="${container==='rentRows'?'rentTotal':'carTotal'}">€0.00</div>`;
      el.appendChild(total);
      el.querySelectorAll('input').forEach(inp=>{
        inp.addEventListener('focus',()=>{active={sheet:'compare',addr:inp.dataset.cmp,input:inp};nameBox.value=inp.dataset.cmp;formulaBar.value=compareVals[inp.dataset.cmp]});
        inp.addEventListener('input',()=>{compareVals[inp.dataset.cmp]=inp.value;refresh();saveState()});
      });
    };
    make('rentRows',rentDefs);make('carRows',carDefs);
  }
  function evalCompare(key){
    const raw=compareVals[key]??'0';
    if(!String(raw).startsWith('='))return n(raw);
    let body=String(raw).slice(1);
    const lookup={rent:'rent',utilities:'utilities',condo:'condo',stilltravel:'stilltravel',food:'food',carpay:'carpay',insurance:'insurance',tax:'tax',carfuel:'carfuel',maintenance:'maintenance'};
    body=body.replace(/\b([A-Za-z_]+)\b/g,m=>lookup[m]?String(evalCompare(lookup[m])):m);
    if(!/^[0-9+\-*/().%\s]+$/.test(body))return 0;
    try{return n(Function('"use strict";return ('+body+')')())}catch{return 0}
  }

  function refresh(){
    rows.forEach((r,i)=>{
      const totalInput=document.querySelector(`[data-addr="${tripAddress(i,'M')}"]`);
      const personInput=document.querySelector(`[data-addr="${tripAddress(i,'N')}"]`);
      if(totalInput && document.activeElement!==totalInput && !rows[i].total && !formulas.has(tripAddress(i,'M')))
        totalInput.value=`=SUM(F${i+5}:L${i+5})`;
      if(personInput && document.activeElement!==personInput && !rows[i].person && !formulas.has(tripAddress(i,'N')))
        personInput.value=`=M${i+5}/2`;
    });
    const stats=monthlyStats();
    document.querySelectorAll('#monthlyBody tr').forEach((tr,idx)=>{
      const s=stats[idx],cells=tr.querySelectorAll('td');
      const vals=[s.trips,s.accom,s.groceries,s.eat,s.travel,s.fuel,s.tolls,s.other,s.total,s.person];
      vals.forEach((v,i)=>cells[i+1].textContent=i===0?String(v):money(v));
    });
    const total=stats.reduce((s,m)=>s+m.total,0), trips=stats.reduce((s,m)=>s+m.trips,0);
    const avg=total/12;
    document.getElementById('kpiTotal').textContent=money(total);
    document.getElementById('kpiMonth').textContent=money(avg);
    document.getElementById('kpiPerson').textContent=money(avg/2);
    document.getElementById('kpiTrip').textContent=money(trips?total/trips:0);
    document.getElementById('kpiTrips').textContent=(trips/12).toFixed(1);

    document.getElementById('currentAvg').textContent=money(avg);
    document.getElementById('yourShare').textContent=money(avg/2);
    document.getElementById('hisShare').textContent=money(avg/2);
    document.getElementById('tripAvg').textContent=(trips/12).toFixed(1);

    const rent=rentDefs.reduce((s,x)=>s+evalCompare(x[1]),0);
    const car=carDefs.reduce((s,x)=>s+evalCompare(x[1]),0);
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
    btn.classList.add('active');document.getElementById(btn.dataset.sheet).classList.add('active');
  }));

  document.getElementById('clearAll').addEventListener('click',()=>{
    if(!confirm('Clear all trip data and reset comparison values?'))return;
    rows.forEach((r,i)=>{Object.keys(r).forEach(k=>r[k]='');r.tripno=String(i+1);}); formulas.clear();
    [...rentDefs,...carDefs].forEach(x=>compareVals[x[1]]=String(x[2]));
    syncTripInputs();buildCompareInputs();refresh();saveState();status.textContent='Cleared';
  });

  document.getElementById('loadDemo').addEventListener('click',()=>{
    rows[0].start='2026-09-05';rows[0].end='2026-09-12';rows[0].location='Italy';rows[0].city='Lonato del Garda';
    rows[0].accom='420';rows[0].groceries='95';rows[0].eat='80';rows[0].travel='145';rows[0].fuel='55';rows[0].tolls='25';
    rows[0].you='410';rows[0].him='410';
    rows[1].start='2026-09-20';rows[1].end='2026-09-24';rows[1].location='Italy';rows[1].city='Desenzano';
    rows[1].accom='260';rows[1].groceries='70';rows[1].eat='65';rows[1].travel='120';rows[1].fuel='40';rows[1].tolls='20';
    syncTripInputs();refresh();saveState();status.textContent='Example loaded';
  });

  document.getElementById('downloadJson').addEventListener('click',()=>{
    const payload={rows,formulas:Object.fromEntries(formulas),compareVals};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='together-budget-data.json';a.click();URL.revokeObjectURL(a.href);
  });

  restoreState();buildTrip();buildMonthly();buildCompareInputs();syncTripInputs();refresh();
})();
