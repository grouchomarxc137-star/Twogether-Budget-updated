from pathlib import Path
import re

p=Path('workflow.js')
s=p.read_text(encoding='utf-8')

# Replace the partial-entry flow as one guarded block.
pat=r"  function startPartialActual\(planId\)\{.*?\n  \}\n\n  async function savePartialActual\(\)\{.*?\n  \}\n\n  function startPlanActual\(planId\)\{"
m=re.search(pat,s,re.S)
if not m:
    raise SystemExit('partial flow block not found')

newblock=r'''  function startPartialActual(planId){
    const plan=planById(planId); const a=actor(); if(!plan||!a)return;
    const existing=plan?.partials?.[a]||{};
    const draft={otherNote:existing.otherNote||'',uncertain:{...(existing.uncertain||{})}};
    MONEY_FIELDS.forEach(key=>{draft[key]=existing[key]??'';});
    const hadSaved=hasPartial(existing);
    activeFlow={type:'partial',planId,stage:'choose',key:'',draft,expanded:hadSaved,mode:'new',entryAmount:'',entryUncertain:false,pendingAmount:null,pendingUncertain:false,entryName:''};
    closeBudgetModal();
    document.querySelector('.tab[data-sheet="log"]')?.click();
    renderPartialActual();
    $('#wizardCard')?.scrollIntoView({behavior:'smooth',block:'center'});
  }

  function partialHasValue(f,key){ return f?.draft?.[key]!=='' && f?.draft?.[key]!=null; }

  function beginPartialAmount(f,key,mode){
    f.key=key; f.mode=mode||'new'; f.stage='amount';
    f.entryAmount=f.mode==='replace'?String(f.draft[key]??''):'';
    f.entryUncertain=f.mode==='replace'?!!f.draft?.uncertain?.[key]:false;
    f.entryName=''; f.pendingAmount=null; f.pendingUncertain=false;
    renderPartialActual();
  }

  function commitPartialEntry(f,name){
    const key=f.key;
    const entered=n(f.pendingAmount==null?f.entryAmount:f.pendingAmount);
    const old=partialHasValue(f,key)?n(f.draft[key]):0;
    const oldUncertain=!!f.draft?.uncertain?.[key];
    const entryUncertain=f.pendingAmount==null?!!f.entryUncertain:!!f.pendingUncertain;
    const total=f.mode==='add'?old+entered:entered;
    f.draft[key]=String(total);
    f.draft.uncertain={...(f.draft.uncertain||{})};
    f.draft.uncertain[key]=f.mode==='add'?(oldUncertain||entryUncertain):entryUncertain;
    if(key==='other'){
      const clean=String(name||'').trim();
      if(f.mode==='add'&&String(f.draft.otherNote||'').trim())f.draft.otherNote=`${f.draft.otherNote} + ${clean}`;
      else f.draft.otherNote=clean;
    }
    f.entryAmount=''; f.entryName=''; f.pendingAmount=null; f.pendingUncertain=false; f.entryUncertain=false;
    f.stage='more';
    renderPartialActual();
  }

  function renderPartialActual(){
    const f=activeFlow; if(!f||f.type!=='partial')return;
    const plan=planById(f.planId); if(!plan)return closeOverlay();
    const saved=partialSummary(f.draft);
    const icons={accom:'⌂',groceries:'▣',eat:'♨',travel:'✈',fuel:'⛽',tolls:'↔',other:'＋'};
    const core=['accom','travel'];

    if(f.stage==='choose'){
      const unlogged=MONEY_FIELDS.filter(key=>!partialHasValue(f,key));
      let selectable=f.expanded?unlogged:core.filter(key=>unlogged.includes(key));
      if(!selectable.length&&!f.expanded){f.expanded=true;selectable=unlogged;}
      const choices=selectable.map(key=>`<button class="trip-pick" type="button" data-v5-partial-key="${key}"><span class="pick-icon">${icons[key]||'＋'}</span><div><strong>${esc(MONEY_LABELS[key])}</strong><small>Add ${esc(MONEY_LABELS[key].toLowerCase())}</small></div></button>`).join('');
      const savedKeys=MONEY_FIELDS.filter(key=>partialHasValue(f,key));
      const savedChoices=savedKeys.map(key=>`<button class="trip-pick" type="button" data-v5-partial-saved="${key}"><span class="pick-icon">↻</span><div><strong>${esc(MONEY_LABELS[key])}</strong><small>Saved total ${money(f.draft[key])} · add another or edit</small></div></button>`).join('');
      const intro=!f.expanded?'Start with accommodation and/or Flights / Train. After your first entry, you can add the other categories.':'Choose one of the remaining categories. Saved categories can still be updated below.';
      const content=`${saved?`<div class="v5-reference"><span>Saved so far</span><strong>${esc(saved)}</strong></div>`:''}${choices?`<div class="v5-choice-stack">${choices}</div>`:'<div class="budget-empty">All categories already have a saved amount.</div>'}${savedChoices?`<div class="v5-step" style="margin:18px 0 8px">ALREADY LOGGED · EDIT OR ADD</div><div class="v5-choice-stack">${savedChoices}</div>`:''}${saved?'<div class="v5-actions"><button class="btn ghost" type="button" data-v5-partial-cancel>Cancel</button><button class="btn primary big" type="button" data-v5-partial-save>Save for later</button></div>':''}`;
      showOverlay('PARTIAL EXPENSES',24,'What do you want to log?',intro,content);
      $$('[data-v5-partial-key]').forEach(btn=>btn.addEventListener('click',()=>beginPartialAmount(f,btn.dataset.v5PartialKey,'new')));
      $$('[data-v5-partial-saved]').forEach(btn=>btn.addEventListener('click',()=>{f.key=btn.dataset.v5PartialSaved;f.stage='savedAction';renderPartialActual();}));
      $('[data-v5-partial-cancel]')?.addEventListener('click',closeOverlay);
      $('[data-v5-partial-save]')?.addEventListener('click',savePartialActual);
      return;
    }

    if(f.stage==='savedAction'){
      const key=f.key; const label=MONEY_LABELS[key];
      const content=`<div class="v5-reference"><span>Current saved total</span><strong>${money(f.draft[key])}</strong></div><div class="v5-choice-stack"><button class="trip-pick" type="button" data-v5-saved-action="add"><span class="pick-icon">＋</span><div><strong>Add another ${esc(label.toLowerCase())} expense</strong><small>The new amount will be added to the current total.</small></div></button><button class="trip-pick" type="button" data-v5-saved-action="replace"><span class="pick-icon">✎</span><div><strong>Edit the saved total</strong><small>Replace ${money(f.draft[key])} with a corrected total.</small></div></button></div><div class="v5-actions"><button class="btn ghost" type="button" data-v5-saved-back>Back</button></div>`;
      showOverlay('PARTIAL EXPENSES',38,`Update ${label}`,`Twogether only stores the running total for this category.`,content);
      $$('[data-v5-saved-action]').forEach(btn=>btn.addEventListener('click',()=>beginPartialAmount(f,key,btn.dataset.v5SavedAction)));
      $('[data-v5-saved-back]')?.addEventListener('click',()=>{f.stage='choose';renderPartialActual();});
      return;
    }

    if(f.stage==='more'){
      const content=`<div class="v5-reference"><span>Saved so far</span><strong>${esc(saved||'—')}</strong></div><div class="v5-choice-stack"><button class="trip-pick" type="button" data-v5-partial-more="yes"><span class="pick-icon">＋</span><div><strong>Yes, log something else</strong><small>Show the remaining categories and anything already saved that you can update.</small></div></button><button class="trip-pick" type="button" data-v5-partial-more="no"><span class="pick-icon">✓</span><div><strong>No, that’s all for now</strong><small>Save these totals and continue another day.</small></div></button></div>`;
      showOverlay('PARTIAL EXPENSES',72,'Anything else to log now?','You can keep building these totals little by little until you complete the full trip.',content);
      $('[data-v5-partial-more="yes"]')?.addEventListener('click',()=>{f.expanded=true;f.stage='choose';f.key='';renderPartialActual();});
      $('[data-v5-partial-more="no"]')?.addEventListener('click',savePartialActual);
      return;
    }

    if(f.stage==='name'){
      const base=f.mode==='add'&&partialHasValue(f,'other')?String(f.draft.otherNote||''):'';
      const content=`<div class="v5-reference"><span>${f.mode==='add'?'Amount being added':'Other expense amount'}</span><strong>${money(f.pendingAmount)}</strong></div><div class="field-wrap"><input id="v5PartialOtherName" class="big-input" value="${esc(f.entryName||'')}" placeholder="e.g. museum tickets"></div>${base?`<small style="display:block;margin-top:8px;color:var(--muted)">Existing note: ${esc(base)}</small>`:''}<div class="v5-actions"><button class="btn ghost" type="button" data-v5-partial-name-back>Back</button><button class="btn primary big" type="button" data-v5-partial-name-next>Next</button></div>`;
      showOverlay('PARTIAL EXPENSES',58,'What was the other expense?','Give this expense a short name so you remember it later.',content);
      const name=$('#v5PartialOtherName'); name?.addEventListener('input',()=>{f.entryName=name.value;}); setTimeout(()=>name?.focus(),0);
      $('[data-v5-partial-name-back]')?.addEventListener('click',()=>{f.stage='amount';renderPartialActual();});
      $('[data-v5-partial-name-next]')?.addEventListener('click',()=>{const clean=String(f.entryName||'').trim();if(!clean){toast('Add the name of the expense first','warn');return;}commitPartialEntry(f,clean);});
      return;
    }

    const key=f.key; const label=MONEY_LABELS[key];
    const current=partialHasValue(f,key)?n(f.draft[key]):0;
    const value=f.entryAmount||'';
    const pot=key==='accom'?`<div id="v5JointPot" style="margin-top:10px;font-weight:800">20% = <strong>${money((f.mode==='add'?current+n(value):n(value))*.20)}</strong></div>`:'';
    const modeHelp=f.mode==='add'?`Current total: ${money(current)}. Enter only the new ${label.toLowerCase()} expense and Twogether will add it.`:f.mode==='replace'?`Correct the saved total for ${label.toLowerCase()}.`:`Budgeted trip: ${plan.meta?.city||locationLabel(plan.meta)} · ${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)}`;
    const content=`${f.mode==='add'?`<div class="v5-reference"><span>Current saved total</span><strong>${money(current)}</strong></div>`:''}<div class="money-input-wrap"><span>€</span><input id="v5PartialAmount" class="big-input money-field" inputmode="decimal" value="${esc(String(value))}" placeholder="0.00"></div><div class="certainty-row"><button class="certainty ${!f.entryUncertain?'active':''}" type="button" data-v5-partial-cert="exact">Exact</button><button class="certainty ${f.entryUncertain?'active':''}" type="button" data-v5-partial-cert="estimate">Not sure · estimate</button></div>${pot}<div class="v5-actions"><button class="btn ghost" type="button" data-v5-partial-back>Back</button><button class="btn primary big" type="button" data-v5-partial-next>Next</button></div>`;
    showOverlay('PARTIAL EXPENSES',48,`${f.mode==='add'?'Add another':'How much was'} ${label.toLowerCase()}?`,modeHelp,content);
    const input=$('#v5PartialAmount');
    input?.addEventListener('input',()=>{f.entryAmount=input.value;if(key==='accom'){const strong=$('#v5JointPot strong');if(strong){const shown=(f.mode==='add'?current+n(input.value):n(input.value))*.20;strong.textContent=money(shown);}}});
    setTimeout(()=>input?.focus(),0);
    $$('[data-v5-partial-cert]').forEach(btn=>btn.addEventListener('click',()=>{f.entryUncertain=btn.dataset.v5PartialCert==='estimate';renderPartialActual();}));
    $('[data-v5-partial-back]')?.addEventListener('click',()=>{f.stage=f.mode==='new'?'choose':'savedAction';renderPartialActual();});
    $('[data-v5-partial-next]')?.addEventListener('click',()=>{
      const raw=String(f.entryAmount||'').trim();
      if(!raw||!Number.isFinite(Number(raw.replace(',','.')))){toast('Enter a valid amount first','warn');return;}
      if(key==='other'){
        f.pendingAmount=n(raw); f.pendingUncertain=!!f.entryUncertain; f.entryName=f.mode==='replace'?String(f.draft.otherNote||''):''; f.stage='name'; renderPartialActual(); return;
      }
      commitPartialEntry(f,'');
    });
  }

  async function savePartialActual(){
    const f=activeFlow; if(!f||f.type!=='partial')return;
    if(!hasPartial(f.draft)){toast('Add at least one expense first','warn');return;}
    const btn=$('[data-v5-partial-save],[data-v5-partial-more="no"]'); if(btn)btn.disabled=true;
    const partial={otherNote:f.draft.otherNote||'',uncertain:{...(f.draft.uncertain||{})}};
    MONEY_FIELDS.forEach(key=>{partial[key]=f.draft[key]??'';});
    try{
      await post('savePlanPartial',{planId:f.planId,partial});
      closeOverlay(); toast('Saved. You can keep adding expenses later.');
      setTimeout(refreshState,450);
    }catch(err){toast(err.message||'Could not save partial expenses','warn');if(btn)btn.disabled=false;}
  }

  function startPlanActual(planId){'''

s=s[:m.start()]+newblock+s[m.end():]

# Simplify the 20% helper in the full-expense wizard too.
old=r'''      const pot=step.key==='accom'?`<div class="v5-reference" id="v5FullJointPot"><span>20% available from your joint pot</span><strong>${money(n(activeFlow.draft.accom)*.20)}</strong><small>This does not change the accommodation expense.</small></div>`:'';'''
new=r'''      const pot=step.key==='accom'?`<div id="v5FullJointPot" style="margin-top:10px;font-weight:800">20% = <strong>${money(n(activeFlow.draft.accom)*.20)}</strong></div>`:'';'''
if old not in s:
    raise SystemExit('full 20 percent helper not found')
s=s.replace(old,new,1)

p.write_text(s,encoding='utf-8')

# Cache bust the workflow script.
ip=Path('index.html')
i=ip.read_text(encoding='utf-8')
if 'workflow.js?v=7' not in i:
    raise SystemExit('workflow cache marker not found')
i=i.replace('workflow.js?v=7','workflow.js?v=8',1)
ip.write_text(i,encoding='utf-8')
