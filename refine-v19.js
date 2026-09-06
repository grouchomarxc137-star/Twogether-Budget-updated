(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const countryEmoji={Italy:'🇮🇹',Netherlands:'🇳🇱',Tunisia:'🇹🇳',Portugal:'🇵🇹',Spain:'🇪🇸',France:'🇫🇷',Germany:'🇩🇪',Belgium:'🇧🇪','United Kingdom':'🇬🇧',Other:'✦'};
  function addCss(href,key){
    if(document.querySelector(`link[href*="${href.split('?')[0]}"]`))return;
    const l=document.createElement('link');l.rel='stylesheet';l.href=href;l.dataset[key]='1';document.head.appendChild(l);
  }
  function addScript(src,key,onload){
    if(document.querySelector(`script[src*="${src.split('?')[0]}"]`)){onload?.();return;}
    const s=document.createElement('script');s.src=src;s.defer=true;s.dataset[key]='1';if(onload)s.addEventListener('load',onload,{once:true});document.body.appendChild(s);
  }
  function loadLayers(){
    addCss('refine-v20.css?v=2','v20');
    addCss('refine-v21.css?v=1','v21');
    addCss('refine-v21-media.css?v=1','v21Media');
    addCss('refine-v22.css?v=1','v22');
    const loadDev=()=>addScript('dev-v22.js?v=1','v22Dev');
    const loadUi=()=>addScript('refine-v22.js?v=1','v22Ui',loadDev);
    const loadTrip=()=>addScript('trip-v21.js?v=2','v21Trip',loadUi);
    addScript('refine-v20.js?v=2','v20',loadTrip);
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
