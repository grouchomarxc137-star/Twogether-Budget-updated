from pathlib import Path

p=Path('finances.js')
s=p.read_text(encoding='utf-8')

# Keep Extra as a fixed recurring €250 allocation, but hide it from manual expense category choices.
s=s.replace("    {key:'extra',label:'Extra',defaultName:'Extra',tone:'budgets',optionalName:true},", "    {key:'extra',label:'Extra',defaultName:'Extra',tone:'budgets',optionalName:true,manual:false},")
s=s.replace("    {group:'groceries',name:'Groceries',amount:255},\n    {group:'investments',name:'Investments',amount:550},", "    {group:'groceries',name:'Groceries',amount:255},\n    {group:'extra',name:'Extra',amount:250},\n    {group:'investments',name:'Investments',amount:550},")

old_norm="""  function normalizeFinanceRecord(rec){
    const copy=JSON.parse(JSON.stringify(rec||{}));
    copy.expenses=Array.isArray(copy.expenses)?copy.expenses.map(x=>({...x,group:normalizeGroup(x.group)})):[];
    const legacyBudget = !hasValue(copy.extraBudget) || n(copy.extraBudget)<=0 || n(copy.extraBudget)===255;
    if(legacyBudget){
      const legacyExtraIndex=copy.expenses.findIndex(x=>normalizeGroup(x.group)==='extra' && String(x.name||'').trim().toLowerCase()==='extra' && n(x.amount)===250);
      if(legacyExtraIndex>=0){
        copy.expenses.splice(legacyExtraIndex,1);
        copy.extraBudget=250;
      }
    }
    if(!hasValue(copy.extraBudget)||n(copy.extraBudget)<=0) copy.extraBudget=250;
    return copy;
  }
"""
new_norm="""  function normalizeFinanceRecord(rec){
    const copy=JSON.parse(JSON.stringify(rec||{}));
    copy.expenses=Array.isArray(copy.expenses)?copy.expenses.map(x=>({...x,group:normalizeGroup(x.group)})):[];
    const fixedExtras=copy.expenses.filter(x=>normalizeGroup(x.group)==='extra' && String(x.name||'').trim().toLowerCase()==='extra');
    copy.expenses=copy.expenses.filter((x,i)=>normalizeGroup(x.group)!=='extra' || String(x.name||'').trim().toLowerCase()!=='extra' || x===fixedExtras[0]);
    if(!copy.expenses.some(x=>normalizeGroup(x.group)==='extra' && String(x.name||'').trim().toLowerCase()==='extra')) copy.expenses.push({group:'extra',name:'Extra',amount:250});
    copy.expenses.forEach(x=>{ if(normalizeGroup(x.group)==='extra' && String(x.name||'').trim().toLowerCase()==='extra') x.amount=250; });
    copy.extraBudget=250;
    copy.extraOverspendSource=['creditcard','savings'].includes(String(copy.extraOverspendSource||''))?String(copy.extraOverspendSource):'';
    copy.extraOverspendAmount=hasValue(copy.extraOverspendAmount)?n(copy.extraOverspendAmount):0;
    return copy;
  }
"""
if old_norm not in s: raise SystemExit('normalizeFinanceRecord block not found')
s=s.replace(old_norm,new_norm)

old_calc="""  function calc(rec){
    const incomes=Array.isArray(rec?.incomes)?rec.incomes:[];
    const expenses=Array.isArray(rec?.expenses)?rec.expenses:[];
    const income=incomes.reduce((s,x)=>s+n(x.amount),0);
    const outflow=expenses.reduce((s,x)=>s+n(x.amount),0);
    const savings=expenses.filter(x=>normalizeGroup(x.group)==='savings').reduce((s,x)=>s+n(x.amount),0);
    const investmentContribution=expenses.filter(x=>normalizeGroup(x.group)==='investments').reduce((s,x)=>s+n(x.amount),0);
    const extraSpent=expenses.filter(x=>normalizeGroup(x.group)==='extra').reduce((s,x)=>s+n(x.amount),0);
    const rawExtraBudget=hasValue(rec?.extraBudget)?n(rec.extraBudget):250;
    const extraBudget=rawExtraBudget>0?rawExtraBudget:250;
    const extraDelta=extraBudget-extraSpent;
    const leftover=income-outflow;
    const investmentTotal=hasValue(rec?.investmentTotal)?n(rec.investmentTotal):null;
    const sisterInvestments=hasValue(rec?.sisterInvestments)?n(rec.sisterInvestments):0;
    const ownInvestments=investmentTotal==null?null:Math.max(0,investmentTotal-sisterInvestments);
    return {
      income,outflow,savings,investmentContribution,leftover,overspent:Math.max(0,-leftover),
      extraSpent,extraBudget,extraDelta,extraOver:Math.max(0,-extraDelta),
      investmentTotal,sisterInvestments,ownInvestments
    };
  }
"""
new_calc="""  function calc(rec){
    const incomes=Array.isArray(rec?.incomes)?rec.incomes:[];
    const expenses=Array.isArray(rec?.expenses)?rec.expenses:[];
    const income=incomes.reduce((s,x)=>s+n(x.amount),0);
    const normalOutflow=expenses.reduce((s,x)=>s+n(x.amount),0);
    const extraOverspendAmount=Math.max(0,n(rec?.extraOverspendAmount));
    const extraOverspendSource=['creditcard','savings'].includes(String(rec?.extraOverspendSource||''))?String(rec.extraOverspendSource):'';
    const outflow=normalOutflow+extraOverspendAmount;
    const savings=expenses.filter(x=>normalizeGroup(x.group)==='savings').reduce((s,x)=>s+n(x.amount),0);
    const investmentContribution=expenses.filter(x=>normalizeGroup(x.group)==='investments').reduce((s,x)=>s+n(x.amount),0);
    const extraBudget=250;
    const extraSpent=extraBudget+extraOverspendAmount;
    const extraDelta=-extraOverspendAmount;
    const leftover=income-outflow;
    const investmentTotal=hasValue(rec?.investmentTotal)?n(rec.investmentTotal):null;
    const sisterInvestments=hasValue(rec?.sisterInvestments)?n(rec.sisterInvestments):0;
    const ownInvestments=investmentTotal==null?null:Math.max(0,investmentTotal-sisterInvestments);
    return {
      income,outflow,savings,investmentContribution,leftover,overspent:Math.max(0,-leftover),
      extraSpent,extraBudget,extraDelta,extraOver:extraOverspendAmount,extraOverspendAmount,extraOverspendSource,
      investmentTotal,sisterInvestments,ownInvestments
    };
  }
"""
if old_calc not in s: raise SystemExit('calc block not found')
s=s.replace(old_calc,new_calc)

s=s.replace("function freshRecord(month){ return {month,incomes:[],expenses:[],extraBudget:250,investmentTotal:'',sisterInvestments:'',finalized:false,finalizedAt:''}; }", "function freshRecord(month){ return {month,incomes:[],expenses:[],extraBudget:250,extraOverspendSource:'',extraOverspendAmount:0,investmentTotal:'',sisterInvestments:'',finalized:false,finalizedAt:''}; }")
s=s.replace("    if(!hasValue(copy.extraBudget)||n(copy.extraBudget)<=0)copy.extraBudget=250;", "    copy.extraBudget=250;\n    copy.extraOverspendSource=['creditcard','savings'].includes(String(copy.extraOverspendSource||''))?String(copy.extraOverspendSource):'';\n    copy.extraOverspendAmount=hasValue(copy.extraOverspendAmount)?n(copy.extraOverspendAmount):0;")

old_seed="""    d.incomes=RECURRING_INCOMES.map(x=>({name:x.name,amount:recurringValue(previous,'income',x.name,x.amount)}));
    d.expenses=RECURRING_EXPENSES.map(x=>({group:x.group,name:x.name,amount:recurringValue(previous,'expense',x.name,x.amount)}));
    if(previous&&hasValue(previous.extraBudget)&&n(previous.extraBudget)>0) d.extraBudget=n(previous.extraBudget); else d.extraBudget=250;
    return d;
"""
new_seed="""    d.incomes=RECURRING_INCOMES.map(x=>({name:x.name,amount:recurringValue(previous,'income',x.name,x.amount)}));
    d.expenses=RECURRING_EXPENSES.map(x=>({group:x.group,name:x.name,amount:x.group==='extra'?250:recurringValue(previous,'expense',x.name,x.amount)}));
    d.extraBudget=250;
    d.extraOverspendSource='';
    d.extraOverspendAmount=0;
    return d;
"""
if old_seed not in s: raise SystemExit('seed block not found')
s=s.replace(old_seed,new_seed)

old_queue="""  function buildRecurringQueue(d){
    return [
      ...(d.incomes||[]).map((_,index)=>({kind:'income',index})),
      ...(d.expenses||[]).map((_,index)=>({kind:'expense',index})),
      {kind:'extraBudget'}
    ];
  }
  function recurringSource(item,d){
    if(item?.kind==='extraBudget') return {name:'Extra budget',amount:d.extraBudget,group:'extra'};
    return item?.kind==='income'?d.incomes?.[item.index]:d.expenses?.[item.index];
  }
"""
new_queue="""  function buildRecurringQueue(d){
    return [
      ...(d.incomes||[]).map((_,index)=>({kind:'income',index})),
      ...(d.expenses||[]).map((_,index)=>({kind:'expense',index}))
    ];
  }
  function recurringSource(item,d){ return item?.kind==='income'?d.incomes?.[item.index]:d.expenses?.[item.index]; }
"""
if old_queue not in s: raise SystemExit('queue block not found')
s=s.replace(old_queue,new_queue)

s=s.replace("      if(idx>=queue.length){flow.stage='investmentTotal';renderWizard();return;}", "      if(idx>=queue.length){flow.stage='extraSpentAsk';renderWizard();return;}")
s=s.replace("      const meta=item.kind==='income'?{label:'Income',tone:'other'}:item.kind==='extraBudget'?{label:'Monthly limit',tone:'budgets'}:{label:CATEGORY_LABELS[groupTone(source.group)]||groupLabel(source.group),tone:groupTone(source.group)};", "      const isFixedExtra=item.kind==='expense'&&normalizeGroup(source.group)==='extra'&&String(source.name||'').trim().toLowerCase()==='extra';\n      const meta=item.kind==='income'?{label:'Income',tone:'other'}:{label:CATEGORY_LABELS[groupTone(source.group)]||groupLabel(source.group),tone:groupTone(source.group)};")
s=s.replace("      const help=item.kind==='extraBudget'?'This is your monthly spending ceiling for Extra purchases. It is not counted as money spent.':`Recurring ${item.kind==='income'?'income':meta.label.toLowerCase()}. Confirm it if it is still correct, or edit only the amount.`;\n      body.innerHTML=wizardHtml(`${source.name} · ${money(source.amount)}?`,help,`<div class=\"finance-reference finance-tone-${meta.tone}\"><span>${esc(meta.label)}</span><strong>${esc(source.name)}</strong><small>${item.kind==='extraBudget'?'Monthly spending limit':'Usual amount'} · ${money(source.amount)}</small></div><div class=\"finance-actions\"><button class=\"btn ghost\" type=\"button\" data-fin-recurring-edit>Edit</button><button class=\"btn primary big\" type=\"button\" data-fin-recurring-confirm>Confirm</button></div>`);", "      const help=isFixedExtra?'This €250 is your fixed monthly Extra allocation. You transfer it aside each month, so there is nothing to itemize inside it.':`Recurring ${item.kind==='income'?'income':meta.label.toLowerCase()}. Confirm it if it is still correct, or edit only the amount.`;\n      const editButton=isFixedExtra?'':`<button class=\"btn ghost\" type=\"button\" data-fin-recurring-edit>Edit</button>`;\n      body.innerHTML=wizardHtml(`${source.name} · ${money(source.amount)}?`,help,`<div class=\"finance-reference finance-tone-${meta.tone}\"><span>${esc(meta.label)}</span><strong>${esc(source.name)}</strong><small>${isFixedExtra?'Fixed monthly allocation':'Usual amount'} · ${money(source.amount)}</small></div><div class=\"finance-actions\">${editButton}<button class=\"btn primary big\" type=\"button\" data-fin-recurring-confirm>Confirm</button></div>`);")
s=s.replace("if(item.kind==='extraBudget')d.extraBudget=n(v);else source.amount=n(v);", "source.amount=n(v);")

# Insert the new Extra-overage wizard stages before incomeSource.
marker="""    if(flow.stage==='incomeSource'){
"""
insert="""    if(flow.stage==='extraSpentAsk'){
      setProgress('EXTRA',64);
      const current=n(d.extraOverspendAmount);
      body.innerHTML=wizardHtml('Any extra money spent?','Your regular €250 Extra is already set aside. Only log money you used beyond that amount.',`${current>0?`<div class=\"finance-reference finance-tone-budgets\"><span>Saved so far</span><strong>${money(current)} · ${d.extraOverspendSource==='savings'?'from saved up':'credit card'}</strong></div>`:''}<div class=\"finance-choice-stack\"><button class=\"finance-choice\" data-fin-extra-yes><div><strong>Yes</strong><small>I used money beyond the €250.</small></div><span>→</span></button><button class=\"finance-choice\" data-fin-extra-no><div><strong>No</strong><small>No extra money used.</small></div><span>→</span></button></div>`);
      $('[data-fin-extra-yes]')?.addEventListener('click',()=>{flow.stage='extraCreditCardAsk';renderWizard();});
      $('[data-fin-extra-no]')?.addEventListener('click',()=>{d.extraOverspendSource='';d.extraOverspendAmount=0;flow.stage=flow.extraReturn==='review'?'review':'investmentTotal';flow.extraReturn='';renderWizard();});
      return;
    }

    if(flow.stage==='extraCreditCardAsk'){
      setProgress('EXTRA',67);
      body.innerHTML=wizardHtml('Credit card used?','Did you use your credit card for spending beyond the fixed €250 Extra?',`<div class=\"finance-choice-stack\"><button class=\"finance-choice\" data-fin-credit-yes><div><strong>Yes</strong><small>Log how much credit card you used so far.</small></div><span>→</span></button><button class=\"finance-choice\" data-fin-credit-no><div><strong>No</strong><small>Check whether you used money from saved up instead.</small></div><span>→</span></button></div>`);
      $('[data-fin-credit-yes]')?.addEventListener('click',()=>{flow.stage='extraCreditCardAmount';renderWizard();});
      $('[data-fin-credit-no]')?.addEventListener('click',()=>{flow.stage='extraSavingsAsk';renderWizard();});
      return;
    }

    if(flow.stage==='extraCreditCardAmount'){
      setProgress('EXTRA',70);
      const existing=d.extraOverspendSource==='creditcard'?d.extraOverspendAmount:'';
      body.innerHTML=wizardHtml('How much credit card did you use?','Enter the extra credit-card spending so far. You can edit this draft later during the month.',`<div class=\"finance-money\"><span>€</span><input id=\"finMoney\" inputmode=\"decimal\" value=\"${esc(String(existing??''))}\" placeholder=\"0.00\"></div><div class=\"finance-actions\"><button class=\"btn ghost\" data-fin-back>Back</button><button class=\"btn primary big\" data-fin-next>Save</button></div>`);
      bindBack(()=>{flow.stage='extraCreditCardAsk';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.')))||n(v)<0)return toast('Enter a valid amount','warn');d.extraOverspendSource='creditcard';d.extraOverspendAmount=n(v);flow.stage=flow.extraReturn==='review'?'review':'investmentTotal';flow.extraReturn='';renderWizard();});
      return;
    }

    if(flow.stage==='extraSavingsAsk'){
      setProgress('EXTRA',69);
      body.innerHTML=wizardHtml('Money taken from saved up?','Did you take money from your savings because the normal €250 Extra was not enough?',`<div class=\"finance-choice-stack\"><button class=\"finance-choice\" data-fin-savings-extra-yes><div><strong>Yes</strong><small>Log how much you have taken from saved up so far.</small></div><span>→</span></button><button class=\"finance-choice\" data-fin-savings-extra-no><div><strong>No</strong><small>Nothing extra to log.</small></div><span>→</span></button></div>`);
      $('[data-fin-savings-extra-yes]')?.addEventListener('click',()=>{flow.stage='extraSavingsAmount';renderWizard();});
      $('[data-fin-savings-extra-no]')?.addEventListener('click',()=>{d.extraOverspendSource='';d.extraOverspendAmount=0;flow.stage=flow.extraReturn==='review'?'review':'investmentTotal';flow.extraReturn='';renderWizard();});
      return;
    }

    if(flow.stage==='extraSavingsAmount'){
      setProgress('EXTRA',70);
      const existing=d.extraOverspendSource==='savings'?d.extraOverspendAmount:'';
      body.innerHTML=wizardHtml('How much did you take from saved up?','Enter the extra amount used so far. You can edit this draft later during the month.',`<div class=\"finance-money\"><span>€</span><input id=\"finMoney\" inputmode=\"decimal\" value=\"${esc(String(existing??''))}\" placeholder=\"0.00\"></div><div class=\"finance-actions\"><button class=\"btn ghost\" data-fin-back>Back</button><button class=\"btn primary big\" data-fin-next>Save</button></div>`);
      bindBack(()=>{flow.stage='extraSavingsAsk';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.')))||n(v)<0)return toast('Enter a valid amount','warn');d.extraOverspendSource='savings';d.extraOverspendAmount=n(v);flow.stage=flow.extraReturn==='review'?'review':'investmentTotal';flow.extraReturn='';renderWizard();});
      return;
    }

"""
if marker not in s: raise SystemExit('incomeSource marker not found')
s=s.replace(marker,insert+marker,1)

# Hide Extra from manual expense category picker.
s=s.replace("${GROUPS.map(g=>`<button class=\"finance-choice finance-tone-${g.tone}\"", "${GROUPS.filter(g=>g.manual!==false).map(g=>`<button class=\"finance-choice finance-tone-${g.tone}\"")

# Investment back now returns to the Extra-overage questions.
s=s.replace("bindBack(()=>{flow.stage='extraBudget';renderWizard();});", "bindBack(()=>{flow.stage='extraSpentAsk';renderWizard();});")

# Review/detail language and controls.
s=s.replace("const extraStatus=c.extraOver>0?`<div class=\"finance-alert bad\">⚠ You spent ${money(c.extraOver)} more than your Extra budget.</div>`:`<div class=\"finance-alert good\">Extra budget: ${money(c.extraBudget)} · ${money(Math.max(0,c.extraDelta))} left</div>`;", "const extraStatus=c.extraOver>0?`<div class=\"finance-alert bad\">⚠ ${money(c.extraOver)} beyond your fixed €250 Extra · ${c.extraOverspendSource==='savings'?'taken from saved up':'credit card'}</div>`:`<div class=\"finance-alert good\">Extra: €250 fixed · no extra money used</div>`;")
s=s.replace("const extraLine=c.extraOver>0?`<div class=\"finance-alert bad\">⚠ Extra budget exceeded by ${money(c.extraOver)} · spent ${money(c.extraSpent)} of ${money(c.extraBudget)}</div>`:`<div class=\"finance-alert good\">Extra: ${money(c.extraSpent)} spent of ${money(c.extraBudget)} · ${money(Math.max(0,c.extraDelta))} left</div>`;", "const extraLine=c.extraOver>0?`<div class=\"finance-alert bad\">⚠ Extra money used: ${money(c.extraOver)} beyond the fixed €250 · ${c.extraOverspendSource==='savings'?'taken from saved up':'credit card'}</div>`:`<div class=\"finance-alert good\">Extra: €250 fixed · no extra money used</div>`;")
s=s.replace("<div class=\"finance-breakdown-row\"><span>Extra budget</span><strong>${money(c.extraBudget)} <button class=\"text-btn\" data-fin-edit-extra>Edit</button></strong></div>", "<div class=\"finance-breakdown-row finance-tone-budgets\"><span>Extra</span><strong>€250.00 fixed</strong></div>${c.extraOver>0?`<div class=\"finance-breakdown-row finance-negative\"><span>Extra beyond budget · ${c.extraOverspendSource==='savings'?'Saved up':'Credit card'}</span><strong>${money(c.extraOver)}</strong></div>`:''}<button class=\"btn ghost\" type=\"button\" data-fin-edit-extra-spend>${c.extraOver>0?'Edit extra money used':'Log extra money used'}</button>")
s=s.replace("$('[data-fin-edit-extra]')?.addEventListener('click',()=>{flow.stage='extraBudget';renderWizard();});", "$('[data-fin-edit-extra-spend]')?.addEventListener('click',()=>{flow.extraReturn='review';flow.stage='extraSpentAsk';renderWizard();});")

# Old extraBudget stage is no longer part of the normal flow; keep it unreachable but make it fixed if somehow hit.
s=s.replace("body.innerHTML=wizardHtml('What is your Extra budget this month?','Default is €250. You can change it for a specific month. Twogether will warn you if your Extra spending goes above it.'", "body.innerHTML=wizardHtml('Extra is fixed at €250','This monthly Extra allocation is fixed.'")
s=s.replace("d.extraBudget=n(v);flow.stage='investmentTotal';", "d.extraBudget=250;flow.stage='extraSpentAsk';")

p.write_text(s,encoding='utf-8')

# Backend v12: persist the new source/amount and restore fixed €250 allocation row.
p=Path('backend/Code.gs')
s=p.read_text(encoding='utf-8')
s=s.replace('version: 11','version: 12')
s=s.replace('state.version = 11','state.version = 12')
s=s.replace('version:11','version:12')
old="""function sanitizeFinanceMonth_(record, actor) {
  const incomes = Array.isArray(record && record.incomes) ? record.incomes.slice(0,40).map(sanitizeFinanceIncome_).filter(x => x.name && x.amount !== '') : [];
  let expenses = Array.isArray(record && record.expenses) ? record.expenses.slice(0,100).map(sanitizeFinanceExpense_).filter(x => x.name && x.amount !== '') : [];
  let rawExtraBudget = cleanMoney_(record && record.extraBudget);
  const legacyBudget = rawExtraBudget === '' || Number(rawExtraBudget) <= 0 || Number(rawExtraBudget) === 255;
  if (legacyBudget) {
    const legacyExtraIndex = expenses.findIndex(function(x){ return x.group === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra' && Number(x.amount) === 250; });
    if (legacyExtraIndex >= 0) {
      expenses.splice(legacyExtraIndex, 1);
      rawExtraBudget = 250;
    }
  }
  return {
    month: cleanText_(record && record.month, 10),
    incomes: incomes,
    expenses: expenses,
    extraBudget: rawExtraBudget === '' || Number(rawExtraBudget) <= 0 ? 250 : rawExtraBudget,
    investmentTotal: cleanMoney_(record && record.investmentTotal),
    sisterInvestments: cleanMoney_(record && record.sisterInvestments),
    finalized: !!(record && record.finalized === true),
    finalizedAt: cleanText_(record && record.finalizedAt, 40),
    updatedAt: cleanText_(record && record.updatedAt, 40),
    updatedBy: cleanActor_(record && record.updatedBy || actor)
  };
}
"""
new="""function sanitizeFinanceMonth_(record, actor) {
  const incomes = Array.isArray(record && record.incomes) ? record.incomes.slice(0,40).map(sanitizeFinanceIncome_).filter(x => x.name && x.amount !== '') : [];
  let expenses = Array.isArray(record && record.expenses) ? record.expenses.slice(0,100).map(sanitizeFinanceExpense_).filter(x => x.name && x.amount !== '') : [];
  let foundFixedExtra = false;
  expenses = expenses.filter(function(x){
    if (x.group === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra') {
      if (foundFixedExtra) return false;
      foundFixedExtra = true;
      x.amount = 250;
    }
    return true;
  });
  if (!foundFixedExtra) expenses.push({group:'extra', name:'Extra', amount:250});
  const sourceRaw = String(record && record.extraOverspendSource || '');
  const extraOverspendSource = sourceRaw === 'creditcard' || sourceRaw === 'savings' ? sourceRaw : '';
  const extraOverspendAmount = cleanMoney_(record && record.extraOverspendAmount);
  return {
    month: cleanText_(record && record.month, 10),
    incomes: incomes,
    expenses: expenses,
    extraBudget: 250,
    extraOverspendSource: extraOverspendSource,
    extraOverspendAmount: extraOverspendAmount === '' ? 0 : extraOverspendAmount,
    investmentTotal: cleanMoney_(record && record.investmentTotal),
    sisterInvestments: cleanMoney_(record && record.sisterInvestments),
    finalized: !!(record && record.finalized === true),
    finalizedAt: cleanText_(record && record.finalizedAt, 40),
    updatedAt: cleanText_(record && record.updatedAt, 40),
    updatedBy: cleanActor_(record && record.updatedBy || actor)
  };
}
"""
if old not in s: raise SystemExit('backend finance month block not found')
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')

# Cache bust finance JS.
p=Path('index.html')
s=p.read_text(encoding='utf-8').replace('finances.js?v=6','finances.js?v=7')
p.write_text(s,encoding='utf-8')
