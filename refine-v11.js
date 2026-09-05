(() => {
  'use strict';

  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];

  function installHoverOpen(){
    $$('.tw-nav-wrap').forEach(wrap=>{
      if(wrap.dataset.v11Hover==='1')return;
      wrap.dataset.v11Hover='1';
      let closeTimer=null;
      const open=()=>{clearTimeout(closeTimer);wrap.classList.add('menu-open');};
      const close=()=>{clearTimeout(closeTimer);closeTimer=setTimeout(()=>wrap.classList.remove('menu-open'),220);};
      wrap.addEventListener('mouseenter',open);
      wrap.addEventListener('mouseleave',close);
      const menu=$('.tw-nav-menu',wrap);
      menu?.addEventListener('mouseenter',open);
      menu?.addEventListener('mouseleave',close);
      menu?.addEventListener('click',()=>{clearTimeout(closeTimer);wrap.classList.remove('menu-open');});
    });
  }

  function parseMoney(text){
    let s=String(text||'').replace(/[^0-9,.-]/g,'');
    if(!s)return 0;
    const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0){const dec=c>d?',':'.';const thou=dec===','?'.':',';s=s.split(thou).join('').replace(dec,'.');}
    else if(c>=0){const tail=s.length-c-1;s=tail===2?s.replace(',','.'):s.replace(/,/g,'');}
    else if(d>=0){const tail=s.length-d-1;if(tail!==2)s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function money(v){return '€'+Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});}

  function priorityNumber(value){
    const m=String(value||'').match(/P([1-5])/i);
    return m?Number(m[1]):99;
  }

  function applyWishlistFilter(root){
    const table=$('.wishlist-table',root);if(!table)return;
    const body=table.tBodies?.[0];if(!body)return;
    const rows=$$('tr',body).filter(tr=>tr.dataset.prio);
    if(!rows.length)return;

    rows.forEach((tr,i)=>{if(!tr.dataset.v11Order)tr.dataset.v11Order=String(i);});
    rows.sort((a,b)=>priorityNumber(a.dataset.prio)-priorityNumber(b.dataset.prio)||Number(a.dataset.v11Order)-Number(b.dataset.v11Order));
    rows.forEach((tr,i)=>{if(body.children[i]!==tr)body.insertBefore(tr,body.children[i]||null);});

    const filter=$('.tw-prio-filter select',root);
    if(filter&&!filter.dataset.v11){
      filter.dataset.v11='1';
      const current=filter.value||'all';
      filter.innerHTML='<option value="all">All · P1 → P5</option><option value="P1">P1 only</option><option value="P2">P2 only</option><option value="P3">P3 only</option><option value="P4">P4 only</option><option value="P5">P5 only</option>';
      filter.value=current;
      filter.addEventListener('change',()=>applyWishlistFilter(root));
    }

    const selected=filter?.value||'all';
    let visible=0,total=0;
    rows.forEach(tr=>{
      const show=selected==='all'||tr.dataset.prio===selected;
      tr.classList.toggle('v11-hidden',!show);
      if(show){
        visible++;
        total+=parseMoney($('.wishlist-price-cell',tr)?.textContent||'');
      }
    });

    const count=table.tFoot?.querySelector('small');
    if(count)count.textContent=`${visible} ${visible===1?'item':'items'}${selected==='all'?'':' · '+selected}`;
    const totalCell=table.tFoot?.querySelector('.wishlist-price-cell');
    if(totalCell)totalCell.innerHTML=`<strong>${visible?money(total):'—'}</strong>`;
  }

  function enhanceWishlist(){
    const root=$('#financeWishlist');if(!root)return;
    const table=$('.wishlist-table',root);if(!table)return;
    applyWishlistFilter(root);
  }

  function softenBudgetLanguage(){
    $$('#budgetPlanGrid .budget-plan-card').forEach(card=>{
      if(card.dataset.v11Calm==='1')return;
      card.dataset.v11Calm='1';
      const status=$('.budget-plan-status',card);
      if(status){
        const txt=status.textContent.trim();
        if(/trip expenses in progress/i.test(txt))status.textContent='In progress';
        else if(/waiting for the trip/i.test(txt))status.textContent='Planned';
        else if(/some expenses logged/i.test(txt))status.textContent='Partly logged';
        else if(/last confirmed trip/i.test(txt))status.textContent='Confirmed';
      }
      const combined=$('.budget-total-check span',card);if(combined)combined.textContent='Overall';
    });
  }

  function refresh(){
    if(window.TwogetherDev?.active)return;

    enhanceWishlist();
    softenBudgetLanguage();
  }

  document.addEventListener('DOMContentLoaded',()=>{
    refresh();
    setInterval(refresh,900);
    document.addEventListener('twogether:finance-view',e=>{if(e.detail?.view==='wishlist')setTimeout(enhanceWishlist,0);});
  });
})();

