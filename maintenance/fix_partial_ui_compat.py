from pathlib import Path
import re

p=Path('ui.js')
s=p.read_text(encoding='utf-8')
old="const hasActual=/\\bactual\\s+€/i.test(mine?.querySelector('small')?.textContent||'');"
new="const hasActual=/\\bactual\\s+€|saved early:/i.test(mine?.querySelector('small')?.textContent||'');"
count=s.count(old)
if count != 2:
    raise SystemExit(f'Expected 2 hasActual checks, found {count}')
s=s.replace(old,new)

old="const openCards=[...grid.querySelectorAll('.budget-plan-card')].filter(card=>card.querySelector('.budget-plan-status')?.textContent?.trim()!=='Budget checked');"
new="const openCards=[...grid.querySelectorAll('.budget-plan-card')].filter(card=>!card.classList.contains('hidden'));"
if old not in s:
    raise SystemExit('Budget header openCards filter not found')
s=s.replace(old,new,1)

# Make the new audit action human-readable too.
old="""        if(node.nodeType!==Node.TEXT_NODE||!/setIndividualBudget/.test(node.textContent||''))return;\n        const possessive=who==='Principessa'?'her':who==='Principe'?'his':'their';\n        node.textContent=(node.textContent||'').replace(/setIndividualBudget/g,`set ${possessive} trip budget`);"""
new="""        if(node.nodeType!==Node.TEXT_NODE)return;\n        const possessive=who==='Principessa'?'her':who==='Principe'?'his':'their';\n        node.textContent=(node.textContent||'')\n          .replace(/setIndividualBudget/g,`set ${possessive} trip budget`)\n          .replace(/savePartialActual/g,'saved early trip expenses');"""
if old not in s:
    raise SystemExit('Activity-label block not found')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')

p=Path('index.html')
i=p.read_text(encoding='utf-8')
m=re.search(r'ui\.js\?v=(\d+)',i)
if not m:
    raise SystemExit('ui.js cache tag not found')
i=re.sub(r'ui\.js\?v=\d+',f'ui.js?v={int(m.group(1))+1}',i,count=1)
p.write_text(i,encoding='utf-8')
