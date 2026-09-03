(() => {
  'use strict';

  const COLORS=['#8d6e63','#c8909c','#7f927a','#c09a5b','#7f91a8','#a98572','#b7a390'];

  function parseMoney(text){
    let s=String(text||'').replace(/[^0-9,.-]/g,'');
    if(!s) return 0;
    const lastComma=s.lastIndexOf(','), lastDot=s.lastIndexOf('.');
    if(lastComma>=0 && lastDot>=0){
      const decimal=lastComma>lastDot?',':'.';
      const thousands=decimal===','?'.':',';
      s=s.split(thousands).join('').replace(decimal,'.');
    }else if(lastComma>=0){
      const tail=s.length-lastComma-1;
      s=tail===2?s.replace(',','.'):s.replace(/,/g,'');
    }else if(lastDot>=0){
      const tail=s.length-lastDot-1;
      if(tail!==2) s=s.replace(/\./g,'');
    }
    const value=Number(s);
    return Number.isFinite(value)?value:0;
  }

  function money(value){
    return '€'+Number(value||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  function paidFromCard(card){
    const text=card?.querySelector('small')?.textContent||'';
    const match=text.match(/Paid:\s*([^·]+)/i);
    return match?parseMoney(match[1]):0;
  }

  function categoryData(card){
    return [...(card?.querySelectorAll('.submission-mini > div')||[])].map(row=>({
      label:row.querySelector('span')?.textContent?.trim()||'',
      amount:parseMoney(row.querySelector('b')?.textContent||'')
    })).filter(x=>x.label && x.amount>0).sort((a,b)=>b.amount-a.amount);
  }

  function decorateConfirmedTrip(){
    const root=document.getElementById('tripModalBody');
    if(!root || root.querySelector('.confirmed-spend-overview')) return;

    const status=[...root.querySelectorAll('.match-box.ok strong')]
      .some(el=>/confirmed by both/i.test(el.textContent||''));
    if(!status) return;

    const cards=[...root.querySelectorAll('.submission-card')];
    if(cards.length<2) return;

    const categories=categoryData(cards[0]);
    const total=parseMoney(root.querySelector('.trip-modal-total strong')?.textContent||cards[0].querySelector(':scope > strong')?.textContent||'');
    const safeTotal=Math.max(total,0.01);
    let deg=0;
    const stops=categories.map((item,index)=>{
      const start=deg;
      deg+=(item.amount/safeTotal)*360;
      return `${COLORS[index%COLORS.length]} ${start}deg ${deg}deg`;
    }).join(',');

    const legend=categories.length?categories.map((item,index)=>{
      const pct=(item.amount/safeTotal)*100;
      return `<div class="confirmed-legend-row"><i style="background:${COLORS[index%COLORS.length]}"></i><span>${item.label}</span><strong>${money(item.amount)}</strong><small>${pct.toFixed(0)}%</small></div>`;
    }).join(''):'<div class="empty-state">No spending entered yet.</div>';

    const analysis=document.createElement('div');
    analysis.className='confirmed-spend-overview';
    analysis.innerHTML=`
      <section class="confirmed-spend-card">
        <h3>Where the money went</h3>
        ${categories.length?`<div class="confirmed-donut" style="background:conic-gradient(${stops})"><div class="confirmed-donut-center"><strong>${money(total)}</strong><span>total spent</span></div></div>`:''}
        <div class="confirmed-legend">${legend}</div>
      </section>
      <section class="confirmed-glance-card">
        <h3>At a glance</h3>
        <div class="confirmed-glance-list">
          <div class="confirmed-glance-row"><span>Biggest category</span><strong>${categories[0]?.label||'—'}</strong></div>
          <div class="confirmed-glance-row"><span>Principessa paid</span><strong>${money(paidFromCard(cards[0]))}</strong></div>
          <div class="confirmed-glance-row"><span>Principe paid</span><strong>${money(paidFromCard(cards[1]))}</strong></div>
          <div class="confirmed-glance-row"><span>Data quality</span><strong>Confirmed & matched</strong></div>
        </div>
      </section>`;

    const submissions=root.querySelector('.submission-grid');
    if(submissions) submissions.parentNode.insertBefore(analysis,submissions);
    else root.appendChild(analysis);
  }

  document.addEventListener('click',event=>{
    if(event.target.closest?.('[data-open-trip]')) setTimeout(decorateConfirmedTrip,0);
  });

  document.addEventListener('DOMContentLoaded',()=>{
    const root=document.getElementById('tripModalBody');
    if(!root) return;
    new MutationObserver(()=>decorateConfirmedTrip()).observe(root,{childList:true});
  });
})();
