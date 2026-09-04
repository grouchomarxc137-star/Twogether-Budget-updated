from pathlib import Path
import re


def replace_between(text, start, end, replacement, label):
    a = text.find(start)
    if a < 0:
        raise SystemExit(f'missing start: {label}')
    b = text.find(end, a)
    if b < 0:
        raise SystemExit(f'missing end: {label}')
    return text[:a] + replacement.rstrip() + '\n\n  ' + text[b:]


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing exact text: {label}')
    return text.replace(old, new, 1)


# ---------- finances.js ----------
p = Path('finances.js')
s = p.read_text()

s = replace_between(s, "function normalizeFinanceRecord(rec){", "function extraSourceLabel(source){", r'''function normalizeFinanceRecord(rec){
    const copy=JSON.parse(JSON.stringify(rec||{}));
    copy.expenses=Array.isArray(copy.expenses)?copy.expenses.map(x=>({...x,group:normalizeGroup(x.group)})):[];
    const fixedExtras=copy.expenses.filter(x=>normalizeGroup(x.group)==='extra' && String(x.name||'').trim().toLowerCase()==='extra');
    const storedBudget=hasValue(copy.extraBudget)?n(copy.extraBudget):(fixedExtras.length&&hasValue(fixedExtras[0].amount)?n(fixedExtras[0].amount):250);
    copy.extraBudget=storedBudget;
    copy.expenses=copy.expenses.filter(x=>normalizeGroup(x.group)!=='extra' || String(x.name||'').trim().toLowerCase()!=='extra' || x===fixedExtras[0]);
    if(!copy.expenses.some(x=>normalizeGroup(x.group)==='extra' && String(x.name||'').trim().toLowerCase()==='extra')) copy.expenses.push({group:'extra',name:'Extra',amount:storedBudget});
    copy.expenses.forEach(x=>{ if(normalizeGroup(x.group)==='extra' && String(x.name||'').trim().toLowerCase()==='extra') x.amount=storedBudget; });
    copy.extraSpends=Array.isArray(copy.extraSpends)?copy.extraSpends.map(x=>({id:x.id||uid(),source:['creditcard','savings','main'].includes(String(x.source||''))?String(x.source):'',amount:n(x.amount)})).filter(x=>x.source&&x.amount>0):[];
    if(!copy.extraSpends.length){
      const legacySource=['creditcard','savings','main'].includes(String(copy.extraOverspendSource||''))?String(copy.extraOverspendSource):'';
      const legacyAmount=hasValue(copy.extraOverspendAmount)?Math.max(0,n(copy.extraOverspendAmount)):0;
      if(legacySource&&legacyAmount>0) copy.extraSpends.push({id:uid(),source:legacySource,amount:legacyAmount});
    }
    const legacyFirst=copy.extraSpends[0]||null;
    copy.extraOverspendSource=legacyFirst?.source||'';
    copy.extraOverspendAmount=copy.extraSpends.reduce((sum,x)=>sum+n(x.amount),0);
    return copy;
  }''', 'normalizeFinanceRecord')

s = replace_between(s, "function extraSourceLabel(source){", "function loanPaid(item){", r'''function extraSourceLabel(source){
    if(source==='savings') return 'From Saved Up';
    if(source==='main') return 'From Main account leftover';
    return 'Credit Card';
  }

  function previousMonthKey(month){
    const match=/^(\d{4})-(\d{2})$/.exec(String(month||''));
    if(!match) return '';
    let y=Number(match[1]),m=Number(match[2])-1;
    if(m===0){y-=1;m=12;}
    return `${y}-${String(m).padStart(2,'0')}`;
  }

  function extraSpendsTotal(rec){ return (rec?.extraSpends||[]).reduce((sum,x)=>sum+n(x.amount),0); }

  function extraCarryInfo(month){
    const prevMonth=previousMonthKey(month),prev=prevMonth?recordFor(prevMonth):null;
    const over=prev?extraSpendsTotal(prev):0;
    return {
      prevMonth,
      over,
      budget:over>0?Math.max(100,250-Math.min(150,over)):250,
      debt:Math.max(0,over-150)
    };
  }

  function mainAccountLeftover(){ return ownMonths().reduce((sum,rec)=>sum+calc(rec).leftover,0); }

  function extraSpendSummary(rec){
    const grouped={creditcard:0,savings:0,main:0};
    (rec?.extraSpends||[]).forEach(x=>{ if(Object.prototype.hasOwnProperty.call(grouped,x.source)) grouped[x.source]+=n(x.amount); });
    return Object.entries(grouped).filter(([,amount])=>amount>0).map(([source,amount])=>({source,amount}));
  }''', 'extraSourceLabel helpers')

s = replace_between(s, "function calc(rec){", "function investmentGL(rec){", r'''function calc(rec){
    const incomes=Array.isArray(rec?.incomes)?rec.incomes:[];
    const expenses=Array.isArray(rec?.expenses)?rec.expenses:[];
    const income=incomes.reduce((sum,x)=>sum+n(x.amount),0);
    const normalOutflow=expenses.reduce((sum,x)=>sum+n(x.amount),0);
    const extraOverspendAmount=extraSpendsTotal(rec);
    const outflow=normalOutflow+extraOverspendAmount;
    const savings=expenses.filter(x=>normalizeGroup(x.group)==='savings').reduce((sum,x)=>sum+n(x.amount),0);
    const investmentContribution=expenses.filter(x=>normalizeGroup(x.group)==='investments').reduce((sum,x)=>sum+n(x.amount),0);
    const extraBudget=hasValue(rec?.extraBudget)?n(rec.extraBudget):250;
    const extraSpent=extraBudget+extraOverspendAmount;
    const extraDelta=-extraOverspendAmount;
    const leftover=income-outflow;
    const investmentTotal=hasValue(rec?.investmentTotal)?n(rec.investmentTotal):null;
    const sisterInvestments=hasValue(rec?.sisterInvestments)?n(rec.sisterInvestments):0;
    const ownInvestments=investmentTotal==null?null:Math.max(0,investmentTotal-sisterInvestments);
    return {
      income,outflow,savings,investmentContribution,leftover,overspent:Math.max(0,-leftover),
      extraSpent,extraBudget,extraDelta,extraOver:extraOverspendAmount,extraOverspendAmount,
      investmentTotal,sisterInvestments,ownInvestments
    };
  }''', 'calc')

s = replace_between(s, "function profileStats(){", "async function loadState(){", r'''function profileStats(){
    const p=profile();
    const bankTotal=p.bankAccounts.reduce((sum,x)=>sum+n(x.balance),0);
    const savingsTotal=n(p.savingsTotal);
    const heldTotal=p.savingsReserved.reduce((sum,x)=>sum+n(x.amount),0);
    const availableSavings=savingsTotal-heldTotal;
    const owedTotal=p.receivables.reduce((sum,x)=>sum+loanRemaining(x),0);
    const latestInvestment=[...ownMonths()].filter(x=>hasValue(x.investmentTotal)).sort((a,b)=>String(b.month).localeCompare(String(a.month)))[0]||null;
    const inv=latestInvestment?calc(latestInvestment):{investmentTotal:null,sisterInvestments:0,ownInvestments:null};
    const gl=latestInvestment?investmentGL(latestInvestment):null;
    const ownInvestments=inv.ownInvestments==null?0:inv.ownInvestments;
    const netWorth=availableSavings+ownInvestments;
    const mainLeftover=mainAccountLeftover();
    return {p,bankTotal,savingsTotal,heldTotal,availableSavings,owedTotal,latestInvestment,inv,gl,netWorth,mainLeftover};
  }''', 'profileStats')

s = replace_between(s, "function renderScenarioPanel(){", "function openScenarioModal(index){", r'''function renderScenarioPanel(){
    const root=$('#financeScenarios'); if(!root) return;
    const ps=profileStats(),p=ps.p;
    const latest=[...ownMonths()].sort((a,b)=>String(b.month).localeCompare(String(a.month)))[0]||null;
    const monthlyLeft=latest?calc(latest).leftover:0;
    const currentMain=ps.mainLeftover;
    const cards=p.scenarios.length?p.scenarios.map((x,i)=>{
      const upfront=n(x.upfront),monthly=n(x.monthly);
      const rawMainAfter=currentMain-upfront;
      const fromSavings=Math.max(0,-rawMainAfter);
      const mainAfter=Math.max(0,rawMainAfter);
      const savingsAfter=ps.availableSavings-fromSavings;
      const afterMonth=monthlyLeft-monthly;
      const type=monthly>0?'Purchase + Monthly cost':'Purchase';
      const cls=savingsAfter<0||afterMonth<0?'bad':fromSavings>0?'warn':'good';
      const verdict=savingsAfter<0?'Not fully covered by Main account + available savings':afterMonth<0?'Purchase fits, but the monthly cost exceeds your usual leftover':fromSavings>0?'Purchase needs some of your available savings':'Fits your current Main account leftover';
      const monthlyRows=monthly>0?`<div class="scenario-row"><span>Monthly cost</span><strong>${money(monthly)}</strong></div><div class="scenario-row"><span>Monthly leftover after</span><strong>${money(afterMonth)}</strong></div>`:'';
      const savingsRows=fromSavings>0?`<div class="scenario-row scenario-alert-row"><span>Needed from saved up</span><strong>${money(fromSavings)}</strong></div><div class="scenario-row"><span>Available savings after</span><strong>${money(savingsAfter)}</strong></div>`:'';
      return `<button class="finance-scenario-card ${cls}" type="button" data-fin-scenario="${i}"><span class="panel-kicker">${esc(type)}</span><h3>${esc(x.name)}</h3><div class="scenario-row"><span>Purchase price</span><strong>${money(upfront)}</strong></div><div class="scenario-row"><span>Current Main account leftover</span><strong>${money(currentMain)}</strong></div><div class="scenario-row"><span>Main account leftover after</span><strong>${money(mainAfter)}</strong></div>${monthlyRows}${savingsRows}<div class="scenario-verdict">${esc(verdict)}</div></button>`;
    }).join(''):'<div class="finance-current-empty">No purchase scenarios yet.</div>';
    root.innerHTML=`<div class="finance-scenario-wrap"><div class="finance-scenario-head"><div><span class="panel-kicker">WHAT IF?</span><h2>Purchase test scenarios</h2><p>Your Main account leftover is the sum of your logged monthly leftovers. Purchases use that first; any shortfall can come from actually available savings.</p></div><button class="btn primary" type="button" data-fin-add-scenario>+ Test a purchase</button></div><div class="finance-scenario-grid">${cards}</div></div>`;
    $('[data-fin-add-scenario]',root)?.addEventListener('click',()=>openScenarioModal(-1));
    $$('[data-fin-scenario]',root).forEach(btn=>btn.addEventListener('click',()=>openScenarioModal(Number(btn.dataset.finScenario))));
  }''', 'renderScenarioPanel')

s = replace_between(s, "function openScenarioModal(index){", "function renderDetail(rec){", r'''function openScenarioModal(index){
    const p=profile(),item=index>=0?p.scenarios[index]:null;
    showMini(`<span class="panel-kicker">TEST SCENARIO</span><h2>${item?'Edit purchase test':'Test a purchase'}</h2><p>Purchase price is tested against your accumulated Main account leftover. If that is not enough, Twogether uses your actually available savings. A monthly cost only reduces your usual monthly leftover.</p><div class="finance-mini-fields"><label>What are you considering?<input id="finMiniScenarioName" value="${esc(item?.name||'')}" placeholder="e.g. New laptop"></label><label>Purchase price<div class="finance-money mini"><span>€</span><input id="finMiniScenarioUpfront" inputmode="decimal" value="${esc(String(item?.upfront??''))}" placeholder="0.00"></div></label><label>Monthly cost, if any<div class="finance-money mini"><span>€</span><input id="finMiniScenarioMonthly" inputmode="decimal" value="${esc(String(item?.monthly??0))}" placeholder="0.00"></div></label></div><div class="finance-mini-actions">${item?'<button class="btn ghost" type="button" data-fin-mini-delete>Delete</button>':'<span></span>'}<button class="btn primary" type="button" data-fin-mini-save>Save scenario</button></div>`);
    $('[data-fin-mini-save]')?.addEventListener('click',()=>{
      const name=String($('#finMiniScenarioName')?.value||'').trim(),upfront=$('#finMiniScenarioUpfront')?.value||'',monthly=$('#finMiniScenarioMonthly')?.value||'0';
      if(!name)return toast('Add what you want to test','warn');
      if(upfront===''||!Number.isFinite(Number(upfront.replace(',','.'))))return toast('Enter a valid purchase price','warn');
      if(monthly!==''&&!Number.isFinite(Number(monthly.replace(',','.'))))return toast('Enter a valid monthly cost','warn');
      const next=profile(),row={id:item?.id||uid(),name,upfront:n(upfront),monthly:n(monthly)}; if(index>=0)next.scenarios[index]=row;else next.scenarios.push(row); saveProfile(next,'Scenario saved');
    });
    $('[data-fin-mini-delete]')?.addEventListener('click',()=>{const next=profile();next.scenarios.splice(index,1);saveProfile(next,'Scenario removed');});
  }''', 'openScenarioModal')

s = replace_between(s, "function renderDetail(rec){", "function ensureMiniModal(){", r'''function renderDetail(rec){
    const root=$('#financeDetail'); if(!root) return;
    const c=calc(rec),gl=investmentGL(rec),carry=extraCarryInfo(rec.month);
    const expenses=groupedExpenseHtml(rec.expenses||[],false,rec.extraSpends||[]);
    const incomes=(rec.incomes||[]).map(x=>`<div class="finance-breakdown-row"><span>${esc(x.name)}</span><strong>${money(x.amount)}</strong></div>`).join('');
    const extraStatus=c.extraOver>0?`<div class="finance-alert bad">⚠ ${money(c.extraOver)} spent beyond this month’s Extra budget.</div>`:'';
    const debtStatus=carry.debt>0?`<div class="finance-carry-note">You still owe yourself ${money(carry.debt)} from ${esc(monthLabel(carry.prevMonth))}.</div>`:'';
    const investmentBlock=c.investmentTotal!=null?`<div class="finance-review-section"><h3>Investment snapshot</h3><div class="finance-breakdown-row finance-tone-wealth"><span>Total investment account</span><strong>${money(c.investmentTotal)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Sis</span><strong>${money(c.sisterInvestments)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Your investments</span><strong>${money(c.ownInvestments)}</strong></div><div class="finance-breakdown-row ${gl?.value<0?'finance-negative':'finance-positive'}"><span>G/L p/m${gl?` vs ${monthLabel(gl.previousMonth)}`:''}</span><strong>${gl?signedMoney(gl.value):'—'}</strong></div></div>`:'';
    root.innerHTML=`<div class="finance-detail-head"><div><span class="panel-kicker">${esc(actor())}</span><h3>${esc(monthLabel(rec.month))}</h3></div>${rec.finalized?'<span class="finance-final-badge">Locked</span>':'<div class="finance-detail-actions"><button class="btn ghost" type="button" data-fin-edit>Edit draft</button><button class="btn primary" type="button" data-fin-finalize-existing>Confirm month</button></div>'}</div><div class="finance-summary-line"><div class="finance-summary-mini"><span>Income</span><strong>${money(c.income)}</strong></div><div class="finance-summary-mini"><span>Outflow</span><strong>${money(c.outflow)}</strong></div><div class="finance-summary-mini"><span>${c.leftover<0?'Overspent':'Leftover'}</span><strong>${money(Math.abs(c.leftover))}</strong></div></div>${extraStatus}${debtStatus}${incomes?`<div class="finance-review-section"><h3>Income</h3>${incomes}</div>`:''}${expenses?`<div class="finance-review-section"><h3>Monthly outflow</h3>${expenses}</div>`:''}${investmentBlock}`;
    $('[data-fin-edit]',root)?.addEventListener('click',()=>startEdit(rec));
    $('[data-fin-finalize-existing]',root)?.addEventListener('click',()=>confirmExistingMonth(rec));
  }''', 'renderDetail')

s = replace_between(s, "function freshRecord(month){", "function startMonth(month='2026-09',skipMonth=false){", r'''function freshRecord(month){ return {month,incomes:[],expenses:[],extraBudget:250,extraSpends:[],extraOverspendSource:'',extraOverspendAmount:0,investmentTotal:'',sisterInvestments:'',finalized:false,finalizedAt:''}; }
  function cloneRecord(rec){
    const copy=normalizeFinanceRecord(rec);
    copy.extraBudget=hasValue(copy.extraBudget)?n(copy.extraBudget):250;
    copy.extraSpends=Array.isArray(copy.extraSpends)?copy.extraSpends.map(x=>({...x,id:x.id||uid()})):[];
    copy.extraOverspendSource=copy.extraSpends[0]?.source||'';
    copy.extraOverspendAmount=copy.extraSpends.reduce((sum,x)=>sum+n(x.amount),0);
    copy.finalized=copy.finalized===true; if(!copy.finalizedAt)copy.finalizedAt='';
    if(copy.investmentTotal==null)copy.investmentTotal=''; if(copy.sisterInvestments==null)copy.sisterInvestments='';
    return copy;
  }''', 'fresh/clone record')

s = replace_between(s, "function seededRecord(month){", "function buildRecurringQueue(d){", r'''function seededRecord(month){
    const previous=latestPriorMonth(month),d=freshRecord(month),carry=extraCarryInfo(month);
    d.extraBudget=carry.budget;
    d.incomes=RECURRING_INCOMES.map(x=>({name:x.name,amount:recurringValue(previous,'income',x.name,x.amount)}));
    d.expenses=RECURRING_EXPENSES.map(x=>({group:x.group,name:x.name,amount:x.group==='extra'?carry.budget:recurringValue(previous,'expense',x.name,x.amount)}));
    d.extraSpends=[];
    return d;
  }''', 'seededRecord')

s = replace_between(s, "function groupedExpenseHtml(items,removable=false){", "function renderWizard(){", r'''function groupedExpenseHtml(items,removable=false,extraSpends=[]){
    const rows=(items||[]).map((x,index)=>({...x,index,group:normalizeGroup(x.group),tone:groupTone(x.group),isExtraSpend:false}));
    extraSpendSummary({extraSpends}).forEach(x=>rows.push({group:'extra',tone:'budgets',name:extraSourceLabel(x.source),amount:x.amount,isExtraSpend:true,extraSource:x.source,index:-1}));
    const grouped={};
    rows.forEach(x=>(grouped[x.tone]||(grouped[x.tone]=[])).push(x));
    return CATEGORY_ORDER.filter(tone=>grouped[tone]?.length).map(tone=>{
      const group=grouped[tone],total=group.reduce((sum,x)=>sum+n(x.amount),0);
      const itemRows=group.map(x=>{
        const fixedExtra=!x.isExtraSpend&&normalizeGroup(x.group)==='extra'&&String(x.name||'').trim().toLowerCase()==='extra';
        const rowClass=x.isExtraSpend?' finance-extra-spend-row':fixedExtra&&n(x.amount)<250?' finance-reduced-extra':'';
        const controls=removable&&!x.isExtraSpend?` <button class="text-btn" data-fin-edit-expense="${x.index}">Edit</button> <button class="text-btn" data-fin-remove-expense="${x.index}">×</button>`:'';
        return `<div class="finance-category-item${rowClass}"><span>${esc(x.name||groupLabel(x.group))}</span><strong>${money(x.amount)}${controls}</strong></div>`;
      }).join('');
      return `<div class="finance-category-bubble finance-tone-${tone}"><div class="finance-category-head"><strong>${esc(CATEGORY_LABELS[tone]||tone)}</strong><span>${money(total)}</span></div>${itemRows}</div>`;
    }).join('');
  }''', 'groupedExpenseHtml')

old_help = "const help=isFixedExtra?'This €250 is your fixed monthly Extra allocation. You transfer it aside each month, so there is nothing to itemize inside it.':`Recurring ${item.kind==='income'?'income':meta.label.toLowerCase()}. Confirm it if it is still correct, or edit only the amount.`;\n      const editButton=isFixedExtra?'':`<button class=\"btn ghost\" type=\"button\" data-fin-recurring-edit>Edit</button>`;\n      body.innerHTML=wizardHtml(`${source.name} · ${money(source.amount)}?`,help,`<div class=\"finance-reference finance-tone-${meta.tone}\"><span>${esc(meta.label)}</span><strong>${esc(source.name)}</strong><small>${isFixedExtra?'Fixed monthly allocation':'Usual amount'} · ${money(source.amount)}</small></div><div class=\"finance-actions\">${editButton}<button class=\"btn primary big\" type=\"button\" data-fin-recurring-confirm>Confirm</button></div>`);"
new_help = "const carry=extraCarryInfo(d.month);\n      const help=isFixedExtra?(n(d.extraBudget)<250?`Your normal €250 Extra is reduced this month because you used extra money in ${monthLabel(carry.prevMonth)}.${carry.debt>0?` You still owe yourself ${money(carry.debt)} from last month.`:''}`:'This is your normal monthly Extra allocation. You do not need to itemize what the budget itself is spent on.'):`Recurring ${item.kind==='income'?'income':meta.label.toLowerCase()}. Confirm it if it is still correct, or edit only the amount.`;\n      const editButton=isFixedExtra?'':`<button class=\"btn ghost\" type=\"button\" data-fin-recurring-edit>Edit</button>`;\n      const extraClass=isFixedExtra&&n(d.extraBudget)<250?' finance-extra-budget-reduced':'';\n      body.innerHTML=wizardHtml(`${source.name} · ${money(source.amount)}?`,help,`<div class=\"finance-reference finance-tone-${meta.tone}${extraClass}\"><span>${esc(meta.label)}</span><strong>${esc(source.name)}</strong><small>${isFixedExtra?'Monthly Extra budget':'Usual amount'} · ${money(source.amount)}</small></div><div class=\"finance-actions\">${editButton}<button class=\"btn primary big\" type=\"button\" data-fin-recurring-confirm>Confirm</button></div>`);"
s = replace_once(s, old_help, new_help, 'recurring Extra help')

s = replace_between(s, "if(flow.stage==='extraSpentAsk'){", "if(flow.stage==='incomeSource'){", r'''if(flow.stage==='extraSpentAsk'){
      setProgress('EXTRA',64);
      const entries=d.extraSpends||[];
      const saved=entries.length?`<div class="finance-list">${entries.map((x,i)=>`<div class="finance-list-row finance-extra-saved"><span>${esc(extraSourceLabel(x.source))}</span><strong>${money(x.amount)} <button class="text-btn" data-fin-extra-edit="${i}">Edit</button> <button class="text-btn" data-fin-extra-remove="${i}">×</button></strong></div>`).join('')}</div>`:'';
      body.innerHTML=wizardHtml('Any extra money spent?','Only log money used beyond your Extra budget for this month.',`${saved}<div class="finance-choice-stack"><button class="finance-choice" data-fin-extra-yes><div><strong>Yes</strong><small>Add credit card, saved-up, or Main account spending.</small></div><span>→</span></button><button class="finance-choice" data-fin-extra-no><div><strong>${entries.length?'No more':'No'}</strong><small>${entries.length?'Continue with what is saved.':'Nothing beyond the Extra budget.'}</small></div><span>→</span></button></div>`);
      $$('[data-fin-extra-edit]').forEach(btn=>btn.addEventListener('click',()=>{flow.temp={extraEditIndex:Number(btn.dataset.finExtraEdit)};flow.stage='extraEditAmount';renderWizard();}));
      $$('[data-fin-extra-remove]').forEach(btn=>btn.addEventListener('click',()=>{d.extraSpends.splice(Number(btn.dataset.finExtraRemove),1);renderWizard();}));
      $('[data-fin-extra-yes]')?.addEventListener('click',()=>{flow.stage='extraSourceAsk';renderWizard();});
      $('[data-fin-extra-no]')?.addEventListener('click',()=>{flow.stage=flow.extraReturn==='review'?'review':'investmentTotal';flow.extraReturn='';renderWizard();});
      return;
    }

    if(flow.stage==='extraSourceAsk'){
      setProgress('EXTRA',67);
      body.innerHTML=wizardHtml('Where did the extra money come from?','Choose the source for this extra spending.',`<div class="finance-choice-stack"><button class="finance-choice" data-fin-extra-source="creditcard"><div><strong>Credit Card</strong><small>Extra spending charged to your credit card.</small></div><span>→</span></button><button class="finance-choice" data-fin-extra-source="savings"><div><strong>From Saved Up</strong><small>Money taken from your savings.</small></div><span>→</span></button><button class="finance-choice" data-fin-extra-source="main"><div><strong>From Main account leftover</strong><small>Extra money used from your accumulated Main account leftover.</small></div><span>→</span></button></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button></div>`);
      bindBack(()=>{flow.stage='extraSpentAsk';renderWizard();});
      $$('[data-fin-extra-source]').forEach(btn=>btn.addEventListener('click',()=>{flow.temp={extraSource:btn.dataset.finExtraSource};flow.stage='extraAmount';renderWizard();}));
      return;
    }

    if(flow.stage==='extraAmount'){
      const source=t.extraSource||'creditcard'; setProgress('EXTRA',70);
      body.innerHTML=wizardHtml(`How much from ${extraSourceLabel(source)}?`,'Enter the amount used so far. You can add another extra source afterwards.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Save</button></div>`);
      bindBack(()=>{flow.stage='extraSourceAsk';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.')))||n(v)<=0)return toast('Enter a valid amount','warn');d.extraSpends.push({id:uid(),source,amount:n(v)});flow.temp={};flow.stage='extraMoreAsk';renderWizard();});
      return;
    }

    if(flow.stage==='extraMoreAsk'){
      setProgress('EXTRA',72);
      const total=extraSpendsTotal(d);
      body.innerHTML=wizardHtml('Any more extra money spent?','You can keep adding extra spending from a different or the same source.',`<div class="finance-reference finance-tone-budgets"><span>Extra money logged so far</span><strong>${money(total)}</strong></div><div class="finance-choice-stack"><button class="finance-choice" data-fin-extra-more><div><strong>Yes, add another</strong></div><span>＋</span></button><button class="finance-choice" data-fin-extra-done><div><strong>No, continue</strong></div><span>→</span></button></div>`);
      $('[data-fin-extra-more]')?.addEventListener('click',()=>{flow.stage='extraSourceAsk';renderWizard();});
      $('[data-fin-extra-done]')?.addEventListener('click',()=>{flow.stage=flow.extraReturn==='review'?'review':'investmentTotal';flow.extraReturn='';renderWizard();});
      return;
    }

    if(flow.stage==='extraEditAmount'){
      const idx=Number(t.extraEditIndex),item=d.extraSpends?.[idx];
      if(!item){flow.temp={};flow.stage='extraSpentAsk';renderWizard();return;}
      setProgress('EDIT EXTRA',70);
      body.innerHTML=wizardHtml(`Edit ${extraSourceLabel(item.source)}`,'Update this extra amount. It remains editable until the month is confirmed.',`<div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(item.amount??''))}" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Save change</button></div>`);
      bindBack(()=>{flow.temp={};flow.stage='extraSpentAsk';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.')))||n(v)<=0)return toast('Enter a valid amount','warn');item.amount=n(v);flow.temp={};flow.stage='extraSpentAsk';renderWizard();});
      return;
    }''', 'extra wizard stages')

s = replace_between(s, "function renderReview(){", "async function confirmExistingMonth(rec){", r'''function renderReview(){
    const body=$('#financeWizardBody'); if(!body||!flow) return;
    const d=flow.data,c=calc(d),gl=investmentGL(d),carry=extraCarryInfo(d.month); setProgress('REVIEW',100);
    const incomeRows=d.incomes.map((x,i)=>`<div class="finance-list-row"><span>${esc(x.name)}</span><strong>${money(x.amount)} <button class="text-btn" data-fin-remove-income="${i}">×</button></strong></div>`).join('')||'<div class="finance-empty">No income added.</div>';
    const expenseRows=groupedExpenseHtml(d.expenses,true,d.extraSpends||[])||'<div class="finance-empty">No expenses added.</div>';
    const extraLine=c.extraOver>0?`<div class="finance-alert bad">⚠ ${money(c.extraOver)} spent beyond this month’s Extra budget.</div>`:'';
    const debtLine=carry.debt>0?`<div class="finance-carry-note">You still owe yourself ${money(carry.debt)} from ${esc(monthLabel(carry.prevMonth))}.</div>`:'';
    const investmentLines=c.investmentTotal==null?'<div class="finance-breakdown-row"><span>Investment snapshot</span><strong>Skipped</strong></div>':`<div class="finance-breakdown-row finance-tone-wealth"><span>Total investments</span><strong>${money(c.investmentTotal)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Sis</span><strong>${money(c.sisterInvestments)}</strong></div><div class="finance-breakdown-row finance-tone-wealth"><span>Your investments</span><strong>${money(c.ownInvestments)}</strong></div><div class="finance-breakdown-row ${gl?.value<0?'finance-negative':'finance-positive'}"><span>G/L p/m${gl?` vs ${monthLabel(gl.previousMonth)}`:''}</span><strong>${gl?signedMoney(gl.value):'—'}</strong></div>`;
    body.innerHTML=wizardHtml(`Ready to save ${monthLabel(d.month)}?`,'Review your personal monthly picture before saving.',`<div class="finance-summary-line"><div class="finance-summary-mini"><span>Income</span><strong>${money(c.income)}</strong></div><div class="finance-summary-mini"><span>Outflow</span><strong>${money(c.outflow)}</strong></div><div class="finance-summary-mini"><span>${c.leftover<0?'Overspent':'Leftover'}</span><strong>${money(Math.abs(c.leftover))}</strong></div></div>${extraLine}${debtLine}<div class="finance-review-section"><h3>Income</h3>${incomeRows}<button class="btn ghost" data-fin-add-income>Add income</button></div><div class="finance-review-section"><h3>Outflow</h3>${expenseRows}<button class="btn ghost" data-fin-add-expense>Add expense</button>${c.extraOver>0?'<button class="btn ghost" type="button" data-fin-edit-extra-spend>Edit extra money used</button>':'<button class="btn ghost" type="button" data-fin-edit-extra-spend>Log extra money used</button>'}</div><div class="finance-review-section"><h3>Investment tracking</h3>${investmentLines}<button class="btn ghost" data-fin-edit-investments>Edit investment snapshot</button></div><div class="finance-actions finance-save-actions"><button class="btn ghost" data-fin-cancel>Cancel</button><div><button class="btn ghost" data-fin-save-draft>Save draft</button><button class="btn primary big" data-fin-finalize>Confirm month</button></div></div>`);
    $$('[data-fin-remove-income]').forEach(btn=>btn.addEventListener('click',()=>{d.incomes.splice(Number(btn.dataset.finRemoveIncome),1);renderReview();}));
    $$('[data-fin-edit-expense]').forEach(btn=>btn.addEventListener('click',()=>{flow.temp={editExpenseIndex:Number(btn.dataset.finEditExpense)};flow.stage='editExistingExpense';renderWizard();}));
    $$('[data-fin-remove-expense]').forEach(btn=>btn.addEventListener('click',()=>{d.expenses.splice(Number(btn.dataset.finRemoveExpense),1);renderReview();}));
    $('[data-fin-add-income]')?.addEventListener('click',()=>{flow.stage='incomeSource';renderWizard();});
    $('[data-fin-add-expense]')?.addEventListener('click',()=>{flow.stage='expenseGroup';renderWizard();});
    $('[data-fin-edit-extra-spend]')?.addEventListener('click',()=>{flow.extraReturn='review';flow.stage='extraSpentAsk';renderWizard();});
    $('[data-fin-edit-investments]')?.addEventListener('click',()=>{flow.stage='investmentTotal';renderWizard();});
    $('[data-fin-cancel]')?.addEventListener('click',resetWizard);
    $('[data-fin-save-draft]')?.addEventListener('click',()=>saveMonth(false));
    $('[data-fin-finalize]')?.addEventListener('click',()=>saveMonth(true));
  }''', 'renderReview')

p.write_text(s)

# ---------- backend/Code.gs ----------
p = Path('backend/Code.gs')
g = p.read_text()
g = g.replace('version: 13', 'version: 14')
g = g.replace('version: 13,', 'version: 14,')
g = g.replace('state.version = 13;', 'state.version = 14;')

backend_month = r'''function sanitizeFinanceExtraSpend_(item) {
  const sourceRaw = String(item && item.source || '');
  const source = sourceRaw === 'creditcard' || sourceRaw === 'savings' || sourceRaw === 'main' ? sourceRaw : '';
  return {
    id: cleanText_(item && item.id, 80) || Utilities.getUuid(),
    source: source,
    amount: cleanMoney_(item && item.amount)
  };
}

function sanitizeFinanceMonth_(record, actor) {
  const incomes = Array.isArray(record && record.incomes) ? record.incomes.slice(0,40).map(sanitizeFinanceIncome_).filter(x => x.name && x.amount !== '') : [];
  let expenses = Array.isArray(record && record.expenses) ? record.expenses.slice(0,100).map(sanitizeFinanceExpense_).filter(x => x.name && x.amount !== '') : [];
  const rawBudget = cleanMoney_(record && record.extraBudget);
  const extraBudget = rawBudget === '' ? 250 : rawBudget;
  let foundFixedExtra = false;
  expenses = expenses.filter(function(x){
    if (x.group === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra') {
      if (foundFixedExtra) return false;
      foundFixedExtra = true;
      x.amount = extraBudget;
    }
    return true;
  });
  if (!foundFixedExtra) expenses.push({group:'extra', name:'Extra', amount:extraBudget});

  let extraSpends = Array.isArray(record && record.extraSpends) ? record.extraSpends.slice(0,60).map(sanitizeFinanceExtraSpend_).filter(function(x){ return x.source && x.amount !== '' && Number(x.amount) > 0; }) : [];
  if (!extraSpends.length) {
    const legacySourceRaw = String(record && record.extraOverspendSource || '');
    const legacySource = legacySourceRaw === 'creditcard' || legacySourceRaw === 'savings' || legacySourceRaw === 'main' ? legacySourceRaw : '';
    const legacyAmount = cleanMoney_(record && record.extraOverspendAmount);
    if (legacySource && legacyAmount !== '' && Number(legacyAmount) > 0) extraSpends.push({id:Utilities.getUuid(),source:legacySource,amount:legacyAmount});
  }
  const legacyTotal = extraSpends.reduce(function(sum,x){ return sum + Number(x.amount || 0); },0);
  return {
    month: cleanText_(record && record.month, 10),
    incomes: incomes,
    expenses: expenses,
    extraBudget: extraBudget,
    extraSpends: extraSpends,
    extraOverspendSource: extraSpends.length ? extraSpends[0].source : '',
    extraOverspendAmount: legacyTotal,
    investmentTotal: cleanMoney_(record && record.investmentTotal),
    sisterInvestments: cleanMoney_(record && record.sisterInvestments),
    finalized: !!(record && record.finalized === true),
    finalizedAt: cleanText_(record && record.finalizedAt, 40),
    updatedAt: cleanText_(record && record.updatedAt, 40),
    updatedBy: cleanActor_(record && record.updatedBy || actor)
  };
}'''
g = replace_between(g, 'function sanitizeFinanceMonth_(record, actor) {', 'function sanitizeFinanceList_(list, actor) {', backend_month, 'backend month sanitizer')
p.write_text(g)

# ---------- index.html ----------
p = Path('index.html')
h = p.read_text()
old = '''  <nav class="tabs trip-subnav" id="tripSubnav" role="tablist" aria-label="Trip pages">\n    <button class="tab active" data-sheet="log" type="button">Log trip</button>\n    <button class="tab" data-sheet="monthly" type="button">Monthly</button>\n    <button class="tab" data-sheet="compare" type="button">Compare</button>\n  </nav>'''
new = old + '''\n  <nav class="tabs finance-subnav hidden" id="financeSubnav" role="tablist" aria-label="Finance pages">\n    <button class="tab active" type="button" data-fin-subview="overview">Overview</button>\n    <button class="tab" type="button" data-fin-subview="monthly">Monthly finances</button>\n    <button class="tab" type="button" data-fin-subview="balances">Balances & loans</button>\n    <button class="tab" type="button" data-fin-subview="scenarios">Test scenarios</button>\n  </nav>'''
h = replace_once(h, old, new, 'top finance subnav')
inner = '''      <nav class="finance-subnav" aria-label="Finance pages">\n        <button class="active" type="button" data-fin-subview="overview">Overview</button>\n        <button type="button" data-fin-subview="monthly">Monthly finances</button>\n        <button type="button" data-fin-subview="balances">Balances & loans</button>\n        <button type="button" data-fin-subview="scenarios">Test scenarios</button>\n      </nav>\n\n'''
h = replace_once(h, inner, '', 'remove inner finance subnav')
h = h.replace('navigation.css?v=1','navigation.css?v=2').replace('finances.js?v=8','finances.js?v=9').replace('navigation.js?v=1','navigation.js?v=2')
p.write_text(h)

# ---------- navigation.js ----------
p = Path('navigation.js')
j = p.read_text()
j = replace_once(j, "    $('#tripSubnav')?.classList.toggle('hidden',name!=='trips');", "    $('#tripSubnav')?.classList.toggle('hidden',name!=='trips');\n    $('#financeSubnav')?.classList.toggle('hidden',name!=='finances');", 'finance top subnav visibility')
p.write_text(j)

# ---------- navigation.css ----------
p = Path('navigation.css')
c = p.read_text()
c = c.replace('.trip-subnav{padding-top:8px}.trip-subnav.hidden{display:none!important}.finance-subnav{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 22px}.finance-subnav button{border:1px solid var(--line);background:#faf7f2;border-radius:999px;padding:9px 14px;font:inherit;color:var(--muted);cursor:pointer}.finance-subnav button.active{background:var(--card);color:var(--text);box-shadow:0 6px 18px rgba(54,43,36,.06)}', '.trip-subnav,.finance-subnav{padding-top:8px}.trip-subnav.hidden,.finance-subnav.hidden{display:none!important}')
c += '.finance-kpi.month-status{text-align:center;display:flex;align-items:center;justify-content:center;min-height:92px}.finance-extra-spend-row span,.finance-extra-spend-row strong,.finance-reduced-extra strong,.finance-extra-budget-reduced strong,.finance-extra-budget-reduced small,.finance-carry-note{color:#a43d31!important}.finance-carry-note{font-size:.9rem;margin:8px 0 12px}.finance-extra-saved span,.finance-extra-saved strong{color:#a43d31}.scenario-alert-row span,.scenario-alert-row strong{color:#a43d31!important}.finance-category-item.finance-extra-spend-row{font-weight:650}@media(max-width:700px){.finance-subnav{display:flex;overflow-x:auto;flex-wrap:nowrap}.finance-subnav .tab{white-space:nowrap;flex:0 0 auto}}\n'
p.write_text(c)
