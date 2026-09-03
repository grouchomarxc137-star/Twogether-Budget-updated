(() => {
  'use strict';

  const ACTOR_KEY='twogether_actor_v1';
  const ACTORS=['Principessa','Principe'];

  // Restore the remembered identity before the main runtime initializes so a reload
  // does not flash or remain stuck behind the login modal.
  try{
    const saved=localStorage.getItem(ACTOR_KEY)||'';
    if(ACTORS.includes(saved)){
      document.body.dataset.actor=saved;
      const badge=document.getElementById('loggedUserBadge');
      if(badge){
        badge.textContent=saved;
        badge.classList.remove('hidden');
      }
      const modal=document.getElementById('identityModal');
      if(modal){
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden','true');
      }
    }
  }catch{}

  // The core runtime currently requests a 3.5 s sync interval. Slow only that
  // interval to 12 s; writes still sync immediately and the page remains responsive.
  const originalSetInterval=window.setInterval.bind(window);
  window.setInterval=function(fn,delay,...args){
    const saferDelay=Number(delay)===3500 ? 12000 : delay;
    return originalSetInterval(fn,saferDelay,...args);
  };

  // workflow-v5 already receives the normal periodic core sync. Avoid extra network
  // bursts every time the browser window receives focus or becomes visible.
  const originalWindowAdd=window.addEventListener.bind(window);
  const originalDocumentAdd=document.addEventListener.bind(document);
  let bootstrapActive=true;

  window.addEventListener=function(type,listener,options){
    if(bootstrapActive && type==='focus') return;
    return originalWindowAdd(type,listener,options);
  };

  document.addEventListener=function(type,listener,options){
    if(bootstrapActive && type==='visibilitychange') return;
    return originalDocumentAdd(type,listener,options);
  };

  originalDocumentAdd('DOMContentLoaded',()=>{
    // Restore native browser APIs after all deferred scripts have initialized.
    setTimeout(()=>{
      bootstrapActive=false;
      window.setInterval=originalSetInterval;
      window.addEventListener=originalWindowAdd;
      document.addEventListener=originalDocumentAdd;

      // Final safety: if a profile was remembered, never leave the login modal open.
      try{
        const saved=localStorage.getItem(ACTOR_KEY)||'';
        if(ACTORS.includes(saved)){
          const modal=document.getElementById('identityModal');
          modal?.classList.remove('show');
          modal?.setAttribute('aria-hidden','true');
        }
      }catch{}
    },0);
  });
})();
