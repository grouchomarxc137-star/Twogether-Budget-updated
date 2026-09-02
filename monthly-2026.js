(() => {
  'use strict';

  const CONFIG = window.TOGETHER_BUDGET_CONFIG || {};
  const API_URL = String(CONFIG.appsScriptUrl || '').trim();
  const body = document.getElementById('monthlyBody');
  if (!body || !API_URL) return;

  const MONEY_FIELDS = ['accom','groceries','eat','travel','fuel','tolls','other'];
  const MONTHS = [
    ['2026-01','Jan 2026'],['2026-02','Feb 2026'],['2026-03','Mar 2026'],['2026-04','Apr 2026'],
    ['2026-05','May 2026'],['2026-06','Jun 2026'],['2026-07','Jul 2026'],['2026-08','Aug 2026'],
    ['2026-09','Sep 2026'],['2026-10','Oct 2026'],['2026-11','Nov 2026'],['2026-12','Dec 2026']
  ];

  let cachedState = null;
  let lastStamp = '';
  let rendering = false;

  const n = v => {
    const x = Number(String(v ?? '').replace(',','.'));
    return Number.isFinite(x) ? x : 0;
  };
  const money = v => '€' + n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});

  function getSubs(t){
    return {
      Principessa:t?.submissions?.Principessa || null,
      Principe:t?.submissions?.Principe || null
    };
  }

  function versionsDiffer(t){
    const {Principessa:a,Principe:b} = getSubs(t);
    if(!a || !b) return false;

    const textFields = ['location','otherLocation','city','start','end'];
    if(textFields.some(k => String(a[k]||'').trim().toLowerCase() !== String(b[k]||'').trim().toLowerCase())) return true;

    return MONEY_FIELDS.some(k =>
      Math.abs(n(a[k])-n(b[k])) > .01 ||
      (!!a?.uncertain?.[k] !== !!b?.uncertain?.[k])
    );
  }

  function effectiveTrip(t){
    const {Principessa:a,Principe:b} = getSubs(t);
    const source = a || b || {};
    const e = {
      start:source.start || '',
      uncertain:{},
      provisional:!(a && b),
      mismatch:versionsDiffer(t)
    };

    if(a && b){
      const latest = String(a.submittedAt||'') >= String(b.submittedAt||'') ? a : b;
      e.start = latest.start || a.start || b.start || '';
    }

    MONEY_FIELDS.forEach(k => {
      if(a && b){
        e[k] = (n(a[k]) + n(b[k])) / 2;
        e.uncertain[k] = !!(a?.uncertain?.[k] || b?.uncertain?.[k] || Math.abs(n(a[k])-n(b[k])) > .01);
      }else{
        e[k] = n(source[k]);
        e.uncertain[k] = !!source?.uncertain?.[k];
      }
    });

    e.total = MONEY_FIELDS.reduce((sum,k)=>sum+n(e[k]),0);
    e.estimated = e.provisional || e.mismatch || Object.values(e.uncertain).some(Boolean);
    return e;
  }

  function jsonp(){
    return new Promise((resolve,reject) => {
      const cb = '__twogether_monthly_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(() => finish(new Error('timeout')), 10000);

      function finish(err,data){
        clearTimeout(timer);
        try { delete window[cb]; } catch {}
        script.remove();
        err ? reject(err) : resolve(data);
      }

      window[cb] = data => finish(null,data);
      const params = new URLSearchParams({action:'state',callback:cb,_:String(Date.now())});
      script.src = API_URL + (API_URL.includes('?') ? '&' : '?') + params.toString();
      script.onerror = () => finish(new Error('unreachable'));
      document.head.appendChild(script);
    });
  }

  function render(state){
    if(!state) return;
    const trips = Array.isArray(state.trips) ? state.trips.map(effectiveTrip) : [];
    const stats = MONTHS.map(([key,label]) => {
      const monthTrips = trips.filter(t => String(t.start||'').slice(0,7) === key);
      const s = {key,label,trips:monthTrips.length,accom:0,groceries:0,eat:0,travel:0,fuel:0,tolls:0,other:0,total:0,estimated:false};
      monthTrips.forEach(t => {
        MONEY_FIELDS.forEach(k => s[k] += n(t[k]));
        s.total += t.total;
        s.estimated = s.estimated || t.estimated;
      });
      return s;
    });

    const html = stats.map(s => `
      <tr>
        <td>${s.label}</td>
        <td>${s.trips}</td>
        ${MONEY_FIELDS.map(k => `<td>${money(s[k])}</td>`).join('')}
        <td>${s.estimated?'~ ':''}${money(s.total)}</td>
        <td>${s.estimated?'~ ':''}${money(s.total/2)}</td>
      </tr>`).join('');

    rendering = true;
    if(body.innerHTML !== html) body.innerHTML = html;

    const total = stats.reduce((sum,m)=>sum+m.total,0);
    const tripCount = stats.reduce((sum,m)=>sum+m.trips,0);
    const activeMonths = stats.filter(m=>m.trips>0).length || 1;

    const kpiTotal = document.getElementById('kpiTotal');
    const kpiMonth = document.getElementById('kpiMonth');
    const kpiPerson = document.getElementById('kpiPerson');
    const kpiTrip = document.getElementById('kpiTrip');
    const kpiTrips = document.getElementById('kpiTrips');

    if(kpiTotal) kpiTotal.textContent = money(total);
    if(kpiMonth) kpiMonth.textContent = money(total/activeMonths);
    if(kpiPerson) kpiPerson.textContent = money(total/activeMonths/2);
    if(kpiTrip) kpiTrip.textContent = money(tripCount ? total/tripCount : 0);
    if(kpiTrips) kpiTrips.textContent = String(tripCount);

    queueMicrotask(() => { rendering = false; });
  }

  async function refresh(){
    try{
      const res = await jsonp();
      if(!res?.ok) return;
      const next = res.state || {};
      const stamp = next.updatedAt || JSON.stringify(next.trips || []);
      cachedState = next;
      if(stamp !== lastStamp){
        lastStamp = stamp;
        render(cachedState);
      }
    }catch{}
  }

  new MutationObserver(() => {
    if(rendering || !cachedState) return;
    setTimeout(() => render(cachedState), 0);
  }).observe(body,{childList:true});

  refresh();
  setInterval(refresh, 4000);
})();
