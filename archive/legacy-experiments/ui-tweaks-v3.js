(() => {
  'use strict';

  const CONFIG = window.TOGETHER_BUDGET_CONFIG || {};
  const API_URL = String(CONFIG.appsScriptUrl || '').trim();
  const CLEANUP_BEFORE = '2026-09-02T16:52:00.000Z';
  const badge = document.getElementById('loggedUserBadge');
  const tripGallery = document.getElementById('tripGallery');
  const tripKpi = document.getElementById('kpiTrips');

  function setBadge(name){
    if(!badge) return;
    badge.textContent = name;
    badge.classList.remove('hidden');
    badge.disabled = true;
    badge.removeAttribute('title');
    badge.style.cursor = 'default';
    badge.style.pointerEvents = 'none';
  }

  function jsonp(params={}){
    return new Promise((resolve,reject)=>{
      if(!API_URL) return reject(new Error('No backend URL'));
      const cb = '__tb_cleanup_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(()=>finish(new Error('timeout')),10000);
      function finish(err,data){
        clearTimeout(timer);
        try{ delete window[cb]; }catch{}
        script.remove();
        err ? reject(err) : resolve(data);
      }
      window[cb] = data => finish(null,data);
      const q = new URLSearchParams({...params,callback:cb,_:Date.now().toString()});
      script.src = API_URL + (API_URL.includes('?')?'&':'?') + q.toString();
      script.onerror = () => finish(new Error('backend unreachable'));
      document.head.appendChild(script);
    });
  }

  function postDelete(actor,id){
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = API_URL;
    form.target = 'backendFrame';
    form.style.display = 'none';
    const fields = {
      action:'deleteTrip',
      actor,
      payload:JSON.stringify({id})
    };
    Object.entries(fields).forEach(([name,value])=>{
      const input = document.createElement('input');
      input.type='hidden';
      input.name=name;
      input.value=value;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
    form.remove();
  }

  async function clearOldTrips(actor){
    try{
      const res = await jsonp({action:'state'});
      const trips = Array.isArray(res?.state?.trips) ? res.state.trips : [];
      const targets = trips.filter(t => {
        const created = String(t?.createdAt || t?.updatedAt || '');
        return created && created < CLEANUP_BEFORE;
      });
      targets.forEach(t => postDelete(actor,t.id));
    }catch{}
  }

  document.querySelectorAll('.identity-choice[data-actor]').forEach(button => {
    button.addEventListener('click', () => {
      const name = button.dataset.actor;
      setBadge(name);
      clearOldTrips(name);
    });
  });

  // Identity is selected only through the startup modal; logo and badge are not switch controls.
  const brand = document.getElementById('brandMark') || document.querySelector('.brand-mark');
  if(brand){
    brand.removeAttribute('title');
    brand.style.cursor = 'default';
    brand.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  function isInBudgetYear(dateText){
    const match = String(dateText || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if(!match) return false;
    const [,dd,mm,yyyy] = match;
    const value = Number(`${yyyy}${mm}${dd}`);
    return value >= 20260901 && value <= 20270831;
  }

  function updateTripsPerYear(){
    if(!tripKpi || !tripGallery) return;
    const cards = [...tripGallery.querySelectorAll('.trip-story-card')];
    tripKpi.textContent = String(cards.filter(card => isInBudgetYear(card.querySelector('p')?.textContent)).length);
  }

  if(tripGallery){
    new MutationObserver(updateTripsPerYear).observe(tripGallery,{childList:true,subtree:true});
  }
  updateTripsPerYear();
})();
