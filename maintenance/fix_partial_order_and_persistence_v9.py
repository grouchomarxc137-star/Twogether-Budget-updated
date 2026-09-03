from pathlib import Path

p=Path('workflow.js')
s=p.read_text(encoding='utf-8')

old="""    if(f.stage==='choose'){
      const unlogged=MONEY_FIELDS.filter(key=>!partialHasValue(f,key));
      let selectable=f.expanded?unlogged:core.filter(key=>unlogged.includes(key));
"""
new="""    if(f.stage==='choose'){
      const partialOrder=['accom','travel','groceries','eat','fuel','tolls','other'];
      const unlogged=partialOrder.filter(key=>!partialHasValue(f,key));
      let selectable=f.expanded?unlogged:core.filter(key=>unlogged.includes(key));
"""
if old not in s:
    raise SystemExit('choose ordering block not found')
s=s.replace(old,new,1)

old="""      const savedKeys=MONEY_FIELDS.filter(key=>partialHasValue(f,key));
"""
new="""      const savedKeys=partialOrder.filter(key=>partialHasValue(f,key));
"""
if old not in s:
    raise SystemExit('saved ordering block not found')
s=s.replace(old,new,1)

old="""    try{
      await post('savePlanPartial',{planId:f.planId,partial});
      closeOverlay(); toast('Saved. You can keep adding expenses later.');
      setTimeout(refreshState,450);
    }catch(err){toast(err.message||'Could not save partial expenses','warn');if(btn)btn.disabled=false;}
"""
new="""    try{
      await post('savePlanPartial',{planId:f.planId,partial});
      const plan=planById(f.planId); const a=actor();
      if(plan&&a){
        plan.partials={...(plan.partials||{})};
        plan.partials[a]=JSON.parse(JSON.stringify(partial));
        renderBudgetPlans();
      }
      closeOverlay(); toast('Saved. You can keep adding expenses later.');
      setTimeout(refreshState,1600);
    }catch(err){toast(err.message||'Could not save partial expenses','warn');if(btn)btn.disabled=false;}
"""
if old not in s:
    raise SystemExit('partial save block not found')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')

ip=Path('index.html')
i=ip.read_text(encoding='utf-8')
if 'workflow.js?v=8' not in i:
    raise SystemExit('workflow cache marker not found')
i=i.replace('workflow.js?v=8','workflow.js?v=9',1)
ip.write_text(i,encoding='utf-8')
