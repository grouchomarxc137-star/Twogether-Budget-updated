(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const countryEmoji={Italy:'🇮🇹',Netherlands:'🇳🇱',Tunisia:'🇹🇳',Portugal:'🇵🇹',Spain:'🇪🇸',France:'🇫🇷',Germany:'🇩🇪',Belgium:'🇧🇪','United Kingdom':'🇬🇧',Other:'✦'};
  function loadV20(){
    if(!document.querySelector('link[data-v20]')){const l=document.createElement('link');l.rel='stylesheet';l.href='refine-v20.css?v=1';l.dataset.v20='1';document.head.appendChild(l);}
    if(!document.querySelector('script[data-v20]')){const s=document.createElement('script');s.src='refine-v20.js?v=1';s.defer=true;s.dataset.v20='1';document.body.appendChild(s);}
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
    loadV20();enhance();
    const root=$('#twCurrentTrips');if(root)new MutationObserver(()=>requestAnimationFrame(enhance)).observe(root,{childList:true,subtree:true});
    document.addEventListener('twogether:v18-rendered',enhance);
  });
})();
