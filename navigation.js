(() => {
  'use strict';

  const $ = (s,r=document) => r.querySelector(s);
  const $$ = (s,r=document) => [...r.querySelectorAll(s)];
  const TRIP_VIEW_KEY = 'twogether_trip_subview_v1';
  const FIN_VIEW_KEY = 'twogether_fin_subview_v1';

  function setHub(name){
    $$('[data-hub]').forEach(btn=>btn.classList.toggle('active',btn.dataset.hub===name));
    $('#tripSubnav')?.classList.toggle('hidden',name!=='trips');
  }

  function activateTrip(sheet){
    const target=$(`.trip-subnav .tab[data-sheet="${sheet}"]`) || $('.trip-subnav .tab[data-sheet="log"]');
    if(target){
      try{localStorage.setItem(TRIP_VIEW_KEY,target.dataset.sheet||'log');}catch{}
      setHub('trips');
      target.click();
    }
  }

  function activateFinanceView(view){
    const valid=['overview','monthly','balances','scenarios'];
    const chosen=valid.includes(view)?view:'overview';
    $$('[data-fin-subview]').forEach(btn=>btn.classList.toggle('active',btn.dataset.finSubview===chosen));
    $$('[data-fin-view]').forEach(el=>el.classList.toggle('active',el.dataset.finView===chosen));
    try{localStorage.setItem(FIN_VIEW_KEY,chosen);}catch{}
    document.dispatchEvent(new CustomEvent('twogether:finance-view',{detail:{view:chosen}}));
  }

  function init(){
    const tripHub=$('[data-hub="trips"]');
    const financeHub=$('[data-hub="finances"]');
    if(!tripHub||!financeHub) return;

    tripHub.addEventListener('click',()=>{
      let last='log'; try{last=localStorage.getItem(TRIP_VIEW_KEY)||'log';}catch{}
      activateTrip(last);
    });

    financeHub.addEventListener('click',()=>{
      setHub('finances');
      let last='overview'; try{last=localStorage.getItem(FIN_VIEW_KEY)||'overview';}catch{}
      setTimeout(()=>activateFinanceView(last),0);
    });

    $$('.trip-subnav .tab').forEach(btn=>btn.addEventListener('click',()=>{
      setHub('trips');
      try{localStorage.setItem(TRIP_VIEW_KEY,btn.dataset.sheet||'log');}catch{}
    }));

    $$('[data-fin-subview]').forEach(btn=>btn.addEventListener('click',()=>activateFinanceView(btn.dataset.finSubview)));

    document.addEventListener('click',e=>{
      const tab=e.target.closest?.('.tab[data-sheet="finances"]');
      if(tab){
        setHub('finances');
        let last='overview'; try{last=localStorage.getItem(FIN_VIEW_KEY)||'overview';}catch{}
        setTimeout(()=>activateFinanceView(last),0);
      }
    },true);

    setHub('trips');
    activateFinanceView('overview');
  }

  document.addEventListener('DOMContentLoaded',init);
})();
