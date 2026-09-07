(() => {
  'use strict';

  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const STORE_KEY='twogether_shop_v24';
  const ACTOR_KEY='twogether_actor_v1';
  const ACTORS=['Principessa','Principe'];

  const ITEMS=[
    {id:'gold-heart',cost:20,icon:'♡',title:'Golden Heart',desc:'Give the Twogether heart a soft golden glow.',className:'shop-gold-heart'},
    {id:'sparkle-cards',cost:40,icon:'✦',title:'Sparkle Cards',desc:'Add a subtle sparkle detail to trip and wishlist cards.',className:'shop-sparkle-cards'},
    {id:'cozy-glow',cost:60,icon:'☼',title:'Cozy Glow',desc:'Unlock a warmer, softer page glow.',className:'shop-cozy-glow'},
    {id:'travel-stamps',cost:80,icon:'◌',title:'Travel Stamps',desc:'Add decorative travel-stamp marks to trip cards.',className:'shop-travel-stamps'},
    {id:'quick-note',cost:100,icon:'✎',title:'Quick Note',desc:'Unlock a small floating note pad for travel ideas.'}
  ];

  function actor(){
    const current=document.body.dataset.actor||'';
    if(ACTORS.includes(current))return current;
    try{const saved=localStorage.getItem(ACTOR_KEY)||'';return ACTORS.includes(saved)?saved:'';}catch{return '';}
  }

  function loadAll(){try{const value=JSON.parse(localStorage.getItem(STORE_KEY)||'{}');return value&&typeof value==='object'?value:{};}catch{return {};}}
  function saveAll(value){try{localStorage.setItem(STORE_KEY,JSON.stringify(value));}catch{}}
  function normalizeState(value){
    const s=value&&typeof value==='object'?value:{};
    return {
      tokens:Math.max(0,Number(s.tokens)||0),
      purchases:Array.isArray(s.purchases)?[...new Set(s.purchases.map(String))]:[],
      awards:{
        logs:Array.isArray(s.awards?.logs)?[...new Set(s.awards.logs.map(String))]:[],
        tripConfirms:Array.isArray(s.awards?.tripConfirms)?[...new Set(s.awards.tripConfirms.map(String))]:[],
        financeConfirms:Array.isArray(s.awards?.financeConfirms)?[...new Set(s.awards.financeConfirms.map(String))]:[]
      }
    };
  }
  function state(){const a=actor();if(!a)return normalizeState({});const all=loadAll();return normalizeState(all[a]);}
  function commit(s){const a=actor();if(!a)return;const all=loadAll();all[a]=normalizeState(s);saveAll(all);renderBadge();renderShop();applyPurchases();}

  function toast(message,tone='ok'){
    const t=$('#toast');if(!t)return;t.textContent=message;t.className='toast show '+tone;
    clearTimeout(t._shopV24);t._shopV24=setTimeout(()=>t.className='toast',1900);
  }

  function award(bucket,key,amount,label){
    const a=actor();if(!a||!key)return;
    const s=state();const list=s.awards[bucket];if(!Array.isArray(list)||list.includes(key))return;
    list.push(key);s.tokens+=amount;commit(s);toast(`+${amount} tokens ✦ ${label||''}`.trim());
  }

  function stableMeta(meta={}){return [meta.location||'',meta.otherLocation||'',meta.city||'',meta.start||'',meta.end||''].map(v=>String(v).trim().toLowerCase()).join('|');}
  function logKey(action,payload={},result={},usedActor=''){
    const a=usedActor||actor();
    if(action==='savePlan')return `plan:${result.planId||result.plan?.id||stableMeta(payload.meta)}`;
    if(action==='savePlanPartial'||action==='savePlanSubmission')return `trip-log:${payload.planId||result.planId||''}:${a}`;
    if(action==='saveSharedExpense')return `shared-expense:${payload.planId||result.planId||''}:${payload.key||''}:${a}`;
    if(action==='saveSubmission')return `trip-log:${payload.tripId||result.tripId||stableMeta(payload.submission||{})}:${a}`;
    if(action==='saveFinanceMonth'&&payload.monthData?.finalized!==true)return `finance-month:${a}:${payload.monthData?.month||''}`;
    return '';
  }

  function wrapPost(){
    const api=window.TwogetherAPI;if(!api||api.__shopV24Wrapped)return;
    api.__shopV24Wrapped=true;const original=api.post.bind(api);
    api.post=async(action,payload={},usedActor)=>{
      const result=await original(action,payload,usedActor);
      try{
        const a=ACTORS.includes(usedActor)?usedActor:actor();
        const lk=logKey(action,payload,result,a);if(lk)award('logs',lk,5,'for logging');
        if(action==='confirmTrip'){
          const id=String(payload?.id||result?.tripId||'').trim();if(id)award('tripConfirms',`trip:${a}:${id}`,10,'for confirming a trip');
        }
        if(action==='saveFinanceMonth'&&payload?.monthData?.finalized===true){
          const month=String(payload.monthData.month||'').trim();if(month)award('financeConfirms',`finance:${a}:${month}`,15,'for confirming monthly finances');
        }
      }catch{}
      return result;
    };
  }

  function clearPurchaseEffects(){ITEMS.forEach(item=>{if(item.className)document.body.classList.remove(item.className);});$('#shopQuickNote')?.remove();}
  function applyPurchases(){
    clearPurchaseEffects();const s=state();
    ITEMS.forEach(item=>{if(!s.purchases.includes(item.id))return;if(item.className)document.body.classList.add(item.className);if(item.id==='quick-note')enableQuickNote();});
  }
  function renderBadge(){const b=$('#shopTokenBadge');if(b)b.textContent=`${state().tokens} ✦`;}
  function buy(id){
    const item=ITEMS.find(x=>x.id===id),s=state();if(!item||s.purchases.includes(id))return;
    if(s.tokens<item.cost)return toast(`You need ${item.cost-s.tokens} more tokens`,'warn');
    s.tokens-=item.cost;s.purchases.push(id);commit(s);toast(`${item.title} unlocked ✦`);
  }

  function renderShop(){
    const root=$('#shopView');if(!root)return;const s=state();
    root.innerHTML=`<div class="shop-hero"><span class="eyebrow">TWOGETHER TOKENS</span><h1>Little rewards for keeping life organised</h1><p>Earn <strong>5 tokens</strong> when you log something, <strong>10 tokens</strong> when you confirm a trip, and <strong>15 tokens</strong> when you confirm your monthly finances. Re-editing the same saved item does not create duplicate rewards.</p><div class="shop-reward-strip"><span><b>+5</b> Log</span><span><b>+10</b> Confirm trip</span><span><b>+15</b> Confirm month</span></div><div class="shop-wallet"><span>Your balance</span><strong>${s.tokens} ✦</strong></div></div><div class="shop-grid">${ITEMS.map(item=>{const owned=s.purchases.includes(item.id),can=s.tokens>=item.cost;return `<article class="shop-item ${owned?'owned':''}"><div class="shop-icon">${item.icon}</div><div><span class="shop-cost">${item.cost} tokens</span><h3>${item.title}</h3><p>${item.desc}</p></div><button type="button" data-buy="${item.id}" ${owned?'disabled':''}>${owned?'Unlocked':can?'Unlock':'Need more'}</button></article>`}).join('')}</div>`;
    $$('[data-buy]',root).forEach(button=>button.addEventListener('click',()=>buy(button.dataset.buy)));
  }

  function hideSubnavs(){$('#tripSubnav')?.classList.add('hidden');$('#financeSubnav')?.classList.add('hidden');}
  function showShop(){
    $$('.sheet').forEach(x=>x.classList.remove('active'));$$('.hub-tab').forEach(x=>x.classList.remove('active'));hideSubnavs();
    $('#shopView')?.classList.add('active');$('#shopHub')?.classList.add('active');renderShop();
  }
  function installShop(){
    if(!$('#shopHub')){
      const tabs=$('.hub-tabs');if(!tabs)return;const btn=document.createElement('button');btn.id='shopHub';btn.className='hub-tab tab shop-hub';btn.type='button';btn.innerHTML='Shop <span id="shopTokenBadge" class="shop-token-badge"></span>';tabs.appendChild(btn);btn.addEventListener('click',showShop);
    }
    if(!$('#shopView')){const main=$('.main');if(!main)return;const section=document.createElement('section');section.id='shopView';section.className='sheet shop-page';main.appendChild(section);}
    renderBadge();renderShop();
  }

  function removeDevUi(){
    $('#twDevToggle')?.remove();
    $$('[class*="dev-v18"],[class*="dev19-"],[class^="dev22-"],[class^="dev23-"]').forEach(el=>el.remove());
    document.body.classList.remove('dev-playground','dev-v19','dev-v21','dev-v22','dev23-active');
  }

  function enableQuickNote(){
    if($('#shopQuickNote'))return;const a=actor();if(!a)return;
    const note=document.createElement('div');note.id='shopQuickNote';note.className='shop-quick-note';note.innerHTML='<button type="button" aria-label="Minimize quick note">×</button><strong>Quick note</strong><textarea placeholder="A little idea for later…"></textarea>';document.body.appendChild(note);
    const textarea=$('textarea',note);const key=`twogether_shop_note_${a}`;try{textarea.value=localStorage.getItem(key)||'';}catch{}
    textarea.addEventListener('input',()=>{try{localStorage.setItem(key,textarea.value);}catch{}});$('button',note)?.addEventListener('click',()=>note.classList.toggle('minimized'));
  }

  function actorChanged(){removeDevUi();installShop();renderBadge();renderShop();applyPurchases();}
  function init(){
    removeDevUi();installShop();wrapPost();applyPurchases();
    document.addEventListener('click',e=>{const hub=e.target.closest?.('[data-hub="trips"],[data-hub="finances"]');if(hub)$('#shopView')?.classList.remove('active');},true);
    const actorObserver=new MutationObserver(actorChanged);actorObserver.observe(document.body,{attributes:true,attributeFilter:['data-actor']});
    const top=$('.top-actions');if(top)new MutationObserver(removeDevUi).observe(top,{childList:true});
    setTimeout(()=>{removeDevUi();wrapPost();},200);
  }

  window.TwogetherShop={getState:state,render:renderShop};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();