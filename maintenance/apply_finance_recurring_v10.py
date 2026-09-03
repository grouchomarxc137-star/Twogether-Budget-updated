from pathlib import Path
import re

p=Path('finances.js')
s=p.read_text(encoding='utf-8')

# 1) Category model + recurring template.
pattern=r"  const GROUPS = \[\n.*?\n  \];"
replacement="""  const GROUPS = [
    {key:'medical',label:'Medical',example:'e.g. Zorgverzekering',tone:'medical',named:true},
    {key:'subscriptions',label:'Subscriptions',example:'e.g. Spotify',tone:'subscriptions',named:true},
    {key:'rent',label:'Rent',defaultName:'Rent',tone:'budgets'},
    {key:'groceries',label:'Groceries',defaultName:'Groceries',tone:'budgets'},
    {key:'extra',label:'Extra',defaultName:'Extra',tone:'budgets',optionalName:true},
    {key:'savings',label:'Save up',defaultName:'Save up',tone:'wealth'},
    {key:'investments',label:'Investments',defaultName:'Investments',tone:'wealth'},
    {key:'other',label:'Other',example:'e.g. Gift',tone:'other',named:true}
  ];
  const RECURRING_INCOMES = [
    {name:'Neways',amount:2051},
    {name:'Belastingdienst',amount:129}
  ];
  const RECURRING_EXPENSES = [
    {group:'medical',name:'Zorgverzekering',amount:158},
    {group:'medical',name:'Liability Insurance',amount:4},
    {group:'rent',name:'Rent',amount:50},
    {group:'subscriptions',name:'Chatgpt Plus',amount:23},
    {group:'subscriptions',name:'Sportcity',amount:28},
    {group:'subscriptions',name:'Spotify',amount:8.5},
    {group:'subscriptions',name:'iCloud',amount:3},
    {group:'subscriptions',name:'NS',amount:100},
    {group:'subscriptions',name:'Oranje Pakketje',amount:4},
    {group:'subscriptions',name:'Odido',amount:30},
    {group:'groceries',name:'Groceries',amount:255},
    {group:'extra',name:'Extra',amount:250},
    {group:'investments',name:'Investments',amount:550},
    {group:'savings',name:'Save up',amount:500}
  ];
  const CATEGORY_ORDER=['medical','subscriptions','budgets','wealth','other'];
  const CATEGORY_LABELS={medical:'Medical',subscriptions:'Subscriptions',budgets:'Budgets',wealth:'Savings / Investments',other:'Other'};"""
s,n=re.subn(pattern,replacement,s,count=1,flags=re.S)
if n!=1: raise SystemExit('GROUPS block not found')

# Existing Transport/NS entries from v8 should immediately display/store as Subscriptions.
old="""    if(g === 'health') return 'medical';
    if(g === 'living') return 'rent';
    return GROUPS.some(x=>x.key===g) ? g : 'other';"""
new="""    if(g === 'health') return 'medical';
    if(g === 'living') return 'rent';
    if(g === 'transport') return 'subscriptions';
    return GROUPS.some(x=>x.key===g) ? g : 'other';"""
if old not in s: raise SystemExit('normalizeGroup anchor missing')
s=s.replace(old,new,1)

# 2) Seed each new month with recurring values, carrying last month's edits forward.
anchor_re=r"(  function listHtml\(items,labelFn\)\{[^\n]+\}\n)"
helpers=r'''\1
  function latestPriorMonth(month){
    return [...ownMonths()].filter(x=>String(x.month)<String(month)).sort((a,b)=>String(b.month).localeCompare(String(a.month)))[0]||null;
  }
  function recurringValue(previous,kind,name,fallback){
    if(!previous) return fallback;
    const list=kind==='income'?(previous.incomes||[]):(previous.expenses||[]);
    const match=list.find(x=>String(x.name||'').trim().toLowerCase()===String(name).trim().toLowerCase());
    return match&&hasValue(match.amount)?n(match.amount):fallback;
  }
  function seededRecord(month){
    const previous=latestPriorMonth(month),d=freshRecord(month);
    d.incomes=RECURRING_INCOMES.map(x=>({name:x.name,amount:recurringValue(previous,'income',x.name,x.amount)}));
    d.expenses=RECURRING_EXPENSES.map(x=>({group:x.group,name:x.name,amount:recurringValue(previous,'expense',x.name,x.amount)}));
    if(previous&&hasValue(previous.extraBudget)) d.extraBudget=n(previous.extraBudget);
    return d;
  }
  function buildRecurringQueue(d){
    return [
      ...(d.incomes||[]).map((_,index)=>({kind:'income',index})),
      ...(d.expenses||[]).map((_,index)=>({kind:'expense',index}))
    ];
  }
  function recurringSource(item,d){ return item?.kind==='income'?d.incomes?.[item.index]:d.expenses?.[item.index]; }
  function startRecurringMonth(month){
    const d=seededRecord(month||selectedMonth);
    flow={data:d,stage:'recurringCheck',temp:{},recurringQueue:buildRecurringQueue(d),recurringIndex:0};
    renderWizard();
  }
  function groupedExpenseHtml(items,removable=false){
    const rows=(items||[]).map((x,index)=>({...x,index,group:normalizeGroup(x.group),tone:groupTone(x.group)}));
    const grouped={};
    rows.forEach(x=>(grouped[x.tone]||(grouped[x.tone]=[])).push(x));
    return CATEGORY_ORDER.filter(tone=>grouped[tone]?.length).map(tone=>{
      const group=grouped[tone],total=group.reduce((sum,x)=>sum+n(x.amount),0);
      const itemRows=group.map(x=>{
        const label=x.group==='extra'&&x.name&&x.name!=='Extra'?`Extra · ${esc(x.name)}`:esc(x.name||groupLabel(x.group));
        const remove=removable?` <button class="text-btn" data-fin-remove-expense="${x.index}">×</button>`:'';
        return `<div class="finance-category-item"><span>${label}</span><strong>${money(x.amount)}${remove}</strong></div>`;
      }).join('');
      return `<div class="finance-category-bubble finance-tone-${tone}"><div class="finance-category-head"><strong>${esc(CATEGORY_LABELS[tone]||tone)}</strong><span>${money(total)}</span></div>${itemRows}</div>`;
    }).join('');
  }
'''
s,n=re.subn(anchor_re,helpers,s,count=1)
if n!=1: raise SystemExit('listHtml anchor missing')

# New month starts with the recurring checklist. Month chooser still comes first when started from the main button.
old="  function startMonth(month='2026-09',skipMonth=false){ flow={data:freshRecord(month||selectedMonth),stage:skipMonth?'incomeSource':'month',temp:{}}; renderWizard(); }"
new="  function startMonth(month='2026-09',skipMonth=false){ const target=month||selectedMonth; if(skipMonth){startRecurringMonth(target);return;} flow={data:freshRecord(target),stage:'month',temp:{}}; renderWizard(); }"
if old not in s: raise SystemExit('startMonth anchor missing')
s=s.replace(old,new,1)

old="bindBack(resetWizard); $('[data-fin-next]')?.addEventListener('click',()=>{d.month=$('#finMonthSelect')?.value||d.month;flow.stage='incomeSource';renderWizard();}); return;"
new="bindBack(resetWizard); $('[data-fin-next]')?.addEventListener('click',()=>{const chosen=$('#finMonthSelect')?.value||d.month;startRecurringMonth(chosen);}); return;"
if old not in s: raise SystemExit('month next anchor missing')
s=s.replace(old,new,1)

# 3) Insert Confirm/Edit recurring-item flow before manual income entry.
marker="""    if(flow.stage==='incomeSource'){
"""
recurring="""    if(flow.stage==='recurringCheck'){
      const queue=flow.recurringQueue||buildRecurringQueue(d),idx=Number(flow.recurringIndex||0);
      if(idx>=queue.length){flow.stage='extraBudget';renderWizard();return;}
      const item=queue[idx],source=recurringSource(item,d);
      if(!source){flow.recurringIndex=idx+1;renderWizard();return;}
      const meta=item.kind==='income'?{label:'Income',tone:'other'}:{label:CATEGORY_LABELS[groupTone(source.group)]||groupLabel(source.group),tone:groupTone(source.group)};
      const pct=12+Math.round(((idx+1)/Math.max(1,queue.length))*48);
      setProgress(`CHECKING ${idx+1} OF ${queue.length}`,pct);
      body.innerHTML=wizardHtml(`${source.name} · ${money(source.amount)}?`,`Recurring ${item.kind==='income'?'income':meta.label.toLowerCase()}. Confirm it if it is still correct, or edit only the amount.`,`<div class="finance-reference finance-tone-${meta.tone}"><span>${esc(meta.label)}</span><strong>${esc(source.name)}</strong><small>Usual amount · ${money(source.amount)}</small></div><div class="finance-actions"><button class="btn ghost" type="button" data-fin-recurring-edit>Edit</button><button class="btn primary big" type="button" data-fin-recurring-confirm>Confirm</button></div>`);
      $('[data-fin-recurring-confirm]')?.addEventListener('click',()=>{flow.recurringIndex=idx+1;renderWizard();});
      $('[data-fin-recurring-edit]')?.addEventListener('click',()=>{flow.temp={recurringItem:item};flow.stage='recurringEdit';renderWizard();});
      return;
    }

    if(flow.stage==='recurringEdit'){
      const item=t.recurringItem,source=recurringSource(item,d),idx=Number(flow.recurringIndex||0);
      if(!item||!source){flow.stage='recurringCheck';renderWizard();return;}
      setProgress(`EDITING ${idx+1} OF ${(flow.recurringQueue||[]).length}`,20+Math.round(((idx+1)/Math.max(1,(flow.recurringQueue||[]).length))*40));
      body.innerHTML=wizardHtml(`Update ${source.name}`,'Change only this month’s amount. The value you save becomes next month’s suggestion.',`<div class="finance-reference"><span>Current suggestion</span><strong>${money(source.amount)}</strong></div><div class="finance-money"><span>€</span><input id="finMoney" inputmode="decimal" value="${esc(String(source.amount??''))}" placeholder="0.00"></div><div class="finance-actions"><button class="btn ghost" data-fin-back>Back</button><button class="btn primary big" data-fin-next>Save & continue</button></div>`);
      bindBack(()=>{flow.stage='recurringCheck';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid amount','warn');source.amount=n(v);flow.temp={};flow.recurringIndex=idx+1;flow.stage='recurringCheck';renderWizard();});
      return;
    }

"""+marker
if marker not in s: raise SystemExit('incomeSource marker missing')
s=s.replace(marker,recurring,1)

# 4) Group same-color categories into one bubble in saved-month detail and review.
pattern=r"    const expenses=\(rec\.expenses\|\|\[\]\)\.map\(x=>`.*?`\)\.join\(''\);"
s,n=re.subn(pattern,"    const expenses=groupedExpenseHtml(rec.expenses||[],false);",s,count=1)
if n!=1: raise SystemExit('renderDetail expenses line missing')
pattern=r"    const expenseRows=d\.expenses\.map\(\(x,i\)=>`.*?`\)\.join\(''\)\|\|'<div class=\"finance-empty\">No expenses added\.</div>';"
s,n=re.subn(pattern,"    const expenseRows=groupedExpenseHtml(d.expenses,true)||'<div class=\"finance-empty\">No expenses added.</div>';",s,count=1)
if n!=1: raise SystemExit('renderReview expenses line missing')

p.write_text(s,encoding='utf-8')

# CSS: one bubble per color/category, with rows inside it.
css=Path('finance.css')
c=css.read_text(encoding='utf-8')
addition="""\n.finance-category-bubble{border:1px solid transparent;border-radius:16px;padding:10px 13px;margin:8px 0;overflow:hidden}.finance-category-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:2px 0 8px;border-bottom:1px solid rgba(80,65,55,.12)}.finance-category-head>strong{font-size:15px}.finance-category-head>span{font-size:13px}.finance-category-item{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(80,65,55,.08)}.finance-category-item:last-child{border-bottom:0}.finance-category-item span{color:var(--muted)}.finance-category-item strong{white-space:nowrap}.finance-reference small{display:block;color:var(--muted);font-size:12px;margin-top:4px}\n"""
if '.finance-category-bubble{' not in c:c+=addition
css.write_text(c,encoding='utf-8')

# Cache-bust only the finance experiment files.
idx=Path('index.html')
h=idx.read_text(encoding='utf-8')
h=re.sub(r'finance\.css\?v=\d+','finance.css?v=3',h)
h=re.sub(r'finances\.js\?v=\d+','finances.js?v=3',h)
idx.write_text(h,encoding='utf-8')
