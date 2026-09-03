from pathlib import Path
import re

p = Path('finances.js')
s = p.read_text(encoding='utf-8')

# Extra €250 is a spending ceiling, not a recurring expense.
needle = "    {group:'extra',name:'Extra',amount:250},\n"
if needle not in s:
    raise SystemExit('Recurring Extra expense row not found')
s = s.replace(needle, '', 1)

# Default/fallback budget is €250 everywhere.
s = s.replace("extraBudget:255", "extraBudget:250")
s = s.replace("?n(rec.extraBudget):255", "?n(rec.extraBudget):250")
s = s.replace("rawExtraBudget>0?rawExtraBudget:255", "rawExtraBudget>0?rawExtraBudget:250")
s = s.replace("copy.extraBudget=255", "copy.extraBudget=250")
s = s.replace("€255 Extra budget", "€250 Extra budget")
s = s.replace("hasValue(d.extraBudget)?d.extraBudget:255", "hasValue(d.extraBudget)?d.extraBudget:250")
s = s.replace("Default is €255.", "Default is €250.")
s = s.replace('placeholder="255.00"', 'placeholder="250.00"')

# Normalize old records that accidentally stored the recurring Extra €250 as spending.
anchor = "  function hasValue(v){ return v !== '' && v != null; }\n\n  function calc(rec){"
replacement = """  function hasValue(v){ return v !== '' && v != null; }
  function normalizeFinanceRecord(rec){
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

  function calc(rec){"""
if anchor not in s:
    raise SystemExit('hasValue anchor missing')
s = s.replace(anchor, replacement, 1)

# Normalize records as soon as they are loaded from Apps Script.
old = """          finances:{
            Principessa:Array.isArray(res.state?.finances?.Principessa)?res.state.finances.Principessa:[],
            Principe:Array.isArray(res.state?.finances?.Principe)?res.state.finances.Principe:[]
          },"""
new = """          finances:{
            Principessa:(Array.isArray(res.state?.finances?.Principessa)?res.state.finances.Principessa:[]).map(normalizeFinanceRecord),
            Principe:(Array.isArray(res.state?.finances?.Principe)?res.state.finances.Principe:[]).map(normalizeFinanceRecord)
          },"""
if old not in s:
    raise SystemExit('loadState finance anchor missing')
s = s.replace(old, new, 1)

# Editing an older draft also migrates the legacy fake spend.
old = """  function cloneRecord(rec){
    const copy=JSON.parse(JSON.stringify(rec));
    copy.expenses=(copy.expenses||[]).map(x=>({...x,group:normalizeGroup(x.group)}));
    if(!hasValue(copy.extraBudget)||n(copy.extraBudget)<=0)copy.extraBudget=250;"""
new = """  function cloneRecord(rec){
    const copy=normalizeFinanceRecord(rec);
    if(!hasValue(copy.extraBudget)||n(copy.extraBudget)<=0)copy.extraBudget=250;"""
if old not in s:
    raise SystemExit('cloneRecord anchor missing')
s = s.replace(old, new, 1)

# New months inherit the last budget limit; otherwise start at €250.
old = "    if(previous&&hasValue(previous.extraBudget)&&n(previous.extraBudget)>0) d.extraBudget=n(previous.extraBudget);"
new = "    if(previous&&hasValue(previous.extraBudget)&&n(previous.extraBudget)>0) d.extraBudget=n(previous.extraBudget); else d.extraBudget=250;"
if old not in s:
    raise SystemExit('seeded budget anchor missing')
s = s.replace(old, new, 1)

# Include the Extra budget as a Confirm/Edit checklist item, but not in expenses.
old = """  function buildRecurringQueue(d){
    return [
      ...(d.incomes||[]).map((_,index)=>({kind:'income',index})),
      ...(d.expenses||[]).map((_,index)=>({kind:'expense',index}))
    ];
  }
  function recurringSource(item,d){ return item?.kind==='income'?d.incomes?.[item.index]:d.expenses?.[item.index]; }"""
new = """  function buildRecurringQueue(d){
    return [
      ...(d.incomes||[]).map((_,index)=>({kind:'income',index})),
      ...(d.expenses||[]).map((_,index)=>({kind:'expense',index})),
      {kind:'extraBudget'}
    ];
  }
  function recurringSource(item,d){
    if(item?.kind==='extraBudget') return {name:'Extra budget',amount:d.extraBudget,group:'extra'};
    return item?.kind==='income'?d.incomes?.[item.index]:d.expenses?.[item.index];
  }"""
if old not in s:
    raise SystemExit('recurring queue anchor missing')
s = s.replace(old, new, 1)

old = "      const meta=item.kind==='income'?{label:'Income',tone:'other'}:{label:CATEGORY_LABELS[groupTone(source.group)]||groupLabel(source.group),tone:groupTone(source.group)};"
new = "      const meta=item.kind==='income'?{label:'Income',tone:'other'}:item.kind==='extraBudget'?{label:'Monthly limit',tone:'budgets'}:{label:CATEGORY_LABELS[groupTone(source.group)]||groupLabel(source.group),tone:groupTone(source.group)};"
if old not in s:
    raise SystemExit('recurring meta anchor missing')
s = s.replace(old, new, 1)

old = """      body.innerHTML=wizardHtml(`${source.name} · ${money(source.amount)}?`,`Recurring ${item.kind==='income'?'income':meta.label.toLowerCase()}. Confirm it if it is still correct, or edit only the amount.`,`<div class=\"finance-reference finance-tone-${meta.tone}\"><span>${esc(meta.label)}</span><strong>${esc(source.name)}</strong><small>Usual amount · ${money(source.amount)}</small></div><div class=\"finance-actions\"><button class=\"btn ghost\" type=\"button\" data-fin-recurring-edit>Edit</button><button class=\"btn primary big\" type=\"button\" data-fin-recurring-confirm>Confirm</button></div>`);"""
new = """      const help=item.kind==='extraBudget'?'This is your monthly spending ceiling for Extra purchases. It is not counted as money spent.':`Recurring ${item.kind==='income'?'income':meta.label.toLowerCase()}. Confirm it if it is still correct, or edit only the amount.`;
      body.innerHTML=wizardHtml(`${source.name} · ${money(source.amount)}?`,help,`<div class=\"finance-reference finance-tone-${meta.tone}\"><span>${esc(meta.label)}</span><strong>${esc(source.name)}</strong><small>${item.kind==='extraBudget'?'Monthly spending limit':'Usual amount'} · ${money(source.amount)}</small></div><div class=\"finance-actions\"><button class=\"btn ghost\" type=\"button\" data-fin-recurring-edit>Edit</button><button class=\"btn primary big\" type=\"button\" data-fin-recurring-confirm>Confirm</button></div>`);"""
if old not in s:
    raise SystemExit('recurring render anchor missing')
s = s.replace(old, new, 1)

old = """      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid amount','warn');source.amount=n(v);flow.temp={};flow.recurringIndex=idx+1;flow.stage='recurringCheck';renderWizard();});"""
new = """      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid amount','warn');if(item.kind==='extraBudget')d.extraBudget=n(v);else source.amount=n(v);flow.temp={};flow.recurringIndex=idx+1;flow.stage='recurringCheck';renderWizard();});"""
if old not in s:
    raise SystemExit('recurring edit save anchor missing')
s = s.replace(old, new, 1)

# The checklist already confirmed the Extra limit, so avoid asking it twice.
old = "if(idx>=queue.length){flow.stage='extraBudget';renderWizard();return;}"
new = "if(idx>=queue.length){flow.stage='investmentTotal';renderWizard();return;}"
if old not in s:
    raise SystemExit('recurring completion anchor missing')
s = s.replace(old, new, 1)

# Clear wording in the manual Edit-budget screen.
s = s.replace("What is your Extra budget this month?", "What is your Extra spending limit this month?")
s = s.replace("Twogether will warn you if your Extra spending goes above it.", "This is a limit, not an expense. Twogether will warn you when your actual Extra purchases go above it.")

p.write_text(s, encoding='utf-8')

# Backend migration/default so the source of truth matches the UI.
b = Path('backend/Code.gs')
g = b.read_text(encoding='utf-8')
g = g.replace('version: 10', 'version: 11')
g = g.replace('state.version = 10;', 'state.version = 11;')
g = g.replace('version:10', 'version:11')
g = g.replace("return x === '' || Number(x) <= 0 ? 255 : x;", "return x === '' || Number(x) <= 0 ? 250 : x;")

old = """function sanitizeFinanceMonth_(record, actor) {
  const incomes = Array.isArray(record && record.incomes) ? record.incomes.slice(0,40).map(sanitizeFinanceIncome_).filter(x => x.name && x.amount !== '') : [];
  const expenses = Array.isArray(record && record.expenses) ? record.expenses.slice(0,100).map(sanitizeFinanceExpense_).filter(x => x.name && x.amount !== '') : [];
  return {
    month: cleanText_(record && record.month, 10),
    incomes: incomes,
    expenses: expenses,
    extraBudget: (function(){ const x=cleanMoney_(record && record.extraBudget); return x === '' || Number(x) <= 0 ? 250 : x; })(),"""
new = """function sanitizeFinanceMonth_(record, actor) {
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
    extraBudget: rawExtraBudget === '' || Number(rawExtraBudget) <= 0 ? 250 : rawExtraBudget,"""
if old not in g:
    raise SystemExit('backend sanitizeFinanceMonth anchor missing')
g = g.replace(old, new, 1)

b.write_text(g, encoding='utf-8')

# Cache-bust finance only.
i = Path('index.html')
h = i.read_text(encoding='utf-8')
h = re.sub(r'finances\.js\?v=\d+', 'finances.js?v=6', h)
i.write_text(h, encoding='utf-8')
