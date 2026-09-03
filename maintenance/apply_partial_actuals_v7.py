from pathlib import Path
import re

# ---------- workflow.js ----------
p=Path('workflow.js')
s=p.read_text(encoding='utf-8')

old="""  function partialSummary(partial){
    if(!partial)return '';
    const parts=[];
    if(partial.accom!==''&&partial.accom!=null)parts.push(`Accommodation ${money(partial.accom)}`);
    if(partial.travel!==''&&partial.travel!=null)parts.push(`Flights / Train ${money(partial.travel)}`);
    return parts.join(' · ');
  }
"""
new="""  function partialSummary(partial){
    if(!partial)return '';
    const parts=[];
    MONEY_FIELDS.forEach(key=>{
      if(partial[key]!==''&&partial[key]!=null){
        const note=key==='other'&&partial.otherNote?` (${partial.otherNote})`:'';
        parts.push(`${MONEY_LABELS[key]} ${money(partial[key])}${note}`);
      }
    });
    return parts.join(' · ');
  }
"""
if old not in s: raise SystemExit('partialSummary block not found')
s=s.replace(old,new,1)

# startActualChoice: force logging tab + reliable popup/fallback.
pat=r"  function startActualChoice\(planId\)\{.*?\n  \}\n\n  function startPartialActual\(planId\)\{"
m=re.search(pat,s,re.S)
if not m: raise SystemExit('startActualChoice block not found')
replacement="""  function startActualChoice(planId){
    const plan=planById(planId); const a=actor();
    if(!plan||!a){ toast('Could not open this budgeted trip','warn'); return; }
    installUi();
    closeBudgetModal();
    document.querySelector('.tab[data-sheet="log"]')?.click();
    if(sharedState.version<7){
      startPlanActual(planId);
      return;
    }
    const partial=plan?.partials?.[a]||null;
    const saved=partialSummary(partial);
    requestAnimationFrame(()=>{
      const content=`${saved?`<div class="v5-reference"><span>Already saved for later</span><strong>${esc(saved)}</strong></div>`:''}<div class="v5-choice-stack"><button class="trip-pick" type="button" data-v5-actual-mode="full"><span class="pick-icon">✓</span><div><strong>Log everything now</strong><small>Use the normal full trip-expense wizard. Anything saved earlier is already filled in.</small></div></button><button class="trip-pick" type="button" data-v5-actual-mode="partial"><span class="pick-icon">＋</span><div><strong>Log some expenses now</strong><small>Save one or more expense categories now and finish the rest later.</small></div></button></div>`;
      showOverlay('ACTUAL EXPENSES',12,'How much do you want to log now?','Record a few expenses now or complete the whole trip.',content);
      $('[data-v5-actual-mode="full"]')?.addEventListener('click',()=>startPlanActual(planId));
      $('[data-v5-actual-mode="partial"]')?.addEventListener('click',()=>startPartialActual(planId));
      $('#wizardCard')?.scrollIntoView({behavior:'smooth',block:'center'});
    });
  }

  function startPartialActual(planId){"""
s=s[:m.start()]+replacement+s[m.end():]

old="""  function startPartialActual(planId){
    const plan=planById(planId); const a=actor(); if(!plan||!a)return;
    const existing=plan?.partials?.[a]||{};
    activeFlow={type:'partial',planId,stage:'choose',key:'',draft:{accom:existing.accom??'',travel:existing.travel??'',uncertain:{...(existing.uncertain||{})}}};
    closeBudgetModal();
    document.querySelector('.tab[data-sheet="log"]')?.click();
    renderPartialActual();
    $('#wizardCard')?.scrollIntoView({behavior:'smooth',block:'center'});
  }
"""
new="""  function startPartialActual(planId){
    const plan=planById(planId); const a=actor(); if(!plan||!a)return;
    const existing=plan?.partials?.[a]||{};
    const draft={otherNote:existing.otherNote||'',uncertain:{...(existing.uncertain||{})}};
    MONEY_FIELDS.forEach(key=>{draft[key]=existing[key]??'';});
    activeFlow={type:'partial',planId,stage:'choose',key:'',draft};
    closeBudgetModal();
    document.querySelector('.tab[data-sheet="log"]')?.click();
    renderPartialActual();
    $('#wizardCard')?.scrollIntoView({behavior:'smooth',block:'center'});
  }
"""
if old not in s: raise SystemExit('startPartialActual exact block not found')
s=s.replace(old,new,1)

# Replace partial mini-flow + save function wholesale.
pat=r"  function renderPartialActual\(\)\{.*?\n  \}\n\n  async function savePartialActual\(\)\{.*?\n  \}\n\n  function startPlanActual\(planId\)\{"
m=re.search(pat,s,re.S)
if not m: raise SystemExit('partial render/save block not found')
newblock="""  function renderPartialActual(){
    const f=activeFlow; if(!f||f.type!=='partial')return;
    const plan=planById(f.planId); if(!plan)return closeOverlay();
    const saved=partialSummary(f.draft);
    const icons={accom:'⌂',groceries:'▣',eat:'♨',travel:'✈',fuel:'⛽',tolls:'↔',other:'＋'};
    if(f.stage==='choose'){
      const choices=MONEY_FIELDS.map(key=>`<button class="trip-pick" type="button" data-v5-partial-key="${key}"><span class="pick-icon">${icons[key]||'＋'}</span><div><strong>${esc(MONEY_LABELS[key])}</strong><small>${f.draft[key]!==''?`Currently ${money(f.draft[key])}`:`Add ${esc(MONEY_LABELS[key].toLowerCase())}`}</small></div></button>`).join('');
      const content=`${saved?`<div class="v5-reference"><span>Saved in this session</span><strong>${esc(saved)}</strong></div>`:''}<div class="v5-choice-stack">${choices}</div>${saved?'<div class="v5-actions"><button class="btn ghost" type="button" data-v5-partial-cancel>Cancel</button><button class="btn primary big" type="button" data-v5-partial-save>Save for later</button></div>':''}`;
      showOverlay('PARTIAL EXPENSES',24,'What do you want to log?','Choose any category. After each entry, you can add another or save and finish later.',content);
      $$('[data-v5-partial-key]').forEach(btn=>btn.addEventListener('click',()=>{f.key=btn.dataset.v5PartialKey;f.stage='amount';renderPartialActual();}));
      $('[data-v5-partial-cancel]')?.addEventListener('click',closeOverlay);
      $('[data-v5-partial-save]')?.addEventListener('click',savePartialActual);
      return;
    }
    if(f.stage==='more'){
      const content=`<div class="v5-reference"><span>Saved so far</span><strong>${esc(saved||'—')}</strong></div><div class="v5-choice-stack"><button class="trip-pick" type="button" data-v5-partial-more="yes"><span class="pick-icon">＋</span><div><strong>Yes, log something else</strong><small>Choose any other expense category.</small></div></button><button class="trip-pick" type="button" data-v5-partial-more="no"><span class="pick-icon">✓</span><div><strong>No, that’s all for now</strong><small>Save these expenses and finish the rest later.</small></div></button></div>`;
      showOverlay('PARTIAL EXPENSES',72,'Anything else to log now?','Your entries stay attached to this budgeted trip until you complete the full expenses.',content);
      $('[data-v5-partial-more="yes"]')?.addEventListener('click',()=>{f.stage='choose';f.key='';renderPartialActual();});
      $('[data-v5-partial-more="no"]')?.addEventListener('click',savePartialActual);
      return;
    }
    if(f.stage==='name'){
      const content=`<div class="v5-reference"><span>Other expense amount</span><strong>${money(f.draft.other)}</strong></div><div class="field-wrap"><input id="v5PartialOtherName" class="big-input" value="${esc(f.draft.otherNote||'')}" placeholder="e.g. museum tickets"></div><div class="v5-actions"><button class="btn ghost" type="button" data-v5-partial-name-back>Back</button><button class="btn primary big" type="button" data-v5-partial-name-next>Next</button></div>`;
      showOverlay('PARTIAL EXPENSES',58,'What was the other expense?','Give this expense a short name so you remember it later.',content);
      const name=$('#v5PartialOtherName'); name?.addEventListener('input',()=>{f.draft.otherNote=name.value;}); setTimeout(()=>name?.focus(),0);
      $('[data-v5-partial-name-back]')?.addEventListener('click',()=>{f.stage='amount';renderPartialActual();});
      $('[data-v5-partial-name-next]')?.addEventListener('click',()=>{if(!String(f.draft.otherNote||'').trim()){toast('Add the name of the expense first','warn');return;}f.stage='more';renderPartialActual();});
      return;
    }
    const key=f.key; const label=MONEY_LABELS[key]; const uncertain=!!f.draft?.uncertain?.[key];
    const pot=key==='accom'?`<div class="v5-reference" id="v5JointPot"><span>20% available from your joint pot</span><strong>${money(n(f.draft.accom)*.20)}</strong><small>This is informational only; it does not change the accommodation expense.</small></div>`:'';
    const content=`<div class="money-input-wrap"><span>€</span><input id="v5PartialAmount" class="big-input money-field" inputmode="decimal" value="${esc(String(f.draft[key]??''))}" placeholder="0.00"></div><div class="certainty-row"><button class="certainty ${!uncertain?'active':''}" type="button" data-v5-partial-cert="exact">Exact</button><button class="certainty ${uncertain?'active':''}" type="button" data-v5-partial-cert="estimate">Not sure · estimate</button></div>${pot}<div class="v5-actions"><button class="btn ghost" type="button" data-v5-partial-back>Back</button><button class="btn primary big" type="button" data-v5-partial-next>Next</button></div>`;
    showOverlay('PARTIAL EXPENSES',48,`How much was ${label.toLowerCase()}?`,`Budgeted trip: ${plan.meta?.city||locationLabel(plan.meta)} · ${fmtDate(plan.meta?.start)}–${fmtDate(plan.meta?.end)}`,content);
    const input=$('#v5PartialAmount');
    input?.addEventListener('input',()=>{f.draft[key]=input.value;if(key==='accom'){const strong=$('#v5JointPot strong');if(strong)strong.textContent=money(n(input.value)*.20);}});
    setTimeout(()=>input?.focus(),0);
    $$('[data-v5-partial-cert]').forEach(btn=>btn.addEventListener('click',()=>{f.draft.uncertain={...(f.draft.uncertain||{})};f.draft.uncertain[key]=btn.dataset.v5PartialCert==='estimate';renderPartialActual();}));
    $('[data-v5-partial-back]')?.addEventListener('click',()=>{f.stage='choose';renderPartialActual();});
    $('[data-v5-partial-next]')?.addEventListener('click',()=>{
      const value=String(f.draft[key]??'').trim();
      if(!value||!Number.isFinite(Number(value.replace(',','.')))){toast('Enter a valid amount first','warn');return;}
      if(key==='other'){f.stage='name';renderPartialActual();return;}
      f.stage='more';renderPartialActual();
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
      closeOverlay(); toast('Saved. You can finish the rest later.');
      setTimeout(refreshState,450);
    }catch(err){toast(err.message||'Could not save partial expenses','warn');if(btn)btn.disabled=false;}
  }

  function startPlanActual(planId){"""
s=s[:m.start()]+newblock+s[m.end():]

# Add 20% info to full wizard accommodation as well.
old="""    }else{
      control=`<div class="${uncertain?'uncertain-mode':''}"><div class="money-input-wrap"><span>€</span><input id="v5FlowInput" class="big-input money-field" inputmode="decimal" value="${esc(String(activeFlow.draft[step.key]??''))}" placeholder="0.00"></div>${!step.noUncertain?`<div class="certainty-row"><button class="certainty ${!uncertain?'active':''}" type="button" data-v5-cert="exact">Exact</button><button class="certainty ${uncertain?'active':''}" type="button" data-v5-cert="estimate">Not sure · estimate</button></div>`:''}${step.key==='other'?'<button class="btn ghost full" type="button" data-v5-none>No other expenses</button>':''}</div>`;
    }
"""
new="""    }else{
      const pot=step.key==='accom'?`<div class="v5-reference" id="v5FullJointPot"><span>20% available from your joint pot</span><strong>${money(n(activeFlow.draft.accom)*.20)}</strong><small>This does not change the accommodation expense.</small></div>`:'';
      control=`<div class="${uncertain?'uncertain-mode':''}"><div class="money-input-wrap"><span>€</span><input id="v5FlowInput" class="big-input money-field" inputmode="decimal" value="${esc(String(activeFlow.draft[step.key]??''))}" placeholder="0.00"></div>${!step.noUncertain?`<div class="certainty-row"><button class="certainty ${!uncertain?'active':''}" type="button" data-v5-cert="exact">Exact</button><button class="certainty ${uncertain?'active':''}" type="button" data-v5-cert="estimate">Not sure · estimate</button></div>`:''}${pot}${step.key==='other'?'<button class="btn ghost full" type="button" data-v5-none>No other expenses</button>':''}</div>`;
    }
"""
if old not in s: raise SystemExit('full money control block not found')
s=s.replace(old,new,1)
old="""    const input=$('#v5FlowInput'); input?.addEventListener('input',()=>{activeFlow.draft[step.key]=input.value;}); setTimeout(()=>input?.focus(),0);
"""
new="""    const input=$('#v5FlowInput'); input?.addEventListener('input',()=>{activeFlow.draft[step.key]=input.value;if(step.key==='accom'){const strong=$('#v5FullJointPot strong');if(strong)strong.textContent=money(n(input.value)*.20);}}); setTimeout(()=>input?.focus(),0);
"""
if old not in s: raise SystemExit('full input handler not found')
s=s.replace(old,new,1)

# Permanent delegated handler for actual-expense buttons, resilient to card rerenders.
anchor="""  document.addEventListener('click',event=>{
    const tripCard=event.target.closest?.('[data-open-trip]');
"""
insert="""  document.addEventListener('click',event=>{
    const actualBtn=event.target.closest?.('[data-v5-actual]');
    if(actualBtn){
      const card=actualBtn.closest('[data-v5-plan]');
      const id=card?.dataset?.v5Plan||'';
      if(id){
        event.preventDefault(); event.stopImmediatePropagation();
        startActualChoice(id); return;
      }
    }

    const tripCard=event.target.closest?.('[data-open-trip]');
"""
if anchor not in s: raise SystemExit('document click anchor not found')
s=s.replace(anchor,insert,1)

p.write_text(s,encoding='utf-8')

# ---------- backend/Code.gs ----------
p=Path('backend/Code.gs')
s=p.read_text(encoding='utf-8')
s=s.replace('version: 6','version: 7')
s=s.replace('state.version = 6;','state.version = 7;')
s=s.replace('version:6','version:7')

old="""      const previous = plan.partials && plan.partials[actor] ? plan.partials[actor] : {};
      const incoming = payload.partial || {};
      const merged = Object.assign({}, previous);
      if (incoming.accom !== undefined) merged.accom = incoming.accom;
      if (incoming.travel !== undefined) merged.travel = incoming.travel;
      merged.uncertain = Object.assign({}, previous.uncertain || {}, incoming.uncertain || {});
      merged.updatedAt = new Date().toISOString();
      const partial = sanitizePartialActual_(merged, actor);
      if (!partial) throw new Error('Add accommodation or Flights / Train first');
"""
new="""      const previous = plan.partials && plan.partials[actor] ? plan.partials[actor] : {};
      const incoming = payload.partial || {};
      const merged = Object.assign({}, previous);
      MONEY_FIELDS.forEach(function(key) {
        if (incoming[key] !== undefined) merged[key] = incoming[key];
      });
      if (incoming.otherNote !== undefined) merged.otherNote = incoming.otherNote;
      merged.uncertain = Object.assign({}, previous.uncertain || {}, incoming.uncertain || {});
      merged.updatedAt = new Date().toISOString();
      const partial = sanitizePartialActual_(merged, actor);
      if (!partial) throw new Error('Add at least one expense first');
"""
if old not in s: raise SystemExit('backend partial merge block not found')
s=s.replace(old,new,1)

old="""      if (partial) {
        if (submitted.accom === '' || submitted.accom == null) submitted.accom = partial.accom;
        if (submitted.travel === '' || submitted.travel == null) submitted.travel = partial.travel;
        submitted.uncertain = Object.assign({}, partial.uncertain || {}, submitted.uncertain || {});
      }
"""
new="""      if (partial) {
        MONEY_FIELDS.forEach(function(key) {
          if ((submitted[key] === '' || submitted[key] == null) && partial[key] !== '' && partial[key] != null) submitted[key] = partial[key];
        });
        if (!submitted.otherNote && partial.otherNote) submitted.otherNote = partial.otherNote;
        submitted.uncertain = Object.assign({}, partial.uncertain || {}, submitted.uncertain || {});
      }
"""
if old not in s: raise SystemExit('backend full merge block not found')
s=s.replace(old,new,1)

pat=r"function sanitizePartialActual_\(partial, actor\) \{.*?\n\}\n\nfunction sanitizePlan_"
m=re.search(pat,s,re.S)
if not m: raise SystemExit('sanitizePartialActual function not found')
newfun="""function sanitizePartialActual_(partial, actor) {
  if (!partial || typeof partial !== 'object') return null;
  const out = {
    otherNote: cleanText_(partial.otherNote, 200),
    uncertain: cleanUncertain_(partial.uncertain),
    updatedAt: cleanText_(partial.updatedAt, 40),
    updatedBy: cleanActor_(partial.updatedBy || actor)
  };
  let hasAny = false;
  MONEY_FIELDS.forEach(function(key) {
    out[key] = cleanMoney_(partial[key]);
    if (out[key] !== '') hasAny = true;
  });
  return hasAny ? out : null;
}

function sanitizePlan_"""
s=s[:m.start()]+newfun+s[m.end():]
p.write_text(s,encoding='utf-8')

# ---------- index cache bust ----------
p=Path('index.html')
s=p.read_text(encoding='utf-8')
if 'workflow.js?v=6' not in s: raise SystemExit('workflow cache version anchor not found')
s=s.replace('workflow.js?v=6','workflow.js?v=7',1)
p.write_text(s,encoding='utf-8')
