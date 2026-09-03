from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Missing patch anchor: {label}")
    return text.replace(old, new, 1)

# ---------------- app.js ----------------
p = Path('app.js')
s = p.read_text()

s = replace_once(s,
"""  function freshWizard(){\n    return {mode:null,tripId:'',draft:freshDraft(),index:0};\n  }""",
"""  function freshWizard(){\n    return {mode:null,tripId:'',draft:freshDraft(),index:0,otherFlow:null};\n  }""", 'freshWizard')

s = replace_once(s,
"""    wizard = {mode:'new',tripId:'',draft:freshDraft(),index:0};""",
"""    wizard = {mode:'new',tripId:'',draft:freshDraft(),index:0,otherFlow:null};""", 'beginNew')

s = replace_once(s,
"""      mode:'join',tripId:id,index:0,\n      draft:{...freshDraft(),...meta,budget:t.budget ?? '',uncertain:{}}""",
"""      mode:'join',tripId:id,index:0,otherFlow:null,\n      draft:{...freshDraft(),...meta,budget:t.budget ?? '',uncertain:{}}""", 'beginJoin')

s = replace_once(s,
"""      mode:'edit',tripId:id,index:0,\n      draft:{...freshDraft(),...meta,...own,budget:t.budget ?? '',uncertain:{...(own.uncertain||{})}}""",
"""      mode:'edit',tripId:id,index:0,otherFlow:null,\n      draft:{...freshDraft(),...meta,...own,budget:t.budget ?? '',uncertain:{...(own.uncertain||{})}}""", 'beginEdit')

s = replace_once(s,
"""      {key:'other',title:'Any other expenses?',type:'moneyOrNone'},\n      {key:'otherNote',title:'What were the other expenses?',type:'text',optional:true,when:d=>n(d.other)>0},""",
"""      {key:'otherFlow',title:'Other expenses',type:'otherExpenses'},""", 'app other steps')

helpers = r'''
  function ensureOtherFlow(){
    if(!wizard.otherFlow){
      const existing=n(wizard.draft.other);
      wizard.otherFlow={
        stage:'amount',items:[],
        amount:existing>0 ? String(wizard.draft.other ?? existing) : '',
        name:existing>0 ? String(wizard.draft.otherNote || '') : '',
        uncertain:!!wizard.draft?.uncertain?.other
      };
    }
    return wizard.otherFlow;
  }

  function syncOtherDraft(){
    const f=ensureOtherFlow();
    const total=f.items.reduce((sum,item)=>sum+n(item.amount),0);
    wizard.draft.other=String(total);
    wizard.draft.otherNote=f.items.map(item=>`${item.name} · ${money(item.amount)}`).join(' + ');
    wizard.draft.uncertain={...(wizard.draft.uncertain||{})};
    wizard.draft.uncertain.other=f.items.some(item=>!!item.uncertain);
  }

  function otherFlowTitle(){
    const f=ensureOtherFlow();
    if(f.stage==='name') return 'What was this expense?';
    if(f.stage==='more') return 'Any more other expenses?';
    return f.items.length ? 'How much was the next other expense?' : 'Any other expenses?';
  }

  function otherCollectedHtml(){
    const f=ensureOtherFlow();
    if(!f.items.length) return '';
    return `<div class="v5-review">${f.items.map(item=>`<div class="v5-review-row"><span>${esc(item.name)}</span><strong>${item.uncertain?'~ ':''}${money(item.amount)}</strong></div>`).join('')}</div>`;
  }

  function otherExpensesControl(){
    const f=ensureOtherFlow();
    const list=otherCollectedHtml();
    if(f.stage==='name'){
      return `${list}<div class="v5-reference"><span>Amount</span><strong>${f.uncertain?'~ ':''}${money(f.amount)}</strong></div><div class="field-wrap"><input id="wizardOtherName" class="big-input" type="text" value="${esc(f.name||'')}" placeholder="e.g. museum tickets"></div><div class="wizard-actions"><button class="btn ghost" type="button" data-other-back>Back</button><button class="btn primary big" type="button" data-other-next>Next</button></div>`;
    }
    if(f.stage==='more'){
      return `${list}<div class="choice-grid"><button class="choice" type="button" data-other-more="yes">Yes, add another</button><button class="choice" type="button" data-other-more="no">No, continue</button></div>`;
    }
    return `${list}<div class="${f.uncertain?'uncertain-mode':''}"><div class="money-input-wrap"><span>€</span><input id="wizardOtherAmount" class="big-input money-field" inputmode="decimal" value="${esc(f.amount||'')}" placeholder="0.00"></div><div class="certainty-row"><button class="certainty ${!f.uncertain?'active':''}" type="button" data-other-certainty="exact">Exact</button><button class="certainty ${f.uncertain?'active':''}" type="button" data-other-certainty="estimate">Not sure · estimate</button></div>${f.items.length?'':'<button class="btn ghost full" type="button" data-other-none>No other expenses</button>'}</div><div class="wizard-actions"><button class="btn ghost" type="button" data-other-back>Back</button><button class="btn primary big" type="button" data-other-next>Next</button></div>`;
  }
'''

s = replace_once(s, "\n  function renderWizard(){", helpers + "\n  function renderWizard(){", 'app helper insertion')

s = replace_once(s,
"""    const s = currentStep();\n    const stepEl = $('#wizardStep');""",
"""    const s = currentStep();\n    if(s.type==='otherExpenses') s.title=otherFlowTitle();\n    const stepEl = $('#wizardStep');""", 'dynamic other title')

s = replace_once(s,
"""    let control = '';\n    if(s.type === 'tripChoice'){""",
"""    let control = '';\n    if(s.type === 'otherExpenses'){\n      control = otherExpensesControl();\n    } else if(s.type === 'tripChoice'){""", 'other control branch')

s = replace_once(s,
"""    if(s.type === 'tripChoice' || s.type === 'choice' || s.type === 'review') return '';""",
"""    if(s.type === 'tripChoice' || s.type === 'choice' || s.type === 'review' || s.type === 'otherExpenses') return '';""", 'wizardActions custom')

other_bind = r'''

    if(s.type==='otherExpenses'){
      const f=ensureOtherFlow();
      const amountInput=$('#wizardOtherAmount');
      const nameInput=$('#wizardOtherName');
      amountInput?.addEventListener('input',()=>{f.amount=amountInput.value;});
      nameInput?.addEventListener('input',()=>{f.name=nameInput.value;});
      setTimeout(()=>{(amountInput||nameInput)?.focus();},0);
      $$('[data-other-certainty]').forEach(btn=>btn.addEventListener('click',()=>{
        f.uncertain=btn.dataset.otherCertainty==='estimate';renderWizard();
      }));
      $('[data-other-none]')?.addEventListener('click',()=>{
        f.items=[];wizard.draft.other='0';wizard.draft.otherNote='';wizard.draft.uncertain.other=false;wizard.index++;renderWizard();
      });
      $('[data-other-more="yes"]')?.addEventListener('click',()=>{
        f.stage='amount';f.amount='';f.name='';f.uncertain=false;renderWizard();
      });
      $('[data-other-more="no"]')?.addEventListener('click',()=>{
        syncOtherDraft();wizard.index++;renderWizard();
      });
      $('[data-other-back]')?.addEventListener('click',()=>{
        if(f.stage==='name'){f.stage='amount';renderWizard();return;}
        if(f.stage==='more'){f.stage='name';const last=f.items.pop();if(last){f.amount=String(last.amount);f.name=last.name;f.uncertain=!!last.uncertain;syncOtherDraft();}renderWizard();return;}
        if(f.items.length){f.stage='more';renderWizard();return;}
        if(wizard.index>0){wizard.index--;renderWizard();}else{wizard=freshWizard();renderWizard();}
      });
      $('[data-other-next]')?.addEventListener('click',()=>{
        if(f.stage==='amount'){
          const value=String(f.amount||'').trim();
          if(!value||!Number.isFinite(Number(value.replace(',','.')))){toast('Enter a valid amount','warn');return;}
          f.stage='name';renderWizard();return;
        }
        if(f.stage==='name'){
          const name=String(f.name||'').trim();
          if(!name){toast('Add the name of the expense first','warn');return;}
          f.items.push({amount:String(f.amount),name,uncertain:!!f.uncertain});
          syncOtherDraft();f.amount='';f.name='';f.uncertain=false;f.stage='more';renderWizard();
        }
      });
      return;
    }
'''

s = replace_once(s,
"""    const input = $('#wizardInput');""",
other_bind + "\n    const input = $('#wizardInput');", 'app other binding')

p.write_text(s)

# ---------------- workflow.js ----------------
p = Path('workflow.js')
s = p.read_text()

s = replace_once(s,
"""      type:'actual', planId, index:0,\n      draft:{accom:'',groceries:'',eat:'',travel:'',fuel:'',tolls:'',other:'',otherNote:'',paid:'',uncertain:{},...existing,uncertain:{...(existing.uncertain||{})}}""",
"""      type:'actual', planId, index:0, otherFlow:null,\n      draft:{accom:'',groceries:'',eat:'',travel:'',fuel:'',tolls:'',other:'',otherNote:'',paid:'',uncertain:{},...existing,uncertain:{...(existing.uncertain||{})}}""", 'workflow start actual')

old_actual = """  function actualSteps(){\n    const base=[\n      ['accom','How much was accommodation?'],['groceries','How much on groceries?'],['eat','How much on eating out?'],['travel','How much on flights or trains?'],['fuel','How much on fuel?'],['tolls','How much on tolls or parking?'],['other','Any other expenses?']\n    ].map(([key,title])=>({key,title,type:'money'}));\n    if(n(activeFlow?.draft?.other)>0) base.push({key:'otherNote',title:'What were the other expenses?',type:'text'});\n    base.push({key:'paid',title:`How much did ${actor()} actually pay?`,type:'money',noUncertain:true});\n    base.push({key:'review',title:'Ready to save your actual expenses?',type:'review'});\n    return base;\n  }"""

new_actual = r'''  function actualSteps(){
    const base=[
      ['accom','How much was accommodation?'],['groceries','How much on groceries?'],['eat','How much on eating out?'],['travel','How much on flights or trains?'],['fuel','How much on fuel?'],['tolls','How much on tolls or parking?']
    ].map(([key,title])=>({key,title,type:'money'}));
    base.push({key:'otherFlow',title:'Other expenses',type:'otherExpenses'});
    base.push({key:'paid',title:`How much did ${actor()} actually pay?`,type:'money',noUncertain:true});
    base.push({key:'review',title:'Ready to save your actual expenses?',type:'review'});
    return base;
  }

  function ensureActualOtherFlow(){
    if(!activeFlow.otherFlow){
      const existing=n(activeFlow.draft.other);
      activeFlow.otherFlow={stage:'amount',items:[],amount:existing>0?String(activeFlow.draft.other??existing):'',name:existing>0?String(activeFlow.draft.otherNote||''):'',uncertain:!!activeFlow.draft?.uncertain?.other};
    }
    return activeFlow.otherFlow;
  }

  function syncActualOtherDraft(){
    const f=ensureActualOtherFlow();
    activeFlow.draft.other=String(f.items.reduce((sum,item)=>sum+n(item.amount),0));
    activeFlow.draft.otherNote=f.items.map(item=>`${item.name} · ${money(item.amount)}`).join(' + ');
    activeFlow.draft.uncertain={...(activeFlow.draft.uncertain||{})};
    activeFlow.draft.uncertain.other=f.items.some(item=>!!item.uncertain);
  }

  function actualOtherList(){
    const f=ensureActualOtherFlow();
    return f.items.length?`<div class="v5-review">${f.items.map(item=>`<div class="v5-review-row"><span>${esc(item.name)}</span><strong>${item.uncertain?'~ ':''}${money(item.amount)}</strong></div>`).join('')}</div>`:'';
  }

  function renderActualOtherExpenses(plan,steps,qCount,qNum){
    const f=ensureActualOtherFlow();
    const list=actualOtherList();
    const title=f.stage==='name'?'What was this expense?':f.stage==='more'?'Any more other expenses?':f.items.length?'How much was the next other expense?':'Any other expenses?';
    let control='';
    if(f.stage==='name'){
      control=`${list}<div class="v5-reference"><span>Amount</span><strong>${f.uncertain?'~ ':''}${money(f.amount)}</strong></div><div class="field-wrap"><input id="v5OtherName" class="big-input" value="${esc(f.name||'')}" placeholder="e.g. museum tickets"></div><div class="v5-actions"><button class="btn ghost" type="button" data-v5-other-back>Back</button><button class="btn primary big" type="button" data-v5-other-next>Next</button></div>`;
    }else if(f.stage==='more'){
      control=`${list}<div class="v5-choice-stack"><button class="trip-pick" type="button" data-v5-other-more="yes"><span class="pick-icon">＋</span><div><strong>Yes, add another</strong><small>Add another amount and its name.</small></div></button><button class="trip-pick" type="button" data-v5-other-more="no"><span class="pick-icon">✓</span><div><strong>No, continue</strong><small>Continue to what you actually paid.</small></div></button></div>`;
    }else{
      control=`${list}<div class="${f.uncertain?'uncertain-mode':''}"><div class="money-input-wrap"><span>€</span><input id="v5OtherAmount" class="big-input money-field" inputmode="decimal" value="${esc(f.amount||'')}" placeholder="0.00"></div><div class="certainty-row"><button class="certainty ${!f.uncertain?'active':''}" type="button" data-v5-other-cert="exact">Exact</button><button class="certainty ${f.uncertain?'active':''}" type="button" data-v5-other-cert="estimate">Not sure · estimate</button></div>${f.items.length?'':'<button class="btn ghost full" type="button" data-v5-other-none>No other expenses</button>'}</div><div class="v5-actions"><button class="btn ghost" type="button" data-v5-other-back>Back</button><button class="btn primary big" type="button" data-v5-other-next>Next</button></div>`;
    }
    showOverlay(`QUESTION ${Math.max(1,qNum)} OF ${qCount}`,((activeFlow.index+1)/steps.length)*100,title,`Budgeted trip: ${plan.meta?.city||locationLabel(plan.meta)} · ${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)}`,control);
    const amount=$('#v5OtherAmount'),name=$('#v5OtherName');
    amount?.addEventListener('input',()=>{f.amount=amount.value;});name?.addEventListener('input',()=>{f.name=name.value;});setTimeout(()=>{(amount||name)?.focus();},0);
    $$('[data-v5-other-cert]').forEach(btn=>btn.addEventListener('click',()=>{f.uncertain=btn.dataset.v5OtherCert==='estimate';renderActualFlow();}));
    $('[data-v5-other-none]')?.addEventListener('click',()=>{f.items=[];activeFlow.draft.other='0';activeFlow.draft.otherNote='';activeFlow.draft.uncertain.other=false;activeFlow.index++;renderActualFlow();});
    $('[data-v5-other-more="yes"]')?.addEventListener('click',()=>{f.stage='amount';f.amount='';f.name='';f.uncertain=false;renderActualFlow();});
    $('[data-v5-other-more="no"]')?.addEventListener('click',()=>{syncActualOtherDraft();activeFlow.index++;renderActualFlow();});
    $('[data-v5-other-back]')?.addEventListener('click',()=>{
      if(f.stage==='name'){f.stage='amount';renderActualFlow();return;}
      if(f.stage==='more'){f.stage='name';const last=f.items.pop();if(last){f.amount=String(last.amount);f.name=last.name;f.uncertain=!!last.uncertain;syncActualOtherDraft();}renderActualFlow();return;}
      if(f.items.length){f.stage='more';renderActualFlow();return;}
      if(activeFlow.index===0)closeOverlay();else{activeFlow.index--;renderActualFlow();}
    });
    $('[data-v5-other-next]')?.addEventListener('click',()=>{
      if(f.stage==='amount'){
        const value=String(f.amount||'').trim();if(!value||!Number.isFinite(Number(value.replace(',','.')))){toast('Enter a valid amount first','warn');return;}f.stage='name';renderActualFlow();return;
      }
      if(f.stage==='name'){
        const expenseName=String(f.name||'').trim();if(!expenseName){toast('Add the name of the expense first','warn');return;}f.items.push({amount:String(f.amount),name:expenseName,uncertain:!!f.uncertain});syncActualOtherDraft();f.amount='';f.name='';f.uncertain=false;f.stage='more';renderActualFlow();
      }
    });
  }'''

s = replace_once(s, old_actual, new_actual, 'workflow actualSteps')

s = replace_once(s,
"""    const uncertain=!!activeFlow.draft?.uncertain?.[step.key];\n    let control='';""",
"""    if(step.type==='otherExpenses'){renderActualOtherExpenses(plan,steps,qCount,qNum);return;}\n    const uncertain=!!activeFlow.draft?.uncertain?.[step.key];\n    let control='';""", 'workflow custom render')

p.write_text(s)
print('Patched app.js and workflow.js successfully')
