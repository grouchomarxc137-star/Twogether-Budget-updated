from pathlib import Path
import re

p=Path('finances.js')
s=p.read_text(encoding='utf-8')

old="const remove=removable?` <button class=\"text-btn\" data-fin-remove-expense=\"${x.index}\">×</button>`:'';"
new="const remove=removable?` <span class=\"finance-inline-actions\"><button class=\"text-btn\" data-fin-edit-expense=\"${x.index}\">Edit</button><button class=\"text-btn\" data-fin-remove-expense=\"${x.index}\">×</button></span>`:'';"
if old not in s: raise SystemExit('grouped expense action anchor missing')
s=s.replace(old,new,1)

marker="""    if(flow.stage==='expenseGroup'){
"""
block="""    if(flow.stage==='editExistingExpense'){
      const idx=Number(t.editExpenseIndex),item=d.expenses?.[idx];
      if(!item){flow.temp={};flow.stage='review';renderWizard();return;}
      setProgress('EDIT EXPENSE',58);
      body.innerHTML=wizardHtml(`Edit ${item.name||groupLabel(item.group)}`,'Update this saved draft expense. You can keep changing it until the month is confirmed.',`<div class=\"finance-reference finance-tone-${groupTone(item.group)}\"><span>${esc(CATEGORY_LABELS[groupTone(item.group)]||groupLabel(item.group))}</span><strong>${esc(item.name||groupLabel(item.group))}</strong></div><div class=\"finance-money\"><span>€</span><input id=\"finMoney\" inputmode=\"decimal\" value=\"${esc(String(item.amount??''))}\" placeholder=\"0.00\"></div><div class=\"finance-actions\"><button class=\"btn ghost\" data-fin-back>Back</button><button class=\"btn primary big\" data-fin-next>Save change</button></div>`);
      bindBack(()=>{flow.temp={};flow.stage='review';renderWizard();});
      $('[data-fin-next]')?.addEventListener('click',()=>{const v=$('#finMoney')?.value||'';if(v===''||!Number.isFinite(Number(v.replace(',','.'))))return toast('Enter a valid amount','warn');item.amount=n(v);flow.temp={};flow.stage='review';renderWizard();});
      return;
    }

"""+marker
if marker not in s: raise SystemExit('expenseGroup marker missing')
s=s.replace(marker,block,1)

old="""    $$('[data-fin-remove-expense]').forEach(btn=>btn.addEventListener('click',()=>{d.expenses.splice(Number(btn.dataset.finRemoveExpense),1);renderReview();}));"""
new="""    $$('[data-fin-edit-expense]').forEach(btn=>btn.addEventListener('click',()=>{flow.temp={editExpenseIndex:Number(btn.dataset.finEditExpense)};flow.stage='editExistingExpense';renderWizard();}));
    $$('[data-fin-remove-expense]').forEach(btn=>btn.addEventListener('click',()=>{d.expenses.splice(Number(btn.dataset.finRemoveExpense),1);renderReview();}));"""
if old not in s: raise SystemExit('review expense listener anchor missing')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')

p=Path('finance.css')
c=p.read_text(encoding='utf-8')
if '.finance-inline-actions{' not in c:
    c += "\n.finance-inline-actions{display:inline-flex;gap:5px;align-items:center;margin-left:5px}.finance-inline-actions .text-btn{font-size:11px}\n"
p.write_text(c,encoding='utf-8')

p=Path('index.html')
h=p.read_text(encoding='utf-8')
h=h.replace('finance.css?v=3','finance.css?v=4',1).replace('finances.js?v=3','finances.js?v=4',1)
p.write_text(h,encoding='utf-8')
