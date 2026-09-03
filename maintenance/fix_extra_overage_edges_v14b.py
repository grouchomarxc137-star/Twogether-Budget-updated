from pathlib import Path
p=Path('finances.js')
s=p.read_text(encoding='utf-8')
s=s.replace("const remove=removable?` <span class=\"finance-inline-actions\"><button class=\"text-btn\" data-fin-edit-expense=\"${x.index}\">Edit</button><button class=\"text-btn\" data-fin-remove-expense=\"${x.index}\">×</button></span>`:'';", "const fixedExtra=x.group==='extra'&&String(x.name||'').trim().toLowerCase()==='extra';\n        const remove=removable&&!fixedExtra?` <span class=\"finance-inline-actions\"><button class=\"text-btn\" data-fin-edit-expense=\"${x.index}\">Edit</button><button class=\"text-btn\" data-fin-remove-expense=\"${x.index}\">×</button></span>`:'';")
s=s.replace("$('[data-fin-exp-done]')?.addEventListener('click',()=>{flow.stage='extraBudget';renderWizard();});", "$('[data-fin-exp-done]')?.addEventListener('click',()=>{flow.stage='extraSpentAsk';renderWizard();});")
s=s.replace("$('[data-fin-no]')?.addEventListener('click',()=>{flow.stage='extraBudget';renderWizard();});", "$('[data-fin-no]')?.addEventListener('click',()=>{flow.stage='extraSpentAsk';renderWizard();});")
p.write_text(s,encoding='utf-8')
