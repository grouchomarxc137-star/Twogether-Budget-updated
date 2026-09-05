(() => {
  'use strict';
  const labels={accom:'Accommodation',travel:'Flights / Train'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount=v=>Number(String(v).replace(',','.'));
  const valid=v=>String(v??'').trim()!==''&&Number.isFinite(amount(v))&&amount(v)>=0;
  const money=v=>'€'+Number(v||0).toFixed(2);
  function render({host,plan,key,onDone}){
    const actor=document.body.dataset.actor,other=actor==='Principessa'?'Principe':'Principessa';
    const meta=plan.sharedExpenses?.[key]||{},known=meta.total!==''&&meta.total!=null;
    let total=known?String(meta.total):'',unknown=false,mode=meta.mode?.[actor]||'',paid=meta.paid?.[actor]??'';
    let stage=known&&meta.mode?.[other]==='shared'?'paid':'total';
    if((paid===''||!meta.mode?.[actor])&&known)paid=String(Math.max(0,amount(total)-amount(meta.paid?.[other]||0)));
    let busy=false;
    function draw(){
      const calc=key==='accom'?`<p class="shared-calculation">20% = <strong data-calc>${money(amount(total||0)*.2)}</strong></p>`:'';
      const details=known?`<p>Total: ${money(meta.total)} · ${esc(other)} paid ${meta.paid?.[other]===''||meta.paid?.[other]==null?'not recorded':money(meta.paid[other])}</p>`:'';
      let body='';
      if(stage==='total')body=`<h2>Total ${labels[key]}</h2>${details}<label>Total bill<input id="sharedTotal" class="big-input" inputmode="decimal" value="${esc(total)}"></label>${calc}<div class="v5-actions"><button type="button" data-unknown>I don’t know the total</button><button type="button" class="btn primary" data-next>Next</button></div>`;
      if(stage==='mode')body=`<h2>Who paid this?</h2><p>Total: ${money(total)}</p>${calc}<div class="v5-choice-stack"><button type="button" class="trip-pick" data-mode="full">I paid it fully myself</button><button type="button" class="trip-pick" data-mode="shared">It’s shared</button></div><button type="button" data-back>Back</button>`;
      if(stage==='paid')body=`<h2>How much did you pay for ${labels[key].toLowerCase()}?</h2>${details}<p>${unknown?'The total is unknown. Save your payment now and resolve the total later.':`Suggested remaining share: ${money(Math.max(0,amount(total)-amount(meta.paid?.[other]||0)))}. You can change this amount.`}</p>${unknown?'':calc}<label>Your payment<input id="sharedPaid" class="big-input" inputmode="decimal" value="${esc(paid)}"></label><div class="v5-actions"><button type="button" data-back>Back</button><button type="button" class="btn primary" data-save>Save & continue</button></div>`;
      host.innerHTML=`<section class="shared-entry">${body}<p role="status" data-error></p></section>`;
      const input=host.querySelector('input');input?.focus();
      input?.addEventListener('input',()=>{if(stage==='total'){total=input.value;const calc=host.querySelector('[data-calc]');if(calc)calc.textContent=valid(total)?money(amount(total)*.2):'€0.00';}else paid=input.value;});
      host.querySelector('[data-next]')?.addEventListener('click',()=>{if(!valid(total))return error('Enter a non-negative total, or choose “I don’t know the total”.');unknown=false;if(paid==='')paid=String(Math.max(0,amount(total)-amount(meta.paid?.[other]||0)));stage='mode';draw();});
      host.querySelector('[data-unknown]')?.addEventListener('click',()=>{unknown=!known;total=known?String(meta.total):'';mode='shared';stage='paid';draw();});
      host.querySelector('[data-back]')?.addEventListener('click',()=>{stage='total';draw();});
      host.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;if(mode==='full'){paid=total;save();}else{stage='paid';draw();}}));
      host.querySelector('[data-save]')?.addEventListener('click',()=>{mode='shared';save();});
    }
    function error(message){host.querySelector('[data-error]').textContent=message;}
    async function save(){
      if(busy)return;if(!valid(paid))return error('Enter a non-negative payment.');
      busy=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{
        const result=await window.TwogetherAPI.post('saveSharedExpense',{planId:plan.id,key,total,mode,paid,unknown,totalUncertain:unknown,expectedTotal:meta.total??''},actor);
        plan.sharedExpenses={...plan.sharedExpenses,[key]:result.sharedExpense};
        if(host.isConnected)onDone(result.sharedExpense.total===''?'0':String(result.sharedExpense.total),result.sharedExpense.total==='');
      }catch(e){if(host.isConnected){error(e.message);host.querySelectorAll('button').forEach(b=>b.disabled=false);}}finally{busy=false;}
    }
    draw();return true;
  }
  window.TwogetherShared={render};
})();
