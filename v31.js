(() => {
'use strict';
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
let polishQueued=false;

const FIN_ICONS=[
  `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="3"></rect><path d="M5 6.4 16.5 3.8c1.2-.3 2.2.6 2.2 1.7V6"></path><path d="M15 10h6v5h-6a2.5 2.5 0 0 1 0-5Z"></path><circle cx="16" cy="12.5" r=".7"></circle></svg>`,
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20v-8"></path><path d="M12 14c-4.7 0-7.2-2.8-7.2-7.7 4.9 0 7.2 2.6 7.2 7.7Z"></path><path d="M12 11.5c0-4.5 2.4-7 7.2-7.5 0 4.8-2.5 7.5-7.2 7.5Z"></path><path d="M7 20h10"></path></svg>`,
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h14"></path><polyline points="14 4 18 8 14 12"></polyline><path d="M20 16H6"></path><polyline points="10 12 6 16 10 20"></polyline></svg>`,
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h17"></path><rect x="5" y="13" width="3" height="7" rx="1"></rect><rect x="11" y="9" width="3" height="11" rx="1"></rect><rect x="17" y="4" width="3" height="16" rx="1"></rect></svg>`
];

const BIRDS=`<div class="v31-birds" aria-hidden="true"><svg viewBox="0 0 300 90"><path d="M44 67c31-13 63-10 91-1 27 9 58 10 100-2"></path><path d="M92 64c-8-9-8-19-2-26 6-7 17-8 25-2 8 6 9 17 3 25"></path><path d="M93 43c-8-1-13-5-16-11 8-1 14 1 19 6"></path><circle cx="110" cy="43" r="1.2"></circle><path d="m119 47 8 3-8 3"></path><path d="M173 64c-7-9-6-20 1-27 7-7 18-7 25 0 7 7 7 18 0 26"></path><path d="M178 38c-4-7-3-13 0-19 6 5 8 10 7 17"></path><circle cx="193" cy="43" r="1.2"></circle><path d="m201 47 8 3-8 3"></path><path d="M130 66c7-10 14-12 22-4"></path><path d="M149 63c8-9 15-10 23-3"></path><path d="M82 68c-8 2-14 7-18 14M219 67c9 2 15 6 19 13"></path><path d="M58 77c7-2 12-1 16 3M231 76c-7-2-12-1-16 3"></path><path class="fill" d="M144 26c7-9 18-2 9 8-4 5-9 8-9 8s-6-4-9-8c-7-10 4-17 9-8Z"></path></svg></div>`;

function decorateBalances(){
  const root=$('#financeCurrent');
  const grid=$('.finance-current-grid',root||document);
  if(!root||!grid)return;
  $$('.finance-current-card',grid).forEach((card,i)=>{
    if(!$('.v31-fin-icon',card)){
      const icon=document.createElement('div');icon.className='v31-fin-icon';icon.innerHTML=FIN_ICONS[i]||FIN_ICONS[0];card.appendChild(icon);
    }
  });
  if(!$('.v31-finance-love-note',root)){
    const note=document.createElement('section');note.className='v31-finance-love-note';
    note.innerHTML=`<div><span class="eyebrow">SMALL STEPS TOGETHER</span><h3>Money today, more tomorrows.</h3><p>Every balance, saving and little loan brings us closer to the life we’re building together.</p></div><div>${BIRDS}<div class="v31-birds-note">“A little progress every day adds up.” ♡</div></div>`;
    grid.insertAdjacentElement('afterend',note);
  }
}

function numberFrom(text){
  const match=String(text||'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);
  return match?Number(match[0]):0;
}
function journeyValues(score){
  const values={Principessa:0,Principe:0};
  $$('.v27-score-row',score).forEach(row=>{
    const name=$('strong',row)?.textContent.trim();
    if(name in values)values[name]=numberFrom($('span',row)?.textContent||$('b',row)?.textContent);
  });
  return values;
}
function decorateJourney(){
  const score=$('#shopView .v27-score');if(!score)return;
  score.classList.add('v31-journey');
  const values=journeyValues(score);
  $('.v31-journey-path',score)?.remove();
  const path=document.createElement('div');path.className='v31-journey-path';
  path.innerHTML=`
    <div class="v31-journey-person"><div class="v31-journey-avatar">♕</div><strong>Principessa</strong><small>${values.Principessa.toLocaleString()} Lovis</small></div>
    <div class="v31-journey-route" aria-label="Shared Lovis milestones">
      <div class="v31-milestone"><i>✓</i><span>First moments</span></div>
      <div class="v31-milestone"><i>♡</i><span>Little rewards</span></div>
      <div class="v31-milestone"><i>✦</i><span>More adventures</span></div>
    </div>
    <div class="v31-journey-person"><div class="v31-journey-avatar">♔</div><strong>Principe</strong><small>${values.Principe.toLocaleString()} Lovis</small></div>`;
  const head=$('.v27-section-title',score);head?.insertAdjacentElement('afterend',path);
}

function rewardInfo(item){
  const cost=numberFrom(item.querySelector('div:nth-child(2)>span')?.textContent);
  const title=item.querySelector('h3')?.textContent.trim()||'Reward';
  return {item,cost,title,owned:item.classList.contains('owned')};
}
function currentLovis(root){return numberFrom($('.v27-wallet strong',root)?.textContent);}
function updateRewardSide(layout,root){
  const side=$('.v31-reward-side',layout);if(!side)return;
  const lovis=currentLovis(root),infos=$$('.v27-shop-item',layout).map(rewardInfo).sort((a,b)=>a.cost-b.cost);
  const max=Math.max(120,...infos.map(x=>x.cost));
  const unowned=infos.filter(x=>!x.owned);
  const next=unowned.find(x=>x.cost>lovis)||unowned[0]||null;
  const affordable=unowned.filter(x=>x.cost<=lovis);
  const pct=Math.max(0,Math.min(100,Math.round(lovis/max*100)));
  const ring=$('.v31-lovis-ring',side);ring?.style.setProperty('--p',String(pct));
  const value=$('.v31-lovis-ring strong',side);if(value)value.textContent=lovis.toLocaleString();
  const maxEl=$('.v31-lovis-ring small',side);if(maxEl)maxEl.textContent=`/ ${max} Lovis`;
  const msg=$('.v31-next-reward',side);
  if(msg){
    if(affordable.length)msg.textContent=`You can unlock ${affordable[0].title} now.`;
    else if(next)msg.textContent=`${Math.max(0,next.cost-lovis).toLocaleString()} Lovis until ${next.title}.`;
    else msg.textContent='Your reward shelf is completely unlocked. ♡';
  }
}
function decorateRewards(){
  const root=$('#shopView');if(!root)return;
  const grid=$('.v27-shop-grid',root);if(!grid)return;
  let layout=$('.v31-rewards-layout',root);
  if(!layout){
    const title=$$('.v27-section-title',root).find(x=>$('h2',x)?.textContent.trim()==='Rewards');
    if(!title)return;
    layout=document.createElement('section');layout.className='v31-rewards-layout';
    const main=document.createElement('div');main.className='v31-reward-main';
    title.parentNode.insertBefore(layout,title);layout.appendChild(main);main.appendChild(title);main.appendChild(grid);
    const side=document.createElement('aside');side.className='v31-reward-side';
    side.innerHTML=`<section class="v31-lovis-side"><div class="v31-lovis-title"><i>♡</i><span>Your Lovis</span></div><div class="v31-lovis-ring"><div><div><strong>0</strong><small>/ 120 Lovis</small></div></div></div><div class="v31-next-reward"></div></section><section class="v31-surprise-side"><h3>Little surprise corner</h3><p>Not sure what to choose? Let fate (and love) pick a reward to look at.</p><button type="button" data-v31-surprise>✦ Surprise me</button></section>`;
    layout.appendChild(side);
  }
  updateRewardSide(layout,root);
}

function decorateAll(){polishQueued=false;decorateBalances();decorateJourney();decorateRewards();}
function schedulePolish(delay=0){
  if(delay){setTimeout(()=>schedulePolish(),delay);return;}
  if(polishQueued)return;polishQueued=true;requestAnimationFrame(decorateAll);
}

function surprise(){
  const root=$('#shopView'),layout=$('.v31-rewards-layout',root||document);if(!root||!layout)return;
  const lovis=currentLovis(root),all=$$('.v27-shop-item',layout).map(rewardInfo).filter(x=>!x.owned);
  const affordable=all.filter(x=>x.cost<=lovis),pool=affordable.length?affordable:all;if(!pool.length)return;
  $$('.v27-shop-item.v31-surprise-pick',layout).forEach(x=>x.classList.remove('v31-surprise-pick'));
  const pick=pool[Math.floor(Math.random()*pool.length)];pick.item.classList.add('v31-surprise-pick');
  pick.item.scrollIntoView({behavior:'smooth',block:'center'});
  const btn=$('[data-v31-surprise]',layout);if(btn){const old=btn.textContent;btn.textContent=`♡ ${pick.title}`;clearTimeout(btn._v31t);btn._v31t=setTimeout(()=>btn.textContent=old,1800);}
}

function init(){
  schedulePolish();schedulePolish(180);schedulePolish(750);
  document.addEventListener('twogether:finance-view',e=>{if(e.detail?.view==='balances')schedulePolish(40);});
  document.addEventListener('twogether:state-refreshed',()=>schedulePolish(70));
  document.addEventListener('twogether:v18-rendered',()=>schedulePolish(60));
  document.addEventListener('click',e=>{
    if(e.target.closest?.('[data-v31-surprise]')){e.preventDefault();surprise();return;}
    if(e.target.closest?.('#shopHub,[data-hub="finances"],[data-fin-subview="balances"],[data-buy]')){schedulePolish(80);schedulePolish(420);}
  },true);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
