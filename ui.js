/* Twogether live UI helpers — no independent backend polling. */
(() => {
  'use strict';

  const COLORS=['#8d6e63','#c8909c','#7f927a','#c09a5b','#7f91a8','#a98572','#b7a390'];

  const money=value=>'€'+Number(value||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const has=value=>value!==''&&value!=null&&Number.isFinite(Number(value));
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function parseMoney(text){
    let s=String(text||'').replace(/[^0-9,.-]/g,'');
    if(!s) return null;
    const lastComma=s.lastIndexOf(','), lastDot=s.lastIndexOf('.');
    if(lastComma>=0&&lastDot>=0){
      const decimal=lastComma>lastDot?',':'.';
      const thousands=decimal===','?'.':',';
      s=s.split(thousands).join('').replace(decimal,'.');
    }else if(lastComma>=0){
      const tail=s.length-lastComma-1;
      s=tail===2?s.replace(',','.'):s.replace(/,/g,'');
    }else if(lastDot>=0){
      const tail=s.length-lastDot-1;
      if(tail!==2)s=s.replace(/\./g,'');
    }
    const value=Number(s);
    return Number.isFinite(value)?value:null;
  }

  function actor(){
    const current=document.body.dataset.actor||'';
    if(current==='Principessa'||current==='Principe')return current;
    try{
      const saved=localStorage.getItem('twogether_actor_v1')||'';
      return saved==='Principessa'||saved==='Principe'?saved:'';
    }catch{}
    return '';
  }

  function variance(budget,actual){
    if(!has(budget))return {cls:'neutral',text:'Budget not set'};
    if(!has(actual))return {cls:'neutral',text:'Actual spend not logged yet'};
    const delta=Number(budget)-Number(actual);
    if(Math.abs(delta)<.01)return {cls:'on',text:'Exactly on budget'};
    return delta>0
      ?{cls:'under',text:`${money(delta)} under budget`}
      :{cls:'over',text:`${money(Math.abs(delta))} over budget`};
  }

  function normalizeText(value){
    return String(value||'').replace(/\s+/g,' ').trim().toLowerCase();
  }

  function installStyles(){
    if(document.getElementById('twogetherUiStyles'))return;
    const style=document.createElement('style');
    style.id='twogetherUiStyles';
    style.textContent=`
      /* Make disagreement rows unmistakable but still soft. */
      .difference-list .difference-row{background:#fffaf1!important;border-color:#ead8b9!important;align-items:center;gap:10px}
      .difference-list .difference-row>strong{color:#584c3e}
      .difference-list .difference-row>span{background:#faeee4;border:1px solid #ecd8ca;border-radius:10px;padding:7px 9px;color:#704b3e;font-weight:700}

      /* Budget comparison shared by mismatched and confirmed trips. */
      .trip-budget-comparison{margin:15px 0 17px;padding:16px;border:1px solid var(--line);border-radius:20px;background:#fbf8f3}
      .trip-budget-comparison h3{margin:0 0 4px;font-size:21px}
      .trip-budget-comparison>p{margin:0 0 13px;color:var(--muted);font-size:12px}
      .trip-budget-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
      .trip-budget-item{padding:13px 14px;border:1px solid var(--line);border-radius:16px;background:#fff}
      .trip-budget-item>span{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:800}
      .trip-budget-item>strong{display:block;font-size:20px;margin:4px 0 2px}
      .trip-budget-item>small{display:block;color:var(--muted);line-height:1.4}
      .trip-budget-item.under{background:#edf4e9;border-color:#cfdfc8;box-shadow:inset 3px 0 0 #93b489}
      .trip-budget-item.under small{color:#456b4b;font-weight:700}
      .trip-budget-item.over{background:#f8ebe8;border-color:#e8c7c0;box-shadow:inset 3px 0 0 #c9877a}
      .trip-budget-item.over small{color:#964e43;font-weight:700}
      .trip-budget-item.on{background:#f1f0eb;border-color:#ddd8d0}

      /* Before-save individual budget check. */
      .review-budget-check{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line);border-radius:17px;overflow:hidden;margin:0 0 13px;background:#fff}
      .review-budget-check>div{padding:12px 13px;border-right:1px solid var(--line);display:grid;gap:3px}
      .review-budget-check>div:last-child{border-right:0}
      .review-budget-check span{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:800}
      .review-budget-check strong{font-size:18px}
      .review-budget-check.under .review-budget-result{background:#edf4e9;color:#456b4b}
      .review-budget-check.over .review-budget-result{background:#f8ebe8;color:#964e43}
      .review-budget-check.on .review-budget-result{background:#f1f0eb}
      .v5-review-row.review-paid-under{background:#edf4e9!important;box-shadow:inset 3px 0 0 #93b489}
      .v5-review-row.review-paid-over{background:#f8ebe8!important;box-shadow:inset 3px 0 0 #c9877a}
      .v5-review-row.review-paid-on{background:#f1f0eb!important}

      /* Confirmed spending overview. */
      .confirmed-spend-overview{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(240px,.85fr);gap:14px;margin:16px 0}
      .confirmed-spend-card,.confirmed-glance-card{background:#fffefa;border:1px solid var(--line);border-radius:20px;padding:18px}
      .confirmed-spend-card h3,.confirmed-glance-card h3{margin:0 0 15px;font-size:20px;font-weight:600}
      .confirmed-donut{width:170px;height:170px;border-radius:50%;display:grid;place-items:center;margin:4px auto 18px;position:relative}
      .confirmed-donut::after{content:"";position:absolute;width:106px;height:106px;border-radius:50%;background:#fffefa;box-shadow:inset 0 0 0 1px rgba(80,65,52,.04)}
      .confirmed-donut-center{position:relative;z-index:1;display:grid;text-align:center}
      .confirmed-donut-center strong{font-size:22px}.confirmed-donut-center span{font-size:11px;color:var(--muted);margin-top:2px}
      .confirmed-legend{display:grid;gap:7px}.confirmed-legend-row{display:grid;grid-template-columns:10px minmax(0,1fr) auto auto;gap:8px;align-items:center;min-height:25px;font-size:12px}
      .confirmed-legend-row i{width:9px;height:9px;border-radius:50%}.confirmed-legend-row span{color:var(--muted)}.confirmed-legend-row strong{font-size:12px}.confirmed-legend-row small{color:var(--muted);min-width:34px;text-align:right}
      .confirmed-glance-list{display:grid}.confirmed-glance-row{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #eee7df}.confirmed-glance-row:last-child{border-bottom:0}.confirmed-glance-row span{color:var(--muted);font-size:12px}.confirmed-glance-row strong{text-align:right;font-size:13px}
      .budget-locked-note{font-size:11px;color:var(--muted);padding:8px 2px 0}
      @media(max-width:720px){.trip-budget-grid,.review-budget-check,.confirmed-spend-overview{grid-template-columns:1fr}.review-budget-check>div{border-right:0;border-bottom:1px solid var(--line)}.review-budget-check>div:last-child{border-bottom:0}.confirmed-donut{width:150px;height:150px}.confirmed-donut::after{width:94px;height:94px}}
    `;
    document.head.appendChild(style);
  }

  function parseBudgetPerson(person){
    if(!person)return {budget:null,actual:null};
    const strong=person.querySelector('strong')?.textContent||'';
    const small=person.querySelector('small')?.textContent||'';
    const budget=/€/.test(strong)?parseMoney(strong):null;
    const actualMatch=small.match(/actual\s+([^·]+)/i);
    return {budget,actual:actualMatch?parseMoney(actualMatch[1]):null};
  }

  function readBudgetPlans(){
    return [...document.querySelectorAll('#budgetPlanGrid .budget-plan-card')].map(card=>{
      const people=[...card.querySelectorAll('.budget-person')];
      return {
        id:card.dataset.v5Plan||'',
        city:(card.querySelector('.budget-plan-top h3')?.textContent||'').trim(),
        dates:(card.querySelector('.budget-plan-top p')?.textContent||'').trim(),
        Principessa:parseBudgetPerson(people[0]),
        Principe:parseBudgetPerson(people[1]),
        card
      };
    });
  }

  function findPlanForModal(root){
    const city=(root.querySelector('.trip-modal-heading h2')?.textContent||'').trim();
    const dates=(root.querySelector('.trip-modal-heading p')?.textContent||'').trim();
    if(!city)return null;
    const plans=readBudgetPlans();
    return plans.find(p=>normalizeText(p.city)===normalizeText(city)&&normalizeText(p.dates)===normalizeText(dates))
      ||plans.find(p=>normalizeText(p.city)===normalizeText(city))
      ||null;
  }

  function paidFromSubmission(root,name){
    const cards=[...root.querySelectorAll('.submission-card')];
    const card=cards.find(c=>normalizeText(c.querySelector(':scope > span')?.textContent)===normalizeText(name));
    if(!card)return null;
    const text=card.querySelector(':scope > small')?.textContent||'';
    const match=text.match(/Paid:\s*([^·]+)/i);
    return match?parseMoney(match[1]):null;
  }

  function budgetItem(label,budget,actual){
    const v=variance(budget,actual);
    return `<div class="trip-budget-item ${v.cls}"><span>${esc(label)}</span><strong>${has(budget)?money(budget):'Not set'}</strong><small>${esc(v.text)}${has(actual)?` · actual ${money(actual)}`:''}</small></div>`;
  }

  function decorateTripBudget(){
    const root=document.getElementById('tripModalBody');
    if(!root||!root.children.length)return;
    const plan=findPlanForModal(root);
    if(!plan)return;

    const pBudget=plan.Principessa.budget;
    const qBudget=plan.Principe.budget;
    const pPaid=paidFromSubmission(root,'Principessa')??plan.Principessa.actual;
    const qPaid=paidFromSubmission(root,'Principe')??plan.Principe.actual;
    const combinedBudget=has(pBudget)&&has(qBudget)?pBudget+qBudget:null;
    const combinedPaid=has(pPaid)&&has(qPaid)?pPaid+qPaid:null;
    const combinedVar=variance(combinedBudget,combinedPaid);
    const signature=[pBudget,qBudget,pPaid,qPaid].map(v=>v==null?'':v).join('|');
    const old=root.querySelector('.trip-budget-comparison');
    if(old?.dataset.signature===signature)return;
    old?.remove();

    const summary=root.querySelector('.budget-check');
    if(summary){
      summary.classList.remove('ok','warn');
      if(combinedVar.cls==='under'||combinedVar.cls==='on')summary.classList.add('ok');
      if(combinedVar.cls==='over')summary.classList.add('warn');
      summary.innerHTML=`<div><span>Planned budgets</span><strong>${has(combinedBudget)?money(combinedBudget):'Not fully set'}</strong></div><div><span>Combined actually paid</span><strong>${has(combinedPaid)?money(combinedPaid):'Waiting for both'}</strong></div><div class="budget-result"><span>Budget check</span><strong>${esc(combinedVar.text)}</strong></div>`;
    }

    const box=document.createElement('section');
    box.className='trip-budget-comparison';
    box.dataset.signature=signature;
    box.innerHTML=`<h3>Budget comparison</h3><p>Planned limits compared with what each of you actually paid.</p><div class="trip-budget-grid">${budgetItem('Principessa',pBudget,pPaid)}${budgetItem('Principe',qBudget,qPaid)}${budgetItem('Combined',combinedBudget,combinedPaid)}</div>`;
    const differences=root.querySelector('.difference-list');
    const analysis=root.querySelector('.confirmed-spend-overview');
    const submissions=root.querySelector('.submission-grid');
    const anchor=differences||analysis||submissions;
    if(anchor)anchor.parentNode.insertBefore(box,anchor);
    else root.appendChild(box);
  }

  function categoryData(card){
    return [...(card?.querySelectorAll('.submission-mini > div')||[])].map(row=>({
      label:row.querySelector('span')?.textContent?.trim()||'',
      amount:parseMoney(row.querySelector('b')?.textContent||'')||0
    })).filter(x=>x.label&&x.amount>0).sort((a,b)=>b.amount-a.amount);
  }

  function decorateConfirmedSpend(){
    const root=document.getElementById('tripModalBody');
    if(!root||root.querySelector('.confirmed-spend-overview'))return;
    const confirmed=[...root.querySelectorAll('.match-box.ok strong')].some(el=>/confirmed by both/i.test(el.textContent||''));
    if(!confirmed)return;
    const cards=[...root.querySelectorAll('.submission-card')];
    if(cards.length<2)return;
    const categories=categoryData(cards[0]);
    const total=parseMoney(root.querySelector('.trip-modal-total strong')?.textContent)||0;
    const safeTotal=Math.max(total,.01);
    let degrees=0;
    const stops=categories.map((item,index)=>{
      const start=degrees;
      degrees+=(item.amount/safeTotal)*360;
      return `${COLORS[index%COLORS.length]} ${start}deg ${degrees}deg`;
    }).join(',');
    const legend=categories.length?categories.map((item,index)=>`<div class="confirmed-legend-row"><i style="background:${COLORS[index%COLORS.length]}"></i><span>${esc(item.label)}</span><strong>${money(item.amount)}</strong><small>${((item.amount/safeTotal)*100).toFixed(0)}%</small></div>`).join(''):'<div class="empty-state">No spending entered yet.</div>';
    const analysis=document.createElement('div');
    analysis.className='confirmed-spend-overview';
    analysis.innerHTML=`<section class="confirmed-spend-card"><h3>Where the money went</h3>${categories.length?`<div class="confirmed-donut" style="background:conic-gradient(${stops})"><div class="confirmed-donut-center"><strong>${money(total)}</strong><span>total spent</span></div></div>`:''}<div class="confirmed-legend">${legend}</div></section><section class="confirmed-glance-card"><h3>At a glance</h3><div class="confirmed-glance-list"><div class="confirmed-glance-row"><span>Biggest category</span><strong>${esc(categories[0]?.label||'—')}</strong></div><div class="confirmed-glance-row"><span>Principessa paid</span><strong>${money(paidFromSubmission(root,'Principessa')||0)}</strong></div><div class="confirmed-glance-row"><span>Principe paid</span><strong>${money(paidFromSubmission(root,'Principe')||0)}</strong></div></div></section>`;
    const submissions=root.querySelector('.submission-grid');
    if(submissions)submissions.parentNode.insertBefore(analysis,submissions);
    else root.appendChild(analysis);
  }

  function decorateTripModal(){
    decorateTripBudget();
    decorateConfirmedSpend();
  }

  function decorateReviewBudget(){
    const overlay=document.getElementById('workflowV5Overlay');
    if(!overlay?.classList.contains('show'))return;
    const heading=overlay.querySelector('h2')?.textContent?.trim()||'';
    if(heading!=='Ready to save your actual expenses?')return;
    const reference=overlay.querySelector('.v5-reference');
    if(!reference)return;
    const budget=parseMoney(reference.querySelector('strong')?.textContent);
    const rows=[...overlay.querySelectorAll('.v5-review-row')];
    const paidRow=rows.find(row=>/actually paid/i.test(row.querySelector('span')?.textContent||''));
    const paid=parseMoney(paidRow?.querySelector('strong')?.textContent);
    if(!has(budget)||!has(paid))return;
    const v=variance(budget,paid);
    const signature=`${budget}|${paid}`;
    let box=overlay.querySelector('.review-budget-check');
    if(box?.dataset.signature===signature)return;
    box?.remove();
    box=document.createElement('div');
    box.className=`review-budget-check ${v.cls}`;
    box.dataset.signature=signature;
    box.innerHTML=`<div><span>Your planned budget</span><strong>${money(budget)}</strong></div><div><span>You actually paid</span><strong>${money(paid)}</strong></div><div class="review-budget-result"><span>Result</span><strong>${esc(v.text)}</strong></div>`;
    reference.insertAdjacentElement('afterend',box);
    paidRow?.classList.remove('review-paid-under','review-paid-over','review-paid-on');
    if(v.cls==='under')paidRow?.classList.add('review-paid-under');
    if(v.cls==='over')paidRow?.classList.add('review-paid-over');
    if(v.cls==='on')paidRow?.classList.add('review-paid-on');
  }

  function fixActivityLabels(){
    const root=document.getElementById('activityList');
    if(!root)return;
    root.querySelectorAll('.activity-item').forEach(item=>{
      const wrap=item.querySelector('div');
      const who=item.querySelector('strong')?.textContent?.trim()||'';
      if(!wrap)return;
      [...wrap.childNodes].forEach(node=>{
        if(node.nodeType!==Node.TEXT_NODE)return;
        const possessive=who==='Principessa'?'her':who==='Principe'?'his':'their';
        node.textContent=(node.textContent||'')
          .replace(/setIndividualBudget/g,`set ${possessive} trip budget`)
          .replace(/savePartialActual/g,'saved early trip expenses');
      });
    });
  }

  function lockSubmittedBudgetButtons(){
    const current=actor();
    const grid=document.getElementById('budgetPlanGrid');
    if(!current||!grid)return;
    const index=current==='Principessa'?0:1;
    [...grid.querySelectorAll('.budget-plan-card')].forEach(card=>{
      const mine=[...card.querySelectorAll('.budget-person')][index];
      const hasActual=/\bactual\s+€|saved early:/i.test(mine?.querySelector('small')?.textContent||'');
      const edit=card.querySelector('[data-v5-own-budget]');
      let note=card.querySelector('.budget-locked-note');
      if(hasActual){
        if(edit)edit.style.display='none';
        if(!note){
          note=document.createElement('div');
          note.className='budget-locked-note';
          note.textContent='Your planned budget is locked because you already logged your actual expenses.';
          card.querySelector('.budget-plan-actions')?.appendChild(note);
        }
      }else{
        if(edit)edit.style.display='';
        note?.remove();
      }
    });
  }

  function syncBudgetHeaderButton(){
    const header=document.querySelector('[data-v5-new-plan]');
    const grid=document.getElementById('budgetPlanGrid');
    if(!header||!grid)return;
    const current=actor();
    const index=current==='Principessa'?0:1;
    const openCards=[...grid.querySelectorAll('.budget-plan-card')].filter(card=>!card.classList.contains('hidden'));
    const card=openCards[0]||null;
    if(!card){
      header.textContent='Plan a trip budget';
      header.disabled=false;
      header.dataset.v6Mode='new';
      delete header.dataset.v6PlanId;
      return;
    }
    const mine=[...card.querySelectorAll('.budget-person')][index];
    const hasActual=/\bactual\s+€|saved early:/i.test(mine?.querySelector('small')?.textContent||'');
    const ownButton=card.querySelector('[data-v5-own-budget]');
    if(hasActual){
      header.textContent='Budget locked';
      header.disabled=true;
      header.dataset.v6Mode='locked';
      return;
    }
    if(ownButton){
      header.textContent=ownButton.textContent.trim();
      header.disabled=false;
      header.dataset.v6Mode='existing';
      header.dataset.v6PlanId=card.dataset.v5Plan||'';
    }
  }

  function refreshBudgetUi(){
    lockSubmittedBudgetButtons();
    syncBudgetHeaderButton();
    decorateTripModal();
  }

  document.addEventListener('click',event=>{
    const header=event.target.closest?.('[data-v5-new-plan]');
    if(header?.dataset.v6Mode==='existing'){
      const card=document.querySelector(`[data-v5-plan="${CSS.escape(header.dataset.v6PlanId||'')}"]`);
      const target=card?.querySelector('[data-v5-own-budget]');
      if(target){event.preventDefault();event.stopImmediatePropagation();target.click();return;}
    }
    if(event.target.closest?.('[data-open-trip]'))requestAnimationFrame(()=>requestAnimationFrame(decorateTripModal));
  },true);

  function init(){
    installStyles();
    const modalBody=document.getElementById('tripModalBody');
    if(modalBody)new MutationObserver(()=>requestAnimationFrame(decorateTripModal)).observe(modalBody,{childList:true});
    const overlay=document.getElementById('workflowV5Overlay');
    if(overlay)new MutationObserver(()=>requestAnimationFrame(decorateReviewBudget)).observe(overlay,{childList:true,subtree:false});
    const grid=document.getElementById('budgetPlanGrid');
    if(grid)new MutationObserver(()=>requestAnimationFrame(refreshBudgetUi)).observe(grid,{childList:true});
    const activity=document.getElementById('activityList');
    if(activity)new MutationObserver(fixActivityLabels).observe(activity,{childList:true});
    fixActivityLabels();
    refreshBudgetUi();
    decorateReviewBudget();
  }

  document.addEventListener('DOMContentLoaded',init);
})();
