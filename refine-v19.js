(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const countryEmoji={Italy:'🇮🇹',Netherlands:'🇳🇱',Tunisia:'🇹🇳',Portugal:'🇵🇹',Spain:'🇪🇸',France:'🇫🇷',Germany:'🇩🇪',Belgium:'🇧🇪','United Kingdom':'🇬🇧',Other:'✦'};
  function loadLayers(){
    if(!document.querySelector('link[href*="refine-v20.css"]')){const l=document.createElement('link');l.rel='stylesheet';l.href='refine-v20.css?v=2';l.dataset.v20='1';document.head.appendChild(l);}
    if(!document.querySelector('link[href*="refine-v21.css"]')){const l=document.createElement('link');l.rel='stylesheet';l.href='refine-v21.css?v=1';l.dataset.v21='1';document.head.appendChild(l);}
    const loadDev=()=>{if(document.querySelector('script[src*="dev-v21b.js"]'))return;const s=document.createElement('script');s.src='dev-v21b.js?v=1';s.defer=true;s.dataset.v21Dev='1';document.body.appendChild(s);};
    const loadTrip=()=>{if(document.querySelector('script[src*="trip-v21.js"]'))return loadDev();const s=document.createElement('script');s.src='trip-v21.js?v=1';s.defer=true;s.dataset.v21Trip='1';s.addEventListener('load',loadDev,{once:true});document.body.appendChild(s);};
    if(!document.querySelector('script[src*="refine-v20.js"]')){const s=document.createElement('script');s.src='refine-v20.js?v=2';s.defer=true;s.dataset.v20='1';s.addEventListener('load',loadTrip,{once:true});document.body.appendChild(s);}else loadTrip();
  }
  function enhanceCard(card){
    if(card.dataset.v19Aesthetic==='1')return;
    const main=$('.tw-current-main',card);if(!main)return;
    const country=$('.trip-country',card)?.textContent?.trim()||'Trip';
    const city=$('h3',card)?.textContent?.trim()||'Trip';
    const art=document.createElement('div');art.className='tw-trip-art';art.setAttribute('aria-hidden','true');
    art.innerHTML=`<span class="tw-trip-emoji">${countryEmoji[country]||'✦'}</span><span class="tw-trip-monogram">${(city[0]||'T').toUpperCase()}</span>`;
    card.insertBefore(art,main);
    const status=$('.tw-current-status',card);if(status){const text=status.textContent.toLowerCase();status.dataset.status=text.includes('progress')?'progress':'planned';}
    card.dataset.v19Aesthetic='1';
  }
  function enhance(){$$('#twCurrentTrips .tw-current-card').forEach(enhanceCard);}
  document.addEventListener('DOMContentLoaded',()=>{
    loadLayers();enhance();
    const root=$('#twCurrentTrips');if(root)new MutationObserver(()=>requestAnimationFrame(enhance)).observe(root,{childList:true,subtree:true});
    document.addEventListener('twogether:v18-rendered',enhance);
  });
})();
