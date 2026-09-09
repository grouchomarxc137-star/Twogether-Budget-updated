(() => {
'use strict';
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
let wishObserver=null,shopObserver=null,wishQueued=false,shopQueued=false;

function ensureCss(){
  if(!document.querySelector('link[href*="v29.css"]')){
    const l=document.createElement('link');l.rel='stylesheet';l.href='v29.css?v=1';document.head.appendChild(l);
  }
  if(!document.querySelector('link[href*="v30-readable.css"]')){
    const l=document.createElement('link');l.rel='stylesheet';l.href='v30-readable.css?v=1';document.head.appendChild(l);
  }
}

function installWishlistHub(){
  const tabs=$('.hub-tabs');if(!tabs)return false;
  let b=$('#wishlistHub');
  if(!b){b=document.createElement('button');b.id='wishlistHub';b.className='hub-tab';b.type='button';b.textContent='Wishlist';}
  const shop=$('#shopHub');
  if(shop&&b.nextElementSibling!==shop)tabs.insertBefore(b,shop);
  else if(!b.parentNode)tabs.appendChild(b);
  const old=$('#financeSubnav [data-fin-subview="wishlist"]');old?.remove();
  return true;
}

function showWishlist(e){
  e?.preventDefault?.();e?.stopImmediatePropagation?.();
  $$('.sheet').forEach(x=>x.classList.remove('active'));
  $$('.hub-tab').forEach(x=>x.classList.remove('active'));
  $$('.finance-subview').forEach(x=>x.classList.remove('active'));
  $('#tripSubnav')?.classList.add('hidden');
  $('#financeSubnav')?.classList.add('hidden');
  $('#finances')?.classList.add('active');
  $('[data-fin-view="wishlist"]')?.classList.add('active');
  $('#wishlistHub')?.classList.add('active');
  window.TwogetherV27?.renderAll?.();
  requestAnimationFrame(decorateWishlist);
}

function openExpenseWizard(btn,e){
  const card=btn.closest('.tw-current-card');
  const id=card?.dataset?.currentPlan||'';
  if(!id||!window.TwogetherWorkflow?.start)return false;
  e.preventDefault();e.stopImmediatePropagation();
  window.TwogetherWorkflow.start(id);
  const chooseFull=()=>{
    const full=$('#workflowV5Overlay [data-v5-actual-mode="full"]');
    if(full){full.click();return true;}
    return false;
  };
  requestAnimationFrame(()=>{if(!chooseFull())setTimeout(chooseFull,0);});
  return true;
}

function numberFromText(text){
  const cleaned=String(text||'').replace(/,/g,'').replace(/[^0-9.\-]/g,'');
  const n=Number(cleaned);return Number.isFinite(n)?n:0;
}
function wishIcon(name){
  const s=String(name||'').toLowerCase();
  if(/laptop|macbook|computer|pc/.test(s))return '⌘';
  if(/headphone|earphone|airpod|music|speaker/.test(s))return '♫';
  if(/camera|photo|lens/.test(s))return '◉';
  if(/trip|travel|flight|holiday|vacation/.test(s))return '✈';
  if(/perfume|fragrance/.test(s))return '✦';
  if(/book|kindle|read/.test(s))return '▤';
  if(/car|auto/.test(s))return '◇';
  if(/phone|iphone/.test(s))return '▯';
  return '♡';
}

function decorateWishlist(){
  wishQueued=false;
  const root=$('#financeWishlist');if(!root)return;
  const hero=$('.v27-wish-hero',root);
  if(hero){
    const copy=hero.firstElementChild;
    if(copy&&!$('.v29-wish-values',copy)){
      const row=document.createElement('div');row.className='v29-wish-values';
      row.innerHTML='<span><i>♡</i>Save for what you love</span><span><i>↗</i>Tiny wins count</span><span><i>✦</i>Earned feels better</span>';
      copy.appendChild(row);
    }
  }
  const twos=numberFromText($('.v27-twos-wallet strong',root)?.textContent);
  $$('.v27-wish-card',root).forEach(card=>{
    if(!$('.v29-wish-icon',card)){
      const icon=document.createElement('div');icon.className='v29-wish-icon';icon.setAttribute('aria-hidden','true');icon.textContent=wishIcon($('h3',card)?.textContent);
      const title=$('.v28-wish-title',card);title?.parentNode?.insertBefore(icon,title);
    }
    if(!$('.v29-wish-progress',card)){
      const price=numberFromText($('.v27-wish-price',card)?.textContent),earned=card.classList.contains('earned');
      if(price>0){
        const pct=earned?100:Math.max(0,Math.min(100,Math.round((Math.max(0,twos)/price)*100)));
        const p=document.createElement('div');p.className='v29-wish-progress';
        p.innerHTML=`<div><span>${earned?'Goal unlocked':`${Math.min(Math.max(0,twos),price).toLocaleString(undefined,{maximumFractionDigits:0})} / ${price.toLocaleString(undefined,{maximumFractionDigits:0})} Twos`}</span><b>${pct}%</b></div><i><em style="width:${pct}%"></em></i>`;
        const ready=$('.v28-wish-readiness',card);if(ready)card.insertBefore(p,ready);else card.appendChild(p);
      }
    }
  });
  const basket=$('.v27-cart',root);if(basket)basket.dataset.v29Polished='1';
}
function queueWishlist(){if(wishQueued)return;wishQueued=true;requestAnimationFrame(decorateWishlist);}

function setTextIfChanged(el,text){if(el&&el.textContent!==text)el.textContent=text;}
function calmShopCopy(root){
  const hero=$('.v27-shop-hero',root);
  if(hero){
    setTextIfChanged($('h1',hero),'Gentle rewards for the little things we do together.');
    setTextIfChanged($('p',hero),'Earn Lovis by logging, comparing, confirming and reaching Wishlist goals together.');
    const wallet=$('.v27-wallet',hero);
    if(wallet){
      const twosLabel=$$('span',wallet).find(el=>el.textContent.trim()==='Twos');
      if(twosLabel){
        const amount=twosLabel.nextElementSibling;
        const note=amount?.nextElementSibling;
        twosLabel.remove();amount?.remove();note?.remove();
      }
    }
  }
  const score=$('.v27-score',root);
  if(score){
    setTextIfChanged($('h2',score),'Our Lovis journey');
    $$('.v27-score-row',score).forEach(row=>{
      const detail=$('span',row);if(detail){const next=detail.textContent.split('·')[0].trim();setTextIfChanged(detail,next);}
    });
    setTextIfChanged($('p',score),'Every little action moves your Lovis journey forward.');
  }
}

function decorateShop(){
  shopQueued=false;
  const root=$('#shopView');if(!root)return;
  root.classList.add('v29-shop');
  calmShopCopy(root);
  const hero=$('.v27-shop-hero',root);
  if(hero&&!$('.v29-shop-ribbon',hero)){
    const ribbon=document.createElement('div');ribbon.className='v29-shop-ribbon';ribbon.textContent='♡ little rewards for the things you do together ✦';hero.appendChild(ribbon);
  }
  $$('.v27-shop-item',root).forEach((item,i)=>item.style.setProperty('--v29-i',String(i)));
}
function queueShop(){if(shopQueued)return;shopQueued=true;requestAnimationFrame(decorateShop);}

function observePolish(){
  const wish=$('#financeWishlist');
  if(wish&&!wishObserver){wishObserver=new MutationObserver(queueWishlist);wishObserver.observe(wish,{childList:true,subtree:true});}
  const shop=$('#shopView');
  if(shop&&!shopObserver){shopObserver=new MutationObserver(queueShop);shopObserver.observe(shop,{childList:true,subtree:true});}
  queueWishlist();queueShop();
}

function installEvents(){
  document.addEventListener('click',e=>{
    const expense=e.target.closest?.('[data-current-expenses],[data-current-actual]');
    if(expense&&openExpenseWizard(expense,e))return;
    if(e.target.closest?.('#wishlistHub')){showWishlist(e);return;}
    const hub=e.target.closest?.('.hub-tab');
    if(hub&&hub.id!=='wishlistHub')$('#wishlistHub')?.classList.remove('active');
  },true);
}

function init(){
  ensureCss();installEvents();
  installWishlistHub();
  setTimeout(()=>{installWishlistHub();observePolish();},120);
  setTimeout(()=>{installWishlistHub();observePolish();},700);
  document.addEventListener('twogether:wishlist-rendered',queueWishlist);
  document.addEventListener('twogether:v18-rendered',()=>requestAnimationFrame(()=>{installWishlistHub();observePolish();}));
  document.addEventListener('twogether:state-refreshed',()=>{queueWishlist();queueShop();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();