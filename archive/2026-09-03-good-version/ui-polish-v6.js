(() => {
  'use strict';

  function fixActivityLabels(){
    const root=document.getElementById('activityList');
    if(!root) return;
    root.querySelectorAll('.activity-item').forEach(item=>{
      const wrap=item.querySelector('div');
      const actor=item.querySelector('strong')?.textContent?.trim()||'';
      if(!wrap) return;
      [...wrap.childNodes].forEach(node=>{
        if(node.nodeType!==Node.TEXT_NODE) return;
        if(!/setIndividualBudget/.test(node.textContent||'')) return;
        const possessive=actor==='Principessa'?'her':actor==='Principe'?'his':'their';
        node.textContent=(node.textContent||'').replace(/setIndividualBudget/g,`set ${possessive} trip budget`);
      });
    });
  }

  function syncBudgetHeaderButton(){
    const headerBtn=document.querySelector('[data-v5-new-plan]');
    const grid=document.getElementById('budgetPlanGrid');
    if(!headerBtn||!grid) return;

    const openCards=[...grid.querySelectorAll('[data-v5-plan]')].filter(card=>{
      const status=card.querySelector('.budget-plan-status')?.textContent?.trim()||'';
      return status!=='Budget checked';
    });

    const card=openCards[0]||null;
    const ownButton=card?.querySelector('[data-v5-own-budget]')||null;
    if(card&&ownButton){
      headerBtn.textContent=ownButton.textContent.trim();
      headerBtn.dataset.v6Mode='existing';
      headerBtn.dataset.v6PlanId=card.dataset.v5Plan||'';
    }else{
      headerBtn.textContent='Plan a trip budget';
      headerBtn.dataset.v6Mode='new';
      delete headerBtn.dataset.v6PlanId;
    }
  }

  document.addEventListener('click',event=>{
    const headerBtn=event.target.closest?.('[data-v5-new-plan]');
    if(!headerBtn||headerBtn.dataset.v6Mode!=='existing') return;
    const planId=headerBtn.dataset.v6PlanId||'';
    const card=planId?document.querySelector(`[data-v5-plan="${CSS.escape(planId)}"]`):null;
    const target=card?.querySelector('[data-v5-own-budget]');
    if(!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    target.click();
  },true);

  document.addEventListener('DOMContentLoaded',()=>{
    const activity=document.getElementById('activityList');
    if(activity){
      fixActivityLabels();
      new MutationObserver(fixActivityLabels).observe(activity,{childList:true});
    }

    setTimeout(()=>{
      const grid=document.getElementById('budgetPlanGrid');
      if(!grid) return;
      syncBudgetHeaderButton();
      new MutationObserver(syncBudgetHeaderButton).observe(grid,{childList:true});
    },0);
  });
})();
