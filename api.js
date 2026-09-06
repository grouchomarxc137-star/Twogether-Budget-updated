(() => {
  'use strict';
  const url=String(window.TOGETHER_BUDGET_CONFIG?.appsScriptUrl||'');
  const CACHE_KEY='twogether_state_cache_v1';
  let queue=Promise.resolve();
  let warmCacheUsed=false;

  function remember(state){
    if(!state)return;window.__TWOGETHER_CACHED_STATE__=state;
    try{localStorage.setItem(CACHE_KEY,JSON.stringify(state));}catch{}
  }

  function remoteState(){return new Promise((resolve,reject)=>{
    const cb='__tw_api_'+Date.now()+'_'+Math.random().toString(36).slice(2),script=document.createElement('script');
    const timer=setTimeout(()=>done(new Error('Could not reach the shared data. Please retry.')),15000);
    function done(err,data){clearTimeout(timer);delete window[cb];script.remove();if(err)return reject(err);remember(data);document.dispatchEvent(new CustomEvent('twogether:state-refreshed',{detail:{state:data}}));resolve(data);}
    window[cb]=r=>r?.ok?done(null,r.state):done(new Error(r?.error||'Sync failed'));
    script.onerror=()=>done(new Error('Could not reach the shared data.'));
    script.src=url+'?action=state&callback='+cb+'&_='+Date.now();document.head.appendChild(script);
  });}

  function state(){
    const cached=window.__TWOGETHER_CACHED_STATE__;
    if(!warmCacheUsed&&cached){
      warmCacheUsed=true;
      setTimeout(()=>remoteState().catch(()=>{}),0);
      return Promise.resolve(cached);
    }
    return remoteState();
  }

  async function send(action,payload,actor){
    if(!['Principessa','Principe'].includes(actor))throw Error('Choose your profile first');
    const devMaintenance=['deleteTrip','deleteFinanceMonth','saveFinanceProfile'];
    if(document.body.classList.contains('dev-playground')&&!devMaintenance.includes(action))throw Error('Leave DEV to save normal shared trip or finance changes. DEV only permits explicit maintenance deletes.');
    const current=await remoteState();
    if(current.version<17)throw Error('Apps Script update required: deploy backend/Code.gs (v17) before saving.');
    return new Promise((resolve,reject)=>{
      const requestId=crypto.randomUUID(),frame=document.createElement('iframe'),form=document.createElement('form');
      frame.name='tw_save_'+requestId;frame.hidden=true;frame.title='Saving shared data';document.body.appendChild(frame);
      const timer=setTimeout(()=>done(new Error('Save confirmation timed out. Refresh and check before retrying.')),25000);
      function done(err,result){clearTimeout(timer);window.removeEventListener('message',receive);frame.remove();form.remove();err?reject(err):resolve(result);}
      function receive(e){
        let host;try{host=new URL(e.origin).hostname;}catch{return;}
        if(!(host==='script.google.com'||host==='script.googleusercontent.com'||host.endsWith('.script.googleusercontent.com')||host.endsWith('-script.googleusercontent.com')))return;
        if(e.data?.type!=='twogether:saved'||e.data.requestId!==requestId)return;
        if(!e.data.result?.ok)return done(new Error(e.data.result?.error||'Save failed'));
        document.dispatchEvent(new CustomEvent('twogether:saved'));done(null,e.data.result);
      }
      window.addEventListener('message',receive);
      form.method='POST';form.action=url;form.target=frame.name;form.hidden=true;
      for(const [key,value] of Object.entries({action,actor,requestId,payload:JSON.stringify(payload||{})})){const input=document.createElement('input');input.name=key;input.value=value;form.appendChild(input);}
      document.body.appendChild(form);form.submit();
    });
  }
  window.TwogetherAPI={state,remoteState,post(action,payload,actor){const result=queue.then(()=>send(action,payload,actor));queue=result.catch(()=>{});return result;}};
})();
