(() => {
'use strict';
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
let shopObserver=null,financeObserver=null,repairingShop=false,balanceTimer=null;

function numberFrom(text){
  const match=String(text||'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);
  return match?Number(match[0]):0;
}
function setText(el,text){if(el&&el.textContent!==text)el.textContent=text;}

/* Keep the desired Shop composition in place even when the older renderer refreshes its root. */
function calmShopCopy(root){
  const hero=$('.v27-shop-hero',root);
  if(hero){
    setText($('h1',hero),'Gentle rewards for the little things we do together.');
    setText($('p',hero),'Earn Lovis by logging, comparing, confirming and reaching Wishlist goals together.');
    const wallet=$('.v27-wallet',hero);
    const twos=wallet&&$$('span',wallet).find(el=>el.textContent.trim()==='Twos');
    if(twos){const amount=twos.nextElementSibling,note=amount?.nextElementSibling;twos.remove();amount?.remove();note?.remove();}
  }
  const score=$('.v27-score',root);
  if(score){
    setText($('h2',score),'Our Lovis journey');
    $$('.v27-score-row',score).forEach(row=>{const detail=$('span',row);if(detail)setText(detail,detail.textContent.split('·')[0].trim());});
    setText($('p',score),'Every little action moves your Lovis journey forward.');
  }
}
function journeyValues(score){
  const values={Principessa:0,Principe:0};
  $$('.v27-score-row',score).forEach(row=>{const name=$('strong',row)?.textContent.trim();if(name in values)values[name]=numberFrom($('span',row)?.textContent||$('b',row)?.textContent);});
  return values;
}
function repairJourney(root){
  const score=$('.v27-score',root);if(!score)return;
  score.classList.add('v31-journey');
  const values=journeyValues(score);
  let path=$('.v31-journey-path',score);
  if(!path){
    path=document.createElement('div');path.className='v31-journey-path';
    path.innerHTML=`<div class="v31-journey-person"><div class="v31-journey-avatar">♕</div><strong>Principessa</strong><small>${values.Principessa.toLocaleString()} Lovis</small></div><div class="v31-journey-route" aria-label="Shared Lovis milestones"><div class="v31-milestone"><i>✓</i><span>First moments</span></div><div class="v31-milestone"><i>♡</i><span>Little rewards</span></div><div class="v31-milestone"><i>✦</i><span>More adventures</span></div></div><div class="v31-journey-person"><div class="v31-journey-avatar">♔</div><strong>Principe</strong><small>${values.Principe.toLocaleString()} Lovis</small></div>`;
    $('.v27-section-title',score)?.insertAdjacentElement('afterend',path);
  }else{
    const people=$$('.v31-journey-person',path);
    setText($('small',people[0]),`${values.Principessa.toLocaleString()} Lovis`);
    setText($('small',people[1]),`${values.Principe.toLocaleString()} Lovis`);
  }
}
function rewardInfo(item){
  return {item,cost:numberFrom(item.querySelector('div:nth-child(2)>span')?.textContent),title:item.querySelector('h3')?.textContent.trim()||'Reward',owned:item.classList.contains('owned')};
}
function currentLovis(root){return numberFrom($('.v27-wallet strong',root)?.textContent);}
function updateRewardSide(layout,root){
  const side=$('.v31-reward-side',layout);if(!side)return;
  const lovis=currentLovis(root),infos=$$('.v27-shop-item',layout).map(rewardInfo).sort((a,b)=>a.cost-b.cost),max=Math.max(120,...infos.map(x=>x.cost));
  const unowned=infos.filter(x=>!x.owned),next=unowned.find(x=>x.cost>lovis)||unowned[0]||null,affordable=unowned.filter(x=>x.cost<=lovis),pct=Math.max(0,Math.min(100,Math.round(lovis/max*100)));
  $('.v31-lovis-ring',side)?.style.setProperty('--p',String(pct));
  setText($('.v31-lovis-ring strong',side),lovis.toLocaleString());
  setText($('.v31-lovis-ring small',side),`/ ${max} Lovis`);
  const msg=$('.v31-next-reward',side);
  if(msg){if(affordable.length)setText(msg,`You can unlock ${affordable[0].title} now.`);else if(next)setText(msg,`${Math.max(0,next.cost-lovis).toLocaleString()} Lovis until ${next.title}.`);else setText(msg,'Your reward shelf is completely unlocked. ♡');}
}
function repairRewards(root){
  const grid=$('.v27-shop-grid',root);if(!grid)return;
  let layout=$('.v31-rewards-layout',root);
  if(!layout){
    const title=$$('.v27-section-title',root).find(x=>$('h2',x)?.textContent.trim()==='Rewards');if(!title)return;
    layout=document.createElement('section');layout.className='v31-rewards-layout';
    const main=document.createElement('div');main.className='v31-reward-main';
    title.parentNode.insertBefore(layout,title);layout.appendChild(main);main.appendChild(title);main.appendChild(grid);
    const side=document.createElement('aside');side.className='v31-reward-side';
    side.innerHTML='<section class="v31-lovis-side"><div class="v31-lovis-title"><i>♡</i><span>Your Lovis</span></div><div class="v31-lovis-ring"><div><div><strong>0</strong><small>/ 120 Lovis</small></div></div></div><div class="v31-next-reward"></div></section><section class="v31-surprise-side"><h3>Little surprise corner</h3><p>Not sure what to choose? Let fate (and love) pick a reward to look at.</p><button type="button" data-v31-surprise>✦ Surprise me</button></section>';
    layout.appendChild(side);
  }
  updateRewardSide(layout,root);
}
function repairShop(){
  if(repairingShop)return;
  const root=$('#shopView');if(!root)return;
  repairingShop=true;
  try{root.classList.add('v32-shop-stable');calmShopCopy(root);repairJourney(root);repairRewards(root);}finally{repairingShop=false;}
}
function showShopImmediately(){
  const root=$('#shopView'),hub=$('#shopHub');if(!root||!hub)return;
  $$('.sheet').forEach(x=>x.classList.remove('active'));
  $$('.hub-tab').forEach(x=>x.classList.remove('active'));
  $('#tripSubnav')?.classList.add('hidden');$('#financeSubnav')?.classList.add('hidden');
  root.classList.add('active');hub.classList.add('active');
  repairShop();
}
function observeShop(){
  const root=$('#shopView');if(!root||shopObserver)return;
  shopObserver=new MutationObserver(muts=>{if(muts.some(m=>m.target===root))repairShop();});
  shopObserver.observe(root,{childList:true});repairShop();
}

/* Requested Balance & Loans copy plus clearer two-bird line art. */
const BIRDS=`<svg viewBox="0 0 320 100" role="img" aria-label="Two little birds together"><path d="M38 78c45-13 83-11 119-3 39 9 81 10 127-5"></path><path d="M82 72c-11-4-18-13-18-25 0-16 13-29 29-29 15 0 27 11 29 25 2 14-6 25-20 31"></path><path d="M78 48c8-8 22-9 31-1-3 10-13 16-24 13"></path><circle class="v32-bird-eye" cx="102" cy="33" r="1.6"></circle><path d="m120 37 12 5-12 5"></path><path d="M86 72v9m14-8v8m-18 0h9m5 0h9"></path><path d="M190 73c-13-5-20-16-18-31 2-14 14-25 29-25 16 0 29 13 29 29 0 12-7 22-18 27"></path><path d="M185 47c9-8 23-7 31 2-4 10-14 15-25 12"></path><circle class="v32-bird-eye" cx="192" cy="32" r="1.6"></circle><path d="m174 37-12 5 12 5"></path><path d="M196 72v9m14-9v9m-18 0h9m5 0h9"></path><path d="M139 70c7-8 15-9 22-2m0 0c7-8 15-8 22-1"></path><path class="v32-bird-heart" d="M151 24c5-8 16-3 12 6-3 6-12 12-12 12s-9-6-12-12c-4-9 7-14 12-6Z"></path><path d="M56 79c-8 3-14 8-18 15m234-19c9 2 16 7 21 14"></path></svg>`;
function fixBalances(){
  const root=$('#financeCurrent');if(!root)return;
  const investment=$$('.finance-current-card',root).find(card=>$('.finance-current-title span',card)?.textContent.trim().toUpperCase()==='INVESTMENTS');
  if(investment)setText($('.finance-current-title h3',investment),'My investments');
  const birds=$('.v31-birds',root);
  if(birds&&birds.dataset.v32Birds!=='1'){birds.dataset.v32Birds='1';birds.innerHTML=BIRDS;}
}
function queueBalanceFix(delay=0){clearTimeout(balanceTimer);balanceTimer=setTimeout(fixBalances,delay);}
function observeBalances(){
  const root=$('#financeCurrent');if(!root||financeObserver)return;
  financeObserver=new MutationObserver(()=>{fixBalances();queueBalanceFix(70);});
  financeObserver.observe(root,{childList:true});fixBalances();queueBalanceFix(70);
}

function init(){
  observeShop();observeBalances();repairShop();fixBalances();
  document.addEventListener('click',e=>{if(e.target.closest?.('#shopHub'))showShopImmediately();},true);
  document.addEventListener('twogether:finance-view',e=>{if(e.detail?.view==='balances'){fixBalances();queueBalanceFix(80);}});
  document.addEventListener('twogether:state-refreshed',()=>{repairShop();fixBalances();});
  document.addEventListener('twogether:v18-rendered',()=>{observeShop();observeBalances();fixBalances();});
  setTimeout(()=>{observeShop();observeBalances();repairShop();fixBalances();},180);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
