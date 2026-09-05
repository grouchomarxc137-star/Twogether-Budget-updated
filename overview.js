(() => {
  'use strict';
  const names=['Principessa','Principe'],keys=['travel','accom','fuel','groceries','eat','tolls','other'];
  const labels={travel:'Flights / Train',accom:'Accommodation',fuel:'Fuel',groceries:'Groceries',eat:'Eating out',tolls:'Tolls / Parking',other:'Other',otherNote:'Note'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const has=v=>v!==''&&v!=null;
  const n=v=>Number(String(v??0).replace(',','.'))||0;
  const money=v=>'€'+n(v).toFixed(2);
  let latest=null,dialog=null,opened=null,refreshing=false;
  function records(plan,trip){return names.map(name=>trip?.submissions?.[name]||plan?.partials?.[name]||{});}
  function total(plan,trip){const [a,b]=records(plan,trip);return keys.reduce((sum,key)=>{const m=plan?.sharedExpenses?.[key]||trip?.sharedExpenses?.[key];return sum+(has(m?.total)?n(m.total):Math.max(n(a[key]),n(b[key])));},0);}
  function metrics(plan,trip){return `<div class="overview-metrics">${names.map(name=>`<div><span>${name} budget</span><strong>${has(plan?.budgets?.[name])?money(plan.budgets[name]):'Not set'}</strong></div>`).join('')}<div><span>Total budget</span><strong>${names.some(name=>has(plan?.budgets?.[name]))?money(names.reduce((s,name)=>s+n(plan.budgets[name]),0)):has(trip?.budget)?money(trip.budget):'Not set'}</strong></div><div><span>Trip so far</span><strong>${money(total(plan,trip))}</strong></div></div>`;}
  function warnings(plan,trip){
    const result=[];
    for(const key of ['accom','travel']){const m=plan?.sharedExpenses?.[key]||trip?.sharedExpenses?.[key];if(!m?.mode||!names.some(name=>m.mode[name]))continue;
      if(names.every(name=>has(m.totals?.[name]))&&Math.abs(n(m.totals.Principessa)-n(m.totals.Principe))>.005)result.push(`${labels[key]}: you entered different total bills. Resolve the total in the overview.`);
      if(!has(m.total)||m.totalUncertain){result.push(`${labels[key]} total needs resolving.`);continue;}
      if(!names.some(name=>m.mode[name]==='full')&&names.some(name=>!has(m.paid?.[name]))){result.push(`${labels[key]} is waiting for both payments.`);continue;}
      const delta=n(m.total)-names.reduce((s,name)=>s+n(m.paid?.[name]),0);if(Math.abs(delta)>.005)result.push(`${labels[key]}: payments differ from the bill by ${money(Math.abs(delta))}.`);
    }
    if(names.every(name=>trip?.submissions?.[name])){const paid=names.reduce((s,name)=>s+n(trip.submissions[name].paid),0),delta=total(plan,trip)-paid;if(Math.abs(delta)>.005)result.push(`${money(total(plan,trip))} expenses recorded; ${money(paid)} paid. Difference: ${money(Math.abs(delta))}.`);}
    return result;
  }
  function close(){dialog?.remove();dialog=null;opened=null;}
  function open(plan){if(!plan)return;opened=plan.id;draw(plan);}
  function paymentCard(plan,key,locked){const m=plan.sharedExpenses?.[key]||{};return `<section class="overview-payment"><strong>${labels[key]}</strong><p>Total: ${has(m.total)?money(m.total):'Not known'}${key==='accom'&&has(m.total)?` · 20% = ${money(n(m.total)*.2)}`:''}</p>${names.map(name=>`<p>${name}: ${has(m.paid?.[name])?money(m.paid[name]):'Not logged'}${m.mode?.[name]==='full'?' · fully paid':''}${m.mode?.[name]==='shared'?' · shared':''}</p>`).join('')}${locked?'':`<button data-payment="${key}" type="button">Edit my payment / total</button>`}</section>`;}
  function draw(plan){
    dialog?.remove();dialog=document.createElement('dialog');dialog.className='current-overview';
    const trip=latest?.trips?.find(t=>t.id===plan.linkedTripId),[a,b]=records(plan,trip),issues=warnings(plan,trip);
    const fields=[...keys,'otherNote'];
    const diff=fields.filter(key=>has(a[key])&&has(b[key])&&(keys.includes(key)?Math.abs(n(a[key])-n(b[key]))>.005:String(a[key]).trim()!==String(b[key]).trim()));
    const locked=names.every(name=>trip?.confirmed?.[name]);
    const stateText=locked?'Confirmed by both of you':diff.length?`${diff.length} difference${diff.length===1?'':'s'} still to resolve`:'In progress — confirm when all details and payments are complete.';
    dialog.innerHTML=`<button class="trip-close" data-overview-close aria-label="Close overview">×</button><div class="overview-shell"><header class="overview-hero"><h2>${esc(plan.meta?.city||'Current trip')}</h2><p>${esc(plan.meta?.start)} – ${esc(plan.meta?.end)}</p>${metrics(plan,trip)}</header><div class="overview-scroll"><p class="overview-state">${esc(stateText)}</p>${issues.map(x=>`<p class="reconcile-warning">${esc(x)}</p>`).join('')}<div class="overview-table"><table><thead><tr><th>Expense / detail</th><th>Principessa</th><th>Principe</th><th>Match</th></tr></thead><tbody>${fields.map(key=>{const different=diff.includes(key);return `<tr class="${different?'has-difference':''}"><th>${esc(labels[key]||key)}</th>${[a,b].map(r=>`<td>${has(r[key])?esc(keys.includes(key)?money(r[key]):r[key]):'Not logged'}${r.uncertain?.[key]?' · estimate':''}</td>`).join('')}<td>${different?'Needs review':(has(a[key])&&has(b[key])?'Matched':'Waiting')}</td></tr>`;}).join('')}</tbody></table></div><h3 class="overview-shared-title">Shared payments</h3><div class="overview-payment-grid">${['accom','travel'].map(key=>paymentCard(plan,key,locked)).join('')}</div><div class="v5-actions">${locked?'':'<button type="button" data-budget>Edit my budget</button><button type="button" data-expenses>Add / edit expenses</button>'}${trip&&!locked?'<button type="button" data-match>Match differences</button><button type="button" data-confirm>Confirm my version</button>':''}</div><p data-overview-error role="status"></p></div></div>`;
    document.body.appendChild(dialog);dialog.showModal();dialog.addEventListener('cancel',close);
    dialog.querySelector('[data-overview-close]').onclick=close;
    dialog.querySelector('[data-budget]')?.addEventListener('click',()=>{close();window.TwogetherWorkflow.budget(plan.id);});
    dialog.querySelector('[data-expenses]')?.addEventListener('click',()=>{close();window.TwogetherWorkflow.start(plan.id);});
    dialog.querySelector('[data-match]')?.addEventListener('click',()=>{close();window.TwogetherWorkflow.match(trip.id);});
    dialog.querySelector('[data-confirm]')?.addEventListener('click',async()=>{try{await window.TwogetherAPI.post('confirmTrip',{id:trip.id},document.body.dataset.actor);await refresh();draw(latest.plans.find(p=>p.id===plan.id)||plan);}catch(e){dialog.querySelector('[data-overview-error]').textContent=e.message;}});
    dialog.querySelectorAll('[data-payment]').forEach(btn=>btn.onclick=()=>openPaymentEditor(plan,btn.dataset.payment));
  }
  function openPaymentEditor(plan,key){
    if(!dialog)return;dialog.innerHTML='<button class="trip-close" data-overview-close aria-label="Close overview">×</button><div class="overview-shell"><div class="overview-scroll"><div data-payment-host></div><div class="v5-actions"><button type="button" data-payment-back>Back to overview</button></div></div></div>';
    dialog.querySelector('[data-overview-close]').onclick=close;const host=dialog.querySelector('[data-payment-host]');
    window.TwogetherShared.render({host,plan,key,onDone:async()=>{await refresh();draw(latest.plans.find(p=>p.id===plan.id)||plan);}});
    dialog.querySelector('[data-payment-back]').onclick=()=>draw(plan);
  }
  async function refresh(){if(refreshing)return;refreshing=true;try{latest=await window.TwogetherAPI.state();}catch{}finally{refreshing=false;}}
  function navigation(){
    const wraps=[...document.querySelectorAll('.tw-nav-wrap')];let pinned=null,timer;
    function set(wrap){wraps.forEach(w=>{const show=w===wrap;w.classList.toggle('nav-visible',show);w.querySelector('[data-hub]')?.setAttribute('aria-expanded',String(show));});}
    for(const w of wraps){w.addEventListener('mouseenter',()=>{clearTimeout(timer);set(w);});w.addEventListener('mouseleave',()=>{timer=setTimeout(()=>set(pinned),180);});w.addEventListener('focusin',()=>{clearTimeout(timer);set(w);});w.querySelector('[data-hub]').addEventListener('click',()=>{clearTimeout(timer);pinned=pinned===w?null:w;set(pinned);});w.querySelector('.tw-nav-menu').addEventListener('click',()=>{clearTimeout(timer);pinned=null;set(null);});}
    document.addEventListener('click',e=>{if(!e.target.closest('.tw-nav-wrap')){pinned=null;set(null);}});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){pinned=null;set(null);}});
  }
  document.addEventListener('keydown',e=>{
    if(e.defaultPrevented||e.key!=='Enter'||e.isComposing||e.shiftKey||e.ctrlKey||e.altKey||e.metaKey||!e.target.matches('input,select'))return;
    const root=e.target.closest('.shared-entry,#wizardCard,#workflowV5Overlay,#workflowBudgetModal');if(!root)return;
    const target=[...root.querySelectorAll('[data-next],[data-save],[data-wizard-next],[data-v5-next],[data-v5-partial-next],[data-v5-match-next],button')].find(b=>!b.disabled&&b.getClientRects().length&&/^(Next|Continue|Save)/i.test(b.textContent.trim()));
    if(target){e.preventDefault();e.stopImmediatePropagation();target.click();}
  },true);
  document.addEventListener('DOMContentLoaded',()=>{navigation();refresh();setInterval(refresh,5000);});
  document.addEventListener('twogether:saved',()=>{refresh();window.TwogetherWorkflow.refresh().catch(()=>{});window.dispatchEvent(new Event('focus'));});
  window.TwogetherOverview={open,total,warnings,metrics};
})();
